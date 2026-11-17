"""Orchestrates a trip plan: routes → checkpoints → weather at ETA → risk → ranking."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from . import geometry as geo
from . import osrm, weather
from .geometry import LonLat
from .osrm import Route
from .recommend import rank, score_for, summarize
from .risk import assess

DISPLAY_TOLERANCE_DEG = 0.0004  # ≈40 m — visually lossless, ~10× fewer vertices
ROUTE_LETTERS = "ABC"


def checkpoint_distances(total_m: float, interval_m: float) -> list[float]:
    """Mile 0, every interval, and the destination."""
    out = []
    d = 0.0
    while d < total_m:
        out.append(d)
        d += interval_m
    out.append(total_m)
    return out


def owned_miles(distances_m: list[float]) -> list[float]:
    """Each checkpoint owns the stretch halfway to its neighbours, so the owned
    miles of all checkpoints sum exactly to the route length."""
    n = len(distances_m)
    out = []
    for i, d in enumerate(distances_m):
        left = (d - distances_m[i - 1]) / 2 if i > 0 else 0.0
        right = (distances_m[i + 1] - d) / 2 if i < n - 1 else 0.0
        out.append((left + right) / geo.METERS_PER_MILE)
    return out


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _checkpoints(route: Route, interval_mi: int, departure: datetime) -> list[dict]:
    dists = checkpoint_distances(route.distance_m, interval_mi * geo.METERS_PER_MILE)
    owned = owned_miles(dists)
    cps = []
    for i, (d, miles) in enumerate(zip(dists, owned)):
        point, seg, frac = geo.interpolate_along(route.coords, route.cum_m, d)
        elapsed = geo.value_at(route.cum_m, route.cum_s, seg, frac)
        cps.append(
            {
                "index": i,
                "mile": round(d / geo.METERS_PER_MILE, 1),
                "miles_owned": miles,
                "lon": round(point[0], 5),
                "lat": round(point[1], 5),
                "elapsed_s": round(elapsed),
                "eta": iso(departure + timedelta(seconds=elapsed)),
                "_ts": departure.timestamp() + elapsed,
            }
        )
    return cps


def _display_geometry(route: Route) -> dict:
    keep = geo.simplify_indices(route.coords, DISPLAY_TOLERANCE_DEG)
    return {
        "coordinates": [[round(route.coords[i][0], 5), round(route.coords[i][1], 5)] for i in keep],
        "times": [round(route.cum_s[i]) for i in keep],
    }


def plan_trip(origin: LonLat, destination: LonLat, departure: datetime, load_lb: float, interval_mi: int) -> dict:
    routes = osrm.get_routes(origin, destination, want=3)

    per_route = [_checkpoints(r, interval_mi, departure) for r in routes]
    all_cps = [cp for cps in per_route for cp in cps]
    series = weather.fetch(
        [(cp["lat"], cp["lon"]) for cp in all_cps],
        departure.timestamp(),
        max(cp["_ts"] for cp in all_cps),
    )

    out_routes = []
    scores = []
    names = {}
    for idx, (route, cps) in enumerate(zip(routes, per_route)):
        rid = ROUTE_LETTERS[idx]
        names[rid] = f"Route {rid}"
        for cp in cps:
            cond = series[weather.grid_key(cp["lat"], cp["lon"])].at(cp.pop("_ts"))
            cp["weather"] = cond.as_dict()
            cp["risk"] = assess(cond.wind_mph, cond.rain_in_hr, cond.snow_in_hr, load_lb).as_dict()
        summary = summarize(cps)
        for cp in cps:
            cp["miles_owned"] = round(cp["miles_owned"], 2)
        scores.append(score_for(rid, summary, route.duration_s))
        out_routes.append(
            {
                "id": rid,
                "name": names[rid],
                "via": route.summary,
                "distance_mi": round(route.distance_m / geo.METERS_PER_MILE, 1),
                "duration_s": round(route.duration_s),
                "arrival": iso(departure + timedelta(seconds=route.duration_s)),
                "summary": summary,
                "geometry": _display_geometry(route),
                "checkpoints": cps,
            }
        )

    recommendation = rank(scores, names)
    return {
        "departure": iso(departure),
        "load_lb": load_lb,
        "interval_mi": interval_mi,
        "routes": out_routes,
        "recommendation": recommendation,
    }
