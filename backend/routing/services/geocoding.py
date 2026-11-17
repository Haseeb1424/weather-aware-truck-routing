"""Place search via Photon (OpenStreetMap data)."""

from __future__ import annotations

import requests
from django.conf import settings
from django.core.cache import cache


class GeocodingError(Exception):
    pass


def _label(props: dict) -> str:
    parts = [props.get("name")]
    if props.get("housenumber") and props.get("street"):
        parts = [f"{props['housenumber']} {props['street']}"]
    for key in ("city", "county", "state", "country"):
        value = props.get(key)
        if value and value not in parts:
            parts.append(value)
    return ", ".join(p for p in parts if p)


def search(query: str, limit: int = 6) -> list[dict]:
    query = query.strip()
    cache_key = f"geo:{query.lower()}:{limit}"
    if (hit := cache.get(cache_key)) is not None:
        return hit
    try:
        resp = requests.get(
            settings.PHOTON_URL,
            params={"q": query, "limit": limit, "lang": "en"},
            headers={"User-Agent": settings.HTTP_USER_AGENT},
            timeout=settings.HTTP_TIMEOUT_S,
        )
        resp.raise_for_status()
    except requests.RequestException as exc:
        raise GeocodingError(f"Geocoding service unavailable: {exc}") from exc

    results, seen = [], set()
    for feat in resp.json().get("features", []):
        lon, lat = feat["geometry"]["coordinates"]
        label = _label(feat.get("properties", {}))
        if label in seen:
            continue
        seen.add(label)
        results.append({"label": label, "lat": lat, "lon": lon})
    cache.set(cache_key, results, 24 * 3600)
    return results
