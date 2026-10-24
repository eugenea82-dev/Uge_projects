// Acceptance tests for the KPI engine, detection and alert workflow.
// Run with `npm test` (Node's built-in test runner).

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { accept, alertFromScore, authorize, linkWorkOrder, recordOutcome, reject, startWork, WorkflowError } from './alerts.ts'
import { DAY, HOUR, WEEK, defaultThresholds } from './constants.ts'
import { detectFindings, validateReading } from './detection.ts'
import { holtDamped } from './forecast.ts'
import { derive, episodes, pmCompliance, rollup, unitReliability, unitTotals, weekStart } from './kpi.ts'
import { scoreUnit } from './risk.ts'
import { generate } from './seed.ts'
import type { Alert, Reading, StatusEvent, Unit, WorkOrder } from './types.ts'

const unit = (assetId: string, location = 'Manila CY1'): Unit => ({
  assetId,
  type: 'Reach Stacker',
  make: 'Kalmar',
  model: 'DRG450',
  serialNo: 'X',
  year: 2020,
  location,
  criticality: 'A',
  hourMeter: 1000,
  pmIntervalHours: 500,
  lastPmHourMeter: 800,
})

let n = 0
const ev = (assetId: string, at: number, status: StatusEvent['status'], cause: StatusEvent['cause'] = status === 'OPERATIONAL' ? null : 'technical'): StatusEvent => ({
  id: `E${++n}`,
  assetId,
  at,
  status,
  cause,
  user: 'test',
})

const MON = weekStart(new Date('2026-10-05T12:00:00').getTime())
const NEXT = MON + WEEK

describe('Availability & failure events (Annex C.2)', () => {
  it('AC-02: down Mon–Wed (72 h), up Thu–Sun → 57.1%, 1 event, 72 h MTTR', () => {
    const evs = [
      ev('RS-1', MON - DAY, 'OPERATIONAL'),
      ev('RS-1', MON, 'DOWN'),
      ev('RS-1', MON + 10 * HOUR, 'UNDER_REVIEW'),
      ev('RS-1', MON + 30 * HOUR, 'AWAITING_PARTS'),
      ev('RS-1', MON + 60 * HOUR, 'UNDER_REPAIR'),
      ev('RS-1', MON + 72 * HOUR, 'OPERATIONAL'),
    ]
    const k = derive(unitTotals('RS-1', evs, MON, NEXT, NEXT + DAY))
    assert.equal(k.requiredH, 168)
    assert.equal(k.techH, 72)
    assert.equal(k.availabilityPct!.toFixed(1), '57.1')
    assert.equal(k.failureEvents, 1)
    assert.equal(k.mttrH, 72)
    assert.equal(k.mtbfH, 96)
    assert.equal(k.buckets['Technician wait'], 10)
    assert.equal(k.buckets['Diagnosis'], 20)
    assert.equal(k.buckets['Parts wait'], 30)
    assert.equal(k.buckets['Repair'], 12)
  })

  it('AC-02: a unit that fails and recovers is never shown the same as a zero-downtime unit', () => {
    const failed = derive(unitTotals('A', [ev('A', MON - DAY, 'OPERATIONAL'), ev('A', MON + DAY, 'DOWN'), ev('A', MON + 2 * DAY, 'OPERATIONAL')], MON, NEXT, NEXT))
    const clean = derive(unitTotals('B', [ev('B', MON - DAY, 'OPERATIONAL')], MON, NEXT, NEXT))
    assert.equal(clean.availabilityPct, 100)
    assert.ok(failed.availabilityPct! < 100)
  })

  it('AC-05: external downtime is excluded from availability, MTBF and MTTR and reported as constraint time', () => {
    const evs = [ev('A', MON - DAY, 'OPERATIONAL'), ev('A', MON + DAY, 'DOWN', 'external'), ev('A', MON + DAY + 12 * HOUR, 'OPERATIONAL')]
    const k = derive(unitTotals('A', evs, MON, NEXT, NEXT))
    assert.equal(k.extH, 12)
    assert.equal(k.techH, 0)
    assert.equal(k.availabilityPct, 100)
    assert.equal(k.failureEvents, 0)
    assert.equal(k.mttrH, null)
  })

  it('FR-33: consecutive non-available statuses form one failure event across week boundaries', () => {
    const evs = [ev('A', MON - DAY, 'OPERATIONAL'), ev('A', MON + 6 * DAY, 'DOWN'), ev('A', NEXT + 5 * HOUR, 'UNDER_REPAIR'), ev('A', NEXT + DAY, 'OPERATIONAL')]
    const eps = episodes('A', evs, NEXT + WEEK)
    assert.equal(eps.length, 1)
    assert.equal(eps[0].hours, 48)
  })

  it('FR-14: second failure within 8 weeks counts as a repeat failure', () => {
    const evs = [
      ev('A', MON - DAY, 'OPERATIONAL'),
      ev('A', MON + HOUR, 'DOWN'),
      ev('A', MON + 5 * HOUR, 'OPERATIONAL'),
      ev('A', MON + 3 * DAY, 'DOWN'),
      ev('A', MON + 3 * DAY + 2 * HOUR, 'OPERATIONAL'),
    ]
    const k = derive(unitTotals('A', evs, MON, NEXT, NEXT))
    assert.equal(k.failureEvents, 2)
    assert.equal(k.repeatFailures, 1)
    assert.equal(k.repeatRatePct, 50)
  })
})

describe('Roll-ups (FR-37)', () => {
  const now = NEXT + 2 * DAY
  const mk = (id: string, evs: StatusEvent[]) => unitReliability(unit(id), evs, now)
  const a = mk('A', [ev('A', MON - 20 * WEEK, 'OPERATIONAL'), ev('A', MON + DAY, 'DOWN'), ev('A', MON + 2 * DAY, 'OPERATIONAL')])
  const b = mk('B', [ev('B', MON - 20 * WEEK, 'OPERATIONAL'), ev('B', MON - 3 * WEEK, 'UNDER_REPAIR'), ev('B', MON - 3 * WEEK + 30 * HOUR, 'OPERATIONAL')])
  const d = mk('D', [ev('D', MON - 20 * WEEK, 'FOR_DISPOSAL', null)])

  it('AC-03: location figures reconcile exactly with the sum of their units', () => {
    const r = rollup('Manila CY1', [a, b])
    assert.equal(r.rolling.requiredH, a.rolling.requiredH + b.rolling.requiredH)
    assert.equal(r.rolling.techH, a.rolling.techH + b.rolling.techH)
    assert.equal(r.rolling.failureEvents, a.rolling.failureEvents + b.rolling.failureEvents)
    const expected = ((r.rolling.requiredH - r.rolling.techH) / r.rolling.requiredH) * 100
    assert.equal(r.rolling.availabilityPct, expected)
    r.weekly.forEach((w, i) => assert.equal(w.techH, a.weekly[i].techH + b.weekly[i].techH))
  })

  it('AC-04: For Disposal units are absent from every KPI and roll-up', () => {
    const with_ = rollup('x', [a, b, d])
    const without = rollup('x', [a, b])
    assert.equal(with_.units, 2)
    assert.deepEqual(with_.rolling, without.rolling)
  })
})

describe('PM compliance (FR-44)', () => {
  it('counts on-time, late and overdue PM work orders', () => {
    const now = MON + 30 * DAY
    const wo = (due: number, closed?: number): WorkOrder => ({ woNumber: 'WO-1', assetId: 'A', kind: 'PM', description: '', openedAt: due - DAY, dueAt: due, closedAt: closed, cost: 0 })
    const r = pmCompliance([wo(MON + DAY, MON + DAY), wo(MON + 2 * DAY, MON + 6 * DAY), wo(MON + 3 * DAY), wo(now + DAY)], MON, now)
    assert.equal(r.scheduled, 3)
    assert.equal(r.onTime, 1)
    assert.equal(r.late, 1)
    assert.equal(r.overdue.length, 1)
    assert.equal(r.pct!.toFixed(1), '33.3')
  })
})

describe('Holt damped-trend forecast (FR-42)', () => {
  it('a flat series forecasts flat', () => {
    const f = holtDamped([90, 90, 90, 90, 90], 4)
    f.forecast.forEach((v) => assert.ok(Math.abs(v - 90) < 1e-9))
  })
  it('the trend is damped and clamped to 0–100', () => {
    const f = holtDamped([80, 84, 88, 92, 96, 99], 13)
    assert.ok(f.forecast.every((v) => v <= 100))
    const steps = f.forecast.slice(1).map((v, i) => v - f.forecast[i])
    assert.ok(steps.every((s) => s >= 0))
  })
})

describe('Reading validation and detection (FR-04, FR-10, FR-12, FR-13)', () => {
  const limits = defaultThresholds()['Reach Stacker']
  const base = { engineTemp: 88, transmissionTemp: 82, hydraulicOilTemp: 60, coolantTemp: 85, hydraulicPressure: 190, engineOilPressure: 3.8, transmissionPressure: 17 }
  const prev: Reading = { id: 'r0', assetId: 'A', at: MON, user: 't', hourMeter: 1000, values: base }

  it('rejects an hour meter lower than the previous reading or > 24 h/day', () => {
    const lower = validateReading({ at: MON + DAY, hourMeter: 990, values: base }, prev, limits, MON + 2 * DAY)
    assert.ok(lower.some((e) => e.field === 'hourMeter'))
    const tooMuch = validateReading({ at: MON + DAY, hourMeter: 1030, values: base }, prev, limits, MON + 2 * DAY)
    assert.ok(tooMuch.some((e) => e.field === 'hourMeter'))
    const ok = validateReading({ at: MON + DAY, hourMeter: 1015, values: base }, prev, limits, MON + 2 * DAY)
    assert.equal(ok.length, 0)
  })

  it('flags critical limit breaches, including low-is-bad pressures', () => {
    const r: Reading = { ...prev, id: 'r1', at: MON + DAY, values: { ...base, engineTemp: 107, engineOilPressure: 1.5 } }
    const f = detectFindings(r, [prev], limits)
    assert.ok(f.some((x) => x.param === 'engineTemp' && x.severity === 'critical'))
    assert.ok(f.some((x) => x.param === 'engineOilPressure' && x.severity === 'critical'))
  })

  it('detects sustained deterioration below the limit', () => {
    const hist: Reading[] = [80, 81, 82, 83, 84, 85].map((t, i) => ({ ...prev, id: `h${i}`, at: MON + i * DAY, values: { ...base, engineTemp: t } }))
    const r: Reading = { ...prev, id: 'new', at: MON + 7 * DAY, values: { ...base, engineTemp: 86 } }
    const f = detectFindings(r, hist, limits)
    assert.ok(f.some((x) => x.param === 'engineTemp' && x.kind === 'trend'))
  })
})

describe('Risk scoring (FR-15, FR-16)', () => {
  const limits = defaultThresholds()['Reach Stacker']
  const base = { engineTemp: 88, transmissionTemp: 82, hydraulicOilTemp: 60, coolantTemp: 85, hydraulicPressure: 190, engineOilPressure: 3.8, transmissionPressure: 17 }
  const now = MON + 30 * DAY
  const daily = (n: number, last: Partial<typeof base> = {}): Reading[] =>
    Array.from({ length: n }, (_, i) => ({ id: `r${i}`, assetId: 'A', at: now - (n - 1 - i) * DAY, user: 't', hourMeter: 1000 + i * 10, values: i === n - 1 ? { ...base, ...last } : base }))
  const score = (readings: Reading[]) => scoreUnit({ unit: unit('A'), readings, episodes: [], oil: [], ndt: [], limits, now })

  it('a reading beyond a critical limit is never scored Low', () => {
    const s = score(daily(25, { engineTemp: 108 }))
    assert.ok(s.level && s.level !== 'Low', `got ${s.level}`)
    assert.equal(s.component, 'Engine')
  })
  it('says so instead of scoring when data is insufficient', () => {
    const s = score(daily(5))
    assert.equal(s.sufficiency, 'Insufficient')
    assert.equal(s.level, null)
  })
})

describe('Alert workflow (FR-19 to FR-24, AC-08)', () => {
  const now = MON
  const score = { assetId: 'A', score: 78, level: 'Critical' as const, factors: [{ label: 'x', points: 78, component: 'Engine' }], sufficiency: 'Good' as const, component: 'Engine', dataDate: now, modelVersion: 'rules-v0.1', method: 'rule-based' as const }
  const alert = alertFromScore(score, [], now, 'AL-1')!

  it('creates no duplicate open alert for the same unit/component', () => {
    assert.equal(alertFromScore(score, [alert], now, 'AL-2'), null)
  })

  it('Critical alert needs BM authorization before a work order can be linked', () => {
    const acc = accept(alert, 'eng', now)
    assert.equal(acc.authorization?.state, 'Pending')
    assert.throws(() => linkWorkOrder(acc, 'WO-123456'), WorkflowError)
    const ok = authorize(acc, 'mgr', now, true)
    const sched = linkWorkOrder(ok, 'WO-123456')
    assert.equal(sched.status, 'Scheduled')
  })

  it('AC-08: cannot be closed without a decision and an outcome', () => {
    const noDecision: Alert = { ...alert, status: 'In Progress' }
    assert.throws(() => recordOutcome(noDecision, 'eng', now, 'Confirmed fault', 'Worn bearing', 'ENG-OVH'), WorkflowError)
    const flow = startWork(linkWorkOrder(authorize(accept(alert, 'eng', now), 'mgr', now, true), 'WO-123456'))
    assert.throws(() => recordOutcome(flow, 'eng', now, undefined, 'Worn bearing'), WorkflowError)
    assert.throws(() => recordOutcome(flow, 'eng', now, 'Confirmed fault', 'Worn bearing'), WorkflowError) // failure code required
    const closed = recordOutcome(flow, 'eng', now, 'Confirmed fault', 'Worn bearing', 'ENG-OVH')
    assert.equal(closed.status, 'Closed')
  })

  it('reject requires a reason code and records Not actioned', () => {
    assert.throws(() => reject(alert, 'eng', now, undefined), WorkflowError)
    const r = reject(alert, 'eng', now, 'Reading error')
    assert.equal(r.status, 'Closed')
    assert.equal(r.outcome?.type, 'Not actioned')
  })
})

describe('Simulated data set', () => {
  const now = new Date('2026-10-23T10:00:00').getTime()
  const data = generate(now)

  it('has ~75 active units across 12 locations, with For Disposal excluded', () => {
    const rels = data.units.map((u) => unitReliability(u, data.events.filter((e) => e.assetId === u.assetId), now))
    const fleet = rollup('Nationwide', rels)
    assert.equal(new Set(data.units.map((u) => u.location)).size, 12)
    assert.ok(fleet.units >= 70 && fleet.units <= 80)
  })

  it('reproduces the Annex C.2 worked example on the designated unit', () => {
    const u = data.units.find((x) => x.assetId === data.workedExampleAssetId)!
    const rel = unitReliability(u, data.events.filter((e) => e.assetId === u.assetId), now)
    const last = rel.weekly[rel.weekly.length - 1]
    assert.equal(last.availabilityPct!.toFixed(1), '57.1')
    assert.equal(rel.currentStatus?.status, 'OPERATIONAL')
  })

  it('is deterministic for a given seed and time', () => {
    assert.deepEqual(generate(now).units, data.units)
  })
})
