import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LOCALES, setLocale } from "../i18n.js";

// Language dropdown (Joe, 2026-09-14) - replaces the earlier button-row
// toggle, which only ever worked for two or three languages side by side
// before running out of room (see ga-IE.json, the third). Same custom-
// dropdown pattern as VehiclePicker.jsx: a closed trigger showing just the
// current code, an open list showing every language's own native name next
// to its code, closing on an outside click or Escape. Scales to however many
// locales LOCALES ends up with (English/French/Irish now; UK/NZ/AU English
// variants and Danish/Swedish are expected later) with no further UI change.
export default function LanguageToggle() {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = LOCALES.find((l) => l.code === i18n.language) || LOCALES[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="lang-pick" ref={ref}>
      <button type="button" className="truck-select lang-select" aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}>
        {current.label}
      </button>
      {open && (
        <ul className="lang-pick-list" role="listbox">
          {LOCALES.map((l) => (
            <li key={l.code} role="option" aria-selected={l.code === i18n.language}>
              <button type="button"
                className={"lang-pick-opt" + (l.code === i18n.language ? " active" : "")}
                onClick={() => { setLocale(l.code); setOpen(false); }}>
                <span>{l.name}</span>
                <span className="lang-pick-code">{l.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
