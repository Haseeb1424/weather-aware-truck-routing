# Weather-Aware Truck Routing

A React + Django app that helps a truck driver pick the safest route. You enter
the origin, destination, departure time and load weight. The app builds three
routes, looks up the forecast at each checkpoint **for the time the truck will
get there**, rates each checkpoint with the given risk and load rules, and
recommends a route. Routes, checkpoints and a weather heatmap along the trip
(0–48 h, with a time slider) are shown on one map.

- **Live app:** https://weather-aware-truck-routing-alpha-nine.vercel.app
- **Walkthrough:** _add the Loom link here_

## How it works

```
Browser (React + MapLibre)
  │  POST /api/plan   ─────────────►  Django REST API
  │                                     1. OSRM: 3 distinct routes (+ via-point alternatives)
  │                                     2. Checkpoints every 10/25/50 mi, ETA per checkpoint
  │                                     3. Open-Meteo: hourly forecast, read at each ETA
  │                                     4. Risk rules → per-checkpoint level → route summary
  │  ◄── routes, checkpoints, ranking   5. Ranking + plain-English reason
  │
  │  POST /api/heatmap ────────────►  Grid of points around the routes × 49 hours
  │  ◄── cells with hourly values       (fetched once; the slider never calls the API)
```

### 1. Three routes
OSRM's public server often returns only one or two alternatives on long trips.
When it does, the backend asks for routes through **via points** on either side
of the trip, in parallel with the main request. A candidate is dropped if it:

- takes more than 1.6× the fastest route's time,
- shares more than 75% of its road with a route already chosen, or
- doubles back on itself.

A via point often snaps to a dead-end road, which adds an out-and-back detour.
That detour is **cut out** at the via point, so the route and its ETA stay
realistic. On a Denver→Salt Lake City trip, this removed a 57-mile, 3.6-hour detour.

**Truck ETAs:** the public OSRM profile is for cars, so every road segment is
capped at **65 mph** (a typical truck speed limiter).

### 2. Checkpoints and ETAs
- Checkpoints sit at mile 0, then every 10, 25 or 50 miles (your choice), then
  the destination.
- **ETA** = departure + the truck's travel time to that point, measured along
  the route.
- Each checkpoint covers the miles halfway to its neighbours. Added up, they
  equal the route length exactly, and these are the miles that "Severe miles" and
  "High miles" count.

### 3. Weather at the ETA
Open-Meteo hourly `wind_speed_10m`, `wind_gusts_10m`, `rain`, `showers` and
`snowfall`, in mph and inches.
- **Wind** is a reading at an instant, so it is interpolated between the two
  hours around the ETA.
- **Rain and snow** are totals for the *previous* hour, so they are already
  in/hr. The app uses the hour that contains the ETA. Rain includes showers.
- Points are rounded to a ~5 km grid (finer than the forecast model), duplicates
  are removed, and up to 100 locations go in each request, in parallel. Results
  are cached for 30 minutes.

### 4. Risk rules
`routing/services/risk.py` holds plain functions with no I/O. They are tested at
every boundary.

| Condition | Low | Moderate | High | Severe | No Travel |
|---|---|---|---|---|---|
| Wind (mph) | < 25 | 25–34 | 35–44 | 45–54 | ≥ 55 |
| Rain (in/hr) | < 0.10 | 0.10–0.25 | 0.25–0.50 | 0.50–1.00 | > 1.00 |
| Snow (in/hr) | < 0.5 | 0.5–1.0 | 1.0–2.0 | 2.0–3.0 | > 3.0 |

Load rules: wind ≥ 55 mph → No Travel for any load. 45–54 mph with more than
30,000 lb → No Travel. 35–44 mph with more than 40,000 lb → Severe.
A checkpoint's level is the worst of wind (after the load rules), rain and snow.
Every non-Low checkpoint lists its reasons, e.g. *"Wind 47 mph with 42,000 lb
load (> 30,000 lb) → No Travel"*.

### 5. Recommendation
Routes are compared on each criterion in order. The next criterion is used only
when routes tie on the one before:

0. **No Travel miles**
1. Severe miles
2. High miles
3. Average risk, weighted by miles (0 = Low … 4 = No Travel)
4. Travel time

Each losing route gets the criterion it lost on, e.g. *"Fewest Severe miles:
0 mi vs 50 mi on Route A."*. If every route crosses a No Travel zone, the UI says
no route is safe at that departure time.

### 6. Heatmap and slider (built for smoothness)
- The backend picks grid points around all the routes. The grid is finer for
  short trips and coarser cross-country, capped at 160 points (about one forecast lookup each). Each point gets
  49 hourly values for risk (with the load rules applied), wind, rain and snow.
- It is fetched **once**, after the routes are already on screen.
- Each hour is stored as a separate property on each point (`risk0…risk48`). The
  slider only swaps the heatmap's paint expression, so no data is re-sent to the
  GPU while you scrub.
- **Fractional hours:** the expression blends the two neighbouring hours, so
  scrubbing and the Play animation are continuous (driven by `requestAnimationFrame`).
- The heatmap blur radius is two grid steps at every zoom level. At that radius,
  an even weather field displays at its actual value instead of as separate dots.
- Colours change at the same thresholds as the risk table for every metric.
- A truck marker for each route shows where that truck is at the selected
  hour, so you can see it against the weather it will meet.

## Assumptions and limits

| Topic | Decision |
|---|---|
| Overlapping bands (e.g. rain 0.25 sits in two bands) | A boundary value goes to the **higher** band (safer). The exception is where the spec writes the top band with ">" (rain > 1.00, snow > 3.0), so exactly 1.00 in/hr is Severe. Wind bands are whole mph: [25,35), [35,45), [45,55), ≥ 55. |
| No Travel in the ranking | Ranked before Severe miles. The spec's list doesn't mention it, but a forbidden route must never beat a merely Severe one. |
| "Average risk" | Weighted by miles, Low=0 … No Travel=4, rounded to 0.01 so tiny differences don't decide the ranking. |
| Wind | Sustained wind is classified (the table uses sustained-wind thresholds). Gusts are shown but not rated. |
| Truck speed | Capped at 65 mph. Hours-of-service breaks aren't modelled. |
| Forecast horizon | Departure must be within 14 days. Beyond that, forecasts aren't reliable enough to classify. |
| Time zone | Times are entered and shown in the browser's time zone. The API exchanges UTC ISO-8601. |
| Free services | OSRM demo server, Open-Meteo free tier (~10k location-calls/day) and Photon geocoding. No API keys are needed. Routes are cached for 1 h per origin/destination, so changing the load or departure re-uses them (≈0.2 s instead of ≈5 s). For production, point `OSRM_URL` at a self-hosted OSRM (or a truck-aware router) and set `OPEN_METEO_API_KEY`. |

## Project layout

```
api/index.py                 Vercel entry point (wraps the Django app)
vercel.json                  Vercel build, function and rewrite config
backend/
  config/                    settings (env-driven), URLs, serves the built SPA
  routing/
    services/
      risk.py                risk + load rules (pure)
      recommend.py           route summaries + ranking + explanations (pure)
      geometry.py            haversine, interpolation, simplification, spatial index
      osrm.py                OSRM client, alternative routes, detour trimming
      weather.py             Open-Meteo client, batching, caching, value at ETA
      corridor.py            heatmap grid
      planner.py             orchestration: routes → checkpoints → weather → risk → ranking
      geocoding.py           Photon place search
    serializers.py           request validation
    views.py, urls.py        /api/plan, /api/heatmap, /api/geocode, /api/health
    tests/                   75 tests: rules, ranking, geometry, weather, routing, API (HTTP mocked)
frontend/src/
  App.tsx                    state + layout
  components/MapView.tsx     MapLibre map: risk-coloured route, checkpoints, heatmap, trucks
  components/TimeSlider.tsx  0–48 h slider, play, metric switch, legend
  components/RouteCard.tsx   per-route summary with risk-miles bar
  components/TripForm.tsx    inputs + place autocomplete
  lib/geo.ts                 risk segments, truck position, heatmap GeoJSON
```

## Run locally

Requires Python 3.12+ and Node 20+.

```bash
# API
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env            # sets DJANGO_DEBUG=true
python manage.py runserver 8000
```

```bash
# Web (in another terminal)
cd frontend
npm install
npm run dev                     # http://localhost:5180, proxies /api to :8000
```

Tests and checks:

```bash
cd backend && pytest -q
cd frontend && npm run lint && npm run build
```

## Deploy

No environment variables are required on any host: every external service is
keyless, and the app signs nothing (no sessions, logins or cookies), so Django's
secret key is generated per process when none is set.

### Vercel (the hosted demo)

Import the repository at vercel.com → **Add New → Project**, keep the defaults,
and deploy. `vercel.json` does the rest:

- builds `frontend/` and serves it from Vercel's CDN;
- runs the Django API as one Python function, `api/index.py`, with `/api/*`
  rewritten to it (Django still sees the original path);
- allows the function up to 60 s (cross-country plans take ~12 s on a cold cache).

Note: serverless instances don't share memory, so the in-process route and
forecast cache only helps while an instance stays warm. Planning a trip takes
~4–7 s either way; the map, heatmap and slider run entirely in the browser.

### Docker (Render, Fly.io, Railway, a VM)

The image builds the React app and serves it from Django: one service, one URL,
no CORS.

```bash
docker build -t weather-truck-routing .
docker run -p 8000:8000 -e DJANGO_ALLOWED_HOSTS=localhost weather-truck-routing
```

On Render, `render.yaml` is a ready-made blueprint (New → Blueprint); Render's
hostname is picked up automatically.

## API

`POST /api/plan`
```json
{
  "origin": {"lat": 39.7392, "lon": -104.9903, "label": "Denver, CO"},
  "destination": {"lat": 40.7608, "lon": -111.891, "label": "Salt Lake City, UT"},
  "departure": "2026-11-18T14:00:00Z",
  "load_lb": 42000,
  "interval_mi": 25
}
```
Returns `routes[]`. Each route has a distance, truck duration, arrival time,
`summary.miles_by_level`, `avg_risk`, a simplified geometry with a timestamp for
each point, and `checkpoints[]` (mile, ETA, weather, risk level and reasons).
Also returns `recommendation` (`recommended_route_id`, `ranking`, `reason`,
`why_not`, `all_routes_blocked`).

`POST /api/heatmap` with `{departure, load_lb, lines: [[[lon,lat],…],…]}` returns
`{hours: 48, spacing_deg, cells: [{lon, lat, risk[49], wind[49], rain[49], snow[49]}]}`.

`GET /api/geocode?q=…` returns place suggestions. `GET /api/health` is the health check.

Errors: `400` validation (field messages), `422` no drivable route, `502` an
upstream service failed (the message says which).
