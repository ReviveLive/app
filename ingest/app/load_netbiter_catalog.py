"""Loads Netbiter's `GET /system` output into `netbiter_systems_catalog` —
a reference list only, queryable alongside `vehicles` to help you eyeball a
match. Does NOT create `netbiter_systems` mapping rows: see README.md's
Netbiter GPS section for why that step needs a human, not this script.

Re-run any time; upserts by netbiter_system_id.

Usage:
    python -m app.load_netbiter_catalog path/to/systemid.json
"""
from __future__ import annotations

import json
import sys

from .db import connect

_UPSERT = """
INSERT INTO netbiter_systems_catalog
    (netbiter_system_id, name, project_name, activated, timezone, loaded_at)
VALUES
    (%(id)s, %(name)s, %(project_name)s, %(activated)s, %(timezone)s, now())
ON CONFLICT (netbiter_system_id) DO UPDATE SET
    name = EXCLUDED.name,
    project_name = EXCLUDED.project_name,
    activated = EXCLUDED.activated,
    timezone = EXCLUDED.timezone,
    loaded_at = now()
"""


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: python -m app.load_netbiter_catalog <systemid.json>")

    with open(sys.argv[1], "r", encoding="utf-8") as f:
        systems = json.load(f)

    with connect() as conn:
        with conn.cursor() as cur:
            for s in systems:
                cur.execute(_UPSERT, {
                    "id": s["id"],
                    "name": s.get("name"),
                    "project_name": s.get("projectName"),
                    "activated": s.get("activated"),
                    "timezone": s.get("timezone"),
                })
        conn.commit()

    print(f"Loaded {len(systems)} Netbiter system(s) into netbiter_systems_catalog.")


if __name__ == "__main__":
    main()
