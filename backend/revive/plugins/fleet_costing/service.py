"""Fleet fuel-costing and job-pricing: the PURE calculation core.

Everything here is plain Python: no database, no network, no FastAPI. That makes
it independently unit-testable and safe to reuse anywhere. The router (router.py)
fetches rows with queries.py and feeds them into these functions; the frontend
mirrors the quote maths in JavaScript so it can recompute instantly as the user
changes price, hours, and labour rate.

The functions are currency- and input-agnostic: they take a price and a labour
rate as plain numbers and never assume a currency symbol. Callers decide the
currency and how to display it.

Two honesty rules are baked in here rather than left to the caller:
  - Counter-reset handling. Total Fuel Used (l) and the run-minute counters are
    cumulative. A cumulative counter can reset to zero (device swap) or roll over,
    which shows up as a negative period delta; a corrupt reading can show up as an
    implausibly large delta. Both are discarded and reported as rejects, never
    added to the total. Idempotent ingestion does not fix this, so we handle it
    at read time.
  - The quote is a range. Rates come with a p25..p75 band, and quote_band returns
    a low and a high quote so the UI can show a range, never a single figure
    presented as fact.
"""
from __future__ import annotations


def percentile(values, q):
    """Linear-interpolation percentile of `values` at `q` (0..100).

    Matches the common "linear" method (the numpy default): rank r = q/100 *
    (n-1), interpolating between the two nearest order statistics. Returns None
    for an empty input. Nones in the input are ignored.
    """
    xs = sorted(v for v in values if v is not None)
    if not xs:
        return None
    if len(xs) == 1:
        return xs[0]
    rank = (q / 100.0) * (len(xs) - 1)
    lo = int(rank)
    hi = min(lo + 1, len(xs) - 1)
    frac = rank - lo
    return xs[lo] + (xs[hi] - xs[lo]) * frac


def rate_stats(rates):
    """Average plus a p25..p75 band for a list of fuel rates (l/h).

    Returns {"avg", "p25", "p75", "band": [p25, p75]}. Every field is None (and
    band is [None, None]) when there are no rates, so a truck with no fuel data
    never fabricates a zero.
    """
    xs = [r for r in rates if r is not None]
    if not xs:
        return {"avg": None, "p25": None, "p75": None, "band": [None, None]}
    p25 = percentile(xs, 25)
    p75 = percentile(xs, 75)
    return {"avg": sum(xs) / len(xs), "p25": p25, "p75": p75, "band": [p25, p75]}


def split_rate_stats(samples):
    """Split fuel-rate samples into working vs off-task and stat each side.

    `samples` is an iterable of (rate, working) pairs, where `working` is truthy
    when the truck was working (PTO engaged or a pump running) at that sample.
    Off-task is everything else, that is travel plus idle. Standby (PTO-IDLE) is
    NOT separated out yet: there is no reliable speed signal, so this is a
    deliberate two-way split. Callers surface offtask_includes_idle=true, and the
    seam to add a third state later is simply a third bucket here.
    """
    working = [r for r, w in samples if w and r is not None]
    offtask = [r for r, w in samples if not w and r is not None]
    return {"working": rate_stats(working), "offtask": rate_stats(offtask)}


def _clean_deltas(counter_points, max_delta):
    """Reset-aware period deltas of a cumulative counter.

    `counter_points` is an ordered list of {"bucket", "cmin", "cmax"} (the min
    and max of the counter within each period bucket). The delta for a bucket is
    its cmax minus the previous bucket's cmax (or its own cmin for the first
    bucket), the same reference the usage/sustainability SQL uses. A delta is
    discarded (set to 0 and reported) when it is negative (a reset or rollover) or
    above `max_delta` (an implausible spike). Pass max_delta=None to skip the
    ceiling check. Returns (deltas, rejects).
    """
    deltas = []
    rejects = []
    prev_cmax = None
    for p in counter_points:
        ref = prev_cmax if prev_cmax is not None else p["cmin"]
        delta = p["cmax"] - ref
        if delta < 0:
            rejects.append({"bucket": p["bucket"], "delta": delta,
                            "reason": "counter reset or rollover"})
            delta = 0.0
        elif max_delta is not None and delta > max_delta:
            rejects.append({"bucket": p["bucket"], "delta": delta,
                            "reason": "delta above per-bucket ceiling"})
            delta = 0.0
        deltas.append({"bucket": p["bucket"], "delta": delta})
        # Advance the baseline even for a rejected bucket: after a reset the new
        # baseline is the current (lower) counter value.
        prev_cmax = p["cmax"]
    return deltas, rejects


def bucket_litres(counter_points, max_delta):
    """Litres burned per period from the Total Fuel Used (l) counter.

    Returns {"buckets": [{"bucket", "litres"}], "litres": total, "rejects": [...]}
    with resets and spikes discarded (see _clean_deltas). The total is the sum of
    accepted litres only.
    """
    deltas, rejects = _clean_deltas(counter_points, max_delta)
    buckets = [{"bucket": d["bucket"], "litres": d["delta"]} for d in deltas]
    total = sum(d["delta"] for d in deltas)
    return {"buckets": buckets, "litres": total, "rejects": rejects}


def working_hours(counter_points, max_delta):
    """Operating hours from a run-minute counter (e.g. PTO Run Minute).

    Same reset-aware delta logic as bucket_litres, summed and converted from
    minutes to hours.
    """
    deltas, _ = _clean_deltas(counter_points, max_delta)
    return sum(d["delta"] for d in deltas) / 60.0


def job_quote(work_h, travel_h, working_rate, offtask_rate, price, labour_rate,
              litres=None):
    """One job quote at a single set of fuel rates.

    Formulas (currency-agnostic; price is per litre, labour_rate per hour):
        quote_fuel   = work_h * working_rate * price + travel_h * offtask_rate * price
        quote_labour = (work_h + travel_h) * labour_rate
        quote_total  = quote_fuel + quote_labour
    If `litres` is given (measured fuel over a period), actual_cost = litres *
    price is included too. Off-task covers travel plus idle for now.
    """
    quote_fuel = work_h * working_rate * price + travel_h * offtask_rate * price
    quote_labour = (work_h + travel_h) * labour_rate
    result = {
        "quote_fuel": quote_fuel,
        "quote_labour": quote_labour,
        "quote_total": quote_fuel + quote_labour,
    }
    if litres is not None:
        result["actual_cost"] = litres * price
    return result


def quote_band(work_h, travel_h, working_band, offtask_band, price, labour_rate):
    """A low-to-high quote range from the p25..p75 rate bands.

    `working_band` and `offtask_band` are [p25, p75] lists. The low quote uses the
    p25 rates (cheaper fuel use), the high quote uses the p75 rates. Labour is the
    same in both, so only the fuel component moves. Returns {"low", "high"}, or
    None if either band is missing (a truck with no fuel data has no quote).
    """
    if (working_band is None or offtask_band is None
            or working_band[0] is None or offtask_band[0] is None):
        return None
    low = job_quote(work_h, travel_h, working_band[0], offtask_band[0],
                    price, labour_rate)
    high = job_quote(work_h, travel_h, working_band[1], offtask_band[1],
                     price, labour_rate)
    return {"low": low, "high": high}
