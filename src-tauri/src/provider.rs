//! Model providers and discovery.
//!
//! Wiggle talks to a local model backend over HTTP. Two shapes are supported:
//!
//! - **maximal** (`localhost:4141` by default) — an Anthropic-compatible proxy;
//!   we POST the Messages API (`/v1/messages`).
//! - **Ollama** (`localhost:11434`) — the local Ollama server (`/api/chat`).
//!
//! In `auto` mode we probe maximal first, then Ollama, and if neither answers we
//! report `None` so the UI can show a calm "waiting for a model" state and poll
//! again — we never hard-fail for a missing provider.

use crate::settings::{Provider, Settings};
use serde_json::{json, Value};
use std::time::Duration;

/// The concrete backend flavor, resolved from settings + discovery.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderKind {
    Maximal,
    Ollama,
}

impl ProviderKind {
    pub fn label(self) -> &'static str {
        match self {
            ProviderKind::Maximal => "maximal",
            ProviderKind::Ollama => "ollama",
        }
    }
}

/// A fully-resolved provider ready to serve a request.
#[derive(Debug, Clone)]
pub struct Resolved {
    pub kind: ProviderKind,
    pub base_url: String,
    pub model: String,
    pub api_key: Option<String>,
}

/// One part of a user message: text, or an image (base64, no data: prefix).
#[derive(Debug, Clone)]
pub enum Part {
    Text(String),
    Image { media_type: String, base64: String },
}

fn client(timeout: Duration) -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

/// Optional API key from the environment (never required for local providers).
fn env_api_key() -> Option<String> {
    for var in ["WIGGLE_API_KEY", "ANTHROPIC_API_KEY"] {
        if let Ok(v) = std::env::var(var) {
            if !v.trim().is_empty() {
                return Some(v);
            }
        }
    }
    None
}

/// Is a provider reachable right now? Cheap GET with a short timeout.
pub async fn is_up(kind: ProviderKind, base_url: &str) -> bool {
    let url = match kind {
        ProviderKind::Maximal => format!("{}/v1/models", base_url.trim_end_matches('/')),
        ProviderKind::Ollama => format!("{}/api/tags", base_url.trim_end_matches('/')),
    };
    let c = client(Duration::from_millis(900));
    match c.get(&url).send().await {
        // Any HTTP response (even 401/404) means something is listening.
        Ok(_) => true,
        Err(_) => false,
    }
}

/// Resolve the active provider given current settings. Returns `None` when the
/// desired provider (or, in auto mode, every candidate) is unreachable.
pub async fn discover(settings: &Settings) -> Option<Resolved> {
    let key = env_api_key();
    let maximal = Resolved {
        kind: ProviderKind::Maximal,
        base_url: settings.maximal.base_url.clone(),
        model: settings.maximal.model.clone(),
        api_key: key.clone(),
    };
    let ollama = Resolved {
        kind: ProviderKind::Ollama,
        base_url: settings.ollama.base_url.clone(),
        model: settings.ollama.model.clone(),
        api_key: None,
    };

    match settings.provider {
        Provider::Maximal => is_up(maximal.kind, &maximal.base_url).await.then_some(maximal),
        Provider::Ollama => is_up(ollama.kind, &ollama.base_url).await.then_some(ollama),
        Provider::Auto => {
            if is_up(maximal.kind, &maximal.base_url).await {
                Some(maximal)
            } else if is_up(ollama.kind, &ollama.base_url).await {
                Some(ollama)
            } else {
                None
            }
        }
    }
}

/// Send a single-turn completion: a system prompt plus a user message built from
/// `parts`, returning the model's text. Abstracts the two wire formats.
pub async fn complete(
    resolved: &Resolved,
    system: &str,
    parts: &[Part],
    max_tokens: u32,
) -> Result<String, String> {
    match resolved.kind {
        ProviderKind::Maximal => complete_anthropic(resolved, system, parts, max_tokens).await,
        ProviderKind::Ollama => complete_ollama(resolved, system, parts).await,
    }
}

async fn complete_anthropic(
    r: &Resolved,
    system: &str,
    parts: &[Part],
    max_tokens: u32,
) -> Result<String, String> {
    let content: Vec<Value> = parts
        .iter()
        .map(|p| match p {
            Part::Text(t) => json!({ "type": "text", "text": t }),
            Part::Image { media_type, base64 } => json!({
                "type": "image",
                "source": { "type": "base64", "media_type": media_type, "data": base64 }
            }),
        })
        .collect();

    let body = json!({
        "model": r.model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [ { "role": "user", "content": content } ]
    });

    let url = format!("{}/v1/messages", r.base_url.trim_end_matches('/'));
    let mut req = client(Duration::from_secs(120))
        .post(&url)
        .header("content-type", "application/json")
        .header("anthropic-version", "2023-06-01");
    if let Some(key) = &r.api_key {
        req = req.header("x-api-key", key);
    }

    let resp = req.json(&body).send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    let val: Value = resp.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("maximal {}: {}", status, val));
    }

    // content: [ { type: "text", text: "..." }, ... ]
    let text = val
        .get("content")
        .and_then(|c| c.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|b| b.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default();
    Ok(text)
}

async fn complete_ollama(r: &Resolved, system: &str, parts: &[Part]) -> Result<String, String> {
    // Ollama's chat: text goes in `content`, images in a sibling `images` array.
    let mut text = String::new();
    let mut images: Vec<String> = Vec::new();
    for p in parts {
        match p {
            Part::Text(t) => {
                if !text.is_empty() {
                    text.push('\n');
                }
                text.push_str(t);
            }
            Part::Image { base64, .. } => images.push(base64.clone()),
        }
    }

    let mut user_msg = json!({ "role": "user", "content": text });
    if !images.is_empty() {
        user_msg["images"] = json!(images);
    }

    let body = json!({
        "model": r.model,
        "stream": false,
        "messages": [
            { "role": "system", "content": system },
            user_msg
        ]
    });

    let url = format!("{}/api/chat", r.base_url.trim_end_matches('/'));
    let resp = client(Duration::from_secs(120))
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let val: Value = resp.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("ollama {}: {}", status, val));
    }

    let text = val
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    Ok(text)
}
