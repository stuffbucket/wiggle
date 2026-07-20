// Guards against translation drift: every locale must carry exactly the same
// keys as English and preserve interpolation placeholders.
import { expect, test } from "bun:test";
import { SUPPORTED } from "./locale";

import en from "../locales/en/common.json";
import es from "../locales/es/common.json";
import de from "../locales/de/common.json";
import fr from "../locales/fr/common.json";
import ptBR from "../locales/pt-BR/common.json";
import it from "../locales/it/common.json";
import ja from "../locales/ja/common.json";
import ko from "../locales/ko/common.json";
import zhHans from "../locales/zh-Hans/common.json";
import zhHant from "../locales/zh-Hant/common.json";
import ru from "../locales/ru/common.json";
import hi from "../locales/hi/common.json";

type Catalog = Record<string, unknown>;
const catalogs: Record<string, Catalog> = {
  en,
  es,
  de,
  fr,
  "pt-BR": ptBR,
  it,
  ja,
  ko,
  "zh-Hans": zhHans,
  "zh-Hant": zhHant,
  ru,
  hi,
};

function keys(obj: Catalog, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object"
      ? keys(v as Catalog, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

const enKeys = keys(en).sort();

test("ships a catalog for every supported locale", () => {
  for (const loc of SUPPORTED) {
    expect(catalogs[loc], `missing catalog for ${loc}`).toBeDefined();
  }
});

for (const loc of SUPPORTED) {
  test(`${loc} has the same keys as en`, () => {
    expect(keys(catalogs[loc]).sort()).toEqual(enKeys);
  });
}

test("every locale preserves the verdict interpolation placeholders", () => {
  for (const loc of SUPPORTED) {
    const trimmed = (catalogs[loc] as { verdict: { trimmed: string } }).verdict
      .trimmed;
    expect(trimmed, `${loc} verdict.trimmed missing {{filler}}`).toContain(
      "{{filler}}",
    );
    expect(trimmed, `${loc} verdict.trimmed missing {{total}}`).toContain(
      "{{total}}",
    );
    expect(trimmed, `${loc} verdict.trimmed missing {{kept}}`).toContain(
      "{{kept}}",
    );
  }
});
