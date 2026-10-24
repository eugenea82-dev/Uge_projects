// Reliability KPI engine — Annex C.2 formulas over the hour-level status log.
//
// Every KPI is built from additive totals (hours and counts) so that location
// and nationwide roll-ups reconcile exactly with the sum of their units (FR-37,
// AC-03). Ratios are derived only at the end.

import {
  HOUR,
  MTTR_BUCKETS,
  REPEAT_WINDOW_WEEKS,
  ROLLING_WEEKS,
  STATUSES,
  WEEK,
  armCategory,
  type MttrBucket,
} from './constants.ts'
import type { ArmCategory, Cause, StatusCode, StatusEvent, Unit, WorkOrder } from './types.ts'

export interface Interval {
  start: number
  end: number
  status: StatusCode
  cause: Cause | null
  category: ArmCategory
  failureCode?: string
  migrated?: boolean
}

/** A failure event: one discrete technical down episode, however many statuses or weeks it spans (FR-33). */
export interface Episode {
  id: string
  assetId: string
  start: number
  end: number | null // null = still down
  hours: number
  buckets: Record<MttrBucket, number>
  failureCode?: string
  migrated: boolean
}

export interface KpiTotals {
  requiredH: number
  techH: number
  extH: number // Operational Constraint Time (FR-35)
  uptimeH: number
  failureEvents: number
  closedEvents: number
  restorationH: number // sum of closed-episode durations, for MTTR
  buckets: Record<MttrBucket, number>
  partsWaitEpisodes: number
  partsWaitH: number
  repeatFailures: number
  approximated: boolean // any migrated week-granular data in the window (NFR-U07)
}

export interface Kpis extends KpiTotals {
  availabilityPct: number | null
  mtbfH: number | null
  mttrH: number | null
  inherentAvailabilityPct: number | null
  repeatRatePct: number | null
  partsDelayH: number | null
}

export function emptyBuckets(): Record<MttrBucket, number> {
  return Object.fromEntries(MTTR_BUCKETS.map((b) => [b, 0])) as Record<MttrBucket, number>
}

export function emptyTotals(): KpiTotals {
  return {
    requiredH: 0,
    techH: 0,
    extH: 0,
    uptimeH: 0,
    failureEvents: 0,
    closedEvents: 0,
    restorationH: 0,
    buckets: emptyBuckets(),
    partsWaitEpisodes: 0,
    partsWaitH: 0,
    repeatFailures: 0,
    approximated: false,
  }
}

/** Convert a unit's status log into contiguous intervals between `from` and `to`. */
export function intervals(events: StatusEvent[], from: number, to: number): Interval[] {
  const sorted = [...events].sort((a, b) => a.at - b.at)
  const out: Interval[] = []
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i]
    const start = Math.max(e.at, from)
    const end = Math.min(i + 1 < sorted.length ? sorted[i + 1].at : to, to)
    if (end <= start) continue
    out.push({
      start,
      end,
      status: e.status,
      cause: e.cause,
      category: armCategory(e.status, e.cause),
      failureCode: e.failureCode,
      migrated: e.migrated,
    })
  }
  return out
}

/**
 * Group consecutive technical-unavailable intervals into failure events.
 * Any available, external or excluded interval ends the episode.
 */
export function episodes(assetId: string, events: StatusEvent[], now: number): Episode[] {
  const ivs = intervals(events, -Infinity, now)
  const out: Episode[] = []
  let cur: Episode | null = null
  for (const iv of ivs) {
    if (iv.category === 'UNAVAILABLE_TECHNICAL') {
      if (!cur) {
        cur = { id: `${assetId}-FE-${out.length + 1}`, assetId, start: iv.start, end: null, hours: 0, buckets: emptyBuckets(), migrated: false }
      }
      const h = (iv.end - iv.start) / HOUR
      cur.hours += h
      const bucket = STATUSES[iv.status].mttrBucket
      if (bucket) cur.buckets[bucket] += h
      cur.failureCode ??= iv.failureCode
      if (iv.migrated) cur.migrated = true
    } else if (cur) {
      cur.end = iv.start
      out.push(cur)
      cur = null
    }
  }
  if (cur) out.push(cur) // still down at `now`
  return out
}

/** Additive KPI totals for one unit over [from, to). */
export function unitTotals(assetId: string, events: StatusEvent[], from: number, to: number, now: number): KpiTotals {
  const t = emptyTotals()
  const end = Math.min(to, now)
  if (end <= from) return t
  for (const iv of intervals(events, from, end)) {
    const h = (iv.end - iv.start) / HOUR
    if (iv.migrated) t.approximated = true
    switch (iv.category) {
      case 'EXCLUDED':
        break // For Disposal: excluded from every calculation (FR-34, AC-04)
      case 'AVAILABLE':
        t.requiredH += h
        t.uptimeH += h
        break
      case 'UNAVAILABLE_EXTERNAL':
        // External time is not technical downtime; reported separately (FR-35).
        t.requiredH += h
        t.extH += h
        break
      case 'UNAVAILABLE_TECHNICAL':
        t.requiredH += h
        t.techH += h
        break
    }
  }
  const eps = episodes(assetId, events, now)
  for (let i = 0; i < eps.length; i++) {
    const ep = eps[i]
    if (ep.start < from || ep.start >= end) continue
    t.failureEvents++
    // Repeat failure: a previous failure on the same unit within the rolling 8-week window.
    if (i > 0 && ep.start - eps[i - 1].start <= REPEAT_WINDOW_WEEKS * WEEK) t.repeatFailures++
    if (ep.end !== null) {
      t.closedEvents++
      t.restorationH += ep.hours
      for (const b of MTTR_BUCKETS) t.buckets[b] += ep.buckets[b]
      if (ep.buckets['Parts wait'] > 0) {
        t.partsWaitEpisodes++
        t.partsWaitH += ep.buckets['Parts wait']
      }
    }
  }
  return t
}

export function addTotals(a: KpiTotals, b: KpiTotals): KpiTotals {
  const buckets = emptyBuckets()
  for (const k of MTTR_BUCKETS) buckets[k] = a.buckets[k] + b.buckets[k]
  return {
    requiredH: a.requiredH + b.requiredH,
    techH: a.techH + b.techH,
    extH: a.extH + b.extH,
    uptimeH: a.uptimeH + b.uptimeH,
    failureEvents: a.failureEvents + b.failureEvents,
    closedEvents: a.closedEvents + b.closedEvents,
    restorationH: a.restorationH + b.restorationH,
    buckets,
    partsWaitEpisodes: a.partsWaitEpisodes + b.partsWaitEpisodes,
    partsWaitH: a.partsWaitH + b.partsWaitH,
    repeatFailures: a.repeatFailures + b.repeatFailures,
    approximated: a.approximated || b.approximated,
  }
}

export function derive(t: KpiTotals): Kpis {
  // Availability % = (Required time − Technical downtime) ÷ Required time × 100
  const availabilityPct = t.requiredH > 0 ? ((t.requiredH - t.techH) / t.requiredH) * 100 : null
  // MTBF = operating hours ÷ failure events (uptime used as operating-hour basis in v0.1)
  const mtbfH = t.failureEvents > 0 ? t.uptimeH / t.failureEvents : null
  // MTTR = total restoration time ÷ number of (closed) failure events
  const mttrH = t.closedEvents > 0 ? t.restorationH / t.closedEvents : null
  const inherentAvailabilityPct = mtbfH !== null && mttrH !== null ? (mtbfH / (mtbfH + mttrH)) * 100 : null
  return {
    ...t,
    availabilityPct,
    mtbfH,
    mttrH,
    inherentAvailabilityPct,
    repeatRatePct: t.failureEvents > 0 ? (t.repeatFailures / t.failureEvents) * 100 : null,
    partsDelayH: t.partsWaitEpisodes > 0 ? t.partsWaitH / t.partsWaitEpisodes : null,
  }
}

/** Monday 00:00 (local) of the week containing `t`. */
export function weekStart(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  const dow = (d.getDay() + 6) % 7 // Monday = 0
  d.setDate(d.getDate() - dow)
  return d.getTime()
}

/** Start times of the last `n` complete weeks, oldest first. */
export function completeWeeks(now: number, n = ROLLING_WEEKS): number[] {
  const cur = weekStart(now)
  const out: number[] = []
  for (let i = n; i >= 1; i--) {
    const d = new Date(cur)
    d.setDate(d.getDate() - 7 * i)
    out.push(d.getTime())
  }
  return out
}

export function weekEnd(ws: number): number {
  const d = new Date(ws)
  d.setDate(d.getDate() + 7)
  return d.getTime()
}

/** ISO-8601 week number, for labels like "W38". */
export function isoWeek(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const w1 = new Date(d.getFullYear(), 0, 4)
  return 1 + Math.round(((d.getTime() - w1.getTime()) / 86_400_000 - 3 + ((w1.getDay() + 6) % 7)) / 7)
}

export interface UnitReliability {
  assetId: string
  weekly: Kpis[] // one per complete week
  rolling: Kpis // rolling 13-week
  rollingTotals: KpiTotals
  weeklyTotals: KpiTotals[]
  currentStatus: StatusEvent | undefined
  excluded: boolean
}

export function currentStatus(events: StatusEvent[], now: number): StatusEvent | undefined {
  let last: StatusEvent | undefined
  for (const e of events) if (e.at <= now && (!last || e.at >= last.at)) last = e
  return last
}

export function unitReliability(unit: Unit, events: StatusEvent[], now: number): UnitReliability {
  const weeks = completeWeeks(now)
  const weeklyTotals = weeks.map((ws) => unitTotals(unit.assetId, events, ws, weekEnd(ws), now))
  const rollingTotals = unitTotals(unit.assetId, events, weeks[0], weekEnd(weeks[weeks.length - 1]), now)
  const cs = currentStatus(events, now)
  return {
    assetId: unit.assetId,
    weekly: weeklyTotals.map(derive),
    rolling: derive(rollingTotals),
    rollingTotals,
    weeklyTotals,
    currentStatus: cs,
    excluded: cs?.status === 'FOR_DISPOSAL',
  }
}

export interface Rollup {
  key: string
  units: number
  rolling: Kpis
  weekly: Kpis[]
}

/** Sum unit totals into a roll-up. For Disposal units are skipped entirely (AC-04). */
export function rollup(key: string, rels: UnitReliability[]): Rollup {
  const active = rels.filter((r) => !r.excluded)
  const weeksN = active[0]?.weeklyTotals.length ?? ROLLING_WEEKS
  let rolling = emptyTotals()
  const weekly: KpiTotals[] = Array.from({ length: weeksN }, emptyTotals)
  for (const r of active) {
    rolling = addTotals(rolling, r.rollingTotals)
    r.weeklyTotals.forEach((w, i) => (weekly[i] = addTotals(weekly[i], w)))
  }
  return { key, units: active.length, rolling: derive(rolling), weekly: weekly.map(derive) }
}

export interface ParetoRow {
  key: string
  downtimeH: number
  events: number
}

/** Rank by downtime hours and failure events — not down-week counts (FR-40). */
export function pareto(eps: Episode[], keyOf: (e: Episode) => string, from: number, to: number): ParetoRow[] {
  const map = new Map<string, ParetoRow>()
  for (const e of eps) {
    if (e.start < from || e.start >= to) continue
    const k = keyOf(e)
    const row = map.get(k) ?? { key: k, downtimeH: 0, events: 0 }
    row.downtimeH += e.hours
    row.events++
    map.set(k, row)
  }
  return [...map.values()].sort((a, b) => b.downtimeH - a.downtimeH)
}

export interface PmCompliance {
  scheduled: number
  onTime: number
  late: number
  overdue: WorkOrder[]
  pct: number | null
}

/** PM compliance % = PM WOs completed on schedule ÷ PM WOs scheduled (FR-44). */
export function pmCompliance(wos: WorkOrder[], from: number, now: number): PmCompliance {
  const pms = wos.filter((w) => w.kind === 'PM' && w.dueAt !== undefined && w.dueAt >= from && w.dueAt <= now)
  const onTime = pms.filter((w) => w.closedAt !== undefined && w.closedAt <= w.dueAt! + 24 * HOUR).length
  const late = pms.filter((w) => w.closedAt !== undefined && w.closedAt > w.dueAt! + 24 * HOUR).length
  const overdue = pms.filter((w) => w.closedAt === undefined)
  return { scheduled: pms.length, onTime, late, overdue, pct: pms.length ? (onTime / pms.length) * 100 : null }
}

/** Planned maintenance ratio = (PM + predictive) WOs ÷ total WOs (BO-05). */
export function plannedRatio(wos: WorkOrder[], from: number): number | null {
  const inWin = wos.filter((w) => w.openedAt >= from)
  if (!inWin.length) return null
  return (inWin.filter((w) => w.kind !== 'Corrective').length / inWin.length) * 100
}
