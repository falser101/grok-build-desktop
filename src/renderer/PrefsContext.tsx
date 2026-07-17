import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getMessages, type Messages } from "./i18n";
import {
  applyLocale,
  applyTheme,
  detectSystemLocale,
  detectSystemTheme,
  loadPrefs,
  resolveLocale,
  resolveTheme,
  savePrefs,
  type LocalePref,
  type ResolvedLocale,
  type ResolvedTheme,
  type ThemePref,
  type UserPrefs,
} from "./prefs";

interface PrefsContextValue {
  prefs: UserPrefs;
  /** Effective locale after applying user pref (or system). */
  resolvedLocale: ResolvedLocale;
  /** Effective theme after applying user pref (or system). */
  resolvedTheme: ResolvedTheme;
  /** Real OS locale, always from navigator (for "System" labels). */
  systemLocale: ResolvedLocale;
  /** Real OS theme, always from prefers-color-scheme (for "System" labels). */
  systemTheme: ResolvedTheme;
  messages: Messages;
  setLocale: (locale: LocalePref) => void;
  setTheme: (theme: ThemePref) => void;
}

const PrefsContext = createContext<PrefsContextValue | null>(null);

function useSystemDark(): boolean {
  const [dark, setDark] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : true,
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return dark;
}

function useSystemLocaleTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const onChange = () => setTick((t) => t + 1);
    window.addEventListener("languagechange", onChange);
    return () => window.removeEventListener("languagechange", onChange);
  }, []);
  return tick;
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<UserPrefs>(() => loadPrefs());
  const systemDark = useSystemDark();
  const localeTick = useSystemLocaleTick();

  const systemLocale = useMemo(() => {
    void localeTick;
    return detectSystemLocale();
  }, [localeTick]);

  const systemTheme = useMemo(
    () => detectSystemTheme(systemDark),
    [systemDark],
  );

  const resolvedLocale = useMemo(
    () => resolveLocale(prefs.locale),
    [prefs.locale, systemLocale],
  );

  const resolvedTheme = useMemo(
    () => resolveTheme(prefs.theme, systemDark),
    [prefs.theme, systemDark],
  );

  const messages = useMemo(
    () => getMessages(resolvedLocale),
    [resolvedLocale],
  );

  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    applyLocale(resolvedLocale);
  }, [resolvedLocale]);

  const commit = useCallback((next: UserPrefs) => {
    setPrefs(next);
    savePrefs(next);
  }, []);

  const setLocale = useCallback(
    (locale: LocalePref) => {
      commit({ ...prefs, locale });
    },
    [prefs, commit],
  );

  const setTheme = useCallback(
    (theme: ThemePref) => {
      commit({ ...prefs, theme });
    },
    [prefs, commit],
  );

  const value = useMemo(
    () => ({
      prefs,
      resolvedLocale,
      resolvedTheme,
      systemLocale,
      systemTheme,
      messages,
      setLocale,
      setTheme,
    }),
    [
      prefs,
      resolvedLocale,
      resolvedTheme,
      systemLocale,
      systemTheme,
      messages,
      setLocale,
      setTheme,
    ],
  );

  return (
    <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>
  );
}

export function usePrefs(): PrefsContextValue {
  const ctx = useContext(PrefsContext);
  if (!ctx) {
    throw new Error("usePrefs must be used within PrefsProvider");
  }
  return ctx;
}
