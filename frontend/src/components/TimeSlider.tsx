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

  return (
    <div className="pointer-events-auto rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-lg backdrop-blur sm:p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={() => {
            if (!playing && hour >= MAX_HOURS) onHour(0)
            onPlaying(!playing)
          }}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-700 text-white hover:bg-teal-800"
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
          <div className="text-sm font-semibold tabular-nums">{formatTime(at)}</div>
          <div className="text-xs text-slate-500 tabular-nums">Departure + {hour.toFixed(hour % 1 ? 1 : 0)} h</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs" role="group" aria-label="Heatmap metric">
            {(Object.keys(METRICS) as Metric[]).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={metric === k}
                onClick={() => {
                  onMetric(k)
                  onShowHeatmap(true)
                }}
                className={`rounded-md px-2 py-1 ${metric === k && showHeatmap ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {METRICS[k].label}
              </button>
            ))}
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={showHeatmap} onChange={(e) => onShowHeatmap(e.target.checked)} className="accent-teal-700" />
            Heatmap
          </label>
        </div>
      </div>

      <div className="relative mt-2">
        <input
          type="range"
          className="slider w-full"
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
            className="pointer-events-none absolute -top-1 h-2 w-0.5 -translate-x-1/2 bg-slate-900"
            style={{ left: `${(arrivalHour / MAX_HOURS) * 100}%` }}
            title="Selected route arrives"
          />
        )}
        <div className="flex justify-between text-[10px] text-slate-400 tabular-nums">
          {[0, 12, 24, 36, 48].map((h) => (
            <span key={h}>{h}h</span>
          ))}
        </div>
      </div>

      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <div className="flex items-center gap-1">
          <span>{m.label}{m.unit && ` (${m.unit})`}</span>
          <div className="flex overflow-hidden rounded">
            {m.legend.map((label, i) => (
              <span
                key={label}
                className="px-1.5 py-px text-[10px] font-medium"
                style={{ background: i === 0 ? '#e2e8f0' : RISK_COLORS[i], color: i === 0 ? '#475569' : '#fff' }}
              >
                {label}
              </span>
            ))}
          </div>
        </div>
        <span>
          {heatmapState === 'loading' && 'Loading corridor forecast…'}
          {heatmapState === 'error' && <span className="text-red-600">Heatmap unavailable</span>}
          {heatmapState === 'ready' && <span className="hidden sm:inline">Trucks show each route’s position at this time</span>}
        </span>
      </div>
    </div>
  )
}
