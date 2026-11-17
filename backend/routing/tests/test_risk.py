import pytest

from routing.services.risk import Risk, assess, classify_rain, classify_snow, classify_wind, risk_level


@pytest.mark.parametrize(
    "mph, expected",
    [
        (0, Risk.LOW),
        (24.9, Risk.LOW),
        (25, Risk.MODERATE),
        (34.9, Risk.MODERATE),
        (35, Risk.HIGH),
        (44.9, Risk.HIGH),
        (45, Risk.SEVERE),
        (54.9, Risk.SEVERE),
        (55, Risk.NO_TRAVEL),
        (90, Risk.NO_TRAVEL),
    ],
)
def test_wind_bands(mph, expected):
    assert classify_wind(mph) == expected


@pytest.mark.parametrize(
    "rate, expected",
    [
        (0, Risk.LOW),
        (0.099, Risk.LOW),
        (0.10, Risk.MODERATE),
        (0.249, Risk.MODERATE),
        (0.25, Risk.HIGH),  # shared boundary → higher band
        (0.50, Risk.SEVERE),
        (1.00, Risk.SEVERE),  # spec: No Travel is strictly > 1.00
        (1.001, Risk.NO_TRAVEL),
    ],
)
def test_rain_bands(rate, expected):
    assert classify_rain(rate) == expected


@pytest.mark.parametrize(
    "rate, expected",
    [
        (0.49, Risk.LOW),
        (0.5, Risk.MODERATE),
        (1.0, Risk.HIGH),
        (2.0, Risk.SEVERE),
        (3.0, Risk.SEVERE),  # spec: No Travel is strictly > 3.0
        (3.01, Risk.NO_TRAVEL),
    ],
)
def test_snow_bands(rate, expected):
    assert classify_snow(rate) == expected


@pytest.mark.parametrize(
    "wind, load, expected",
    [
        # >= 55 mph is No Travel for any load
        (55, 0, Risk.NO_TRAVEL),
        (60, 5_000, Risk.NO_TRAVEL),
        # 45–54 mph: No Travel only above 30,000 lb
        (45, 30_000, Risk.SEVERE),
        (45, 30_001, Risk.NO_TRAVEL),
        (54.9, 80_000, Risk.NO_TRAVEL),
        # 35–44 mph: Severe only above 40,000 lb
        (35, 40_000, Risk.HIGH),
        (35, 40_001, Risk.SEVERE),
        (44.9, 45_000, Risk.SEVERE),
        # below 35 mph load does not matter
        (34.9, 80_000, Risk.MODERATE),
    ],
)
def test_load_rules(wind, load, expected):
    assert assess(wind, 0, 0, load).level == expected
    assert risk_level(wind, 0, 0, load) == expected


def test_overall_level_is_worst_factor():
    a = assess(wind_mph=26, rain_in_hr=0.6, snow_in_hr=1.2, load_lb=10_000)
    assert (a.wind_level, a.rain_level, a.snow_level) == (Risk.MODERATE, Risk.SEVERE, Risk.HIGH)
    assert a.level == Risk.SEVERE
    assert len(a.reasons) == 3


def test_load_reason_is_explained():
    a = assess(wind_mph=47, rain_in_hr=0, snow_in_hr=0, load_lb=42_000)
    assert a.level == Risk.NO_TRAVEL
    assert "42,000 lb" in a.reasons[0]


def test_missing_or_negative_values_are_low():
    assert assess(None, None, None, 20_000).level == Risk.LOW
    assert assess(-3, -0.1, -1, 20_000).level == Risk.LOW
