import { formatDuration, formatMiles, formatTime } from '../lib/format'
import { LEVEL_KEYS, RISK_COLORS, RISK_LABELS, riskBadgeStyle, riskColor } from '../lib/risk'
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
    <div className="flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-ink-700" aria-label="Miles by risk level">
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-medium tracking-wider text-slate-500 uppercase">{label}</div>
      <div className="text-[15px] font-semibold text-slate-100 tabular-nums">{value}</div>
    </div>
  )
}

export function RouteCard({ route, recommended, selected, whyNot, onSelect, onHover }: Props) {
  const m = route.summary.miles_by_level
  const exposure: [string, number, number][] = [
    ['No Travel', m.no_travel, 4],
    ['Severe', m.severe, 3],
    ['High', m.high, 2],
    ['Moderate', m.moderate, 1],
  ]
  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      aria-pressed={selected}
      className={`group relative w-full overflow-hidden rounded-xl border p-3.5 text-left transition ${
        selected
          ? 'border-accent/70 bg-ink-800 shadow-[0_0_0_1px_rgb(64_224_208/0.25),0_8px_24px_rgb(0_0_0/0.35)]'
          : 'border-line bg-ink-850 hover:border-line-strong hover:bg-ink-800'
      }`}
    >
      {selected && <span className="absolute inset-y-0 left-0 w-0.5 bg-accent" />}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-ink-700 text-xs font-bold text-slate-100">
              {route.id}
            </span>
            <span className="font-semibold text-white">{route.name}</span>
            {recommended && (
              <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold tracking-wider text-accent-ink uppercase">
                Recommended
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-xs text-slate-400" title={route.via}>
            via {route.via || 'local roads'}
          </p>
        </div>
        <span
          className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold"
          style={riskBadgeStyle(route.summary.max_level)}
          title="Worst checkpoint on this route"
        >
          {route.summary.max_label}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Stat label="Distance" value={formatMiles(route.distance_mi)} />
        <Stat label="Drive time" value={formatDuration(route.duration_s)} />
        <Stat label="Arrive" value={formatTime(route.arrival)} />
      </div>

      <div className="mt-3">
        <RiskBar route={route} />
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums">
          {exposure.map(([label, miles, level]) => (
            <span key={label} className={miles > 0 ? 'font-medium text-slate-200' : 'text-slate-500'}>
              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: riskColor(level) }} />
              {label} {Math.round(miles)} mi
            </span>
          ))}
          <span className="text-slate-400">Avg risk {route.summary.avg_risk.toFixed(2)}</span>
        </div>
      </div>

      {whyNot && <p className="mt-2.5 border-t border-line pt-2 text-xs text-slate-400">{whyNot}</p>}
    </button>
  )
}
