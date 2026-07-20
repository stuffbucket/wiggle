//! Ingestion: dropped files/screenshots become something the card can use.
//!
//! Files enter via Tauri's webview drag-drop (which hands us OS paths); this
//! module reads a path and classifies it into `Ingested`, which the frontend
//! turns into editor text, an image to wiggle, or a file chip.

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::path::Path;

/// The classified result of ingesting a dropped path.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Ingested {
    /// A readable text file — load it into the editor.
    Text { name: String, text: String },
    /// An image (screenshot) — base64 with no data: prefix, ready to wiggle.
    Image {
        name: String,
        media_type: String,
        base64: String,
    },
    /// Anything else — shown as a file chip.
    File {
        name: String,
        mime: String,
        size: u64,
    },
}

/// Read and classify a dropped path.
pub fn ingest_path(path: &str) -> Result<Ingested, String> {
    let p = Path::new(path);
    let name = p
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("dropped")
        .to_string();
    let mime = mime_from_path(path);
    let size = std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);

    if mime.starts_with("image/") {
        let bytes = std::fs::read(p).map_err(|e| e.to_string())?;
        return Ok(Ingested::Image {
            name,
            media_type: mime,
            base64: STANDARD.encode(bytes),
        });
    }

    if mime.starts_with("text/") || mime == "application/json" {
        // Text files that aren't valid UTF-8 fall through to a file chip.
        if let Ok(text) = std::fs::read_to_string(p) {
            return Ok(Ingested::Text { name, text });
        }
    }

    Ok(Ingested::File { name, mime, size })
}

/// Guess a MIME type from a path's extension. A cheap first pass; a magic-byte
/// sniff can refine this later.
pub fn mime_from_path(path: &str) -> String {
    let ext = Path::new(path)
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
        "txt" | "text" | "log" | "rs" | "ts" | "tsx" | "js" | "py" | "toml" | "yaml"
        | "yml" | "css" | "html" | "htm" => "text/plain",
        "csv" => "text/csv",
        _ => "application/octet-stream",
    }
    .to_string()
}
