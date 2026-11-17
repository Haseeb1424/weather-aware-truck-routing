export type LngLat = [number, number]

export interface Place {
  label: string
  lat: number
  lon: number
}

export type RiskLevel = 0 | 1 | 2 | 3 | 4

export interface Checkpoint {
  index: number
  mile: number
  miles_owned: number
  lat: number
  lon: number
  elapsed_s: number
  eta: string
  weather: { wind_mph: number; gust_mph: number; rain_in_hr: number; snow_in_hr: number }
  risk: {
    level: RiskLevel
    label: string
    wind_level: RiskLevel
    rain_level: RiskLevel
    snow_level: RiskLevel
    reasons: string[]
  }
}

export interface MilesByLevel {
  low: number
  moderate: number
  high: number
  severe: number
  no_travel: number
}

export interface RouteOption {
  id: string
  name: string
  via: string
  distance_mi: number
  duration_s: number
  arrival: string
  summary: {
    miles_by_level: MilesByLevel
    avg_risk: number
    max_level: RiskLevel
    max_label: string
    worst_checkpoint_index: number | null
  }
  geometry: { coordinates: LngLat[]; times: number[] }
  checkpoints: Checkpoint[]
}

export interface Plan {
  departure: string
  load_lb: number
  interval_mi: number
  routes: RouteOption[]
  recommendation: {
    recommended_route_id: string
    ranking: string[]
    reason: string
    why_not: Record<string, string>
    all_routes_blocked: boolean
  }
}

export interface HeatCell {
  lon: number
  lat: number
  risk: number[]
  wind: number[]
  rain: number[]
  snow: number[]
}

export interface Heatmap {
  hours: number
  spacing_deg: number
  cells: HeatCell[]
}

export type Metric = 'risk' | 'wind' | 'rain' | 'snow'

export interface PlanRequest {
  origin: Place
  destination: Place
  departure: string
  load_lb: number
  interval_mi: 10 | 25 | 50
}
