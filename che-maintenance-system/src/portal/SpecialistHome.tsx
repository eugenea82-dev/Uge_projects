import { isOverdue } from '../domain/alerts.ts'
import { HOUR, STALLED_LIMIT_HOURS, STATUSES } from '../domain/constants.ts'
import { useNav } from '../shell/nav.tsx'
import { useStore } from '../store.tsx'
import { RiskBadge, StatusBadge } from '../ui/badges.tsx'
import { BarList } from '../ui/charts.tsx'
import { fmtAgo, fmtDuration, fmtPct } from '../ui/format.ts'
import { Icon } from '../ui/Icon.tsx'
import { StatTile } from '../ui/StatTile.tsx'

export function SpecialistHome() {
  const { user, scopedUnits, d, data, now, rollupFor, inScope } = useStore()
  const nav = useNav()
  const active = scopedUnits.filter((u) => !d.rel.get(u.assetId)?.excluded)
  const ru = rollupFor(active, 'scope')
  const operational = active.filter((u) => d.rel.get(u.assetId)?.currentStatus?.status === 'OPERATIONAL')
  const down = active.filter((u) => d.rel.get(u.assetId)?.currentStatus?.status !== 'OPERATIONAL')
  const todayStart = new Date(now).setHours(0, 0, 0, 0)
  const captured = operational.filter((u) => (d.readingsByUnit.get(u.assetId) ?? []).some((r) => r.at >= todayStart))
  const pending = operational.filter((u) => !captured.includes(u))
  const alerts = data.alerts.filter((a) => inScope(a.assetId) && a.status === 'Open').sort((a, b) => a.dueAt - b.dueAt)
  const overdue = alerts.filter((a) => isOverdue(a, now))
  const atRisk = active
    .map((u) => ({ u, s: d.scores.get(u.assetId) }))
    .filter((x) => x.s?.level === 'High' || x.s?.level === 'Critical')
    .sort((a, b) => b.s!.score - a.s!.score)
  const hour = new Date(now).getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">
          {greet}, {user.displayName.split(' ')[0]}
        </h1>
        <p className="text-ink-3">
          {user.locations?.join(' · ')} · {active.length} active units
        </p>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        <StatTile label="Operational now" value={`${operational.length}/${active.length}`} sub={`${down.length} down or in restoration`} tone={down.length ? 'warn' : 'ok'} icon="check" onClick={() => nav.go({ page: 'board' })} />
        <StatTile label="Availability · 13 wk" value={fmtPct(ru.rolling.availabilityPct)} sub={`Target ≥ 90% · ${ru.rolling.failureEvents} failure events`} tone={(ru.rolling.availabilityPct ?? 0) >= 90 ? 'ok' : 'danger'} icon="target" />
        <StatTile label="Pre-op readings today" value={`${captured.length}/${operational.length}`} sub={pending.length ? `${pending.length} units still to capture` : 'All captured'} tone={pending.length ? 'warn' : 'ok'} icon="pencil" onClick={() => nav.go({ page: 'capture' })} />
        <StatTile label="Alerts to decide" value={alerts.length} sub={overdue.length ? `${overdue.length} past SLA — escalated` : 'All within SLA'} tone={overdue.length ? 'danger' : undefined} icon="bell" onClick={() => nav.go({ page: 'alerts' })} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4 flex flex-col gap-2">
          <header className="flex items-center justify-between">
            <h3 className="text-[14px] font-semibold">Needs your decision</h3>
            <button className="text-accent text-[12.5px]" onClick={() => nav.go({ page: 'alerts' })}>
              All alerts
            </button>
          </header>
          {alerts.length === 0 && <div className="text-ink-3 py-4">No open alerts.</div>}
          {alerts.slice(0, 6).map((a) => {
            const od = isOverdue(a, now)
            return (
              <button key={a.id} className="flex items-center justify-between gap-3 py-2 border-b border-line last:border-0 text-left" onClick={() => nav.openAlert(a.id)}>
                <div className="min-w-0">
                  <div className="font-semibold">
                    {a.assetId} <span className="font-normal text-ink-3">· {a.component}</span>
                  </div>
                  <div className="text-[12px] text-ink-3 truncate">{a.reason}</div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <RiskBadge level={a.level} />
                  <span className="text-[11px]" style={{ color: od ? 'var(--danger)' : 'var(--ink-3)' }}>
                    {od ? `overdue ${fmtDuration(now - a.dueAt)}` : `${fmtDuration(a.dueAt - now)} left`}
                  </span>
                </div>
              </button>
            )
          })}
        </section>

        <section className="card p-4 flex flex-col gap-2">
          <header className="flex items-center justify-between">
            <h3 className="text-[14px] font-semibold">Down now</h3>
            <button className="text-accent text-[12.5px]" onClick={() => nav.go({ page: 'status' })}>
              Update status
            </button>
          </header>
          {down.length === 0 && <div className="text-ink-3 py-4">Every unit is operational.</div>}
          {down.map((u) => {
            const cs = d.rel.get(u.assetId)!.currentStatus!
            const stalled = (cs.status === 'AWAITING_PARTS' || cs.status === 'AWAITING_PO') && now - cs.at > STALLED_LIMIT_HOURS * HOUR
            return (
              <button key={u.assetId} className="flex items-center justify-between gap-3 py-2 border-b border-line last:border-0 text-left" onClick={() => nav.openUnit(u.assetId)}>
                <div className="min-w-0">
                  <div className="font-semibold">
                    {u.assetId} <span className="font-normal text-ink-3">· {u.type} · {u.location}</span>
                  </div>
                  <div className="text-[12px] text-ink-3">
                    {STATUSES[cs.status].label} for {fmtAgo(cs.at, now).replace(' ago', '')}
                    {cs.failureCode ? ` · ${cs.failureCode}` : ''}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <StatusBadge status={cs.status} cause={cs.cause} short />
                  {stalled && (
                    <span className="text-[11px] text-danger inline-flex items-center gap-1">
                      <Icon name="clock" size={11} /> stalled &gt; {STALLED_LIMIT_HOURS / 24} days
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </section>

        <section className="card p-4 flex flex-col gap-2">
          <h3 className="text-[14px] font-semibold">Pre-op capture still to do</h3>
          {pending.length === 0 ? (
            <div className="text-ink-3 py-4">All operational units have today’s readings.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {pending.map((u) => (
                <button key={u.assetId} className="btn btn-touch" onClick={() => nav.go({ page: 'capture', assetId: u.assetId })}>
                  <Icon name="pencil" size={13} /> {u.assetId}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="card p-4 flex flex-col gap-3">
          <h3 className="text-[14px] font-semibold">Availability by branch · rolling 13 weeks</h3>
          <BarList
            max={100}
            format={(v) => `${v.toFixed(1)}%`}
            rows={(user.locations ?? []).map((l) => {
              const r = rollupFor(active.filter((u) => u.location === l), l)
              return { key: l, label: l, value: r.rolling.availabilityPct ?? 0, detail: `${r.units} units · ${r.rolling.failureEvents} events`, onClick: () => nav.go({ page: 'board', filter: l }) }
            })}
          />
          {atRisk.length > 0 && (
            <>
              <div className="label pt-1">High / Critical risk units</div>
              <div className="flex flex-wrap gap-2">
                {atRisk.map(({ u, s }) => (
                  <button key={u.assetId} className="chip !h-7 !px-2.5" onClick={() => nav.openUnit(u.assetId)}>
                    <b>{u.assetId}</b> <RiskBadge level={s!.level} />
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
