//! Pictus native shell. All editing logic lives in the TypeScript frontend;
//! Rust only provides binary file access and the "open with" startup path.

use tauri::ipc::{InvokeBody, Request, Response};

/// Reads a whole file and returns it to the frontend as an ArrayBuffer.
#[tauri::command]
fn read_file(path: String) -> Result<Response, String> {
    std::fs::read(&path)
        .map(Response::new)
        .map_err(|e| format!("Could not read {path}: {e}"))
}

/// Writes the raw request body to the path given in the hex-encoded `x-path`
/// header (hex keeps non-ASCII paths safe inside an HTTP header).
#[tauri::command]
fn write_file(request: Request<'_>) -> Result<(), String> {
    let hex = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .ok_or("Missing file path")?;
    let path = decode_hex(hex).ok_or("Invalid file path")?;
    let InvokeBody::Raw(data) = request.body() else {
        return Err("Expected binary data".into());
    };
    std::fs::write(&path, data).map_err(|e| format!("Could not write {path}: {e}"))
}

/// The model file Pictus was launched with (double-click / "Open with"), if any.
#[tauri::command]
fn startup_file() -> Option<String> {
    std::env::args().skip(1).find(|a| {
        let l = a.to_lowercase();
        l.ends_with(".pictus") || l.ends_with(".vox")
    })
}

fn decode_hex(s: &str) -> Option<String> {
    if s.len() % 2 != 0 || !s.is_ascii() {
        return None;
    }
    let bytes = (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect::<Option<Vec<u8>>>()?;
    String::from_utf8(bytes).ok()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_file, write_file, startup_file])
        .run(tauri::generate_context!())
        .expect("error while running Pictus");
}

#[cfg(test)]
mod tests {
    use super::decode_hex;

    #[test]
    fn hex_round_trip() {
        // "C:\ä" as UTF-8 hex
        assert_eq!(decode_hex("433a5cc3a4").as_deref(), Some("C:\\ä"));
        assert_eq!(decode_hex("4"), None);
        assert_eq!(decode_hex("zz"), None);
    }
}
