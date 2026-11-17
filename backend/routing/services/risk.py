"""Weather risk classification for a single checkpoint.

Pure functions only: no I/O, no Django. Thresholds come straight from the
assessment's risk table and load rules.

Boundary convention
-------------------
The spec's bands touch (rain 0.25 appears in both Moderate and High). A value on
a shared boundary goes to the *higher* band, which is the conservative choice for
safety. The one exception is where the spec writes the top band with a strict ">"
(rain ">1.00", snow ">3.0"): there the boundary value stays in Severe.
Wind bands are written in whole mph ("25–34", "35–44"), so they become the
half-open ranges [25, 35), [35, 45), [45, 55) and >= 55.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import IntEnum


class Risk(IntEnum):
    LOW = 0
    MODERATE = 1
    HIGH = 2
    SEVERE = 3
    NO_TRAVEL = 4

    @property
    def label(self) -> str:
        return RISK_LABELS[self]


RISK_LABELS = {
    Risk.LOW: "Low",
    Risk.MODERATE: "Moderate",
    Risk.HIGH: "High",
    Risk.SEVERE: "Severe",
    Risk.NO_TRAVEL: "No Travel",
}

# (lower bound inclusive, level), checked from the highest band down.
WIND_BANDS_MPH = ((55.0, Risk.NO_TRAVEL), (45.0, Risk.SEVERE), (35.0, Risk.HIGH), (25.0, Risk.MODERATE))

# Precipitation: (threshold, level, strict). strict=True means value must be
# strictly greater than the threshold ("> 1.00"); otherwise >= threshold.
RAIN_BANDS_IN_HR = ((1.00, Risk.NO_TRAVEL, True), (0.50, Risk.SEVERE, False), (0.25, Risk.HIGH, False), (0.10, Risk.MODERATE, False))
SNOW_BANDS_IN_HR = ((3.0, Risk.NO_TRAVEL, True), (2.0, Risk.SEVERE, False), (1.0, Risk.HIGH, False), (0.5, Risk.MODERATE, False))

# Load rules
NO_TRAVEL_WIND_MPH = 55.0
HEAVY_LOAD_SEVERE_WIND_MPH = 45.0  # 45–54 mph band
HEAVY_LOAD_NO_TRAVEL_LB = 30_000
STRONG_WIND_MPH = 35.0  # 35–44 mph band
VERY_HEAVY_LOAD_SEVERE_LB = 40_000


def classify_wind(wind_mph: float) -> Risk:
    for lower, level in WIND_BANDS_MPH:
        if wind_mph >= lower:
            return level
    return Risk.LOW


def _classify_precip(rate: float, bands) -> Risk:
    for threshold, level, strict in bands:
        if rate > threshold or (not strict and rate >= threshold):
            return level
    return Risk.LOW


def classify_rain(rain_in_hr: float) -> Risk:
    return _classify_precip(rain_in_hr, RAIN_BANDS_IN_HR)


def classify_snow(snow_in_hr: float) -> Risk:
    return _classify_precip(snow_in_hr, SNOW_BANDS_IN_HR)


def apply_load_rules(wind_mph: float, load_lb: float, wind_level: Risk) -> tuple[Risk, str | None]:
    """Escalate the wind level for heavy loads. Returns (level, reason or None)."""
    if wind_mph >= NO_TRAVEL_WIND_MPH:
        return Risk.NO_TRAVEL, None  # already No Travel from the table, for any load
    if wind_mph >= HEAVY_LOAD_SEVERE_WIND_MPH and load_lb > HEAVY_LOAD_NO_TRAVEL_LB:
        return Risk.NO_TRAVEL, (
            f"Wind {wind_mph:.0f} mph with {load_lb:,.0f} lb load (> {HEAVY_LOAD_NO_TRAVEL_LB:,} lb) → No Travel"
        )
    if wind_mph >= STRONG_WIND_MPH and load_lb > VERY_HEAVY_LOAD_SEVERE_LB:
        level = max(wind_level, Risk.SEVERE)
        return level, (
            f"Wind {wind_mph:.0f} mph with {load_lb:,.0f} lb load (> {VERY_HEAVY_LOAD_SEVERE_LB:,} lb) → Severe"
        )
    return wind_level, None


@dataclass(frozen=True)
class Assessment:
    level: Risk
    wind_level: Risk
    rain_level: Risk
    snow_level: Risk
    reasons: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "level": int(self.level),
            "label": self.level.label,
            "wind_level": int(self.wind_level),
            "rain_level": int(self.rain_level),
            "snow_level": int(self.snow_level),
            "reasons": self.reasons,
        }


def assess(wind_mph: float, rain_in_hr: float, snow_in_hr: float, load_lb: float) -> Assessment:
    """Classify one checkpoint. The overall level is the worst of wind (after load
    rules), rain and snow."""
    wind_mph = max(0.0, wind_mph or 0.0)
    rain_in_hr = max(0.0, rain_in_hr or 0.0)
    snow_in_hr = max(0.0, snow_in_hr or 0.0)

    table_wind = classify_wind(wind_mph)
    wind_level, load_reason = apply_load_rules(wind_mph, load_lb, table_wind)
    rain_level = classify_rain(rain_in_hr)
    snow_level = classify_snow(snow_in_hr)

    reasons: list[str] = []
    if load_reason:
        reasons.append(load_reason)
    elif wind_level > Risk.LOW:
        reasons.append(f"Wind {wind_mph:.0f} mph → {wind_level.label}")
    if rain_level > Risk.LOW:
        reasons.append(f"Rain {rain_in_hr:.2f} in/hr → {rain_level.label}")
    if snow_level > Risk.LOW:
        reasons.append(f"Snow {snow_in_hr:.2f} in/hr → {snow_level.label}")

    return Assessment(
        level=max(wind_level, rain_level, snow_level),
        wind_level=wind_level,
        rain_level=rain_level,
        snow_level=snow_level,
        reasons=reasons,
    )


def risk_level(wind_mph: float, rain_in_hr: float, snow_in_hr: float, load_lb: float) -> int:
    """Fast path for the heatmap, which needs thousands of classifications."""
    wind = classify_wind(wind_mph)
    wind, _ = apply_load_rules(wind_mph, load_lb, wind)
    return int(max(wind, classify_rain(rain_in_hr), classify_snow(snow_in_hr)))
