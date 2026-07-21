import { expect, test } from "bun:test";
import { markSeed, strikePath } from "./strike";

test("strikePath produces a non-empty SVG path", () => {
  const d = strikePath(0, 220, 10, markSeed(0, 0, 1));
  expect(d.startsWith("M")).toBe(true);
  expect(d.length).toBeGreaterThan(20);
});

test("markSeed is stable per (block,line,nonce) but varies across them", () => {
  expect(markSeed(0, 0, 1)).toBe(markSeed(0, 0, 1));
  expect(markSeed(0, 0, 1)).not.toBe(markSeed(1, 0, 1));
  expect(markSeed(0, 0, 1)).not.toBe(markSeed(0, 1, 1));
  expect(markSeed(0, 0, 1)).not.toBe(markSeed(0, 0, 2));
});

test("different seeds yield different strokes (unique marks)", () => {
  const a = strikePath(0, 220, 10, markSeed(0, 0, 1));
  const b = strikePath(0, 220, 10, markSeed(1, 0, 1));
  expect(a).not.toBe(b);
});
