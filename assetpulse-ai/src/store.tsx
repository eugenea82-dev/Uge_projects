// Client-side application store for the v0.1 prototype.
// Holds the simulated data set, derives KPIs/risk on the fly, applies every
// change through one place so it can be audited (FR-30), and persists to
// localStorage so the demo survives a reload.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { alertFromScore } from './domain/alerts.ts'
import { DAY, HOUR, PERMISSIONS, STALLED_LIMIT_HOURS, STATUSES } from './domain/constants.ts'
import { detectFindings, validateReading, type ValidationError } from './domain/detection.ts'
import { completeWeeks, episodes as buildEpisodes, rollup, unitReliability, type Episode, type Rollup, type UnitReliability } from './domain/kpi.ts'
import { scoreUnit } from './domain/risk.ts'
import { DATA_VERSION, generate, groupBy, type AppData } from './domain/seed.ts'
import type {
  Alert,
  AuditEntry,
  Cause,
  EquipmentType,
  ExternalReason,
  NdtFinding,
  OilSample,
  ParamKey,
  Reading,
  ReadingFinding,
  RiskScore,
  StatusCode,
  StatusEvent,
  Threshold,
  Unit,
  User,
} from './domain/types.ts'

const STORAGE_KEY = 'assetpulse.v01.data'

function load(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const d = JSON.parse(raw) as AppData
      if (d.version === DATA_VERSION) return d
    }
  } catch {
    /* storage unavailable or corrupt → fresh seed */
  }
  return generate(Date.now())
}

export interface Derived {
  eventsByUnit: Map<string, StatusEvent[]>
  readingsByUnit: Map<string, Reading[]>
  rel: Map<string, UnitReliability>
  episodesByUnit: Map<string, Episode[]>
  allEpisodes: Episode[]
  scores: Map<string, RiskScore>
  unitById: Map<string, Unit>
  weeks: number[]
  activeUnits: Unit[]
}

interface Ctx {
  data: AppData
  now: number
  user: User
  d: Derived
  can: (perm: string) => boolean
  inScope: (assetId: string) => boolean
  scopedUnits: Unit[]
  rollupFor: (units: Unit[], key: string) => Rollup
  addReading: (input: { assetId: string; at: number; hourMeter: number | null; values: Partial<Record<ParamKey, number | null>> }) => { errors: ValidationError[]; findings?: ReadingFinding[]; alert?: Alert }
  changeStatus: (input: { assetId: string; at: number; status: StatusCode; cause: Cause | null; externalReason?: ExternalReason; failureCode?: string; note?: string }) => string | null
  addOil: (o: Omit<OilSample, 'id' | 'user'>) => Alert | undefined
  addNdt: (n: Omit<NdtFinding, 'id' | 'user'>) => Alert | undefined
  updateAlert: (id: string, label: string, fn: (a: Alert) => Alert) => string | null
  setThreshold: (type: EquipmentType, key: ParamKey, field: keyof Threshold, value: number) => void
  runBatch: () => { scored: number; created: number }
  resetDemo: () => void
}

const StoreCtx = createContext<Ctx | null>(null)

export function useStore() {
  const c = useContext(StoreCtx)
  if (!c) throw new Error('useStore outside StoreProvider')
  return c
}

/**
 * Score one unit against a data snapshot and return an alert to raise immediately.
 * Called only after a critical reading, a Critical oil result or a Critical NDT
 * finding (TO-BE step 7, FR-08), so any Medium-or-higher score alerts at once
 * instead of waiting for the nightly run.
 */
function immediateAlert(snap: AppData, assetId: string, at: number, source: Alert['source'] = 'risk-score'): Alert | undefined {
  const unit = snap.units.find((u) => u.assetId === assetId)!
  const score = scoreUnit({
    unit,
    readings: snap.readings.filter((r) => r.assetId === assetId),
    episodes: buildEpisodes(assetId, snap.events.filter((e) => e.assetId === assetId), at),
    oil: snap.oil.filter((o) => o.assetId === assetId),
    ndt: snap.ndt.filter((n) => n.assetId === assetId),
    limits: snap.thresholds[unit.type],
    now: at,
  })
  const a = alertFromScore(score, snap.alerts, at, uid('AL'))
  if (a) a.source = source
  return a ?? undefined
}

const raisedAudit = (a: Alert): AuditEntry => ({ id: uid('AU'), at: a.createdAt, user: 'system', role: 'SYSTEM', action: 'Alert raised', entity: `${a.id} · ${a.assetId}`, after: `${a.level} — ${a.component}: ${a.reason}` })

let seq = 0
const uid = (p: string) => `${p}-${Date.now().toString(36).toUpperCase()}${(++seq).toString(36).toUpperCase()}`

export function StoreProvider({ user, children }: { user: User; children: ReactNode }) {
  const [data, setData] = useState<AppData>(load)
  const [now, setNow] = useState(() => Date.now())
  const dataRef = useRef(data)
  useEffect(() => {
    dataRef.current = data
  }, [data])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
      } catch {
        /* quota or private mode — the demo still works in memory */
      }
    }, 400)
    return () => clearTimeout(t)
  }, [data])

  const d = useMemo<Derived>(() => {
    const eventsByUnit = groupBy(data.events, (e) => e.assetId)
    const readingsByUnit = groupBy(data.readings, (r) => r.assetId)
    for (const arr of readingsByUnit.values()) arr.sort((a, b) => a.at - b.at)
    const rel = new Map<string, UnitReliability>()
    const episodesByUnit = new Map<string, Episode[]>()
    const scores = new Map<string, RiskScore>()
    const oilBy = groupBy(data.oil, (o) => o.assetId)
    const ndtBy = groupBy(data.ndt, (n) => n.assetId)
    for (const u of data.units) {
      const evs = eventsByUnit.get(u.assetId) ?? []
      const r = unitReliability(u, evs, now)
      rel.set(u.assetId, r)
      const eps = buildEpisodes(u.assetId, evs, now)
      episodesByUnit.set(u.assetId, eps)
      if (!r.excluded) {
        scores.set(
          u.assetId,
          scoreUnit({ unit: u, readings: readingsByUnit.get(u.assetId) ?? [], episodes: eps, oil: oilBy.get(u.assetId) ?? [], ndt: ndtBy.get(u.assetId) ?? [], limits: data.thresholds[u.type], now }),
        )
      }
    }
    return {
      eventsByUnit,
      readingsByUnit,
      rel,
      episodesByUnit,
      allEpisodes: [...episodesByUnit.values()].flat(),
      scores,
      unitById: new Map(data.units.map((u) => [u.assetId, u])),
      weeks: completeWeeks(now),
      activeUnits: data.units.filter((u) => !rel.get(u.assetId)?.excluded),
    }
  }, [data, now])

  const inScope = useCallback((assetId: string) => {
    if (!user.locations) return true
    const u = d.unitById.get(assetId)
    return !!u && user.locations.includes(u.location)
  }, [user, d])

  const scopedUnits = useMemo(() => data.units.filter((u) => inScope(u.assetId)), [data.units, inScope])

  const can = useCallback((perm: string) => !!PERMISSIONS[user.role][perm], [user.role])

  const rollupFor = useCallback((units: Unit[], key: string) => rollup(key, units.map((u) => d.rel.get(u.assetId)!).filter(Boolean)), [d])

  /** Apply a mutation and append an immutable audit record. */
  const commit = useCallback(
    (mut: (draft: AppData) => void, audit: Omit<AuditEntry, 'id' | 'at' | 'user' | 'role'>[]) => {
      setData((prev) => {
        const next: AppData = { ...prev, events: [...prev.events], readings: [...prev.readings], oil: [...prev.oil], ndt: [...prev.ndt], alerts: [...prev.alerts], workOrders: [...prev.workOrders], audit: [...prev.audit], units: [...prev.units], sync: { ...prev.sync } }
        mut(next)
        const at = Date.now()
        for (const a of audit) next.audit.push({ id: uid('AU'), at, user: user.displayName, role: user.role, ...a })
        return next
      })
    },
    [user],
  )

  const addReading: Ctx['addReading'] = useCallback(
    (input) => {
      const cur = dataRef.current
      const unit = cur.units.find((u) => u.assetId === input.assetId)!
      const hist = cur.readings.filter((r) => r.assetId === input.assetId).sort((a, b) => a.at - b.at)
      const prev = [...hist].reverse().find((r) => r.at <= input.at)
      const errors = validateReading(input, prev, cur.thresholds[unit.type], Date.now())
      if (errors.length) return { errors }
      const reading: Reading = {
        id: uid('RD'),
        assetId: input.assetId,
        at: input.at,
        user: user.displayName,
        hourMeter: input.hourMeter!,
        values: Object.fromEntries(Object.entries(input.values).filter(([, v]) => v !== null && v !== undefined)) as Reading['values'],
      }
      const findings = detectFindings(reading, hist, cur.thresholds[unit.type])
      const alert = findings.some((f) => f.severity === 'critical') ? immediateAlert({ ...cur, readings: [...cur.readings, reading] }, unit.assetId, reading.at) : undefined
      commit(
        (draft) => {
          draft.readings.push(reading)
          const ui = draft.units.findIndex((u) => u.assetId === unit.assetId)
          draft.units[ui] = { ...draft.units[ui], hourMeter: Math.max(draft.units[ui].hourMeter, reading.hourMeter) }
          if (alert) {
            draft.alerts.push(alert)
            draft.audit.push(raisedAudit(alert))
          }
        },
        [{ action: 'Reading captured', entity: `${unit.assetId}`, after: `HM ${reading.hourMeter} h; ${findings.length ? findings.map((f) => f.message).join(' ') : 'within limits'}` }],
      )
      return { errors: [], findings, alert }
    },
    [commit, user],
  )

  const changeStatus: Ctx['changeStatus'] = useCallback(
    (input) => {
      const cur = dataRef.current
      const evs = cur.events.filter((e) => e.assetId === input.assetId).sort((a, b) => a.at - b.at)
      const last = evs[evs.length - 1]
      if (input.at > Date.now() + 5 * 60_000) return 'The status time cannot be in the future.'
      if (last && input.at < last.at) return `The change must be after the last recorded change (${new Date(last.at).toLocaleString()}).`
      if (last && last.status === input.status && last.cause === input.cause) return 'The unit already has this status and cause.'
      if (input.status !== 'OPERATIONAL' && input.status !== 'FOR_DISPOSAL' && !input.cause) return 'Choose whether the cause is technical or external.'
      if (input.cause === 'external' && !input.externalReason) return 'Choose the external reason (no operator, no job, weather, yard congestion).'
      const enteringFailure = input.cause === 'technical' && (!last || last.status === 'OPERATIONAL' || last.cause !== 'technical')
      if (enteringFailure && !input.failureCode) return 'A failure code is required when a unit goes down for a technical reason.'
      commit(
        (draft) => {
          draft.events.push({ id: uid('SE'), user: user.displayName, ...input, cause: input.status === 'OPERATIONAL' || input.status === 'FOR_DISPOSAL' ? null : input.cause })
        },
        [
          {
            action: 'Status changed',
            entity: input.assetId,
            before: last ? `${STATUSES[last.status].label}${last.cause === 'external' ? ' (external)' : ''}` : undefined,
            after: `${STATUSES[input.status].label}${input.cause === 'external' ? ` (external: ${input.externalReason})` : ''}${input.failureCode ? ` · ${input.failureCode}` : ''}`,
          },
        ],
      )
      return null
    },
    [commit, user],
  )

  const addOil: Ctx['addOil'] = useCallback(
    (o) => {
      const cur = dataRef.current
      const rec: OilSample = { ...o, id: uid('OA'), user: user.displayName }
      const alert = o.severity === 'Critical' ? immediateAlert({ ...cur, oil: [...cur.oil, rec] }, o.assetId, Date.now()) : undefined
      commit(
        (draft) => {
          draft.oil.push(rec)
          if (alert) {
            draft.alerts.push(alert)
            draft.audit.push(raisedAudit(alert))
          }
        },
        [{ action: 'Oil analysis uploaded', entity: o.assetId, after: `${o.compartment} · ${o.severity} · ${o.lab}` }],
      )
      return alert
    },
    [commit, user],
  )

  const addNdt: Ctx['addNdt'] = useCallback(
    (n) => {
      const cur = dataRef.current
      const rec: NdtFinding = { ...n, id: uid('NDT'), user: user.displayName }
      // FR-08: a Critical NDT finding creates an alert immediately.
      const alert = n.severity === 'Critical' ? immediateAlert({ ...cur, ndt: [...cur.ndt, rec] }, n.assetId, Date.now(), 'ndt-critical') : undefined
      commit(
        (draft) => {
          draft.ndt.push(rec)
          if (alert) {
            draft.alerts.push(alert)
            draft.audit.push(raisedAudit(alert))
          }
        },
        [{ action: 'NDT finding recorded', entity: n.assetId, after: `${n.method} · ${n.location} · ${n.severity}` }],
      )
      return alert
    },
    [commit, user],
  )

  const updateAlert: Ctx['updateAlert'] = useCallback(
    (id, label, fn) => {
      const cur = dataRef.current.alerts.find((a) => a.id === id)
      if (!cur) return 'Alert not found.'
      let next: Alert
      try {
        next = fn(cur)
      } catch (e) {
        return (e as Error).message
      }
      commit(
        (draft) => {
          draft.alerts = draft.alerts.map((a) => (a.id === id ? next : a))
          if (next.woNumber && next.woNumber !== cur.woNumber && !draft.workOrders.some((w) => w.woNumber === next.woNumber)) {
            draft.workOrders.push({ woNumber: next.woNumber, assetId: next.assetId, kind: 'Predictive', description: next.recommendedAction, openedAt: Date.now(), cost: 0 })
          }
        },
        [{ action: label, entity: `${id} · ${cur.assetId}`, before: cur.status + (cur.authorization ? ` / auth ${cur.authorization.state}` : ''), after: next.status + (next.authorization ? ` / auth ${next.authorization.state}` : '') + (next.outcome ? ` / ${next.outcome.type}` : '') }],
      )
      return null
    },
    [commit],
  )

  const setThreshold: Ctx['setThreshold'] = useCallback(
    (type, key, field, value) => {
      const before = dataRef.current.thresholds[type][key][field]
      if (before === value || !Number.isFinite(value)) return
      commit(
        (draft) => {
          draft.thresholds = structuredClone(draft.thresholds)
          draft.thresholds[type][key][field] = value
        },
        [{ action: 'Threshold changed', entity: `${type} · ${key} · ${field}`, before: String(before), after: String(value) }],
      )
    },
    [commit],
  )

  /** Simulates the nightly batch (TO-BE steps 1, 6, 7): rescore all units, raise alerts, flag stalled restorations. */
  const runBatch = useCallback(() => {
    const at = Date.now()
    const cur = dataRef.current
    const newAlerts: Alert[] = []
    let scored = 0
    const evBy = groupBy(cur.events, (e) => e.assetId)
    for (const u of cur.units) {
      const evs = (evBy.get(u.assetId) ?? []).sort((a, b) => a.at - b.at)
      const last = evs.filter((e) => e.at <= at).pop()
      if (!last || last.status === 'FOR_DISPOSAL') continue
      scored++
      const existing = [...cur.alerts, ...newAlerts]
      if (last.status !== 'OPERATIONAL') {
        // FR-39: stalled restoration (Awaiting Parts / PO beyond the limit)
        const stalled = (last.status === 'AWAITING_PARTS' || last.status === 'AWAITING_PO') && at - last.at > STALLED_LIMIT_HOURS * HOUR
        if (stalled && !existing.some((a) => a.assetId === u.assetId && a.source === 'stalled-restoration' && a.status !== 'Closed')) {
          newAlerts.push({
            id: uid('AL'),
            assetId: u.assetId,
            component: 'Restoration',
            level: 'High',
            score: 0,
            reason: `${STATUSES[last.status].label} for ${Math.round((at - last.at) / DAY)} days (limit ${STALLED_LIMIT_HOURS / 24} days)`,
            factors: [],
            recommendedAction: last.status === 'AWAITING_PARTS' ? 'Expedite parts: confirm supplier ETA, consider an alternate source or cannibalization approval.' : 'Escalate PO/approval to the Branch Manager for same-day release.',
            dataDate: at,
            createdAt: at,
            dueAt: at + 24 * HOUR,
            status: 'Open',
            source: 'stalled-restoration',
            modelVersion: 'rules-v0.1',
            requiresRemoval: false,
          })
        }
        continue
      }
      const score = scoreUnit({
        unit: u,
        readings: cur.readings.filter((r) => r.assetId === u.assetId),
        episodes: buildEpisodes(u.assetId, evs, at),
        oil: cur.oil.filter((o) => o.assetId === u.assetId),
        ndt: cur.ndt.filter((n) => n.assetId === u.assetId),
        limits: cur.thresholds[u.type],
        now: at,
      })
      const a = alertFromScore(score, existing, at, uid('AL'))
      if (a) newAlerts.push(a)
    }
    commit(
      (draft) => {
        draft.alerts.push(...newAlerts)
        draft.sync = { ...draft.sync, emmsLastSync: at - 20 * 60_000, scoringLastRun: at }
      },
      [{ action: 'Nightly batch run (manual)', entity: 'EMMS import · KPIs · risk scores', after: `${scored} units processed; ${newAlerts.length} new alerts` }],
    )
    setNow(Date.now())
    return { scored, created: newAlerts.length }
  }, [commit])

  const resetDemo = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
    setData(generate(Date.now()))
  }, [])

  const value: Ctx = { data, now, user, d, can, inScope, scopedUnits, rollupFor, addReading, changeStatus, addOil, addNdt, updateAlert, setThreshold, runBatch, resetDemo }
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>
}

