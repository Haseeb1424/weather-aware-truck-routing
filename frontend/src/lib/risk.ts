import type { Metric, MilesByLevel, RiskLevel } from '../types'

export const RISK_LABELS = ['Low', 'Moderate', 'High', 'Severe', 'No Travel'] as const
export const RISK_COLORS = ['#16a34a', '#eab308', '#f97316', '#dc2626', '#7e22ce'] as const
export const LEVEL_KEYS: (keyof MilesByLevel)[] = ['low', 'moderate', 'high', 'severe', 'no_travel']

export const riskColor = (level: RiskLevel | number) => RISK_COLORS[Math.max(0, Math.min(4, level))]

/** How each heatmap metric is normalised to a 0–1 weight. The upper bound is the
 * metric's "No Travel" threshold, so colours line up with the risk table. */
export const METRICS: Record<Metric, { label: string; unit: string; max: number; legend: string[] }> = {
  risk: { label: 'Risk', unit: '', max: 4, legend: [...RISK_LABELS] },
  wind: { label: 'Wind', unit: 'mph', max: 55, legend: ['0', '25', '35', '45', '55+'] },
  rain: { label: 'Rain', unit: 'in/hr', max: 1, legend: ['0', '0.10', '0.25', '0.50', '1.0+'] },
  snow: { label: 'Snow', unit: 'in/hr', max: 3, legend: ['0', '0.5', '1', '2', '3+'] },
}
