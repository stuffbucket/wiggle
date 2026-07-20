import { expect, test } from "bun:test";
import { normalizeLocale } from "./locale";

test("resolves Chinese by script, not region", () => {
  expect(normalizeLocale("zh")).toBe("zh-Hans");
  expect(normalizeLocale("zh-CN")).toBe("zh-Hans");
  expect(normalizeLocale("zh-SG")).toBe("zh-Hans");
  expect(normalizeLocale("zh-TW")).toBe("zh-Hant");
  expect(normalizeLocale("zh-HK")).toBe("zh-Hant");
  expect(normalizeLocale("zh-Hant")).toBe("zh-Hant");
});

test("collapses Portuguese to pt-BR and strips region tags", () => {
  expect(normalizeLocale("pt-PT")).toBe("pt-BR");
  expect(normalizeLocale("pt-BR")).toBe("pt-BR");
  expect(normalizeLocale("fr-CA")).toBe("fr");
  expect(normalizeLocale("en-US")).toBe("en");
  expect(normalizeLocale("de")).toBe("de");
});

test("falls back to en for unknown or empty", () => {
  expect(normalizeLocale("xx")).toBe("en");
  expect(normalizeLocale("")).toBe("en");
});
