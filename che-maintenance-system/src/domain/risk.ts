// Failure-risk scoring (FR-15, FR-16).
//
// Release 1 has no sensor feed and limited failure history, so v0.1 uses a
// transparent rule-based score (C-03, NFR-M03). Each rule contributes points
// and is shown to the user as a contributing factor. A trained model can
// replace this only after it beats the rules in backtesting (NFR-M05/M06).

import { COMPARTMENT_LABEL, DAILY, dailyBaseline, evaluate } from './catalog.ts'
import { DAY, MODEL_VERSION, REPEAT_WINDOW_WEEKS, RISK_META, WEEK } from './constants.ts'
import { risingTrend } from './detection.ts'
import type { Episode } from './kpi.ts'
import type { DataSufficiency, NdtFinding, OilSample, ParamKey, Reading, RiskFactor, RiskLevel, RiskScore, Threshold, Unit } from './types.ts'

export interface RiskInputs {
  unit: Unit
  readings: Reading[] // this unit's readings
  episodes: Episode[] // this unit's failure events
  oil: OilSample[]
  ndt: NdtFinding[]
  limits: Record<ParamKey, Threshold>
  now: number
}

const OIL_COMPONENT: Record<OilSample['compartment'], string> = {
  Engine: 'Engine',
  Transmission: 'Transmission',
  Hydraulic: 'Hydraulic system',
  Gear: 'Final drive',
}

export function levelFor(score: number): RiskLevel {
  if (score >= RISK_META.Critical.min) return 'Critical'
  if (score >= RISK_META.High.min) return 'High'
  if (score >= RISK_META.Medium.min) return 'Medium'
  return 'Low'
}

export function sufficiencyFor(readingsLast30: number): DataSufficiency {
  if (readingsLast30 >= 20) return 'Good'
  if (readingsLast30 >= 10) return 'Limited'
  return 'Insufficient'
}

export function scoreUnit(i: RiskInputs): RiskScore {
  const { unit, now } = i
  const factors: RiskFactor[] = []
  const sorted = [...i.readings].sort((a, b) => a.at - b.at)
  const recent = sorted.filter((r) => r.at >= now - 7 * DAY)

  // 1. Limit breaches in the last 7 days (worst per parameter). A critical breach
  //    alone lifts the unit to at least Medium so it is never reported as Low.
  let readingPts = 0
  for (const p of DAILY) {
    const th = i.limits[p.key]
    const base = dailyBaseline(sorted, p.key)
    let worst: 'critical' | 'warning' | null = null
    for (const r of recent) {
      const lvl = evaluate(p, th, r.values[p.key], base)
      if (lvl === 'critical') worst = 'critical'
      else if (lvl === 'warning' && worst !== 'critical') worst = 'warning'
    }
    if (worst && readingPts < 45) {
      const pts = Math.min(worst === 'critical' ? 35 : 10, 45 - readingPts)
      readingPts += pts
      factors.push({ label: `${p.label} at ${worst === 'critical' ? 'STOP' : 'CHECK'} level in last 7 days`, points: pts, component: p.component })
    }
  }

  // 2. Sustained deterioration trend
  let trendPts = 0
  for (const p of DAILY) {
    if (trendPts >= 20) break
    if (risingTrend(sorted, p.key)) {
      const pts = Math.min(15, 20 - trendPts)
      trendPts += pts
      factors.push({ label: `${p.label} worsening over consecutive readings`, points: pts, component: p.component })
    }
  }

  // 3. Recent failure history
  const recentEps = i.episodes.filter((e) => e.start >= now - REPEAT_WINDOW_WEEKS * WEEK)
  if (recentEps.length) {
    factors.push({ label: `${recentEps.length} failure event${recentEps.length > 1 ? 's' : ''} in last 8 weeks`, points: Math.min(20, recentEps.length * 8), component: 'Whole unit' })
  }
  if (recentEps.length >= 2) factors.push({ label: 'Repeat failure (2+ events in 8 weeks)', points: 8, component: 'Whole unit' })

  // 4. Latest oil analysis per compartment (90 days)
  const latestOil = new Map<string, OilSample>()
  for (const o of i.oil) {
    if (o.sampledAt < now - 90 * DAY) continue
    const prev = latestOil.get(o.compartment)
    if (!prev || o.sampledAt > prev.sampledAt) latestOil.set(o.compartment, o)
  }
  for (const o of latestOil.values()) {
    const top = o.findings[0] ? ` — ${o.findings[0]}` : ''
    if (o.severity === 'Critical') factors.push({ label: `${COMPARTMENT_LABEL[o.compartment]} analysis Critical${top}`, points: 25, component: OIL_COMPONENT[o.compartment] })
    else if (o.severity === 'Caution') factors.push({ label: `${COMPARTMENT_LABEL[o.compartment]} analysis Caution${top}`, points: 10, component: OIL_COMPONENT[o.compartment] })
  }

  // 5. NDT findings (180 days)
  for (const n of i.ndt) {
    if (n.inspectedAt < now - 180 * DAY) continue
    if (n.severity === 'Critical') factors.push({ label: `Critical NDT finding: ${n.finding} (${n.location})`, points: 40, component: 'Structure' })
    else if (n.severity === 'Major') factors.push({ label: `Major NDT finding: ${n.finding} (${n.location})`, points: 20, component: 'Structure' })
  }

  // 6. PM overdue by hour meter
  const sincePm = unit.hourMeter - unit.lastPmHourMeter
  if (sincePm > unit.pmIntervalHours * 1.2) factors.push({ label: `PM overdue: ${Math.round(sincePm)} h since last PM (interval ${unit.pmIntervalHours} h)`, points: 15, component: 'PM schedule' })
  else if (sincePm > unit.pmIntervalHours) factors.push({ label: `PM due: ${Math.round(sincePm)} h since last PM (interval ${unit.pmIntervalHours} h)`, points: 8, component: 'PM schedule' })

  // 7. Age
  const age = new Date(now).getFullYear() - unit.year
  if (age >= 10) factors.push({ label: `Unit age ${age} years`, points: 5, component: 'Whole unit' })

  factors.sort((a, b) => b.points - a.points)
  const score = Math.min(100, factors.reduce((s, f) => s + f.points, 0))

  const byComponent = new Map<string, number>()
  for (const f of factors) byComponent.set(f.component, (byComponent.get(f.component) ?? 0) + f.points)
  const component = [...byComponent.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Whole unit'

  const sufficiency = sufficiencyFor(sorted.filter((r) => r.at >= now - 30 * DAY).length)
  return {
    assetId: unit.assetId,
    score,
    level: sufficiency === 'Insufficient' ? null : levelFor(score),
    factors,
    sufficiency,
    component,
    dataDate: sorted.length ? sorted[sorted.length - 1].at : now,
    modelVersion: MODEL_VERSION,
    method: 'rule-based',
  }
}
