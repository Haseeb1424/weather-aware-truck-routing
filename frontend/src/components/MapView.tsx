import type { ExpressionSpecification, MapLayerMouseEvent } from 'maplibre-gl'
import { useEffect, useMemo, useRef, useState } from 'react'
import Map, { AttributionControl, Layer, Marker, NavigationControl, Popup, ScaleControl, Source, type MapRef } from 'react-map-gl/maplibre'
import { formatTime } from '../lib/format'
import { boundsOf, heatCellsToGeoJSON, positionAt, riskSegments } from '../lib/geo'
import { METRICS, RISK_COLORS, riskColor } from '../lib/risk'
import type { Checkpoint, Heatmap, Metric, Plan } from '../types'

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
const HEATMAP_MAX_ZOOM = 10

interface Props {
  plan: Plan | null
  selectedId: string | null
  hoverId: string | null
  heatmap: Heatmap | null
  showHeatmap: boolean
  hour: number
  metric: Metric
  focus: Checkpoint | null
  onSelectRoute: (id: string) => void
  onFocusCheckpoint: (cp: Checkpoint | null) => void
}

/** Colour ramp stops (0–1 weight) at each metric's risk thresholds, so the
 * heatmap uses the same colours as the risk table. */
const THRESHOLDS: Record<Metric, number[]> = {
  // Risk weight is (level + 1) / 5, so Low (0.2) still tints the corridor green.
  risk: [0.4, 0.6, 0.8, 1],
  wind: [25 / 55, 35 / 55, 45 / 55, 1],
  rain: [0.1, 0.25, 0.5, 1],
  snow: [0.5 / 3, 1 / 3, 2 / 3, 1],
}

function heatColor(metric: Metric): ExpressionSpecification {
  const [mod, high, sev, nt] = THRESHOLDS[metric]
  const rgba = (hex: string, a: number) => {
    const n = parseInt(hex.slice(1), 16)
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`
  }
  return [
    'interpolate',
    ['linear'],
    ['heatmap-density'],
    0,
    'rgba(0,0,0,0)',
    mod * 0.5,
    metric === 'risk' ? rgba(RISK_COLORS[0], 0.2) : 'rgba(56,189,248,0.22)',
    mod,
    rgba(RISK_COLORS[1], 0.5),
    high,
    rgba(RISK_COLORS[2], 0.6),
    sev,
    rgba(RISK_COLORS[3], 0.66),
    nt,
    rgba(RISK_COLORS[4], 0.72),
  ]
}

/** Per-feature weight for a (possibly fractional) hour: blends the two
 * neighbouring hourly values so scrubbing and playback are continuous. */
function heatWeight(metric: Metric, hour: number, maxHour: number): ExpressionSpecification {
  const h0 = Math.min(Math.floor(hour), maxHour)
  const h1 = Math.min(h0 + 1, maxHour)
  const f = hour - h0
  const value: ExpressionSpecification =
    f < 0.001
      ? ['get', `${metric}${h0}`]
      : ['+', ['*', 1 - f, ['get', `${metric}${h0}`]], ['*', f, ['get', `${metric}${h1}`]]]
  if (metric === 'risk') return ['/', ['+', value, 1], 5]
  return ['min', 1, ['/', value, METRICS[metric].max]]
}

export function MapView(props: Props) {
  const { plan, selectedId, hoverId, heatmap, showHeatmap, hour, metric, focus, onSelectRoute, onFocusCheckpoint } = props
  const mapRef = useRef<MapRef>(null)
  const [cursor, setCursor] = useState('')

  const selected = plan?.routes.find((r) => r.id === selectedId) ?? null
  const recommendedId = plan?.recommendation.recommended_route_id

  // Fit to the routes whenever a new plan arrives.
  useEffect(() => {
    if (!plan || !mapRef.current) return
    mapRef.current.fitBounds(boundsOf(plan.routes), { padding: { top: 60, bottom: 150, left: 60, right: 60 }, duration: 900 })
  }, [plan])

  useEffect(() => {
    if (focus && mapRef.current) {
      mapRef.current.easeTo({ center: [focus.lon, focus.lat], zoom: Math.max(mapRef.current.getZoom(), 7), duration: 600 })
    }
  }, [focus])

  const routesGeo = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: (plan?.routes ?? []).map((r) => ({
        type: 'Feature' as const,
        properties: { id: r.id },
        geometry: { type: 'LineString' as const, coordinates: r.geometry.coordinates },
      })),
    }),
    [plan],
  )
  const segmentsGeo = useMemo(() => (selected ? riskSegments(selected) : null), [selected])
  const checkpointsGeo = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: (selected?.checkpoints ?? []).map((cp) => ({
        type: 'Feature' as const,
        properties: { index: cp.index, level: cp.risk.level },
        geometry: { type: 'Point' as const, coordinates: [cp.lon, cp.lat] },
      })),
    }),
    [selected],
  )
  const heatGeo = useMemo(() => (heatmap ? heatCellsToGeoJSON(heatmap.cells) : null), [heatmap])

  // Heatmap kernel radius ≈ 2 grid steps in pixels at every zoom (see README:
  // with this radius a uniform field renders at its true value, without dots).
  const heatRadius = useMemo<ExpressionSpecification>(() => {
    const base = (2 * (heatmap?.spacing_deg ?? 0.25) * 512) / 360 // px at zoom 0
    return ['interpolate', ['exponential', 2], ['zoom'], 0, base, HEATMAP_MAX_ZOOM, base * 2 ** HEATMAP_MAX_ZOOM]
  }, [heatmap])

  const trucks = useMemo(
    () => (plan ? plan.routes.map((r) => ({ id: r.id, ...positionAt(r, hour * 3600) })) : []),
    [plan, hour],
  )

  const onClick = (e: MapLayerMouseEvent) => {
    const f = e.features?.[0]
    if (!f || !plan) return onFocusCheckpoint(null)
    if (f.layer.id === 'checkpoints' && selected) {
      onFocusCheckpoint(selected.checkpoints[f.properties.index as number])
    } else if (f.layer.id === 'routes-hit') {
      onSelectRoute(f.properties.id as string)
    }
  }

  const origin = plan?.routes[0].geometry.coordinates[0]
  const destination = plan?.routes[0].geometry.coordinates.at(-1)

  return (
    <Map
      ref={mapRef}
      initialViewState={{ longitude: -98.5, latitude: 39.5, zoom: 3.6 }}
      mapStyle={MAP_STYLE}
      interactiveLayerIds={['checkpoints', 'routes-hit']}
      onClick={onClick}
      onMouseEnter={() => setCursor('pointer')}
      onMouseLeave={() => setCursor('')}
      cursor={cursor}
      style={{ width: '100%', height: '100%' }}
      attributionControl={false}
    >
      <AttributionControl compact position="top-left" />
      <NavigationControl position="top-right" showCompass={false} />
      <ScaleControl position="bottom-right" unit="imperial" />

      {heatGeo && (
        <Source id="heat" type="geojson" data={heatGeo}>
          <Layer
            id="heat"
            type="heatmap"
            maxzoom={HEATMAP_MAX_ZOOM}
            layout={{ visibility: showHeatmap ? 'visible' : 'none' }}
            paint={{
              'heatmap-weight': heatWeight(metric, hour, heatmap!.hours),
              'heatmap-intensity': 0.9,
              'heatmap-radius': heatRadius,
              'heatmap-color': heatColor(metric),
              'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.9, HEATMAP_MAX_ZOOM, 0],
            }}
          />
        </Source>
      )}

      <Source id="routes" type="geojson" data={routesGeo}>
        <Layer
          id="routes-alt-casing"
          type="line"
          filter={['!=', ['get', 'id'], selectedId ?? '']}
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': '#ffffff', 'line-width': 7 }}
        />
        <Layer
          id="routes-alt"
          type="line"
          filter={['!=', ['get', 'id'], selectedId ?? '']}
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{
            'line-color': ['case', ['==', ['get', 'id'], hoverId ?? ''], '#475569', '#94a3b8'],
            'line-width': 4,
          }}
        />
        <Layer id="routes-hit" type="line" paint={{ 'line-color': '#000', 'line-opacity': 0, 'line-width': 16 }} />
      </Source>

      {segmentsGeo && (
        <Source id="selected" type="geojson" data={segmentsGeo}>
          <Layer
            id="selected-casing"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': '#0f172a', 'line-width': 9, 'line-opacity': 0.85 }}
          />
          <Layer
            id="selected-line"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{
              'line-color': ['match', ['get', 'level'], 0, RISK_COLORS[0], 1, RISK_COLORS[1], 2, RISK_COLORS[2], 3, RISK_COLORS[3], RISK_COLORS[4]],
              'line-width': 5.5,
            }}
          />
        </Source>
      )}

      <Source id="checkpoints" type="geojson" data={checkpointsGeo}>
        <Layer
          id="checkpoints"
          type="circle"
          paint={{
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 3.5, 9, 7],
            'circle-color': ['match', ['get', 'level'], 0, RISK_COLORS[0], 1, RISK_COLORS[1], 2, RISK_COLORS[2], 3, RISK_COLORS[3], RISK_COLORS[4]],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': ['case', ['==', ['get', 'index'], focus?.index ?? -1], 3, 1.5],
          }}
        />
      </Source>

      {origin && (
        <Marker longitude={origin[0]} latitude={origin[1]}>
          <div className="h-4 w-4 rounded-full border-[3px] border-white bg-teal-700 shadow" title="Origin" />
        </Marker>
      )}
      {destination && (
        <Marker longitude={destination[0]} latitude={destination[1]}>
          <div className="h-4 w-4 rounded-sm border-[3px] border-white bg-slate-900 shadow" title="Destination" />
        </Marker>
      )}

      {trucks.map((t) => {
        const isSel = t.id === selectedId
        return (
          <Marker key={t.id} longitude={t.point[0]} latitude={t.point[1]} style={{ zIndex: isSel ? 3 : 2 }}>
            <div
              className={`flex items-center justify-center rounded-full border-2 border-white font-bold text-white shadow-md transition-opacity ${
                isSel ? 'h-7 w-7 bg-teal-700 text-[11px]' : 'h-5 w-5 bg-slate-500 text-[9px] opacity-80'
              }`}
              title={`${t.id === recommendedId ? 'Recommended — ' : ''}Route ${t.id} truck${t.arrived ? ' (arrived)' : ''}`}
            >
              {t.id}
            </div>
          </Marker>
        )
      })}

      {focus && (
        <Popup
          longitude={focus.lon}
          latitude={focus.lat}
          onClose={() => onFocusCheckpoint(null)}
          closeOnClick={false}
          maxWidth="260px"
          offset={10}
        >
          <CheckpointPopup cp={focus} />
        </Popup>
      )}
    </Map>
  )
}

function CheckpointPopup({ cp }: { cp: Checkpoint }) {
  const w = cp.weather
  return (
    <div className="text-xs text-slate-700">
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="font-semibold text-slate-900">Mile {Math.round(cp.mile)}</span>
        <span className="rounded px-1.5 py-px text-[10px] font-semibold text-white" style={{ background: riskColor(cp.risk.level) }}>
          {cp.risk.label}
        </span>
      </div>
      <div className="mb-1.5 text-slate-500">ETA {formatTime(cp.eta)}</div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 tabular-nums">
        <dt className="text-slate-500">Wind</dt>
        <dd>
          {Math.round(w.wind_mph)} mph <span className="text-slate-400">(gusts {Math.round(w.gust_mph)})</span>
        </dd>
        <dt className="text-slate-500">Rain</dt>
        <dd>{w.rain_in_hr.toFixed(2)} in/hr</dd>
        <dt className="text-slate-500">Snow</dt>
        <dd>{w.snow_in_hr.toFixed(2)} in/hr</dd>
      </dl>
      {cp.risk.reasons.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 border-t border-slate-100 pt-1.5 pl-4">
          {cp.risk.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
