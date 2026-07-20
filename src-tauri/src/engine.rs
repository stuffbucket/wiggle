//! The wiggle engine.
//!
//! Wiggle "wiggles every block in a tower of thought": it perturbs the meaning
//! of each block and asks whether that changes what you'd do. Borrowing
//! Stryker's mutation-testing logic — a mutant that changes the outcome is
//! *killed* (the block MATTERS); a mutant nothing depends on *survives* (the
//! block is FILLER). We ask the model to make that judgement for every block in
//! one structured call (interactive latency beats N per-block round trips), with
//! a clean seam to go true per-block later.

use crate::provider::{self, Part, Resolved};
use serde::{Deserialize, Serialize};

/// One block of the source plus Wiggle's verdict.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WiggleBlock {
    /// Zero-based index in the original text (blank lines included).
    pub index: usize,
    /// The block's text, verbatim.
    pub text: String,
    /// True when mutating/removing this block would change what you do.
    pub matters: bool,
}

const SYSTEM: &str = "\
You are Wiggle. You read a passage and keep only what won't budge. For each \
numbered block, mentally mutate its meaning (negate it, soften it, delete it) \
and decide: would that change what the reader does next? A block MATTERS when it \
carries a decision, deadline, number, name, ask, constraint, or commitment — \
something an action depends on. A block is FILLER when it could be negated or \
removed without changing any action (pleasantries, recap, hedging, throat-clearing). \
Respond with ONLY a compact JSON array, one object per block you were given, \
each exactly {\"i\": <index>, \"matters\": <true|false>}. No prose, no code fence.";

/// Wiggle a passage of text. Returns one `WiggleBlock` per source line (blank
/// lines are preserved as non-mattering spacers).
pub async fn wiggle_text(resolved: &Resolved, text: &str) -> Result<Vec<WiggleBlock>, String> {
    // Segment the tower. Keep every line (blanks included) so the reading view
    // preserves the original shape.
    let lines: Vec<&str> = text.lines().collect();
    let mut blocks: Vec<WiggleBlock> = lines
        .iter()
        .enumerate()
        .map(|(index, raw)| WiggleBlock {
            index,
            text: (*raw).to_string(),
            matters: false,
        })
        .collect();

    // Only non-blank lines are worth judging.
    let judged: Vec<(usize, &str)> = lines
        .iter()
        .enumerate()
        .filter(|(_, l)| !l.trim().is_empty())
        .map(|(i, l)| (i, *l))
        .collect();

    if judged.is_empty() {
        return Ok(blocks);
    }

    let mut prompt = String::from("Blocks:\n");
    for (i, line) in &judged {
        prompt.push_str(&format!("[{i}] {line}\n"));
    }

    let raw = provider::complete(resolved, SYSTEM, &[Part::Text(prompt)], 1024).await?;
    let verdicts = parse_verdicts(&raw);

    for v in verdicts {
        if let Some(b) = blocks.get_mut(v.i) {
            b.matters = v.matters;
        }
    }
    Ok(blocks)
}

/// Wiggle an image (screenshot). The model reads it and returns the meaningful
/// content as verdicted blocks, so an image collapses onto the same reading view
/// as text.
pub async fn wiggle_image(
    resolved: &Resolved,
    media_type: &str,
    base64: &str,
) -> Result<Vec<WiggleBlock>, String> {
    const IMAGE_SYSTEM: &str = "\
You are Wiggle. Read the image and transcribe its meaningful content as short \
blocks. For each block decide whether it MATTERS (an action depends on it: a \
decision, deadline, number, name, ask, constraint) or is FILLER (removable \
without changing any action). Respond with ONLY a compact JSON array, each \
object exactly {\"text\": <string>, \"matters\": <true|false>}. No prose, no code fence.";

    let parts = vec![
        Part::Image {
            media_type: media_type.to_string(),
            base64: base64.to_string(),
        },
        Part::Text("Wiggle this image.".into()),
    ];
    let raw = provider::complete(resolved, IMAGE_SYSTEM, &parts, 2048).await?;
    let items = parse_text_verdicts(&raw);
    Ok(items
        .into_iter()
        .enumerate()
        .map(|(index, (text, matters))| WiggleBlock {
            index,
            text,
            matters,
        })
        .collect())
}

#[derive(Deserialize)]
struct IndexVerdict {
    i: usize,
    #[serde(default)]
    matters: bool,
}

/// Pull `[{ "i": n, "matters": bool }]` out of a model response, tolerating code
/// fences or surrounding prose by slicing to the outermost array.
fn parse_verdicts(raw: &str) -> Vec<IndexVerdict> {
    slice_json_array(raw)
        .and_then(|s| serde_json::from_str::<Vec<IndexVerdict>>(s).ok())
        .unwrap_or_default()
}

fn parse_text_verdicts(raw: &str) -> Vec<(String, bool)> {
    #[derive(Deserialize)]
    struct TextVerdict {
        #[serde(default)]
        text: String,
        #[serde(default)]
        matters: bool,
    }
    slice_json_array(raw)
        .and_then(|s| serde_json::from_str::<Vec<TextVerdict>>(s).ok())
        .map(|v| v.into_iter().map(|t| (t.text, t.matters)).collect())
        .unwrap_or_default()
}

/// Return the substring from the first `[` to the last `]`, inclusive.
fn slice_json_array(raw: &str) -> Option<&str> {
    let start = raw.find('[')?;
    let end = raw.rfind(']')?;
    if end > start {
        Some(&raw[start..=end])
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_verdict_array() {
        let v = parse_verdicts(r#"[{"i":0,"matters":true},{"i":1,"matters":false}]"#);
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].i, 0);
        assert!(v[0].matters);
        assert!(!v[1].matters);
    }

    #[test]
    fn parses_fenced_and_prose_wrapped() {
        let raw = "Sure:\n```json\n[{\"i\":2,\"matters\":true}]\n```\ndone";
        let v = parse_verdicts(raw);
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].i, 2);
        assert!(v[0].matters);
    }

    #[test]
    fn missing_matters_defaults_false() {
        let v = parse_verdicts(r#"[{"i":0}]"#);
        assert_eq!(v.len(), 1);
        assert!(!v[0].matters);
    }

    #[test]
    fn malformed_yields_empty() {
        assert!(parse_verdicts("no json here").is_empty());
        assert!(parse_verdicts("").is_empty());
        assert!(parse_verdicts("{not an array}").is_empty());
    }

    #[test]
    fn slices_outermost_array() {
        assert_eq!(slice_json_array("x[1,2]y"), Some("[1,2]"));
        assert_eq!(slice_json_array("nope"), None);
        assert_eq!(slice_json_array("]["), None); // end before start
    }

    #[test]
    fn parses_image_text_verdicts() {
        let v = parse_text_verdicts(
            r#"[{"text":"Ship Monday","matters":true},{"text":"thanks","matters":false}]"#,
        );
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].0, "Ship Monday");
        assert!(v[0].1);
        assert!(!v[1].1);
    }
}

