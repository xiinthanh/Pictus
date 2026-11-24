//! Local MCP endpoint (Streamable HTTP on 127.0.0.1).
//!
//! Rust is only a relay: it checks the request (path, method, Origin, bearer
//! token, size), forwards the raw JSON-RPC body plus the MCP headers to the
//! frontend as a `mcp-request` event, and sends back whatever status and body
//! the frontend answers with via `mcp_respond`. Requests are handled one at a
//! time, so the editor never sees two AI edits at once.

use std::collections::HashMap;
use std::io::{ErrorKind, Read};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tiny_http::{Header, Method, Request, Response, Server};

const MAX_BODY: u64 = 4 * 1024 * 1024;
const MIN_TOKEN_LEN: usize = 32;
const ANSWER_TIMEOUT: Duration = Duration::from_secs(60);
const POLL: Duration = Duration::from_millis(200);
/// tiny_http closes its listening socket on a background thread after the
/// server is dropped, so an immediate restart on the same port may still
/// find it in use for a moment.
const BIND_RETRIES: u32 = 10;
const BIND_RETRY_DELAY: Duration = Duration::from_millis(100);

type Pending = Arc<Mutex<HashMap<u64, Sender<(u16, String)>>>>;
type HttpResponse = Response<std::io::Cursor<Vec<u8>>>;

/// What the server thread needs to answer requests.
struct Relay {
    app: AppHandle,
    token: String,
    should_stop: Arc<AtomicBool>,
    pending: Pending,
    next_id: Arc<AtomicU64>,
}

struct Run {
    server: Arc<Server>,
    should_stop: Arc<AtomicBool>,
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
    /// Unix ms at which this relay stops waiting; the frontend refuses to
    /// start work that would finish after the client already got a 504.
    expires_at: u64,
}

#[derive(Clone, Serialize)]
struct McpStopped {
    error: String,
}

/// Starts (or restarts) the endpoint on 127.0.0.1:`port`. Runs off the main
/// thread because stopping a previous server and binding may wait briefly.
#[tauri::command(async)]
pub fn mcp_start(app: AppHandle, state: State<McpState>, port: u16, token: String) -> Result<(), String> {
    if token.len() < MIN_TOKEN_LEN {
        return Err(format!("The token must be at least {MIN_TOKEN_LEN} characters long"));
    }
    stop(&state)?;
    let server = Arc::new(bind(port)?);
    let should_stop = Arc::new(AtomicBool::new(false));
    let relay = Relay {
        app,
        token,
        should_stop: should_stop.clone(),
        pending: state.pending.clone(),
        next_id: state.next_id.clone(),
    };
    let thread = {
        let server = server.clone();
        thread::spawn(move || serve(&server, &relay))
    };
    *state.run.lock().unwrap() = Some(Run { server, should_stop, thread });
    Ok(())
}

#[tauri::command(async)]
pub fn mcp_stop(state: State<McpState>) -> Result<(), String> {
    stop(&state)
}

/// The frontend's answer to a `mcp-request` event.
#[tauri::command]
pub fn mcp_respond(state: State<McpState>, id: u64, status: u16, body: String) -> Result<(), String> {
    let gone = || format!("MCP request {id} is no longer waiting (timed out or the connection was turned off)");
    let tx = state.pending.lock().unwrap().remove(&id).ok_or_else(gone)?;
    tx.send((status, body)).map_err(|_| gone())
}

fn bind(port: u16) -> Result<Server, String> {
    let mut attempt = 0;
    loop {
        match Server::http(("127.0.0.1", port)) {
            Ok(server) => return Ok(server),
            Err(e) if attempt < BIND_RETRIES && is_addr_in_use(&*e) => {
                attempt += 1;
                thread::sleep(BIND_RETRY_DELAY);
            }
            Err(e) => return Err(format!("Could not listen on 127.0.0.1:{port}: {e}. Is another program using this port?")),
        }
    }
}

fn is_addr_in_use(e: &(dyn std::error::Error + Send + Sync + 'static)) -> bool {
    e.downcast_ref::<std::io::Error>().is_some_and(|io| io.kind() == ErrorKind::AddrInUse)
}

fn stop(state: &McpState) -> Result<(), String> {
    let Some(run) = state.run.lock().unwrap().take() else {
        return Ok(());
    };
    run.should_stop.store(true, Ordering::SeqCst);
    run.server.unblock();
    state.pending.lock().unwrap().clear();
    // Returns within one POLL interval: the pending answer it may wait on was just dropped.
    run.thread.join().map_err(|_| "The AI connection thread crashed".to_string())
}

fn serve(server: &Server, relay: &Relay) {
    loop {
        let mut req = match server.recv() {
            Ok(req) => req,
            Err(e) => {
                // `unblock()` from stop() also lands here; only an unexpected end is reported.
                if !relay.should_stop.load(Ordering::SeqCst) {
                    let error = format!("the server stopped accepting connections: {e}");
                    if let Err(emit_err) = relay.app.emit_to("main", "mcp-stopped", McpStopped { error }) {
                        eprintln!("Pictus MCP: server stopped ({e}) and the window could not be told: {emit_err}");
                    }
                }
                return;
            }
        };
        let response = if relay.should_stop.load(Ordering::SeqCst) {
            text(503, "Pictus AI connection is off")
        } else {
            handle(relay, &mut req)
        };
        if let Err(e) = req.respond(response) {
            eprintln!("Pictus MCP: could not send a response (client disconnected?): {e}");
        }
    }
}

fn handle(relay: &Relay, req: &mut Request) -> HttpResponse {
    match check_request(req, &relay.token) {
        Ok(body) => forward(relay, req, body),
        Err(rejection) => rejection,
    }
}

/// The request body, or the response that rejects the request.
fn check_request(req: &mut Request, token: &str) -> Result<String, HttpResponse> {
    if req.url().split('?').next() != Some("/mcp") {
        return Err(text(404, "Not found"));
    }
    if let Err(code) = authorize(header(req, "Origin"), header(req, "Authorization"), token) {
        return Err(text(code, if code == 403 { "Forbidden" } else { "Unauthorized" }));
    }
    if *req.method() != Method::Post {
        return Err(text(405, "Method not allowed").with_header(hdr("Allow", "POST")));
    }
    let declared_len = req.body_length();
    read_body(req.as_reader(), declared_len).map_err(|code| match code {
        413 => text(413, &format!("Request too large (limit {} MB)", MAX_BODY / (1024 * 1024))),
        _ => text(code, "Body must be UTF-8 JSON"),
    })
}

/// Hands the request to the window and waits for its answer.
fn forward(relay: &Relay, req: &Request, body: String) -> HttpResponse {
    let id = relay.next_id.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = mpsc::channel();
    relay.pending.lock().unwrap().insert(id, tx);
    let event = McpRequest {
        id,
        body,
        protocol_version: header(req, "MCP-Protocol-Version").map(str::to_owned),
        method: header(req, "Mcp-Method").map(str::to_owned),
        name: header(req, "Mcp-Name").map(str::to_owned),
        expires_at: unix_ms(SystemTime::now() + ANSWER_TIMEOUT),
    };
    if relay.app.emit_to("main", "mcp-request", event).is_err() {
        relay.pending.lock().unwrap().remove(&id);
        return text(503, "Pictus window is not available");
    }

    let started = Instant::now();
    let answer = loop {
        match rx.recv_timeout(POLL) {
            Ok(a) => break Some(a),
            Err(RecvTimeoutError::Timeout)
                if !relay.should_stop.load(Ordering::SeqCst) && started.elapsed() < ANSWER_TIMEOUT => {}
            Err(_) => break None,
        }
    };
    relay.pending.lock().unwrap().remove(&id);
    to_response(answer)
}

/// The window's answer as HTTP, or 504 when it never came.
fn to_response(answer: Option<(u16, String)>) -> HttpResponse {
    match answer {
        Some((status, body)) if body.is_empty() => Response::from_data(Vec::new()).with_status_code(status),
        Some((status, body)) => Response::from_data(body.into_bytes())
            .with_status_code(status)
            .with_header(hdr("Content-Type", "application/json")),
        None => text(504, "Pictus did not answer in time"),
    }
}

/// The body as UTF-8, or the HTTP status to reject with. Size is checked
/// before decoding, so a cut through a multi-byte character still reads as
/// "too large" rather than "invalid UTF-8".
fn read_body(reader: &mut dyn Read, declared_len: Option<usize>) -> Result<String, u16> {
    if declared_len.is_some_and(|n| n as u64 > MAX_BODY) {
        return Err(413);
    }
    let mut bytes = Vec::new();
    reader.take(MAX_BODY + 1).read_to_end(&mut bytes).map_err(|_| 400u16)?;
    if bytes.len() as u64 > MAX_BODY {
        return Err(413);
    }
    String::from_utf8(bytes).map_err(|_| 400)
}

fn unix_ms(t: SystemTime) -> u64 {
    let since_epoch = t.duration_since(UNIX_EPOCH).expect("the system clock is set before 1970");
    u64::try_from(since_epoch.as_millis()).unwrap_or(u64::MAX)
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

fn text(status: u16, msg: &str) -> HttpResponse {
    Response::from_data(msg.as_bytes().to_vec())
        .with_status_code(status)
        .with_header(hdr("Content-Type", "text/plain; charset=utf-8"))
}

#[cfg(test)]
mod tests {
    use super::{authorize, read_body, MAX_BODY, MIN_TOKEN_LEN};
    use std::io::Cursor;

    /// A placeholder of the right length, not a secret.
    fn token() -> String {
        "a".repeat(MIN_TOKEN_LEN)
    }

    #[test]
    fn authorize_accepts_the_bearer_token() {
        let t = token();
        assert_eq!(authorize(None, Some(&format!("Bearer {t}")), &t), Ok(()));
    }

    #[test]
    fn authorize_rejects_missing_or_wrong_tokens() {
        let t = token();
        assert_eq!(authorize(None, None, &t), Err(401));
        assert_eq!(authorize(None, Some("Bearer wrong"), &t), Err(401));
        assert_eq!(authorize(None, Some(&t), &t), Err(401));
    }

    #[test]
    fn authorize_rejects_browser_origins() {
        let t = token();
        assert_eq!(authorize(Some("http://evil.example"), Some(&format!("Bearer {t}")), &t), Err(403));
    }

    #[test]
    fn read_body_rejects_a_declared_oversize_body_without_reading_it() {
        let mut empty = Cursor::new(Vec::new());
        assert_eq!(read_body(&mut empty, Some(MAX_BODY as usize + 1)), Err(413));
    }

    #[test]
    fn read_body_reports_oversize_even_when_the_cut_splits_a_character() {
        // 'ệ' is 3 bytes; the limit falls inside one of them.
        let mut big = "ệ".repeat(MAX_BODY as usize / 3 + 1).into_bytes();
        big.truncate(MAX_BODY as usize + 2);
        assert_eq!(read_body(&mut Cursor::new(big), None), Err(413));
    }

    #[test]
    fn read_body_rejects_invalid_utf8() {
        assert_eq!(read_body(&mut Cursor::new(vec![0xff, 0xfe]), Some(2)), Err(400));
    }

    #[test]
    fn read_body_returns_valid_text() {
        assert_eq!(read_body(&mut Cursor::new(b"{}".to_vec()), Some(2)), Ok("{}".to_string()));
    }
}
