import pytest

from routing.services import geometry as geo
from routing.services.osrm import Route, decode_polyline6, has_spur, overlap_fraction
from routing.services.planner import checkpoint_distances, owned_miles

MI = geo.METERS_PER_MILE


def straight_route(lon0, lon1, lat=35.0, n=200, speed_mps=25.0):
    coords = [(lon0 + (lon1 - lon0) * i / (n - 1), lat) for i in range(n)]
    d = [geo.haversine_m(coords[i], coords[i + 1]) for i in range(n - 1)]
    return Route(coords, geo.cumulative(d), geo.cumulative([x / speed_mps for x in d]), "test")


def test_decode_polyline6():
    # Reference value from the polyline spec example, encoded at 1e-6 precision.
    assert decode_polyline6("_izlhA~rlgdF_{geC~ywl@_kwzCn`{nI") == [
        pytest.approx((-120.2, 38.5)),
        pytest.approx((-120.95, 40.7)),
        pytest.approx((-126.453, 43.252)),
    ]


def test_road_summary_prefers_route_numbers_by_distance():
    from routing.services.osrm import _road_summary

    raw = {
        "legs": [
            {
                "steps": [
                    {"name": "Main St", "distance": 2_000},
                    {"name": "Vietnam Veterans Memorial Hwy", "ref": "I 84;US 30", "distance": 300_000},
                    {"name": "", "ref": "I 82", "distance": 150_000},
                    {"name": "Old Road", "distance": 100},
                ]
            }
        ]
    }
    assert _road_summary(raw) == "I-84 · I-82 · Main St"


def test_trim_via_detour_removes_out_and_back():
    from routing.services.osrm import trim_via_detour

    main = [(-100 + i * 0.01, 35.0) for i in range(11)]  # 0..10 heading east
    spur_in = [(-99.95, 35.0 + k * 0.01) for k in range(1, 4)]  # north up a side road
    # Route: main[0..5] → side road → via (top) → back down → main[5..10]
    coords = main[:6] + [(-99.95, 35.0)] + spur_in + list(reversed(spur_in))[1:] + [(-99.95, 35.0)] + main[6:]
    # Use the exact junction point as main[5] for clarity.
    via_index = 6 + len(spur_in)
    n = len(coords) - 1
    trimmed, d, t = trim_via_detour(coords, [1.0] * n, [2.0] * n, via_index)
    assert all(abs(lat - 35.0) < 1e-9 for _, lat in trimmed)  # side road is gone
    assert len(d) == len(t) == len(trimmed) - 1
    assert trimmed[0] == coords[0] and trimmed[-1] == coords[-1]


def test_trim_via_detour_leaves_normal_routes_alone():
    from routing.services.osrm import trim_via_detour

    coords = [(-100 + i * 0.01, 35.0 + i * 0.005) for i in range(20)]
    out = trim_via_detour(coords, [1.0] * 19, [1.0] * 19, 10)
    assert out[0] == coords


def test_haversine_one_degree_latitude():
    assert geo.haversine_m((0, 0), (0, 1)) == pytest.approx(111_195, rel=1e-3)


def test_interpolate_along_midpoint():
    coords = [(0.0, 0.0), (0.0, 1.0), (0.0, 2.0)]
    cum = [0.0, 10.0, 20.0]
    point, seg, frac = geo.interpolate_along(coords, cum, 15.0)
    assert point == pytest.approx((0.0, 1.5))
    assert (seg, frac) == (1, pytest.approx(0.5))
    assert geo.interpolate_along(coords, cum, -5)[0] == coords[0]
    assert geo.interpolate_along(coords, cum, 99)[0] == coords[-1]


def test_simplify_keeps_endpoints_and_corners():
    coords = [(0, 0), (1, 0.00001), (2, 0), (2, 1), (2, 2)]
    assert geo.simplify_indices(coords, 0.001) == [0, 2, 4]


@pytest.mark.parametrize("total_mi, interval, expected_count", [(100, 25, 5), (101, 25, 6), (10, 50, 2)])
def test_checkpoint_distances_include_both_ends(total_mi, interval, expected_count):
    d = checkpoint_distances(total_mi * MI, interval * MI)
    assert d[0] == 0 and d[-1] == pytest.approx(total_mi * MI)
    assert len(d) == expected_count


def test_owned_miles_sum_to_route_length():
    d = checkpoint_distances(137.3 * MI, 25 * MI)
    owned = owned_miles(d)
    assert sum(owned) == pytest.approx(137.3)
    assert owned[0] == pytest.approx(12.5)
    assert owned[1] == pytest.approx(25)


def test_overlap_identical_and_disjoint_routes():
    a = straight_route(-100, -99)
    b = straight_route(-100, -99, lat=36.0)
    assert overlap_fraction(a, a) == pytest.approx(1.0)
    assert overlap_fraction(a, b) == 0.0


def test_spur_detected_on_out_and_back_detour():
    out = [(-100 + i * 0.001, 35.0) for i in range(100)]  # ~9 km east
    back = list(reversed(out))[1:]
    onward = [(-100, 35.0 + i * 0.001) for i in range(1, 100)]
    coords = out + back + onward
    d = [geo.haversine_m(coords[i], coords[i + 1]) for i in range(len(coords) - 1)]
    spur = Route(coords, geo.cumulative(d), geo.cumulative(d), "spur")
    assert has_spur(spur)
    assert not has_spur(straight_route(-100, -99))
