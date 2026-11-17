import { formatTime } from '../lib/format'
import { riskColor } from '../lib/risk'
import type { Checkpoint } from '../types'

interface Props {
  checkpoints: Checkpoint[]
  activeIndex: number | null
  onSelect: (cp: Checkpoint) => void
}

export function CheckpointList({ checkpoints, activeIndex, onSelect }: Props) {
  return (
    <table className="w-full text-xs tabular-nums">
      <thead className="sticky top-0 bg-slate-50 text-left text-[11px] text-slate-500">
        <tr>
          <th className="py-1 pl-1 font-medium">Mile</th>
          <th className="py-1 font-medium">ETA</th>
          <th className="py-1 text-right font-medium">Wind</th>
          <th className="py-1 text-right font-medium">Rain</th>
          <th className="py-1 text-right font-medium">Snow</th>
          <th className="py-1 pr-1 text-right font-medium">Risk</th>
        </tr>
      </thead>
      <tbody>
        {checkpoints.map((cp) => (
          <tr
            key={cp.index}
            onClick={() => onSelect(cp)}
            className={`cursor-pointer border-t border-slate-100 hover:bg-teal-50 ${activeIndex === cp.index ? 'bg-teal-50' : ''}`}
            title={cp.risk.reasons.join('\n') || 'No weather hazards'}
          >
            <td className="py-1 pl-1">{Math.round(cp.mile)}</td>
            <td className="py-1 whitespace-nowrap">{formatTime(cp.eta)}</td>
            <td className="py-1 text-right">{Math.round(cp.weather.wind_mph)}</td>
            <td className="py-1 text-right">{cp.weather.rain_in_hr.toFixed(2)}</td>
            <td className="py-1 text-right">{cp.weather.snow_in_hr.toFixed(2)}</td>
            <td className="py-1 pr-1 text-right">
              <span
                className="inline-block rounded px-1.5 py-px text-[10px] font-semibold text-white"
                style={{ background: riskColor(cp.risk.level) }}
              >
                {cp.risk.label}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
