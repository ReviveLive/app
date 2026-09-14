// Localisation setup. One import (see main.jsx) initialises i18next before
// the app renders; every component then reads strings via useTranslation()'s
// t() instead of hardcoding English.
//
// Locale files live in src/locales/<locale>.json, one per deployment
// language. Add a new one there and to LOCALES below - LanguageToggle picks
// it up automatically, nothing else needs to change to support it.
//
// A translation left as an empty string ("") is a deliberate placeholder -
// "not decided yet", not "blank on purpose" - e.g. fr-FR.json's PTO/VAC/JET/
// REC labels, which may need to match whatever's physically printed on the
// truck's own control panel rather than a dictionary translation, Joe
// 2026-09-12. returnEmptyString: false (below) makes i18next treat an empty
// string as MISSING and fall through to fallbackLng automatically, so a
// blank entry always shows in English rather than rendering nothing - fill
// it in whenever that call gets made, no code change needed either way.
//
// Locale is a per-deployment default (VITE_LOCALE, e.g. "fr-FR" for
// Veolia's build) but switchable at runtime via LanguageToggle in the
// topbar - a visitor's explicit choice is remembered (localStorage, same
// pattern as the dark-mode toggle) and wins over the deployment default
// until they pick differently.
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enIE from "./locales/en-IE.json";
import frFR from "./locales/fr-FR.json";
import gaIE from "./locales/ga-IE.json";
import daDK from "./locales/da-DK.json";
import svSE from "./locales/sv-SE.json";
import deDE from "./locales/de-DE.json";

// `label` is the short code shown on the closed dropdown trigger; `name` is
// the language's own native name (never translated - a French speaker still
// reads "English" as English, not "Anglais"), shown alongside `label` in the
// open list so an unfamiliar code (e.g. "GA") isn't the only clue.
//
// en-GB/en-AU/en-NZ (Joe, 2026-09-14) exist as blank locale files in
// src/locales/ - every key is "", falling through to en-IE automatically
// via returnEmptyString: false - but are deliberately NOT registered here
// yet, to avoid cluttering the switcher with three entries that read
// identically to English today. Wire them into a future regional-English
// picker (in Settings, once that exists) rather than this general-purpose
// LanguageToggle - re-add their imports/resources entries at that point.
export const LOCALES = [
  { code: "en-IE", label: "EN", name: "English" },
  { code: "fr-FR", label: "FR", name: "Français" },
  { code: "ga-IE", label: "GA", name: "Gaeilge" },
  { code: "da-DK", label: "DA", name: "Dansk" },
  { code: "sv-SE", label: "SV", name: "Svenska" },
  { code: "de-DE", label: "DE", name: "Deutsch" },
];

const LOCALE_KEY = "revive-locale";
const DEPLOYMENT_DEFAULT = import.meta.env.VITE_LOCALE || "en-IE";

function initialLocale() {
  try {
    const saved = localStorage.getItem(LOCALE_KEY);
    if (saved && LOCALES.some((l) => l.code === saved)) return saved;
  } catch { /* localStorage unavailable (e.g. private mode) - fall through */ }
  return DEPLOYMENT_DEFAULT;
}

i18n.use(initReactI18next).init({
  resources: {
    "en-IE": { translation: enIE },
    "fr-FR": { translation: frFR },
    "ga-IE": { translation: gaIE },
    "da-DK": { translation: daDK },
    "sv-SE": { translation: svSE },
    "de-DE": { translation: deDE },
  },
  lng: initialLocale(),
  fallbackLng: "en-IE",
  interpolation: { escapeValue: false }, // React already escapes - avoid double-escaping
  returnEmptyString: false, // an empty-string translation falls back to English rather than rendering blank
});

// Keep <html lang> in sync with the active language. This is NOT read by our
// own React tree (that goes through t()) - it's what the BROWSER'S OWN native
// UI (an <input type="date">'s calendar popup, its "Clear"/"Today" strings,
// spell-check, screen readers) uses to decide what language to render itself
// in. index.html hardcoded lang="en" and nothing ever updated it (Joe,
// 2026-09-14: the native date-picker calendar still showed English weekdays
// under French/Irish) - i18next has no hook into that on its own, so this is
// wired up by hand: once now, since init() already resolved a language
// before this line runs, and again on every future change.
document.documentElement.lang = i18n.language;
i18n.on("languageChanged", (lng) => { document.documentElement.lang = lng; });

// Switch language at runtime and remember the visitor's explicit choice -
// used by LanguageToggle.
export function setLocale(code) {
  i18n.changeLanguage(code);
  try { localStorage.setItem(LOCALE_KEY, code); } catch { /* private mode etc. - just won't persist */ }
}

export default i18n;
