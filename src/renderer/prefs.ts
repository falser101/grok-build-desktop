export type LocalePref = "system" | "en" | "zh";
export type ThemePref = "system" | "dark" | "light";
export type ResolvedLocale = "en" | "zh";
export type ResolvedTheme = "dark" | "light";

export interface UserPrefs {
  locale: LocalePref;
  theme: ThemePref;
}

const STORAGE_KEY = "grok-desktop-prefs";

export const DEFAULT_PREFS: UserPrefs = {
  locale: "system",
  theme: "system",
};

function isLocalePref(v: unknown): v is LocalePref {
  return v === "system" || v === "en" || v === "zh";
}

function isThemePref(v: unknown): v is ThemePref {
  return v === "system" || v === "dark" || v === "light";
}

export function loadPrefs(): UserPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<UserPrefs>;
    return {
      locale: isLocalePref(parsed.locale) ? parsed.locale : DEFAULT_PREFS.locale,
      theme: isThemePref(parsed.theme) ? parsed.theme : DEFAULT_PREFS.theme,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: UserPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore quota / private mode
  }
}

/** OS UI language (independent of user override). */
export function detectSystemLocale(): ResolvedLocale {
  const lang =
    typeof navigator !== "undefined" ? navigator.language || "en" : "en";
  return lang.toLowerCase().startsWith("zh") ? "zh" : "en";
}

/** OS color scheme (independent of user override). */
export function detectSystemTheme(systemDark?: boolean): ResolvedTheme {
  const dark =
    systemDark ??
    (typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  return dark ? "dark" : "light";
}

export function resolveLocale(pref: LocalePref): ResolvedLocale {
  if (pref === "en" || pref === "zh") return pref;
  return detectSystemLocale();
}

export function resolveTheme(
  pref: ThemePref,
  systemDark?: boolean,
): ResolvedTheme {
  if (pref === "dark" || pref === "light") return pref;
  return detectSystemTheme(systemDark);
}

export function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function applyLocale(locale: ResolvedLocale): void {
  document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
}

/** Call once before first paint to reduce theme flash. */
export function bootstrapAppearance(): void {
  const prefs = loadPrefs();
  applyTheme(resolveTheme(prefs.theme));
  applyLocale(resolveLocale(prefs.locale));
}
