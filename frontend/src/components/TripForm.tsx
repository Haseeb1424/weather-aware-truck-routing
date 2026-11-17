import { useState } from 'react'
import { defaultDeparture, localTz, toLocalInput } from '../lib/format'
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
}

export function TripForm({ loading, onSubmit }: Props) {
  const [origin, setOrigin] = useState<Place | null>(null)
  const [destination, setDestination] = useState<Place | null>(null)
  const [departure, setDeparture] = useState(() => toLocalInput(defaultDeparture()))
  const [load, setLoad] = useState('35000')
  const [interval, setInterval] = useState<10 | 25 | 50>(25)
  const [error, setError] = useState<string | null>(null)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const loadLb = Number(load)
    if (!origin || !destination) return setError('Pick an origin and a destination from the suggestions.')
    if (!Number.isFinite(loadLb) || loadLb < 0 || loadLb > 80000) return setError('Load must be 0–80,000 lb.')
    const dep = new Date(departure)
    if (Number.isNaN(dep.getTime())) return setError('Enter a valid departure time.')
    setError(null)
    onSubmit({ origin, destination, departure: dep.toISOString(), load_lb: loadLb, interval_mi: interval })
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <PlaceInput label="Origin" value={origin} onChange={setOrigin} placeholder="City or address" dotColor="#0f766e" />
      <PlaceInput
        label="Destination"
        value={destination}
        onChange={setDestination}
        placeholder="City or address"
        dotColor="#0f172a"
      />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="departure" className="mb-1 block text-xs font-medium text-slate-500">
            Departure ({localTz})
          </label>
          <input
            id="departure"
            type="datetime-local"
            value={departure}
            onChange={(e) => setDeparture(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20"
          />
        </div>
        <div>
          <label htmlFor="load" className="mb-1 block text-xs font-medium text-slate-500">
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
            onChange={(e) => setLoad(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm tabular-nums outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20"
          />
        </div>
      </div>
      <fieldset>
        <legend className="mb-1 block text-xs font-medium text-slate-500">Weather checkpoint every</legend>
        <div className="grid grid-cols-3 rounded-lg border border-slate-300 bg-white p-0.5">
          {([10, 25, 50] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={interval === v}
              onClick={() => setInterval(v)}
              className={`rounded-md py-1.5 text-sm transition ${interval === v ? 'bg-teal-700 font-medium text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {v} mi
            </button>
          ))}
        </div>
      </fieldset>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-700 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:cursor-wait disabled:opacity-70"
      >
        {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
        {loading ? 'Planning routes…' : 'Find safest route'}
      </button>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
        <span>Try:</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex.name}
            type="button"
            className="rounded-full border border-slate-200 bg-white px-2 py-0.5 hover:border-teal-600 hover:text-teal-700"
            onClick={() => {
              setOrigin(ex.origin)
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
