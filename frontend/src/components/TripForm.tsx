import { useState } from 'react'
import { defaultDeparture, localTz, toLocalInput } from '../lib/format'
import { inputCls, labelCls, segmentCls, segmentedCls } from '../lib/ui'
import type { Place, PlanRequest } from '../types'
import { PlaceInput } from './PlaceInput'

const EXAMPLES: { name: string; origin: Place; destination: Place }[] = [
  {
    name: 'Dallas → Denver',
    origin: { label: 'Dallas, Texas, United States', lat: 32.7767, lon: -96.797 },
    destination: { label: 'Denver, Colorado, United States', lat: 39.7392, lon: -104.9903 },
  },
  {
    name: 'Denver → Salt Lake City',
    origin: { label: 'Denver, Colorado, United States', lat: 39.7392, lon: -104.9903 },
    destination: { label: 'Salt Lake City, Utah, United States', lat: 40.7608, lon: -111.891 },
  },
  {
    name: 'Salt Lake City → Seattle',
    origin: { label: 'Salt Lake City, Utah, United States', lat: 40.7608, lon: -111.891 },
    destination: { label: 'Seattle, Washington, United States', lat: 47.6062, lon: -122.3321 },
  },
]

interface Props {
  loading: boolean
  onSubmit: (req: PlanRequest) => void
  /** Error from the last server request; cleared as soon as the user edits anything. */
  serverError: string | null
  onClearServerError: () => void
}

export function TripForm({ loading, onSubmit, serverError, onClearServerError }: Props) {
  const [origin, setOrigin] = useState<Place | null>(null)
  const [destination, setDestination] = useState<Place | null>(null)
  const [departure, setDeparture] = useState(() => toLocalInput(defaultDeparture()))
  const [load, setLoad] = useState('35000')
  const [interval, setInterval] = useState<10 | 25 | 50>(25)
  const [localError, setLocalError] = useState<string | null>(null)
  const error = localError ?? serverError

  // Any edit makes an old error stale, whether it came from this form or the server.
  const edited =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v)
      setLocalError(null)
      onClearServerError()
    }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    onClearServerError()
    const loadLb = Number(load)
    if (!origin || !destination) return setLocalError('Pick an origin and a destination from the suggestions.')
    if (!Number.isFinite(loadLb) || loadLb < 0 || loadLb > 80000) return setLocalError('Load must be 0–80,000 lb.')
    const dep = new Date(departure)
    if (Number.isNaN(dep.getTime())) return setLocalError('Enter a valid departure time.')
    setLocalError(null)
    onSubmit({ origin, destination, departure: dep.toISOString(), load_lb: loadLb, interval_mi: interval })
  }

  return (
    <form onSubmit={submit} className="space-y-3.5">
      <PlaceInput label="Origin" value={origin} onChange={edited(setOrigin)} placeholder="City or address" marker="origin" />
      <PlaceInput
        label="Destination"
        value={destination}
        onChange={edited(setDestination)}
        placeholder="City or address"
        marker="destination"
      />
      <div className="grid grid-cols-[1.35fr_1fr] gap-3">
        <div>
          <label htmlFor="departure" className={labelCls}>
            Departure ({localTz})
          </label>
          <input
            id="departure"
            type="datetime-local"
            value={departure}
            onChange={(e) => edited(setDeparture)(e.target.value)}
            className={`${inputCls} px-2.5 [color-scheme:dark]`}
          />
        </div>
        <div>
          <label htmlFor="load" className={labelCls}>
            Load weight (lb)
          </label>
          <input
            id="load"
            type="number"
            inputMode="numeric"
            min={0}
            max={80000}
            step={500}
            value={load}
            onChange={(e) => edited(setLoad)(e.target.value)}
            className={`${inputCls} tabular-nums`}
          />
        </div>
      </div>
      <fieldset>
        <legend className={labelCls}>Weather checkpoint every</legend>
        <div className={`${segmentedCls} grid-cols-3`}>
          {([10, 25, 50] as const).map((v) => (
            <button key={v} type="button" aria-pressed={interval === v} onClick={() => edited(setInterval)(v)} className={segmentCls(interval === v)}>
              {v} mi
            </button>
          ))}
        </div>
      </fieldset>
      {error && (
        <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-accent to-accent-strong py-2.5 text-sm font-semibold text-accent-ink shadow-lg shadow-accent/15 transition hover:brightness-110 disabled:cursor-wait disabled:opacity-70"
      >
        {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent-ink/30 border-t-accent-ink" />}
        {loading ? 'Planning routes…' : 'Find safest route'}
      </button>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
        <span>Try:</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex.name}
            type="button"
            className="rounded-full border border-line-strong px-2.5 py-0.5 text-slate-300 transition hover:border-accent hover:text-accent"
            onClick={() => {
              edited(setOrigin)(ex.origin)
              setDestination(ex.destination)
            }}
          >
            {ex.name}
          </button>
        ))}
      </div>
    </form>
  )
}
