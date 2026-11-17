# Weather-Aware Truck Routing — Implementation Plan

Goal: a React + Django app that, given origin, destination, departure time and load
weight, produces 3 truck routes, samples the forecast at each checkpoint *at the
truck's ETA*, classifies risk with the provided rules, recommends a route, and shows
everything on a map with a corridor weather heatmap and a 0–48 h forecast slider.

Budget: ≤ 16 work hours. Grading weight drives effort: 40% logic, 40% map/heatmap UX,
15% code quality, 5% docs.

## 1. External services (all keyless, so the hosted demo needs no secrets)

| Need       | Service                         | Why |
|------------|---------------------------------|-----|
| Geocoding  | Photon (komoot, OSM data)       | Free, fast, designed for autocomplete |
| Routing    | OSRM public server              | Free, returns per-segment distance/duration annotations |
| Weather    | Open-Meteo forecast API         | Free, hourly, 16-day horizon, many locations per request, imperial units |
| Base map   | CARTO Positron GL style         | Free vector basemap, light so risk colours stand out |

All calls go through the Django backend (one place for caching, validation, and
swapping providers). Each client sits behind a small module so a paid provider
(e.g. ORS/HERE truck routing, Open-Meteo commercial key) is a one-file change.

## 2. Getting three routes

OSRM's `alternatives=3` often returns only 1–2 routes on long trips. Strategy:

1. Ask OSRM for alternatives.
2. If fewer than 3, generate **via-point candidates**: points offset perpendicular to
   the origin→destination line (left/right, at ~12% and ~25% of the trip length) and
   request origin→via→destination for each, in parallel.
3. Reject candidates that are > 1.6× the fastest duration, that contain a
   "spur" (the path doubles back on itself — a via point snapped to a dead-end road),
   or that overlap an already-chosen route by > 75%.
4. Keep the most distinct, fastest remaining candidates until there are 3.

**Truck speed:** OSRM's public profile is a car. Each segment's speed is capped at
65 mph (typical truck limiter / truck speed limits), so ETAs reflect a truck, not a car.
Hours-of-service breaks are out of scope (documented assumption).

## 3. Checkpoints and ETA

- Interval selectable: **10 / 25 / 50 miles** (default 25).
- Checkpoints at mile 0, every interval, and the destination.
- ETA = departure + cumulative (speed-capped) duration, linearly interpolated along the
  route at that distance.
- Each checkpoint "owns" the miles halfway to its neighbours, so owned miles sum
  exactly to the route length — this is what "Severe miles" / "High miles" count.

## 4. Weather at ETA

Open-Meteo hourly `wind_speed_10m`, `wind_gusts_10m`, `rain`, `snowfall` (mph, inch).

- **Wind** is an instantaneous value → linearly interpolated between the two hours
  around the ETA.
- **Rain / snowfall** are hourly totals for the *preceding* hour, i.e. already an
  in/hr rate → take the hour bucket that contains the ETA.
- Locations are rounded to ~0.05° (≈5 km, below the forecast model's resolution) and
  deduplicated, then fetched in batches of up to 100 locations per request, in parallel,
  and cached for 30 min.
- Sustained wind is classified (the table is sustained-wind thresholds); gusts are
  shown for context.

## 5. Risk rules (pure functions, exhaustively unit-tested)

Levels: Low=0, Moderate=1, High=2, Severe=3, No Travel=4.

Boundaries: the spec's bands touch (e.g. rain 0.25 is in both Moderate and High). Rule
used: **a boundary value belongs to the higher band**, except where the spec writes the
top band with `>` (rain `>1.00`, snow `>3.0`), so exactly 1.00 in/hr rain is Severe.
Wind bands are integer mph, so they become `[25,35)`, `[35,45)`, `[45,55)`, `≥55`.

Load rules (applied on wind, then checkpoint level = max of wind, rain, snow):
- wind ≥ 55 → No Travel (any load)
- wind 45–54 and load > 30,000 lb → No Travel
- wind 35–44 and load > 40,000 lb → Severe

Every checkpoint carries human-readable reasons ("Wind 47 mph with 42,000 lb load →
No Travel").

## 6. Recommendation

Sort routes lexicographically by:
0. **No Travel miles** (not in the spec's list, but a No Travel route can never beat a
   Severe one — documented)
1. Severe miles
2. High miles
3. Mileage-weighted average risk (0–4), rounded to 0.01 so noise doesn't decide
4. Travel time

The response includes a plain-English reason naming the criterion that decided it
("Fewest severe miles: 0 vs 50 on Route B"). If every route has No Travel miles, the UI
shows a warning that no route is safe at this departure time.

## 7. Corridor heatmap (0–48 h)

- Backend builds a grid of points around all routes (snap to a grid, keep cells within
  ~1–2 grid steps of any route), sized to ≤ ~300 cells, and returns per cell
  49 hourly values (risk level with the load rules applied, wind, rain, snow).
- Fetched **once**, in a second request after the routes render, so routes appear fast.
- Frontend renders a MapLibre `heatmap` layer. Each feature stores flat properties
  `r0…r48`, `w0…w48`, … Moving the slider only swaps the `heatmap-weight` expression to
  `["get", "r<h>"]` — no network, no data re-upload — so scrubbing is smooth.
- Slider hour 0 = departure time; truck markers move along each route to where the
  truck is at that hour, so you see the truck against the weather it will meet.
- Play/pause animation and a metric toggle (Risk / Wind / Rain / Snow).

## 8. API

| Method | Path            | Body / query | Returns |
|--------|-----------------|--------------|---------|
| GET    | `/api/geocode`  | `q`          | up to 6 suggestions |
| POST   | `/api/plan`     | origin, destination, departure (ISO with offset), load_lb, interval_mi | 3 routes with geometry, per-vertex times, checkpoints, summaries, recommendation |
| POST   | `/api/heatmap`  | departure, load_lb, simplified route lines | grid cells × 49 hours |
| GET    | `/api/health`   | —            | ok |

Validation: departure from 2 h ago to 14 days ahead (forecast horizon), load
1–80,000 lb, interval ∈ {10, 25, 50}, US-agnostic coordinates.

## 9. Frontend

React + TypeScript + Vite, Tailwind v4, react-map-gl (MapLibre).

- Left panel: form with geocode autocomplete, departure (local time), load weight,
  interval; then 3 route cards (Recommended badge, distance, duration, arrival,
  stacked risk-miles bar, average risk, worst checkpoint). Hover/click a card to focus
  a route.
- Map: routes (recommended highlighted), checkpoint dots coloured by level with a popup
  (ETA, wind/gust, rain, snow, reasons), heatmap underneath, legend.
- Bottom bar: forecast slider 0–48 h with timestamp, play button, metric toggle.

## 10. Code layout

```
backend/
  config/                Django settings/urls (env-driven)
  routing/
    services/
      geocoding.py       Photon client
      osrm.py            OSRM client + alternative-route synthesis
      geometry.py        haversine, polyline sampling, RDP simplification
      weather.py         Open-Meteo client, batching, caching, ETA interpolation
      risk.py            rules (pure)
      recommend.py       summaries + ranking (pure)
      corridor.py        heatmap grid
      planner.py         orchestration
    views.py, serializers.py, urls.py
    tests/               risk, recommend, geometry, weather, osrm, api (mocked HTTP)
frontend/                Vite React app
Dockerfile               multi-stage: build React, serve it from Django (whitenoise)
render.yaml              one-service deploy
```

## 11. Build order

1. Risk + recommendation engine and tests (highest-value, pure logic).
2. Geometry, OSRM (with alternatives), weather, planner, API + tests with mocked HTTP.
3. Frontend: form, map, routes, checkpoints, route cards.
4. Heatmap + slider + truck markers; performance pass.
5. README (assumptions, run, deploy), Dockerfile, render.yaml.
6. End-to-end check in a browser on real routes (short, long, and a windy/snowy case).

## Assumptions (to restate in README)

- Classification uses sustained wind; gusts are informational.
- Truck speed capped at 65 mph; no rest breaks.
- Weather beyond the forecast horizon is rejected rather than guessed.
- Times are shown in the browser's time zone.
