// Reading validation (FR-04, FR-10) and abnormal-condition detection (FR-12, FR-13).

import { BASELINE_TOLERANCE_SD, DAY, PARAMS, PARAM_BY_KEY, TREND_CONSECUTIVE } from './constants.ts'
import type { ParamKey, Reading, ReadingFinding, Threshold, ThresholdTable, Unit } from './types.ts'

export interface ValidationError {
  field: ParamKey | 'hourMeter' | 'at'
  message: string
}

/** Plain-language validation messages that name the field and how to fix it (NFR-U02). */
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
  for (const p of PARAMS) {
    const v = r.values[p.key]
    if (v === null || v === undefined || !Number.isFinite(v)) {
      errs.push({ field: p.key, message: `${p.label} is required (${p.unit}).` })
      continue
    }
    const lim = limits[p.key]
    if (v < lim.min || v > lim.max) {
      errs.push({ field: p.key, message: `${p.label} of ${v} ${p.unit} is outside the possible range ${lim.min}–${lim.max} ${p.unit}. Check the gauge and unit of measure.` })
    }
  }
  return errs
}

function worse(direction: 'high' | 'low', v: number, limit: number) {
  return direction === 'high' ? v >= limit : v <= limit
}

/** Compare a saved reading with limits, the unit's own baseline, and its recent trend. */
export function detectFindings(reading: Reading, history: Reading[], limits: Record<ParamKey, Threshold>): ReadingFinding[] {
  const out: ReadingFinding[] = []
  const prior = history.filter((h) => h.at < reading.at).sort((a, b) => a.at - b.at)
  for (const p of PARAMS) {
    const v = reading.values[p.key]
    if (v === undefined) continue
    const lim = limits[p.key]
    if (worse(p.direction, v, lim.critical)) {
      out.push({ param: p.key, kind: 'limit', severity: 'critical', message: `${p.label} ${fmt(v)} ${p.unit} is beyond the critical limit (${lim.critical} ${p.unit}).` })
    } else if (worse(p.direction, v, lim.warning)) {
      out.push({ param: p.key, kind: 'limit', severity: 'warning', message: `${p.label} ${fmt(v)} ${p.unit} is beyond the warning limit (${lim.warning} ${p.unit}).` })
    }
    const base = baseline(prior, p.key)
    if (base && base.sd > 0) {
      const z = (v - base.mean) / base.sd
      const adverse = p.direction === 'high' ? z : -z
      if (adverse > BASELINE_TOLERANCE_SD && !out.some((f) => f.param === p.key)) {
        out.push({ param: p.key, kind: 'baseline', severity: 'warning', message: `${p.label} ${fmt(v)} ${p.unit} deviates ${adverse.toFixed(1)}σ from this unit’s baseline (${fmt(base.mean)} ${p.unit}).` })
      }
    }
    if (risingTrend([...prior, reading], p.key)) {
      out.push({ param: p.key, kind: 'trend', severity: 'warning', message: `${p.label} has worsened over ${TREND_CONSECUTIVE} consecutive readings — sustained deterioration.` })
    }
  }
  return out
}

/** Baseline from the unit's own history: the first 30 readings, needs ≥ 10. */
export function baseline(history: Reading[], key: ParamKey): { mean: number; sd: number } | null {
  const vals = history
    .slice(0, 30)
    .map((h) => h.values[key])
    .filter((v): v is number => v !== undefined)
  if (vals.length < 10) return null
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length
  const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length)
  return { mean, sd }
}

/** True when the last N readings each worsen on the previous one (FR-13). */
export function risingTrend(sorted: Reading[], key: ParamKey, n = TREND_CONSECUTIVE): boolean {
  const dir = PARAM_BY_KEY[key].direction
  const vals = sorted.map((r) => r.values[key]).filter((v): v is number => v !== undefined)
  if (vals.length < n + 1) return false
  const tail = vals.slice(-(n + 1))
  for (let i = 1; i < tail.length; i++) {
    if (dir === 'high' ? tail[i] <= tail[i - 1] : tail[i] >= tail[i - 1]) return false
  }
  return true
}

export function limitsFor(unit: Unit, table: ThresholdTable) {
  return table[unit.type]
}

function fmt(v: number) {
  return Math.abs(v) < 10 ? v.toFixed(1) : Math.round(v).toString()
}
