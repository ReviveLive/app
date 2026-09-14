# Revive Live — ingest API

Receives the Flexy 205's live push (`program.bas`'s `DoSync`, every 60s) and
writes it into Postgres/TimescaleDB. Kept in its own folder, independent of
`backend/` (the read-only dashboard API), and deployed as its own service —
they don't need to scale or restart together, and a real vehicle pushing data
has nothing to do with someone browsing the dashboard.

Status: confirmed working against the real Warrior fleet (multiple vehicles
ingesting live telemetry as of 2026-09-14) — see `parser.py`'s docstring for
the confirmed wire format, established from a real captured push.

## What it implements

Matches the two routes `program.bas` calls (see `program.bas`'s `iurl$`/`tm$`):

- `POST /ingest?device=<nm>` — the 60s historical-log push. Parses into
  `readings`, and unconditionally stores the raw body into `raw_pushes`
  regardless of parse success.
- `POST /tagmap?device=<nm>` — boot-time tag registration. Registers the
  vehicle, stores the raw body for inspection.
- `GET /health` — liveness.

Auth: every request must carry `Authorization: Bearer <INGEST_TOKEN>`,
matching what the device's script sends. Leave `INGEST_TOKEN` unset only for
a first local-only test — required before this is reachable by anything
beyond your own machine (real vehicle location data — see the root
`CLAUDE.md` non-negotiable #1).

## Running it locally (no real device needed)

```bash
cd ingest
cp .env.example .env        # fill in a POSTGRES_PASSWORD; leave INGEST_TOKEN blank for now
python -m venv venv && venv\Scripts\activate   # Windows
pip install -r requirements.txt

# Start just a database
docker run -d --name revive-ingest-db -p 127.0.0.1:5433:5432 ^
  -e POSTGRES_USER=revive -e POSTGRES_PASSWORD=changeme -e POSTGRES_DB=revive_ingest ^
  -v "%cd%\schema.sql:/docker-entrypoint-initdb.d/01-schema.sql:ro" ^
  timescale/timescaledb:latest-pg16

# .env: set POSTGRES_PORT=5433 to match, then run the API
uvicorn app.main:app --reload --port 8090
```

Smoke-test it (a real push is multipart/form-data, but `/ingest` falls back
to a bare `data=` body for exactly this kind of manual test):
```bash
curl http://127.0.0.1:8090/health

# Register the tag map first - /ingest can only resolve a TagId to a name
# once /tagmap has told it what that TagId means.
curl -X POST "http://127.0.0.1:8090/tagmap?device=test-unit" \
  -d 'data="Id";"Name"
74;"pto_active_minutes_revlive"'

curl -X POST "http://127.0.0.1:8090/ingest?device=test-unit" \
  -d 'data="TagId";"TimeInt";"TimeStr";"IsInitValue";"Value";"IQuality"
74;1786011939;"06/08/2026 12:25:39";1;0;0
74;1786014045;"06/08/2026 13:00:45";0;5;3'
```
The `/ingest` call should return `{"device":"test-unit","rows_written":2,...}`
— confirms the tag-map lookup and the DB round-trip.

Or with Docker Compose (API + its own DB together):
```bash
cd ingest
cp .env.example .env
docker compose up -d --build
```

## Exposing it to a real Flexy 205 for testing

The device is field-deployed and pushes over the internet
(`REQUESTHTTPX ... "https://..."`) — it has no route to `localhost` on a dev
machine. Pick ONE of these:

### Option A — ngrok (fastest, zero setup, good for "does this work at all")
```bash
uvicorn app.main:app --port 8090       # running locally
ngrok http 8090                        # separate terminal; free account needed
```
Gives an `https://<random>.ngrok-free.app` URL immediately, TLS included.
Free tier: URL changes every restart, and there's a per-minute connection
cap — fine for a one-off test, not for a standing endpoint.

### Option B — Cloudflare Tunnel (free, stable, good for repeated testing)
```bash
# Quick tunnel, no account/domain needed, new random URL each run:
cloudflared tunnel --url http://127.0.0.1:8090

# Or, with a domain on Cloudflare, a persistent named tunnel + fixed subdomain
```

### Option C — deploy it properly (Railway or similar)
The actual, permanent path: build `ingest/Dockerfile` as its own service on
whatever platform hosts the rest of the app, give it a public URL and a real
`INGEST_TOKEN`, and point the device's script at it. This is what the live
fleet actually uses today.

### Whichever option you pick
1. Set `INGEST_TOKEN` to a long random string.
2. Put the resulting public HTTPS URL + token into the device's script or
   config (see `WarriorScript/` for the device-side setup).
3. Watch it arrive: `SELECT * FROM raw_pushes ORDER BY received_at DESC
   LIMIT 5;` on the ingest database.

## Capturing a real push from a device (self-service, no contractor needed)

Some deployed units hardcode their destination directly in `program.bas`
rather than reading a config file — to capture a real push from one of those
you have to point the exact running script at your test endpoint,
temporarily, then point it back.

1. **Stand up the ingest API + expose it** (Option A/ngrok above is fastest
   for a one-off capture):
   ```bash
   cd ingest
   cp .env.example .env       # set INGEST_TOKEN to a random string, e.g. openssl rand -hex 16
   docker compose up -d --build
   ngrok http 8090            # copy the https://....ngrok-free.app URL
   ```
2. **Back up device state first**, via eCatcher's Files Transfer page:
   download the live `/usr/program.bas` and `/lastsync.txt`. Keep both
   somewhere safe. `/lastsync.txt` matters: restoring it later means the
   device resumes sending its normal destination exactly the backlog it
   missed during the test, instead of silently losing that window.
3. **Make a 2-line edit**, on a *copy* of the script (never edit your only
   saved-good copy) — change only the destination URL/auth header lines.
   Leave the device identity (`nm$`) and everything else untouched.
4. **Upload the edited script** to the device via eCatcher, replacing the
   running `program.bas`, then run/restart it so it re-executes from the top.
5. **Watch for it arriving** — within ~60s you should see a `/tagmap` POST
   (boot-time) then the first `/ingest` POST:
   ```sql
   SELECT id, received_at, endpoint, device, rows_written, rows_skipped
   FROM raw_pushes ORDER BY received_at DESC;
   -- then, once you've got one:
   SELECT body FROM raw_pushes WHERE endpoint = 'ingest' ORDER BY received_at DESC LIMIT 1;
   ```
   A couple of pushes is plenty — no need to leave it redirected for long.
6. **Revert immediately once you have what you need:**
   - Re-upload the original, untouched `program.bas`.
   - Restore the original `/lastsync.txt` you backed up in step 2.
   - Run/restart again and confirm it's back to pushing to its normal
     destination as before.
   - Double-check this step actually happened — this is the one step that
     matters for not leaving the live vehicle in a broken state.

## Netbiter GPS

GPS does not always come from the Flexy 205 — some vehicles' GPS units are on
a separate Netbiter-connected device, polled from Netbiter's own cloud API
by `poll_netbiter.py` (a separate long-running process from the push-receiver
API above, deployed as its own service). See
[netbiter-gps.md](netbiter-gps.md) and [polling-rate.md](polling-rate.md) for
details, and `app/inspect_netbiter_system.py` for the tool used to confirm
whether a given Netbiter system actually logs GPS before trusting it —
Netbiter's own device naming does not reliably match a vehicle's real
identity, always verify before wiring a new system in.

## Not yet done

- Per-device tokens (currently one shared `INGEST_TOKEN` for the whole
  fleet — fine for now, revisit if that's ever a real requirement).
- Structured tag-map parsing (`/tagmap`'s body is captured but not parsed
  into a tag list beyond what `/ingest` needs to resolve TagIds).
