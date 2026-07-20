/// Locale normalization, kept pure and dependency-free so it's easy to test.

export const SUPPORTED = [
  "en",
  "es",
  "de",
  "fr",
  "pt-BR",
  "it",
  "ja",
  "ko",
  "zh-Hans",
  "zh-Hant",
  "ru",
  "hi",
] as const;

/// Map an arbitrary BCP-47 tag to one of our supported locales. Chinese is
/// resolved by script (not region), Portuguese collapses to pt-BR, and anything
/// unknown falls back to English.
export function normalizeLocale(tag: string): string {
  if (!tag) return "en";
  const lower = tag.toLowerCase();
  if (lower.startsWith("zh")) {
    if (
      lower.includes("hant") ||
      lower.includes("tw") ||
      lower.includes("hk") ||
      lower.includes("mo")
    ) {
      return "zh-Hant";
    }
    return "zh-Hans";
  }
  if (lower.startsWith("pt")) return "pt-BR";
  const exact = SUPPORTED.find((s) => s.toLowerCase() === lower);
  if (exact) return exact;
  const base = lower.split("-")[0];
  const byBase = SUPPORTED.find((s) => s.toLowerCase().split("-")[0] === base);
  return byBase ?? "en";
}
