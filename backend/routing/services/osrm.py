"""Routing via OSRM, plus synthesis of alternative routes.

The public OSRM server frequently returns only one or two alternatives for long
trips. When it does, we generate candidates through via points offset to either
side of the trip and keep the fastest ones that are genuinely different roads.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import requests
from django.conf import settings
from django.core.cache import cache

from . import geometry as geo
from .geometry import LonLat

log = logging.getLogger(__name__)

# Trucks are speed-limited; the public OSRM profile is a car. Capping every
# segment at 65 mph turns car ETAs into realistic truck ETAs.
TRUCK_MAX_SPEED_MPS = 65 * geo.METERS_PER_MILE / 3600

MAX_DURATION_RATIO = 1.6  # alternatives slower than this vs the fastest are dropped
MAX_OVERLAP = 0.75  # alternatives sharing more than this fraction of road are dropped
SAMPLE_STEP_M = 1_000
OVERLAP_RADIUS_M = 250
SPUR_RADIUS_M = 150
SPUR_MIN_SEPARATION_M = 4_000
SPUR_MAX_LENGTH_M = 2_000
ROUTE_CACHE_TTL_S = 60 * 60


class RoutingError(Exception):
    pass


class NoRouteError(RoutingError):
    """The locations are valid but no road connects them (e.g. across an ocean)."""


@dataclass
class Route:
    coords: list[LonLat]
    cum_m: list[float]  # cumulative distance at each vertex
    cum_s: list[float]  # cumulative truck travel time at each vertex
    summary: str  # main roads, e.g. "I 45, US 287"
    _samples: list[tuple[float, LonLat]] | None = None

    @property
    def distance_m(self) -> float:
        return self.cum_m[-1]

    @property
    def duration_s(self) -> float:
        return self.cum_s[-1]

    @property
    def samples(self) -> list[tuple[float, LonLat]]:
        if self._samples is None:
            self._samples = geo.resample(self.coords, self.cum_m, SAMPLE_STEP_M)
        return self._samples


def decode_polyline6(encoded: str) -> list[LonLat]:
    """Decode a Google-encoded polyline with 1e-6 precision (OSRM's polyline6)."""
    coords: list[LonLat] = []
    index = lat = lon = 0
    n = len(encoded)
    while index < n:
        for is_lon in (False, True):
            shift = result = 0
            while True:
                b = ord(encoded[index]) - 63
                index += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            delta = ~(result >> 1) if result & 1 else result >> 1
            if is_lon:
                lon += delta
            else:
                lat += delta
        coords.append((lon / 1e6, lat / 1e6))
    return coords


def _parse_route(raw: dict, waypoints: list[dict] | None = None) -> Route:
    geom = raw["geometry"]
    coords = decode_polyline6(geom) if isinstance(geom, str) else [tuple(c) for c in geom["coordinates"]]
    dists: list[float] = []
    durs: list[float] = []
    for leg in raw["legs"]:
        ann = leg.get("annotation") or {}
        dists.extend(ann.get("distance", []))
        durs.extend(ann.get("duration", []))
    has_annotations = len(dists) == len(coords) - 1 and len(durs) == len(dists)
    if not has_annotations:
        # Defensive: derive distances and spread the total duration by distance.
        dists = [geo.haversine_m(coords[i], coords[i + 1]) for i in range(len(coords) - 1)]
        total = sum(dists) or 1.0
        durs = [raw["duration"] * d / total for d in dists]
    if len(raw["legs"]) == 2:
        # Via-point route: cut out any out-and-back detour at the via point.
        if has_annotations:
            via_index = len(raw["legs"][0]["annotation"]["distance"])
        else:
            via_index = _nearest_index(coords, tuple(waypoints[1]["location"])) if waypoints else -1
        coords, dists, durs = trim_via_detour(coords, dists, durs, via_index)
    capped = [max(t, d / TRUCK_MAX_SPEED_MPS) for d, t in zip(dists, durs)]
    return Route(coords=coords, cum_m=geo.cumulative(dists), cum_s=geo.cumulative(capped), summary=_road_summary(raw))


def _nearest_index(coords: list[LonLat], point: LonLat) -> int:
    return min(range(len(coords)), key=lambda i: (coords[i][0] - point[0]) ** 2 + (coords[i][1] - point[1]) ** 2)


def trim_via_detour(coords: list[LonLat], dists: list[float], durs: list[float], via_index: int, tol_m: float = 60.0):
    """Remove an out-and-back detour around the via point.

    A synthetic via point often snaps to a side road: the route drives in, turns
    around at the via point and drives back out the same way. Walk outward from
    the via point while the inbound path (before it) is retraced by the outbound
    path (after it), then splice the two ends together.
    """
    if not 0 < via_index < len(coords) - 1:
        return coords, dists, durs
    after = geo.PointIndex(cell_deg=0.002)
    for j in range(via_index + 1, len(coords)):
        after.add(coords[j], j)

    i0 = j0 = None
    last_j = via_index
    for i in range(via_index - 1, -1, -1):
        # The retraced point must be further along than the previous match, so
        # a later, unrelated crossing of the same spot can't be picked up.
        matches = [int(j) for _, j in after.near(coords[i], tol_m) if j >= last_j]
        if not matches:
            break
        i0, j0 = i, min(matches)
        last_j = j0
    if i0 is None:
        return coords, dists, durs
    # coords[i0] ≈ coords[j0], so segment i0→j0+1 is effectively segment j0→j0+1.
    return coords[: i0 + 1] + coords[j0 + 1 :], dists[:i0] + dists[j0:], durs[:i0] + durs[j0:]


def _road_summary(raw: dict, top: int = 3) -> str:
    """Main roads by distance driven, preferring route numbers ("I-84") over
    street names, e.g. "I-84 · I-82 · I-90"."""
    by_road: dict[str, float] = {}
    for leg in raw["legs"]:
        for step in leg.get("steps", []):
            ref = (step.get("ref") or "").split(";")[0].strip()
            road = ref or (step.get("name") or "").strip()
            if road:
                by_road[road] = by_road.get(road, 0.0) + step.get("distance", 0.0)
    if not by_road:
        return ""
    ranked = sorted(by_road.items(), key=lambda kv: -kv[1])
    return " · ".join(_pretty_ref(name) for name, _ in ranked[:top])


def _pretty_ref(name: str) -> str:
    for prefix in ("I ", "US "):
        rest = name[len(prefix):]
        if name.startswith(prefix) and rest[:1].isdigit():
            return f"{prefix.strip()}-{rest}"
    return name


def _request(points: list[LonLat], alternatives: int = 0, detail: bool = True) -> list[Route]:
    """One OSRM call.

    Both modes return the full geometry with per-segment distance/duration
    annotations (needed for ETAs and to cut out via-point detours accurately).
    ``detail=True`` adds turn-by-turn steps, used only for road names; they are
    the heaviest part of the payload, so candidates are fetched without them.
    """
    coord_str = ";".join(f"{lon:.6f},{lat:.6f}" for lon, lat in points)
    params = {
        "overview": "full",
        "geometries": "polyline6",
        "alternatives": str(alternatives) if alternatives else "false",
        "steps": "true" if detail else "false",
        "annotations": "distance,duration",
    }
    url = f"{settings.OSRM_URL}/route/v1/driving/{coord_str}"
    try:
        resp = requests.get(url, params=params, timeout=settings.HTTP_TIMEOUT_S)
    except requests.RequestException as exc:
        raise RoutingError(f"Routing service unreachable: {exc}") from exc
    if resp.status_code >= 500 or resp.status_code == 429:
        raise RoutingError(f"Routing service error ({resp.status_code})")
    data = resp.json()
    if data.get("code") != "Ok":
        if data.get("code") in ("NoRoute", "NoSegment"):
            return []
        raise RoutingError(data.get("message") or data.get("code") or "Routing failed")
    return [_parse_route(r, data.get("waypoints")) for r in data["routes"]]


def _safe_request(points: list[LonLat], detail: bool) -> list[Route]:
    try:
        return _request(points, detail=detail)
    except RoutingError as exc:
        log.info("via-route candidate failed: %s", exc)
        return []


def overlap_fraction(candidate: Route, other: Route, radius_m: float = OVERLAP_RADIUS_M) -> float:
    index = geo.PointIndex()
    for _, p in other.samples:
        index.add(p)
    shared = sum(1 for _, p in candidate.samples if next(index.near(p, radius_m), None) is not None)
    return shared / len(candidate.samples)


def has_spur(route: Route) -> bool:
    """True if the path doubles back over itself (a via point snapped to a dead
    end, producing an out-and-back detour)."""
    index = geo.PointIndex()
    for d, p in route.samples:
        index.add(p, d)
    doubled = 0
    for d, p in route.samples:
        if any(abs(d - other_d) >= SPUR_MIN_SEPARATION_M for _, other_d in index.near(p, SPUR_RADIUS_M)):
            doubled += 1
    return doubled * SAMPLE_STEP_M > SPUR_MAX_LENGTH_M


def _is_distinct(candidate: Route, accepted: list[Route]) -> bool:
    return not has_spur(candidate) and all(overlap_fraction(candidate, r) <= MAX_OVERLAP for r in accepted)


def via_candidates(origin: LonLat, destination: LonLat, round_: int = 0) -> list[LonLat]:
    """Via points either side of the trip.

    Round 0: at the midpoint, offset 15% and 30% of the straight-line distance.
    Round 1 (only if round 0 came up short, e.g. one side is a lake or a border):
    at the one-third and two-thirds marks, offset 20%.
    """
    straight = geo.haversine_m(origin, destination)
    brg = geo.bearing_deg(origin, destination)
    if round_ == 0:
        anchors, offsets = (0.5,), (0.15, 0.30)
    else:
        anchors, offsets = (0.33, 0.67), (0.20,)
    points = []
    for frac in anchors:
        anchor = geo.destination_point(origin, brg, straight * frac)
        points += [geo.destination_point(anchor, brg + side, straight * off) for off in offsets for side in (-90, 90)]
    return points


def get_routes(origin: LonLat, destination: LonLat, want: int = 3) -> list[Route]:
    """Up to ``want`` distinct routes, fastest first.

    OSRM's own alternatives are requested in parallel with via-point candidates
    (fetched without turn-by-turn steps, the heaviest part of the payload).
    Candidates are filtered for detours, duration and overlap; only the winners
    are re-fetched with steps for road names. The public OSRM server queues
    concurrent requests, so keeping heavy requests to a minimum is what keeps
    this fast. Results are cached per origin/destination, so changing the load
    or departure time doesn't re-route.
    """
    cache_key = f"routes:{origin[0]:.4f},{origin[1]:.4f}:{destination[0]:.4f},{destination[1]:.4f}:{want}"
    if (hit := cache.get(cache_key)) is not None:
        return hit

    with ThreadPoolExecutor(max_workers=5) as pool:
        vias = via_candidates(origin, destination)
        futures = [pool.submit(_safe_request, [origin, v, destination], False) for v in vias]
        routes = _request([origin, destination], alternatives=want)
        if not routes:
            raise NoRouteError("No drivable route found between these locations.")
        routes = [r for r in routes if not has_spur(r)] or routes[:1]
        fastest = min(r.duration_s for r in routes)

        chosen: list[tuple[LonLat, Route]] = []
        for round_ in (0, 1):
            if len(routes) + len(chosen) >= want:
                break
            if round_ == 1:
                vias = via_candidates(origin, destination, round_=1)
                futures = [pool.submit(_safe_request, [origin, v, destination], False) for v in vias]
            candidates = [(v, r) for v, f in zip(vias, futures) for r in f.result()]
            candidates = [(v, r) for v, r in candidates if r.duration_s <= fastest * MAX_DURATION_RATIO]
            for v, cand in sorted(candidates, key=lambda vr: vr[1].duration_s):
                if len(routes) + len(chosen) >= want:
                    break
                if _is_distinct(cand, routes + [c for _, c in chosen]):
                    chosen.append((v, cand))

        # Road names need turn-by-turn steps; fetch them only for the winners.
        # If that call fails, keep the candidate without names.
        named = pool.map(lambda vc: _safe_request([origin, vc[0], destination], True), chosen)
        for (_, cand), batch in zip(chosen, named):
            routes.append(batch[0] if batch else cand)

    routes.sort(key=lambda r: r.duration_s)
    routes = routes[:want]
    cache.set(cache_key, routes, ROUTE_CACHE_TTL_S)
    return routes
