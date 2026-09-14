import { useTranslation } from "react-i18next";

// The Daily / Weekly / Monthly grain switch, shared by every time-series card so
// the four copies stay identical. Props: { grain, onChange }.
const GRAINS = ["day", "week", "month"];

export default function GrainToggle({ grain, onChange }) {
  const { t } = useTranslation();
  return (
    <div className="toggle">
      {GRAINS.map((g) => (
        <button key={g} className={grain === g ? "active" : ""}
          onClick={() => onChange(g)}>{t(`common.grain.${g}`)}</button>
      ))}
    </div>
  );
}
