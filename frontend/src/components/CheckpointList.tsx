import { formatTime } from '../lib/format'
import { riskBadgeStyle } from '../lib/risk'
import type { Checkpoint } from '../types'

interface Props {
  checkpoints: Checkpoint[]
  activeIndex: number | null
  onSelect: (cp: Checkpoint) => void
}

export function CheckpointList({ checkpoints, activeIndex, onSelect }: Props) {
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <table className="w-full text-xs tabular-nums">
        <thead className="bg-ink-850 text-left text-[10px] tracking-wider text-slate-500 uppercase">
          <tr>
            <th className="py-2 pl-3 font-medium">Mile</th>
            <th className="py-2 font-medium">ETA</th>
            <th className="py-2 text-right font-medium">Wind</th>
            <th className="py-2 text-right font-medium">Rain</th>
            <th className="py-2 text-right font-medium">Snow</th>
            <th className="py-2 pr-3 text-right font-medium">Risk</th>
          </tr>
        </thead>
        <tbody>
          {checkpoints.map((cp) => (
            <tr
              key={cp.index}
              onClick={() => onSelect(cp)}
              className={`cursor-pointer border-t border-line text-slate-300 transition hover:bg-ink-800 ${
                activeIndex === cp.index ? 'bg-accent-soft text-white' : ''
              }`}
              title={cp.risk.reasons.join('\n') || 'No weather hazards'}
            >
              <td className="py-1.5 pl-3 text-slate-400">{Math.round(cp.mile)}</td>
              <td className="py-1.5 whitespace-nowrap">{formatTime(cp.eta)}</td>
              <td className="py-1.5 text-right">{Math.round(cp.weather.wind_mph)}</td>
              <td className="py-1.5 text-right">{cp.weather.rain_in_hr.toFixed(2)}</td>
              <td className="py-1.5 text-right">{cp.weather.snow_in_hr.toFixed(2)}</td>
              <td className="py-1.5 pr-3 text-right">
                <span
                  className="inline-block rounded px-1.5 py-px text-[10px] font-semibold"
                  style={riskBadgeStyle(cp.risk.level)}
                >
                  {cp.risk.label}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
