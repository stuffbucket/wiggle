import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en/common.json";
import es from "./locales/es/common.json";
import de from "./locales/de/common.json";
import fr from "./locales/fr/common.json";
import ptBR from "./locales/pt-BR/common.json";
import it from "./locales/it/common.json";
import ja from "./locales/ja/common.json";
import ko from "./locales/ko/common.json";
import zhHans from "./locales/zh-Hans/common.json";
import zhHant from "./locales/zh-Hant/common.json";
import ru from "./locales/ru/common.json";
import hi from "./locales/hi/common.json";

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

const resources = {
  en: { common: en },
  es: { common: es },
  de: { common: de },
  fr: { common: fr },
  "pt-BR": { common: ptBR },
  it: { common: it },
  ja: { common: ja },
  ko: { common: ko },
  "zh-Hans": { common: zhHans },
  "zh-Hant": { common: zhHant },
  ru: { common: ru },
  hi: { common: hi },
};

/// Map an arbitrary BCP-47 tag to one of our supported locales. Chinese is
/// resolved by script (not region), and Portuguese collapses to pt-BR.
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

i18n.use(initReactI18next).init({
  resources,
  lng: "en",
  fallbackLng: "en",
  ns: ["common"],
  defaultNS: "common",
  supportedLngs: SUPPORTED as unknown as string[],
  nonExplicitSupportedLngs: true,
  interpolation: { escapeValue: false },
});

export default i18n;
