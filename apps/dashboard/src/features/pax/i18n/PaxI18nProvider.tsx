import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import {
  detectPaxLocale,
  intlLocaleFor,
  paxMessage,
  type PaxLocale,
  type PaxMessageKey,
  type PaxTranslate,
} from "./locales";

type PaxI18n = {
  locale: PaxLocale;
  intlLocale: string;
  t: PaxTranslate;
};

const PaxI18nContext = createContext<PaxI18n | null>(null);

function isPassengerPath(pathname: string): boolean {
  const path = (pathname || "/").toLowerCase();
  return path === "/pax" || path.startsWith("/pax/") || path === "/arrival" || path.startsWith("/arrival/");
}

export function PaxI18nProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const locale = useMemo(() => detectPaxLocale(), []);
  const intlLocale = intlLocaleFor(locale);
  const t = useMemo<PaxTranslate>(
    () => (key: PaxMessageKey, vars?: Record<string, string | number>) => paxMessage(locale, key, vars),
    [locale],
  );

  useEffect(() => {
    if (!isPassengerPath(pathname)) return;
    const html = document.documentElement;
    const prevLang = html.getAttribute("lang");
    const prevDir = html.getAttribute("dir");
    html.lang = locale;
    html.dir = locale === "ar" ? "rtl" : "ltr";
    return () => {
      if (prevLang == null) html.removeAttribute("lang");
      else html.lang = prevLang;
      if (prevDir == null) html.removeAttribute("dir");
      else html.dir = prevDir;
    };
  }, [locale, pathname]);

  const value = useMemo(() => ({ locale, intlLocale, t }), [locale, intlLocale, t]);
  return <PaxI18nContext.Provider value={value}>{children}</PaxI18nContext.Provider>;
}

export function usePaxI18n(): PaxI18n {
  const ctx = useContext(PaxI18nContext);
  if (ctx) return ctx;
  const locale = detectPaxLocale();
  return {
    locale,
    intlLocale: intlLocaleFor(locale),
    t: (key, vars) => paxMessage(locale, key, vars),
  };
}

export function usePaxT(): PaxTranslate {
  return usePaxI18n().t;
}

export function usePaxLocale(): PaxLocale {
  return usePaxI18n().locale;
}
