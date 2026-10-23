// Daily pre-operational reading capture (FR-04 to FR-06, FR-10, FR-12).
// Tablet-first: ≤ 3 screens (pick unit → enter → result), 44 px touch targets,
// unit and expected range on every input, drafts kept if interrupted (NFR-C02).

import { useEffect, useMemo, useState } from 'react'
import { BAR_PER_PSI, PARAMS } from '../domain/constants.ts'
import type { ValidationError } from '../domain/detection.ts'
import type { Alert, ParamKey, ReadingFinding } from '../domain/types.ts'
import { useNav } from '../shell/nav.tsx'
import { useStore } from '../store.tsx'
import { RiskBadge, StatusBadge } from '../ui/badges.tsx'
import { fmtDateTime, toLocalInput } from '../ui/format.ts'
import { Icon } from '../ui/Icon.tsx'
import { Empty } from '../ui/Sheet.tsx'

type Draft = { at: string; hourMeter: string; values: Partial<Record<ParamKey, string>>; psi: boolean }

const draftKey = (user: string, assetId: string) => `assetpulse.v01.draft.${user}.${assetId}`

function loadDraft(user: string, assetId: string): Draft | null {
  try {
    return JSON.parse(localStorage.getItem(draftKey(user, assetId)) ?? 'null') as Draft | null
  } catch {
    return null
  }
}

export function CaptureReadings({ assetId: initial }: { assetId?: string }) {
  const { scopedUnits, d, now, can, user } = useStore()
  const [assetId, setAssetId] = useState<string | undefined>(initial)
  const [result, setResult] = useState<{ findings: ReadingFinding[]; alert?: Alert; assetId: string } | null>(null)
  const [q, setQ] = useState('')

  if (!can('captureReadings')) return <Empty icon="lock" title="Reading capture is done by branch maintenance roles">Your role can view readings on each unit’s health page (BRD §3.3).</Empty>

  if (result) return <ResultScreen {...result} onNext={() => { setResult(null); setAssetId(undefined) }} />
  if (assetId) return <EntryScreen key={assetId} assetId={assetId} onBack={() => setAssetId(undefined)} onSaved={(r) => setResult({ ...r, assetId })} />

  const todayStart = new Date(now).setHours(0, 0, 0, 0)
  const units = scopedUnits
    .filter((u) => !d.rel.get(u.assetId)?.excluded)
    .filter((u) => !q || `${u.assetId} ${u.type} ${u.model}`.toLowerCase().includes(q.toLowerCase()))
  const done = (id: string) => (d.readingsByUnit.get(id) ?? []).some((r) => r.at >= todayStart)
  const operational = units.filter((u) => d.rel.get(u.assetId)?.currentStatus?.status === 'OPERATIONAL')
  const capturedCount = operational.filter((u) => done(u.assetId)).length

  return (
    <div className="flex flex-col gap-4 max-w-[1100px]">
      <Steps step={1} />
      <div className="card p-4 flex flex-wrap items-center gap-3 justify-between">
        <div>
          <div className="text-[15px] font-semibold">Which unit are you inspecting?</div>
          <div className="text-ink-3 text-[12.5px]">
            {capturedCount} of {operational.length} operational units captured today
          </div>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <input className="field field-touch sm:!w-[260px]" placeholder="Search asset ID or model" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search units" />
          <button className="btn btn-touch" disabled title="QR / barcode scan — available once units are tagged (FR-02)">
            <Icon name="qr" size={18} />
          </button>
        </div>
      </div>
      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))' }}>
        {units.map((u) => {
          const r = d.rel.get(u.assetId)!
          const captured = done(u.assetId)
          const hasDraft = !!loadDraft(user.username, u.assetId)
          return (
            <button key={u.assetId} className="card p-3 text-left flex flex-col gap-1.5 min-h-[88px] hover:brightness-[0.985]" onClick={() => setAssetId(u.assetId)}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[15px] font-semibold">{u.assetId}</span>
                {captured ? (
                  <span className="chip" style={{ color: 'var(--ok-ink)' }}>
                    <Icon name="check" size={12} /> Today
                  </span>
                ) : hasDraft ? (
                  <span className="chip" style={{ color: 'var(--accent)' }}>
                    <Icon name="pencil" size={12} /> Draft
                  </span>
                ) : null}
              </div>
              <div className="text-[12px] text-ink-3">
                {u.type} · {u.location}
              </div>
              {r.currentStatus && <StatusBadge status={r.currentStatus.status} cause={r.currentStatus.cause} short />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Steps({ step }: { step: 1 | 2 | 3 }) {
  const s = ['Select unit', 'Enter readings', 'Result']
  return (
    <ol className="flex items-center gap-2 text-[12px]" aria-label="Progress">
      {s.map((label, i) => (
        <li key={label} className="flex items-center gap-2">
          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold ${i + 1 <= step ? 'bg-accent text-white' : 'bg-surface-3 text-ink-3'}`}>{i + 1}</span>
          <span className={i + 1 === step ? 'font-semibold' : 'text-ink-3'}>{label}</span>
          {i < 2 && <span className="w-6 h-px bg-[var(--line-strong)]" />}
        </li>
      ))}
    </ol>
  )
}

function EntryScreen({ assetId, onBack, onSaved }: { assetId: string; onBack: () => void; onSaved: (r: { findings: ReadingFinding[]; alert?: Alert }) => void }) {
  const { d, data, user, addReading } = useStore()
  const u = d.unitById.get(assetId)!
  const limits = data.thresholds[u.type]
  const hist = d.readingsByUnit.get(assetId) ?? []
  const prev = hist[hist.length - 1]
  const [draft, setDraft] = useState<Draft>(() => loadDraft(user.username, assetId) ?? { at: toLocalInput(Date.now()), hourMeter: '', values: {}, psi: false })
  const [errors, setErrors] = useState<ValidationError[]>([])
  const restored = useMemo(() => !!loadDraft(user.username, assetId), [user.username, assetId])

  // Keep a draft on the device so an interrupted entry is not lost (NFR-C02).
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
  const toStd = (k: ParamKey, s: string | undefined): number | null => {
    if (s === undefined || s.trim() === '') return null
    const v = Number(s)
    if (!Number.isFinite(v)) return NaN
    return PARAMS.find((p) => p.key === k)!.kind === 'pressure' && draft.psi ? Math.round(v * BAR_PER_PSI * 100) / 100 : v
  }
  const fromBar = (v: number) => (draft.psi ? Math.round(v / BAR_PER_PSI) : v)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const values = Object.fromEntries(PARAMS.map((p) => [p.key, toStd(p.key, draft.values[p.key])])) as Partial<Record<ParamKey, number | null>>
    const hm = draft.hourMeter.trim() === '' ? null : Number(draft.hourMeter)
    const res = addReading({ assetId, at: new Date(draft.at).getTime(), hourMeter: hm, values })
    if (res.errors.length) {
      setErrors(res.errors)
      return
    }
    try {
      localStorage.removeItem(draftKey(user.username, assetId))
    } catch {
      /* ignore */
    }
    onSaved({ findings: res.findings ?? [], alert: res.alert })
  }

  const set = (k: ParamKey, v: string) => setDraft((dr) => ({ ...dr, values: { ...dr.values, [k]: v } }))

  const Group = ({ kind, title }: { kind: 'temperature' | 'pressure'; title: string }) => (
    <fieldset className="card p-4 flex flex-col gap-3">
      <legend className="sr-only">{title}</legend>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[14px] font-semibold">{title}</h3>
        {kind === 'pressure' && (
          <div className="segmented" role="group" aria-label="Pressure unit">
            <button type="button" aria-pressed={!draft.psi} onClick={() => setDraft((dr) => ({ ...dr, psi: false }))}>
              bar
            </button>
            <button type="button" aria-pressed={draft.psi} onClick={() => setDraft((dr) => ({ ...dr, psi: true }))}>
              psi
            </button>
          </div>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {PARAMS.filter((p) => p.kind === kind).map((p) => {
          const lim = limits[p.key]
          const unit = p.kind === 'pressure' && draft.psi ? 'psi' : p.unit
          const range = p.direction === 'high' ? `Normal below ${fromBar(lim.warning)} ${unit} · critical ≥ ${fromBar(lim.critical)}` : `Normal above ${fromBar(lim.warning)} ${unit} · critical ≤ ${fromBar(lim.critical)}`
          const last = prev?.values[p.key]
          const err = errFor(p.key)
          return (
            <div key={p.key} className="flex flex-col gap-1">
              <label htmlFor={`f-${p.key}`} className="text-[12.5px] font-medium text-ink-2">
                {p.label}
              </label>
              <div className="relative">
                <input
                  id={`f-${p.key}`}
                  className="field field-touch !pr-12 tnum"
                  inputMode="decimal"
                  value={draft.values[p.key] ?? ''}
                  onChange={(e) => set(p.key, e.target.value)}
                  aria-invalid={!!err}
                  placeholder={last !== undefined ? `last ${fromBar(last)}` : ''}
                />
                <span className="absolute right-3 top-[12px] text-ink-3 text-[13px]">{unit}</span>
              </div>
              <span className={`text-[11.5px] ${err ? 'text-danger' : 'text-ink-3'}`}>{err ?? range}</span>
            </div>
          )
        })}
      </div>
    </fieldset>
  )

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 max-w-[900px]" noValidate>
      <Steps step={2} />
      <div className="card p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[17px] font-semibold">{u.assetId}</div>
          <div className="text-ink-3 text-[12.5px]">
            {u.type} · {u.make} {u.model} · {u.location}
          </div>
        </div>
        <button type="button" className="btn btn-touch" onClick={onBack}>
          <Icon name="chevronLeft" size={14} /> Change unit
        </button>
      </div>
      {restored && (
        <div className="caveat notice-info">
          <Icon name="info" size={14} className="text-accent" /> Restored your unsaved draft for this unit.
        </div>
      )}
      {errors.length > 0 && (
        <div className="caveat notice-danger" role="alert">
          <Icon name="alert" size={14} className="text-danger" />
          <div>
            <b>Please fix {errors.length} field{errors.length > 1 ? 's' : ''} before saving.</b> Nothing has been saved yet.
          </div>
        </div>
      )}
      <div className="card p-4 grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="f-at" className="text-[12.5px] font-medium text-ink-2">
            Reading date & time
          </label>
          <input id="f-at" type="datetime-local" className="field field-touch" value={draft.at} onChange={(e) => setDraft((dr) => ({ ...dr, at: e.target.value }))} aria-invalid={!!errFor('at')} />
          <span className={`text-[11.5px] ${errFor('at') ? 'text-danger' : 'text-ink-3'}`}>{errFor('at') ?? 'Time the pre-op inspection was done'}</span>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-hm" className="text-[12.5px] font-medium text-ink-2">
            Hour meter
          </label>
          <div className="relative">
            <input id="f-hm" className="field field-touch !pr-10 tnum" inputMode="decimal" value={draft.hourMeter} onChange={(e) => setDraft((dr) => ({ ...dr, hourMeter: e.target.value }))} aria-invalid={!!errFor('hourMeter')} placeholder={prev ? `last ${prev.hourMeter}` : ''} />
            <span className="absolute right-3 top-[12px] text-ink-3 text-[13px]">h</span>
          </div>
          <span className={`text-[11.5px] ${errFor('hourMeter') ? 'text-danger' : 'text-ink-3'}`}>
            {errFor('hourMeter') ?? (prev ? `Previous ${prev.hourMeter.toLocaleString()} h on ${fmtDateTime(prev.at)} · max +24 h per day` : 'First reading for this unit')}
          </span>
        </div>
      </div>
      {Group({ kind: 'temperature', title: 'Temperatures' })}
      {Group({ kind: 'pressure', title: 'Pressures' })}
      <div className="flex flex-wrap items-center justify-between gap-3 sticky bottom-0 py-2 bg-[var(--window)]">
        <span className="text-[11.5px] text-ink-3">Draft saved on this device automatically.</span>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-touch"
            onClick={() => {
              setDraft({ at: toLocalInput(Date.now()), hourMeter: '', values: {}, psi: draft.psi })
              setErrors([])
            }}
          >
            Clear
          </button>
          <button type="submit" className="btn btn-primary btn-touch !px-6">
            Save readings
          </button>
        </div>
      </div>
    </form>
  )
}

function ResultScreen({ findings, alert, assetId, onNext }: { findings: ReadingFinding[]; alert?: Alert; assetId: string; onNext: () => void }) {
  const nav = useNav()
  const { d, now } = useStore()
  const score = d.scores.get(assetId)
  const critical = findings.filter((f) => f.severity === 'critical')
  const recentAlerts = alert
  return (
    <div className="flex flex-col gap-4 max-w-[760px]">
      <Steps step={3} />
      <div className="card p-5 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-full flex items-center justify-center text-white" style={{ background: findings.length ? (critical.length ? 'var(--risk-critical)' : 'var(--risk-high)') : 'var(--st-green)' }}>
            <Icon name={findings.length ? 'alert' : 'check'} size={20} strokeWidth={2.4} />
          </span>
          <div>
            <div className="text-[16px] font-semibold">{findings.length ? `Saved — ${findings.length} abnormal finding${findings.length > 1 ? 's' : ''}` : 'Saved — all readings within limits'}</div>
            <div className="text-ink-3 text-[12.5px]">
              {assetId} · checked against OEM limits, the unit’s own baseline and its recent trend
            </div>
          </div>
        </div>
        {findings.map((f, i) => (
          <div key={i} className={`caveat ${f.severity === 'critical' ? 'notice-danger' : ''}`}>
            <Icon name="alert" size={14} className={f.severity === 'critical' ? 'text-danger' : ''} />
            <div>
              <b className="capitalize">{f.severity}</b> · {f.kind === 'limit' ? 'Limit' : f.kind === 'baseline' ? 'Baseline deviation' : 'Trend'} — {f.message}
            </div>
          </div>
        ))}
        {recentAlerts && (
          <div className="caveat notice-danger">
            <Icon name="bell" size={14} className="text-danger" />
            <div>
              <b>{recentAlerts.level} alert raised immediately</b> ({recentAlerts.component}) and routed for an engineering decision within {Math.round((recentAlerts.dueAt - now) / 3_600_000)} hours.
            </div>
          </div>
        )}
        {!recentAlerts && findings.length > 0 && <div className="text-[12.5px] text-ink-2">Warning-level findings feed tonight’s risk-scoring run; an alert is raised if the unit reaches Medium risk or above.</div>}
        {score && (
          <div className="flex items-center gap-2 text-[12.5px] text-ink-2">
            Current risk: <RiskBadge level={score.level} score={score.level ? score.score : undefined} />
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary btn-touch !px-6" onClick={onNext}>
          Next unit <Icon name="chevronRight" size={14} />
        </button>
        <button className="btn btn-touch" onClick={() => nav.openUnit(assetId)}>
          View unit health
        </button>
        {recentAlerts && (
          <button className="btn btn-touch" onClick={() => nav.openAlert(recentAlerts.id)}>
            Open alert
          </button>
        )}
      </div>
      <div className="text-[11.5px] text-ink-3">Risk scoring needs at least 10 readings in the last 30 days (20 for full confidence) — capture every operating day.</div>
    </div>
  )
}
