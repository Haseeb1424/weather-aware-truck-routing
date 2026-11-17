import pytest
import responses
from django.core.cache import cache

from routing.services import weather
from routing.services.weather import HOUR, Series

T0 = 1_800_000_000 // HOUR * HOUR  # an exact hour


def series():
    return Series(
        start=T0,
        wind=[10.0, 20.0, 40.0],
        gust=[15.0, 25.0, 50.0],
        rain=[0.0, 0.3, 0.05],  # total for the hour *ending* at each stamp
        snow=[0.0, 0.0, 1.5],
    )


def test_wind_interpolates_between_hours():
    assert series().at(T0 + HOUR / 2).wind_mph == pytest.approx(15.0)
    assert series().at(T0 + 1.5 * HOUR).wind_mph == pytest.approx(30.0)


def test_precip_uses_bucket_containing_the_instant():
    # 00:30 falls in the hour ending 01:00 → index 1
    assert series().at(T0 + HOUR / 2).rain_in_hr == 0.3
    # exactly 01:00 is the end of that same hour
    assert series().at(T0 + HOUR).rain_in_hr == 0.3
    # 01:10 is in the hour ending 02:00
    c = series().at(T0 + HOUR + 600)
    assert (c.rain_in_hr, c.snow_in_hr) == (0.05, 1.5)


def test_outside_window_raises():
    with pytest.raises(weather.WeatherError):
        series().at(T0 + 10 * HOUR)


def test_grid_key_dedupes_nearby_points():
    assert weather.grid_key(35.001, -97.011) == weather.grid_key(35.012, -97.0)


def _om_item(n=5, wind=12.0):
    return {
        "hourly": {
            "time": [T0 - HOUR + i * HOUR for i in range(n)],
            "wind_speed_10m": [wind] * n,
            "wind_gusts_10m": [wind + 5] * n,
            "rain": [0.1] * n,
            "showers": [0.05] * n,
            "snowfall": [None] * n,
        }
    }


@responses.activate
def test_fetch_batches_dedupes_and_caches(settings):
    cache.clear()
    settings.OPEN_METEO_URL = "https://weather.test/v1/forecast"
    responses.add(responses.GET, settings.OPEN_METEO_URL, json=[_om_item(), _om_item(wind=30)])

    pts = [(35.0, -97.0), (35.001, -97.001), (36.0, -98.0)]  # first two share a grid cell
    out = weather.fetch(pts, T0, T0 + HOUR)
    assert len(out) == 2
    assert len(responses.calls) == 1
    s = out[weather.grid_key(36.0, -98.0)]
    assert s.wind[0] == 30
    assert s.rain[0] == pytest.approx(0.15)  # rain + showers
    assert s.snow[0] == 0.0  # None → 0

    weather.fetch(pts, T0, T0 + HOUR)
    assert len(responses.calls) == 1  # served from cache


@responses.activate
def test_fetch_surfaces_api_errors(settings):
    cache.clear()
    settings.OPEN_METEO_URL = "https://weather.test/v1/forecast"
    responses.add(responses.GET, settings.OPEN_METEO_URL, status=429, json={"reason": "Daily limit exceeded"})
    with pytest.raises(weather.WeatherError, match="Daily limit"):
        weather.fetch([(35.0, -97.0)], T0, T0 + HOUR)


@responses.activate
def test_fetch_retries_after_per_minute_limit(settings):
    cache.clear()
    settings.OPEN_METEO_URL = "https://weather.test/v1/forecast"
    settings.WEATHER_RETRY_DELAYS_S = (0, 0)
    limited = {"error": True, "reason": "Minutely API request limit exceeded. Please try again in one minute."}
    responses.add(responses.GET, settings.OPEN_METEO_URL, status=429, json=limited)
    responses.add(responses.GET, settings.OPEN_METEO_URL, json=_om_item())

    out = weather.fetch([(35.0, -97.0)], T0, T0 + HOUR)
    assert len(out) == 1
    assert len(responses.calls) == 2


@responses.activate
def test_fetch_does_not_wait_out_daily_limit(settings):
    cache.clear()
    settings.OPEN_METEO_URL = "https://weather.test/v1/forecast"
    settings.WEATHER_RETRY_DELAYS_S = (0, 0)
    responses.add(responses.GET, settings.OPEN_METEO_URL, status=429, json={"reason": "Daily API request limit exceeded."})
    with pytest.raises(weather.WeatherError, match="retry shortly"):
        weather.fetch([(35.0, -97.0)], T0, T0 + HOUR)
    assert len(responses.calls) == 1
