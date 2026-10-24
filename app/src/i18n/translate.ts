export type AppLocale = "en" | "zh-CN";
export type LocalePreference = "system" | AppLocale;

const HAN_TEXT = /[\u3400-\u9fff]/u;

function safeResolvedSystemLocale() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return "zh-CN";
  }
}

export function resolveSupportedLocale(
  locale: string | null | undefined,
): AppLocale {
  return locale?.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function resolveLocalePreference(
  preference: LocalePreference,
  systemLocale = safeResolvedSystemLocale(),
): AppLocale {
  return preference === "system"
    ? resolveSupportedLocale(systemLocale)
    : preference;
}

export function isLocalePreference(value: unknown): value is LocalePreference {
  return value === "system" || value === "zh-CN" || value === "en";
}

let currentLocale: AppLocale = "en";

export function setCurrentLocale(locale: AppLocale) {
  currentLocale = locale;
}

export function getCurrentLocale() {
  return currentLocale;
}

/**
 * Keeps useful language-neutral upstream errors, while preventing hard-coded
 * implementation copy from leaking into a page. Product copy is rendered only
 * through the explicit page fallback MessageKey supplied by each call site.
 */
export function localizedErrorMessage(
  error: unknown,
  fallback: string,
  _locale: AppLocale = currentLocale,
): string {
  const source =
    error instanceof Error && error.message.trim() ? error.message : fallback;
  return HAN_TEXT.test(source) ? fallback : source;
}
