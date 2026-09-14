"""Parses the extracted `data` field of a Flexy 205 push.

Wire format confirmed from a real push on 2026-09-04 (see raw_pushes) — the
eWON posts multipart/form-data with a single file field named "data"; main.py
extracts that field's bytes before either function here ever sees them.

Two distinct exports share this envelope, distinguished by which endpoint
they hit:

- /ingest ($dtHL$ftT, the historical log): semicolon-delimited rows keyed by
  a numeric TagId, to keep the repeated push small.

      "TagId";"TimeInt";"TimeStr";"IsInitValue";"Value";"IQuality"
      99;1788519748;"04/09/2026 13:02:28";0;1;3

  The TagId has no name attached here - resolving it to a parameter name
  needs that vehicle's tag_map (see below).

- /tagmap ($dtTL$ftT, the eWON's own tag-config export): one row per
  configured tag, wide, but only the first two columns matter to us.

      "Id";"Name";"Description";"ServerName";...
      47;"pto_on_revlive";"";"S73&400";...

Both parsers are deliberately best-effort and non-destructive: a row that
doesn't parse is counted, never silently dropped, and the caller always
persists the raw body regardless (see main.py + schema.sql's raw_pushes
table).
"""
from __future__ import annotations

import csv
import io
from datetime import datetime, timezone


class ParseResult:
    def __init__(self):
        self.readings: list[dict] = []   # [{parameter, ts, value}]
        self.tags_seen: set[str] = set()
        self.unattributed_rows = 0

    def as_summary(self) -> dict:
        return {
            "rows_written": len(self.readings),
            "tags_seen": sorted(self.tags_seen),
            "rows_skipped_unattributed": self.unattributed_rows,
        }


def _rows(payload_text: str):
    """Yield each semicolon-delimited row, quote-aware (a plain str.split
    would break on the Description column's occasional embedded punctuation)."""
    for row in csv.reader(io.StringIO(payload_text), delimiter=";"):
        if row:
            yield row


def parse_push(payload_text: str, tag_map: dict[int, str]) -> ParseResult:
    """Parse one /ingest push's extracted `data` field.

    `tag_map` is that vehicle's {tag_id: name} lookup (see db upsert/select
    in main.py, populated from /tagmap pushes). A TagId with no entry yet -
    e.g. /ingest arriving before this vehicle's first /tagmap - is counted
    as unattributed, not dropped or guessed at.
    """
    result = ParseResult()
    for row in _rows(payload_text):
        if len(row) < 6:
            continue
        tag_id_raw, time_int_raw, _time_str, _is_init, value_raw, _quality = row[:6]

        if not tag_id_raw.lstrip("-").isdigit():
            continue  # the header row ("TagId";"TimeInt";...) - not a data row

        name = tag_map.get(int(tag_id_raw))
        if name is None:
            result.unattributed_rows += 1
            continue

        try:
            ts = datetime.fromtimestamp(int(time_int_raw), tz=timezone.utc)
            value = float(value_raw)
        except ValueError:
            result.unattributed_rows += 1
            continue

        result.readings.append({"parameter": name, "ts": ts, "value": value})
        result.tags_seen.add(name)

    return result


def parse_tag_list(payload_text: str) -> dict[int, str]:
    """Parse a /tagmap push's extracted `data` field into {tag_id: name}."""
    tags: dict[int, str] = {}
    for row in _rows(payload_text):
        if len(row) < 2:
            continue
        id_raw, name = row[0], row[1]
        if not id_raw.isdigit():
            continue  # the header row ("Id";"Name";...) - not a tag row
        tags[int(id_raw)] = name
    return tags
