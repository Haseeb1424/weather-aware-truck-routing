import { useEffect, useRef } from 'react'
import { formatTime } from '../lib/format'
import { METRICS, RISK_COLORS } from '../lib/risk'
import type { Metric } from '../types'

const MAX_HOURS = 48
const PLAY_HOURS_PER_SECOND = 3

interface Props {
  departure: string
  hour: number
  onHour: (h: number) => void
  playing: boolean
  onPlaying: (p: boolean) => void
  metric: Metric
  onMetric: (m: Metric) => void
  showHeatmap: boolean
  onShowHeatmap: (v: boolean) => void
  heatmapState: 'idle' | 'loading' | 'ready' | 'error'
  arrivalHour: number | null
}

export function TimeSlider(props: Props) {
  const { departure, hour, onHour, playing, onPlaying, metric, onMetric, showHeatmap, onShowHeatmap, heatmapState, arrivalHour } =
    props
  const hourRef = useRef(hour)
  hourRef.current = hour

  // requestAnimationFrame playback: advances continuously (fractional hours),
  // the map blends neighbouring hours, so the animation is smooth.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const next = hourRef.current + ((now - last) / 1000) * PLAY_HOURS_PER_SECOND
      last = now
      if (next >= MAX_HOURS) {
        onHour(MAX_HOURS)
        onPlaying(false)
        return
      }
      onHour(next)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, onHour, onPlaying])

  const at = new Date(new Date(departure).getTime() + hour * 3600_000)
  const m = METRICS[metric]
  const pct = (hour / MAX_HOURS) * 100

  return (
    <div className="pointer-events-auto rounded-2xl border border-line-strong bg-ink-900/90 p-2.5 text-slate-200 shadow-2xl shadow-black/50 backdrop-blur-md sm:p-3.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={() => {
            if (!playing && hour >= MAX_HOURS) onHour(0)
            onPlaying(!playing)
          }}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink shadow-lg shadow-accent/20 transition hover:brightness-110"
          aria-label={playing ? 'Pause forecast' : 'Play forecast'}
        >
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <rect x="2" y="1" width="3.5" height="12" rx="1" />
              <rect x="8.5" y="1" width="3.5" height="12" rx="1" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <path d="M3 1.5v11a.5.5 0 0 0 .76.43l9-5.5a.5.5 0 0 0 0-.86l-9-5.5A.5.5 0 0 0 3 1.5Z" />
            </svg>
          )}
        </button>
        <div className="min-w-[150px]">
          <div className="hidden text-[10px] font-semibold tracking-[0.14em] text-slate-500 uppercase sm:block">Forecast time</div>
          <div className="text-sm font-semibold text-white tabular-nums">
            {formatTime(at)}{' '}
            <span className="font-normal text-slate-400">· +{hour.toFixed(hour % 1 ? 1 : 0)} h</span>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-lg border border-line-strong bg-ink-850 p-0.5 text-xs" role="group" aria-label="Heatmap metric">
            {(Object.keys(METRICS) as Metric[]).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={metric === k}
                onClick={() => {
                  onMetric(k)
                  onShowHeatmap(true)
                }}
                className={`rounded-md px-2.5 py-1 transition ${
                  metric === k && showHeatmap ? 'bg-accent font-semibold text-accent-ink' : 'text-slate-300 hover:bg-ink-700 hover:text-white'
                }`}
              >
                {METRICS[k].label}
              </button>
            ))}
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-300">
            <input type="checkbox" checked={showHeatmap} onChange={(e) => onShowHeatmap(e.target.checked)} className="accent-[#40e0d0]" />
            Heatmap
          </label>
        </div>
      </div>

      <div className="relative mt-3">
        {/* Filled track: departure → current hour */}
        <div className="pointer-events-none absolute top-[9px] left-0 h-1 w-full rounded-full bg-ink-700" />
        <div className="pointer-events-none absolute top-[9px] left-0 h-1 rounded-full bg-accent/70" style={{ width: `${pct}%` }} />
        <input
          type="range"
          className="slider relative w-full appearance-none bg-transparent [&::-webkit-slider-runnable-track]:h-[22px] [&::-webkit-slider-thumb]:mt-[3px] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-ink-900 [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:shadow-[0_0_0_4px_rgb(64_224_208/0.2)]"
          min={0}
          max={MAX_HOURS}
          step={0.25}
          value={hour}
          onChange={(e) => {
            onPlaying(false)
            onHour(Number(e.target.value))
          }}
          aria-label="Forecast hour"
        />
        {arrivalHour !== null && arrivalHour <= MAX_HOURS && (
          <div
            className="pointer-events-none absolute -top-3 -translate-x-1/2 text-[9px] font-semibold tracking-wider text-slate-400 uppercase"
            style={{ left: `${(arrivalHour / MAX_HOURS) * 100}%` }}
            title="Selected route arrives"
          >
            <span className="block">Arrive</span>
            <span className="mx-auto mt-0.5 block h-2 w-px bg-slate-400" />
          </div>
        )}
        <div className="mt-0.5 flex justify-between text-[10px] text-slate-500 tabular-nums">
          {[0, 12, 24, 36, 48].map((h) => (
            <span key={h}>{h}h</span>
          ))}
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
        <div className="flex items-center gap-2">
          <span>
            {m.label}
            {m.unit && ` (${m.unit})`}
          </span>
          <div className="flex overflow-hidden rounded">
            {m.legend.map((label, i) => (
              <span
                key={label}
                className="px-1.5 py-px text-[10px] font-semibold"
                style={{ background: i === 0 ? '#22394f' : RISK_COLORS[i], color: i === 0 ? '#cbd5e1' : '#fff' }}
              >
                {label}
              </span>
            ))}
          </div>
        </div>
        <span>
          {heatmapState === 'loading' && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-600 border-t-accent" />
              Loading corridor forecast…
            </span>
          )}
          {heatmapState === 'error' && <span className="text-red-400">Heatmap unavailable — weather service busy</span>}
          {heatmapState === 'ready' && <span className="hidden sm:inline">Markers show each truck’s position at this time</span>}
        </span>
      </div>
    </div>
  )
}
