// Deterministic demo-data simulator for the v0.1 prototype.
//
// There is no EMMS feed yet (D-01), so this generates a plausible fleet of
// ~75 active CHE/YT units across the 12 BRD locations with hour-level status
// history, daily pre-op readings, oil/NDT results, EMMS-style work orders and
// a set of alerts in every workflow state. All figures are SIMULATED.

import { alertFromScore } from './alerts.ts'
import {
  DAY,
  FAILURE_CODES,
  HOUR,
  LOCATIONS,
  NOMINAL,
  PARAMS,
  WEEK,
  defaultThresholds,
} from './constants.ts'
import { episodes, weekStart } from './kpi.ts'
import { scoreUnit } from './risk.ts'
import type {
  Alert,
  AuditEntry,
  EquipmentType,
  NdtFinding,
  OilSample,
  OutcomeType,
  ParamKey,
  Reading,
  StatusCode,
  StatusEvent,
  SyncInfo,
  ThresholdTable,
  Unit,
  WorkOrder,
} from './types.ts'

export interface AppData {
  version: number
  seededAt: number
  units: Unit[]
  events: StatusEvent[]
  readings: Reading[]
  oil: OilSample[]
  ndt: NdtFinding[]
  workOrders: WorkOrder[]
  alerts: Alert[]
  /** failure-event IDs that were preceded by an alert ≥ 7 days before (alert recall) */
  precededEpisodes: string[]
  thresholds: ThresholdTable
  audit: AuditEntry[]
  sync: SyncInfo
  /** start of hour-level capture; earlier history is migrated from YardPulse (week-granular) */
  cutover: number
  workedExampleAssetId: string
}

export const DATA_VERSION = 3

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const UNITS_PER_LOCATION = [9, 8, 8, 6, 8, 5, 6, 9, 5, 7, 4, 3]

const MODELS: Record<EquipmentType, { make: string; model: string }[]> = {
  'Reach Stacker': [
    { make: 'Kalmar', model: 'DRG450-65S5' },
    { make: 'Konecranes', model: 'SMV 4531 TB5' },
    { make: 'Hyster', model: 'RS46-36CH' },
  ],
  Forklift: [
    { make: 'Toyota', model: '8FD30' },
    { make: 'Hyster', model: 'H16XM-12' },
  ],
  'Empty Container Handler': [
    { make: 'Kalmar', model: 'DCG90-45E7' },
    { make: 'Hyster', model: 'H11XM-ECH' },
  ],
  'Yard Tractor': [
    { make: 'Terberg', model: 'YT223' },
    { make: 'Kalmar', model: 'T2i' },
  ],
}

const PREFIX: Record<EquipmentType, string> = {
  'Reach Stacker': 'RS',
  Forklift: 'FL',
  'Empty Container Handler': 'EH',
  'Yard Tractor': 'YT',
}

const TECHS = ['R. Bautista', 'J. Mendoza', 'L. Garcia', 'M. Aquino', 'D. Navarro', 'K. Ramos']

export function generate(now: number, seed = 20261023): AppData {
  const rnd = mulberry32(seed)
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]
  const between = (a: number, b: number) => a + rnd() * (b - a)
  let idc = 0
  const nid = (p: string) => `${p}-${(++idc).toString(36).toUpperCase().padStart(5, '0')}`

  const thresholds = defaultThresholds()
  const curWeek = weekStart(now)
  const simStart = curWeek - 22 * WEEK
  const cutover = curWeek - 8 * WEEK
  const lastWeek = curWeek - WEEK

  // ---- Units -------------------------------------------------------------
  const units: Unit[] = []
  const counters: Record<string, number> = {}
  LOCATIONS.forEach((loc, li) => {
    for (let k = 0; k < UNITS_PER_LOCATION[li]; k++) {
      const r = rnd()
      const type: EquipmentType = r < 0.36 ? 'Reach Stacker' : r < 0.58 ? 'Forklift' : r < 0.72 ? 'Empty Container Handler' : 'Yard Tractor'
      const m = pick(MODELS[type])
      const pfx = PREFIX[type]
      counters[pfx] = (counters[pfx] ?? 0) + 1
      const interval = type === 'Yard Tractor' ? 250 : 500
      units.push({
        assetId: `${pfx}-${String(counters[pfx]).padStart(3, '0')}`,
        type,
        make: m.make,
        model: m.model,
        serialNo: `${m.make.slice(0, 2).toUpperCase()}${Math.floor(between(100000, 999999))}`,
        year: Math.floor(between(2009, 2025)),
        location: loc,
        criticality: type === 'Reach Stacker' ? 'A' : type === 'Empty Container Handler' ? 'B' : pick(['B', 'C'] as const),
        hourMeter: Math.round(between(4000, 38000)),
        pmIntervalHours: interval,
        lastPmHourMeter: 0,
      })
    }
  })
  const workedExample = units.find((u) => u.type === 'Reach Stacker' && u.location === 'Manila CY1')!
  const disposal = new Set([units[12].assetId, units[40].assetId, units[66].assetId])

  // Hidden health profile per unit drives failures and reading drift.
  const profile = new Map<string, { rate: number; drift: ParamKey | null; driftStrength: number; sparse: boolean }>()
  for (const u of units) {
    const old = new Date(now).getFullYear() - u.year
    const degrading = rnd() < 0.2
    profile.set(u.assetId, {
      rate: between(0.06, 0.3) + (old > 10 ? 0.1 : 0) + (degrading ? 0.1 : 0), // failures per week
      drift: degrading ? pick(PARAMS).key : null,
      driftStrength: between(0.5, 1.2),
      sparse: rnd() < 0.04,
    })
  }

  // ---- Status history ----------------------------------------------------
  const events: StatusEvent[] = []
  const workOrders: WorkOrder[] = []
  let woSeq = 410000

  const push = (assetId: string, at: number, status: StatusCode, cause: StatusEvent['cause'], extra: Partial<StatusEvent> = {}) => {
    events.push({ id: nid('SE'), assetId, at, status, cause, user: pick(TECHS), ...extra })
  }

  /** Append one technical failure episode; returns its end time (or null if still open at `now`). */
  const failureEpisode = (u: Unit, start: number, codeHint?: string, forceOpen?: StatusCode): number | null => {
    const code = codeHint ?? pick(FAILURE_CODES).code
    const steps: [StatusCode, number][] = [
      ['DOWN', between(0.5, 4)],
      ['UNDER_REVIEW', between(1, 16)],
    ]
    if (forceOpen === 'AWAITING_PO' || rnd() < 0.2) steps.push(['AWAITING_PO', between(6, 40)])
    if (forceOpen === 'AWAITING_PARTS' || rnd() < 0.35) steps.push(['AWAITING_PARTS', between(8, 60)])
    steps.push(['UNDER_REPAIR', between(2, 20)])
    steps.push(['TESTING', between(1, 5)])
    let t = start
    for (const [st, h] of steps) {
      if (t >= now) return null
      push(u.assetId, t, st, 'technical', st === 'DOWN' ? { failureCode: code } : {})
      if (forceOpen === st) return null
      t += h * HOUR
    }
    if (t >= now) return null
    push(u.assetId, t, 'OPERATIONAL', null)
    workOrders.push({
      woNumber: `WO-${++woSeq}`,
      assetId: u.assetId,
      kind: 'Corrective',
      failureCode: code,
      description: FAILURE_CODES.find((f) => f.code === code)!.label,
      openedAt: start,
      closedAt: t,
      cost: Math.round(between(12000, 260000) / 100) * 100,
    })
    return t
  }

  const driftCode: Partial<Record<ParamKey, string>> = {
    engineTemp: 'ENG-OVH',
    engineOilPressure: 'ENG-OIL',
    hydraulicOilTemp: 'HYD-PUMP',
    hydraulicPressure: 'HYD-LEAK',
    transmissionTemp: 'TRN-SLIP',
    transmissionPressure: 'TRN-SLIP',
    coolantTemp: 'CLG-RAD',
  }

  // A handful of units are deliberately down right now, some stalled on parts/PO (FR-39).
  const openDown: [number, StatusCode, number][] = [
    [3, 'AWAITING_PARTS', 5.5],
    [17, 'AWAITING_PO', 4.2],
    [25, 'UNDER_REPAIR', 1.2],
    [33, 'UNDER_REVIEW', 0.3],
    [51, 'AWAITING_PARTS', 2.1],
    [58, 'DOWN', 0.08],
    [70, 'TESTING', 1.6],
  ]
  const openMap = new Map(openDown.map(([i, st, d]) => [units[i].assetId, { st, d }]))

  for (const u of units) {
    if (disposal.has(u.assetId)) {
      push(u.assetId, simStart, 'FOR_DISPOSAL', null, { note: 'Approved for disposal' })
      continue
    }
    push(u.assetId, simStart, 'OPERATIONAL', null)
    const prof = profile.get(u.assetId)!
    const isExample = u.assetId === workedExample.assetId
    const open = openMap.get(u.assetId)
    // leave a 14-day margin so a simulated episode (max ≈ 6 days) ends before the scripted events
    const simEnd = isExample ? lastWeek - 14 * DAY : open ? now - open.d * DAY - 14 * DAY : now
    let t = simStart
    for (;;) {
      t += -Math.log(1 - rnd()) * (WEEK / prof.rate)
      if (t >= simEnd) break
      if (rnd() < 0.3) {
        // external unavailability: no operator / no job / weather / congestion
        const h = between(3, 14)
        push(u.assetId, t, 'DOWN', 'external', { externalReason: pick(['No operator', 'No job', 'Weather', 'Yard congestion'] as const) })
        t += h * HOUR
        push(u.assetId, t, 'OPERATIONAL', null)
        continue
      }
      const code = prof.drift && rnd() < 0.5 ? driftCode[prof.drift] : undefined
      const end = failureEpisode(u, t, code)
      if (end === null) break
      t = end
    }
    if (isExample) {
      // Annex C.2 worked example: down Mon–Wed (72 h), operational Thu–Sun → 57.1% (AC-02).
      const ws = lastWeek
      push(u.assetId, ws - 3 * DAY, 'OPERATIONAL', null)
      push(u.assetId, ws, 'DOWN', 'technical', { failureCode: 'HYD-LEAK', note: 'Hydraulic hose burst on lift cylinder' })
      push(u.assetId, ws + 4 * HOUR, 'UNDER_REVIEW', 'technical')
      push(u.assetId, ws + 14 * HOUR, 'AWAITING_PARTS', 'technical')
      push(u.assetId, ws + 46 * HOUR, 'UNDER_REPAIR', 'technical')
      push(u.assetId, ws + 66 * HOUR, 'TESTING', 'technical')
      push(u.assetId, ws + 72 * HOUR, 'OPERATIONAL', null)
      workOrders.push({ woNumber: `WO-${++woSeq}`, assetId: u.assetId, kind: 'Corrective', failureCode: 'HYD-LEAK', description: 'Hydraulic hose / seal leak', openedAt: ws, closedAt: ws + 72 * HOUR, cost: 48500 })
    }
    if (open) {
      push(u.assetId, now - open.d * DAY - 2 * DAY, 'OPERATIONAL', null)
      failureEpisode(u, now - open.d * DAY, prof.drift ? driftCode[prof.drift] : undefined, open.st)
    }
  }

  // ---- YardPulse migration: history before cutover is week-granular ------
  // YardPulse logged a weekly snapshot; a unit down at the snapshot is down for the
  // whole week, and failures that recovered within the week leave no trace (C-05).
  const migratedEvents: StatusEvent[] = []
  const byUnit = groupBy(events, (e) => e.assetId)
  for (const u of units) {
    const evs = (byUnit.get(u.assetId) ?? []).sort((a, b) => a.at - b.at)
    const keep = evs.filter((e) => e.at >= cutover)
    for (let ws = simStart; ws < cutover; ws += WEEK) {
      const snap = ws + 4 * DAY + 17 * HOUR // Friday 17:00 snapshot
      let st: StatusEvent | undefined
      for (const e of evs) if (e.at <= snap) st = e
      const status = st?.status ?? 'OPERATIONAL'
      const technical = st?.cause === 'technical'
      migratedEvents.push({
        id: nid('SE'),
        assetId: u.assetId,
        at: ws,
        status: status === 'FOR_DISPOSAL' ? 'FOR_DISPOSAL' : technical ? status : 'OPERATIONAL',
        cause: technical ? 'technical' : null,
        failureCode: technical ? st?.failureCode ?? evs.find((e) => e.failureCode && e.at <= snap)?.failureCode : undefined,
        user: 'YardPulse migration',
        migrated: true,
      })
    }
    // carry the true status across the cutover boundary
    let atCut: StatusEvent | undefined
    for (const e of evs) if (e.at <= cutover) atCut = e
    if (atCut && !keep.some((e) => e.at === cutover)) {
      keep.unshift({ ...atCut, id: nid('SE'), at: cutover, user: 'Hour-level capture start' })
    }
    migratedEvents.push(...keep)
  }
  events.length = 0
  events.push(...migratedEvents.sort((a, b) => a.at - b.at))

  // ---- Daily pre-op readings (last 45 days) ------------------------------
  const readings: Reading[] = []
  const eventsByUnit = groupBy(events, (e) => e.assetId)
  for (const u of units) {
    if (disposal.has(u.assetId)) continue
    const prof = profile.get(u.assetId)!
    const evs = (eventsByUnit.get(u.assetId) ?? []).sort((a, b) => a.at - b.at)
    const days = 45
    let hm = u.hourMeter
    const firstDay = weekStart(now) - (days - 7) * DAY
    const dayList: number[] = []
    for (let d = 0; d < days; d++) {
      const at = firstDay + d * DAY + 6 * HOUR + Math.floor(between(0, 70)) * 60_000
      if (at > now) break
      dayList.push(at)
    }
    const offset = Object.fromEntries(PARAMS.map((p) => [p.key, (rnd() - 0.5) * (p.kind === 'temperature' ? 6 : NOMINAL[p.key] * 0.06)]))
    dayList.forEach((at, idx) => {
      let st: StatusEvent | undefined
      for (const e of evs) if (e.at <= at) st = e
      const down = st && st.status !== 'OPERATIONAL'
      if (down) return
      if (prof.sparse ? rnd() < 0.75 : rnd() < 0.06) return
      hm += Math.round(between(7, 19) * 10) / 10
      const values: Partial<Record<ParamKey, number>> = {}
      const progress = Math.max(0, (idx - (dayList.length - 14)) / 14) // drift over the last 2 weeks
      for (const p of PARAMS) {
        const nominal = NOMINAL[p.key] + offset[p.key]
        const noiseAmp = p.kind === 'temperature' ? 1.6 : nominal * 0.025
        let v = nominal + (rnd() - 0.5) * 2 * noiseAmp
        if (prof.drift === p.key && progress > 0) {
          const lim = thresholds[u.type][p.key]
          const span = Math.abs(lim.critical - nominal) * 1.05 * prof.driftStrength
          v = nominal + (p.direction === 'high' ? 1 : -1) * span * progress ** 1.4 + (rnd() - 0.5) * noiseAmp * 0.4
        }
        values[p.key] = p.kind === 'temperature' ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100
      }
      readings.push({ id: nid('RD'), assetId: u.assetId, at, user: pick(TECHS), hourMeter: Math.round(hm * 10) / 10, values })
    })
    u.hourMeter = Math.round(hm * 10) / 10
    u.lastPmHourMeter = Math.round(u.hourMeter - between(0.1, 1.3) * u.pmIntervalHours)
  }

  // ---- Oil analysis & NDT -------------------------------------------------
  const oil: OilSample[] = []
  const ndt: NdtFinding[] = []
  const labs = ['Intertek PH Lab', 'SGS Oil Condition Monitoring', 'Petron LubeCheck']
  for (const u of units) {
    if (disposal.has(u.assetId)) continue
    const prof = profile.get(u.assetId)!
    const n = rnd() < 0.5 ? 1 : 2
    for (let k = 0; k < n; k++) {
      const compartment = pick(['Engine', 'Transmission', 'Hydraulic'] as const)
      const related =
        prof.drift &&
        ((compartment === 'Engine' && prof.drift.startsWith('engine')) ||
          (compartment === 'Hydraulic' && prof.drift.startsWith('hydraulic')) ||
          (compartment === 'Transmission' && prof.drift.startsWith('transmission')))
      const sev = related ? (rnd() < 0.5 ? 'Critical' : 'Caution') : rnd() < 0.08 ? 'Caution' : 'Normal'
      oil.push({
        id: nid('OA'),
        assetId: u.assetId,
        sampledAt: now - Math.floor(between(3, 80)) * DAY,
        lab: pick(labs),
        compartment,
        viscosity: Math.round(between(sev === 'Normal' ? 13 : 10, 15.5) * 10) / 10,
        waterPct: Math.round(between(0, sev === 'Critical' ? 0.6 : 0.08) * 100) / 100,
        fuelDilutionPct: Math.round(between(0, sev === 'Normal' ? 1.2 : 4.5) * 10) / 10,
        ironPpm: Math.round(between(sev === 'Critical' ? 110 : 8, sev === 'Normal' ? 45 : 180)),
        particleCode: sev === 'Normal' ? '18/16/13' : sev === 'Caution' ? '20/18/15' : '23/21/18',
        severity: sev,
        attachment: `lab-report-${u.assetId}-${k + 1}.pdf`,
        user: 'Maintenance Planner',
      })
    }
    if ((u.type === 'Reach Stacker' || u.type === 'Empty Container Handler') && rnd() < 0.5) {
      ndt.push({
        id: nid('NDT'),
        assetId: u.assetId,
        inspectedAt: now - Math.floor(between(10, 150)) * DAY,
        method: pick(['Magnetic particle', 'Dye penetrant', 'Ultrasonic'] as const),
        location: pick(['Boom base weld', 'Spreader top beam', 'Mast channel', 'Lift cylinder mount']),
        finding: 'No relevant indication',
        defectSizeMm: 0,
        severity: 'None',
        inspector: 'Level II — MetalTest Inc.',
        attachment: `ndt-${u.assetId}.pdf`,
        user: 'Asset Maintenance Engineer',
      })
    }
  }
  // One structural finding to exercise FR-08 (Critical NDT creates an alert immediately).
  const ndtUnit = units.find((u) => u.type === 'Reach Stacker' && u.location === 'Manila CY2' && !disposal.has(u.assetId) && !openMap.has(u.assetId))!
  ndt.push({
    id: nid('NDT'),
    assetId: ndtUnit.assetId,
    inspectedAt: now - 2 * DAY,
    method: 'Magnetic particle',
    location: 'Boom base weld, left side',
    finding: 'Linear crack indication at weld toe',
    defectSizeMm: 38,
    severity: 'Critical',
    inspector: 'Level II — MetalTest Inc.',
    attachment: `ndt-${ndtUnit.assetId}-boom.pdf`,
    user: 'Asset Maintenance Engineer',
  })

  // ---- PM work orders (EMMS) ---------------------------------------------
  for (const u of units) {
    if (disposal.has(u.assetId)) continue
    for (let due = simStart + between(0, 4) * WEEK; due < now + 3 * WEEK; due += between(3.5, 5) * WEEK) {
      const r = rnd()
      const past = due <= now
      workOrders.push({
        woNumber: `WO-${++woSeq}`,
        assetId: u.assetId,
        kind: 'PM',
        description: `PM service ${u.pmIntervalHours} h — LBE-SOP-2026-001`,
        openedAt: due - 5 * DAY,
        dueAt: due,
        closedAt: closedAtFor(past, r, due, between(0, 0.9), between(2, 9), now),
        cost: Math.round(between(8000, 26000) / 100) * 100,
      })
    }
  }

  // ---- Alerts --------------------------------------------------------------
  const eventsMap = groupBy(events, (e) => e.assetId)
  const readingsMap = groupBy(readings, (r) => r.assetId)
  const alerts: Alert[] = []
  const activeUnits = units.filter((u) => !disposal.has(u.assetId))
  for (const u of activeUnits) {
    const evs = eventsMap.get(u.assetId) ?? []
    const cur = [...evs].sort((a, b) => a.at - b.at).filter((e) => e.at <= now).pop()
    if (cur && cur.status !== 'OPERATIONAL') continue // in restoration — no predictive alert
    const score = scoreUnit({
      unit: u,
      readings: readingsMap.get(u.assetId) ?? [],
      episodes: episodes(u.assetId, evs, now),
      oil: oil.filter((o) => o.assetId === u.assetId),
      ndt: ndt.filter((n) => n.assetId === u.assetId),
      limits: thresholds[u.type],
      now,
    })
    const created = now - between(1, 60) * HOUR
    const a = alertFromScore(score, alerts, created, nid('AL'))
    if (a) {
      if (u.assetId === ndtUnit.assetId) a.source = 'ndt-critical'
      alerts.push(a)
    }
  }
  // Put a few alerts in later workflow states so every screen has content.
  const sortedAlerts = [...alerts].sort((a, b) => b.score - a.score)
  const eng = 'Paolo Reyes'
  sortedAlerts.forEach((a, i) => {
    if (a.requiresRemoval && i % 2 === 0) {
      a.status = 'Acknowledged'
      a.decision = { type: 'accept', by: eng, at: a.createdAt + 2 * HOUR, remarks: 'Agree — remove from lifting duty pending inspection.' }
      a.authorization = { state: 'Pending' }
    } else if (i % 7 === 3) {
      a.status = 'Scheduled'
      a.decision = { type: 'accept', by: eng, at: a.createdAt + 3 * HOUR }
      if (a.requiresRemoval) a.authorization = { state: 'Approved', by: 'Andrea Santos', at: a.createdAt + 4 * HOUR, remarks: 'Approved — swap with standby unit.' }
      a.woNumber = `WO-${++woSeq}`
      workOrders.push({ woNumber: a.woNumber, assetId: a.assetId, kind: 'Predictive', description: a.recommendedAction, openedAt: a.createdAt + 3 * HOUR, cost: 0 })
    } else if (i % 7 === 5) {
      a.status = 'Acknowledged'
      a.decision = { type: 'defer', by: eng, at: a.createdAt + 5 * HOUR, deferUntil: now + 4 * DAY, remarks: 'Unit committed to vessel operation; inspect at next PM window.' }
    }
  })

  // Historical closed alerts → prediction performance (FR-25).
  const outcomes: OutcomeType[] = ['Confirmed fault', 'Confirmed fault', 'Confirmed fault', 'Confirmed fault', 'Confirmed fault', 'No fault found', 'No fault found', 'Failed before action', 'Not actioned']
  for (let k = 0; k < 46; k++) {
    const u = pick(activeUnits)
    const created = now - between(7, 88) * DAY
    const comp = pick(['Engine', 'Hydraulic system', 'Transmission', 'Cooling system', 'Whole unit'])
    const out = pick(outcomes)
    const level = pick(['Medium', 'Medium', 'High', 'High', 'Critical'] as const)
    const fc = FAILURE_CODES.find((f) => f.component === comp)?.code
    alerts.push({
      id: nid('AL'),
      assetId: u.assetId,
      component: comp,
      level,
      score: level === 'Medium' ? 38 : level === 'High' ? 58 : 76,
      reason: 'Historical alert (simulated)',
      factors: [],
      recommendedAction: '',
      dataDate: created - 6 * HOUR,
      createdAt: created,
      dueAt: created + 24 * HOUR,
      status: 'Closed',
      source: 'risk-score',
      modelVersion: 'rules-v0.1',
      requiresRemoval: false,
      decision: { type: out === 'Not actioned' ? 'reject' : 'accept', by: eng, at: created + 5 * HOUR, rejectReason: out === 'Not actioned' ? 'Within acceptable operating band' : undefined },
      woNumber: out === 'Not actioned' ? undefined : `WO-${++woSeq}`,
      outcome: {
        type: out,
        findings: out === 'Confirmed fault' ? 'Wear confirmed on inspection; component replaced.' : out === 'No fault found' ? 'Inspected — within limits, no defect found.' : out === 'Failed before action' ? 'Unit failed before scheduled work.' : 'Rejected — within acceptable operating band.',
        failureCode: out === 'Confirmed fault' || out === 'Failed before action' ? fc ?? 'ENG-OVH' : undefined,
        by: eng,
        at: created + between(2, 9) * DAY,
      },
      leadTimeDays: out === 'Confirmed fault' ? Math.round(between(5, 21)) : undefined,
    })
  }

  // Alert recall: ~68% of hour-level failure events were preceded by an alert ≥ 7 days.
  const precededEpisodes: string[] = []
  for (const u of activeUnits) {
    for (const ep of episodes(u.assetId, eventsMap.get(u.assetId) ?? [], now)) {
      if (!ep.migrated && ep.start >= cutover && rnd() < 0.68) precededEpisodes.push(ep.id)
    }
  }

  // ---- Sync + audit ------------------------------------------------------
  const sync5 = new Date(now)
  sync5.setHours(5, 12, 0, 0)
  const emmsLastSync = sync5.getTime() <= now ? sync5.getTime() : sync5.getTime() - DAY
  const audit: AuditEntry[] = [
    { id: nid('AU'), at: cutover, user: 'system', role: 'SYSTEM', action: 'YardPulse migration', entity: 'Fleet history', after: `${units.length} units; weeks before ${new Date(cutover).toDateString()} imported as week-granular approximations` },
    { id: nid('AU'), at: emmsLastSync, user: 'system', role: 'SYSTEM', action: 'EMMS import', entity: 'Work orders', after: `${workOrders.length} WOs synced; 2 unmatched → exception list` },
    { id: nid('AU'), at: emmsLastSync + 25 * 60_000, user: 'system', role: 'SYSTEM', action: 'Nightly scoring run', entity: 'Risk scores', after: `${activeUnits.length} units scored with rules-v0.1; ${alerts.filter((a) => a.status !== 'Closed').length} open alerts` },
  ]

  return {
    version: DATA_VERSION,
    seededAt: now,
    units,
    events,
    readings,
    oil,
    ndt,
    workOrders,
    alerts,
    precededEpisodes,
    thresholds,
    audit,
    sync: {
      emmsLastSync,
      scoringLastRun: emmsLastSync + 25 * 60_000,
      exceptions: [
        { recordId: `WO-${woSeq + 7}`, assetId: 'FL-099', reason: 'Asset ID not found in register' },
        { recordId: `WO-${woSeq + 9}`, assetId: 'RS-0l4', reason: 'Malformed asset ID (letter “l” for digit “1”?)' },
      ],
    },
    cutover,
    workedExampleAssetId: workedExample.assetId,
  }
}

/** PM closure: ~88% on time, ~10% late, ~2% still overdue. Never in the future. */
function closedAtFor(past: boolean, r: number, due: number, early: number, lateDays: number, now: number): number | undefined {
  if (!past) return undefined
  const t = r < 0.88 ? due - early * DAY : r < 0.98 ? due + lateDays * DAY : undefined
  return t !== undefined && t <= now ? t : undefined
}

export function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const x of xs) {
    const k = key(x)
    const arr = m.get(k)
    if (arr) arr.push(x)
    else m.set(k, [x])
  }
  return m
}
