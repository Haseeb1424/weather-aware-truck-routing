import type { Heatmap, LngLat, Place, Plan, PlanRequest } from './types'

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError('Network error — is the server running?')
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(formatError(body) ?? `Request failed (${res.status})`)
  return body as T
}

/** Flatten DRF validation errors ({field: [msg]}) into one readable line. */
function formatError(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (typeof b.detail === 'string') return b.detail
  const parts: string[] = []
  for (const [field, value] of Object.entries(b)) {
    const msg = Array.isArray(value) ? value.join(' ') : typeof value === 'object' ? formatError(value) : String(value)
    parts.push(field === 'non_field_errors' ? `${msg}` : `${field.replace(/_/g, ' ')}: ${msg}`)
  }
  return parts.join(' · ') || null
}

export function geocode(q: string, signal?: AbortSignal): Promise<{ results: Place[] }> {
  return request(`/api/geocode?q=${encodeURIComponent(q)}`, { signal })
}

export function planTrip(body: PlanRequest, signal?: AbortSignal): Promise<Plan> {
  return request('/api/plan', { method: 'POST', body: JSON.stringify(body), signal })
}

export function fetchHeatmap(
  body: { departure: string; load_lb: number; lines: LngLat[][] },
  signal?: AbortSignal,
): Promise<Heatmap> {
  return request('/api/heatmap', { method: 'POST', body: JSON.stringify(body), signal })
}
