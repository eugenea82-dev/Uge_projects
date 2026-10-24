// Equipment status board (FR-32) with rolling reliability history (FR-36).
// Current status and rolling 13-week availability sit side by side, so a unit
// that failed and recovered never looks the same as one with no downtime (AC-01/02).

import { useMemo, useState } from 'react'
import { LOCATIONS, RISK_LEVELS, STATUS_ORDER, STATUSES } from '../domain/constants.ts'
import type { EquipmentType, RiskLevel, StatusCode, Unit } from '../domain/types.ts'
import { useNav } from '../shell/nav.tsx'
import { useStore } from '../store.tsx'
import { Caveat, RiskBadge, StatusBadge, StatusDot } from '../ui/badges.tsx'
import { DistributionBar, Sparkline } from '../ui/charts.tsx'
import { downloadCsv, fmtAgo, fmtPct } from '../ui/format.ts'
import { Icon } from '../ui/Icon.tsx'
import { Empty } from '../ui/Sheet.tsx'

const TYPES: EquipmentType[] = ['Reach Stacker', 'Forklift', 'Empty Container Handler', 'Yard Tractor']

export function FleetBoard({ filter }: { filter?: string }) {
  const { scopedUnits, d, now, user, rollupFor } = useStore()
  const nav = useNav()
  const locations = useMemo(() => user.locations ?? [...LOCATIONS], [user.locations])
  const [loc, setLoc] = useState<string>(filter ?? 'all')
  const [type, setType] = useState<string>('all')
  const [status, setStatus] = useState<string>('all')
  const [risk, setRisk] = useState<string>('all')
  const [view, setView] = useState<'cards' | 'table'>('cards')
  const [showDisposal, setShowDisposal] = useState(false)

  const rows = useMemo(() => {
    return scopedUnits
      .filter((u) => loc === 'all' || u.location === loc)
      .filter((u) => type === 'all' || u.type === type)
      .filter((u) => {
        const st = d.rel.get(u.assetId)?.currentStatus?.status
        if (!showDisposal && st === 'FOR_DISPOSAL') return false
        return status === 'all' || st === status
      })
      .filter((u) => risk === 'all' || (risk === 'none' ? !d.scores.get(u.assetId)?.level : d.scores.get(u.assetId)?.level === risk))
  }, [scopedUnits, loc, type, status, risk, d, showDisposal])

  const byLoc = useMemo(() => {
    const m = new Map<string, Unit[]>()
    for (const u of rows) m.set(u.location, [...(m.get(u.location) ?? []), u])
    return locations.filter((l) => m.has(l)).map((l) => [l, m.get(l)!] as const)
  }, [rows, locations])

  const statusCounts = STATUS_ORDER.map((s) => ({ key: s, label: STATUSES[s].label, color: `var(${STATUSES[s].colorVar})`, value: rows.filter((u) => d.rel.get(u.assetId)?.currentStatus?.status === s).length }))
  const anyApprox = rows.some((u) => d.rel.get(u.assetId)?.rolling.approximated)

  const exportCsv = () => {
    const head = ['Asset ID', 'Type', 'Model', 'Location', 'Status', 'Cause', 'Since', 'Availability last week %', 'Availability 13w %', 'Failure events 13w', 'Risk level', 'Risk score']
    downloadCsv(
      `status-board-${new Date(now).toISOString().slice(0, 10)}.csv`,
      [head, ...rows.map((u) => {
        const r = d.rel.get(u.assetId)!
        const s = d.scores.get(u.assetId)
        return [u.assetId, u.type, `${u.make} ${u.model}`, u.location, r.currentStatus ? STATUSES[r.currentStatus.status].label : '', r.currentStatus?.cause ?? '', r.currentStatus ? new Date(r.currentStatus.at).toISOString() : '', r.weekly.at(-1)?.availabilityPct?.toFixed(1) ?? '', r.rolling.availabilityPct?.toFixed(1) ?? '', r.rolling.failureEvents, s?.level ?? 'Insufficient data', s?.score ?? '']
      })],
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <select className="field !w-auto" value={loc} onChange={(e) => setLoc(e.target.value)} aria-label="Location">
          <option value="all">All {user.locations ? 'my branches' : 'locations'}</option>
          {locations.map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
        <select className="field !w-auto" value={type} onChange={(e) => setType(e.target.value)} aria-label="Equipment type">
          <option value="all">All types</option>
          {TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select className="field !w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="all">All statuses</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {STATUSES[s].label}
            </option>
          ))}
        </select>
        <select className="field !w-auto" value={risk} onChange={(e) => setRisk(e.target.value)} aria-label="Risk">
          <option value="all">All risk levels</option>
          {RISK_LEVELS.map((r) => (
            <option key={r}>{r}</option>
          ))}
          <option value="none">Insufficient data</option>
        </select>
        <label className="inline-flex items-center gap-1.5 text-[12px] text-ink-2 ml-1">
          <input type="checkbox" checked={showDisposal} onChange={(e) => setShowDisposal(e.target.checked)} /> Show For Disposal
        </label>
        <div className="flex-1" />
        <div className="segmented" role="group" aria-label="Layout">
          <button aria-pressed={view === 'cards'} onClick={() => setView('cards')}>
            Cards
          </button>
          <button aria-pressed={view === 'table'} onClick={() => setView('table')}>
            Table
          </button>
        </div>
        <button className="btn" onClick={exportCsv}>
          <Icon name="download" size={14} /> CSV
        </button>
      </div>

      <div className="card p-3.5 flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[12.5px] text-ink-2">
            <b className="text-ink">{rows.length}</b> units · <b className="text-ink">{statusCounts[0].value}</b> operational now
          </span>
          <span className="text-[11.5px] text-ink-3">For Disposal units are excluded from every KPI (FR-34)</span>
        </div>
        <DistributionBar parts={statusCounts} />
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {statusCounts.map((s) => (
            <button key={s.key} className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-2 hover:text-ink" onClick={() => setStatus(status === s.key ? 'all' : s.key)}>
              <StatusDot status={s.key as StatusCode} size={13} />
              {s.label} <span className="tnum text-ink">{s.value}</span>
            </button>
          ))}
        </div>
      </div>

      {anyApprox && (
        <Caveat>
          Rolling 13-week figures include weeks migrated from YardPulse, which only recorded a weekly status snapshot. Those weeks are approximations: short failures that recovered within the week are not captured (C-05).
        </Caveat>
      )}

      {rows.length === 0 && <Empty icon="search" title="No units match these filters" />}

      {view === 'cards' ? (
        byLoc.map(([l, units]) => {
          const ru = rollupFor(units, l)
          return (
            <section key={l} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2 px-0.5">
                <h3 className="text-[14px] font-semibold">{l}</h3>
                <span className="text-[12px] text-ink-3 tnum">
                  {ru.units} active · 13-wk availability <b className="text-ink">{fmtPct(ru.rolling.availabilityPct)}</b> · {ru.rolling.failureEvents} failure events
                </span>
              </div>
              <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(232px, 1fr))' }}>
                {units.map((u) => (
                  <UnitCard key={u.assetId} u={u} onOpen={() => nav.openUnit(u.assetId)} />
                ))}
              </div>
            </section>
          )
        })
      ) : (
        <div className="card overflow-hidden">
          <div className="scroll-area max-h-[70vh]">
            <table className="table">
              <thead>
                <tr>
                  <th>Unit</th>
                  <th>Location</th>
                  <th>Current status</th>
                  <th className="num">Last week</th>
                  <th className="num">13-wk avail.</th>
                  <th>13-week trend</th>
                  <th className="num">Events</th>
                  <th>Risk</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => {
                  const r = d.rel.get(u.assetId)!
                  const s = d.scores.get(u.assetId)
                  return (
                    <tr key={u.assetId} className="clickable" onClick={() => nav.openUnit(u.assetId)}>
                      <td>
                        <div className="font-semibold">{u.assetId}</div>
                        <div className="text-[11.5px] text-ink-3">
                          {u.type} · {u.make} {u.model}
                        </div>
                      </td>
                      <td>{u.location}</td>
                      <td>
                        {r.currentStatus && <StatusBadge status={r.currentStatus.status} cause={r.currentStatus.cause} />}
                        {r.currentStatus && r.currentStatus.status !== 'OPERATIONAL' && <div className="text-[11px] text-ink-3 mt-0.5">since {fmtAgo(r.currentStatus.at, now)}</div>}
                      </td>
                      <td className="num">{r.excluded ? '—' : fmtPct(r.weekly.at(-1)?.availabilityPct)}</td>
                      <td className="num font-semibold">{r.excluded ? 'Excluded' : fmtPct(r.rolling.availabilityPct)}</td>
                      <td>{!r.excluded && <Sparkline values={r.weekly.map((w) => w.availabilityPct)} min={0} max={100} />}</td>
                      <td className="num">{r.excluded ? '—' : r.rolling.failureEvents}</td>
                      <td>{!r.excluded && <RiskBadge level={s?.level ?? null} score={s?.level ? s.score : undefined} />}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function UnitCard({ u, onOpen }: { u: Unit; onOpen: () => void }) {
  const { d, now } = useStore()
  const r = d.rel.get(u.assetId)!
  const s = d.scores.get(u.assetId)
  const cs = r.currentStatus
  const lastWeek = r.weekly.at(-1)
  const recovered = cs?.status === 'OPERATIONAL' && (lastWeek?.techH ?? 0) > 0
  return (
    <button onClick={onOpen} className="card p-3 text-left flex flex-col gap-2 hover:brightness-[0.985] focus-visible:outline-2 focus-visible:outline-[var(--accent)]" style={{ borderTop: cs ? `3px solid var(${STATUSES[cs.status].colorVar})` : undefined }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-[13.5px]">{u.assetId}</div>
          <div className="text-[11.5px] text-ink-3 truncate">
            {u.type} · {u.make} {u.model}
          </div>
        </div>
        {!r.excluded && <RiskBadge level={(s?.level ?? null) as RiskLevel | null} />}
      </div>
      <div className="flex items-center justify-between gap-2">
        {cs && <StatusBadge status={cs.status} cause={cs.cause} short />}
        {cs && cs.status !== 'OPERATIONAL' && <span className="text-[11px] text-ink-3">{fmtAgo(cs.at, now)}</span>}
      </div>
      {r.excluded ? (
        <div className="text-[11.5px] text-ink-3">Excluded from all KPIs</div>
      ) : (
        <div className="flex items-end justify-between gap-2">
          <div>
            <div className="text-[10.5px] text-ink-3 uppercase tracking-wide font-semibold">13-wk availability</div>
            <div className="text-[20px] font-semibold leading-tight tnum">{fmtPct(r.rolling.availabilityPct)}</div>
            <div className="text-[11px] text-ink-3 tnum">
              last wk {fmtPct(lastWeek?.availabilityPct)} · {r.rolling.failureEvents} events
            </div>
          </div>
          <Sparkline values={r.weekly.map((w) => w.availabilityPct)} min={0} max={100} />
        </div>
      )}
      {recovered && (
        <div className="text-[11px] text-ink-2 flex items-center gap-1">
          <Icon name="info" size={12} /> Operational now, but down {lastWeek!.techH.toFixed(0)} h last week
        </div>
      )}
    </button>
  )
}
