//! The overlay panel: convert the "main" window into a non-activating NSPanel
//! that covers the target monitor, floats above everything (including other
//! apps' fullscreen spaces), and never steals focus. The dim scrim and the
//! bottom-centered card are drawn by the webview in CSS, so the native layer
//! only handles panel behavior + screen targeting.

use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_nspanel::{
    tauri_panel, CollectionBehavior, ManagerExt, PanelLevel, StyleMask, WebviewWindowExt,
};

use crate::macos::screen;

tauri_panel! {
    panel!(WigglePanel {
        config: {
            can_become_key_window: true,
            is_floating_panel: true
        }
    })
}

/// Convert the "main" window into the Wiggle overlay panel. Called once at setup.
pub fn install(window: &WebviewWindow) -> Result<(), String> {
    let panel = window.to_panel::<WigglePanel>().map_err(|e| e.to_string())?;

    // Non-activating: the panel can become key (accept typing) without activating
    // our app or demoting the app the user was in.
    panel.set_style_mask(StyleMask::empty().nonactivating_panel().value());
    // Float above almost everything — including full-screen apps.
    panel.set_level(PanelLevel::ScreenSaver.value());
    panel.set_collection_behavior(
        CollectionBehavior::new()
            .can_join_all_spaces()
            .full_screen_auxiliary()
            .stationary()
            .value(),
    );
    panel.set_floating_panel(true);
    Ok(())
}

/// Show the overlay: size it to cover the screen under the cursor, order it
/// front, and make it key so the input can receive keystrokes.
pub fn summon(app: &AppHandle) -> Result<(), String> {
    let mtm = objc2_foundation::MainThreadMarker::new()
        .ok_or("summon must run on the main thread")?;
    let frame = screen::target_screen_frame(mtm);
    let panel = app
        .get_webview_panel("main")
        .map_err(|e| format!("{e:?}"))?;

    // No set_frame on the Panel trait; drop to the raw NSPanel for positioning.
    let ns_panel = panel.as_panel();
    unsafe {
        let _: () = objc2::msg_send![ns_panel, setFrame: frame, display: true];
    }
    panel.show_and_make_key();
    Ok(())
}

/// Hide the overlay.
pub fn dismiss(app: &AppHandle) {
    if let Ok(panel) = app.get_webview_panel("main") {
        panel.hide();
    }
}
