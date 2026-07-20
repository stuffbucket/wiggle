//! Wiggle — a menubar app that keeps only what won't budge.
//!
//! Rust owns the app: the tray, the summon hotkey, the native overlay panel, and
//! the wiggle engine that talks to a local model provider. The webview is one
//! transparent card rendered inside the overlay.

mod engine;
mod ingest;
mod provider;
mod settings;

#[cfg(target_os = "macos")]
mod macos;

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

use engine::WiggleBlock;
use settings::Settings;

/// What the UI needs to know about the model backend.
#[derive(Debug, Clone, Serialize)]
struct ProviderStatus {
    online: bool,
    provider: String,
    model: String,
}

impl ProviderStatus {
    async fn probe() -> ProviderStatus {
        let settings = Settings::load();
        match provider::discover(&settings).await {
            Some(p) => ProviderStatus {
                online: true,
                provider: p.kind.label().to_string(),
                model: p.model,
            },
            None => ProviderStatus {
                online: false,
                provider: String::new(),
                model: String::new(),
            },
        }
    }
}

/// Config the webview reads once on load (dim opacity, locale).
#[derive(Debug, Clone, Serialize)]
struct Config {
    dim: f64,
    locale: String,
}

// ---- commands ---------------------------------------------------------------

/// Wiggle a passage of text: keep the blocks that matter, fade the filler.
#[tauri::command]
async fn wiggle(text: String) -> Result<Vec<WiggleBlock>, String> {
    let settings = Settings::load();
    match provider::discover(&settings).await {
        Some(p) => engine::wiggle_text(&p, &text).await,
        None => Err("no-provider".into()),
    }
}

/// Current model-provider status (which local backend, if any, is reachable).
#[tauri::command]
async fn provider_status() -> ProviderStatus {
    ProviderStatus::probe().await
}

/// UI config from settings.json.
#[tauri::command]
fn get_config() -> Config {
    let s = Settings::load();
    Config {
        dim: s.dim,
        locale: s.locale,
    }
}

/// Hide the overlay (Esc / scrim click from the webview).
#[tauri::command]
fn dismiss(app: AppHandle) {
    hide_overlay(&app);
}

/// Show the overlay (callable from the UI; the tray and hotkey use it too).
#[tauri::command]
fn summon(app: AppHandle) -> Result<(), String> {
    summon_overlay(&app)
}

// ---- overlay helpers (platform-dispatched) ----------------------------------

fn summon_overlay(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::summon(app)?;
        let _ = app.emit("wiggle://summon", ());
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.show();
            let _ = w.set_focus();
            let _ = app.emit("wiggle://summon", ());
        }
        Ok(())
    }
}

fn hide_overlay(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        macos::dismiss(app);
    }
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.hide();
        }
    }
}

// ---- tray -------------------------------------------------------------------

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let summon_i = MenuItem::with_id(app, "summon", "Summon Wiggle", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit Wiggle", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&summon_i, &quit_i])?;

    let icon = app
        .default_window_icon()
        .cloned()
        .expect("bundled default window icon");

    TrayIconBuilder::with_id("wiggle-tray")
        .icon(icon)
        .icon_as_template(true)
        .tooltip("Wiggle")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "summon" => {
                let _ = summon_overlay(app);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = summon_overlay(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

// ---- entry ------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Give users a documented settings.json to edit on first launch.
    Settings::ensure_on_disk();

    let mut builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());

    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_nspanel::init());
    }

    builder
        .setup(|app| {
            let handle = app.handle();
            build_tray(handle)?;

            #[cfg(target_os = "macos")]
            {
                let window_ms = Settings::load().hotkey.window_ms;
                if let Err(e) = macos::setup(handle, window_ms) {
                    eprintln!("wiggle: overlay setup failed: {e}");
                }
            }

            // Background poller: keep the UI's provider status fresh so a
            // "waiting for a model" card lights up the moment a backend appears.
            let poll_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                let mut last: Option<bool> = None;
                loop {
                    let status = ProviderStatus::probe().await;
                    if last != Some(status.online) {
                        last = Some(status.online);
                        let _ = poll_handle.emit("wiggle://provider", status);
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // Blur-to-hide: the overlay disappears when the user clicks away.
            if let tauri::WindowEvent::Focused(false) = event {
                if window.label() == "main" {
                    hide_overlay(window.app_handle());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            wiggle,
            provider_status,
            get_config,
            dismiss,
            summon
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
