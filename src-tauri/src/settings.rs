//! Persistent user settings, stored as `settings.json` under an XDG config dir.
//!
//! We deliberately honor `$XDG_CONFIG_HOME` (falling back to `~/.config/wiggle`)
//! on *every* platform — including macOS — because the user asked for XDG dirs,
//! not the Apple `~/Library/Application Support` convention. Every field has a
//! sane default so a missing or partial file still yields a working config, and
//! no API key is ever required to start.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Which model backend to talk to. `Auto` probes maximal, then Ollama, then
/// waits patiently for one to appear.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Auto,
    Maximal,
    Ollama,
}

impl Default for Provider {
    fn default() -> Self {
        Provider::Auto
    }
}

/// A single provider endpoint: where it lives and which model to ask for.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Endpoint {
    pub base_url: String,
    pub model: String,
}

/// The summon hotkey. Default: double-tap Ctrl within 400 ms.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Hotkey {
    /// One of `ctrl`, `alt`, `shift`, `cmd`.
    pub modifier: String,
    /// How many taps of `modifier` trigger the summon (2 = double-tap).
    pub taps: u8,
    /// Max gap between taps, in milliseconds.
    pub window_ms: u64,
}

impl Default for Hotkey {
    fn default() -> Self {
        Hotkey {
            modifier: "ctrl".into(),
            taps: 2,
            window_ms: 400,
        }
    }
}

/// The whole settings document.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub provider: Provider,
    pub maximal: Endpoint,
    pub ollama: Endpoint,
    pub hotkey: Hotkey,
    /// Screen-dim opacity behind the overlay, 0.0–1.0.
    pub dim: f64,
    /// BCP-47 locale tag, or `"auto"` to follow the OS.
    pub locale: String,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            provider: Provider::default(),
            maximal: Endpoint {
                base_url: "http://localhost:4141".into(),
                model: "claude-haiku-4-5".into(),
            },
            ollama: Endpoint {
                base_url: "http://localhost:11434".into(),
                model: "llama3.1".into(),
            },
            hotkey: Hotkey::default(),
            dim: 0.18,
            locale: "auto".into(),
        }
    }
}

/// `$XDG_CONFIG_HOME/wiggle`, else `~/.config/wiggle`.
pub fn config_dir() -> PathBuf {
    if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
        if !xdg.trim().is_empty() {
            return PathBuf::from(xdg).join("wiggle");
        }
    }
    if let Some(home) = dirs::home_dir() {
        return home.join(".config").join("wiggle");
    }
    PathBuf::from(".wiggle")
}

/// Full path to `settings.json`.
pub fn config_path() -> PathBuf {
    config_dir().join("settings.json")
}

impl Settings {
    /// Load settings from disk, tolerating a missing or malformed file by
    /// returning defaults. Never panics.
    pub fn load() -> Settings {
        let path = config_path();
        match std::fs::read_to_string(&path) {
            Ok(raw) => serde_json::from_str(&raw).unwrap_or_else(|err| {
                eprintln!("wiggle: settings.json parse error ({err}); using defaults");
                Settings::default()
            }),
            Err(_) => Settings::default(),
        }
    }

    /// Persist settings to disk, creating the config dir if needed.
    pub fn save(&self) -> std::io::Result<()> {
        let dir = config_dir();
        std::fs::create_dir_all(&dir)?;
        let json = serde_json::to_string_pretty(self).unwrap_or_default();
        std::fs::write(config_path(), json)
    }

    /// Write defaults to disk if no settings file exists yet, so users have a
    /// documented file to edit. Best-effort; errors are ignored.
    pub fn ensure_on_disk() {
        if !config_path().exists() {
            let _ = Settings::default().save();
        }
    }
}

// Default endpoints only used when deserializing a partial `Endpoint`; serde's
// `#[serde(default)]` on the struct needs `Default` for field-level fallback.
impl Default for Endpoint {
    fn default() -> Self {
        Endpoint {
            base_url: String::new(),
            model: String::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_sane() {
        let s = Settings::default();
        assert_eq!(s.provider, Provider::Auto);
        assert_eq!(s.maximal.base_url, "http://localhost:4141");
        assert_eq!(s.ollama.base_url, "http://localhost:11434");
        assert_eq!(s.hotkey.taps, 2);
        assert_eq!(s.hotkey.window_ms, 400);
        assert_eq!(s.locale, "auto");
    }

    #[test]
    fn round_trips_through_json() {
        let s = Settings::default();
        let json = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.maximal.model, s.maximal.model);
        assert_eq!(back.provider, s.provider);
    }

    #[test]
    fn partial_json_fills_from_defaults() {
        // Only `provider` is present; container-level #[serde(default)] fills the
        // rest from Settings::default() — so maximal must still be localhost:4141.
        let s: Settings = serde_json::from_str(r#"{"provider":"ollama"}"#).unwrap();
        assert_eq!(s.provider, Provider::Ollama);
        assert_eq!(s.maximal.base_url, "http://localhost:4141");
        assert_eq!(s.hotkey.window_ms, 400);
    }

    #[test]
    fn config_dir_honors_xdg() {
        let prev = std::env::var("XDG_CONFIG_HOME").ok();
        std::env::set_var("XDG_CONFIG_HOME", "/tmp/wiggle_xdg_test");
        assert_eq!(
            config_dir(),
            std::path::PathBuf::from("/tmp/wiggle_xdg_test/wiggle")
        );
        match prev {
            Some(v) => std::env::set_var("XDG_CONFIG_HOME", v),
            None => std::env::remove_var("XDG_CONFIG_HOME"),
        }
    }
}

