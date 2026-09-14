
# Netbiter GPS

GPS does **not** come from the Flexy 205 — the trucks' GPS units are on a
separate Netbiter-connected device, polled from Netbiter's own cloud API
(pull, not push — different shape from everything else in this service).
`app/poll_netbiter.py` is a standalone long-running loop, independent of
the FastAPI app in `main.py`, that polls Netbiter and writes straight into
the same `readings` table, under `gps_lat_revlive` / `gps_lon_revlive` —
the tag names `demo/frontend/src/gps.js` already looks for, so nothing on
the frontend needs to change once this is running.

Response shape (`{"logParameter": [{"timestamp": ..., "value": ...}]}`) is
confirmed from Netbiter's own published docs
(`apidocs.netbiter.net`, `getSystemLoggedValues`) — not best-effort like
the Flexy parser.

### Setup

1. Set `NETBITER_ACCESS_KEY` in `.env` (get it from the contractor / your
   Netbiter Argos account — never commit it, same rule as `INGEST_TOKEN`).
2. List every Netbiter system on the account — you don't need to ask the
   contractor for this:
   ```bash
   curl "https://api.netbiter.net/operation/v1/rest/json/system?accesskey=<your key>" > systemid.json
   ```
   Load it into the DB as a reference table (safe to re-run any time):
   ```bash
   python -m app.load_netbiter_catalog systemid.json
   ```
3. **Match each system to a `vehicle_id` — this step needs a human, not a
   script.** Netbiter's `name` field is its own independently-maintained
   fleet naming (we've seen values like `"20160054"`,
   `"Danish Flexline 08-1-040"`, `"Warrior No.66"` on the same account) —
   it does **not** reliably match the Flexy's `NM` (e.g. the one unit we've
   actually inspected reports `nm$ = "Cityflex-10-0-071"`, which doesn't
   resemble any Netbiter name we've seen). Guessing a match wrong means
   writing one truck's real location onto another vehicle's record — check
   both lists side by side before inserting anything:
   ```sql
   SELECT netbiter_system_id, name, activated FROM netbiter_systems_catalog ORDER BY name;
   SELECT vehicle_id FROM vehicles ORDER BY vehicle_id;
   ```
   Once you've confirmed a pair (and it's a truck you actually want GPS
   for — several catalog entries are `activated: false` or look like test
   units, e.g. "Rebuild Silkeborg"):
   ```sql
   INSERT INTO vehicles (vehicle_id, name, source) VALUES ('Warrior-91', 'Warrior-91', 'live')
       ON CONFLICT (vehicle_id) DO NOTHING;
   INSERT INTO netbiter_systems (vehicle_id, netbiter_system_id) VALUES ('Warrior-91', '0030116A7841');
   ```
4. Before relying on a match, confirm the system actually logs GPS and see
   its real shape — `python -m app.inspect_netbiter_system <netbiter_system_id>`
   lists every configured log parameter (id, name, how often it's actually
   logged); add a parameter name to also print sample values, e.g.:
   ```bash
   python -m app.inspect_netbiter_system 0030116A7841
   python -m app.inspect_netbiter_system 0030116A7841 latitude 5
   ```
5. Run the poller — **as its own process, not folded into the API** (worker
   loop vs. HTTP server, and it must stay single-instance since it has no
   locking between runs — see the comment on `netbiter-poller` in
   `docker-compose.yml`):
   ```bash
   python -m app.poll_netbiter
   ```
   `docker compose up -d --build` now also starts a `netbiter-poller`
   service alongside `api`/`db`, same image, same DB, different command.

   On Railway: add a second service pointed at this same repo/Dockerfile,
   override its start command to `python -m app.poll_netbiter`, give it the
   same `DATABASE_URL`/`POSTGRES_*` vars plus `NETBITER_ACCESS_KEY`, and
   leave networking off — it makes no inbound requests, only outbound HTTPS
   to `api.netbiter.net` and the database. Keep its replica count at 1.

### Historical data — yes, and the poller backfills it automatically

`getSystemLoggedValues` isn't just "what's new" — `startdate`/`enddate`
means you can pull a system's full logged history, not just data going
forward from today. `poll_netbiter.py` already does this for you: on a
vehicle's very first poll (no reading stored yet) it fetches from the
start of Netbiter's history rather than from "now", 750 rows at a time
(Netbiter's documented max per request), and keeps paging forward on each
cycle until it catches up to real time — after that, every cycle only
fetches what's genuinely new. No separate backfill script needed. How long
catch-up takes depends on how much history exists and how often GPS was
actually being logged on that truck (check with
`inspect_netbiter_system`'s `logInterval` output) — expect it to take
several poll cycles, not one, for a truck with months of history.

### Polling rate — adaptive, not a flat 5 minutes

`poll_netbiter.py` doesn't poll at a fixed interval any more (2026-09-11) —
it checks whether the truck is actually moving (from its existing Flexy
signals, at no Netbiter cost) and polls fast while moving, slow while
stationary, and skips Netbiter entirely for a confirmed-off vehicle. See
[polling-rate.md](polling-rate.md) for the full strategy, Netbiter's actual
documented rate limit, and the tuning knobs.
