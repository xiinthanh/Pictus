//! Local MCP endpoint (Streamable HTTP on 127.0.0.1).
//!
//! Rust is only a relay: it checks the request (path, method, Origin, bearer
//! token, size), forwards the raw JSON-RPC body plus the MCP headers to the
//! frontend as a `mcp-request` event, and sends back whatever status and body
//! the frontend answers with via `mcp_respond`. Requests are handled one at a
//! time, so the editor never sees two AI edits at once.

use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tiny_http::{Header, Method, Request, Response, Server};

const MAX_BODY: u64 = 4 * 1024 * 1024;
const ANSWER_TIMEOUT: Duration = Duration::from_secs(60);
const POLL: Duration = Duration::from_millis(200);

type Pending = Arc<Mutex<HashMap<u64, Sender<(u16, String)>>>>;

struct Run {
    server: Arc<Server>,
    stop: Arc<AtomicBool>,
    thread: JoinHandle<()>,
}

#[derive(Default)]
pub struct McpState {
    run: Mutex<Option<Run>>,
    pending: Pending,
    next_id: Arc<AtomicU64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct McpRequest {
    id: u64,
    body: String,
    protocol_version: Option<String>,
    method: Option<String>,
    name: Option<String>,
}

/// Starts (or restarts) the endpoint on 127.0.0.1:`port`.
#[tauri::command]
pub fn mcp_start(app: AppHandle, state: State<McpState>, port: u16, token: String) -> Result<(), String> {
    if token.len() < 32 {
        return Err("Token is too short".into());
    }
    stop(&state);
    let server = Server::http(("127.0.0.1", port))
        .map(Arc::new)
        .map_err(|e| format!("Could not listen on port {port}: {e}"))?;
    let stop_flag = Arc::new(AtomicBool::new(false));
    let thread = {
        let (server, stop_flag) = (server.clone(), stop_flag.clone());
        let (pending, next_id) = (state.pending.clone(), state.next_id.clone());
        thread::spawn(move || serve(app, server, token, stop_flag, pending, next_id))
    };
    *state.run.lock().unwrap() = Some(Run { server, stop: stop_flag, thread });
    Ok(())
}

#[tauri::command]
pub fn mcp_stop(state: State<McpState>) {
    stop(&state);
}

/// The frontend's answer to a `mcp-request` event.
#[tauri::command]
pub fn mcp_respond(state: State<McpState>, id: u64, status: u16, body: String) {
    if let Some(tx) = state.pending.lock().unwrap().remove(&id) {
        let _ = tx.send((status, body));
    }
}

fn stop(state: &McpState) {
    if let Some(run) = state.run.lock().unwrap().take() {
        run.stop.store(true, Ordering::SeqCst);
        run.server.unblock();
        state.pending.lock().unwrap().clear();
        let _ = run.thread.join(); // returns within one POLL interval
    }
}

fn serve(app: AppHandle, server: Arc<Server>, token: String, stop: Arc<AtomicBool>, pending: Pending, next_id: Arc<AtomicU64>) {
    while let Ok(mut req) = server.recv() {
        if stop.load(Ordering::SeqCst) {
            let _ = req.respond(text(503, "Pictus AI connection is off"));
            break;
        }
        let response = handle(&app, &mut req, &token, &stop, &pending, &next_id);
        let _ = req.respond(response);
    }
}

fn handle(
    app: &AppHandle,
    req: &mut Request,
    token: &str,
    stop: &AtomicBool,
    pending: &Pending,
    next_id: &AtomicU64,
) -> Response<std::io::Cursor<Vec<u8>>> {
    if req.url().split('?').next() != Some("/mcp") {
        return text(404, "Not found");
    }
    if let Err(code) = authorize(header(req, "Origin"), header(req, "Authorization"), token) {
        return text(code, if code == 403 { "Forbidden" } else { "Unauthorized" });
    }
    if *req.method() != Method::Post {
        return text(405, "Method not allowed").with_header(hdr("Allow", "POST"));
    }
    let mut body = String::new();
    if req.as_reader().take(MAX_BODY + 1).read_to_string(&mut body).is_err() {
        return text(400, "Body must be UTF-8 JSON");
    }
    if body.len() as u64 > MAX_BODY {
        return text(413, "Request too large");
    }

    let id = next_id.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = mpsc::channel();
    pending.lock().unwrap().insert(id, tx);
    let event = McpRequest {
        id,
        body,
        protocol_version: header(req, "MCP-Protocol-Version").map(str::to_owned),
        method: header(req, "Mcp-Method").map(str::to_owned),
        name: header(req, "Mcp-Name").map(str::to_owned),
    };
    if app.emit_to("main", "mcp-request", event).is_err() {
        pending.lock().unwrap().remove(&id);
        return text(503, "Pictus window is not available");
    }

    let started = Instant::now();
    let answer = loop {
        match rx.recv_timeout(POLL) {
            Ok(a) => break Some(a),
            Err(RecvTimeoutError::Timeout) if !stop.load(Ordering::SeqCst) && started.elapsed() < ANSWER_TIMEOUT => {}
            Err(_) => break None,
        }
    };
    pending.lock().unwrap().remove(&id);
    match answer {
        Some((status, body)) if body.is_empty() => Response::from_data(Vec::new()).with_status_code(status),
        Some((status, body)) => Response::from_data(body.into_bytes())
            .with_status_code(status)
            .with_header(hdr("Content-Type", "application/json")),
        None => text(504, "Pictus did not answer in time"),
    }
}

/// Ok(()) or the HTTP status to reject with. Browsers send `Origin`; MCP
/// clients like Claude Code don't, so any `Origin` is refused (DNS rebinding).
fn authorize(origin: Option<&str>, auth: Option<&str>, token: &str) -> Result<(), u16> {
    if origin.is_some() {
        return Err(403);
    }
    let expected = format!("Bearer {token}");
    match auth {
        Some(a) if constant_time_eq(a.as_bytes(), expected.as_bytes()) => Ok(()),
        _ => Err(401),
    }
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn header<'a>(req: &'a Request, name: &'static str) -> Option<&'a str> {
    req.headers().iter().find(|h| h.field.equiv(name)).map(|h| h.value.as_str())
}

fn hdr(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("static header")
}

fn text(status: u16, msg: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_data(msg.as_bytes().to_vec())
        .with_status_code(status)
        .with_header(hdr("Content-Type", "text/plain; charset=utf-8"))
}

#[cfg(test)]
mod tests {
    use super::authorize;

    const T: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn authorize_rules() {
        assert_eq!(authorize(None, Some(&format!("Bearer {T}")), T), Ok(()));
        assert_eq!(authorize(None, None, T), Err(401));
        assert_eq!(authorize(None, Some("Bearer wrong"), T), Err(401));
        assert_eq!(authorize(None, Some(T), T), Err(401));
        assert_eq!(authorize(Some("http://evil.example"), Some(&format!("Bearer {T}")), T), Err(403));
    }
}
