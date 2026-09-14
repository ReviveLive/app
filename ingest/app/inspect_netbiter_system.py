"""Discovery tool: what does a given Netbiter system actually have logged,
and in what shape? Self-service — no contractor needed, same spirit as this
service's own README section on capturing a real Flexy push.

Usage:
    python -m app.inspect_netbiter_system <netbiter_system_id> [parameter] [rows]

Examples:
    python -m app.inspect_netbiter_system 0030116A7841
    python -m app.inspect_netbiter_system 0030116A7841 latitude 5
"""
from __future__ import annotations

import sys

from .netbiter import NetbiterError, fetch_log, fetch_log_config


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)

    system_id = sys.argv[1]

    try:
        config = fetch_log_config(system_id)
    except NetbiterError as exc:
        raise SystemExit(str(exc))

    print(f"{len(config)} configured log parameter(s) for system {system_id}:")
    for p in config:
        print(
            f"  id={p.get('id')!r:<22} name={p.get('name')!r:<32} "
            f"logInterval={p.get('logInterval')}s pointType={p.get('pointType')}"
        )

    if len(sys.argv) < 3:
        return

    parameter = sys.argv[2]
    rows = int(sys.argv[3]) if len(sys.argv) >= 4 else 10
    try:
        values = fetch_log(system_id, parameter, limit_rows=rows)
    except NetbiterError as exc:
        raise SystemExit(str(exc))

    print(f"\nFirst {len(values)} logged value(s) for {parameter!r} (oldest first):")
    for ts, value in values:
        print(f"  {ts.isoformat()}  {value}")


if __name__ == "__main__":
    main()
