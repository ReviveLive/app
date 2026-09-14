import { useTranslation } from "react-i18next";

// Current Status — a snapshot of what the vehicle is doing right now, from
// its last-known reading of the four real on/off signals (see sketches in
// dev/status/, Joe 2026-09-12). The grid always renders (Joe, 2026-09-12) -
// a vehicle with none of these tags at all (the older demo fleet has no
// per-pump on/off channels) just shows all four grey, same as an offline
// vehicle does, rather than a separate "no data" message replacing them.
//
// Four-way top status (Joe, 2026-09-12, Idle segment added 2026-09-14). The
// leftmost segment is always lit, unlike the other three - it reads Offline
// (red) when the vehicle hasn't reported within the same staleness window
// that drives the topbar's own Live/Offline badge (`isLive` - lifted from
// App.jsx rather than re-defined here, so the two always agree), and Live
// (green) otherwise (Joe, 2026-09-14: a live vehicle needs to visibly read
// as live here too, not just up in the topbar crumb). Travelling/Idle/
// Working never highlight while offline, since none of them are actually
// known right now, just last-known. Working (purple) only when
// PTO AND at least one pump (vac/jet/rec) are BOTH on - matches pumps.js's
// own "PTO time = working (>=1 pump) + idle (PTO on, no pump)" split, not
// just PTO alone. Travelling (green) requires actual movement evidence -
// scania_vehicle_speed_revlive > 0, the same real speed signal
// poll_netbiter.py's own movement-state check already uses (Joe: PTO-off
// alone isn't proof of travelling, the truck could just be parked) - NOT
// simply "online and not working". Idle (orange) is PTO-on-but-not-working:
// online, PTO on, no pump running, not moving (Joe, 2026-09-14: Idle is
// NOT just "online and doing nothing" - PTO off with nothing else going on
// lights no right-hand segment at all, only the always-on Live/Offline one
// on the left; Idle specifically means the PTO's engaged but no pump has
// picked up yet).
//
// The four indicator dots mirror the same online-awareness: grey whenever
// offline (never a confident colour for a stale reading), and while online,
// VAC/JET/REC go grey/purple on their own raw on/off value (not gated on
// PTO - a pump's own dot answers "is this pump running", not "is the
// vehicle working" as a whole). PTO's own dot answers a three-way question
// instead of a plain on/off one (Joe, 2026-09-14): grey when PTO itself is
// off, green when PTO is on by itself (matches a real state - PTO active,
// no pump running yet), purple only once a pump also comes on, i.e. once
// `working` is true - PTO-on alone isn't "working" on its own. This is
// intentionally independent of the top pill's Travelling segment (real
// vehicle movement) - PTO can be on while stationary, that's still a real
// "PTO active" state worth a green dot, not grey.
const INDICATORS = [
  { key: "pto", param: "pto_on_revlive" },
  { key: "vac", param: "vac_pump_on_revlive" },
  { key: "jet", param: "jetting_pump_on_revlive" },
  { key: "rec", param: "recycling_on_revlive" },
];

const SPEED_PARAM = "scania_vehicle_speed_revlive";

export default function StatusPanel({ readings, isLive }) {
  const { t } = useTranslation();
  const isOn = (param) => readings?.[param]?.value === 1;
  const offline = isLive === false;
  const ptoOn = isOn("pto_on_revlive");
  const anyPumpOn = isOn("vac_pump_on_revlive") || isOn("jetting_pump_on_revlive") || isOn("recycling_on_revlive");
  const speed = readings?.[SPEED_PARAM]?.value;
  const moving = speed != null && speed > 0;
  const working = !offline && ptoOn && anyPumpOn;
  const travelling = !offline && !working && moving;
  const idle = !offline && !working && !travelling && ptoOn && !anyPumpOn;

  return (
    <div className="panel status-panel">
      <div className="usage-head">
        <div className="panel-head" style={{ margin: 0 }}>{t("overview.currentStatus.title")}</div>
        <div className="status-segpill">
          <span className={"seg active " + (offline ? "offline" : "live")}>
            {offline ? t("overview.currentStatus.segments.offline") : t("overview.currentStatus.segments.live")}
          </span>
          <span className={"seg travel" + (travelling ? " active" : "")}>{t("overview.currentStatus.segments.travelling")}</span>
          <span className={"seg idle" + (idle ? " active" : "")}>{t("overview.currentStatus.segments.idle")}</span>
          <span className={"seg work" + (working ? " active" : "")}>{t("overview.currentStatus.segments.working")}</span>
        </div>
      </div>
      <div className="status-ind-grid">
        {INDICATORS.map((i) => {
          const raw = isOn(i.param);
          const cls = offline
            ? ""
            : i.key === "pto"
              ? (!raw ? "" : anyPumpOn ? "on" : "pto-travel")
              : (raw ? "on" : "");
          return (
            <div className="status-ind" key={i.key}>
              <span className={"status-ind-dot" + (cls ? " " + cls : "")} />
              <span className="status-ind-label">{t(`overview.currentStatus.indicators.${i.key}`)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
