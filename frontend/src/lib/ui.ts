/** Shared class names so every control looks the same. */

export const labelCls = 'mb-1.5 block text-[11px] font-medium tracking-wide text-slate-400'

export const inputCls =
  'w-full rounded-lg border border-line-strong bg-ink-850 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 ' +
  'outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/25'

export const sectionTitleCls = 'text-[11px] font-semibold tracking-[0.14em] text-slate-400 uppercase'

export const segmentedCls = 'grid rounded-lg border border-line-strong bg-ink-850 p-0.5'

export const segmentCls = (active: boolean) =>
  `rounded-md py-1.5 text-sm transition ${
    active ? 'bg-accent font-semibold text-accent-ink' : 'text-slate-300 hover:bg-ink-700 hover:text-white'
  }`
