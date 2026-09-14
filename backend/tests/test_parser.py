"""Regression tests for the telemetry parser (revive.parser.parse_file).

Focus: the fuller "wide CSV" layout the platform will receive going forward,
which differs from the original .xlsx in three ways the parser has to handle —
identity in a FOOTER block (not an Info sheet), a timestamp split across
`Date` + `Time` columns, and a UTF-8 BOM + trailing-comma phantom column.

The fixture is SYNTHETIC (invented system id and GPS) — never a real customer
file — so it is safe to keep in the repo. Run from the `backend/` directory:
    .venv\\Scripts\\python.exe -m pytest tests -q
"""
from datetime import datetime, timezone
from pathlib import Path

from revive.parser import parse_file

FIXTURE = Path(__file__).parent / "fixtures" / "sample_wide.csv"


def test_identity_comes_from_the_csv_footer():
    vehicle, _ = parse_file(str(FIXTURE))
    assert vehicle == {
        "system_id": "TEST-0001",
        "name": "Test Warrior",
        "timezone": "Europe/Dublin",
    }


def test_only_populated_data_cells_become_readings():
    # 3 data rows hold 13 populated value cells between them; the footer rows and
    # the trailing-comma phantom column must not add any readings.
    _, readings = parse_file(str(FIXTURE))
    assert len(readings) == 13


def test_wide_columns_flow_through_but_structural_columns_do_not():
    _, readings = parse_file(str(FIXTURE))
    params = {r["parameter"] for r in readings}

    # New wide-layout columns come through generically, units and all.
    assert {
        "Ambient Air Temperature (°C)",
        "Fuel Rate (l/h)",
        "Total Engine Hours (hrs)",
        "Vehicle Speed (km/h)",
        "RPM (rpm)",
        "PTO Active",
        "Latitude Decimal Degrees",
        "Longitude Decimal Degrees",
    } <= params

    # Footer keys, the split-timestamp source columns, and the empty phantom
    # column must NOT leak in as parameters. (A stray BOM would corrupt the
    # first header and break identity/timestamp detection, so this passing also
    # confirms the BOM was stripped.)
    assert not (params & {
        "Date", "Time", "System", "System id", "Project", "Time zone",
        "Created", "",
    })
    assert not any(str(p).startswith("Unnamed") for p in params)


def test_split_date_and_time_combine_into_a_utc_timestamp():
    _, readings = parse_file(str(FIXTURE))
    # Europe/Dublin has no DST offset in January, so 09:00 local == 09:00 UTC.
    pto = [r for r in readings if r["parameter"] == "PTO Active"]
    earliest = min(pto, key=lambda r: r["ts"])
    assert earliest["ts"] == datetime(2026, 1, 2, 9, 0, tzinfo=timezone.utc)
    assert all(r["ts"].tzinfo is not None for r in readings)


def test_last_known_uses_the_newest_timestamp():
    _, readings = parse_file(str(FIXTURE))
    lats = [r for r in readings if r["parameter"] == "Latitude Decimal Degrees"]
    newest = max(lats, key=lambda r: r["ts"])
    assert newest["value"] == 51.6
