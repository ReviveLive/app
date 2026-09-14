import { useEffect, useMemo, useState } from "react";
import { jsPDF } from "jspdf";
import {
  MAINTENANCE_GROUPS, pointByKey, maintenanceStatus, formatPointValue, STATUS_TEXT,
} from "../maintenance.js";
import { getUsage, getLastKnown, getAlerts, getSustainability } from "../api.js";
import { fmtWeek, fmtMonth, fmtDMY, fmtDMYTime } from "../dates.js";
import { estopInfo } from "../alerts.js";

// Emergency-stop event timestamp in the vehicle's own timezone, "DD-MM-YYYY, HH:MM".
const fmtStamp = (iso, tz) => fmtDMYTime(iso, tz);

// Pump + PTO run-minute counters covered by the usage section.
const PUMPS = [
  { key: "PTO Run Minute (min)", label: "PTO" },
  { key: "Vacuum Pump Run Minute (min)", label: "Vacuum" },
  { key: "Jet Pump Run Minute (min)", label: "Jet" },
  { key: "Recycle Pump Run Minute (min)", label: "Recycle" },
];

const SECTIONS = [
  { id: "usage", label: "Usage" },
  { id: "sustainability", label: "Sustainability" },
  { id: "health", label: "Health" },
  { id: "alerts", label: "Alerts" },
];

const litres = (n) => (n == null ? "—" : `${Math.round(n).toLocaleString("en-GB")} L`);
const rate = (n) => (n == null ? "—" : `${n.toFixed(1)} L/h`);
const pct = (n) => (n == null ? "—" : `${Math.round(n)}%`);
const co2t = (kg) => (kg == null ? "—" : `${(kg / 1000).toFixed(2)} t`);

// Sustainability rows, in one place so the HTML preview and the PDF stay in
// step. Each is [label, formatted value] built from the /api/sustainability shape.
const sustainRows = (s) => [
  ["Avg working fuel rate", rate(s?.avg_working_fuel_rate)],
  ["Fuel rate off-task (idle or driving)", rate(s?.avg_offtask_fuel_rate)],
  ["Utilisation (engine time on task)", pct(s?.utilisation_pct)],
  ["Fuel used", litres(s?.fuel_used_litres)],
  ["Estimated CO₂", co2t(s?.co2_kg)],
  ["Water collected", litres(s?.water_collected_litres)],
  ["Water recycled", litres(s?.water_recycled_litres)],
  ["Water recovered (recycled ÷ collected)", pct(s?.recycling_rate_pct)],
];

const cleanName = (n) => (n || "Vehicle").replace(/\s*no\.\s*/i, " ");

// jsPDF's built-in Helvetica only covers WinAnsi/Latin-1, so a Unicode subscript
// like ₂ (U+2082) isn't encodable — passing it mangles the whole text run (letters
// space out, the glyph turns to junk). The HTML preview renders ₂ fine, so we only
// flatten it to a plain "2" on the strings drawn into the PDF.
const pdfSafe = (t) => String(t).replace(/₂/g, "2");

// Load a same-origin image as a PNG data URL plus its natural size, for embedding
// the logo in the PDF. Resolves null if it can't load so the report still renders.
const loadImage = (src) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext("2d").drawImage(img, 0, 0);
      resolve({ dataUrl: c.toDataURL("image/png"), w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });

// Report palette as RGB triples (mirrors the CSS variables in styles.css). Badge
// tints are the 0.15-alpha status colours flattened onto white, so the printed
// pills match the on-screen ones without needing transparency.
const PDF_COLOR = {
  ink: [30, 41, 59], dim: [71, 85, 105], faint: [100, 116, 139], line: [203, 213, 225],
  green: [20, 176, 83], greenDeep: [14, 138, 64],
};
const PDF_BADGE = {
  green: { bg: [217, 244, 229], fg: [14, 138, 64] },
  amber: { bg: [253, 240, 218], fg: [217, 119, 6] },
  red: { bg: [253, 227, 227], fg: [239, 68, 68] },
  unknown: { bg: [232, 234, 238], fg: [100, 116, 139] },
};

// One print-friendly "Warrior Report" the customer composes from a checklist.
// Pick one or more vehicles and any of Usage (with a week/month toggle), Health
// and Alerts; each selected vehicle gets its own section, page-broken in the PDF.
// Print or download the composed sheet. Read-only, last-known.
export default function ReportDialog({ vehicles, vehicleId, readings, onClose }) {
  const [sel, setSel] = useState(() => (vehicleId ? { [vehicleId]: true } : {}));
  const [include, setInclude] = useState({ usage: true, sustainability: false, health: true, alerts: false });
  const [grain, setGrain] = useState("week");
  // Per-vehicle data: { [vid]: { readings, series: { paramKey: [{bucket, minutes}] } } }.
  // Seed the currently-selected vehicle from props so it renders without a flash.
  const [vdata, setVdata] = useState(() =>
    vehicleId ? { [vehicleId]: { readings: readings || {}, series: {} } } : {});
  const [periodStart, setPeriodStart] = useState(null);
  const [saving, setSaving] = useState(false);

  // "Generated on" date in DD-MM-YYYY, in the viewer's local timezone.
  const generated = fmtDMY(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone);

  // Selected vehicles in the fleet's own order, and a stable key for effect deps.
  const chosen = useMemo(
    () => (vehicles || []).filter((v) => sel[v.vehicle_id]),
    [vehicles, sel]);
  const chosenKey = chosen.map((v) => v.vehicle_id).join(",");
  const anySection = include.usage || include.sustainability || include.health || include.alerts;
  const ready = chosen.length > 0 && anySection;

  // Fetch last-known readings (for Health) and usage buckets (for Usage) for every
  // selected vehicle. Refetches when the selection, grain, or Usage toggle changes.
  useEffect(() => {
    let live = true;
    Promise.all(
      chosen.map(async (v) => {
        const vid = v.vehicle_id;
        const [lk, series, events, sustain] = await Promise.all([
          getLastKnown(vid).then((r) => r.readings).catch(() => ({})),
          include.usage
            ? Promise.all(
                PUMPS.map((p) =>
                  getUsage(p.key, grain, vid).then((r) => [p.key, r.buckets]).catch(() => [p.key, []])
                )
              ).then(Object.fromEntries)
            : Promise.resolve({}),
          include.alerts
            ? getAlerts(vid).then((r) => r.events).catch(() => [])
            : Promise.resolve([]),
          include.sustainability
            ? getSustainability(vid, grain).then((r) => r.buckets).catch(() => [])
            : Promise.resolve([]),
        ]);
        return [vid, { readings: lk, series, events, sustain }];
      })
    ).then((entries) => live && setVdata(Object.fromEntries(entries)));
    return () => { live = false; };
  }, [chosenKey, grain, include.usage, include.alerts, include.sustainability]);

  // The set of usage periods, unioned across every selected vehicle.
  const periods = useMemo(() => {
    const set = new Set();
    Object.values(vdata).forEach((d) => {
      Object.values(d.series || {}).forEach((bs) => bs.forEach((b) => set.add(b.bucket)));
      (d.sustain || []).forEach((b) => set.add(b.bucket));
    });
    return [...set].sort();
  }, [vdata]);
  useEffect(() => { setPeriodStart(periods[periods.length - 1] ?? null); }, [periods]);

  const periodLabel = periodStart
    ? (grain === "week" ? fmtWeek(periodStart) : fmtMonth(periodStart))
    : "—";
  const pi = periods.indexOf(periodStart);

  // Compute the rendered rows for one vehicle's data block.
  const vehicleSections = (d) => {
    const usageRows = PUMPS.map((p) => {
      const b = (d?.series?.[p.key] || []).find((x) => x.bucket === periodStart);
      return { label: p.label, minutes: b ? Math.round(b.minutes) : 0 };
    });
    const healthGroups = MAINTENANCE_GROUPS.map((g) => ({
      title: g.title,
      rows: g.keys.map((key) => {
        const p = pointByKey(key);
        const value = d?.readings?.[key]?.value ?? null;
        return {
          label: p.label,
          reading: formatPointValue(value, p.kind),
          limit: formatPointValue(p.limit, p.kind),
          status: maintenanceStatus(value, p.warn, p.limit),
        };
      }),
    }));
    // The sustainability bucket for the selected period (null if none).
    const sustain = (d?.sustain || []).find((x) => x.bucket === periodStart) || null;
    return { usageRows, healthGroups, sustain };
  };

  const toggleSection = (id) => setInclude((s) => ({ ...s, [id]: !s[id] }));
  const toggleVehicle = (vid) => setSel((s) => ({ ...s, [vid]: !s[vid] }));

  const multi = chosen.length > 1;
  const reportTitle = multi ? "Fleet Report" : "Warrior Report";
  const subjectLabel = chosen.length
    ? chosen.map((v) => cleanName(v.name)).join(", ")
    : "No vehicles selected";

  // Filename built from the report's own subject so saved PDFs are self-describing:
  // single vehicle -> "Warrior-150-Report-2026-06-25.pdf"; fleet -> "Fleet-Report-…".
  const fileName = () => {
    const base = multi ? "Fleet" : cleanName(chosen[0]?.name);
    const safe = base.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
    const iso = new Date().toISOString().slice(0, 10);
    return `${safe}-Report-${iso}.pdf`;
  };

  // Draw the report natively with jsPDF text/vector primitives (not a screenshot):
  // crisp type, a small file, and a proper A4 layout with margins, aligned health
  // tables and coloured status pills. In a fleet report each vehicle gets a page.
  const renderPdf = async () => {
    const pdf = new jsPDF("p", "mm", "a4");
    const PW = pdf.internal.pageSize.getWidth();  // 210
    const PH = pdf.internal.pageSize.getHeight(); // 297
    const ML = 16, MT = 16, MB = 16;              // page margins (mm)
    const RX = PW - ML;                           // right edge of content
    const CW = PW - ML * 2;                       // content width
    const bottom = PH - MB;
    const C = PDF_COLOR;
    let y = MT; // vertical cursor down the page, in mm

    const font = (style, size, color) => {
      pdf.setFont("helvetica", style);
      pdf.setFontSize(size);
      if (color) pdf.setTextColor(color[0], color[1], color[2]);
    };
    const hline = (color, w = 0.2) => {
      pdf.setDrawColor(color[0], color[1], color[2]);
      pdf.setLineWidth(w);
      pdf.line(ML, y, RX, y);
    };
    // Break to a new page if the next block wouldn't fit in what's left.
    const ensure = (h) => { if (y + h > bottom) { pdf.addPage(); y = MT; } };
    // Small spaced uppercase section heading.
    const label = (text) => {
      ensure(9);
      font("bold", 8, C.dim);
      pdf.setCharSpace(0.4);
      pdf.text(text.toUpperCase(), ML, y + 3.2);
      pdf.setCharSpace(0);
      y += 6;
    };

    // Header — logo, title, subject, date, green rule (once, at the top).
    const logo = await loadImage("/logo.png");
    const logoH = 11;
    let tx = ML;
    if (logo) {
      const logoW = logoH * (logo.w / logo.h);
      pdf.addImage(logo.dataUrl, "PNG", ML, y, logoW, logoH);
      tx = ML + logoW + 7;
    }
    font("bold", 19, C.ink);
    pdf.text(reportTitle, tx, y + 5);
    font("bold", 10.5, C.greenDeep);
    const subjLines = pdf.splitTextToSize(subjectLabel, RX - tx);
    pdf.text(subjLines, tx, y + 10.5);
    const afterSubj = y + 10.5 + (subjLines.length - 1) * 4.6;
    font("normal", 9, C.faint);
    pdf.text(`Generated ${generated}`, tx, afterSubj + 4.8);
    y = Math.max(y + logoH, afterSubj + 4.8) + 4;
    hline(C.green, 0.8);
    y += 8;

    // Usage — a label/value list, the minutes right-aligned in green.
    const usageBlock = (usageRows) => {
      label(`Usage — ${grain === "week" ? "week of" : "month of"} ${periodLabel}`);
      usageRows.forEach((r) => {
        ensure(8);
        font("normal", 10.5, C.ink);
        pdf.text(`${r.label} usage`, ML + 1, y + 5);
        font("bold", 11, C.greenDeep);
        pdf.text(`${r.minutes} min`, RX - 1, y + 5, { align: "right" });
        y += 7.5;
        hline(C.line);
      });
      y += 5;
    };

    // Sustainability — energy & water savings. A label/value list like Usage,
    // with a caption defining "working" and the window the figures cover.
    const sustainBlock = (s) => {
      label(`Sustainability — ${grain === "week" ? "week of" : "month of"} ${periodLabel}`);
      if (!s) {
        ensure(8);
        font("normal", 9.5, C.faint);
        pdf.text("No data for this period.", ML + 1, y + 4);
        y += 9;
        return;
      }
      sustainRows(s).forEach(([l, val]) => {
        ensure(8);
        font("normal", 10.5, C.ink);
        pdf.text(pdfSafe(l), ML + 1, y + 5);
        font("bold", 11, C.greenDeep);
        pdf.text(pdfSafe(val), RX - 1, y + 5, { align: "right" });
        y += 7.5;
        hline(C.line);
      });
      ensure(7);
      font("normal", 8.5, C.faint);
      pdf.text("Working = PTO engaged or a pump running. CO2 estimated at 2.68 kg/L diesel.", ML + 1, y + 4);
      y += 9;
    };

    // A four-column health table with a coloured status pill per row.
    const cRead = ML + 82, cLimit = ML + 112, cStat = ML + 140;
    const healthTable = (title, rows) => {
      label(`Health — ${title}`);
      ensure(7);
      font("bold", 7.5, C.faint);
      pdf.setCharSpace(0.3);
      pdf.text("COMPONENT", ML + 1, y + 3);
      pdf.text("READING", cRead, y + 3);
      pdf.text("LIMIT", cLimit, y + 3);
      pdf.text("STATUS", cStat, y + 3);
      pdf.setCharSpace(0);
      y += 5;
      hline(C.line, 0.4);
      rows.forEach((r) => {
        ensure(8);
        font("normal", 10, C.ink);
        pdf.text(r.label, ML + 1, y + 5.2);
        font("normal", 10, C.dim);
        pdf.text(String(r.reading), cRead, y + 5.2);
        pdf.text(String(r.limit), cLimit, y + 5.2);
        const b = PDF_BADGE[r.status] || PDF_BADGE.unknown;
        const txt = STATUS_TEXT[r.status] || r.status;
        font("bold", 8, b.fg);
        const w = pdf.getTextWidth(txt) + 6;
        pdf.setFillColor(b.bg[0], b.bg[1], b.bg[2]);
        pdf.roundedRect(cStat, y + 1.4, w, 5.6, 2.6, 2.6, "F");
        pdf.text(txt, cStat + 3, y + 5.1);
        y += 8;
        hline(C.line);
      });
      y += 5;
    };

    // Emergency-stop alerts table, or an empty-state line.
    const alertsBlock = (events, tz) => {
      label("Alerts — emergency stops");
      if (!events.length) {
        ensure(8);
        font("normal", 9.5, C.faint);
        pdf.text("No emergency-stop events recorded.", ML + 1, y + 4);
        y += 9;
        return;
      }
      const cCause = ML + 62, cWhen = ML + 122;
      ensure(7);
      font("bold", 7.5, C.faint);
      pdf.setCharSpace(0.3);
      pdf.text("EVENT", ML + 1, y + 3);
      pdf.text("CAUSE", cCause, y + 3);
      pdf.text("WHEN", cWhen, y + 3);
      pdf.setCharSpace(0);
      y += 5;
      hline(C.line, 0.4);
      events.forEach((e) => {
        const info = estopInfo(e.type);
        // Wrap both the event label and the cause to their column widths so a long
        // label can't run into the next column; the row is as tall as the taller cell.
        const eventLines = pdf.splitTextToSize(info.label, cCause - ML - 4);
        const causeLines = pdf.splitTextToSize(info.cause, cWhen - cCause - 4);
        const rowH = Math.max(8, Math.max(eventLines.length, causeLines.length) * 4.6 + 3.2);
        ensure(rowH);
        font("normal", 10, C.ink);
        pdf.text(eventLines, ML + 1, y + 5.2);
        font("normal", 9.5, C.dim);
        pdf.text(causeLines, cCause, y + 5.2);
        pdf.text(fmtStamp(e.ts, tz), cWhen, y + 5.2);
        y += rowH;
        hline(C.line);
      });
      y += 5;
    };

    // Body — one section stack per selected vehicle; fleet vehicles page-break.
    let first = true;
    for (const v of chosen) {
      if (!first) { pdf.addPage(); y = MT; }
      first = false;
      const d = vdata[v.vehicle_id];
      const { usageRows, healthGroups, sustain } = vehicleSections(d);
      if (multi) {
        ensure(10);
        font("bold", 13, C.greenDeep);
        pdf.text(cleanName(v.name), ML, y + 5);
        y += 9;
      }
      if (include.usage) usageBlock(usageRows);
      if (include.sustainability) sustainBlock(sustain);
      if (include.health) healthGroups.forEach((g) => healthTable(g.title, g.rows));
      if (include.alerts) alertsBlock(d?.events || [], v.timezone);
    }

    // Footer note + brand rule.
    ensure(26);
    y += 2;
    font("normal", 8.5, C.faint);
    const note =
      (include.health ? "Note: Health thresholds are placeholders. " : "") +
      (include.sustainability && chosen.some((v) => v.source === "demo")
        ? "Fuel and recycled-water figures are simulated sample data. " : "") +
      "Values are the last known reading from the most recent file. " +
      "Snapshot from a periodic file — not live.";
    const noteLines = pdf.splitTextToSize(note, CW);
    pdf.text(noteLines, ML, y + 3);
    y += noteLines.length * 4.2 + 5;
    hline(C.green, 0.6);
    y += 5.5;
    font("bold", 9, C.greenDeep);
    pdf.text("Revive Live · vehicle telemetry pilot", ML, y);

    // Page numbers, added once the total page count is known.
    const pages = pdf.getNumberOfPages();
    for (let p = 1; p <= pages; p += 1) {
      pdf.setPage(p);
      font("normal", 8, C.faint);
      pdf.text(`Page ${p} of ${pages}`, RX, PH - 8, { align: "right" });
    }
    return pdf;
  };

  // Print the sheet. Like renderPdf, force the light theme first: printing in
  // dark mode gives a dark panel the browser drops, near-white text and mint
  // accents — i.e. a washed-out, colourless page. beforeprint/afterprint restore
  // the on-screen theme once the dialog closes (with an eager toggle for browsers
  // that fire neither event reliably).
  const doPrint = () => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    const before = () => { if (wasDark) root.classList.remove("dark"); };
    const after = () => {
      if (wasDark) root.classList.add("dark");
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    before();
    window.print();
  };

  // One-click download of the PDF.
  const savePdf = async () => {
    if (!ready) return;
    setSaving(true);
    try {
      (await renderPdf()).save(fileName());
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="report-overlay" onClick={onClose}>
      <div className="report-sheet" onClick={(e) => e.stopPropagation()}>
        <button className="report-close no-print" aria-label="Close" onClick={onClose}>×</button>

        <div className="report-head">
          <img className="report-logo" src="/logo.png" alt="Revive Live" />
          <div className="report-title">
            <h1>{reportTitle}</h1>
            <div className="report-meta">
              <span className="report-truck">{subjectLabel}</span>
              <span className="report-date">Generated {generated}</span>
            </div>
          </div>
        </div>

        {/* Configuration — not printed */}
        <div className="report-config no-print">
          <div className="report-fieldgroup">
            <span className="report-fieldlabel">Vehicles</span>
            <div className="report-checklist">
              {(vehicles || []).map((v) => (
                <label key={v.vehicle_id} className={`report-check ${sel[v.vehicle_id] ? "on" : ""}`}>
                  <input type="checkbox" checked={!!sel[v.vehicle_id]}
                    onChange={() => toggleVehicle(v.vehicle_id)} />
                  {cleanName(v.name)}
                </label>
              ))}
            </div>
          </div>

          <div className="report-fieldgroup">
            <span className="report-fieldlabel">Sections</span>
            <div className="report-checklist">
              {SECTIONS.map((s) => (
                <label key={s.id} className={`report-check ${include[s.id] ? "on" : ""}`}>
                  <input type="checkbox" checked={include[s.id]} onChange={() => toggleSection(s.id)} />
                  {s.label}
                </label>
              ))}
            </div>
          </div>

          {(include.usage || include.sustainability) && (
            <div className="report-controls">
              <div className="toggle">
                <button className={grain === "week" ? "active" : ""} onClick={() => setGrain("week")}>Week</button>
                <button className={grain === "month" ? "active" : ""} onClick={() => setGrain("month")}>Month</button>
              </div>
              <div className="route-nav report-nav">
                <button className="navbtn" disabled={pi <= 0} onClick={() => setPeriodStart(periods[pi - 1])}>‹ Prev</button>
                <span className="route-day">{periodLabel}</span>
                <button className="navbtn" disabled={pi < 0 || pi >= periods.length - 1}
                  onClick={() => setPeriodStart(periods[pi + 1])}>Next ›</button>
              </div>
            </div>
          )}
        </div>

        {/* Report body — printed. One block per selected vehicle. */}
        {!chosen.length && <div className="empty">Select at least one vehicle to include.</div>}
        {chosen.length > 0 && !anySection && <div className="empty">Select at least one section to include.</div>}

        {chosen.map((v) => {
          const { usageRows, healthGroups, sustain } = vehicleSections(vdata[v.vehicle_id]);
          return (
            <div className="report-vehicle" key={v.vehicle_id}>
              {multi && <h2 className="report-vehicle-name">{cleanName(v.name)}</h2>}

              {include.usage && (
                <div className="report-group">
                  <h2>Usage — {grain === "week" ? "week of" : "month of"} {periodLabel}</h2>
                  <ul className="usage-report-list">
                    {usageRows.map((r) => (
                      <li key={r.label}>
                        <span className="ur-label">{r.label} usage:</span>
                        <span className="ur-val">{r.minutes} min</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {include.sustainability && (
                <div className="report-group">
                  <h2>Sustainability — {grain === "week" ? "week of" : "month of"} {periodLabel}</h2>
                  {!sustain ? (
                    <p className="report-foot" style={{ marginTop: 0 }}>No data for this period.</p>
                  ) : (
                    <>
                      <ul className="usage-report-list">
                        {sustainRows(sustain).map(([l, val]) => (
                          <li key={l}>
                            <span className="ur-label">{l}:</span>
                            <span className="ur-val">{val}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="report-foot" style={{ marginTop: 8 }}>
                        Working = PTO engaged or a pump running. CO₂ estimated at 2.68 kg/L diesel.
                      </p>
                    </>
                  )}
                </div>
              )}

              {include.health && healthGroups.map((g) => (
                <div className="report-group" key={g.title}>
                  <h2>Health — {g.title}</h2>
                  <table className="report-table">
                    <thead>
                      <tr><th>Component</th><th>Reading</th><th>Limit</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {g.rows.map((r) => (
                        <tr key={r.label}>
                          <td>{r.label}</td><td>{r.reading}</td><td>{r.limit}</td>
                          <td><span className={`mnt-badge ${r.status}`}>{STATUS_TEXT[r.status]}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}

              {include.alerts && (() => {
                const events = vdata[v.vehicle_id]?.events || [];
                return (
                  <div className="report-group">
                    <h2>Alerts — Emergency Stops</h2>
                    {events.length === 0 ? (
                      <p className="report-foot" style={{ marginTop: 0 }}>
                        No emergency-stop events recorded.
                      </p>
                    ) : (
                      <table className="report-table">
                        <thead>
                          <tr><th>Event</th><th>Cause</th><th>When</th></tr>
                        </thead>
                        <tbody>
                          {events.map((e, i) => {
                            const info = estopInfo(e.type);
                            return (
                              <tr key={`${e.ts}-${e.type}-${i}`}>
                                <td>{info.label}</td>
                                <td>{info.cause}</td>
                                <td>{fmtStamp(e.ts, v.timezone)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })()}
            </div>
          );
        })}

        <div>
          <p className="report-foot">
            {include.health && "⚠ Health thresholds are placeholders. "}
            {include.sustainability && chosen.some((v) => v.source === "demo") &&
              "Fuel and recycled-water figures are simulated sample data. "}
            Values are the last known reading from the most recent file. Snapshot
            from a periodic file — not live.
          </p>
          <div className="report-brandfoot">Revive Live · vehicle telemetry pilot</div>
        </div>

        <div className="report-actions no-print">
          <button className="btn-secondary" disabled={!ready || saving}
            onClick={doPrint}>
            Print
          </button>
          <button className="btn-print" disabled={!ready || saving} onClick={savePdf}>
            {saving ? "Saving…" : "Save PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}
