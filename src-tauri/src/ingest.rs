//! Ingestion: everything dropped, pasted, or typed becomes a `Payload`.
//!
//! The native macOS drop view and the cross-platform webview drop path both
//! normalize their input into this shared shape before it reaches the engine or
//! the UI.

use serde::{Deserialize, Serialize};

/// A normalized piece of input.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Payload {
    /// Plain text (typed or pasted).
    Text { text: String },
    /// An image (screenshot/paste/drop), base64 with no data: prefix.
    Image { media_type: String, base64: String },
    /// A file on disk, referenced by path.
    File {
        path: String,
        name: String,
        mime: String,
        size: u64,
    },
}

/// Guess a MIME type from a path's extension. A cheap first pass; a magic-byte
/// sniff can refine this later.
pub fn mime_from_path(path: &str) -> String {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "pdf" => "application/pdf",
        "md" | "markdown" => "text/markdown",
        "json" => "application/json",
        "txt" | "text" | "log" => "text/plain",
        "html" | "htm" => "text/html",
        "csv" => "text/csv",
        _ => "application/octet-stream",
    }
    .to_string()
}

/// Is this MIME type something we can preview inline (text or image)?
pub fn previewable(mime: &str) -> bool {
    mime.starts_with("text/") || mime.starts_with("image/") || mime == "application/json"
}
