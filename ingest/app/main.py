"""Live-ingest API for the Flexy 205 fleet.

Receives program.bas's DoSync push (POST /ingest?device=<nm>) and its
boot-time tag-map registration (POST /tagmap?device=<nm>), matching the
routes program.bas already calls (see iurl$/tm$ in WarriorScript/program.bas).
Writes into the same readings/vehicles shape the sales-demo backend uses.

Both routes arrive as multipart/form-data (a file field named "data") - see
parser.py's docstring for the confirmed wire format of each.

Run locally:
    uvicorn app.main:app --reload --port 8090

See README.md for how to expose this to a real device for testing.
"""
from __future__ import annotations

from fastapi import FastAPI, Header, HTTPException, Query, Request

from .config import INGEST_TOKEN
from .db import connect
from .parser import parse_push, parse_tag_list

app = FastAPI(title="Revive Live — ingest")

_VEHICLE_UPSERT = """
INSERT INTO vehicles (vehicle_id, name, source)
VALUES (%(vehicle_id)s, %(vehicle_id)s, 'live')
ON CONFLICT (vehicle_id) DO NOTHING
"""

_READING_INSERT = """
INSERT INTO readings (vehicle_id, ts, parameter, value)
VALUES (%(vehicle_id)s, %(ts)s, %(parameter)s, %(value)s)
ON CONFLICT (vehicle_id, ts, parameter) DO NOTHING
"""

_RAW_PUSH_INSERT = """
INSERT INTO raw_pushes (endpoint, device, rows_written, rows_skipped, body)
VALUES (%(endpoint)s, %(device)s, %(rows_written)s, %(rows_skipped)s, %(body)s)
"""

_TAG_MAP_SELECT = """
SELECT tag_id, name FROM tag_map WHERE vehicle_id = %(vehicle_id)s
"""

_TAG_MAP_UPSERT = """
INSERT INTO tag_map (vehicle_id, tag_id, name, updated_at)
VALUES (%(vehicle_id)s, %(tag_id)s, %(name)s, now())
ON CONFLICT (vehicle_id, tag_id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
"""


def _check_auth(authorization: str | None) -> None:
    """Matches warrior.cfg's INGEST_HDR=Authorization=Bearer <token>."""
    if not INGEST_TOKEN:
        # No token configured -> auth disabled. Fine for a first local test,
        # never for anything internet-reachable — see non-negotiable #1 in
        # demo/CLAUDE.md (location data is personal data).
        return
    expected = f"Bearer {INGEST_TOKEN}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="bad or missing Authorization header")


async def _extract_payload(request: Request, raw_body: str) -> str:
    """Pull the actual CSV payload out of the request.

    The Flexy posts multipart/form-data with the payload in a file field
    named "data" (confirmed 2026-09-04 — see parser.py). Falls back to a
    bare `data=<payload>` body (this service's own README smoke-test curl
    example) when the request isn't multipart, so manual/local testing
    without a real device still works.
    """
    content_type = request.headers.get("content-type", "")
    if "multipart/form-data" in content_type:
        form = await request.form()
        data_field = form.get("data")
        if data_field is not None:
            payload_bytes = await data_field.read()
            return payload_bytes.decode("utf-8", errors="replace")
        return raw_body

    body = raw_body.strip()
    if body.startswith("data="):
        body = body[len("data="):]
    return body


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/ingest")
async def ingest(
    request: Request,
    device: str = Query(...),
    authorization: str | None = Header(default=None),
):
    _check_auth(authorization)
    raw_body = (await request.body()).decode("utf-8", errors="replace")
    payload = await _extract_payload(request, raw_body)

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(_VEHICLE_UPSERT, {"vehicle_id": device})
            cur.execute(_TAG_MAP_SELECT, {"vehicle_id": device})
            tag_map = {tag_id: name for tag_id, name in cur.fetchall()}

            result = parse_push(payload, tag_map)

            for reading in result.readings:
                cur.execute(_READING_INSERT, {"vehicle_id": device, **reading})
            cur.execute(_RAW_PUSH_INSERT, {
                "endpoint": "ingest",
                "device": device,
                "rows_written": len(result.readings),
                "rows_skipped": result.unattributed_rows,
                "body": raw_body,
            })
        conn.commit()

    return {"device": device, **result.as_summary()}


@app.post("/tagmap")
async def tagmap(
    request: Request,
    device: str = Query(...),
    authorization: str | None = Header(default=None),
):
    """Registers a device and stores its tag catalog (numeric TagId -> name)
    so /ingest can resolve the historical-log push's bare TagIds. Re-sent on
    every boot; upserted, so a later catalog change overwrites the name for
    that TagId rather than accumulating stale rows."""
    _check_auth(authorization)
    raw_body = (await request.body()).decode("utf-8", errors="replace")
    payload = await _extract_payload(request, raw_body)

    tags = parse_tag_list(payload)

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(_VEHICLE_UPSERT, {"vehicle_id": device})
            for tag_id, name in tags.items():
                cur.execute(_TAG_MAP_UPSERT, {
                    "vehicle_id": device, "tag_id": tag_id, "name": name,
                })
            cur.execute(_RAW_PUSH_INSERT, {
                "endpoint": "tagmap",
                "device": device,
                "rows_written": len(tags),
                "rows_skipped": None,
                "body": raw_body,
            })
        conn.commit()

    return {"device": device, "status": "registered", "tags_registered": len(tags)}
