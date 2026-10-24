// Holt damped-trend exponential smoothing (Hyndman & Athanasopoulos §8.2) —
// the YardPulse availability forecast method, kept as the benchmark (FR-42, NFR-M06).
//
//   level_t = α·y_t + (1−α)(level_{t−1} + φ·trend_{t−1})
//   trend_t = β·(level_t − level_{t−1}) + (1−β)·φ·trend_{t−1}
//   ŷ_{t+h} = level_t + (φ + φ² + … + φ^h)·trend_t
//
// Parameters are placeholders until BPA hands over the YardPulse values (D-06).

export interface HoltParams {
  alpha: number
  beta: number
  phi: number
}

export const DEFAULT_HOLT: HoltParams = { alpha: 0.3, beta: 0.1, phi: 0.85 }

export interface ForecastResult {
  fitted: number[]
  forecast: number[]
  /** ± band from the in-sample one-step residual standard deviation */
  band: number[]
}

export function holtDamped(series: number[], horizon: number, p: HoltParams = DEFAULT_HOLT, clamp: [number, number] = [0, 100]): ForecastResult {
  const ys = series.filter((v) => Number.isFinite(v))
  if (ys.length === 0) return { fitted: [], forecast: [], band: [] }
  if (ys.length === 1) {
    return { fitted: [ys[0]], forecast: Array(horizon).fill(ys[0]), band: Array(horizon).fill(0) }
  }
  let level = ys[0]
  let trend = ys[1] - ys[0]
  const fitted = [ys[0]]
  const residuals: number[] = []
  for (let t = 1; t < ys.length; t++) {
    const oneStep = level + p.phi * trend
    fitted.push(oneStep)
    residuals.push(ys[t] - oneStep)
    const prevLevel = level
    level = p.alpha * ys[t] + (1 - p.alpha) * (prevLevel + p.phi * trend)
    trend = p.beta * (level - prevLevel) + (1 - p.beta) * p.phi * trend
  }
  const sd = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / Math.max(1, residuals.length))
  const forecast: number[] = []
  const band: number[] = []
  let damp = 0
  for (let h = 1; h <= horizon; h++) {
    damp += p.phi ** h
    forecast.push(Math.min(clamp[1], Math.max(clamp[0], level + damp * trend)))
    band.push(sd * Math.sqrt(h))
  }
  return { fitted, forecast, band }
}
