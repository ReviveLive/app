"""Polls Netbiter for GPS and writes it into the same `readings` table the
Flexy push uses — a separate process from the FastAPI app on purpose, since
Netbiter is a pull API (poll on an interval) while `main.py` is push
(receives the Flexy's `DoSync`). See README.md's "Netbiter GPS" section.

Run locally:
    python -m app.poll_netbiter

Writes `gps_lat_revlive` / `gps_lon_revlive` — the tag names
`demo/frontend/src/gps.js` already looks for.

Add a vehicle to poll:
    INSERT INTO netbiter_systems (vehicle_id, netbiter_system_id)
    VALUES ('Warrior-91', '003011FD7C6A');
(Find your systemid via GET .../system?accesskey=<key> — lists every
system's id + name on the account; see README.md.)

Movement-aware polling (Joe, 2026-09-11): GPS position can't change unless
the truck is actually moving, so this checks the Flexy's own real-time
signals (already in `readings`, no extra Netbiter cost to look up) before
deciding whether/how fast to poll:
  - MOVING (speed > 0): poll fast - see _moving_interval(), which adapts to
    Netbiter's actual remaining rate-limit headroom (the
    Argos-RateLimit-Remaining header - see netbiter.py) rather than a fixed
    guess, since the real bucket size depends on the account's tier.
  - WORKING (engine on, stationary - e.g. pumps running): poll at the
    standard interval. Not moving, but the engine could pull away any
    moment, so GPS is still worth checking periodically.
  - OFF (confirmed: engine off AND the Flexy heartbeat itself is fresh, so
    we trust the reading): skip Netbiter entirely. A genuinely powered-off
    truck cannot move, so there is nothing to poll for - this is the one
    case actually worth *not* calling Netbiter at all, not just polling it
    less often.
  - UNKNOWN (no recent-enough Flexy reading to judge by - the heartbeat
    itself may have failed): poll at the standard interval as a safety net,
    same as WORKING, rather than risk staying blind if a vehicle is
    actually moving but its Flexy has gone quiet.
The two devices (Flexy and the Netbiter GPS unit) are independent, so a
Flexy dropout doesn't necessarily mean Netbiter/GPS is down too - hence
falling back to the standard interval on UNKNOWN instead of also skipping.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone

from . import netbiter
from .config import NETBITER_POLL_INTERVAL_SECONDS
from .db import connect
from .netbiter import NetbiterError, fetch_log

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("poll_netbiter")

_SYSTEMS_SELECT = "SELECT vehicle_id, netbiter_system_id FROM netbiter_systems"

_LAST_TS_SELECT = """
SELECT max(ts) FROM readings WHERE vehicle_id = %(vehicle_id)s AND parameter = %(parameter)s
"""

_LATEST_ONE_SELECT = """
SELECT value, ts FROM readings
WHERE vehicle_id = %(vehicle_id)s AND parameter = %(parameter)s
ORDER BY ts DESC LIMIT 1
"""

_READING_INSERT = """
INSERT INTO readings (vehicle_id, ts, parameter, value)
VALUES (%(vehicle_id)s, %(ts)s, %(parameter)s, %(value)s)
ON CONFLICT (vehicle_id, ts, parameter) DO NOTHING
"""

# Netbiter parameter/tag name -> our readings parameter name.
_GPS_PARAMETERS = {
    "latitude": "gps_lat_revlive",
    "longitude": "gps_lon_revlive",
}

# Real trial vehicle's engine/speed signals (confirmed 2026-09-08/09-10,
# same tags api.py's TRIAL_RPM/other endpoints already use) - the movement
# check above is built on these, not on GPS itself (that would be circular:
# the whole point is deciding whether to ask Netbiter for GPS at all).
RPM_PARAM = "truck_rpm_revlive"
SPEED_PARAM = "scania_vehicle_speed_revlive"

# How stale a signal can be before it's not trusted to judge current state -
# same "how stale is too stale" call as the frontend's online/offline pill
# (App.jsx's OFFLINE_THRESHOLD_MIN), applied here to the Flexy heartbeat.
HEARTBEAT_STALE_SECONDS = 15 * 60

# Netbiter's real bucket size depends on account tier/system count (see
# netbiter.py's last_rate_limit_remaining docstring), so this backs off on
# an absolute low-headroom floor rather than a tier-specific number - safe
# regardless of which tier the account is actually on.
FAST_INTERVAL_SECONDS = 60
FAST_INTERVAL_BACKOFF_SECONDS = 90
RATE_LIMIT_LOW_WATERMARK = 20

# Logged only on change, not every cycle, so an all-night "off" stretch
# doesn't spam the log with an identical line every 5 minutes.
_last_state: dict[str, str] = {}


def _latest(conn, vehicle_id: str, parameter: str) -> tuple[float, datetime] | None:
    with conn.cursor() as cur:
        cur.execute(_LATEST_ONE_SELECT, {"vehicle_id": vehicle_id, "parameter": parameter})
        return cur.fetchone()


def _vehicle_state(conn, vehicle_id: str) -> str:
    """"moving" | "working" | "off" | "unknown" - see the module docstring."""
    rpm_row = _latest(conn, vehicle_id, RPM_PARAM)
    if rpm_row is None:
        return "unknown"
    rpm, rpm_ts = rpm_row
    age = (datetime.now(timezone.utc) - rpm_ts).total_seconds()
    if age > HEARTBEAT_STALE_SECONDS:
        return "unknown"
    if not rpm or rpm <= 0:
        return "off"
    speed_row = _latest(conn, vehicle_id, SPEED_PARAM)
    speed = speed_row[0] if speed_row else 0
    return "moving" if speed and speed > 0 else "working"


def _moving_interval() -> int:
    remaining = netbiter.last_rate_limit_remaining()
    if remaining is not None and remaining < RATE_LIMIT_LOW_WATERMARK:
        return FAST_INTERVAL_BACKOFF_SECONDS
    return FAST_INTERVAL_SECONDS


def _poll_once(conn) -> int:
    """Runs one cycle; returns the interval (seconds) the caller should
    sleep before the next one - the fast interval if any vehicle polled this
    cycle was moving, else the standard interval."""
    with conn.cursor() as cur:
        cur.execute(_SYSTEMS_SELECT)
        systems = cur.fetchall()

    any_moving = False
    for vehicle_id, netbiter_system_id in systems:
        state = _vehicle_state(conn, vehicle_id)
        if state != _last_state.get(vehicle_id):
            log.info("%s: state -> %s", vehicle_id, state)
            _last_state[vehicle_id] = state

        if state == "off":
            continue  # confirmed can't-move - no Netbiter call needed at all
        if state == "moving":
            any_moving = True

        for netbiter_param, our_param in _GPS_PARAMETERS.items():
            with conn.cursor() as cur:
                cur.execute(_LAST_TS_SELECT, {"vehicle_id": vehicle_id, "parameter": our_param})
                since: datetime | None = cur.fetchone()[0]

            try:
                rows = fetch_log(netbiter_system_id, netbiter_param, since=since)
            except NetbiterError:
                log.exception("Netbiter fetch failed for %s/%s", vehicle_id, netbiter_param)
                continue

            if not rows:
                continue

            if since is None:
                log.info(
                    "%s/%s: no prior data — backfilling from the start of Netbiter's history "
                    "(will take several cycles to catch up if there's a lot of it)",
                    vehicle_id, our_param,
                )

            with conn.cursor() as cur:
                for ts, value in rows:
                    cur.execute(
                        _READING_INSERT,
                        {"vehicle_id": vehicle_id, "ts": ts, "parameter": our_param, "value": value},
                    )
            conn.commit()
            log.info("%s/%s: wrote %d row(s)", vehicle_id, our_param, len(rows))

    return _moving_interval() if any_moving else NETBITER_POLL_INTERVAL_SECONDS


def main() -> None:
    log.info(
        "Netbiter GPS poller starting, standard interval=%ss, moving interval=%s-%ss",
        NETBITER_POLL_INTERVAL_SECONDS, FAST_INTERVAL_SECONDS, FAST_INTERVAL_BACKOFF_SECONDS,
    )
    while True:
        interval = NETBITER_POLL_INTERVAL_SECONDS
        try:
            with connect() as conn:
                interval = _poll_once(conn)
        except Exception:
            log.exception("Poll cycle failed")
        time.sleep(interval)


if __name__ == "__main__":
    main()
