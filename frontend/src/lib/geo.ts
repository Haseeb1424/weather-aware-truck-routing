import type { Feature, FeatureCollection, LineString, Point } from 'geojson'
import type { HeatCell, LngLat, Metric, RouteOption } from '../types'

const R = 6371008.8
const rad = (d: number) => (d * Math.PI) / 180

export function haversine(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1])
  const dLon = rad(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

function lerp(a: LngLat, b: LngLat, f: number): LngLat {
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
}

/** Largest i with arr[i] <= x (arr ascending). */
function bisect(arr: number[], x: number): number {
  let lo = 0
  let hi = arr.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (arr[mid] <= x) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Point along the route at `t` seconds after departure (clamped to the ends). */
export function positionAt(route: RouteOption, t: number): { point: LngLat; arrived: boolean } {
  const { coordinates: c, times } = route.geometry
  if (t <= 0) return { point: c[0], arrived: false }
  if (t >= times[times.length - 1]) return { point: c[c.length - 1], arrived: true }
  const i = bisect(times, t)
  const span = times[i + 1] - times[i]
  return { point: lerp(c[i], c[i + 1], span > 0 ? (t - times[i]) / span : 0), arrived: false }
}

/**
 * Split the route line into pieces coloured by checkpoint risk. Each checkpoint
 * owns the stretch halfway to its neighbours (the same rule the backend uses to
 * count risk miles), so the colours match the summary numbers exactly.
 */
export function riskSegments(route: RouteOption): FeatureCollection<LineString, { level: number }> {
  const coords = route.geometry.coordinates
  const cum = [0]
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]))
  // Display geometry is simplified, so scale checkpoint miles onto its length.
  const scale = cum[cum.length - 1] / (route.distance_mi || 1)
  const cps = route.checkpoints
  const bounds = cps.map((cp, i) => (i === 0 ? 0 : ((cps[i - 1].mile + cp.mile) / 2) * scale))
  bounds.push(cum[cum.length - 1])

  const pointAt = (d: number): LngLat => {
    const i = Math.min(bisect(cum, d), coords.length - 2)
    const span = cum[i + 1] - cum[i]
    return lerp(coords[i], coords[i + 1], span > 0 ? (d - cum[i]) / span : 0)
  }

  const features: Feature<LineString, { level: number }>[] = []
  let current: { level: number; coords: LngLat[] } | null = null
  for (let k = 0; k < cps.length; k++) {
    const start = bounds[k]
    const end = bounds[k + 1]
    const level = cps[k].risk.level
    const piece: LngLat[] = [pointAt(start)]
    for (let i = bisect(cum, start) + 1; i < coords.length && cum[i] < end; i++) piece.push(coords[i])
    piece.push(pointAt(end))
    if (current && current.level === level) {
      current.coords.push(...piece.slice(1)) // merge equal neighbours → fewer features
    } else {
      if (current) features.push(line(current.coords, current.level))
      current = { level, coords: piece }
    }
  }
  if (current) features.push(line(current.coords, current.level))
  return { type: 'FeatureCollection', features }
}

const line = (coordinates: LngLat[], level: number): Feature<LineString, { level: number }> => ({
  type: 'Feature',
  properties: { level },
  geometry: { type: 'LineString', coordinates },
})

/**
 * Heatmap cells as GeoJSON points with flat per-hour properties (`risk0`…`risk48`,
 * `wind0`…). The map then switches hours by changing only a paint expression —
 * no data is re-uploaded while the slider moves.
 */
export function heatCellsToGeoJSON(cells: HeatCell[]): FeatureCollection<Point> {
  const metrics: Metric[] = ['risk', 'wind', 'rain', 'snow']
  return {
    type: 'FeatureCollection',
    features: cells.map((cell) => {
      const props: Record<string, number> = {}
      for (const m of metrics) cell[m].forEach((v, h) => (props[`${m}${h}`] = v))
      return { type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [cell.lon, cell.lat] } }
    }),
  }
}

export function boundsOf(routes: RouteOption[]): [LngLat, LngLat] {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of routes)
    for (const [x, y] of r.geometry.coordinates) {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  return [
    [minX, minY],
    [maxX, maxY],
  ]
}
