import * as SecureStore from "expo-secure-store";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";

import {
  type AppLocale,
  type LocalePreference,
  isLocalePreference,
  resolveLocalePreference,
  setCurrentLocale,
} from "./translate.ts";
import {
  translateMessage,
  type MessageKey,
  type MessageValues,
} from "./messages.ts";

const LANGUAGE_PREFERENCE_KEY = "boltpocket.language-preference.v2";
const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

type I18nContextValue = Readonly<{
  locale: AppLocale;
  preference: LocalePreference;
  ready: boolean;
  storageError: MessageKey | null;
  setPreference: (preference: LocalePreference) => Promise<void>;
  t: (key: MessageKey, values?: MessageValues) => string;
}>;

const I18nContext = createContext<I18nContextValue | null>(null);

function readSystemLocale() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return "zh-CN";
  }
}

export function I18nProvider({ children }: PropsWithChildren) {
  const [preference, setPreferenceState] = useState<LocalePreference>("en");
  const preferenceRef = useRef(preference);
  const [systemLocale, setSystemLocale] = useState(readSystemLocale);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<MessageKey | null>(null);
  const locale = resolveLocalePreference(preference, systemLocale);

  useEffect(() => {
    setCurrentLocale(locale);
  }, [locale]);

  useEffect(() => {
    let active = true;
    void SecureStore.getItemAsync(LANGUAGE_PREFERENCE_KEY, secureStoreOptions)
      .then((stored) => {
        if (!active) return;
        const nextPreference = isLocalePreference(stored)
          ? stored
          : preferenceRef.current;
        if (isLocalePreference(stored)) {
          preferenceRef.current = stored;
          setPreferenceState(stored);
        }
        setCurrentLocale(
          resolveLocalePreference(nextPreference, readSystemLocale()),
        );
        setStorageError(null);
      })
      .catch(() => {
        if (active) {
          setCurrentLocale(
            resolveLocalePreference(preferenceRef.current, readSystemLocale()),
          );
          setStorageError("settings.language.readFailed");
        }
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && preferenceRef.current === "system") {
        setSystemLocale(readSystemLocale());
      }
    });
    return () => subscription.remove();
  }, []);

  const setPreference = useCallback(
    async (next: LocalePreference) => {
      const previous = preferenceRef.current;
      preferenceRef.current = next;
      setPreferenceState(next);
      setCurrentLocale(resolveLocalePreference(next, systemLocale));
      try {
        await SecureStore.setItemAsync(
          LANGUAGE_PREFERENCE_KEY,
          next,
          secureStoreOptions,
        );
        setStorageError(null);
      } catch {
        preferenceRef.current = previous;
        setPreferenceState(previous);
        setCurrentLocale(resolveLocalePreference(previous, systemLocale));
        const message = translateMessage(
          "settings.language.saveFailed",
          resolveLocalePreference(previous, systemLocale),
        );
        setStorageError("settings.language.saveFailed");
        throw new Error(message);
      }
    },
    [systemLocale],
  );

  const t = useCallback(
    (key: MessageKey, values?: MessageValues) =>
      translateMessage(key, locale, values),
    [locale],
  );
  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      preference,
      ready,
      storageError,
      setPreference,
      t,
    }),
    [locale, preference, ready, setPreference, storageError, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
