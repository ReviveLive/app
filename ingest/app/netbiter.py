"""Client for the Netbiter Argos REST API — GPS only, for the separate
Netbiter-connected device installed per truck (not the Flexy 205; see
README.md's "Netbiter GPS" section for why this is a separate data path).

Response shape confirmed from the official docs (apidocs.netbiter.net,
getSystemLoggedValues, checked 2026-09-10) rather than a live capture:

    {"logParameter": [{"timestamp": "2012-05-15T13:50:00Z", "value": "5.1"}, ...]}

In practice this isn't fully consistent: a single-row response has been seen
collapse the list to a bare object rather than a one-item list, and at least
one real system's log/config response came back as a bare list instead of
{"parameterConfiguration": [...]} at all (confirmed 2026-09-10, system
0030116A783F). `_rows_from` below normalizes all three shapes.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from .config import NETBITER_ACCESS_KEY, NETBITER_BASE_URL

_TS_FORMAT = "%Y-%m-%dT%H:%M:%SZ"


class NetbiterError(RuntimeError):
    pass


# Updated after every successful request from the `Argos-RateLimit-Remaining`
# response header (apidocs.netbiter.net's bucket-info page, checked
# 2026-09-11) - fetch_log and fetch_log_config both draw from the same
# account-wide "System" bucket (1 token/request), so either call's header is
# equally valid as the current reading. None until the first successful call.
_last_rate_limit_remaining: int | None = None


def last_rate_limit_remaining() -> int | None:
    """Tokens left in Netbiter's System bucket as of the most recent
    successful call - lets poll_netbiter.py adapt its polling interval to
    the account's actual headroom instead of guessing a fixed number from
    the (tier-dependent) bucket size. None if no call has succeeded yet."""
    return _last_rate_limit_remaining


def _note_rate_limit(resp) -> None:
    global _last_rate_limit_remaining
    remaining = resp.headers.get("Argos-RateLimit-Remaining")
    if remaining is not None:
        try:
            _last_rate_limit_remaining = int(remaining)
        except ValueError:
            pass


def _rows_from(body, key: str) -> list:
    """Normalize Netbiter's inconsistent response shape to a plain list -
    see the module docstring. `body` may be the expected {key: [...]}, a
    bare list (the whole point of this function), or {key: {...}} for a
    single-row response."""
    if isinstance(body, list):
        return body
    rows = body.get(key) or []
    return [rows] if isinstance(rows, dict) else rows


def fetch_log(
    system_id: str,
    parameter: str,
    *,
    since: datetime | None = None,
    limit_rows: int = 750,
) -> list[tuple[datetime, float]]:
    """Logged values for one parameter (e.g. "latitude"), oldest first.

    `since` becomes `startdate` so a repeated poll only asks for what's new
    — keeps this well inside Netbiter's hourly per-system token bucket
    (see README.md's Netbiter GPS section) instead of re-fetching history
    every cycle. Always sorted ascending: called with `since=None` (a
    vehicle's very first poll) this returns the *oldest* 750 rows in
    Netbiter's history for that parameter, not the newest — which is
    exactly what makes `poll_netbiter.py` self-backfilling: the first
    several cycles walk forward through history from the beginning until
    they catch up to "now", after which each cycle only sees new rows.
    750 is Netbiter's documented max per request, to make that catch-up as
    fast as the rate limit allows.
    """
    params = {
        "accesskey": NETBITER_ACCESS_KEY,
        "sortorder": "asc",
        "limitrows": str(limit_rows),
    }
    if since is not None:
        params["startdate"] = since.astimezone(timezone.utc).strftime(_TS_FORMAT)
    url = (
        f"{NETBITER_BASE_URL}/system/{system_id}/log/{parameter}"
        f"?{urllib.parse.urlencode(params)}"
    )

    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            body = json.load(resp)
            _note_rate_limit(resp)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise NetbiterError(
            f"Netbiter {exc.code} for system={system_id} parameter={parameter}: {detail}"
        ) from exc
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise NetbiterError(
            f"Netbiter request failed for system={system_id} parameter={parameter}: {exc}"
        ) from exc

    rows = _rows_from(body, "logParameter")

    out = []
    for row in rows:
        ts = datetime.strptime(row["timestamp"], _TS_FORMAT).replace(tzinfo=timezone.utc)
        out.append((ts, float(row["value"])))
    return out


def fetch_log_config(system_id: str) -> list[dict]:
    """What this system actually has configured to log: parameter ids/names,
    the real `logInterval` it's logged at, and whether it's read/write.

    This is the authoritative way to check what's available for a given
    truck (e.g. does it even have "latitude"/"longitude" configured, and how
    often) — see app/inspect_netbiter_system.py for a CLI wrapper around
    this and `fetch_log` together.
    """
    params = {"accesskey": NETBITER_ACCESS_KEY}
    url = f"{NETBITER_BASE_URL}/system/{system_id}/log/config?{urllib.parse.urlencode(params)}"

    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            body = json.load(resp)
            _note_rate_limit(resp)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise NetbiterError(f"Netbiter {exc.code} for system={system_id} log/config: {detail}") from exc
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise NetbiterError(f"Netbiter request failed for system={system_id} log/config: {exc}") from exc

    rows = _rows_from(body, "parameterConfiguration")
    return rows
