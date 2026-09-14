import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCosting } from "../api.js";
import { fmtDayShort } from "../dates.js";
import FuelDayPicker from "../components/FuelDayPicker.jsx";
import { SkelKpiStrip } from "../components/Skeleton.jsx";

// Costing tab — turns the fuel telemetry into money.
//
//   LEFT  · what the truck actually did over the period (MEASURED from telemetry):
//           litres burned, working hours, and the working vs off-task fuel-rate
//           bands.
//   RIGHT · a job-quote estimator. The measured p25..p75 fuel-rate bands feed a
//           LOW–HIGH quote range; you supply a hypothetical job's hours plus your
//           own fuel price and labour rate.
//
// The quote maths below is a faithful JS mirror of the backend pure core
// (revive/plugins/fleet_costing/service.py: job_quote / quote_band), so the
// range recomputes instantly as you type — nothing round-trips to the server.
//
// Honesty (see CLAUDE.md #3): fuel is a SIMULATED demo channel, so the whole tab
// is sample data; the quote is always a RANGE, never a single figure dressed up
// as fact; and price/labour are YOUR assumptions, not derived from telemetry —
// which is why the currency is a display-only choice and the maths is
// currency-agnostic.

// --- JS mirror of service.job_quote / service.quote_band --------------------
function jobQuote(workH, travelH, workingRate, offtaskRate, price, labourRate) {
  const fuel = workH * workingRate * price + travelH * offtaskRate * price;
  const labour = (workH + travelH) * labourRate;
  return { fuel, labour, total: fuel + labour };
}

function quoteBand(workH, travelH, workingBand, offtaskBand, price, labourRate) {
  if (!workingBand || !offtaskBand || workingBand[0] == null || offtaskBand[0] == null)
    return null;
  return {
    low: jobQuote(workH, travelH, workingBand[0], offtaskBand[0], price, labourRate),
    high: jobQuote(workH, travelH, workingBand[1], offtaskBand[1], price, labourRate),
  };
}

// Display-only currency choices — the maths never assumes a symbol.
const CURRENCIES = ["€", "£", "$"];

// A number field that keeps its raw string while editing (so you can clear it
// and type) but hands the parent a clamped, non-negative number.
function NumField({ label, value, onChange, step = "1", min = "0" }) {
  return (
    <div className="cost-field">
      <label>{label}</label>
      <input className="cost-input" type="number" inputMode="decimal"
        step={step} min={min} value={value}
        onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function MeasuredCard({ label, value, unit, sub }) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">
        {value} <span className="kpi-unit">{unit}</span>
      </div>
      <div className="kpi-delta">{sub}</div>
    </div>
  );
}

const num = (n, d = 0) =>
  n == null ? "—" : Number(n).toLocaleString("en-GB", { maximumFractionDigits: d });

export default function CostingPage({ vehicleId, vehicle }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  // Which days feed the measured fuel cost. null until data loads; an effect
  // then defaults it to none selected — a clean slate the user picks from (and
  // resets on vehicle switch). A Set of "YYYY-MM-DD" strings.
  const [selectedDays, setSelectedDays] = useState(null);

  // Estimator inputs. Kept as strings so the fields stay freely editable; parsed
  // to numbers (NaN -> 0) only when feeding the quote maths.
  const [cur, setCur] = useState("€");
  const [price, setPrice] = useState("1.50");     // fuel, per litre
  const [labour, setLabour] = useState("50");     // per hour
  const [workH, setWorkH] = useState("8");        // hypothetical job: working hours
  const [travelH, setTravelH] = useState("2");    // hypothetical job: travel/idle hours

  useEffect(() => {
    if (!vehicleId) return;
    let live = true;
    setData(null);
    getCosting(vehicleId)
      .then((d) => live && (setData(d), setErr(null)))
      .catch((e) => live && setErr(String(e)));
    return () => { live = false; };
  }, [vehicleId]);

  // Start with no days selected each time new data arrives (e.g. after a vehicle
  // switch), so the user builds the measured cost up from an explicit choice.
  useEffect(() => {
    setSelectedDays(data?.litres?.buckets ? new Set() : null);
  }, [data]);

  const n = (s) => { const v = parseFloat(s); return Number.isFinite(v) && v >= 0 ? v : 0; };
  const money = (v) => cur + num(v, 0);
  // The per-litre fuel price keeps 2 decimals (€1.50, not a rounded €2).
  const priceStr = cur + n(price).toFixed(2);

  const hasFuel = data?.has_fuel_data;
  const band = hasFuel
    ? quoteBand(n(workH), n(travelH), data.rates.working.band, data.rates.offtask.band, n(price), n(labour))
    : null;
  const rejects = data?.litres?.rejects?.length ?? 0;

  // Per-day litres and the measured cost of the currently-selected days. Falls
  // back to an empty selection for the render before the selection effect runs.
  const buckets = data?.litres?.buckets ?? [];
  const sel = selectedDays ?? new Set();
  const selectedLitres = buckets.reduce((s, b) => (sel.has(b.bucket) ? s + b.litres : s), 0);
  const measuredCost = hasFuel ? selectedLitres * n(price) : null;
  const allSelected = hasFuel && buckets.length > 0 && sel.size === buckets.length;

  const rangeLabel = data?.range?.start
    ? `${fmtDayShort(data.range.start)} → ${fmtDayShort(data.range.end)}`
    : t("costing.rangeFullHistory");

  return (
    <>
      <div className="panel gps-pending">
        <div className="usage-head">
          <h2 style={{ margin: 0 }}>
            {t("costing.title")}
            {vehicle?.name && <span className="stamp">{vehicle.name}</span>}
          </h2>
        </div>
        <div className="mnt-note">{t("costing.measuredNote")}</div>

        {err ? (
          <div className="err">{err}</div>
        ) : data == null ? (
          <SkelKpiStrip count={4} />
        ) : !hasFuel ? (
          <div className="empty">{t("costing.noFuelData")}</div>
        ) : (
          <div className="kpi-strip">
            <MeasuredCard label={t("costing.measured.fuelBurned.label")} value={num(data.litres.litres, 0)} unit="L"
              sub={t("costing.measured.fuelBurned.sub", { range: rangeLabel })} />
            <MeasuredCard label={t("costing.measured.workingHours.label")} value={num(data.working_hours, 1)} unit="h"
              sub={t("costing.measured.workingHours.sub")} />
            <MeasuredCard label={t("costing.measured.workingFuelRate.label")} value={num(data.rates.working.avg, 1)} unit="L/h"
              sub={t("costing.measured.workingFuelRate.sub", { low: num(data.rates.working.band[0], 1), high: num(data.rates.working.band[1], 1) })} />
            <MeasuredCard label={t("costing.measured.offtaskFuelRate.label")} value={num(data.rates.offtask.avg, 1)} unit="L/h"
              sub={t("costing.measured.offtaskFuelRate.sub", { low: num(data.rates.offtask.band[0], 1), high: num(data.rates.offtask.band[1], 1) })} />
          </div>
        )}
      </div>

      {data != null && !err && hasFuel && (
        <div className="grid g2">
          <div className="col">
            <div className="panel gps-pending">
              <div className="usage-head">
                <h2 style={{ margin: 0 }}>{t("costing.estimator.title")}</h2>
              </div>
              <div className="cost-form">
                <div className="cost-field">
                  <label>{t("costing.estimator.currency")}</label>
                  <select className="cost-select" value={cur} onChange={(e) => setCur(e.target.value)}>
                    {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <NumField label={t("costing.estimator.fuelPrice", { cur })} value={price} onChange={setPrice} step="0.01" />
                <NumField label={t("costing.estimator.labourRate", { cur })} value={labour} onChange={setLabour} step="1" />
                <NumField label={t("costing.estimator.workingHours")} value={workH} onChange={setWorkH} step="0.5" />
                <NumField label={t("costing.estimator.travelIdleHours")} value={travelH} onChange={setTravelH} step="0.5" />
              </div>

              {band ? (
                <div className="cost-quote">
                  <div className="cost-quote-label">{t("costing.estimator.estimatedCost")}</div>
                  <div className="cost-quote-range">{money(band.low.total)} – {money(band.high.total)}</div>
                  <div className="cost-quote-break">
                    {t("costing.estimator.lowBreakdown", { fuel: money(band.low.fuel), labour: money(band.low.labour) })}<br />
                    {t("costing.estimator.highBreakdown", { fuel: money(band.high.fuel), labour: money(band.high.labour) })}
                  </div>
                </div>
              ) : (
                <div className="empty">{t("costing.estimator.notEnoughData")}</div>
              )}

              <div className="cost-note">{t("costing.estimator.note")}</div>
            </div>
          </div>

          <div className="col">
            <div className="panel gps-pending">
              <div className="usage-head">
                <h2 style={{ margin: 0 }}>{t("costing.measuredCost.title")}</h2>
              </div>
              <div className="cost-quote compact">
                <div className="cost-quote-label">
                  {allSelected
                    ? t("costing.measuredCost.actualBurnedRange", { range: rangeLabel, price: priceStr })
                    : t("costing.measuredCost.actualBurnedDays", { count: sel.size, price: priceStr })}
                </div>
                <div className="cost-quote-range">{money(measuredCost)}</div>
                <div className="cost-quote-break">
                  {t("costing.measuredCost.measuredBreakdown", { litres: num(selectedLitres, 0), sel: sel.size, total: buckets.length })}
                  {rejects > 0 && <> {t("costing.measuredCost.corruptDiscarded", { count: rejects })}</>}
                </div>
              </div>

              <FuelDayPicker
                days={buckets.map((b) => ({ iso: b.bucket, litres: b.litres }))}
                selected={sel}
                onChange={setSelectedDays} />

              <div className="cost-note">{t("costing.measuredCost.note")}</div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
