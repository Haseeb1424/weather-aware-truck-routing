import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, fetchHeatmap, planTrip } from './api'
import { CheckpointList } from './components/CheckpointList'
import { MapView } from './components/MapView'
import { RouteCard } from './components/RouteCard'
import { TimeSlider } from './components/TimeSlider'
import { TripForm } from './components/TripForm'
import { formatTime } from './lib/format'
import type { Checkpoint, Heatmap, Metric, Plan, PlanRequest } from './types'

type HeatState = 'idle' | 'loading' | 'ready' | 'error'

export default function App() {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [focus, setFocus] = useState<Checkpoint | null>(null)

  const [heatmap, setHeatmap] = useState<Heatmap | null>(null)
  const [heatState, setHeatState] = useState<HeatState>('idle')
  const [hour, setHour] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [metric, setMetric] = useState<Metric>('risk')
  const [showHeatmap, setShowHeatmap] = useState(true)

  const inflight = useRef<AbortController | null>(null)

  const submit = async (req: PlanRequest) => {
    inflight.current?.abort()
    const ctrl = new AbortController()
    inflight.current = ctrl
    setLoading(true)
    setError(null)
    setFocus(null)
    setPlaying(false)
    try {
      const result = await planTrip(req, ctrl.signal)
      setPlan(result)
      setSelectedId(result.recommendation.recommended_route_id)
      setHour(0)
      // Second request: the corridor heatmap. Routes are already on screen.
      setHeatmap(null)
      setHeatState('loading')
      fetchHeatmap(
        { departure: result.departure, load_lb: result.load_lb, lines: result.routes.map((r) => r.geometry.coordinates) },
        ctrl.signal,
      )
        .then((h) => {
          setHeatmap(h)
          setHeatState('ready')
        })
        .catch((e) => {
          if (e.name !== 'AbortError') setHeatState('error')
        })
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setError(e instanceof ApiError ? e.message : 'Something went wrong while planning the trip.')
    } finally {
      if (inflight.current === ctrl) setLoading(false)
    }
  }

  const selectRoute = useCallback((id: string) => {
    setSelectedId(id)
    setFocus(null)
  }, [])

  // Esc closes the checkpoint popup.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFocus(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const selected = plan?.routes.find((r) => r.id === selectedId) ?? null
  const rec = plan?.recommendation
  const ordered = plan && rec ? rec.ranking.map((id) => plan.routes.find((r) => r.id === id)!) : []

  return (
    <div className="flex h-full flex-col md:flex-row">
      <aside className="flex max-h-[55vh] w-full shrink-0 flex-col overflow-y-auto border-b border-slate-200 bg-slate-50 md:max-h-none md:w-[400px] md:border-r md:border-b-0">
        <header className="px-4 pt-4 pb-3">
          <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <img src="/truck.svg" alt="" className="h-6 w-6" />
            Weather-Aware Truck Routing
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Compares three routes using the forecast at the time the truck reaches each checkpoint.
          </p>
        </header>

        <section className="px-4 pb-4">
          <TripForm loading={loading} onSubmit={submit} />
          {error && (
            <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </section>

        {plan && rec && (
          <section className="space-y-2 border-t border-slate-200 px-4 py-4">
            {rec.all_routes_blocked ? (
              <div className="rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-sm text-purple-900">
                <strong>No route is safe at this departure time.</strong> Every option crosses a No Travel zone. Route{' '}
                {rec.recommended_route_id} has the least exposure — consider a later departure.
              </div>
            ) : (
              <div className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
                <strong>Take Route {rec.recommended_route_id}.</strong> {rec.reason}
              </div>
            )}
            {ordered.map((r) => (
              <RouteCard
                key={r.id}
                route={r}
                recommended={r.id === rec.recommended_route_id}
                selected={r.id === selectedId}
                whyNot={rec.why_not[r.id]}
                onSelect={() => selectRoute(r.id)}
                onHover={(h) => setHoverId(h ? r.id : null)}
              />
            ))}
            <p className="pt-1 text-[11px] text-slate-400">
              Departs {formatTime(plan.departure)} · {plan.load_lb.toLocaleString()} lb · checkpoint every {plan.interval_mi} mi
            </p>
          </section>
        )}

        {selected && (
          <section className="border-t border-slate-200 px-4 py-4">
            <h2 className="mb-2 text-sm font-semibold">
              {selected.name} checkpoints <span className="font-normal text-slate-400">({selected.checkpoints.length})</span>
            </h2>
            <CheckpointList checkpoints={selected.checkpoints} activeIndex={focus?.index ?? null} onSelect={setFocus} />
          </section>
        )}
      </aside>

      <main className="relative min-h-[45vh] flex-1">
        <MapView
          plan={plan}
          selectedId={selectedId}
          hoverId={hoverId}
          heatmap={heatmap}
          showHeatmap={showHeatmap}
          hour={hour}
          metric={metric}
          focus={focus}
          onSelectRoute={selectRoute}
          onFocusCheckpoint={setFocus}
        />
        {plan && (
          <div className="pointer-events-none absolute right-2 bottom-2 left-2 mx-auto max-w-3xl md:right-3 md:bottom-8 md:left-3">
            <TimeSlider
              departure={plan.departure}
              hour={hour}
              onHour={setHour}
              playing={playing}
              onPlaying={setPlaying}
              metric={metric}
              onMetric={setMetric}
              showHeatmap={showHeatmap}
              onShowHeatmap={setShowHeatmap}
              heatmapState={heatState}
              arrivalHour={selected ? selected.duration_s / 3600 : null}
            />
          </div>
        )}
        {!plan && !loading && (
          <div className="pointer-events-none absolute inset-x-0 top-6 mx-auto w-fit rounded-full bg-white/90 px-4 py-2 text-sm text-slate-600 shadow">
            Enter a trip to compare routes
          </div>
        )}
      </main>
    </div>
  )
}
