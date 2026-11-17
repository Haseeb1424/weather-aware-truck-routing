"""API tests with OSRM and Open-Meteo mocked at the HTTP layer."""

import re
from datetime import datetime, timedelta, timezone

import pytest
import responses
from django.core.cache import cache
from rest_framework.test import APIClient

OSRM = "https://osrm.test"
OM = "https://weather.test/v1/forecast"


@pytest.fixture(autouse=True)
def _services(settings):
    cache.clear()
    settings.OSRM_URL = OSRM
    settings.OPEN_METEO_URL = OM


def osrm_route(lat, lon0=-100.0, lon1=-98.0, n=60, speed=25.0, summary="I 40"):
    coords = [[lon0 + (lon1 - lon0) * i / (n - 1), lat] for i in range(n)]
    seg = 182_000 / (n - 1)  # ≈ 2° of longitude at 35°N
    return {
        "geometry": {"coordinates": coords},
        "duration": seg * (n - 1) / speed,
        "legs": [
            {
                "steps": [{"name": summary, "distance": seg * (n - 1)}],
                "annotation": {"distance": [seg] * (n - 1), "duration": [seg / speed] * (n - 1)},
            }
        ],
    }


def om_callback(wind_for_lat):
    def cb(request):
        from urllib.parse import parse_qs, urlparse

        q = parse_qs(urlparse(request.url).query)
        lats = [float(x) for x in q["latitude"][0].split(",")]
        start = datetime.strptime(q["start_hour"][0], "%Y-%m-%dT%H:%M").replace(tzinfo=timezone.utc)
        end = datetime.strptime(q["end_hour"][0], "%Y-%m-%dT%H:%M").replace(tzinfo=timezone.utc)
        n = int((end - start).total_seconds() // 3600) + 1
        times = [int(start.timestamp()) + i * 3600 for i in range(n)]
        items = [
            {
                "hourly": {
                    "time": times,
                    "wind_speed_10m": [wind_for_lat(lat)] * n,
                    "wind_gusts_10m": [wind_for_lat(lat) + 5] * n,
                    "rain": [0.0] * n,
                    "showers": [0.0] * n,
                    "snowfall": [0.0] * n,
                }
            }
            for lat in lats
        ]
        import json

        return 200, {}, json.dumps(items if len(items) > 1 else items[0])

    return cb


def payload(**overrides):
    body = {
        "origin": {"lat": 35.0, "lon": -100.0, "label": "A"},
        "destination": {"lat": 35.0, "lon": -98.0, "label": "B"},
        "departure": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
        "load_lb": 42_000,
        "interval_mi": 25,
    }
    body.update(overrides)
    return body


@responses.activate
def test_plan_recommends_the_calm_route_over_the_fast_windy_one():
    # Three routes at different latitudes: the fastest one (35°N) is windy.
    responses.add(
        responses.GET,
        re.compile(rf"{OSRM}/route/v1/driving/[^;]+;[^;]+$"),
        json={
            "code": "Ok",
            "routes": [
                osrm_route(35.0, speed=26, summary="Fast windy"),
                osrm_route(36.0, speed=24, summary="Calm"),
                osrm_route(37.0, speed=22, summary="Slow calm"),
            ],
        },
    )
    responses.add_callback(responses.GET, OM, callback=om_callback(lambda lat: 40.0 if lat < 35.5 else 10.0))

    r = APIClient().post("/api/plan", payload(), format="json")
    assert r.status_code == 200, r.content
    data = r.json()
    assert [rt["id"] for rt in data["routes"]] == ["A", "B", "C"]
    fast = data["routes"][0]
    # 40 mph wind with a 42,000 lb load → Severe on every checkpoint
    assert {cp["risk"]["label"] for cp in fast["checkpoints"]} == {"Severe"}
    assert fast["summary"]["miles_by_level"]["severe"] == pytest.approx(fast["distance_mi"], abs=0.2)
    assert data["recommendation"]["recommended_route_id"] == "B"
    # The faster route lost on severe miles; the runner-up (C) lost on time.
    assert data["recommendation"]["why_not"]["A"].startswith("Route B has fewer Severe miles")
    assert data["recommendation"]["why_not"]["C"].startswith("Route B has a shorter travel time")
    # ETAs increase along the route and the last one equals the arrival time
    etas = [cp["eta"] for cp in fast["checkpoints"]]
    assert etas == sorted(etas) and etas[-1] == fast["arrival"]


@responses.activate
def test_plan_synthesizes_alternatives_when_osrm_returns_one():
    responses.add(
        responses.GET,
        re.compile(rf"{OSRM}/route/v1/driving/[^;]+;[^;]+$"),
        json={"code": "Ok", "routes": [osrm_route(35.0)]},
    )
    def via_cb(request):
        # Return a road that passes through the requested via point's latitude.
        import json

        via_lat = float(request.url.split("/driving/")[1].split(";")[1].split(",")[1].split("?")[0])
        return 200, {}, json.dumps({"code": "Ok", "routes": [osrm_route(round(via_lat, 3), speed=22)]})

    responses.add_callback(responses.GET, re.compile(rf"{OSRM}/route/v1/driving/[^;]+;[^;]+;[^;]+$"), callback=via_cb)
    responses.add_callback(responses.GET, OM, callback=om_callback(lambda lat: 5.0))

    r = APIClient().post("/api/plan", payload(), format="json")
    assert r.status_code == 200, r.content
    routes = r.json()["routes"]
    assert len(routes) == 3
    start_lats = {rt["geometry"]["coordinates"][1][1] for rt in routes}
    assert len(start_lats) == 3  # three genuinely different roads

    # Same origin/destination again (e.g. a different load): served from cache.
    calls = len(responses.calls)
    r = APIClient().post("/api/plan", payload(load_lb=10_000), format="json")
    assert r.status_code == 200
    osrm_calls = [c for c in responses.calls[calls:] if c.request.url.startswith(OSRM)]
    assert osrm_calls == []


@pytest.mark.parametrize(
    "override, field",
    [
        ({"load_lb": 90_000}, "load_lb"),
        ({"interval_mi": 15}, "interval_mi"),
        ({"departure": "2020-01-01T00:00:00Z"}, "departure"),
        ({"departure": (datetime.now(timezone.utc) + timedelta(days=20)).isoformat()}, "departure"),
        ({"destination": {"lat": 35.0, "lon": -100.0}}, "non_field_errors"),
    ],
)
def test_plan_validation(override, field):
    r = APIClient().post("/api/plan", payload(**override), format="json")
    assert r.status_code == 400
    assert field in r.json()


@responses.activate
def test_plan_no_route_is_422():
    responses.add(responses.GET, re.compile(rf"{OSRM}/.*"), json={"code": "NoRoute", "routes": []})
    r = APIClient().post("/api/plan", payload(), format="json")
    assert r.status_code == 422


@responses.activate
def test_upstream_failure_is_502():
    responses.add(responses.GET, re.compile(rf"{OSRM}/.*"), status=503)
    r = APIClient().post("/api/plan", payload(), format="json")
    assert r.status_code == 502


@responses.activate
def test_heatmap_returns_49_hours_per_cell():
    responses.add_callback(responses.GET, OM, callback=om_callback(lambda lat: 50.0))
    body = {
        "departure": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
        "load_lb": 35_000,
        "lines": [[[-100.0, 35.0], [-99.0, 35.0]]],
    }
    r = APIClient().post("/api/heatmap", body, format="json")
    assert r.status_code == 200, r.content
    data = r.json()
    assert data["cells"] and len(data["cells"]) <= 250
    cell = data["cells"][0]
    assert len(cell["risk"]) == 49
    assert set(cell["risk"]) == {4}  # 50 mph + 35,000 lb → No Travel
