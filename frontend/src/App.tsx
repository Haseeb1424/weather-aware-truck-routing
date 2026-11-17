import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, fetchHeatmap, planTrip } from './api'
import { CheckpointList } from './components/CheckpointList'
import { MapView } from './components/MapView'
import { RouteCard } from './components/RouteCard'
import { TimeSlider } from './components/TimeSlider'
import { TripForm } from './components/TripForm'
import { formatTime } from './lib/format'
import { sectionTitleCls } from './lib/ui'
import type { Checkpoint, Heatmap, Metric, Plan, PlanRequest } from './types'

type HeatState = 'idle' | 'loading' | 'ready' | 'error'

function Header() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-ink-900 px-4">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft ring-1 ring-accent/30">
          <img src="/truck.svg" alt="" className="h-5 w-5" />
        </span>
        <div className="leading-tight">
          <h1 className="text-[15px] font-bold tracking-tight text-white">
            Weather-Aware <span className="text-accent">Routing</span>
          </h1>
          <p className="hidden text-[11px] text-slate-400 sm:block">Safest route by forecast at each checkpoint’s ETA</p>
        </div>
      </div>
      <div className="hidden items-center gap-2 text-[11px] text-slate-400 md:flex">
        <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_#40e0d0]" />
        Live forecast · routes via OSRM · weather via Open-Meteo
      </div>
    </header>
  )
}

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
    <div className="flex h-full flex-col">
      <Header />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="scroll-thin flex max-h-[55vh] w-full shrink-0 flex-col overflow-y-auto border-b border-line bg-ink-900 md:max-h-none md:w-[400px] md:border-r md:border-b-0">
          <section className="px-4 pt-4 pb-5">
            <h2 className={`${sectionTitleCls} mb-3`}>Trip</h2>
            <TripForm loading={loading} onSubmit={submit} />
            {error && (
              <div role="alert" className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </div>
            )}
          </section>

          {plan && rec && (
            <section className="space-y-2.5 border-t border-line px-4 py-5">
              <div className="flex items-baseline justify-between">
                <h2 className={sectionTitleCls}>Routes</h2>
                <span className="text-[11px] text-slate-500">
                  {formatTime(plan.departure)} · {plan.load_lb.toLocaleString()} lb · every {plan.interval_mi} mi
                </span>
              </div>
              {rec.all_routes_blocked ? (
                <div className="rounded-xl border border-purple-400/30 bg-purple-500/10 px-3 py-2.5 text-sm text-purple-200">
                  <strong className="text-purple-100">No route is safe at this departure time.</strong> Every option crosses a No
                  Travel zone. Route {rec.recommended_route_id} has the least exposure — consider a later departure.
                </div>
              ) : (
                <div className="flex gap-2.5 rounded-xl border border-accent/30 bg-accent-soft px-3 py-2.5 text-sm text-slate-200">
                  <svg className="mt-0.5 h-4 w-4 shrink-0 text-accent" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.86-9.86a.75.75 0 0 0-1.22-.88l-3.24 4.5-1.6-1.6a.75.75 0 1 0-1.06 1.06l2.22 2.22a.75.75 0 0 0 1.14-.09l3.76-5.21Z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <p>
                    <strong className="text-white">Take Route {rec.recommended_route_id}.</strong> {rec.reason}
                  </p>
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
            </section>
          )}

          {selected && (
            <section className="border-t border-line px-4 py-5">
              <h2 className={`${sectionTitleCls} mb-3`}>
                {selected.name} checkpoints <span className="tracking-normal text-slate-500 normal-case">({selected.checkpoints.length})</span>
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
            <div className="pointer-events-none absolute right-2 bottom-2 left-2 z-10 mx-auto max-w-3xl md:right-3 md:bottom-8 md:left-3">
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
            <div className="pointer-events-none absolute inset-x-0 top-6 z-10 mx-auto w-fit rounded-full border border-line-strong bg-ink-900/90 px-4 py-2 text-sm text-slate-300 shadow-xl backdrop-blur">
              Enter a trip to compare three routes
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
