//! Faber MCP Sidecar — stdio-to-HTTP bridge
//!
//! This binary is launched by AI agents (Claude Code, Codex, Gemini) via their
//! MCP config. It reads JSON-RPC messages from stdin, forwards them to the
//! Faber HTTP MCP server, and writes responses to stdout.
//!
//! Environment variables:
//!   FABER_MCP_URL    — Full URL to the MCP endpoint
//!                      (e.g., http://127.0.0.1:PORT/session/SESSION_ID/mcp)
//!   FABER_MCP_SECRET — Pre-shared secret for authenticating with the MCP server

use std::io::{self, BufRead, Read, Write};
use std::net::TcpStream;

fn main() {
    let url = match std::env::var("FABER_MCP_URL") {
        Ok(u) => u,
        Err(_) => {
            eprintln!("[faber-mcp] FABER_MCP_URL environment variable not set"); // Sidecar uses eprintln (no tracing subscriber)
            std::process::exit(1);
        }
    };

    // Validate that the URL points to localhost only (prevent SSRF)
    let url_body = url.strip_prefix("http://").unwrap_or(&url);
    if !url_body.starts_with("127.0.0.1:") {
        eprintln!("[faber-mcp] FABER_MCP_URL must point to 127.0.0.1");
        std::process::exit(1);
    }

    let secret = std::env::var("FABER_MCP_SECRET").unwrap_or_default();

    // Parse URL into host:port and path
    let (host_port, path) = match url_body.split_once('/') {
        Some((hp, p)) => (hp.to_string(), format!("/{p}")),
        None => (url_body.to_string(), "/".to_string()),
    };

    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut stdout = stdout.lock();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) if l.trim().is_empty() => continue,
            Ok(l) => l,
            Err(_) => break,
        };

        // Check if this is a notification (no "id" field → no response expected)
        let is_notification = is_json_rpc_notification(&line);

        // Forward to HTTP server
        match http_post(&host_port, &path, &secret, line.as_bytes()) {
            Ok(response_body) => {
                if !is_notification {
                    let body = String::from_utf8_lossy(&response_body);
                    let body = body.trim();
                    if !body.is_empty() {
                        let _ = writeln!(stdout, "{body}");
                        let _ = stdout.flush();
                    }
                }
            }
            Err(e) => {
                if !is_notification {
                    // Return a JSON-RPC internal error
                    let escaped = e.replace('\\', "\\\\").replace('"', "\\\"");
                    let _ = writeln!(
                        stdout,
                        r#"{{"jsonrpc":"2.0","id":null,"error":{{"code":-32603,"message":"{escaped}"}}}}"#
                    );
                    let _ = stdout.flush();
                }
            }
        }
    }
}

/// Check if a JSON-RPC message is a notification (no "id" field).
fn is_json_rpc_notification(json: &str) -> bool {
    // Parse minimally — check for the presence of "id" key
    match serde_json::from_str::<serde_json::Value>(json) {
        Ok(v) => !v.as_object().is_some_and(|obj| obj.contains_key("id")),
        Err(_) => false,
    }
}

/// Send a POST request to a localhost HTTP server and return the response body.
fn http_post(host_port: &str, path: &str, secret: &str, body: &[u8]) -> Result<Vec<u8>, String> {
    let mut stream = TcpStream::connect(host_port).map_err(|e| format!("connect: {e}"))?;

    // Set a reasonable timeout
    let timeout = std::time::Duration::from_secs(30);
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));

    let header = format!(
        "POST {path} HTTP/1.1\r\n\
         Host: {host_port}\r\n\
         Content-Type: application/json\r\n\
         Authorization: Bearer {secret}\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\
         \r\n",
        body.len()
    );

    stream
        .write_all(header.as_bytes())
        .map_err(|e| format!("write header: {e}"))?;
    stream
        .write_all(body)
        .map_err(|e| format!("write body: {e}"))?;

    // Read full response (Connection: close → server closes when done)
    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .map_err(|e| format!("read: {e}"))?;

    // Find body after \r\n\r\n
    let header_end = response
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .map(|i| i + 4)
        .unwrap_or(0);

    Ok(response[header_end..].to_vec())
}
