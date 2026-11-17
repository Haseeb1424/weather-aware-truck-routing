import { formatDuration, formatMiles, formatTime } from '../lib/format'
import { LEVEL_KEYS, RISK_COLORS, RISK_LABELS, riskColor } from '../lib/risk'
import type { RouteOption } from '../types'

interface Props {
  route: RouteOption
  recommended: boolean
  selected: boolean
  whyNot?: string
  onSelect: () => void
  onHover: (hovering: boolean) => void
}

export function RiskBar({ route }: { route: RouteOption }) {
  const m = route.summary.miles_by_level
  const total = LEVEL_KEYS.reduce((s, k) => s + m[k], 0) || 1
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100" aria-label="Miles by risk level">
      {LEVEL_KEYS.map((k, i) =>
        m[k] > 0 ? (
          <div
            key={k}
            title={`${RISK_LABELS[i]}: ${formatMiles(m[k])}`}
            style={{ width: `${(m[k] / total) * 100}%`, background: RISK_COLORS[i] }}
          />
        ) : null,
      )}
    </div>
  )
}

export function RouteCard({ route, recommended, selected, whyNot, onSelect, onHover }: Props) {
  const m = route.summary.miles_by_level
  const stats: [string, number, number][] = [
    ['No Travel', m.no_travel, 4],
    ['Severe', m.severe, 3],
    ['High', m.high, 2],
  ]
  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      aria-pressed={selected}
      className={`w-full rounded-xl border bg-white p-3 text-left transition ${
        selected ? 'border-teal-600 ring-2 ring-teal-600/20' : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{route.name}</span>
            {recommended && (
              <span className="rounded-full bg-teal-700 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase">
                Recommended
              </span>
            )}
          </div>
          <p className="truncate text-xs text-slate-500" title={route.via}>
            via {route.via || 'local roads'}
          </p>
        </div>
        <span
          className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-white"
          style={{ background: riskColor(route.summary.max_level) }}
          title="Worst checkpoint on this route"
        >
          {route.summary.max_label}
        </span>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 text-sm tabular-nums">
        <div>
          <div className="text-[11px] text-slate-500">Distance</div>
          {formatMiles(route.distance_mi)}
        </div>
        <div>
          <div className="text-[11px] text-slate-500">Drive time</div>
          {formatDuration(route.duration_s)}
        </div>
        <div>
          <div className="text-[11px] text-slate-500">Arrive</div>
          {formatTime(route.arrival)}
        </div>
      </div>

      <div className="mt-2.5">
        <RiskBar route={route} />
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-600 tabular-nums">
          {stats.map(([label, miles, level]) => (
            <span key={label} className={miles > 0 ? 'font-medium' : 'text-slate-400'}>
              <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: riskColor(level) }} />
              {label} {Math.round(miles)} mi
            </span>
          ))}
          <span className="text-slate-500">Avg risk {route.summary.avg_risk.toFixed(2)}</span>
        </div>
      </div>

      {whyNot && <p className="mt-2 text-xs text-slate-500">Not chosen — {whyNot}</p>}
    </button>
  )
}
