import { useEffect, useId, useRef, useState } from 'react'
import { geocode } from '../api'
import type { Place } from '../types'

interface Props {
  label: string
  value: Place | null
  onChange: (place: Place | null) => void
  placeholder?: string
  dotColor: string
}

/** Text input with debounced place autocomplete and keyboard navigation. */
export function PlaceInput({ label, value, onChange, placeholder, dotColor }: Props) {
  const id = useId()
  const [text, setText] = useState(value?.label ?? '')
  const [results, setResults] = useState<Place[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  const typed = useRef(false)

  // Keep the text in sync when the parent sets the value (e.g. an example trip).
  useEffect(() => {
    typed.current = false
    setText(value?.label ?? '')
  }, [value])

  useEffect(() => {
    if (!typed.current || text.trim().length < 2) {
      setResults([])
      return
    }
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      setLoading(true)
      geocode(text, ctrl.signal)
        .then((r) => {
          setResults(r.results)
          setActive(0)
          setOpen(true)
        })
        .catch(() => {})
        .finally(() => setLoading(false))
    }, 250)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [text])

  const pick = (p: Place) => {
    onChange(p)
    setOpen(false)
  }

  return (
    <div className="relative">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-500">
        {label}
      </label>
      <div className="relative">
        <span className="absolute top-1/2 left-3 h-2.5 w-2.5 -translate-y-1/2 rounded-full" style={{ background: dotColor }} />
        <input
          id={id}
          value={text}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          className="w-full rounded-lg border border-slate-300 bg-white py-2 pr-8 pl-8 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20"
          onChange={(e) => {
            typed.current = true
            setText(e.target.value)
            if (value) onChange(null)
          }}
          onFocus={() => results.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!open || !results.length) return
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => (a + 1) % results.length)
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => (a - 1 + results.length) % results.length)
            } else if (e.key === 'Enter') {
              e.preventDefault()
              pick(results[active])
            } else if (e.key === 'Escape') {
              setOpen(false)
            }
          }}
        />
        {loading && (
          <span className="absolute top-1/2 right-3 h-3.5 w-3.5 -translate-y-1/2 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
        )}
      </div>
      {open && results.length > 0 && (
        <ul
          id={`${id}-list`}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg"
        >
          {results.map((r, i) => (
            <li
              key={`${r.label}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`cursor-pointer px-3 py-1.5 ${i === active ? 'bg-teal-50 text-teal-900' : 'text-slate-700'}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(r)
              }}
            >
              {r.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
