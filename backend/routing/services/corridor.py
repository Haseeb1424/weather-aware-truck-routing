"""Weather grid along the trip corridor, for the 0–48 h heatmap."""

from __future__ import annotations

import math
from datetime import datetime

from . import geometry as geo
from . import weather
from .geometry import LonLat
from .risk import risk_level

MAX_CELLS = 250
HOURS = 48
ROUTE_SAMPLE_M = 10_000
MIN_SPACING_DEG = 0.1
MIN_RADIUS_KM = 25


def _route_samples(lines: list[list[LonLat]]) -> list[LonLat]:
    pts: list[LonLat] = []
    for line in lines:
        if len(line) < 2:
            continue
        cum = geo.cumulative([geo.haversine_m(line[i], line[i + 1]) for i in range(len(line) - 1)])
        pts.extend(p for _, p in geo.resample(line, cum, ROUTE_SAMPLE_M))
    return pts


def _cells(samples: list[LonLat], spacing: float) -> set[tuple[int, int]]:
    radius_km = max(MIN_RADIUS_KM, 1.5 * spacing * 111)
    reach = int(math.ceil(radius_km / (spacing * 111 * 0.5))) + 1
    cells: set[tuple[int, int]] = set()
    for lon, lat in samples:
        cx, cy = round(lon / spacing), round(lat / spacing)
        for dx in range(-reach, reach + 1):
            for dy in range(-reach, reach + 1):
                key = (cx + dx, cy + dy)
                if key in cells:
                    continue
                center = (key[0] * spacing, key[1] * spacing)
                if geo.haversine_m(center, (lon, lat)) <= radius_km * 1000:
                    cells.add(key)
    return cells


def build_grid(lines: list[list[LonLat]]) -> tuple[list[LonLat], float]:
    """Grid cell centres near any route, with spacing chosen so the grid has at
    most MAX_CELLS cells (finer for short trips, coarser for cross-country)."""
    samples = _route_samples(lines)
    if not samples:
        return [], MIN_SPACING_DEG
    # Thin the samples before the search; they only need to be denser than the grid.
    spacing = MIN_SPACING_DEG
    while True:
        cells = _cells(samples[:: max(1, int(spacing * 111_000 / ROUTE_SAMPLE_M / 2))], spacing)
        if len(cells) <= MAX_CELLS:
            break
        spacing *= 1.2
    centers = [(round(x * spacing, 4), round(y * spacing, 4)) for x, y in sorted(cells)]
    return centers, spacing


def heatmap(lines: list[list[LonLat]], departure: datetime, load_lb: float) -> dict:
    centers, spacing = build_grid(lines)
    dep_ts = departure.timestamp()
    series = weather.fetch([(lat, lon) for lon, lat in centers], dep_ts, dep_ts + HOURS * 3600)

    cells = []
    for lon, lat in centers:
        s = series[weather.grid_key(lat, lon)]
        r, w, p, sn = [], [], [], []
        for h in range(HOURS + 1):
            c = s.at(dep_ts + h * 3600)
            w.append(round(c.wind_mph, 1))
            p.append(round(c.rain_in_hr, 3))
            sn.append(round(c.snow_in_hr, 3))
            r.append(risk_level(c.wind_mph, c.rain_in_hr, c.snow_in_hr, load_lb))
        cells.append({"lon": lon, "lat": lat, "risk": r, "wind": w, "rain": p, "snow": sn})

    return {"hours": HOURS, "spacing_deg": round(spacing, 4), "cells": cells}
