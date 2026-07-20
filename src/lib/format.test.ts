import { expect, test } from "bun:test";
import { abToBase64, humanSize } from "./format";

test("humanSize picks B / KB / MB", () => {
  expect(humanSize(512)).toBe("512 B");
  expect(humanSize(2048)).toBe("2 KB");
  expect(humanSize(5 * 1024 * 1024)).toBe("5.0 MB");
});

test("abToBase64 encodes bytes", () => {
  const bytes = new Uint8Array([104, 105]); // "hi"
  expect(abToBase64(bytes.buffer)).toBe("aGk=");
});

test("abToBase64 handles the empty buffer", () => {
  expect(abToBase64(new Uint8Array([]).buffer)).toBe("");
});
