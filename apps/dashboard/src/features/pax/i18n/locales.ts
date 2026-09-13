import { en, type PaxMessageKey, type PaxMessages } from "./messages/en";
import { ar } from "./messages/ar";
import { de } from "./messages/de";
import { es } from "./messages/es";
import { fr } from "./messages/fr";
import { ja } from "./messages/ja";
import { ko } from "./messages/ko";
import { ru } from "./messages/ru";
import { zh } from "./messages/zh";

export type { PaxMessageKey, PaxMessages };

export const PAX_LOCALES = ["zh", "en", "fr", "ru", "es", "ar", "de", "ja", "ko"] as const;
export type PaxLocale = (typeof PAX_LOCALES)[number];

const INTL_LOCALES: Record<PaxLocale, string> = {
  zh: "zh-CN",
  en: "en-US",
  fr: "fr-FR",
  ru: "ru-RU",
  es: "es-ES",
  ar: "ar",
  de: "de-DE",
  ja: "ja-JP",
  ko: "ko-KR",
};

export const dictionaries: Record<PaxLocale, PaxMessages> = {
  zh,
  en,
  fr,
  ru,
  es,
  ar,
  de,
  ja,
  ko,
};

export function detectPaxLocale(languages?: string | readonly string[] | null): PaxLocale {
  const first = firstLanguageTag(languages);
  const prefix = first.toLowerCase().split(/[-_]/)[0] || "";
  if ((PAX_LOCALES as readonly string[]).includes(prefix)) return prefix as PaxLocale;
  return "en";
}

function firstLanguageTag(languages?: string | readonly string[] | null): string {
  if (typeof languages === "string" && languages.trim()) return languages.trim();
  if (Array.isArray(languages) && languages.length && languages[0]) return String(languages[0]);
  if (typeof navigator !== "undefined") {
    const list = navigator.languages?.length ? navigator.languages : [navigator.language];
    if (list[0]) return String(list[0]);
  }
  return "en";
}

export function intlLocaleFor(locale: PaxLocale): string {
  return INTL_LOCALES[locale];
}

export function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = vars[name];
    return value == null ? `{${name}}` : String(value);
  });
}

export function paxMessage(
  locale: PaxLocale | undefined,
  key: PaxMessageKey,
  vars?: Record<string, string | number>,
): string {
  const loc = locale && locale in dictionaries ? locale : "en";
  const table = dictionaries[loc];
  const text = table[key] || dictionaries.en[key] || key;
  return interpolate(text, vars);
}

export type PaxTranslate = (key: PaxMessageKey, vars?: Record<string, string | number>) => string;

export function paxErrorMessage(t: PaxTranslate, code: string): string {
  const key = `error.${code}` as PaxMessageKey;
  const label = t(key);
  if (label !== key) return label;
  return code || t("error.generic");
}
