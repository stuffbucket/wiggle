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
    AppHandle, Emitter,
};
// Only the Windows/Linux fallback reaches for get_webview_window via Manager.
#[cfg(not(target_os = "macos"))]
use tauri::Manager;

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

/// Wiggle an image (dropped/pasted screenshot) via the provider's vision path.
#[tauri::command]
async fn wiggle_image(mime: String, data: String) -> Result<Vec<WiggleBlock>, String> {
    let settings = Settings::load();
    match provider::discover(&settings).await {
        Some(p) => engine::wiggle_image(&p, &mime, &data).await,
        None => Err("no-provider".into()),
    }
}

/// Read and classify a dropped file path (text / image / other).
#[tauri::command]
fn ingest_path(path: String) -> Result<ingest::Ingested, String> {
    ingest::ingest_path(&path)
}

/// Current model-provider status (which local backend, if any, is reachable).
#[tauri::command]
async fn provider_status() -> ProviderStatus {
    ProviderStatus::probe().await
}

/// Models the active provider offers (for the picker).
#[tauri::command]
async fn list_models() -> Result<Vec<String>, String> {
    let s = Settings::load();
    match provider::discover(&s).await {
        Some(p) => provider::list_models(&p).await,
        None => Err("no-provider".into()),
    }
}

/// Persist the chosen model on whichever provider is active.
#[tauri::command]
async fn set_model(model: String) -> Result<(), String> {
    let mut s = Settings::load();
    match provider::discover(&s).await {
        Some(p) => match p.kind {
            provider::ProviderKind::Ollama => s.ollama.model = model,
            provider::ProviderKind::Maximal => s.maximal.model = model,
        },
        None => s.maximal.model = model,
    }
    s.save().map_err(|e| e.to_string())
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

/// Absolute path to settings.json (created with defaults if missing) so the UI
/// can open it in the user's editor.
#[tauri::command]
fn settings_path() -> String {
    Settings::ensure_on_disk();
    settings::config_path().to_string_lossy().to_string()
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

/// Relocalize the tray menu (called by the UI once i18n resolves the language).
#[tauri::command]
fn set_tray_labels(
    app: AppHandle,
    summon: String,
    update: String,
    quit: String,
) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("wiggle-tray") {
        let s = MenuItem::with_id(&app, "summon", &summon, true, None::<&str>)
            .map_err(|e| e.to_string())?;
        let u = MenuItem::with_id(&app, "update", &update, true, None::<&str>)
            .map_err(|e| e.to_string())?;
        let q =
            MenuItem::with_id(&app, "quit", &quit, true, None::<&str>).map_err(|e| e.to_string())?;
        let menu = Menu::with_items(&app, &[&s, &u, &q]).map_err(|e| e.to_string())?;
        tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    }
    Ok(())
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
        use tauri_plugin_positioner::{Position, WindowExt};
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.move_window(Position::BottomCenter);
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

/// Check for an update; if one is available, download, install, and relaunch.
/// A no-op (Ok) when up to date or when no release/manifest is reachable.
#[cfg(desktop)]
async fn run_update(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|e| e.to_string())?;
    if let Some(update) = updater.check().await.map_err(|e| e.to_string())? {
        update
            .download_and_install(|_chunk, _total| {}, || {})
            .await
            .map_err(|e| e.to_string())?;
        app.restart();
    }
    Ok(())
}

// ---- tray -------------------------------------------------------------------

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let summon_i = MenuItem::with_id(app, "summon", "Summon Wiggle", true, None::<&str>)?;
    let update_i = MenuItem::with_id(app, "update", "Check for Updates…", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit Wiggle", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&summon_i, &update_i, &quit_i])?;

    // Dedicated monochrome template glyph (system tints it for light/dark/active),
    // not the full-color app icon.
    let tray_icon = tauri::image::Image::from_bytes(include_bytes!(
        "../icons/tray/wiggleTemplate.png"
    ))
    .expect("bundled tray template icon");

    TrayIconBuilder::with_id("wiggle-tray")
        .icon(tray_icon)
        .icon_as_template(true)
        .tooltip("Wiggle")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "summon" => {
                let _ = summon_overlay(app);
            }
            "update" => {
                #[cfg(desktop)]
                {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = run_update(app).await {
                            eprintln!("wiggle: update check failed: {e}");
                        }
                    });
                }
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

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init());

    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_nspanel::init());
    }

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    // Windows/Linux have no NSPanel; summon a normal window via a chord and
    // position it with the positioner plugin.
    #[cfg(not(target_os = "macos"))]
    {
        use tauri_plugin_global_shortcut::ShortcutState;
        builder = builder
            .plugin(tauri_plugin_positioner::init())
            .plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_shortcut("CmdOrCtrl+Space")
                    .expect("valid global shortcut")
                    .with_handler(|app, _shortcut, event| {
                        if event.state == ShortcutState::Pressed {
                            let _ = summon_overlay(app);
                        }
                    })
                    .build(),
            );
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
                let mut last: Option<bool> = Some(false);
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
        .invoke_handler(tauri::generate_handler![
            wiggle,
            wiggle_image,
            ingest_path,
            provider_status,
            list_models,
            set_model,
            get_config,
            settings_path,
            dismiss,
            summon,
            set_tray_labels
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
