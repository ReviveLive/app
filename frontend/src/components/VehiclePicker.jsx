import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

// Vehicle switcher, replacing a plain <select>: a native select can't show
// a dot on every option while open but a plain name when closed - the closed
// box always mirrors the selected option's exact text, so if the option said
// "🟢 Warrior 75" the closed box would too. A custom button + list is the
// only way to have the two differ.
const cleanName = (v) => v.name?.replace(/\s*no\.\s*/i, " ");

export default function VehiclePicker({ vehicles, vehicleId, onChange, isLive }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = vehicles.find((v) => v.vehicle_id === vehicleId);
  // Alphabetical (numeric-aware, so "Warrior 70" sorts before "Warrior 102")
  // - list order only, doesn't touch which vehicle is selected. The selected
  // vehicle persists across reloads regardless (see App.jsx's VEHICLE_KEY),
  // so it no longer matters which vehicle a growing fleet happens to put
  // first in the raw API order.
  const sorted = [...vehicles].sort((a, b) =>
    (cleanName(a) || a.vehicle_id).localeCompare(cleanName(b) || b.vehicle_id, undefined, { numeric: true })
  );

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
    <div className="vehicle-pick" ref={ref}>
      <button type="button" className="truck-select" aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}>
        {current ? cleanName(current) : t("app.selectVehicle")}
      </button>
      {open && (
        <ul className="vehicle-pick-list" role="listbox">
          {sorted.map((v) => (
            <li key={v.vehicle_id} role="option" aria-selected={v.vehicle_id === vehicleId}>
              <button type="button"
                className={"vehicle-pick-opt" + (v.vehicle_id === vehicleId ? " active" : "")}
                onClick={() => { onChange(v.vehicle_id); setOpen(false); }}>
                <span className={"vehicle-dot " + (isLive(v) ? "live" : "offline")} aria-hidden="true" />
                {cleanName(v)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
