import PumpUtilisation from "../components/PumpUtilisation.jsx";
import PumpTimeline from "../components/PumpTimeline.jsx";
import PumpActivityBars from "../components/PumpActivityBars.jsx";
import PumpActivitySingle from "../components/PumpActivitySingle.jsx";
import PumpUsage from "../components/PumpUsage.jsx";
import PumpTrend from "../components/PumpTrend.jsx";
import PumpActivationLog from "../components/PumpActivationLog.jsx";

// PTO/pump detail — the same utilisation panel shown on Overview, plus a
// timeline chart showing the exact on/off transitions for one day (Overview
// only has room for the aggregate percentages), plus the working-vs-idle
// trend over time (already built and verified for real data - previously
// only shown on Trends, added here too since it's exactly what this page's
// audience is asking, 2026-09-11). PumpTrend (per-pump run-time) and
// PumpActivationLog (individual on/off cycles) added 2026-09-12 - both real
// trial vehicle only, same per-pump on/off channel gap PumpTimeline's day
// view already has. PumpActivityBars (2026-09-12) recreates a bar-chart
// view from an earlier project iteration Joe no longer has access to -
// same fetchPumpUsage data PTO Utilisation above already shows, just as
// absolute minutes across several periods instead of one period's share.
// PumpActivitySingle (2026-09-12) recreates a second earlier-iteration
// chart (from a picture, not source) - the same idea filtered to one
// signal at a time instead of all four together.
export default function PumpsPage({ vehicleId, vehicle, fmtTime }) {
  return (
    <div className="canvas">
      <div className="c-6"><PumpUtilisation vehicleId={vehicleId} vehicle={vehicle} /></div>
      <div className="c-6"><PumpTimeline vehicleId={vehicleId} /></div>
      <div className="c-12"><PumpActivityBars vehicleId={vehicleId} vehicle={vehicle} /></div>
      <div className="c-12"><PumpActivitySingle vehicleId={vehicleId} vehicle={vehicle} /></div>
      <div className="c-6"><PumpUsage vehicleId={vehicleId} /></div>
      <div className="c-6"><PumpTrend vehicleId={vehicleId} vehicle={vehicle} /></div>
      <div className="c-12"><PumpActivationLog vehicleId={vehicleId} fmtTime={fmtTime} /></div>
    </div>
  );
}
