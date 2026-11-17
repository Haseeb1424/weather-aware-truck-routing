"""Small geodesic helpers. Coordinates are (lon, lat) to match GeoJSON."""

from __future__ import annotations

import math
from bisect import bisect_right
from collections import defaultdict

EARTH_RADIUS_M = 6_371_008.8
METERS_PER_MILE = 1609.344

LonLat = tuple[float, float]


def haversine_m(a: LonLat, b: LonLat) -> float:
    lon1, lat1, lon2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(h)))


def cumulative(values: list[float]) -> list[float]:
    out = [0.0]
    for v in values:
        out.append(out[-1] + v)
    return out


def interpolate_along(coords: list[LonLat], cum: list[float], target: float) -> tuple[LonLat, int, float]:
    """Point at cumulative distance/time ``target`` along the path.

    Returns (point, segment index, fraction within the segment).
    """
    if target <= cum[0]:
        return coords[0], 0, 0.0
    if target >= cum[-1]:
        return coords[-1], len(coords) - 2, 1.0
    i = bisect_right(cum, target) - 1
    span = cum[i + 1] - cum[i]
    f = (target - cum[i]) / span if span > 0 else 0.0
    a, b = coords[i], coords[i + 1]
    return (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f), i, f


def value_at(cum: list[float], values: list[float], seg: int, frac: float) -> float:
    """Interpolate a per-vertex cumulative quantity at (segment, fraction)."""
    return values[seg] + (values[seg + 1] - values[seg]) * frac


def destination_point(origin: LonLat, bearing_deg: float, distance_m: float) -> LonLat:
    lon1, lat1 = math.radians(origin[0]), math.radians(origin[1])
    brng = math.radians(bearing_deg)
    d = distance_m / EARTH_RADIUS_M
    lat2 = math.asin(math.sin(lat1) * math.cos(d) + math.cos(lat1) * math.sin(d) * math.cos(brng))
    lon2 = lon1 + math.atan2(
        math.sin(brng) * math.sin(d) * math.cos(lat1), math.cos(d) - math.sin(lat1) * math.sin(lat2)
    )
    return (math.degrees(lon2), math.degrees(lat2))


def bearing_deg(a: LonLat, b: LonLat) -> float:
    lon1, lat1, lon2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    y = math.sin(lon2 - lon1) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(lon2 - lon1)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def simplify_indices(coords: list[LonLat], tolerance_deg: float) -> list[int]:
    """Ramer–Douglas–Peucker (iterative). Returns indices of kept vertices so
    callers can carry per-vertex data (e.g. timestamps) along."""
    n = len(coords)
    if n <= 2:
        return list(range(n))
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    tol2 = tolerance_deg * tolerance_deg
    while stack:
        start, end = stack.pop()
        ax, ay = coords[start]
        bx, by = coords[end]
        dx, dy = bx - ax, by - ay
        seg2 = dx * dx + dy * dy
        max_d2, idx = 0.0, -1
        for i in range(start + 1, end):
            px, py = coords[i]
            if seg2 == 0:
                d2 = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg2))
                d2 = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if d2 > max_d2:
                max_d2, idx = d2, i
        if max_d2 > tol2 and idx != -1:
            keep[idx] = True
            stack.append((start, idx))
            stack.append((idx, end))
    return [i for i, k in enumerate(keep) if k]


def resample(coords: list[LonLat], cum_m: list[float], step_m: float) -> list[tuple[float, LonLat]]:
    """Points every ``step_m`` along the path, as (distance, point)."""
    out = []
    d = 0.0
    total = cum_m[-1]
    while d < total:
        out.append((d, interpolate_along(coords, cum_m, d)[0]))
        d += step_m
    out.append((total, coords[-1]))
    return out


class PointIndex:
    """Grid hash for "is any indexed point within r metres?" queries."""

    def __init__(self, cell_deg: float = 0.01):
        self.cell = cell_deg
        self.buckets: dict[tuple[int, int], list[tuple[LonLat, float]]] = defaultdict(list)

    def _key(self, p: LonLat) -> tuple[int, int]:
        return (int(math.floor(p[0] / self.cell)), int(math.floor(p[1] / self.cell)))

    def add(self, p: LonLat, tag: float = 0.0) -> None:
        self.buckets[self._key(p)].append((p, tag))

    def near(self, p: LonLat, radius_m: float):
        kx, ky = self._key(p)
        span = 1 + int(radius_m / (self.cell * 111_000 * max(0.2, math.cos(math.radians(p[1])))))
        for x in range(kx - span, kx + span + 1):
            for y in range(ky - span, ky + span + 1):
                for q, tag in self.buckets.get((x, y), ()):
                    if haversine_m(p, q) <= radius_m:
                        yield q, tag
