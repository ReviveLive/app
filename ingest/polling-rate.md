
# GPS Polling Rate Strategy

Replaces the old flat "poll Netbiter every 5 minutes, always" approach
(2026-09-11) — GPS position can't change unless the truck is moving, so
`app/poll_netbiter.py` now checks the truck's own real-time signals (already
in `readings` via the Flexy push, at no Netbiter cost) before every cycle and
adapts both *whether* and *how fast* it polls.

## Netbiter's actual rate limit

Confirmed against `apidocs.netbiter.net`'s "API Rate Limit" page (the
`bucketInfo` page in the Argos API docs) — this isn't guesswork:

- Rate limiting is **token buckets, refilled hourly, shared account-wide**
  (not isolated per device). There are 5 buckets (Account, System, System
  live, System async live, Updated); both calls this service makes —
  `getSystemLoggedValues` (`GET /system/{id}/log/{parameter}`, used for
  lat/lon) and `getSystemLogParameterConfiguration` (`GET
  /system/{id}/log/config`) — draw from the same **System** bucket, 1 token
  per request.
- The bucket's hourly refill and max burst size both scale with the
  account's subscription tier and how many Netbiter systems are on it —
  there's no single fixed number like "1000 requests/hour". Worst case
  (the smallest tier), a single system contributes roughly 81 tokens/hour
  to the shared bucket; two calls per poll (lat + lon) means ~40
  polls/hour is sustainable per system — i.e. a **90-second floor** on that
  tier. Higher tiers allow faster (down to ~50s).
- Netbiter also documents `Argos-RateLimit-Remaining` on every response —
  the actual live token count, not an estimate. `netbiter.py` reads this
  after every call (`last_rate_limit_remaining()`), so the poller can react
  to the account's real headroom instead of hard-coding a number for a tier
  that might be wrong (or might change).
- Netbiter's docs explicitly say the *live-value* buckets aren't meant for
  cyclic polling ("for cyclic readings, use the standard logging
  functions") — confirming `fetch_log`'s choice of `/log/{parameter}` over
  a live-read endpoint is the right one, not just a historical accident.

## The four vehicle states

Each cycle, `poll_netbiter.py` classifies every vehicle in `netbiter_systems`
from its latest `truck_rpm_revlive` / `scania_vehicle_speed_revlive`
readings (both arrive via the Flexy push, independent of Netbiter):

| State | Meaning | What happens |
|---|---|---|
| **moving** | speed > 0 | poll fast — see below |
| **working** | engine on, stationary (e.g. pumps running) | poll at the standard interval (`NETBITER_POLL_INTERVAL_SECONDS`, default 300s) — not moving, but could pull away any moment |
| **off** | engine off *and* the Flexy heartbeat itself is recent (so the reading is trusted) | **skip Netbiter entirely this cycle** — a genuinely powered-off truck cannot move, so there's nothing to poll for |
| **unknown** | no Flexy reading within `HEARTBEAT_STALE_SECONDS` (15 min) — can't judge current state | poll at the standard interval, as a safety net |

The Flexy and the Netbiter GPS unit are two independent physical devices —
one going quiet doesn't mean the other has too — which is why `unknown`
falls back to the standard interval rather than also skipping: we'd rather
poll a bit more than necessary than go blind if the truck is actually moving
while its Flexy has gone quiet.

State changes are logged once, not every cycle, so a long `off` stretch
(parked overnight) doesn't spam the log with an identical line every 5
minutes.

## Fast (moving) interval

`FAST_INTERVAL_SECONDS = 60` normally — matches the Flexy's own logging
cadence anyway, so polling faster wouldn't surface newer data regardless.
Backs off to `FAST_INTERVAL_BACKOFF_SECONDS = 90` whenever
`last_rate_limit_remaining()` drops below `RATE_LIMIT_LOW_WATERMARK = 20`
tokens — an absolute floor, deliberately not tier-specific, so it's safe
regardless of which tier the account actually turns out to be on.

## Tuning

- `NETBITER_POLL_INTERVAL_SECONDS` (env var, default 300) — the standard
  interval, used for `working`/`unknown` states.
- `FAST_INTERVAL_SECONDS`, `FAST_INTERVAL_BACKOFF_SECONDS`,
  `RATE_LIMIT_LOW_WATERMARK`, `HEARTBEAT_STALE_SECONDS` — module-level
  constants in `poll_netbiter.py`, not currently env-configurable; adjust
  there directly if needed.
