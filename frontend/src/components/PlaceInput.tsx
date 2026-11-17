import { useEffect, useId, useRef, useState } from 'react'
import { geocode } from '../api'
import { inputCls, labelCls } from '../lib/ui'
import type { Place } from '../types'

interface Props {
  label: string
  value: Place | null
  onChange: (place: Place | null) => void
  placeholder?: string
  marker: 'origin' | 'destination'
}

/** Text input with debounced place autocomplete and keyboard navigation. */
export function PlaceInput({ label, value, onChange, placeholder, marker }: Props) {
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
      <label htmlFor={id} className={labelCls}>
        {label}
      </label>
      <div className="relative">
        <span
          className={`absolute top-1/2 left-3 h-2.5 w-2.5 -translate-y-1/2 ${
            marker === 'origin' ? 'rounded-full bg-accent' : 'rounded-[2px] bg-white'
          }`}
        />
        <input
          id={id}
          value={text}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          className={`${inputCls} pr-8 pl-8`}
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
          <span className="absolute top-1/2 right-3 h-3.5 w-3.5 -translate-y-1/2 animate-spin rounded-full border-2 border-slate-600 border-t-accent" />
        )}
      </div>
      {open && results.length > 0 && (
        <ul
          id={`${id}-list`}
          role="listbox"
          className="scroll-thin absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-line-strong bg-ink-800 py-1 text-sm shadow-2xl shadow-black/40"
        >
          {results.map((r, i) => (
            <li
              key={`${r.label}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`cursor-pointer px-3 py-1.5 ${i === active ? 'bg-accent-soft text-white' : 'text-slate-300'}`}
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
