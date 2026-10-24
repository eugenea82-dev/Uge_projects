// Status-change logging (FR-33) with technical vs. external cause (FR-35).
// Replaces the YardPulse weekly exception log: every change is time-stamped so
// downtime is measured in hours and grouped into failure events.

import { useState } from 'react'
import { EXTERNAL_REASONS, FAILURE_CODES, HOUR, STATUS_ORDER, STATUSES } from '../domain/constants.ts'
import type { Cause, ExternalReason, StatusCode } from '../domain/types.ts'
import { useNav } from '../shell/nav.tsx'
import { useStore } from '../store.tsx'
import { StatusBadge, StatusDot } from '../ui/badges.tsx'
import { fmtAgo, fmtDateTime, fmtHours, toLocalInput } from '../ui/format.ts'
import { Icon } from '../ui/Icon.tsx'
import { Empty } from '../ui/Sheet.tsx'

export function StatusUpdate({ assetId: initial }: { assetId?: string }) {
  const { scopedUnits, d, data, now, can, changeStatus, inScope } = useStore()
  const nav = useNav()
  const units = scopedUnits.filter((u) => !d.rel.get(u.assetId)?.excluded)
  const [assetId, setAssetId] = useState(initial ?? units[0]?.assetId ?? '')
  const [status, setStatus] = useState<StatusCode | null>(null)
  const [cause, setCause] = useState<Cause>('technical')
  const [ext, setExt] = useState<ExternalReason | undefined>()
  const [code, setCode] = useState('')
  const [note, setNote] = useState('')
  const [at, setAt] = useState(() => toLocalInput(Date.now()))
  const [error, setError] = useState<string | null>(null)

  if (!can('updateStatus')) return <Empty icon="lock" title="Status updates are made by branch maintenance roles">Your role views status on the Fleet Status Board (BRD §3.3).</Empty>

  const u = d.unitById.get(assetId)
  const cur = u ? d.rel.get(u.assetId)?.currentStatus : undefined
  const eps = u ? d.episodesByUnit.get(u.assetId) ?? [] : []
  const openEp = eps.length && eps[eps.length - 1].end === null ? eps[eps.length - 1] : null
  const goingDown = status && status !== 'OPERATIONAL' && status !== 'FOR_DISPOSAL'
  const startsFailure = goingDown && cause === 'technical' && (!cur || cur.status === 'OPERATIONAL' || cur.cause !== 'technical')

  let preview = ''
  if (status && u) {
    if (status === 'OPERATIONAL' && openEp) preview = `Closes failure event — total restoration ${fmtHours((new Date(at).getTime() - openEp.start) / HOUR)} (counts in MTTR).`
    else if (status === 'OPERATIONAL') preview = 'Unit returns to available time.'
    else if (cause === 'external') preview = 'Counts as Operational Constraint Time — excluded from availability, MTBF and MTTR.'
    else if (startsFailure) preview = 'Starts a new failure event (counts in MTBF and availability).'
    else if (openEp) preview = `Continues the open failure event (down ${fmtHours((now - openEp.start) / HOUR)} so far). Time in this status is reported as “${STATUSES[status].mttrBucket}” in the MTTR breakdown.`
  }

  const submit = () => {
    if (!u || !status) return
    const err = changeStatus({
      assetId: u.assetId,
      at: new Date(at).getTime(),
      status,
      cause: status === 'OPERATIONAL' ? null : cause,
      externalReason: cause === 'external' ? ext : undefined,
      failureCode: startsFailure ? code || undefined : undefined,
      note: note.trim() || undefined,
    })
    if (err) {
      setError(err)
      return
    }
    nav.toast(
      <span>
        <b>{u.assetId}</b> is now {STATUSES[status].label}
        {cause === 'external' && status !== 'OPERATIONAL' ? ` (external: ${ext})` : ''}.
      </span>,
    )
    setStatus(null)
    setNote('')
    setCode('')
    setExt(undefined)
    setError(null)
    setAt(toLocalInput(Date.now()))
  }

  const recent = data.events
    .filter((e) => inScope(e.assetId) && !e.migrated && e.user !== 'Hour-level capture start')
    .sort((a, b) => b.at - a.at)
    .slice(0, 12)

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] max-w-[1300px]">
      <div className="flex flex-col gap-4">
        <section className="card p-4 flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="text-[12.5px] font-medium text-ink-2" htmlFor="su-unit">
                Unit
              </label>
              <select
                id="su-unit"
                className="field field-touch"
                value={assetId}
                onChange={(e) => {
                  setAssetId(e.target.value)
                  setStatus(null)
                  setError(null)
                }}
              >
                {units.map((x) => (
                  <option key={x.assetId} value={x.assetId}>
                    {x.assetId} · {x.type} · {x.location}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[12.5px] font-medium text-ink-2">Current status</span>
              <div className="h-[44px] flex items-center gap-2">
                {cur && <StatusBadge status={cur.status} cause={cur.cause} />}
                {cur && <span className="text-[12px] text-ink-3">since {fmtDateTime(cur.at)} · {fmtAgo(cur.at, now)}</span>}
              </div>
            </div>
          </div>
        </section>

        <section className="card p-4 flex flex-col gap-3">
          <h3 className="text-[14px] font-semibold">New status</h3>
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-4" role="radiogroup" aria-label="New status">
            {STATUS_ORDER.filter((s) => s !== 'FOR_DISPOSAL').map((s) => {
              const def = STATUSES[s]
              const selected = status === s
              return (
                <button
                  key={s}
                  role="radio"
                  aria-checked={selected}
                  className="btn-touch rounded-[10px] p-2.5 flex flex-col items-start gap-1.5 text-left transition"
                  style={{ background: selected ? `color-mix(in srgb, var(${def.colorVar}) 16%, var(--surface))` : 'var(--surface-2)', boxShadow: selected ? `inset 0 0 0 2px var(${def.colorVar})` : 'inset 0 0 0 0.5px var(--line-strong)' }}
                  onClick={() => {
                    setStatus(s)
                    setError(null)
                  }}
                >
                  <StatusDot status={s} size={22} />
                  <span className="text-[12.5px] font-medium leading-tight">{def.label}</span>
                </button>
              )
            })}
          </div>
          <p className="text-[11.5px] text-ink-3">For Disposal is set by the Asset Maintenance Manager through the asset register, not here.</p>

          {goingDown && (
            <div className="flex flex-col gap-3 pt-1">
              <div className="flex flex-col gap-1.5">
                <span className="text-[12.5px] font-medium text-ink-2">Cause</span>
                <div className="segmented self-start" role="group" aria-label="Cause">
                  <button aria-pressed={cause === 'technical'} onClick={() => setCause('technical')}>
                    Technical — equipment fault
                  </button>
                  <button aria-pressed={cause === 'external'} onClick={() => setCause('external')}>
                    External — not the equipment
                  </button>
                </div>
              </div>
              {cause === 'external' ? (
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="External reason">
                  {EXTERNAL_REASONS.map((r) => (
                    <button key={r} role="radio" aria-checked={ext === r} className={`btn btn-touch ${ext === r ? 'btn-primary' : ''}`} onClick={() => setExt(r)}>
                      {r}
                    </button>
                  ))}
                </div>
              ) : (
                startsFailure && (
                  <div className="flex flex-col gap-1">
                    <label className="text-[12.5px] font-medium text-ink-2" htmlFor="su-code">
                      Failure code <span className="text-danger">*</span>
                    </label>
                    <select id="su-code" className="field field-touch" value={code} onChange={(e) => setCode(e.target.value)}>
                      <option value="">Choose the failed system / mode…</option>
                      {FAILURE_CODES.map((f) => (
                        <option key={f.code} value={f.code}>
                          {f.code} — {f.label}
                        </option>
                      ))}
                    </select>
                    <span className="text-[11.5px] text-ink-3">Standard code, required on every technical failure (BO-06).</span>
                  </div>
                )
              )}
            </div>
          )}

          {status && (
            <div className="grid gap-3 sm:grid-cols-2 pt-1">
              <div className="flex flex-col gap-1">
                <label className="text-[12.5px] font-medium text-ink-2" htmlFor="su-at">
                  Time of change
                </label>
                <input id="su-at" type="datetime-local" className="field field-touch" value={at} onChange={(e) => setAt(e.target.value)} />
                <span className="text-[11.5px] text-ink-3">Update within 1 hour of the change (TO-BE step 3).</span>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[12.5px] font-medium text-ink-2" htmlFor="su-note">
                  Note (optional)
                </label>
                <input id="su-note" className="field field-touch" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. waiting for hydraulic hose from Manila" />
              </div>
            </div>
          )}

          {preview && (
            <div className="caveat notice-info">
              <Icon name="info" size={14} className="text-accent" />
              {preview}
            </div>
          )}
          {error && (
            <div className="caveat notice-danger" role="alert">
              <Icon name="alert" size={14} className="text-danger" />
              {error}
            </div>
          )}
          <div className="flex justify-end">
            <button className="btn btn-primary btn-touch !px-6" disabled={!status} onClick={submit}>
              Record status change
            </button>
          </div>
        </section>
      </div>

      <section className="card p-4 flex flex-col gap-2 self-start">
        <h3 className="text-[14px] font-semibold">Recent changes in your scope</h3>
        {recent.length === 0 && <div className="text-ink-3">No status changes yet.</div>}
        <ol className="flex flex-col">
          {recent.map((e) => (
            <li key={e.id} className="py-2 border-b border-line last:border-0 flex flex-col gap-0.5">
              <div className="flex items-center justify-between gap-2">
                <button className="font-semibold hover:underline" onClick={() => nav.openUnit(e.assetId)}>
                  {e.assetId}
                </button>
                <span className="text-[11.5px] text-ink-3">{fmtAgo(e.at, now)}</span>
              </div>
              <StatusBadge status={e.status} cause={e.cause} />
              <span className="text-[11.5px] text-ink-3">{[e.externalReason, e.failureCode, e.note, e.user].filter(Boolean).join(' · ')}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
