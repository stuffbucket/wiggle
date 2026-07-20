use serde::Serialize;

/// One line of the source text plus Wiggle's verdict on it.
#[derive(Serialize)]
struct Line {
    /// Zero-based index of this line in the original text.
    index: usize,
    /// The line's text, verbatim.
    text: String,
    /// True when Wiggle judges this line would change what you do.
    matters: bool,
}

/// Analyze a passage and decide, line by line, what actually matters.
///
/// This is the heart of Wiggle: for each line it asks "would this change what
/// you do?" — keep it if yes, gray it out if no.
///
/// For now this is a deterministic placeholder heuristic so the app runs end to
/// end. Swap the body of `line_matters` for a real model call (see the Anthropic
/// SDK / `reqwest` to an LLM) when wiring up the actual intelligence.
#[tauri::command]
fn wiggle(text: &str) -> Vec<Line> {
    text.lines()
        .enumerate()
        .map(|(index, raw)| Line {
            index,
            text: raw.to_string(),
            matters: line_matters(raw),
        })
        .collect()
}

/// Placeholder for the model. Flags a line as "matters" when it carries the
/// kind of signal a human would act on — a decision, a deadline, a number, a
/// name, an ask. Real Wiggle replaces this with an AI that twists the meaning
/// and tests whether it changes your next move.
fn line_matters(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return false;
    }

    const SIGNALS: [&str; 14] = [
        "must", "need", "deadline", "by ", "due", "decision", "decide", "action",
        "blocker", "risk", "approve", "ship", "@", "?",
    ];

    let lower = trimmed.to_lowercase();
    let has_signal = SIGNALS.iter().any(|s| lower.contains(s));
    let has_number = trimmed.chars().any(|c| c.is_ascii_digit());

    has_signal || has_number
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![wiggle])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
