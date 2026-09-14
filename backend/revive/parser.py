"""Step 2 — Parser.

Normalises a periodic telemetry file into long-format records
(vehicle_id, ts, parameter, value).
- Two file layouts are supported, and auto-detected by extension:
    * .xlsx — a workbook with an `Info` sheet (vehicle identity) and a data
      sheet, using a single `Date Time` column. This was the first format.
    * .csv  — a flat file whose vehicle identity is a key/value block at the
      FOOTER, using separate `Date` and `Time` columns. This is the fuller
      layout the platform will receive going forward.
  Both funnel through the same timestamp/melt/coerce logic below, so the only
  format-specific code is "how do we read identity + rows out of the file".
- Data is sparse / event-style: most cells are empty; we keep only the cells
  that actually hold a value.
- We take EVERY value column generically — new columns in a fuller file flow
  through automatically. KNOWN_PARAMETERS below is only used to LOG when an
  unexpected column shows up; it never gates or discards data.
- Timestamps are localised using the file's stated timezone and stored as UTC.

No database here. This module only parses and returns records.
"""
from __future__ import annotations

import csv
import re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

# The timestamp can arrive as one combined column (old .xlsx) or as two
# separate columns (new .csv). We normalise both to this single column name.
TIMESTAMP_COL = "Date Time"
DATE_COL = "Date"
TIME_COL = "Time"
# A data row's Date cell looks like 2026-06-24; the CSV footer's keys (System,
# System id, Time zone, ...) do not — this is how we tell the two apart.
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# The three identity keys we read, from either the .xlsx `Info` sheet or the
# .csv footer (both use these exact labels: `System` is the friendly name).
_ID_KEYS = ("System id", "System", "Time zone")

# Reference list of columns seen in real files — the original controller feed
# plus the fuller J1939/engine layout. Purely for logging "new column appeared"
# — not a filter; anything not listed still flows through as a parameter.
KNOWN_PARAMETERS = {
    # Original controller feed.
    "Bottom Empty Valve", "Cassette Fully extended Count (times)", "Cassette Valve",
    "Jet Pump Run", "Jet Pump Run Minute (min)", "Large Hose Valve",
    "Large Hose Water Used (m3)", "Latitude Decimal Degrees",
    "Longitude Decimal Degrees", "Piston Moves Backward (times)",
    "Piston Moves Completed (times)", "Piston Moves Forward (times)",
    "Piston Position 1", "Piston Position 2", "Piston Position 3",
    "Piston Position 4", "Pressure Release Button Count (times)", "PTO Active",
    "PTO Run Minute (min)", "Rear Cover Open Count (times)", "Recycle Pump Run",
    "Recycle Pump Run Minute (min)", "Relay Output", "Remote Control Active",
    "RPM (rpm)", "Small Hose Valve", "Small Hose Water Used (m3)",
    "Total Water Used (m3)", "Vac Pump Run", "Vacuum Pump Run Minute (min)",
    "Water Level Volume (m3)",
    # Fuller J1939 / engine / weights layout.
    "ActualEngine_PercTorque (%)", "Ambient Air Temperature (°C)",
    "Axle Location", "Axle Weight (J1939) (kg)", "Cargo Weight (kg)",
    "Engine Coolant Temperature (°C)", "Engine Oil Temperature (°C)",
    "Engine Speed (J1939) (rpm)", "Fuel Rate (l/h)", "Hydraulic Oil Level Low",
    "Hydraulic Oil Temperature High", "Instantaneous Fuel Economy (km/l)",
    "Jetting Probe OTR", "Piston Probe OTR", "Pneumatic Supply Pressure",
    "Remote Panel Fault", "Road Surface Air Temperature (°C)",
    "Safety Circuit Tripped", "Tank Low Level Overide", "Total Engine Hours (hrs)",
    "Total Fuel Used (l)", "Trailer Weight (kg)", "Vacuum Probe OTR",
    "Vacuum Water Low", "Vehicle Milage (km)", "Vehicle Speed (km/h)",
}


def _vehicle_from_kv(kv: dict, path: str) -> dict:
    """Build the vehicle dict from an identity key/value map, applying the same
    fallbacks whether it came from the `Info` sheet or the CSV footer."""
    stem_id = Path(path).stem.split("_")[0]
    return {
        "system_id": str(kv.get("System id", stem_id)).strip(),
        "name": str(kv.get("System", "")).strip(),
        "timezone": str(kv.get("Time zone", "UTC")).strip() or "UTC",
    }


def _read_xlsx(path: str):
    """Old layout: identity from the `Info` sheet, rows from the data sheet.

    Returns (vehicle: dict, df: DataFrame).
    """
    info = pd.read_excel(path, sheet_name="Info", header=None, engine="openpyxl")
    kv = {str(k).strip(): v for k, v in zip(info[0], info[1])}
    vehicle = _vehicle_from_kv(kv, path)

    # Data sheet = the one that isn't `Info` (it's named after the date).
    # Close the workbook handle promptly: on Windows a lingering open handle
    # blocks the post-ingest move of the file (os.replace -> PermissionError).
    with pd.ExcelFile(path, engine="openpyxl") as xl:
        data_sheets = [s for s in xl.sheet_names if s.lower() != "info"]
        if not data_sheets:
            raise ValueError("No data sheet found (only an Info sheet?).")
        df = xl.parse(data_sheets[0])
    return vehicle, df


def _read_csv(path: str):
    """New layout: a flat CSV whose identity is a key/value block at the FOOTER.

    Data rows have a real date in the first cell (2026-06-24); the footer rows
    (System, System id, Time zone, ...) do not — we split on that. Read with
    utf-8-sig so a leading BOM on the first header is stripped.

    Returns (vehicle: dict, df: DataFrame).
    """
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = [r for r in csv.reader(f) if r and any(cell.strip() for cell in r)]
    if not rows:
        raise ValueError("Empty CSV — no header row.")

    header = rows[0]
    data_rows, footer_rows = [], []
    for r in rows[1:]:
        (data_rows if _DATE_RE.match(r[0].strip()) else footer_rows).append(r)

    # Identity from the footer key/value pairs (first two cells of each row).
    kv = {r[0].strip(): r[1].strip() for r in footer_rows if len(r) > 1}
    vehicle = _vehicle_from_kv(kv, path)

    # Pad/trim each data row to the header width so a stray trailing comma (or a
    # short row) can't misalign columns. Blank cells become None (not "") so the
    # sparse-cell dropna works like the xlsx path; remaining strings are coerced
    # to numbers by to_numeric() downstream.
    width = len(header)
    fixed = [
        [(cell.strip() or None) if isinstance(cell, str) else cell
         for cell in (r + [None] * width)[:width]]
        for r in data_rows
    ]
    df = pd.DataFrame(fixed, columns=header)
    return vehicle, df


def _combine_timestamp(df: pd.DataFrame) -> pd.DataFrame:
    """Return df with a single naive-datetime `Date Time` column, whichever way
    the timestamp arrived, and the source column(s) removed."""
    if TIMESTAMP_COL in df.columns:
        ts = pd.to_datetime(df[TIMESTAMP_COL], errors="coerce")
    elif DATE_COL in df.columns and TIME_COL in df.columns:
        ts = pd.to_datetime(
            df[DATE_COL].astype(str).str.strip() + " "
            + df[TIME_COL].astype(str).str.strip(),
            errors="coerce",
        )
    elif DATE_COL in df.columns:
        ts = pd.to_datetime(df[DATE_COL], errors="coerce")
    else:
        raise ValueError(
            f"No timestamp column found (looked for {TIMESTAMP_COL!r}, or "
            f"{DATE_COL!r}+{TIME_COL!r}); got {list(df.columns)}"
        )
    df = df.drop(columns=[c for c in (TIMESTAMP_COL, DATE_COL, TIME_COL)
                          if c in df.columns])
    df.insert(0, TIMESTAMP_COL, ts)
    return df


def parse_file(path: str):
    """Return (vehicle: dict, readings: list[dict]).

    Each reading: {vehicle_id, ts (UTC, tz-aware), parameter, value (float)}.
    """
    ext = Path(path).suffix.lower()
    if ext == ".csv":
        vehicle, df = _read_csv(path)
    elif ext in (".xlsx", ".xls"):
        vehicle, df = _read_xlsx(path)
    else:
        raise ValueError(f"Unsupported file type {ext!r} (expected .csv or .xlsx)")

    try:
        tz = ZoneInfo(vehicle["timezone"])
    except Exception:
        print(f"[warn] unknown timezone {vehicle['timezone']!r}; assuming UTC")
        tz = ZoneInfo("UTC")

    df = _combine_timestamp(df)

    # Timestamp -> UTC. Handle the DST edge cases so the parser never crashes.
    df[TIMESTAMP_COL] = (
        df[TIMESTAMP_COL]
        .dt.tz_localize(tz, ambiguous="NaT", nonexistent="shift_forward")
        .dt.tz_convert("UTC")
    )
    df = df.dropna(subset=[TIMESTAMP_COL])

    # Every non-timestamp column is a parameter — except empty/unnamed columns,
    # which are artefacts (a trailing comma in the CSV, or a blank Excel column).
    value_cols = [
        c for c in df.columns
        if c != TIMESTAMP_COL and str(c).strip() and not str(c).startswith("Unnamed")
    ]

    # Log any column we haven't seen before — never discard it.
    new_cols = [c for c in value_cols if c not in KNOWN_PARAMETERS]
    for c in new_cols:
        print(f"[info] new/unexpected column flowing through as a parameter: {c!r}")
 
    # Melt wide -> long; drop empty cells (the sparse part).
    long = df.melt(
        id_vars=[TIMESTAMP_COL],
        value_vars=value_cols,
        var_name="parameter",
        value_name="value",
    ).dropna(subset=["value"])
 
    # Coerce values to float; log + drop anything non-numeric (rare).
    coerced = pd.to_numeric(long["value"], errors="coerce")
    n_bad = int(coerced.isna().sum())
    if n_bad:
        bad_params = sorted(long.loc[coerced.isna(), "parameter"].unique())
        print(f"[warn] dropped {n_bad} non-numeric values in: {bad_params}")
    long = long.assign(value=coerced).dropna(subset=["value"])
 
    vid = vehicle["system_id"]
    readings = [
        {
            "vehicle_id": vid,
            "ts": row[TIMESTAMP_COL].to_pydatetime(),
            "parameter": row["parameter"],
            "value": float(row["value"]),
        }
        for _, row in long.iterrows()
    ]
    return vehicle, readings
 
 
if __name__ == "__main__":
    import sys
    from collections import Counter
 
    if len(sys.argv) != 2:
        print("usage: python -m revive.parser <file.xlsx>")
        raise SystemExit(1)
 
    vehicle, readings = parse_file(sys.argv[1])
 
    print("\n=== Vehicle ===")
    for k, v in vehicle.items():
        print(f"  {k}: {v}")
 
    print(f"\n=== Readings ===\n  total normalised readings: {len(readings)}")
    counts = Counter(r["parameter"] for r in readings)
    print("  per-parameter counts:")
    for param, n in sorted(counts.items()):
        print(f"    {n:6d}  {param}")
 
    # Tiny preview of the 'last known' idea the dashboard will use.
    def last(param):
        rows = [r for r in readings if r["parameter"] == param]
        return max(rows, key=lambda r: r["ts"]) if rows else None
 
    print("\n=== Last-known preview ===")
    for p in ["Latitude Decimal Degrees", "Longitude Decimal Degrees",
              "Water Level Volume (m3)", "RPM (rpm)"]:
        r = last(p)
        if r:
            print(f"  {p}: {r['value']}  @ {r['ts'].isoformat()}")
        else:
            print(f"  {p}: (no readings)")
 
