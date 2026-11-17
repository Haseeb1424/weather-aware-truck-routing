from routing.services.recommend import RouteScore, rank, summarize


def cp(index, level, miles):
    return {"index": index, "miles_owned": miles, "risk": {"level": level}}


def score(rid, nt=0, sev=0, high=0, avg=0.0, dur=3600):
    return RouteScore(rid, nt, sev, high, avg, dur)


def test_summarize_counts_miles_and_weighted_average():
    s = summarize([cp(0, 0, 10), cp(1, 2, 20), cp(2, 3, 10)])
    assert s["miles_by_level"]["high"] == 20
    assert s["miles_by_level"]["severe"] == 10
    assert s["avg_risk"] == round((0 * 10 + 2 * 20 + 3 * 10) / 40, 2)
    assert s["max_level"] == 3
    assert s["worst_checkpoint_index"] == 2


def test_fewest_severe_miles_beats_faster_route():
    r = rank([score("A", sev=25, dur=3000), score("B", sev=0, high=100, dur=9000)])
    assert r["recommended_route_id"] == "B"
    assert r["reason"].startswith("Fewest Severe miles")
    assert set(r["why_not"]) == {"A"}


def test_high_miles_break_severe_tie():
    r = rank([score("A", high=50), score("B", high=10, avg=2.5)])
    assert r["recommended_route_id"] == "B"


def test_average_risk_breaks_high_tie():
    r = rank([score("A", avg=1.2, dur=100), score("B", avg=0.4, dur=999)])
    assert r["recommended_route_id"] == "B"


def test_travel_time_is_last_tiebreaker():
    r = rank([score("A", avg=0.5, dur=5000), score("B", avg=0.5, dur=4000)], {"A": "Route A"})
    assert r["recommended_route_id"] == "B"
    assert "Shortest travel time" in r["reason"]
    assert r["ranking"] == ["B", "A"]


def test_tiny_average_risk_noise_does_not_override_time():
    r = rank([score("A", avg=0.501, dur=5000), score("B", avg=0.499, dur=4000)])
    # Rounded to 0.01 both are 0.50 → time decides.
    assert r["recommended_route_id"] == "B"


def test_no_travel_miles_rank_before_severe():
    r = rank([score("A", nt=10, sev=0), score("B", nt=0, sev=200)])
    assert r["recommended_route_id"] == "B"
    assert r["all_routes_blocked"] is False


def test_all_routes_blocked_flag():
    r = rank([score("A", nt=10), score("B", nt=5)])
    assert r["recommended_route_id"] == "B"
    assert r["all_routes_blocked"] is True
