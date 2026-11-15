#!/usr/bin/env python3
"""Synthetic raw data in Garmin-like shapes, for developing the dashboard without an API key.

  GARMIN_ROOT=/tmp/garmin-sample python scripts/make_sample_data.py
  GARMIN_ROOT=/tmp/garmin-sample python scripts/build_dataset.py
"""
import datetime as dt
import json
import math
import os
import random
from pathlib import Path

ROOT = Path(os.environ.get("GARMIN_ROOT") or "/tmp/garmin-sample")
RAW = ROOT / "data" / "raw"
random.seed(7)


def w(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data))


today = dt.date.today()
weight = 82.0
aid = 1000
for i in range(200, -1, -1):
    d = today - dt.timedelta(days=i)
    ds = d.isoformat()
    fatigue = 0.5 + 0.5 * math.sin(i / 9)
    sleep_s = int(random.gauss(7.0 - fatigue * 0.6, 0.6) * 3600)
    deep, rem = int(sleep_s * random.uniform(.13, .22)), int(sleep_s * random.uniform(.18, .25))
    awake = int(random.uniform(10, 45) * 60)
    start = int(dt.datetime.combine(d - dt.timedelta(days=1), dt.time(23, 0)).timestamp() * 1000) \
        + int(random.gauss(0, 40) * 60000)
    hrv = round(random.gauss(52 - fatigue * 8, 4))
    rhr = round(random.gauss(53 + fatigue * 3, 1.5))
    w(RAW / "sleep" / f"{ds}.json", {"dailySleepDTO": {
        "calendarDate": ds, "sleepTimeSeconds": sleep_s, "deepSleepSeconds": deep, "remSleepSeconds": rem,
        "lightSleepSeconds": sleep_s - deep - rem, "awakeSleepSeconds": awake,
        "sleepStartTimestampLocal": start, "sleepEndTimestampLocal": start + (sleep_s + awake) * 1000,
        "avgSleepStress": round(random.uniform(10, 30), 1), "averageRespirationValue": round(random.gauss(14, .6), 1),
        "averageSpO2Value": round(random.gauss(95, 1)),
        "sleepScores": {"overall": {"value": max(30, min(98, round(sleep_s / 3600 * 11 + random.gauss(0, 5))))}}},
        "avgOvernightHrv": hrv, "restingHeartRate": rhr, "bodyBatteryChange": round(random.gauss(55 - fatigue * 15, 8))})
    w(RAW / "hrv" / f"{ds}.json", {"hrvSummary": {"calendarDate": ds, "lastNightAvg": hrv, "weeklyAvg": hrv + 1,
                                                    "status": "BALANCED" if hrv > 45 else "UNBALANCED",
                                                    "baseline": {"balancedLow": 44, "balancedUpper": 58}}})
    hi = round(random.gauss(90 - fatigue * 20, 5))
    w(RAW / "daily_summary" / f"{ds}.json", [{
        "calendarDate": ds, "totalSteps": round(random.gauss(9000, 2500)), "restingHeartRate": rhr,
        "averageStressLevel": round(random.gauss(28 + fatigue * 8, 4)), "bodyBatteryHighestValue": min(100, hi),
        "bodyBatteryLowestValue": round(random.uniform(5, 30)), "activeKilocalories": round(random.gauss(600, 200)),
        "moderateIntensityMinutes": round(random.uniform(0, 40)), "vigorousIntensityMinutes": round(random.uniform(0, 30))}])
    w(RAW / "heart_rate" / f"{ds}.json", {"calendarDate": ds, "restingHeartRate": rhr, "maxHeartRate": 150,
                                          "heartRateValues": [[0, 60]] * 50})
    if random.random() < 0.6:
        weight += random.gauss(-0.02, 0.35)
        w(RAW / "weight" / f"{ds}.json", {"dateWeightList": [{"calendarDate": ds, "weight": round(weight * 1000),
                                                                "bodyFat": round(random.gauss(19, .4), 1),
                                                                "muscleMass": round(weight * 430), "bmi": round(weight / 3.24, 1)}]})
    for _ in range(1 if random.random() < 0.65 else 0):
        aid += 1
        kind = random.choice(["running", "running", "cycling", "strength_training", "walking"])
        dur = random.uniform(25, 90) * 60
        dist = dur * {"running": 2.8, "cycling": 7, "walking": 1.4}.get(kind, 0)
        w(RAW / "activities" / f"{aid}.json", {"summary": {
            "activityId": aid, "activityName": f"Sample {kind}", "activityType": {"typeKey": kind},
            "startTimeLocal": f"{ds} 0{random.randint(6, 9)}:15:00", "duration": dur, "distance": dist or None,
            "averageHR": round(random.gauss(140, 10)), "maxHR": 172, "calories": round(dur / 6),
            "aerobicTrainingEffect": round(random.uniform(1.5, 4.5), 1), "activityTrainingLoad": round(dur / 60 * random.uniform(1, 2.5)),
            "averageSpeed": dist / dur if dist else None}})
w(RAW / "_last_fetch.json", {"fetched_at": dt.datetime.now().isoformat(timespec="seconds"), "days": 200, "calls": 0, "errors": {}})
print("sample data written to", RAW)
