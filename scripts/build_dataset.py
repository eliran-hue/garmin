#!/usr/bin/env python3
"""Turn data/raw/** into the small JSON files the dashboard reads (site/data/).

  daily.json       one row per day with the curated metrics (sleep, recovery, load, weight)
  activities.json  one row per activity
  explorer.json    every numeric field found in every daily endpoint, as time series
  meta.json        last fetch time, date range, which endpoints returned data

Field names are looked up by name anywhere in the response, so small changes in
Garmin's response shapes don't break the dashboard. Anything not picked up in
daily.json is still visible in the explorer tab.
"""
from __future__ import annotations

import json
import os
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(os.environ.get("GARMIN_ROOT") or Path(__file__).resolve().parent.parent)
RAW = ROOT / "data" / "raw"
OUT = ROOT / "site" / "data"
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def load(path: Path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def num(v):
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, str):
        try:
            return float(v)
        except ValueError:
            return None
    return None


def find(obj, *keys, depth=6):
    """First value for any of `keys` (tried in order) anywhere in obj."""
    for key in keys:
        hit = _find(obj, key, depth)
        if hit is not None:
            return hit
    return None


def _find(obj, key, depth):
    if depth < 0:
        return None
    if isinstance(obj, dict):
        if key in obj and obj[key] is not None:
            return obj[key]
        for v in obj.values():
            if isinstance(v, (dict, list)):
                hit = _find(v, key, depth - 1)
                if hit is not None:
                    return hit
    elif isinstance(obj, list):
        for v in obj[:5]:  # only look into the first few elements; long lists are time series
            hit = _find(v, key, depth - 1)
            if hit is not None:
                return hit
    return None


def find_num(sources, *keys):
    for src in sources:
        if src is None:
            continue
        v = num(find(src, *keys))
        if v is not None:
            return v
    return None


def sleep_score(src):
    if src is None:
        return None
    scores = find(src, "sleepScores")
    if isinstance(scores, dict):
        overall = scores.get("overall")
        if isinstance(overall, dict):
            v = num(overall.get("value"))
            if v is not None:
                return v
    return num(find(src, "overallSleepScore", "sleepScore", "sleepScoreValue"))


def grams_to_kg(v):
    if v is None:
        return None
    return round(v / 1000, 2) if v > 500 else round(v, 2)


def daily_row(day: str, raw: dict) -> dict:
    sleep = [raw.get("sleep"), raw.get("sleep_summary")]
    summary = raw.get("daily_summary")
    hrv = raw.get("hrv")
    weight = raw.get("weight")

    row = {"date": day}
    row["sleep_h"] = find_num(sleep, "sleepTimeSeconds")
    for name, key in (("deep_h", "deepSleepSeconds"), ("light_h", "lightSleepSeconds"),
                      ("rem_h", "remSleepSeconds"), ("awake_h", "awakeSleepSeconds")):
        row[name] = find_num(sleep, key)
    for k in ("sleep_h", "deep_h", "light_h", "rem_h", "awake_h"):
        if row[k] is not None:
            row[k] = round(row[k] / 3600, 2)
    row["sleep_score"] = next((s for s in (sleep_score(x) for x in sleep) if s is not None), None)
    start = find_num(sleep, "sleepStartTimestampLocal")
    end = find_num(sleep, "sleepEndTimestampLocal")
    # minutes after 18:00 local for bedtime, minutes after midnight for wake time (for consistency charts)
    row["bedtime_min"] = ((start / 60000) % 1440 - 1080) % 1440 if start else None
    row["wake_min"] = (end / 60000) % 1440 if end else None

    row["hrv"] = find_num([hrv], "lastNightAvg") or find_num(sleep, "avgOvernightHrv")
    row["hrv_week"] = find_num([hrv], "weeklyAvg")
    row["hrv_low"] = find_num([hrv], "balancedLow")
    row["hrv_high"] = find_num([hrv], "balancedUpper", "balancedHigh")
    status = find(hrv, "status") if hrv else None
    row["hrv_status"] = status if isinstance(status, str) else None

    row["rhr"] = find_num([raw.get("heart_rate"), summary] + sleep, "restingHeartRate", "restingHeartRateValue")
    row["bb_high"] = find_num([summary, raw.get("body_battery")], "bodyBatteryHighestValue", "highest")
    row["bb_low"] = find_num([summary, raw.get("body_battery")], "bodyBatteryLowestValue", "lowest")
    row["bb_charged"] = find_num([summary, raw.get("body_battery")], "bodyBatteryChargedValue", "charged")
    row["bb_drained"] = find_num([summary, raw.get("body_battery")], "bodyBatteryDrainedValue", "drained")
    row["bb_sleep_change"] = find_num(sleep, "bodyBatteryChange")
    row["stress"] = find_num([summary, raw.get("stress")], "averageStressLevel", "overallStressLevel")
    row["steps"] = find_num([summary, raw.get("steps")], "totalSteps")
    row["active_kcal"] = find_num([summary], "activeKilocalories")
    mod = find_num([summary], "moderateIntensityMinutes")
    vig = find_num([summary], "vigorousIntensityMinutes")
    row["intensity_min"] = (mod or 0) + 2 * (vig or 0) if (mod is not None or vig is not None) else None
    row["respiration"] = find_num(sleep + [summary], "averageRespirationValue", "avgSleepRespirationValue",
                                  "averageRespiration")
    row["spo2"] = find_num(sleep + [raw.get("spo2"), summary], "averageSpO2Value", "averageSpo2", "avgSleepSpO2",
                           "averageSpO2")
    row["sleep_stress"] = find_num(sleep, "avgSleepStress")

    row["weight_kg"] = grams_to_kg(find_num([weight], "weight"))
    row["body_fat"] = find_num([weight], "bodyFat")
    row["muscle_kg"] = grams_to_kg(find_num([weight], "muscleMass"))
    row["bmi"] = find_num([weight], "bmi")
    row["fitness_age"] = find_num([raw.get("fitness_age")], "fitnessAge")
    row["vo2max"] = find_num([raw.get("fitness_age"), summary], "vo2Max", "vo2MaxValue", "vo2MaxPreciseValue")
    row["hydration_ml"] = find_num([raw.get("hydration")], "valueInML", "intakeInML")
    for k, v in list(row.items()):
        if isinstance(v, float):
            row[k] = round(v, 2)
    return row


def activity_row(rec: dict) -> dict | None:
    s = rec.get("summary") or {}
    d = rec.get("details") or {}
    both = [s, d]
    start = find(s, "startTimeLocal") or find(d, "startTimeLocal")
    if not start:
        return None
    t = find(s, "activityType") or find(d, "activityTypeDTO", "activityType") or {}
    type_key = t.get("typeKey") if isinstance(t, dict) else str(t)
    dur = find_num(both, "duration", "movingDuration")
    dist = find_num(both, "distance")
    row = {
        "id": s.get("activityId"),
        "name": find(s, "activityName") or find(d, "activityName"),
        "type": type_key or "other",
        "start": str(start).replace("T", " ")[:16],
        "date": str(start)[:10],
        "duration_min": round(dur / 60, 1) if dur else None,
        "distance_km": round(dist / 1000, 2) if dist else None,
        "avg_hr": find_num(both, "averageHR", "averageHeartRate"),
        "max_hr": find_num(both, "maxHR", "maxHeartRate"),
        "kcal": find_num(both, "calories"),
        "te_aerobic": find_num(both, "aerobicTrainingEffect"),
        "te_anaerobic": find_num(both, "anaerobicTrainingEffect"),
        "load": find_num(both, "activityTrainingLoad", "trainingLoad"),
        "elev_gain": find_num(both, "elevationGain"),
        "avg_speed": find_num(both, "averageSpeed"),
        "vo2max": find_num(both, "vO2MaxValue", "vo2MaxValue"),
    }
    if row["avg_speed"] and row["distance_km"]:
        row["pace_min_km"] = round(1000 / row["avg_speed"] / 60, 2) if row["avg_speed"] > 0 else None
    for k, v in list(row.items()):
        if isinstance(v, float):
            row[k] = round(v, 2)
    return row


SKIP_KEY = re.compile(r"(^|\.)(\w*(Id|ID|PK|Pk)|id|userProfile\w*|\w*Timestamp\w*|\w*Gmt\w*|\w*Epoch\w*|version)$")


def flatten(obj, prefix="", out=None, depth=0):
    """Numeric leaves of a JSON document. Lists are followed only when short (not time series)."""
    if out is None:
        out = {}
    if depth > 6:
        return out
    if isinstance(obj, dict):
        for k, v in obj.items():
            flatten(v, f"{prefix}.{k}" if prefix else k, out, depth + 1)
    elif isinstance(obj, list):
        if len(obj) == 1:
            flatten(obj[0], prefix, out, depth + 1)
    else:
        v = num(obj) if not isinstance(obj, str) else None
        if v is not None and not SKIP_KEY.search(prefix):
            out[prefix] = v
    return out


def main():
    by_day: dict[str, dict] = defaultdict(dict)
    endpoints = sorted(p.name for p in RAW.iterdir() if p.is_dir() and p.name not in ("activities", "static")) \
        if RAW.exists() else []
    for ep in endpoints:
        for f in (RAW / ep).glob("*.json"):
            if DATE_RE.match(f.stem):
                data = load(f)
                if data is not None:
                    by_day[f.stem][ep] = data

    days = sorted(by_day)
    daily = [daily_row(d, by_day[d]) for d in days]

    activities = []
    for f in sorted((RAW / "activities").glob("*.json")) if (RAW / "activities").exists() else []:
        rec = load(f)
        row = activity_row(rec) if isinstance(rec, dict) else None
        if row:
            activities.append(row)
    activities.sort(key=lambda r: r["start"])

    # Explorer: columnar time series of every numeric field, per endpoint.
    explorer = {"dates": days, "endpoints": {}}
    index = {d: i for i, d in enumerate(days)}
    for ep in endpoints:
        series: dict[str, list] = {}
        for d in days:
            data = by_day[d].get(ep)
            if data is None:
                continue
            for path, v in flatten(data).items():
                col = series.setdefault(path, [None] * len(days))
                col[index[d]] = round(v, 3) if isinstance(v, float) else v
        keep = {}
        for path, col in series.items():
            vals = [v for v in col if v is not None]
            if len(vals) >= 2 and len(set(vals)) > 1:
                keep[path] = col
        if keep:
            explorer["endpoints"][ep] = keep

    coverage = {ep: sum(1 for d in days if ep in by_day[d]) for ep in endpoints}
    meta = {
        "last_fetch": load(RAW / "_last_fetch.json"),
        "first_day": days[0] if days else None,
        "last_day": days[-1] if days else None,
        "days": len(days),
        "activities": len(activities),
        "coverage": coverage,
        "heart_rate_zones": load(RAW / "static" / "heart_rate_zones.json"),
    }

    OUT.mkdir(parents=True, exist_ok=True)
    dump = lambda name, obj: (OUT / name).write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))
    dump("daily.json", daily)
    dump("activities.json", activities)
    dump("explorer.json", explorer)
    dump("meta.json", meta)
    print(f"built: {len(daily)} days, {len(activities)} activities, "
          f"{sum(len(v) for v in explorer['endpoints'].values())} explorer series")


if __name__ == "__main__":
    main()
