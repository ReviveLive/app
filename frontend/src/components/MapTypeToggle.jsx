// Map / Satellite basemap switch, overlaid on each Overview map. Mirrors
// GrainToggle so it matches the app's other segmented switches. Props:
// { value: "map" | "satellite", onChange }.
const TYPES = [["map", "Map"], ["satellite", "Satellite"]];

export default function MapTypeToggle({ value, onChange }) {
  return (
    <div className="toggle map-toggle">
      {TYPES.map(([k, label]) => (
        <button key={k} className={value === k ? "active" : ""}
          onClick={() => onChange(k)}>{label}</button>
      ))}
    </div>
  );
}
