// Capture Readings — the single entry point for the CHE Data Entry sheet.
//
//  • Daily check (mechanics): 13 gauge readings, grouped by system. Required
//    readings first; diagnostic-tool readings tucked under "Extra readings".
//  • Oil lab report (planner / engineer): 25 lab results across 4 compartments.
//
// Built for a mechanic on a tablet in the yard (NFR-U01, U02, U05): ≤ 3 screens,
// 48 px fields, the unit and the OK / Check / Stop numbers on every field, a
// live status as they type, plain-language results with the likely cause, and
// a draft kept if they are interrupted (NFR-C02).

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { BAR_PER_PSI, DAY } from '../domain/constants.ts'
import {
  COMPARTMENTS,
  COMPARTMENT_LABEL,
  DAILY,
  DAILY_SYSTEMS,
  LAB,
  bands,
  labGroups,
  dailyBaseline,
  evaluate,
  labBaseline,
  type DailyDef,
  type LabDef,
  type LabFinding,
  type Level,
} from '../domain/catalog.ts'
import type { ValidationError } from '../domain/detection.ts'
import type { Alert, OilCompartment, OilSeverity, ParamKey, ReadingFinding } from '../domain/types.ts'
import { useNav } from '../shell/nav.tsx'
import { useStore } from '../store.tsx'
import { StatusBadge } from '../ui/badges.tsx'
import { fmtDate, fmtDateTime, toLocalDateInput, toLocalInput } from '../ui/format.ts'
import { Icon } from '../ui/Icon.tsx'
import { Empty } from '../ui/Sheet.tsx'

type Kind = 'daily' | 'oil'
type Draft = { at: string; hourMeter: string; values: Partial<Record<ParamKey, string>>; psi: boolean }

const draftKey = (user: string, assetId: string) => `chems.v03.draft.${user}.${assetId}`

function loadDraft(user: string, assetId: string): Draft | null {
  try {
    return JSON.parse(localStorage.getItem(draftKey(user, assetId)) ?? 'null') as Draft | null
  } catch {
    return null
  }
}

const LEVEL_UI: Record<Level | 'empty', { text: string; bg: string; fg: string; icon: string }> = {
  ok: { text: 'OK', bg: 'var(--st-green)', fg: '#fff', icon: 'check' },
  warning: { text: 'Check', bg: 'var(--risk-medium)', fg: '#1d1d1f', icon: 'alert' },
  critical: { text: 'Stop', bg: 'var(--risk-critical)', fg: '#fff', icon: 'stop' },
  empty: { text: '—', bg: 'var(--surface-3)', fg: 'var(--ink-3)', icon: 'minus' },
}

function LevelPill({ level }: { level: Level | null }) {
  const ui = LEVEL_UI[level ?? 'empty']
  return (
    <span className="inline-flex items-center justify-center gap-1.5 min-w-[78px] h-[32px] px-3 rounded-full text-[14px] font-semibold shrink-0" style={{ background: ui.bg, color: ui.fg }} aria-live="polite">
      <Icon name={ui.icon} size={15} strokeWidth={2.4} />
      {ui.text}
    </span>
  )
}

/** One line with the three bands, coloured dots + words so it never relies on colour alone. */
function BandLine({ b }: { b: { ok: string; check: string; stop: string } }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12.5px] text-ink-2">
      <span className="inline-flex items-center gap-1">
        <span className="w-2 h-2 rounded-full" style={{ background: 'var(--st-green)' }} />
        OK {b.ok}
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="w-2 h-2 rounded-full" style={{ background: 'var(--risk-medium)' }} />
        Check {b.check}
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="w-2 h-2 rounded-full" style={{ background: 'var(--risk-critical)' }} />
        Stop {b.stop}
      </span>
    </div>
  )
}

export function CaptureReadings({ assetId: initial, mode }: { assetId?: string; mode?: string }) {
  const { scopedUnits, d, data, now, can, user } = useStore()
  const canDaily = can('captureReadings')
  const canOil = can('uploadLabNdt')
  const [kind, setKind] = useState<Kind>(mode === 'oil' && canOil ? 'oil' : canDaily ? 'daily' : 'oil')
  const [assetId, setAssetId] = useState<string | undefined>(initial)
  const [dailyResult, setDailyResult] = useState<{ findings: ReadingFinding[]; alert?: Alert; assetId: string } | null>(null)
  const [oilResult, setOilResult] = useState<{ severity: OilSeverity; findings: LabFinding[]; alert?: Alert; assetId: string; compartment: OilCompartment } | null>(null)
  const [q, setQ] = useState('')

  if (!canDaily && !canOil) return <Empty icon="lock" title="Readings are entered by branch maintenance roles">Your role can view readings on each unit’s health page (BRD §3.3).</Empty>

  const next = () => {
    setDailyResult(null)
    setOilResult(null)
    setAssetId(undefined)
  }
  if (dailyResult) return <DailyResult {...dailyResult} onNext={next} />
  if (oilResult) return <OilResult {...oilResult} onNext={next} />
  if (assetId && kind === 'daily') return <DailyForm key={assetId} assetId={assetId} onBack={() => setAssetId(undefined)} onSaved={(r) => setDailyResult({ ...r, assetId })} />
  if (assetId && kind === 'oil') return <OilForm key={assetId} assetId={assetId} onBack={() => setAssetId(undefined)} onSaved={(r) => setOilResult({ ...r, assetId })} />

  const todayStart = new Date(now).setHours(0, 0, 0, 0)
  const done = (id: string) => (d.readingsByUnit.get(id) ?? []).some((r) => r.at >= todayStart)
  const working = (id: string) => d.rel.get(id)?.currentStatus?.status === 'OPERATIONAL'
  const dailyRank = (id: string) => (!working(id) ? 2 : done(id) ? 1 : 0)
  const units = scopedUnits
    .filter((u) => !d.rel.get(u.assetId)?.excluded)
    .filter((u) => !q || `${u.assetId} ${u.type} ${u.model} ${u.location}`.toLowerCase().includes(q.toLowerCase()))
    // Daily: units still to check first, then done, then units that are down (no pre-op needed).
    .sort((a, b) => (kind === 'daily' ? dailyRank(a.assetId) - dailyRank(b.assetId) : 0) || a.assetId.localeCompare(b.assetId))
  const operational = units.filter((u) => d.rel.get(u.assetId)?.currentStatus?.status === 'OPERATIONAL')
  const capturedCount = operational.filter((u) => done(u.assetId)).length
  const lastOil = (id: string) => data.oil.filter((o) => o.assetId === id).sort((a, b) => b.sampledAt - a.sampledAt)[0]

  return (
    <div className="flex flex-col gap-4 max-w-[1100px]">
      {canDaily && canOil && (
        <div className="grid grid-cols-2 gap-2 max-w-[560px]" role="tablist" aria-label="What are you entering?">
          <KindButton active={kind === 'daily'} onClick={() => setKind('daily')} icon="gauge" title="Daily check" sub="Gauges & meters · 13 readings" />
          <KindButton active={kind === 'oil'} onClick={() => setKind('oil')} icon="flask" title="Oil lab report" sub="Lab results · 4 compartments" />
        </div>
      )}
      <Steps step={1} />
      <div className="card p-4 flex flex-wrap items-center gap-3 justify-between">
        <div>
          <div className="text-[17px] font-semibold">Which unit?</div>
          <div className="text-ink-3 text-[13px]">
            {kind === 'daily' ? `${capturedCount} of ${operational.length} working units checked today — units still to do are listed first` : 'Pick the unit the lab report is for'}
          </div>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <input className="field field-touch sm:!w-[260px]" placeholder="Type unit number, e.g. RS-004" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search units" />
          <button className="btn btn-touch" disabled title="QR / barcode scan — available once units are tagged (FR-02)" aria-label="Scan unit QR code">
            <Icon name="qr" size={18} />
          </button>
        </div>
      </div>
      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
        {units.map((u) => {
          const r = d.rel.get(u.assetId)!
          const captured = done(u.assetId)
          const hasDraft = kind === 'daily' && !!loadDraft(user.username, u.assetId)
          const lo = kind === 'oil' ? lastOil(u.assetId) : undefined
          return (
            <button key={u.assetId} className="card p-3.5 text-left flex flex-col gap-1.5 min-h-[96px] hover:brightness-[0.985]" onClick={() => setAssetId(u.assetId)}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[18px] font-semibold">{u.assetId}</span>
                {kind === 'daily' && captured ? (
                  <span className="chip" style={{ color: 'var(--ok-ink)' }}>
                    <Icon name="check" size={12} /> Done today
                  </span>
                ) : hasDraft ? (
                  <span className="chip" style={{ color: 'var(--accent)' }}>
                    <Icon name="pencil" size={12} /> Draft
                  </span>
                ) : null}
              </div>
              <div className="text-[13px] text-ink-3">
                {u.type} · {u.location}
              </div>
              {kind === 'daily' ? r.currentStatus && <StatusBadge status={r.currentStatus.status} cause={r.currentStatus.cause} short /> : <span className="text-[12.5px] text-ink-2">{lo ? `Last report ${fmtDate(lo.sampledAt)} · ${lo.severity}` : 'No reports yet'}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function KindButton({ active, onClick, icon, title, sub }: { active: boolean; onClick: () => void; icon: string; title: string; sub: string }) {
  return (
    <button role="tab" aria-selected={active} onClick={onClick} className="card p-3.5 flex items-center gap-3 text-left min-h-[64px]" style={{ boxShadow: active ? 'inset 0 0 0 2px var(--accent)' : undefined }}>
      <span className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0" style={{ background: active ? 'var(--accent)' : 'var(--ink-3)' }}>
        <Icon name={icon} size={20} />
      </span>
      <span>
        <span className="block text-[15px] font-semibold">{title}</span>
        <span className="block text-[12.5px] text-ink-3">{sub}</span>
      </span>
    </button>
  )
}

function Steps({ step }: { step: 1 | 2 | 3 }) {
  const s = ['Pick unit', 'Enter readings', 'Result']
  return (
    <ol className="flex items-center gap-2 text-[13px]" aria-label="Progress">
      {s.map((label, i) => (
        <li key={label} className="flex items-center gap-2">
          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-semibold ${i + 1 <= step ? 'bg-accent text-white' : 'bg-surface-3 text-ink-3'}`}>{i + 1}</span>
          <span className={i + 1 === step ? 'font-semibold' : 'text-ink-3'}>{label}</span>
          {i < 2 && <span className="w-6 h-px bg-[var(--line-strong)]" />}
        </li>
      ))}
    </ol>
  )
}

function UnitHeader({ assetId, onBack, right }: { assetId: string; onBack: () => void; right?: ReactNode }) {
  const { d } = useStore()
  const u = d.unitById.get(assetId)!
  return (
    <div className="card p-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="text-[22px] font-semibold leading-tight">{u.assetId}</div>
        <div className="text-ink-3 text-[13px]">
          {u.type} · {u.make} {u.model} · {u.location}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {right}
        <button type="button" className="btn btn-touch" onClick={onBack}>
          <Icon name="chevronLeft" size={14} /> Change unit
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Daily check
// ---------------------------------------------------------------------------

function DailyForm({ assetId, onBack, onSaved }: { assetId: string; onBack: () => void; onSaved: (r: { findings: ReadingFinding[]; alert?: Alert }) => void }) {
  const { d, data, user, addReading } = useStore()
  const u = d.unitById.get(assetId)!
  const th = data.thresholds[u.type]
  const hist = useMemo(() => d.readingsByUnit.get(assetId) ?? [], [d, assetId])
  const prev = hist[hist.length - 1]
  const [draft, setDraft] = useState<Draft>(() => loadDraft(user.username, assetId) ?? { at: toLocalInput(Date.now()), hourMeter: '', values: {}, psi: false })
  const [errors, setErrors] = useState<ValidationError[]>([])
  const [editTime, setEditTime] = useState(false)
  const [showExtra, setShowExtra] = useState(() => DAILY.some((p) => !p.required && draft.values[p.key]))
  const restored = useMemo(() => !!loadDraft(user.username, assetId), [user.username, assetId])

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(draftKey(user.username, assetId), JSON.stringify(draft))
      } catch {
        /* ignore */
      }
    }, 300)
    return () => clearTimeout(t)
  }, [draft, user.username, assetId])

  const errFor = (f: string) => errors.find((e) => e.field === f)?.message
  const toStd = (p: DailyDef, s: string | undefined): number | null => {
    if (s === undefined || s.trim() === '') return null
    const v = Number(s.replace(',', '.'))
    if (!Number.isFinite(v)) return NaN
    return p.pressure && draft.psi ? Math.round(v * BAR_PER_PSI * 100) / 100 : v
  }
  const unitOf = (p: DailyDef) => (p.pressure && draft.psi ? 'psi' : p.unit)
  const conv = (p: DailyDef) => (v: number) => (p.pressure && draft.psi ? v / BAR_PER_PSI : v)

  const live = (p: DailyDef): Level | null => {
    const v = toStd(p, draft.values[p.key])
    if (v === null || Number.isNaN(v)) return null
    return evaluate(p, th[p.key], v, dailyBaseline(hist, p.key))
  }

  const required = DAILY.filter((p) => p.required)
  const filledRequired = required.filter((p) => (draft.values[p.key] ?? '').trim() !== '').length + (draft.hourMeter.trim() ? 1 : 0)
  const totalRequired = required.length + 1
  const levels = DAILY.map(live)
  const nStop = levels.filter((l) => l === 'critical').length
  const nCheck = levels.filter((l) => l === 'warning').length

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const values = Object.fromEntries(DAILY.map((p) => [p.key, toStd(p, draft.values[p.key])])) as Partial<Record<ParamKey, number | null>>
    const hm = draft.hourMeter.trim() === '' ? null : Number(draft.hourMeter.replace(',', '.'))
    const res = addReading({ assetId, at: new Date(draft.at).getTime(), hourMeter: hm, values })
    if (res.errors.length) {
      setErrors(res.errors)
      if (res.errors.some((x) => DAILY.find((p) => p.key === x.field && !p.required))) setShowExtra(true)
      window.scrollTo?.({ top: 0 })
      return
    }
    try {
      localStorage.removeItem(draftKey(user.username, assetId))
    } catch {
      /* ignore */
    }
    onSaved({ findings: res.findings ?? [], alert: res.alert })
  }

  const set = (k: ParamKey, v: string) => {
    setDraft((dr) => ({ ...dr, values: { ...dr.values, [k]: v } }))
    if (errors.length) setErrors((es) => es.filter((x) => x.field !== k))
  }

  const row = (p: DailyDef) => {
    const err = errFor(p.key)
    const last = prev?.values[p.key]
    const b = bands(p, th[p.key], dailyBaseline(hist, p.key), conv(p), unitOf(p))
    return (
      <div key={p.key} className="py-3 border-b border-line last:border-0 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[200px]">
            <label htmlFor={`f-${p.key}`} className="block text-[15px] font-semibold">
              {p.label}
              {!p.required && <span className="ml-1.5 text-[12px] font-normal text-ink-3">optional</span>}
            </label>
            <div className="text-[12.5px] text-ink-3">{p.how}</div>
          </div>
          <div className="relative w-[170px]">
            <input
              id={`f-${p.key}`}
              className="field tnum !h-[48px] !text-[20px] !font-semibold !pr-14"
              inputMode="decimal"
              enterKeyHint="next"
              value={draft.values[p.key] ?? ''}
              onChange={(e) => set(p.key, e.target.value)}
              aria-invalid={!!err}
              aria-describedby={`b-${p.key}`}
              placeholder={last !== undefined ? String(Math.round(conv(p)(last) * 10 ** p.decimals) / 10 ** p.decimals) : ''}
            />
            <span className="absolute right-3 top-[14px] text-ink-3 text-[14px]">{unitOf(p)}</span>
          </div>
          <LevelPill level={live(p)} />
        </div>
        <div id={`b-${p.key}`}>{err ? <div className="text-[13px] text-danger font-medium">{err}</div> : <BandLine b={b} />}</div>
      </div>
    )
  }

  const hasPressure = DAILY.some((p) => p.pressure)

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 max-w-[860px] pb-24" noValidate>
      <Steps step={2} />
      <UnitHeader
        assetId={assetId}
        onBack={onBack}
        right={
          hasPressure && (
            <div className="segmented" role="group" aria-label="Pressure unit">
              <button type="button" aria-pressed={!draft.psi} onClick={() => setDraft((dr) => ({ ...dr, psi: false }))}>
                bar
              </button>
              <button type="button" aria-pressed={draft.psi} onClick={() => setDraft((dr) => ({ ...dr, psi: true }))}>
                psi
              </button>
            </div>
          )
        }
      />
      {restored && (
        <div className="caveat notice-info">
          <Icon name="info" size={14} className="text-accent" /> Your unsaved readings for this unit were restored.
        </div>
      )}
      {errors.length > 0 && (
        <div className="caveat notice-danger" role="alert">
          <Icon name="alert" size={14} className="text-danger" />
          <div>
            <b>Fix {errors.length} field{errors.length > 1 ? 's' : ''} marked in red.</b> Nothing has been saved yet.
          </div>
        </div>
      )}

      <section className="card p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[200px]">
            <label htmlFor="f-hm" className="block text-[15px] font-semibold">
              Hour meter
            </label>
            <div className="text-[12.5px] text-ink-3">{prev ? `Last: ${prev.hourMeter.toLocaleString()} h on ${fmtDateTime(prev.at)}` : 'First reading for this unit'}</div>
          </div>
          <div className="relative w-[170px]">
            <input id="f-hm" className="field tnum !h-[48px] !text-[20px] !font-semibold !pr-10" inputMode="decimal" value={draft.hourMeter} onChange={(e) => setDraft((dr) => ({ ...dr, hourMeter: e.target.value }))} aria-invalid={!!errFor('hourMeter')} placeholder={prev ? String(prev.hourMeter) : ''} />
            <span className="absolute right-3 top-[14px] text-ink-3 text-[14px]">h</span>
          </div>
          <span className="min-w-[78px]" />
        </div>
        {errFor('hourMeter') && <div className="text-[13px] text-danger font-medium">{errFor('hourMeter')}</div>}
        <div className="text-[13px] text-ink-2 flex flex-wrap items-center gap-2">
          <Icon name="clock" size={14} /> Reading time: <b>{fmtDateTime(new Date(draft.at).getTime())}</b>
          {!editTime ? (
            <button type="button" className="text-accent font-medium underline underline-offset-2" onClick={() => setEditTime(true)}>
              Change
            </button>
          ) : (
            <input type="datetime-local" className="field !w-auto" value={draft.at} onChange={(e) => setDraft((dr) => ({ ...dr, at: e.target.value }))} aria-label="Reading time" aria-invalid={!!errFor('at')} />
          )}
          {errFor('at') && <span className="text-danger">{errFor('at')}</span>}
        </div>
      </section>

      {DAILY_SYSTEMS.map((sys) => {
        const params = DAILY.filter((p) => p.system === sys.id && p.required)
        if (!params.length) return null
        return (
          <section key={sys.id} className="card px-4 pt-3 pb-1">
            <h3 className="flex items-center gap-2 text-[17px] font-semibold pb-1">
              <span className="w-8 h-8 rounded-lg flex items-center justify-center bg-surface-2 text-accent">
                <Icon name={sys.icon} size={17} />
              </span>
              {sys.title}
            </h3>
            {params.map(row)}
          </section>
        )
      })}

      <section className="card px-4 py-3">
        <button type="button" className="w-full flex items-center justify-between gap-2 min-h-[44px] text-left" aria-expanded={showExtra} onClick={() => setShowExtra((v) => !v)}>
          <span>
            <span className="block text-[16px] font-semibold">Extra readings</span>
            <span className="block text-[12.5px] text-ink-3">Only if you have the diagnostic tool — engine speed, pump pressure, fuel rail pressure</span>
          </span>
          <Icon name={showExtra ? 'minus' : 'plus'} size={18} />
        </button>
        {showExtra && <div className="pt-1">{DAILY.filter((p) => !p.required).map(row)}</div>}
      </section>

      <div className="sticky bottom-0 z-10 -mx-1 px-1">
        <div className="card p-3 flex flex-wrap items-center justify-between gap-3" style={{ boxShadow: '0 -4px 20px rgba(0,0,0,0.08), var(--shadow-card)' }}>
          <div className="flex flex-col gap-1 min-w-[200px]">
            <div className="text-[13px] font-medium">
              {filledRequired} of {totalRequired} required readings entered
              {nStop > 0 && <span className="text-danger"> · {nStop} at STOP</span>}
              {nCheck > 0 && <span style={{ color: 'var(--st-orange)' }}> · {nCheck} to check</span>}
            </div>
            <div className="h-2 rounded-full bg-surface-3 overflow-hidden" aria-hidden>
              <div className="h-full rounded-full" style={{ width: `${(filledRequired / totalRequired) * 100}%`, background: 'var(--accent)' }} />
            </div>
          </div>
          <button type="submit" className="btn btn-primary !h-[52px] !px-8 !text-[17px] !rounded-[12px]">
            Save readings
          </button>
        </div>
      </div>
    </form>
  )
}

function resultBanner(level: Level) {
  if (level === 'critical') return { icon: 'stop', bg: 'var(--risk-critical)', title: 'STOP level reached', sub: 'Hold the unit and call your supervisor now. Do not operate until it is checked.' }
  if (level === 'warning') return { icon: 'alert', bg: 'var(--risk-medium)', title: 'Unit can work — but needs a check', sub: 'Tell your supervisor before the end of your shift.' }
  return { icon: 'check', bg: 'var(--st-green)', title: 'All good — unit can work', sub: 'Every reading is inside its normal range.' }
}

function Banner({ level }: { level: Level }) {
  const b = resultBanner(level)
  return (
    <div className="rounded-2xl p-5 flex items-center gap-4" style={{ background: b.bg, color: level === 'warning' ? '#1d1d1f' : '#fff' }} role="status">
      <span className="w-14 h-14 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(255,255,255,0.25)' }}>
        <Icon name={b.icon} size={30} strokeWidth={2.4} />
      </span>
      <div>
        <div className="text-[22px] font-bold leading-tight">{b.title}</div>
        <div className="text-[15px] opacity-95">{b.sub}</div>
      </div>
    </div>
  )
}

function FindingCard({ level, message, indication }: { level: 'warning' | 'critical'; message: string; indication?: string }) {
  return (
    <div className={`caveat ${level === 'critical' ? 'notice-danger' : ''}`} style={{ fontSize: 14 }}>
      <LevelPill level={level} />
      <div>
        <div className="text-ink">{message}</div>
        {indication && (
          <div className="text-[13px] text-ink-2 mt-0.5">
            <b>Possible cause:</b> {indication}
          </div>
        )}
      </div>
    </div>
  )
}

function DailyResult({ findings, alert, assetId, onNext }: { findings: ReadingFinding[]; alert?: Alert; assetId: string; onNext: () => void }) {
  const nav = useNav()
  const { now } = useStore()
  // The banner and the Check/Stop cards follow the data-entry sheet's limits only.
  // Statistical early warnings (unusual for this unit, worsening trend) are notes for the engineer.
  const limits = findings.filter((f) => f.kind === 'limit')
  const notes = findings.filter((f) => f.kind !== 'limit')
  const level: Level = limits.some((f) => f.severity === 'critical') ? 'critical' : limits.length ? 'warning' : 'ok'
  const sorted = [...limits].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1))
  return (
    <div className="flex flex-col gap-4 max-w-[760px]">
      <Steps step={3} />
      <div className="text-[13px] text-ink-3">{assetId} · readings saved and checked against the CHE data-entry limits, the unit’s own normal and its recent trend</div>
      <Banner level={level} />
      {sorted.map((f, i) => (
        <FindingCard key={i} level={f.severity} message={f.message} indication={f.indication} />
      ))}
      {notes.length > 0 && (
        <section className="card p-4 flex flex-col gap-1.5">
          <h3 className="text-[14px] font-semibold flex items-center gap-1.5">
            <Icon name="info" size={15} className="text-ink-3" /> Early-warning notes for the engineer
          </h3>
          <p className="text-[12.5px] text-ink-3 -mt-1">Inside the sheet’s limits, so no action is needed from you now. Shared with the engineer to watch.</p>
          {notes.map((n, i) => (
            <div key={i} className="text-[13.5px] text-ink-2">
              • {n.message}
            </div>
          ))}
        </section>
      )}
      {alert && (
        <div className="caveat notice-danger">
          <Icon name="bell" size={15} className="text-danger" />
          <div>
            <b>{alert.level} alert sent to the engineer</b> ({alert.component}) — decision due within {Math.round((alert.dueAt - now) / 3_600_000)} hours.
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary !h-[52px] !px-8 !text-[17px] !rounded-[12px]" onClick={onNext}>
          Next unit <Icon name="chevronRight" size={15} />
        </button>
        <button className="btn !h-[52px] !px-6 !text-[15px] !rounded-[12px]" onClick={() => nav.openUnit(assetId)}>
          Unit history
        </button>
        {alert && (
          <button className="btn !h-[52px] !px-6 !text-[15px] !rounded-[12px]" onClick={() => nav.openAlert(alert.id)}>
            Open alert
          </button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Oil lab report
// ---------------------------------------------------------------------------

const LABS = ['Intertek PH Lab', 'SGS Oil Condition Monitoring', 'Petron LubeCheck']

function OilForm({ assetId, onBack, onSaved }: { assetId: string; onBack: () => void; onSaved: (r: { severity: OilSeverity; findings: LabFinding[]; alert?: Alert; compartment: OilCompartment }) => void }) {
  const { data, now, addOil } = useStore()
  const [compartment, setCompartment] = useState<OilCompartment>('Engine')
  const [date, setDate] = useState(toLocalDateInput(now))
  const [labName, setLabName] = useState(LABS[0])
  const [vals, setVals] = useState<Record<string, string>>({})
  const [file, setFile] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const defs = LAB.filter((p) => p.compartment === compartment)
  const previous = data.oil.filter((o) => o.assetId === assetId && o.compartment === compartment).sort((a, b) => a.sampledAt - b.sampledAt)

  const parsed = (p: LabDef): number | string | null => {
    const s = (vals[p.key] ?? '').trim()
    if (!s) return null
    if (p.text) return s
    const v = Number(s.replace(',', '.'))
    return Number.isFinite(v) ? v : NaN
  }
  const live = (p: LabDef): Level | null => {
    const v = parsed(p)
    if (v === null || (typeof v === 'number' && Number.isNaN(v))) return null
    return evaluate(p, data.labThresholds[p.key], v, labBaseline(previous, p.key))
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string> = {}
    const t = new Date(date + 'T08:00').getTime()
    if (!date || t > now + DAY) errs.date = 'Sample date is required and cannot be in the future.'
    if (!labName.trim()) errs.lab = 'Enter the laboratory.'
    const values: Record<string, number | string> = {}
    for (const p of defs) {
      const v = parsed(p)
      if (v === null) continue
      if (typeof v === 'number') {
        const th = data.labThresholds[p.key]
        if (Number.isNaN(v)) errs[p.key] = `${p.label}: enter a number.`
        else if (v < th.min || v > th.max) errs[p.key] = `${p.label} must be between ${th.min} and ${th.max} ${p.unit}.`
        else values[p.key] = v
      } else if (p.rule === 'isoAboveRef' && live(p) === null) errs[p.key] = 'ISO code like 18/16/13 (or 16/13).'
      else values[p.key] = v
    }
    if (!Object.keys(values).length && !Object.keys(errs).length) errs.form = 'Enter at least one result from the lab report.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    const r = addOil({ assetId, sampledAt: t, lab: labName.trim(), compartment, values, attachment: file || undefined })
    onSaved({ ...r, compartment })
  }

  const groups = labGroups(compartment)
  const fieldRow = (p: LabDef) => {
          const th = data.labThresholds[p.key]
          const b = bands(p, th, labBaseline(previous, p.key))
          const err = errors[p.key]
          return (
            <div key={p.key} className="py-3 border-b border-line last:border-0 flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[200px]">
                  <label htmlFor={`o-${p.key}`} className="block text-[15px] font-semibold">
                    {p.label}
                  </label>
                  <div className="text-[12.5px] text-ink-3">{p.sources ? `${p.unit} · ${p.sources}` : p.unit === 'result' ? 'Lab result' : p.unit}</div>
                </div>
                {p.rule === 'category' ? (
                  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={p.label}>
                    {p.options!.map((o) => (
                      <button key={o.value} type="button" role="radio" aria-checked={vals[p.key] === o.value} className={`btn btn-touch ${vals[p.key] === o.value ? 'btn-primary' : ''}`} onClick={() => setVals((v) => ({ ...v, [p.key]: o.value }))}>
                        {o.value}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="relative w-[170px]">
                    <input
                      id={`o-${p.key}`}
                      className="field tnum !h-[48px] !text-[19px] !font-semibold !pr-16"
                      inputMode={p.text ? 'text' : 'decimal'}
                      placeholder={p.rule === 'isoAboveRef' ? 'e.g. 18/16/13' : ''}
                      value={vals[p.key] ?? ''}
                      onChange={(e) => setVals((v) => ({ ...v, [p.key]: e.target.value }))}
                      aria-invalid={!!err}
                      aria-describedby={`ob-${p.key}`}
                    />
                    {!p.text && <span className="absolute right-3 top-[15px] text-ink-3 text-[12.5px]">{p.unit}</span>}
                  </div>
                )}
                <LevelPill level={live(p)} />
              </div>
              <div id={`ob-${p.key}`}>{err ? <div className="text-[13px] text-danger font-medium">{err}</div> : <BandLine b={b} />}</div>
            </div>
          )
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 max-w-[860px]" noValidate>
      <Steps step={2} />
      <UnitHeader assetId={assetId} onBack={onBack} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="radiogroup" aria-label="Oil compartment">
        {COMPARTMENTS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={compartment === c}
            className="card min-h-[56px] px-3 text-[14px] font-semibold"
            style={{ boxShadow: compartment === c ? 'inset 0 0 0 2px var(--accent)' : undefined, color: compartment === c ? 'var(--accent)' : undefined }}
            onClick={() => {
              setCompartment(c)
              setVals({})
              setErrors({})
            }}
          >
            {COMPARTMENT_LABEL[c]}
          </button>
        ))}
      </div>
      {Object.keys(errors).length > 0 && (
        <div className="caveat notice-danger" role="alert">
          <Icon name="alert" size={14} className="text-danger" />
          <div>{errors.form ?? `Fix ${Object.keys(errors).length} field${Object.keys(errors).length > 1 ? 's' : ''} marked in red. Nothing has been saved yet.`}</div>
        </div>
      )}
      <section className="card p-4 grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="o-date" className="text-[14px] font-semibold">
            Sample date
          </label>
          <input id="o-date" type="date" className="field field-touch" value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={!!errors.date} />
          {errors.date && <span className="text-[12.5px] text-danger">{errors.date}</span>}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="o-lab" className="text-[14px] font-semibold">
            Laboratory
          </label>
          <input id="o-lab" list="o-labs" className="field field-touch" value={labName} onChange={(e) => setLabName(e.target.value)} aria-invalid={!!errors.lab} />
          <datalist id="o-labs">
            {LABS.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[14px] font-semibold">Lab report (PDF)</span>
          <input type="file" accept=".pdf,image/*" className="text-[13px] mt-2" onChange={(e) => setFile(e.target.files?.[0]?.name ?? '')} aria-label="Attach lab report" />
        </div>
      </section>
      <section className="card px-4 pt-3 pb-1">
        <h3 className="text-[17px] font-semibold pb-1">{COMPARTMENT_LABEL[compartment]} — oil condition</h3>
        <div className="text-[12.5px] text-ink-3 pb-1">Copy each value from the lab report. Leave blank what the lab did not test.</div>
        {groups.condition.map(fieldRow)}
      </section>
      <section className="card px-4 pt-3 pb-1">
        <h3 className="text-[17px] font-semibold pb-1">Wear &amp; contamination metals</h3>
        <div className="text-[12.5px] text-ink-3 pb-1">From the elemental (ICP) part of the report, in ppm. Each metal shows the parts it wears from in the {COMPARTMENT_LABEL[compartment].toLowerCase()}.</div>
        {groups.metals.map(fieldRow)}
      </section>
      <div className="flex justify-end">
        <button type="submit" className="btn btn-primary !h-[52px] !px-8 !text-[17px] !rounded-[12px]">
          Save lab report
        </button>
      </div>
    </form>
  )
}

function OilResult({ severity, findings, alert, assetId, compartment, onNext }: { severity: OilSeverity; findings: LabFinding[]; alert?: Alert; assetId: string; compartment: OilCompartment; onNext: () => void }) {
  const nav = useNav()
  const level: Level = severity === 'Critical' ? 'critical' : severity === 'Caution' ? 'warning' : 'ok'
  return (
    <div className="flex flex-col gap-4 max-w-[760px]">
      <Steps step={3} />
      <div className="text-[13px] text-ink-3">
        {assetId} · {COMPARTMENT_LABEL[compartment]} report saved — graded {severity}
      </div>
      <div className="rounded-2xl p-5 flex items-center gap-4" style={{ background: LEVEL_UI[level].bg, color: LEVEL_UI[level].fg }} role="status">
        <Icon name={LEVEL_UI[level].icon} size={30} strokeWidth={2.4} />
        <div>
          <div className="text-[22px] font-bold leading-tight">{severity === 'Critical' ? 'Critical oil condition' : severity === 'Caution' ? 'Caution — plan an action' : 'Oil condition normal'}</div>
          <div className="text-[15px] opacity-95">{severity === 'Normal' ? 'All results inside the CHE limits.' : `${findings.length} result${findings.length > 1 ? 's' : ''} outside the limits. The likely cause is shown below.`}</div>
        </div>
      </div>
      {findings.map((f) => (
        <FindingCard key={f.key} level={f.level} message={f.message} indication={f.indication} />
      ))}
      {alert && (
        <div className="caveat notice-danger">
          <Icon name="bell" size={15} className="text-danger" />
          <div>
            <b>{alert.level} alert raised</b> for {alert.component} and routed for an engineering decision.
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary !h-[52px] !px-8 !text-[17px] !rounded-[12px]" onClick={onNext}>
          Next report <Icon name="chevronRight" size={15} />
        </button>
        <button className="btn !h-[52px] !px-6 !text-[15px] !rounded-[12px]" onClick={() => nav.openUnit(assetId)}>
          Unit history
        </button>
      </div>
    </div>
  )
}
