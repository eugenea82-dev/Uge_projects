// Alert review and decision workflow (FR-19 to FR-24), BM authorization (FR-22)
// and SLA escalation (FR-20). Shared by both roles; actions follow BRD §3.3.

import { useMemo, useState } from 'react'
import { accept, authorize, defer, isOverdue, linkWorkOrder, recordOutcome, reject, startWork } from '../domain/alerts.ts'
import { DAY, FAILURE_CODES, REJECT_REASONS, RISK_LEVELS } from '../domain/constants.ts'
import type { Alert, OutcomeType, RejectReason } from '../domain/types.ts'
import { useNav } from '../shell/nav.tsx'
import { useStore } from '../store.tsx'
import { AlertStatusBadge, RiskBadge, StatusBadge } from '../ui/badges.tsx'
import { downloadCsv, fmtAgo, fmtDate, fmtDateTime, fmtDuration, toLocalDateInput } from '../ui/format.ts'
import { Icon } from '../ui/Icon.tsx'
import { Empty, Field } from '../ui/Sheet.tsx'

type Tab = 'decide' | 'auth' | 'active' | 'closed' | 'all'

const LEVEL_RANK = { Critical: 0, High: 1, Medium: 2, Low: 3 }

export function AlertsPage({ alertId }: { alertId?: string }) {
  const { data, inScope, now, user, d } = useStore()
  const isMgr = user.role === 'AM_MANAGER'
  const initial = alertId ? data.alerts.find((a) => a.id === alertId) : undefined
  const [tab, setTab] = useState<Tab>(initial ? 'all' : isMgr ? 'auth' : 'decide')
  const [level, setLevel] = useState('all')
  const [selected, setSelected] = useState<string | undefined>(alertId)

  const scoped = useMemo(() => data.alerts.filter((a) => inScope(a.assetId)), [data.alerts, inScope])
  const groups: Record<Tab, Alert[]> = {
    decide: scoped.filter((a) => a.status === 'Open'),
    auth: scoped.filter((a) => a.authorization?.state === 'Pending'),
    active: scoped.filter((a) => a.status === 'Acknowledged' || a.status === 'Scheduled' || a.status === 'In Progress'),
    closed: scoped.filter((a) => a.status === 'Closed'),
    all: scoped,
  }
  const list = groups[tab]
    .filter((a) => level === 'all' || a.level === level)
    .sort((a, b) => (tab === 'closed' ? (b.outcome?.at ?? 0) - (a.outcome?.at ?? 0) : LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || a.dueAt - b.dueAt))
  const sel = scoped.find((a) => a.id === selected) ?? list[0]
  const overdue = groups.decide.filter((a) => isOverdue(a, now))

  const tabs: [Tab, string][] = [
    ['decide', 'Needs decision'],
    ['auth', 'Awaiting authorization'],
    ['active', 'Scheduled / in progress'],
    ['closed', 'Closed'],
    ['all', 'All'],
  ]

  const exportCsv = () =>
    downloadCsv(`alerts-${new Date(now).toISOString().slice(0, 10)}.csv`, [
      ['Alert', 'Asset', 'Location', 'Component', 'Level', 'Score', 'Status', 'Created', 'Due', 'Decision', 'Authorization', 'WO', 'Outcome', 'Model'],
      ...list.map((a) => [a.id, a.assetId, d.unitById.get(a.assetId)?.location, a.component, a.level, a.score, a.status, new Date(a.createdAt).toISOString(), new Date(a.dueAt).toISOString(), a.decision?.type, a.authorization?.state, a.woNumber, a.outcome?.type, a.modelVersion]),
    ])

  return (
    <div className="flex flex-col gap-3">
      {overdue.length > 0 && (
        <div className="caveat notice-danger">
          <Icon name="clock" size={15} className="text-danger" />
          <div>
            <b>{overdue.length} alert{overdue.length > 1 ? 's' : ''} past the decision SLA</b> — escalated to the {isMgr ? 'Asset Maintenance Manager (you)' : 'Asset Maintenance Manager'} (FR-20). SLA: Critical 4 h · High 1 working day · Medium 3 working days.
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="segmented flex-wrap" role="tablist">
          {tabs.map(([k, l]) => (
            <button key={k} role="tab" aria-pressed={tab === k} onClick={() => { setTab(k); setSelected(undefined) }}>
              {l} <span className="tnum opacity-70">{groups[k].length}</span>
            </button>
          ))}
        </div>
        <select className="field !w-auto" value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Risk level">
          <option value="all">All levels</option>
          {RISK_LEVELS.slice(1).map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
        <div className="flex-1" />
        <button className="btn" onClick={exportCsv}>
          <Icon name="download" size={14} /> CSV
        </button>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(280px,380px)_minmax(0,1fr)] items-start">
        <div className="card overflow-hidden">
          <div className="scroll-area max-h-[68vh]">
            {list.length === 0 && <Empty title="Nothing here">No alerts in this view.</Empty>}
            {list.map((a) => {
              const od = isOverdue(a, now)
              return (
                <button key={a.id} onClick={() => setSelected(a.id)} className="w-full text-left px-3.5 py-2.5 border-b border-line flex flex-col gap-1" style={{ background: sel?.id === a.id ? 'var(--selection)' : undefined }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">
                      {a.assetId} <span className="font-normal text-ink-3">· {a.component}</span>
                    </span>
                    <RiskBadge level={a.level} />
                  </div>
                  <div className="text-[12px] text-ink-2 line-clamp-2">{a.reason}</div>
                  <div className="flex items-center justify-between gap-2 text-[11.5px] text-ink-3">
                    <AlertStatusBadge status={a.status} />
                    {a.status === 'Open' ? <span style={{ color: od ? 'var(--danger)' : undefined }}>{od ? `Overdue ${fmtDuration(now - a.dueAt)}` : `Decide within ${fmtDuration(a.dueAt - now)}`}</span> : a.authorization?.state === 'Pending' ? <span>Awaiting BM</span> : <span>{fmtAgo(a.createdAt, now)}</span>}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
        {sel ? <AlertDetail key={sel.id} a={sel} /> : <div className="card"><Empty icon="bell" title="Select an alert" /></div>}
      </div>
    </div>
  )
}

function AlertDetail({ a }: { a: Alert }) {
  const { d, now, user, can, updateAlert } = useStore()
  const nav = useNav()
  const u = d.unitById.get(a.assetId)
  const cs = d.rel.get(a.assetId)?.currentStatus
  const [mode, setMode] = useState<'accept' | 'defer' | 'reject' | 'return' | null>(null)
  const [remarks, setRemarks] = useState('')
  const [deferDate, setDeferDate] = useState(() => toLocalDateInput(now + 7 * DAY))
  const [reason, setReason] = useState<RejectReason | ''>('')
  const [wo, setWo] = useState('WO-')
  const [outcome, setOutcome] = useState<OutcomeType | ''>('')
  const [findings, setFindings] = useState('')
  const [fcode, setFcode] = useState('')
  const [error, setError] = useState<string | null>(null)

  const run = (label: string, fn: (x: Alert) => Alert, msg: string) => {
    const err = updateAlert(a.id, label, fn)
    if (err) setError(err)
    else {
      setError(null)
      setMode(null)
      setRemarks('')
      nav.toast(msg)
    }
  }
  const me = user.displayName
  const od = isOverdue(a, now)
  const isMgr = user.role === 'AM_MANAGER'

  return (
    <section className="card p-4 flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[17px] font-semibold">
              {a.assetId} · {a.component}
            </h2>
            <RiskBadge level={a.level} score={a.score || undefined} />
            <AlertStatusBadge status={a.status} />
          </div>
          <div className="text-[12px] text-ink-3 mt-0.5">
            {a.id} · {u?.type} · {u?.location} · raised {fmtDateTime(a.createdAt)} · source: {a.source === 'ndt-critical' ? 'Critical NDT finding (FR-08)' : a.source === 'stalled-restoration' ? 'Stalled restoration (FR-39)' : `risk score (${a.modelVersion})`}
          </div>
        </div>
        <button className="btn" onClick={() => nav.openUnit(a.assetId)}>
          Unit health <Icon name="chevronRight" size={13} />
        </button>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Info label="Decision SLA" value={a.status === 'Open' ? (od ? `Overdue by ${fmtDuration(now - a.dueAt)}` : `${fmtDuration(a.dueAt - now)} left`) : a.decision ? `Decided ${fmtAgo(a.decision.at, now)}` : '—'} danger={od} sub={`Due ${fmtDateTime(a.dueAt)}${od ? ' · escalated' : ''}`} />
        <Info label="Data used" value={fmtDateTime(a.dataDate)} sub="Every alert shows its data date (NFR-U04)" />
        <Info label="Unit now" value={cs ? <StatusBadge status={cs.status} cause={cs.cause} short /> : '—'} sub={a.requiresRemoval ? 'Removal from service → BM authorization' : 'No removal required'} />
      </div>

      <div>
        <div className="label mb-1">Why this alert was raised</div>
        <p className="text-ink-2">{a.reason}</p>
        {a.factors.length > 0 && (
          <ul className="mt-2 flex flex-col gap-0.5">
            {a.factors.map((f, i) => (
              <li key={i} className="flex justify-between gap-3 text-[12.5px]">
                <span className="text-ink-2">{f.label}</span>
                <span className="tnum font-semibold">+{f.points}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {a.recommendedAction && (
        <div className="caveat notice-info">
          <Icon name="wrench" size={14} className="text-accent" />
          <div>
            <b>Recommended action.</b> {a.recommendedAction}
          </div>
        </div>
      )}

      {/* History */}
      <ol className="flex flex-col gap-1.5 text-[12.5px]">
        <Step done label={`Raised ${fmtDateTime(a.createdAt)}`} />
        {a.decision && <Step done label={`${a.decision.type === 'accept' ? 'Accepted' : a.decision.type === 'defer' ? `Deferred to ${fmtDate(a.decision.deferUntil!)}` : `Rejected — ${a.decision.rejectReason}`} by ${a.decision.by} · ${fmtDateTime(a.decision.at)}`} detail={a.decision.remarks} />}
        {a.authorization && <Step done={a.authorization.state !== 'Pending'} warn={a.authorization.state === 'Returned'} label={a.authorization.state === 'Pending' ? 'Awaiting Branch Manager / AM Manager authorization' : `Authorization ${a.authorization.state.toLowerCase()} by ${a.authorization.by} · ${fmtDateTime(a.authorization.at!)}`} detail={a.authorization.remarks} />}
        {a.woNumber && <Step done label={`EMMS work order ${a.woNumber} linked`} />}
        {a.status === 'In Progress' && <Step done label="Work in progress" />}
        {a.outcome && <Step done label={`Closed — ${a.outcome.type}${a.outcome.failureCode ? ` · ${a.outcome.failureCode}` : ''} · ${a.outcome.by}`} detail={a.outcome.findings} />}
      </ol>

      {error && (
        <div className="caveat notice-danger" role="alert">
          <Icon name="alert" size={14} className="text-danger" /> {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-3 border-t border-line pt-3">
        {a.status === 'Open' && can('decideAlerts') && (
          <>
            <div className="flex flex-wrap gap-2">
              <button className={`btn btn-touch ${mode === 'accept' ? 'btn-primary' : ''}`} onClick={() => setMode('accept')}>
                <Icon name="check" size={14} /> Accept
              </button>
              <button className={`btn btn-touch ${mode === 'defer' ? 'btn-primary' : ''}`} onClick={() => setMode('defer')}>
                <Icon name="calendar" size={14} /> Defer
              </button>
              <button className={`btn btn-touch ${mode === 'reject' ? 'btn-primary' : ''}`} onClick={() => setMode('reject')}>
                <Icon name="x" size={14} /> Reject
              </button>
            </div>
            {mode === 'defer' && (
              <Field label="Defer until (required)">
                <input type="date" className="field !w-auto" value={deferDate} onChange={(e) => setDeferDate(e.target.value)} />
              </Field>
            )}
            {mode === 'reject' && (
              <Field label="Reject reason (required)">
                <select className="field" value={reason} onChange={(e) => setReason(e.target.value as RejectReason)}>
                  <option value="">Choose a reason…</option>
                  {REJECT_REASONS.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </Field>
            )}
            {mode && mode !== 'return' && (
              <>
                <Field label={`Remarks${mode === 'reject' && reason === 'Other' ? ' (required)' : ' (optional)'}`}>
                  <textarea className="field" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
                </Field>
                <div className="flex justify-end">
                  <button
                    className="btn btn-primary btn-touch !px-6"
                    onClick={() =>
                      mode === 'accept'
                        ? run('Alert accepted', (x) => accept(x, me, Date.now(), remarks || undefined), a.requiresRemoval ? 'Accepted — sent for Branch Manager authorization.' : 'Alert accepted. Link the EMMS work order to schedule it.')
                        : mode === 'defer'
                          ? run('Alert deferred', (x) => defer(x, me, Date.now(), new Date(deferDate + 'T08:00').getTime(), remarks || undefined), 'Alert deferred.')
                          : run('Alert rejected', (x) => reject(x, me, Date.now(), reason || undefined, remarks || undefined), 'Alert rejected and closed as Not actioned.')
                    }
                  >
                    Confirm {mode}
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {a.authorization?.state === 'Pending' &&
          (can('authorize') ? (
            <div className="flex flex-col gap-2">
              <div className="text-[12.5px] text-ink-2">
                <b>Authorization required.</b> This {a.level} alert needs removal from service or a schedule change. Approve or return with remarks (FR-22).
              </div>
              <Field label={mode === 'return' ? 'Remarks (required to return)' : 'Remarks'}>
                <textarea className="field" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </Field>
              <div className="flex flex-wrap justify-end gap-2">
                <button className="btn btn-touch" onClick={() => { setMode('return'); run('Authorization returned', (x) => authorize(x, me, Date.now(), false, remarks), 'Returned to the engineer with remarks.') }}>
                  Return with remarks
                </button>
                <button className="btn btn-primary btn-touch !px-6" onClick={() => run('Authorization approved', (x) => authorize(x, me, Date.now(), true, remarks || undefined), 'Authorized. The planner can now schedule the work order.')}>
                  Approve removal / schedule change
                </button>
              </div>
            </div>
          ) : (
            <div className="caveat">
              <Icon name="clock" size={14} /> Waiting for Branch Manager / Asset Maintenance Manager authorization before work can be scheduled.
            </div>
          ))}

        {a.status === 'Acknowledged' && a.authorization?.state !== 'Pending' && (can('decideAlerts') || isMgr) && (
          <div className="flex flex-col gap-2">
            {a.authorization?.state === 'Returned' && (
              <div className="caveat notice-danger">
                <Icon name="alert" size={14} className="text-danger" /> Authorization was returned — re-assess, then defer or reject, or contact the BM.
              </div>
            )}
            {a.decision?.type === 'defer' && a.decision.deferUntil! <= now && (
              <div className="caveat">
                <Icon name="calendar" size={14} /> Defer date reached — schedule the work or reject the alert.
              </div>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Link EMMS work order (FR-23)" hint="Release 1: enter the WO number from EMMS">
                <input className="field tnum !w-[180px]" value={wo} onChange={(e) => setWo(e.target.value.toUpperCase())} />
              </Field>
              <button className="btn btn-primary btn-touch" disabled={a.authorization?.state === 'Returned'} onClick={() => run('Work order linked', (x) => linkWorkOrder(x, wo), `${wo} linked — alert scheduled.`)}>
                Link & schedule
              </button>
              {a.decision?.type === 'defer' || a.authorization?.state === 'Returned' ? (
                <button className="btn btn-touch" onClick={() => setMode('reject')}>
                  Reject instead…
                </button>
              ) : null}
            </div>
            {mode === 'reject' && (
              <div className="flex flex-wrap items-end gap-2">
                <select className="field !w-auto" value={reason} onChange={(e) => setReason(e.target.value as RejectReason)} aria-label="Reject reason">
                  <option value="">Reason…</option>
                  {REJECT_REASONS.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
                <input className="field !w-[220px]" placeholder="Remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
                <button className="btn btn-touch" onClick={() => run('Alert rejected', (x) => reject(x, me, Date.now(), reason || undefined, remarks || undefined), 'Alert rejected and closed.')}>
                  Confirm reject
                </button>
              </div>
            )}
          </div>
        )}

        {a.status === 'Scheduled' && (
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-touch" onClick={() => run('Work started', (x) => startWork(x), 'Work started.')}>
              <Icon name="wrench" size={14} /> Start work
            </button>
          </div>
        )}

        {(a.status === 'Scheduled' || a.status === 'In Progress') && can('recordOutcome') && (
          <div className="flex flex-col gap-2">
            <div className="label">Record outcome at WO closure (FR-24)</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <select className="field field-touch" value={outcome} onChange={(e) => setOutcome(e.target.value as OutcomeType)} aria-label="Outcome">
                <option value="">Outcome…</option>
                {(['Confirmed fault', 'No fault found', 'Failed before action', 'Not actioned'] as OutcomeType[]).map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
              <select className="field field-touch" value={fcode} onChange={(e) => setFcode(e.target.value)} aria-label="Failure code">
                <option value="">Failure code{outcome === 'Confirmed fault' ? ' (required)' : ''}…</option>
                {FAILURE_CODES.map((f) => (
                  <option key={f.code} value={f.code}>
                    {f.code} — {f.label}
                  </option>
                ))}
              </select>
            </div>
            <textarea className="field" rows={2} placeholder="What was actually found?" value={findings} onChange={(e) => setFindings(e.target.value)} />
            <div className="flex justify-end">
              <button className="btn btn-primary btn-touch !px-6" onClick={() => run('Outcome recorded', (x) => recordOutcome(x, me, Date.now(), outcome || undefined, findings, fcode || undefined), 'Outcome recorded — alert closed. Prediction performance updated.')}>
                Close alert
              </button>
            </div>
          </div>
        )}
        <div className="text-[11px] text-ink-3">Human in the loop: the system never removes a unit from service or changes a schedule on its own (NFR-M01).</div>
      </div>
    </section>
  )
}

function Info({ label, value, sub, danger }: { label: string; value: React.ReactNode; sub?: string; danger?: boolean }) {
  return (
    <div className="rounded-lg bg-surface-2 p-2.5">
      <div className="label">{label}</div>
      <div className="font-semibold mt-0.5" style={{ color: danger ? 'var(--danger)' : undefined }}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-ink-3">{sub}</div>}
    </div>
  )
}

function Step({ label, detail, done, warn }: { label: string; detail?: string; done?: boolean; warn?: boolean }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-[3px] w-3 h-3 rounded-full shrink-0" style={{ background: warn ? 'var(--danger)' : done ? 'var(--accent)' : 'transparent', boxShadow: done || warn ? undefined : 'inset 0 0 0 1.5px var(--ink-3)' }} />
      <div>
        <div>{label}</div>
        {detail && <div className="text-ink-3 text-[11.5px]">“{detail}”</div>}
      </div>
    </li>
  )
}
