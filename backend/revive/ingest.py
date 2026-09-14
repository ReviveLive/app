"""Step 4 — Idempotent ingestion.

Takes the readings the parser produces (step 2) and writes them into the
database (step 3). Re-running on the same file does NOT create duplicates:
the readings table's primary key (vehicle_id, ts, parameter) plus
`ON CONFLICT DO NOTHING` means a row that already exists is silently skipped.

Usage:
    python -m revive.ingest <file.xlsx>   # ingest one file
    python -m revive.ingest               # ingest every .xlsx in INCOMING_DIR
"""
from __future__ import annotations

import glob
import os
import re
import shutil

from .config import DATA_SOURCE, INCOMING_DIR, PROCESSED_DIR, PROJECT_ROOT
from .db import connect
from .parser import parse_file

_VEHICLE_UPSERT = """
INSERT INTO vehicles (vehicle_id, name, timezone, source)
VALUES (%(system_id)s, %(name)s, %(timezone)s, %(source)s)
ON CONFLICT (vehicle_id) DO UPDATE
    SET name = EXCLUDED.name, timezone = EXCLUDED.timezone, source = EXCLUDED.source
"""

_READING_INSERT = """
INSERT INTO readings (vehicle_id, ts, parameter, value)
VALUES (%(vehicle_id)s, %(ts)s, %(parameter)s, %(value)s)
ON CONFLICT (vehicle_id, ts, parameter) DO NOTHING
"""


def _safe_folder(name: str, fallback: str) -> str:
    """Vehicle name -> filesystem-safe folder name (Windows-safe)."""
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", (name or "").strip())
    cleaned = cleaned.rstrip(". ")  # Windows can't end a name with a dot or space
    return cleaned or fallback


def ingest_file(path: str) -> dict:
    """Parse one file and write it to the database. Returns a small summary."""
    vehicle, readings = parse_file(path)
    vid = vehicle["system_id"]
    vehicle["source"] = DATA_SOURCE

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(_VEHICLE_UPSERT, vehicle)

            cur.execute("SELECT count(*) FROM readings WHERE vehicle_id = %s", (vid,))
            before = cur.fetchone()[0]

            cur.executemany(_READING_INSERT, readings)

            cur.execute("SELECT count(*) FROM readings WHERE vehicle_id = %s", (vid,))
            after = cur.fetchone()[0]
        conn.commit()

    # Only reached after a successful commit: a parse/insert error raises above
    # and leaves the file untouched in INCOMING_DIR for inspection / retry.
    folder = _safe_folder(vehicle["name"], vid)
    dest_dir = os.path.join(PROCESSED_DIR, folder)
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, os.path.basename(path))
    # A re-sent same-name file overwrites the old one. shutil.move (not os.replace)
    # because incoming/ and processed/ are often separate mounts/volumes, where a
    # rename fails with EXDEV ("cross-device link"); shutil.move falls back to
    # copy-then-delete in that case.
    if os.path.exists(dest):
        os.remove(dest)
    shutil.move(path, dest)

    inserted = after - before
    return {
        "file": os.path.basename(path),
        "vehicle": f"{vehicle['name']} ({vid})",
        "attempted": len(readings),
        "inserted": inserted,
        "skipped_as_duplicate": len(readings) - inserted,
        "total_in_db_for_vehicle": after,
        "moved_to": os.path.relpath(dest, PROJECT_ROOT),
    }


def ingest_dir(directory: str = INCOMING_DIR) -> list[dict]:
    """Ingest every telemetry file in a directory (the periodic drop folder).

    Handles both supported layouts: .xlsx (Info sheet) and .csv (footer identity
    + split Date/Time) — see parser.parse_file, which auto-detects by extension.
    """
    files = sorted(
        glob.glob(os.path.join(directory, "*.xlsx"))
        + glob.glob(os.path.join(directory, "*.csv"))
    )
    if not files:
        print(f"[info] no .xlsx or .csv files found in {directory}")
    return [ingest_file(f) for f in files]


if __name__ == "__main__":
    import sys

    results = [ingest_file(sys.argv[1])] if len(sys.argv) == 2 else ingest_dir()

    for r in results:
        print("\n=== Ingest summary ===")
        for k, v in r.items():
            print(f"  {k}: {v}")
