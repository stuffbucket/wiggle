//! Screen targeting: which monitor the overlay should appear on.
//!
//! We pick the screen under the mouse cursor (a reliable proxy for "the monitor
//! the user is looking at") and fall back to the main screen. All coordinates
//! are AppKit global space (bottom-left origin, points).

use objc2_app_kit::{NSEvent, NSScreen};
use objc2_foundation::{MainThreadMarker, NSPoint, NSRect, NSSize};

/// The full frame of the screen under the cursor (global coords, bottom-left).
pub fn target_screen_frame(mtm: MainThreadMarker) -> NSRect {
    let mouse = NSEvent::mouseLocation();
    let screens = NSScreen::screens(mtm);
    let count = screens.count();
    for i in 0..count {
        let screen = screens.objectAtIndex(i);
        let frame = screen.frame();
        if contains(frame, mouse) {
            return frame;
        }
    }
    if let Some(main) = NSScreen::mainScreen(mtm) {
        return main.frame();
    }
    NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(1440.0, 900.0))
}

fn contains(r: NSRect, p: NSPoint) -> bool {
    p.x >= r.origin.x
        && p.x <= r.origin.x + r.size.width
        && p.y >= r.origin.y
        && p.y <= r.origin.y + r.size.height
}
