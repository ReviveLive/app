"""Unit tests for the pure calculation core. No DB, no network.

Run from backend/ with:  .venv\\Scripts\\python.exe -m pytest
"""
import math

from revive.plugins.fleet_costing import service


# --- percentile -------------------------------------------------------------

def test_percentile_empty_is_none():
    assert service.percentile([], 50) is None


def test_percentile_single_value():
    assert service.percentile([7.0], 25) == 7.0


def test_percentile_linear_interpolation():
    xs = [10, 20, 30, 40]
    # numpy's linear method: p25 = 17.5, p50 = 25, p75 = 32.5
    assert service.percentile(xs, 25) == 17.5
    assert service.percentile(xs, 50) == 25.0
    assert service.percentile(xs, 75) == 32.5


def test_percentile_ignores_none():
    assert service.percentile([None, 10, None, 20], 50) == 15.0


# --- rate_stats -------------------------------------------------------------

def test_rate_stats_empty_all_none():
    s = service.rate_stats([])
    assert s == {"avg": None, "p25": None, "p75": None, "band": [None, None]}


def test_rate_stats_avg_and_band():
    s = service.rate_stats([10, 20, 30, 40])
    assert s["avg"] == 25.0
    assert s["band"] == [17.5, 32.5]
    assert s["p25"] == 17.5 and s["p75"] == 32.5


# --- split_rate_stats -------------------------------------------------------

def test_split_rate_stats_splits_working_and_offtask():
    samples = [(30, True), (32, True), (34, True), (8, False), (10, False), (12, False)]
    s = service.split_rate_stats(samples)
    assert s["working"]["avg"] == 32.0
    assert s["offtask"]["avg"] == 10.0
    # bands are ordered p25 <= p75
    assert s["working"]["band"][0] <= s["working"]["band"][1]
    assert s["offtask"]["band"][0] <= s["offtask"]["band"][1]


def test_split_rate_stats_no_working_samples():
    s = service.split_rate_stats([(8, False), (10, False)])
    assert s["working"]["avg"] is None
    assert s["working"]["band"] == [None, None]
    assert s["offtask"]["avg"] == 9.0


# --- bucket_litres and counter-reset handling -------------------------------

def test_bucket_litres_simple_increasing_counter():
    points = [
        {"bucket": "2026-06-01", "cmin": 100.0, "cmax": 150.0},  # 150-100 = 50
        {"bucket": "2026-06-02", "cmin": 150.0, "cmax": 210.0},  # 210-150 = 60
        {"bucket": "2026-06-03", "cmin": 210.0, "cmax": 280.0},  # 280-210 = 70
    ]
    out = service.bucket_litres(points, max_delta=1000)
    assert out["litres"] == 180.0
    assert [b["litres"] for b in out["buckets"]] == [50.0, 60.0, 70.0]
    assert out["rejects"] == []


def test_bucket_litres_rejects_negative_delta_from_reset():
    points = [
        {"bucket": "2026-06-01", "cmin": 100.0, "cmax": 150.0},   # +50
        {"bucket": "2026-06-02", "cmin": 5.0,   "cmax": 20.0},    # counter reset: 20-150 = -130
        {"bucket": "2026-06-03", "cmin": 20.0,  "cmax": 45.0},    # +25 from new baseline (45-20)
    ]
    out = service.bucket_litres(points, max_delta=1000)
    # The reset bucket contributes 0 and is reported; the total is 50 + 0 + 25.
    assert out["litres"] == 75.0
    assert [b["litres"] for b in out["buckets"]] == [50.0, 0.0, 25.0]
    assert len(out["rejects"]) == 1
    assert out["rejects"][0]["bucket"] == "2026-06-02"
    assert "reset" in out["rejects"][0]["reason"]


def test_bucket_litres_rejects_delta_above_ceiling():
    points = [
        {"bucket": "2026-06-01", "cmin": 100.0, "cmax": 150.0},     # +50
        {"bucket": "2026-06-02", "cmin": 150.0, "cmax": 9999.0},    # +9849, implausible
        {"bucket": "2026-06-03", "cmin": 9999.0, "cmax": 10049.0},  # +50 from the spike's cmax
    ]
    out = service.bucket_litres(points, max_delta=1000)
    assert out["litres"] == 100.0
    assert [b["litres"] for b in out["buckets"]] == [50.0, 0.0, 50.0]
    assert len(out["rejects"]) == 1
    assert out["rejects"][0]["bucket"] == "2026-06-02"
    assert "ceiling" in out["rejects"][0]["reason"]


def test_bucket_litres_empty():
    out = service.bucket_litres([], max_delta=1000)
    assert out == {"buckets": [], "litres": 0.0, "rejects": []}


# --- working_hours ----------------------------------------------------------

def test_working_hours_converts_minutes_to_hours():
    points = [
        {"bucket": "2026-06-01", "cmin": 0.0,   "cmax": 120.0},   # +120 min
        {"bucket": "2026-06-02", "cmin": 120.0, "cmax": 300.0},   # +180 min
    ]
    # 300 minutes total -> 5.0 hours
    assert service.working_hours(points, max_delta=100000) == 5.0


def test_working_hours_ignores_reset():
    points = [
        {"bucket": "2026-06-01", "cmin": 0.0,  "cmax": 600.0},   # +600 min
        {"bucket": "2026-06-02", "cmin": 0.0,  "cmax": 60.0},    # reset: -540 rejected -> 0
    ]
    assert service.working_hours(points, max_delta=100000) == 10.0


# --- job_quote --------------------------------------------------------------

def test_job_quote_arithmetic():
    q = service.job_quote(work_h=10, travel_h=4, working_rate=30, offtask_rate=10,
                          price=1.5, labour_rate=50)
    # fuel = 10*30*1.5 + 4*10*1.5 = 450 + 60 = 510
    # labour = (10+4)*50 = 700
    assert q["quote_fuel"] == 510.0
    assert q["quote_labour"] == 700.0
    assert q["quote_total"] == 1210.0
    assert "actual_cost" not in q


def test_job_quote_actual_cost_when_litres_given():
    q = service.job_quote(work_h=0, travel_h=0, working_rate=0, offtask_rate=0,
                          price=1.5, labour_rate=0, litres=200)
    assert q["actual_cost"] == 300.0


# --- quote_band -------------------------------------------------------------

def test_quote_band_low_below_high():
    band = service.quote_band(
        work_h=10, travel_h=4,
        working_band=[27.0, 36.0], offtask_band=[7.0, 12.0],
        price=1.5, labour_rate=50,
    )
    assert band["low"]["quote_total"] < band["high"]["quote_total"]
    # labour is identical in both; only fuel moves with the rate band
    assert band["low"]["quote_labour"] == band["high"]["quote_labour"] == 700.0


def test_quote_band_none_when_no_fuel_data():
    assert service.quote_band(10, 4, [None, None], [None, None], 1.5, 50) is None
    assert service.quote_band(10, 4, None, [7.0, 12.0], 1.5, 50) is None
