"""Route summaries and recommendation ranking (pure functions)."""

from __future__ import annotations

from dataclasses import dataclass

from .risk import Risk

LEVEL_KEYS = ("low", "moderate", "high", "severe", "no_travel")


@dataclass(frozen=True)
class RouteScore:
    route_id: str
    no_travel_miles: float
    severe_miles: float
    high_miles: float
    avg_risk: float
    duration_s: float

    def sort_key(self) -> tuple:
        # Miles are rounded to 0.1 and average risk to 0.01 so floating-point noise
        # never decides the ranking — genuine ties fall through to travel time.
        return (
            round(self.no_travel_miles, 1),
            round(self.severe_miles, 1),
            round(self.high_miles, 1),
            round(self.avg_risk, 2),
            self.duration_s,
        )


def summarize(checkpoints: list[dict]) -> dict:
    """Aggregate per-checkpoint risk into route-level miles per level.

    Each checkpoint dict needs ``miles_owned`` and ``risk.level``.
    """
    miles = {key: 0.0 for key in LEVEL_KEYS}
    weighted = 0.0
    total = 0.0
    worst = None
    for cp in checkpoints:
        level = cp["risk"]["level"]
        owned = cp["miles_owned"]
        miles[LEVEL_KEYS[level]] += owned
        weighted += level * owned
        total += owned
        if worst is None or level > worst["risk"]["level"]:
            worst = cp
    avg = weighted / total if total else 0.0
    max_level = worst["risk"]["level"] if worst else 0
    return {
        "miles_by_level": {k: round(v, 1) for k, v in miles.items()},
        "avg_risk": round(avg, 2),
        "max_level": max_level,
        "max_label": Risk(max_level).label,
        "worst_checkpoint_index": worst["index"] if worst else None,
    }


def score_for(route_id: str, summary: dict, duration_s: float) -> RouteScore:
    m = summary["miles_by_level"]
    return RouteScore(
        route_id=route_id,
        no_travel_miles=m["no_travel"],
        severe_miles=m["severe"],
        high_miles=m["high"],
        avg_risk=summary["avg_risk"],
        duration_s=duration_s,
    )


def _fmt_duration(seconds: float) -> str:
    minutes = round(seconds / 60)
    h, m = divmod(minutes, 60)
    return f"{h}h {m:02d}m" if h else f"{m}m"


# (attribute, banner label, comparative phrase, value formatter)
_CRITERIA = (
    ("no_travel_miles", "Fewest No Travel miles", "fewer No Travel miles", lambda v: f"{v:.0f} mi"),
    ("severe_miles", "Fewest Severe miles", "fewer Severe miles", lambda v: f"{v:.0f} mi"),
    ("high_miles", "Fewest High miles", "fewer High miles", lambda v: f"{v:.0f} mi"),
    ("avg_risk", "Lowest average risk", "lower average risk", lambda v: f"{v:.2f}"),
    ("duration_s", "Shortest travel time", "a shorter travel time", _fmt_duration),
)


def rank(scores: list[RouteScore], names: dict[str, str] | None = None) -> dict:
    """Rank routes and explain why the winner beat the runner-up.

    Priority: No Travel miles (a route the rules forbid can never win over one that
    is merely Severe), then the spec's order — Severe miles, High miles, average
    risk, travel time.
    """
    if not scores:
        raise ValueError("no routes to rank")
    names = names or {}
    ordered = sorted(scores, key=RouteScore.sort_key)
    best = ordered[0]

    # For the banner: why the winner beat the runner-up.
    # For each other route's card: why it lost to the winner.
    best_name = names.get(best.route_id, best.route_id)
    reason = "Only route available."
    why_not = {}
    for i, other in enumerate(ordered[1:]):
        crit = _deciding_criterion(best, other)
        if crit is None:
            text = "Tied with the recommended route on every criterion."
            if i == 0:
                reason = "Routes are tied on every criterion."
        else:
            attr, label, phrase, fmt = crit
            b, o = fmt(getattr(best, attr)), fmt(getattr(other, attr))
            text = f"{best_name} has {phrase} ({b} vs {o})."
            if i == 0:
                reason = f"{label}: {b} vs {o} on {names.get(other.route_id, other.route_id)}."
        why_not[other.route_id] = text

    return {
        "recommended_route_id": best.route_id,
        "ranking": [s.route_id for s in ordered],
        "reason": reason,
        "why_not": why_not,
        "all_routes_blocked": all(s.no_travel_miles > 0 for s in scores),
    }


def _deciding_criterion(best: RouteScore, other: RouteScore):
    """The first criterion on which the two routes differ, or None if tied."""
    best_key, other_key = best.sort_key(), other.sort_key()
    for i, crit in enumerate(_CRITERIA):
        if best_key[i] != other_key[i]:
            return crit
    return None
