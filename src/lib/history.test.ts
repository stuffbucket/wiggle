import { expect, test } from "bun:test";
import {
  fillerDelays,
  wantsHistoryDown,
  wantsHistoryUp,
  type Caret,
} from "./history";

const caret = (value: string, start = 0, end = start): Caret => ({
  value,
  selectionStart: start,
  selectionEnd: end,
});

test("empty clean prompt: both arrows scroll history", () => {
  const c = caret("");
  expect(wantsHistoryUp(c, false)).toBe(true);
  expect(wantsHistoryDown(c, false)).toBe(true);
});

test("dirty buffer never scrolls history", () => {
  const c = caret("", 0, 0);
  expect(wantsHistoryUp(c, true)).toBe(false);
  expect(wantsHistoryDown(c, true)).toBe(false);
});

test("a selection range never scrolls history", () => {
  const c = caret("hello", 0, 5);
  expect(wantsHistoryUp(c, false)).toBe(false);
  expect(wantsHistoryDown(c, false)).toBe(false);
});

test("single line clean: up/down scroll from either end", () => {
  const c = caret("abc", 3, 3); // caret at end
  expect(wantsHistoryUp(c, false)).toBe(true);
  expect(wantsHistoryDown(c, false)).toBe(true);
});

test("multiline: up only from the very top, down only from the very bottom", () => {
  const top = caret("line1\nline2", 0, 0);
  expect(wantsHistoryUp(top, false)).toBe(true);
  expect(wantsHistoryDown(top, false)).toBe(false); // not at bottom → caret move

  const bottom = caret("line1\nline2", 11, 11);
  expect(wantsHistoryUp(bottom, false)).toBe(false); // not at top → caret move
  expect(wantsHistoryDown(bottom, false)).toBe(true);

  const middle = caret("line1\nline2", 5, 5);
  expect(wantsHistoryUp(middle, false)).toBe(false);
  expect(wantsHistoryDown(middle, false)).toBe(false);
});

test("fillerDelays: kept blocks get 0, filler staggers, clamped under cap", () => {
  // matters pattern: [kept, filler, kept, filler, filler]
  const d = fillerDelays([true, false, true, false, false]);
  expect(d[0]).toBe(0); // kept
  expect(d[2]).toBe(0); // kept
  expect(d[1]).toBe(0); // first filler
  expect(d[3]).toBe(40); // second filler
  expect(d[4]).toBe(80); // third filler
});

test("fillerDelays compresses stagger for many filler blocks", () => {
  const verdicts = new Array(50).fill(false); // all filler
  const d = fillerDelays(verdicts);
  const last = d[d.length - 1];
  expect(last).toBeLessThanOrEqual(380 - 220 + 1); // total stays under the cap
});
