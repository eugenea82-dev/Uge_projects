// Reading validation (FR-04, FR-10) and abnormal-condition detection (FR-12, FR-13),
// driven by the quantified parameter catalog (catalog.ts).

import { BASELINE_TOLERANCE_SD, DAY, TREND_CONSECUTIVE } from './constants.ts'
import { DAILY, DAILY_BY_KEY, bands, dailyBaseline, direction, evaluate, fmtValue } from './catalog.ts'
import type { ParamKey, Reading, ReadingFinding, Threshold } from './types.ts'

export interface ValidationError {
  field: ParamKey | 'hourMeter' | 'at'
  message: string
}

/** Plain-language validation messages that name the field and how to fix it (NFR-U02). Optional readings may be left blank. */
export function validateReading(
  r: { at: number; hourMeter: number | null; values: Partial<Record<ParamKey, number | null>> },
  prev: Reading | undefined,
  limits: Record<ParamKey, Threshold>,
  now: number,
): ValidationError[] {
  const errs: ValidationError[] = []
  if (r.at > now + 5 * 60_000) errs.push({ field: 'at', message: 'Reading time is in the future — use the time the reading was taken.' })
  if (r.hourMeter === null || !Number.isFinite(r.hourMeter)) {
    errs.push({ field: 'hourMeter', message: 'Hour meter is required — enter the value shown on the unit’s hour meter.' })
  } else if (prev) {
    if (r.hourMeter < prev.hourMeter) {
      errs.push({ field: 'hourMeter', message: `Hour meter must be at least the previous reading (${prev.hourMeter.toLocaleString()} h). Re-check the meter.` })
    } else {
      const days = Math.max((r.at - prev.at) / DAY, 1 / 24)
      const perDay = (r.hourMeter - prev.hourMeter) / days
      if (perDay > 24) {
        errs.push({ field: 'hourMeter', message: `Increase of ${(r.hourMeter - prev.hourMeter).toFixed(1)} h is more than 24 h per day since the last reading — correct the entry.` })
      }
    }
  }
  for (const p of DAILY) {
    const v = r.values[p.key]
    if (v === null || v === undefined) {
      if (p.required) errs.push({ field: p.key, message: `${p.label} is required (${p.unit}).` })
      continue
    }
    if (!Number.isFinite(v)) {
      errs.push({ field: p.key, message: `${p.label}: enter a number.` })
      continue
    }
    const lim = limits[p.key]
    if (v < lim.min || v > lim.max) {
      errs.push({ field: p.key, message: `${p.label} of ${v} ${p.unit} is outside the possible range ${lim.min}–${lim.max} ${p.unit}. Check the gauge and the unit of measure.` })
    }
  }
  return errs
}

/** Compare a saved reading with its quantified limits, the unit's own baseline, and its recent trend. */
export function detectFindings(reading: Reading, history: Reading[], limits: Record<ParamKey, Threshold>): ReadingFinding[] {
  const out: ReadingFinding[] = []
  const prior = history.filter((h) => h.at < reading.at).sort((a, b) => a.at - b.at)
  for (const p of DAILY) {
    const v = reading.values[p.key]
    if (v === undefined) continue
    const th = limits[p.key]
    const base = dailyBaseline(prior, p.key)
    const level = evaluate(p, th, v, base)
    const shown = `${fmtValue(v, p.decimals)} ${p.unit}`
    if (level === 'critical' || level === 'warning') {
      const b = bands(p, th, base)
      out.push({
        param: p.key,
        kind: 'limit',
        severity: level,
        message: level === 'critical' ? `${p.label} ${shown} — STOP level (${b.stop}).` : `${p.label} ${shown} — CHECK level (${b.check}; OK is ${b.ok}).`,
        indication: p.indication,
      })
    }
    // Statistical deviation from the unit's own history, for absolute-limit parameters only
    // (relative rules already compare against the baseline).
    const dir = direction(p)
    if ((p.rule === 'above' || p.rule === 'below') && !out.some((f) => f.param === p.key)) {
      const stats = baseline(prior, p.key)
      if (stats && stats.sd > 0) {
        const z = (v - stats.mean) / stats.sd
        const adverse = dir === 'high' ? z : -z
        if (adverse > BASELINE_TOLERANCE_SD) {
          out.push({ param: p.key, kind: 'baseline', severity: 'warning', message: `${p.label} ${shown} is ${adverse.toFixed(1)}σ from this unit’s normal (${fmtValue(stats.mean, p.decimals)} ${p.unit}).`, indication: p.indication })
        }
      }
    }
    if (risingTrend([...prior, reading], p.key)) {
      out.push({ param: p.key, kind: 'trend', severity: 'warning', message: `${p.label} has got worse over ${TREND_CONSECUTIVE} readings in a row — early sign of deterioration.`, indication: p.indication })
    }
  }
  return out
}

/** Mean and spread of the unit's first 30 readings; needs ≥ 10. */
export function baseline(history: Reading[], key: ParamKey): { mean: number; sd: number } | null {
  const vals = history
    .map((h) => h.values[key])
    .filter((v): v is number => v !== undefined)
    .slice(0, 30)
  if (vals.length < 10) return null
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length
  const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length)
  return { mean, sd }
}

/** True when the last N readings each worsen on the previous one (FR-13). Two-sided parameters have no single "worse" direction. */
export function risingTrend(sorted: Reading[], key: ParamKey, n = TREND_CONSECUTIVE): boolean {
  const dir = direction(DAILY_BY_KEY[key])
  if (dir !== 'high' && dir !== 'low') return false
  const vals = sorted.map((r) => r.values[key]).filter((v): v is number => v !== undefined)
  if (vals.length < n + 1) return false
  const tail = vals.slice(-(n + 1))
  for (let i = 1; i < tail.length; i++) {
    if (dir === 'high' ? tail[i] <= tail[i - 1] : tail[i] >= tail[i - 1]) return false
  }
  return true
}
