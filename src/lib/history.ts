/// Shell-like history navigation predicates, kept pure (they read only a
/// caret snapshot) so the tricky clean-vs-"selected" logic is unit-testable.
///
/// Rule (from the user): when the prompt is empty/clean, Up/Down scroll history
/// like bash. Once the input is edited, or the caret has moved into the middle
/// (a range is selected, or a multiline caret isn't at the very top/bottom),
/// Up/Down do normal caret motion and must NOT scroll history.

export type Caret = {
  selectionStart: number;
  selectionEnd: number;
  value: string;
};

export const atStart = (c: Caret) =>
  c.selectionStart === 0 && c.selectionEnd === 0;

export const atEnd = (c: Caret) =>
  c.selectionStart === c.value.length && c.selectionEnd === c.value.length;

export const hasRange = (c: Caret) => c.selectionStart !== c.selectionEnd;

export const multiline = (c: Caret) => c.value.includes("\n");

/// ArrowUp recalls an older entry only from a clean buffer whose caret is at the
/// top. On a single line there's no "line above", so top-or-bottom both count.
export function wantsHistoryUp(c: Caret, dirty: boolean): boolean {
  if (dirty || hasRange(c)) return false;
  return multiline(c) ? atStart(c) : atStart(c) || atEnd(c);
}

/// ArrowDown moves toward the live draft only from a clean buffer whose caret is
/// at the bottom.
export function wantsHistoryDown(c: Caret, dirty: boolean): boolean {
  if (dirty || hasRange(c)) return false;
  return multiline(c) ? atEnd(c) : atStart(c) || atEnd(c);
}

/// Per-block reveal delays: filler blocks fade out top-to-bottom, staggered, but
/// the whole reveal is clamped so long results still finish fast (< ~400ms).
export function fillerDelays(
  verdicts: boolean[], // true = matters (kept), false = filler
  { cap = 380, dur = 220, base = 40 } = {},
): number[] {
  const fillerIdx = verdicts
    .map((m, i) => (m ? -1 : i))
    .filter((i) => i >= 0);
  const stagger =
    fillerIdx.length > 1
      ? Math.min(base, (cap - dur) / (fillerIdx.length - 1))
      : base;
  const delays = new Array(verdicts.length).fill(0);
  fillerIdx.forEach((idx, order) => {
    delays[idx] = Math.round(order * stagger);
  });
  return delays;
}
