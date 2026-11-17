"""Hourly forecasts from Open-Meteo, batched, deduplicated and cached.

Units requested: wind in mph, precipitation in inches. Open-Meteo's hourly
``rain``/``showers``/``snowfall`` are totals for the *preceding* hour, so they are
already in/hr rates; wind is an instantaneous value.
"""

from __future__ import annotations

import logging
import math
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone

import requests
from django.conf import settings
from django.core.cache import cache

log = logging.getLogger(__name__)

GRID_DEG = 0.05  # ≈5 km — finer than the forecast models' resolution, so nothing is lost
BATCH_SIZE = 100
HOURLY_VARS = "wind_speed_10m,wind_gusts_10m,rain,showers,snowfall"
CACHE_TTL_S = 30 * 60
HOUR = 3600


class WeatherError(Exception):
    pass


@dataclass(frozen=True)
class Conditions:
    wind_mph: float
    gust_mph: float
    rain_in_hr: float
    snow_in_hr: float

    def as_dict(self) -> dict:
        return {
            "wind_mph": round(self.wind_mph, 1),
            "gust_mph": round(self.gust_mph, 1),
            "rain_in_hr": round(self.rain_in_hr, 3),
            "snow_in_hr": round(self.snow_in_hr, 3),
        }


@dataclass
class Series:
    """Hourly series for one location; ``start`` is the first timestamp (unix s)."""

    start: int
    wind: list[float]
    gust: list[float]
    rain: list[float]  # rain + showers
    snow: list[float]

    def at(self, ts: float) -> Conditions:
        """Conditions at an arbitrary instant.

        Wind is linearly interpolated between the surrounding hours. Precipitation
        uses the hourly bucket that *contains* ``ts`` — the value stamped at the
        next full hour, since it is the total for the hour leading up to it.
        """
        n = len(self.wind)
        pos = (ts - self.start) / HOUR
        if pos < -1 or pos > n:
            raise WeatherError("Requested time is outside the fetched forecast window.")
        pos = min(max(pos, 0.0), n - 1)
        i = int(math.floor(pos))
        j = min(i + 1, n - 1)
        f = pos - i
        bucket = min(int(math.ceil(pos)), n - 1)
        return Conditions(
            wind_mph=_lerp(self.wind[i], self.wind[j], f),
            gust_mph=_lerp(self.gust[i], self.gust[j], f),
            rain_in_hr=self.rain[bucket],
            snow_in_hr=self.snow[bucket],
        )


def _lerp(a: float, b: float, f: float) -> float:
    return a + (b - a) * f


def grid_key(lat: float, lon: float) -> tuple[float, float]:
    return (round(round(lat / GRID_DEG) * GRID_DEG, 4), round(round(lon / GRID_DEG) * GRID_DEG, 4))


def hour_floor(ts: float) -> int:
    return int(ts // HOUR * HOUR)


def _fmt_hour(ts: int) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M")


def _num(values: list) -> list[float]:
    return [float(v) if v is not None else 0.0 for v in values]


def _fetch_batch(keys: list[tuple[float, float]], start: int, end: int) -> dict:
    params = {
        "latitude": ",".join(f"{k[0]:.4f}" for k in keys),
        "longitude": ",".join(f"{k[1]:.4f}" for k in keys),
        "hourly": HOURLY_VARS,
        "wind_speed_unit": "mph",
        "precipitation_unit": "inch",
        "timezone": "GMT",
        "timeformat": "unixtime",
        "start_hour": _fmt_hour(start),
        "end_hour": _fmt_hour(end),
    }
    if settings.OPEN_METEO_API_KEY:
        params["apikey"] = settings.OPEN_METEO_API_KEY

    # The free tier allows ~600 location-lookups per minute. Hitting that is
    # temporary, so wait and retry a couple of times; hourly/daily limits are not
    # worth waiting for and fail straight away.
    delays = list(settings.WEATHER_RETRY_DELAYS_S)
    while True:
        try:
            resp = requests.get(settings.OPEN_METEO_URL, params=params, timeout=settings.HTTP_TIMEOUT_S)
        except requests.RequestException as exc:
            raise WeatherError(f"Weather service unreachable: {exc}") from exc
        if resp.status_code == 200:
            break
        try:
            msg = resp.json().get("reason")
        except ValueError:
            msg = None
        if resp.status_code == 429 and "minut" in (msg or "").lower() and delays:
            delay = delays.pop(0)
            log.info("Open-Meteo per-minute limit hit; retrying in %ss", delay)
            time.sleep(delay)
            continue
        if resp.status_code == 429:
            msg = (msg or "Weather service rate limit reached") + " (free forecast service is busy — please retry shortly)"
        raise WeatherError(msg or f"Weather service error ({resp.status_code})")
    data = resp.json()
    items = data if isinstance(data, list) else [data]
    out = {}
    for key, item in zip(keys, items):
        h = item["hourly"]
        rain, showers = _num(h["rain"]), _num(h.get("showers") or [0] * len(h["rain"]))
        out[key] = Series(
            start=int(h["time"][0]),
            wind=_num(h["wind_speed_10m"]),
            gust=_num(h["wind_gusts_10m"]),
            rain=[r + s for r, s in zip(rain, showers)],
            snow=_num(h["snowfall"]),
        )
    return out


def fetch(points: list[tuple[float, float]], start_ts: float, end_ts: float) -> dict[tuple[float, float], Series]:
    """Hourly series for every (lat, lon) in ``points`` covering [start_ts, end_ts].

    Returns a mapping keyed by :func:`grid_key`. Points that round to the same
    grid cell share one series.
    """
    start = hour_floor(start_ts) - HOUR  # one hour before so the first bucket exists
    end = hour_floor(end_ts) + 2 * HOUR
    keys = list(dict.fromkeys(grid_key(lat, lon) for lat, lon in points))

    result: dict[tuple[float, float], Series] = {}
    missing = []
    for key in keys:
        cached = cache.get(_cache_key(key, start, end))
        if cached is not None:
            result[key] = cached
        else:
            missing.append(key)

    batches = [missing[i : i + BATCH_SIZE] for i in range(0, len(missing), BATCH_SIZE)]
    if batches:
        with ThreadPoolExecutor(max_workers=4) as pool:
            for fetched in pool.map(lambda b: _fetch_batch(b, start, end), batches):
                for key, series in fetched.items():
                    cache.set(_cache_key(key, start, end), series, CACHE_TTL_S)
                    result[key] = series
    return result


def _cache_key(key: tuple[float, float], start: int, end: int) -> str:
    return f"om:{key[0]}:{key[1]}:{start}:{end}"
