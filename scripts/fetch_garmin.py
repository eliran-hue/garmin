#!/usr/bin/env python3
"""Pull data from the Garmin Connect Personal API and store the raw JSON.

Layout written under data/raw/:
  <endpoint>/<YYYY-MM-DD>.json   one file per endpoint per day
  activities/<activityId>.json   activity summary (+ details when available)
  static/<name>.json             profile settings, heart-rate zones

Usage:
  GARMIN_API_KEY=... python scripts/fetch_garmin.py               # last 7 days
  GARMIN_API_KEY=... python scripts/fetch_garmin.py --days 365    # backfill
Files older than --refresh-days are not re-fetched, so a long backfill can be
re-run and will continue where it stopped.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import time
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

ROOT = Path(os.environ.get("GARMIN_ROOT") or Path(__file__).resolve().parent.parent)
RAW = ROOT / "data" / "raw"
TZ = ZoneInfo(os.environ.get("GARMIN_TZ", "Asia/Jerusalem"))

BASE_URL = os.environ.get("GARMIN_BASE_URL", "https://personal.connectapi.garmin.com")
TOKEN_URL = BASE_URL + "/personalapitoken-service/personal-api/personal-api-key/token"

# Daily endpoints. "{d}" is replaced with the calendar date (YYYY-MM-DD).
# Range endpoints are called with start = end = the same day so every file is one day.
DAILY_ENDPOINTS: dict[str, tuple[str, dict]] = {
    "daily_summary": ("/usersummary-service/v2/dailysummaries", {"startDate": "{d}", "endDate": "{d}"}),
    "sleep": ("/sleep-service/sleep/dailySleep", {"date": "{d}"}),
    "sleep_summary": ("/sleep-service/sleep/dailySleepSummariesByDate", {"startDate": "{d}", "endDate": "{d}"}),
    "hrv": ("/hrv-service/hrv/{d}", {}),
    "heart_rate": ("/wellness-service/wellness/dailyHeartRate", {"date": "{d}"}),
    "body_battery": ("/wellness-service/wellness/bodyBattery/reports/daily", {"startDate": "{d}", "endDate": "{d}"}),
    "stress": ("/usersummary-service/stats/stress/daily/{d}/{d}", {}),
    "steps": ("/usersummary-service/stats/steps/daily/{d}/{d}", {}),
    "hydration": ("/usersummary-service/stats/hydration/daily/{d}/{d}", {}),
    "weight": ("/weight-service/weight/range/{d}/{d}", {"includeAll": "true"}),
    "weight_goal": ("/goal-service/goal/user/effective/weightgoal/{d}/{d}", {}),
    "spo2": ("/wellness-service/wellness/daily/spo2acclimation/{d}", {}),
    "fitness_age": ("/fitnessage-service/fitnessage/v2/{d}", {}),
    "wellness_activity": ("/wellnessactivity-service/activity/summary/range/{d}/{d}", {}),
    "food_logs": ("/nutrition-service/food/logs/{d}", {}),
    "menstrual_cycle": ("/periodichealth-service/menstrualcycle/summary/{d}", {}),
}

STATIC_ENDPOINTS = {
    "profile_settings": "/userprofile-service/userprofile/settings",
    "heart_rate_zones": "/biometric-service/heartRateZones/v2",
}

ACTIVITY_SEARCH = "/activitylist-service/activities/search/activities"
ACTIVITY_DETAIL = "/activity-service/activity/{id}"


class GarminClient:
    """Minimal client for the Personal API (key -> 24h bearer token -> GET)."""

    def __init__(self, api_key: str, throttle: float = 0.25):
        self.session = requests.Session()
        self.session.headers["Accept"] = "application/json"
        self.throttle = throttle
        self.calls = 0
        self.session.headers["Authorization"] = "Bearer " + self._token(api_key)

    def _token(self, api_key: str) -> str:
        r = requests.post(TOKEN_URL, headers={"Authorization": f"ApiKey {api_key}"}, timeout=30)
        if r.status_code != 200:
            raise SystemExit(f"Token request failed: HTTP {r.status_code} {r.text[:300]}")
        text = r.text.strip()
        try:
            body = r.json()
        except ValueError:
            return text.strip('"')
        if isinstance(body, str):
            return body
        for key in ("access_token", "accessToken", "token"):
            if isinstance(body, dict) and body.get(key):
                return body[key]
        raise SystemExit(f"Unexpected token response keys: {list(body)[:10]}")

    def get(self, path: str, params: dict | None = None):
        url = BASE_URL + path
        for attempt in range(6):
            time.sleep(self.throttle)
            self.calls += 1
            r = self.session.get(url, params=params, timeout=60)
            if r.status_code == 429 or r.status_code >= 500:
                wait = int(r.headers.get("Retry-After", 0) or 0) or min(300, 10 * 2 ** attempt)
                print(f"  HTTP {r.status_code} on {path}, waiting {wait}s", flush=True)
                time.sleep(wait)
                continue
            if r.status_code == 204 or not r.content:
                return None
            if r.status_code >= 400:
                raise ApiError(r.status_code, r.text[:200])
            return r.json()
        raise ApiError(429, "gave up after retries")


class ApiError(Exception):
    def __init__(self, status: int, text: str):
        super().__init__(f"HTTP {status}: {text}")
        self.status = status


def fill(value, d: str):
    if isinstance(value, str):
        return value.replace("{d}", d)
    return {k: fill(v, d) for k, v in value.items()}


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True))


def fetch_days(client: GarminClient, days: list[dt.date], refresh_after: dt.date, only: set[str] | None):
    errors: dict[str, int] = {}
    disabled: set[str] = set()  # endpoints that answer 403/404 every time (e.g. no device support)
    for day in days:
        d = day.isoformat()
        for name, (path, params) in DAILY_ENDPOINTS.items():
            if (only and name not in only) or name in disabled:
                continue
            out = RAW / name / f"{d}.json"
            if out.exists() and day < refresh_after:
                continue
            try:
                data = client.get(fill(path, d), fill(params, d))
            except ApiError as e:
                errors[name] = errors.get(name, 0) + 1
                if e.status in (401, 403, 404) and errors[name] >= 3:
                    print(f"  ! {name}: HTTP {e.status} three times, skipping this endpoint for this run")
                    disabled.add(name)
                elif errors[name] <= 3:
                    print(f"  ! {name} {d}: {e}")
                continue
            except requests.RequestException as e:
                errors[name] = errors.get(name, 0) + 1
                print(f"  ! {name} {d}: {e}")
                continue
            if data in (None, [], {}):
                continue
            write_json(out, data)
        print(f"{d} done ({client.calls} calls so far)", flush=True)
    return errors


def fetch_activities(client: GarminClient, start: dt.date, end: dt.date, with_details: bool):
    new = 0
    offset = 0
    while True:
        params = {"start": offset, "limit": 100, "startDate": start.isoformat(), "endDate": end.isoformat()}
        try:
            batch = client.get(ACTIVITY_SEARCH, params) or []
        except ApiError as e:
            print(f"  ! activities search: {e}")
            return new
        if isinstance(batch, dict):  # be tolerant of a wrapped list
            batch = next((v for v in batch.values() if isinstance(v, list)), [])
        for act in batch:
            aid = act.get("activityId")
            if not aid:
                continue
            out = RAW / "activities" / f"{aid}.json"
            record = {"summary": act}
            if out.exists():
                old = json.loads(out.read_text())
                if "details" in old:
                    record["details"] = old["details"]
            else:
                new += 1
            if with_details and "details" not in record:
                try:
                    record["details"] = client.get(ACTIVITY_DETAIL.format(id=aid))
                except ApiError as e:
                    print(f"  ! activity {aid} details: {e}")
            write_json(out, record)
        if len(batch) < 100:
            return new
        offset += 100


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7, help="how many days back to fetch (default 7)")
    ap.add_argument("--refresh-days", type=int, default=7,
                    help="re-fetch existing files for this many recent days (late watch syncs)")
    ap.add_argument("--only", help="comma separated endpoint names")
    ap.add_argument("--no-activity-details", action="store_true")
    args = ap.parse_args()

    key = os.environ.get("GARMIN_API_KEY", "").strip()
    if not key:
        print("GARMIN_API_KEY is not set", file=sys.stderr)
        return 2

    client = GarminClient(key)
    today = dt.datetime.now(TZ).date()
    days = [today - dt.timedelta(days=i) for i in range(args.days)]
    refresh_after = today - dt.timedelta(days=args.refresh_days)
    only = set(args.only.split(",")) if args.only else None

    for name, path in STATIC_ENDPOINTS.items():
        try:
            write_json(RAW / "static" / f"{name}.json", client.get(path))
        except ApiError as e:
            print(f"  ! {name}: {e}")

    errors = fetch_days(client, days, refresh_after, only)
    if not only or "activities" in only:
        new = fetch_activities(client, days[-1], today, not args.no_activity_details)
        print(f"activities: {new} new")

    (RAW / "_last_fetch.json").write_text(json.dumps({
        "fetched_at": dt.datetime.now(TZ).isoformat(timespec="seconds"),
        "days": args.days, "calls": client.calls, "errors": errors,
    }, indent=1))
    print(f"finished: {client.calls} API calls, errors per endpoint: {errors or 'none'}")
    # Fail the run only when nothing at all worked, so a single broken endpoint doesn't block the dashboard.
    total_endpoints = len(DAILY_ENDPOINTS) if not only else len(only)
    if errors and len(errors) >= total_endpoints and all(v >= len(days) for v in errors.values()):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
