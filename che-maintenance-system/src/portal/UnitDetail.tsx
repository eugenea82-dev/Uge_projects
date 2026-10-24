// Unit health page (FR-27): one timeline of work orders, readings, alerts,
// decisions and KPIs, plus the risk explanation (FR-16) and trend charts (FR-13).

import { useMemo, useState, type ReactNode } from 'react'
import { MTTR_BUCKETS, PARAMS, STATUSES } from '../domain/constants.ts'
import { detectFindings } from '../domain/detection.ts'
import { holtDamped } from '../domain/forecast.ts'
import { isoWeek } from '../domain/kpi.ts'
import type { ParamKey } from '../domain/types.ts'
import { useNav } from '../shell/nav.tsx'
import { useStore } from '../store.tsx'
import { AlertStatusBadge, Caveat, RiskBadge, StatusBadge, SufficiencyBadge } from '../ui/badges.tsx'
import { ChartCard, LineChart } from '../ui/charts.tsx'
import { fmtAgo, fmtDate, fmtDateTime, fmtHours, fmtPct, fmtPhp } from '../ui/format.ts'
import { Icon } from '../ui/Icon.tsx'
import { Empty } from '../ui/Sheet.tsx'
import { StatTile } from '../ui/StatTile.tsx'

export function UnitDetail({ assetId }: { assetId?: string }) {
  const { d, data, now, can, inScope, user } = useStore()
  const nav = useNav()
  const u = assetId ? d.unitById.get(assetId) : undefined
  const [param, setParam] = useState<ParamKey>('engineTemp')
  const [tl, setTl] = useState<'all' | 'status' | 'alerts' | 'wo' | 'lab'>('all')

  const readings = useMemo(() => (assetId ? d.readingsByUnit.get(assetId) ?? [] : []), [d, assetId])

  if (!u || !assetId) return <Empty icon="search" title="Unit not found" />
  if (!inScope(assetId)) return <Empty icon="lock" title="Outside your branch scope">{user.displayName} can view units in {user.locations?.join(', ')} only (BRD §3.3).</Empty>

  const rel = d.rel.get(assetId)!
  const score = d.scores.get(assetId)
  const cs = rel.currentStatus
  const limits = data.thresholds[u.type]
  const eps = d.episodesByUnit.get(assetId) ?? []
  const alerts = data.alerts.filter((a) => a.assetId === assetId).sort((a, b) => b.createdAt - a.createdAt)
  const wos = data.workOrders.filter((w) => w.assetId === assetId).sort((a, b) => b.openedAt - a.openedAt)
  const oil = data.oil.filter((o) => o.assetId === assetId).sort((a, b) => b.sampledAt - a.sampledAt)
  const ndt = data.ndt.filter((n) => n.assetId === assetId).sort((a, b) => b.inspectedAt - a.inspectedAt)
  const events = (d.eventsByUnit.get(assetId) ?? []).slice().sort((a, b) => b.at - a.at)

  // Weekly availability + Holt damped forecast (FR-42)
  const weekly = rel.weekly.map((w) => w.availabilityPct ?? 100)
  const fc = holtDamped(weekly, 13)
  const labels = [...d.weeks.map((w) => `W${isoWeek(w)}`), ...fc.forecast.map((_, i) => `W${isoWeek(d.weeks[d.weeks.length - 1] + (i + 1) * 7 * 86_400_000)}`)]
  const nHist = weekly.length

  const p = PARAMS.find((x) => x.key === param)!
  const lim = limits[param]
  const tail = readings.slice(-45)
  const lastReading = readings[readings.length - 1]
  const lastFindings = lastReading ? detectFindings(lastReading, readings.slice(0, -1), limits) : []

  type Item = { at: number; kind: 'status' | 'alerts' | 'wo' | 'lab'; icon: string; title: ReactNode; detail?: ReactNode }
  const items: Item[] = [
    ...events.map((e) => ({
      at: e.at,
      kind: 'status' as const,
      icon: STATUSES[e.status].icon,
      title: (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          Status → <StatusBadge status={e.status} cause={e.cause} />
        </span>
      ),
      detail: [e.externalReason, e.failureCode, e.note, e.migrated ? 'migrated from YardPulse (week-granular)' : null, `by ${e.user}`].filter(Boolean).join(' · '),
    })),
    ...alerts.map((a) => ({
      at: a.createdAt,
      kind: 'alerts' as const,
      icon: 'bell',
      title: (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {a.level} alert · {a.component} <AlertStatusBadge status={a.status} />
        </span>
      ),
      detail: [a.reason, a.decision ? `${a.decision.type} by ${a.decision.by}` : null, a.woNumber, a.outcome ? `outcome: ${a.outcome.type}` : null].filter(Boolean).join(' · '),
    })),
    ...wos.map((w) => ({
      at: w.openedAt,
      kind: 'wo' as const,
      icon: 'doc',
      title: `${w.woNumber} · ${w.kind} work order`,
      detail: [w.description, w.failureCode, w.closedAt ? `closed ${fmtDate(w.closedAt)}` : w.dueAt && w.dueAt < now ? 'OVERDUE' : 'open', w.cost ? fmtPhp(w.cost) : null].filter(Boolean).join(' · '),
    })),
    ...oil.map((o) => ({ at: o.sampledAt, kind: 'lab' as const, icon: 'flask', title: `Oil analysis · ${o.compartment} · ${o.severity}`, detail: `${o.lab} · Fe ${o.ironPpm} ppm · water ${o.waterPct}% · ISO ${o.particleCode}` })),
    ...ndt.map((n) => ({ at: n.inspectedAt, kind: 'lab' as const, icon: 'search', title: `NDT · ${n.method} · ${n.severity}`, detail: `${n.location} — ${n.finding}${n.defectSizeMm ? ` (${n.defectSizeMm} mm)` : ''}` })),
  ]
    .filter((i) => tl === 'all' || i.kind === tl)
    .sort((a, b) => b.at - a.at)
    .slice(0, 80)

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-4 flex flex-wrap items-start gap-4 justify-between">
        <div className="flex items-start gap-3.5 min-w-0">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white shrink-0" style={{ background: cs ? `var(${STATUSES[cs.status].colorVar})` : 'var(--st-gray)' }}>
            <Icon name="truck" size={24} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[20px] font-semibold tracking-tight">{u.assetId}</h2>
              {cs && <StatusBadge status={cs.status} cause={cs.cause} />}
              {cs && cs.status !== 'OPERATIONAL' && <span className="text-[12px] text-ink-3">since {fmtDateTime(cs.at)} ({fmtAgo(cs.at, now)})</span>}
            </div>
            <div className="text-ink-2 mt-0.5">
              {u.type} · {u.make} {u.model} · S/N {u.serialNo} · {u.year}
            </div>
            <div className="text-[12px] text-ink-3 mt-0.5 tnum">
              {u.location} · Criticality {u.criticality} · Hour meter {u.hourMeter.toLocaleString()} h · PM every {u.pmIntervalHours} h (last at {u.lastPmHourMeter.toLocaleString()} h)
            </div>
          </div>
        </div>
        {!rel.excluded && (
          <div className="flex flex-wrap gap-2">
            {can('captureReadings') && (
              <button className="btn" onClick={() => nav.go({ app: 'portal', page: 'capture', assetId })}>
                <Icon name="pencil" size={14} /> Capture reading
              </button>
            )}
            {can('updateStatus') && (
              <button className="btn" onClick={() => nav.go({ app: 'portal', page: 'status', assetId })}>
                <Icon name="pulse" size={14} /> Update status
              </button>
            )}
            {can('uploadLabNdt') && (
              <button className="btn" onClick={() => nav.go({ app: 'portal', page: 'lab', assetId })}>
                <Icon name="flask" size={14} /> Oil / NDT
              </button>
            )}
          </div>
        )}
      </section>

      {rel.excluded ? (
        <Caveat>This unit is For Disposal. It is excluded from every KPI, roll-up and risk score (FR-34, AC-04).</Caveat>
      ) : (
        <>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <StatTile label="Availability · 13 wk" value={fmtPct(rel.rolling.availabilityPct)} sub={`Last week ${fmtPct(rel.weekly.at(-1)?.availabilityPct)}`} icon="target" />
            <StatTile label="Failure events · 13 wk" value={rel.rolling.failureEvents} sub={`${rel.rolling.repeatFailures} repeat`} tone={rel.rolling.repeatFailures ? 'danger' : undefined} icon="alert" />
            <StatTile label="MTBF" value={fmtHours(rel.rolling.mtbfH)} sub="operating h ÷ failure events" icon="clock" />
            <StatTile label="MTTR" value={fmtHours(rel.rolling.mttrH)} sub={`Parts delay ${fmtHours(rel.rolling.partsDelayH)}`} icon="wrench" />
            <StatTile label="Operational constraint" value={fmtHours(rel.rolling.extH)} sub="external — excluded from A-R-M" icon="building" />
          </div>
          {rel.rolling.approximated && <Caveat>Part of this unit’s 13-week window comes from YardPulse weekly snapshots and is approximate (C-05, NFR-U07).</Caveat>}

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
            <section className="card p-4 flex flex-col gap-3">
              <header className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[13.5px] font-semibold">Failure risk</h3>
                <div className="flex flex-wrap gap-1.5">
                  {score && <SufficiencyBadge s={score.sufficiency} />}
                </div>
              </header>
              {cs && cs.status !== 'OPERATIONAL' ? (
                <div className="text-ink-2">Unit is in restoration — predictive scoring resumes once it returns to service.</div>
              ) : score ? (
                <>
                  <div className="flex items-center gap-3">
                    <RiskMeter score={score.score} />
                    <div>
                      <RiskBadge level={score.level} />
                      <div className="text-[12px] text-ink-3 mt-1">
                        Likely component: <b className="text-ink-2">{score.component}</b>
                        <br />
                        Horizon 30 days · data as of {fmtDateTime(score.dataDate)}
                        <br />
                        {score.modelVersion} · {score.method}
                      </div>
                    </div>
                  </div>
                  {!score.level && <Caveat>Not enough readings in the last 30 days to score this unit reliably (FR-16). Capture daily pre-op readings to enable scoring.</Caveat>}
                  <div>
                    <div className="label mb-1.5">Contributing factors</div>
                    {score.factors.length === 0 ? (
                      <div className="text-ink-3 text-[12.5px]">No adverse factors — readings within limits and no recent failures.</div>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {score.factors.map((f, i) => (
                          <li key={i} className="flex items-start justify-between gap-3 text-[12.5px]">
                            <span className="text-ink-2">{f.label}</span>
                            <span className="tnum font-semibold shrink-0">+{f.points}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              ) : null}
              <div className="text-[11px] text-ink-3">Decision support only — never replaces physical inspection or OEM safety procedures (NFR-R04).</div>
            </section>

            <ChartCard
              title="Weekly availability & 13-week forecast"
              subtitle="Time-weighted availability per week; forecast by Holt damped-trend smoothing (YardPulse method, FR-42)"
              table={{ head: ['Week', 'Availability %', 'Tech. downtime h', 'Events'], rows: rel.weekly.map((w, i) => [labels[i], fmtPct(w.availabilityPct), w.techH.toFixed(1), w.failureEvents]) }}
            >
              <LineChart
                labels={labels}
                height={210}
                yMin={Math.max(0, Math.min(80, Math.floor(Math.min(...weekly, ...fc.forecast) / 10) * 10))}
                yMax={100}
                format={(v) => `${v.toFixed(0)}%`}
                refLines={[{ value: 90, label: 'Target 90%' }]}
                shadeFrom={nHist}
                shadeLabel="Forecast"
                series={[
                  { name: 'Availability', color: 'var(--c1)', values: [...weekly, ...Array(13).fill(null)] },
                  { name: 'Forecast', color: 'var(--c1)', dashed: true, values: [...Array(nHist - 1).fill(null), weekly[nHist - 1], ...fc.forecast] },
                ]}
                band={{ lower: [...Array(nHist).fill(null), ...fc.forecast.map((v, i) => Math.max(0, v - fc.band[i]))], upper: [...Array(nHist).fill(null), ...fc.forecast.map((v, i) => Math.min(100, v + fc.band[i]))], color: 'var(--c1)' }}
              />
            </ChartCard>
          </div>

          <ChartCard
            title="Condition trend"
            subtitle={`${p.label} (${p.unit}) — last ${tail.length} readings with warning and critical limits (FR-13)`}
            actions={
              <select className="field !w-auto" value={param} onChange={(e) => setParam(e.target.value as ParamKey)} aria-label="Parameter">
                {PARAMS.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.label}
                  </option>
                ))}
              </select>
            }
            table={{ head: ['Date', `${p.label} (${p.unit})`, 'Hour meter'], rows: tail.map((r) => [fmtDateTime(r.at), r.values[param] ?? '—', r.hourMeter]).reverse() }}
          >
            {tail.length < 2 ? (
              <Empty icon="pencil" title="Not enough readings yet" />
            ) : (
              <LineChart
                labels={tail.map((r) => new Date(r.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}
                height={220}
                format={(v) => (p.unit === 'bar' && v < 10 ? v.toFixed(1) : v.toFixed(0))}
                refLines={[
                  { value: lim.warning, label: `Warning ${lim.warning}`, color: 'var(--risk-medium)' },
                  { value: lim.critical, label: `Critical ${lim.critical}`, color: 'var(--risk-critical)' },
                ]}
                series={[{ name: p.label, color: 'var(--c1)', values: tail.map((r) => r.values[param] ?? null) }]}
              />
            )}
            {lastFindings.length > 0 && (
              <div className="flex flex-col gap-1">
                {lastFindings.map((f, i) => (
                  <div key={i} className={`caveat ${f.severity === 'critical' ? 'notice-danger' : ''}`}>
                    <Icon name="alert" size={14} className={f.severity === 'critical' ? 'text-danger' : 'text-ink-2'} />
                    <span>
                      Latest reading: {f.message}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </ChartCard>

          {eps.length > 0 && (
            <section className="card p-4">
              <h3 className="text-[13.5px] font-semibold mb-2">Failure events</h3>
              <div className="scroll-area max-h-[260px]">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Started</th>
                      <th>Failure code</th>
                      <th className="num">Duration</th>
                      {MTTR_BUCKETS.map((b) => (
                        <th key={b} className="num">
                          {b}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...eps].reverse().map((e) => (
                      <tr key={e.id}>
                        <td>
                          {fmtDateTime(e.start)}
                          {e.migrated && <span className="text-[11px] text-ink-3"> · approx.</span>}
                          {e.end === null && <span className="text-[11px] text-danger"> · ongoing</span>}
                        </td>
                        <td>{e.failureCode ?? '—'}</td>
                        <td className="num">{fmtHours(e.hours)}</td>
                        {MTTR_BUCKETS.map((b) => (
                          <td key={b} className="num text-ink-2">
                            {e.buckets[b] ? e.buckets[b].toFixed(1) : '·'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      <section className="card p-4 flex flex-col gap-3">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[13.5px] font-semibold">Unit timeline</h3>
          <div className="segmented" role="group" aria-label="Timeline filter">
            {(
              [
                ['all', 'All'],
                ['status', 'Status'],
                ['alerts', 'Alerts'],
                ['wo', 'Work orders'],
                ['lab', 'Oil & NDT'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} aria-pressed={tl === k} onClick={() => setTl(k)}>
                {l}
              </button>
            ))}
          </div>
        </header>
        <ol className="flex flex-col">
          {items.map((it, i) => (
            <li key={i} className="grid grid-cols-[110px_22px_1fr] gap-2 py-1.5 border-b border-line last:border-0">
              <span className="text-[11.5px] text-ink-3 tnum pt-0.5">{fmtDateTime(it.at)}</span>
              <Icon name={it.icon} size={15} className="text-ink-3 mt-0.5" />
              <div className="min-w-0">
                <div className="text-[12.5px]">{it.title}</div>
                {it.detail && <div className="text-[11.5px] text-ink-3">{it.detail}</div>}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}

function RiskMeter({ score }: { score: number }) {
  const r = 30
  const c = 2 * Math.PI * r
  const color = score >= 70 ? 'var(--risk-critical)' : score >= 50 ? 'var(--risk-high)' : score >= 30 ? 'var(--risk-medium)' : 'var(--risk-low)'
  return (
    <svg width="76" height="76" viewBox="0 0 76 76" role="img" aria-label={`Risk score ${score} of 100`}>
      <circle cx="38" cy="38" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="8" />
      <circle cx="38" cy="38" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 38 38)" />
      <text x="38" y="43" textAnchor="middle" fontSize="18" fontWeight="600" fill="var(--ink)">
        {score}
      </text>
    </svg>
  )
}
