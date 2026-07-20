//! macOS-native overlay: NSPanel shell, global hotkey, screen targeting.

pub mod hotkey;
pub mod overlay;
pub mod screen;

use tauri::{AppHandle, Emitter, Manager};

pub use overlay::{dismiss, summon};

/// Convert the "main" window into the overlay panel and install the global
/// double-Ctrl monitor. Degrades gracefully if the monitor can't be installed
/// (missing permission) — the tray "Summon" item still works.
pub fn setup(app: &AppHandle, window_ms: u64) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("no main window to convert")?;
    overlay::install(&window)?;

    let app_hotkey = app.clone();
    let token = hotkey::install(window_ms, move || {
        if let Err(e) = overlay::summon(&app_hotkey) {
            eprintln!("wiggle: summon failed: {e}");
        }
        let _ = app_hotkey.emit("wiggle://summon", ());
    });

    match token {
        // Keep the monitor alive for the whole app lifetime.
        Some(t) => std::mem::forget(t),
        None => eprintln!(
            "wiggle: global hotkey unavailable — grant Input Monitoring / Accessibility in \
             System Settings ▸ Privacy & Security, then relaunch. Tray ▸ Summon still works."
        ),
    }
    Ok(())
}
