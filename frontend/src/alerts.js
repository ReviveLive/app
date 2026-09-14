// Emergency-stop event catalogue — maps the raw event parameter (as stored by
// the demo generator, or the real trial vehicle, and returned by /api/alerts)
// to a human label and a cause line.
//
// ⚠️ "E-Stop: ..." entries are SIMULATED demo events (see CLAUDE.md #3).
// alm_safety_tripped_revlive is the real trial vehicle's equivalent - the
// metric list's own "clarify: estop?" note on that tag is confirmed against
// the "Maintenance Thresholds" sheet's Alert column ("Emergency stop
// activated and which type...") (Joe, 2026-09-11). A vehicle only ever
// populates one side (see api.py's alerts()), so one catalogue covers both.
// `labelKey`/`causeKey` (added 2026-09-13) are translation keys the live
// AlertsPage UI uses; `label`/`cause` stay plain English, unchanged, since
// ReportDialog.jsx (the PDF report - not yet translated) still reads those
// directly. Update both when adding/renaming an entry.
export const ESTOP_CATALOG = {
  "E-Stop: Button Pressed (Warrior)": {
    label: "Emergency stop — button pressed (Warrior)", labelKey: "alerts.estop.warriorButton.label",
    cause: "On-vehicle E-stop button pressed", causeKey: "alerts.estop.warriorButton.cause",
  },
  "E-Stop: Button Pressed (Remote)": {
    label: "Emergency stop — button pressed (remote)", labelKey: "alerts.estop.remoteButton.label",
    cause: "Handheld remote E-stop button pressed", causeKey: "alerts.estop.remoteButton.cause",
  },
  "E-Stop: Remote Out Of Range": {
    label: "Emergency stop — remote out of range", labelKey: "alerts.estop.remoteOutOfRange.label",
    cause: "Remote lost its link with the vehicle", causeKey: "alerts.estop.remoteOutOfRange.cause",
  },
  "E-Stop: Remote Fall Detection": {
    label: "Emergency stop — remote fall detection", labelKey: "alerts.estop.remoteFallDetection.label",
    cause: "Remote detected an operator fall", causeKey: "alerts.estop.remoteFallDetection.cause",
  },
  alm_safety_tripped_revlive: {
    label: "Emergency stop — safety circuit tripped", labelKey: "alerts.estop.safetyCircuitTripped.label",
    cause: "Safety interlock circuit tripped", causeKey: "alerts.estop.safetyCircuitTripped.cause",
  },
};

// Resolve an event type to its catalogue entry, falling back to the raw string.
export const estopInfo = (type) =>
  ESTOP_CATALOG[type] || { label: type, cause: "Emergency stop", causeKey: "alerts.estop.fallback" };

// Operational-override catalogue — deliberate overrides of a safety interlock
// (not emergencies). "Low Level Override Pressed" is SIMULATED demo data;
// alm_low_overide_revlive is the real trial vehicle's equivalent (spec section
// 4, confirmed 2026-09-10) - same event, real telemetry. A vehicle only ever
// populates one of the two (see api.py's alerts()), so one catalogue covers
// both without mislabelling either.
export const OVERRIDE_CATALOG = {
  "Low Level Override Pressed": {
    label: "Low-level override pressed", labelKey: "alerts.override.lowLevel.label",
    cause: "Jet pump forced to run with the tank at or below 20% — not recommended", causeKey: "alerts.override.lowLevel.cause",
  },
  alm_low_overide_revlive: {
    label: "Low-level override pressed", labelKey: "alerts.override.lowLevel.label",
    cause: "Jet pump forced to run with the tank at or below 20% — not recommended", causeKey: "alerts.override.lowLevel.cause",
  },
};

export const overrideInfo = (type) =>
  OVERRIDE_CATALOG[type] || { label: type, cause: "Operational override", causeKey: "alerts.override.fallback" };

// Machine-fault catalogue — real trial vehicle only (spec section 4, confirmed
// 2026-09-10), no demo-fleet equivalent, so never simulated. Same edge-
// detection situation as alm_low_overide_revlive above - see api.py's
// MACHINE_FAULT_PARAMS. alm_safety_tripped_revlive moved to ESTOP_CATALOG
// once confirmed as the real e-stop signal (2026-09-11).
// alm_vac_water_temp_revlive is deliberately excluded - not part of the
// spec's Alerts section; add it once confirmed needed.
export const FAULT_CATALOG = {
  alm_low_oil_revlive: {
    label: "Low oil level", labelKey: "alerts.fault.lowOil.label",
    cause: "Hydraulic oil level below the safe threshold", causeKey: "alerts.fault.lowOil.cause",
  },
  alm_high_oil_temp_revlive: {
    label: "High oil temperature", labelKey: "alerts.fault.highOilTemp.label",
    cause: "Hydraulic oil temperature above the safe threshold", causeKey: "alerts.fault.highOilTemp.cause",
  },
};

export const faultInfo = (type) =>
  FAULT_CATALOG[type] || { label: type, cause: "Machine fault", causeKey: "alerts.fault.fallback" };
