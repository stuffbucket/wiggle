//! Global double-tap-Ctrl hotkey via an NSEvent global monitor.
//!
//! `tauri-plugin-global-shortcut` can't express "tap the same modifier twice",
//! so we watch `flagsChanged` events globally. A global monitor is observe-only
//! and does not fire while our own app is key — which is exactly right: we want
//! to summon from *other* apps, and while the overlay is up the user is typing,
//! not summoning. Requires the app to be granted Input Monitoring / Accessibility.

use std::cell::Cell;
use std::ptr::NonNull;
use std::time::{Duration, Instant};

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags};

/// Install the monitor. `on_summon` fires when Ctrl is tapped twice within
/// `window_ms`. Returns the monitor token (keep it alive for the app's lifetime);
/// `None` means the OS refused the monitor (permission not yet granted).
pub fn install<F>(window_ms: u64, on_summon: F) -> Option<Retained<AnyObject>>
where
    F: Fn() + 'static,
{
    let gap = Duration::from_millis(window_ms.max(120));
    // Main-thread-only state; a global monitor always delivers on the main thread.
    let last_press: Cell<Option<Instant>> = Cell::new(None);
    let ctrl_was_down: Cell<bool> = Cell::new(false);

    let block = RcBlock::new(move |event: NonNull<NSEvent>| {
        let event: &NSEvent = unsafe { event.as_ref() };
        let flags = event.modifierFlags();
        let ctrl = flags.contains(NSEventModifierFlags::Control);
        let others = flags.contains(NSEventModifierFlags::Command)
            || flags.contains(NSEventModifierFlags::Option)
            || flags.contains(NSEventModifierFlags::Shift);

        // Only the rising edge of a *pure* Ctrl press counts as a tap.
        if ctrl && !ctrl_was_down.get() && !others {
            let now = Instant::now();
            let doubled = last_press
                .get()
                .map_or(false, |prev| now.duration_since(prev) <= gap);
            if doubled {
                last_press.set(None);
                on_summon();
            } else {
                last_press.set(Some(now));
            }
        }
        ctrl_was_down.set(ctrl);
    });

    NSEvent::addGlobalMonitorForEventsMatchingMask_handler(NSEventMask::FlagsChanged, &block)
}
