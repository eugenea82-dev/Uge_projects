// Command Center (FR-26): nationwide fleet health for the Asset Maintenance Manager.

import { useMemo } from 'react'
import { isOverdue, predictionPerformance } from '../domain/alerts.ts'
import { HOUR, LOCATIONS, RISK_LEVELS, RISK_META, STALLED_LIMIT_HOURS, STATUS_ORDER, STATUSES } from '../domain/constants.ts'
import { holtDamped } from '../domain/forecast.ts'
import { isoWeek, plannedRatio, pmCompliance } from '../domain/kpi.ts'
import { useNav } from '../shell/nav.tsx'
import { useStore } from '../store.tsx'
import { Caveat, RiskBadge, StatusBadge, StatusDot } from '../ui/badges.tsx'
import { ChartCard, DistributionBar, LineChart, Sparkline } from '../ui/charts.tsx'
import { fmtAgo, fmtHours, fmtNum, fmtPct } from '../ui/format.ts'
import { Icon } from '../ui/Icon.tsx'
import { StatTile } from '../ui/StatTile.tsx'

export function CommandOverview() {
  const { d, data, now, rollupFor, runBatch, can } = useStore()
  const nav = useNav()
  const fleet = rollupFor(d.activeUnits, 'Nationwide')
  const k = fleet.rolling
  const weekly = fleet.weekly.map((w) => w.availabilityPct ?? 100)
  const fc = holtDamped(weekly, 13)
  const nHist = weekly.length
  const labels = [...d.weeks.map((w) => `W${isoWeek(w)}`), ...fc.forecast.map((_, i) => `W${isoWeek(d.weeks[nHist - 1] + (i + 1) * 7 * 86_400_000)}`)]
  const migratedWeeks = d.weeks.filter((w) => w < data.cutover).length

  const locRows = useMemo(
    () =>
      LOCATIONS.map((l) => {
        const units = d.activeUnits.filter((u) => u.location === l)
        const r = rollupFor(units, l)
        const downNow = units.filter((u) => d.rel.get(u.assetId)?.currentStatus?.status !== 'OPERATIONAL').length
        const atRisk = units.filter((u) => ['High', 'Critical'].includes(d.scores.get(u.assetId)?.level ?? '')).length
        return { l, r, downNow, atRisk }
      }),
    [d, rollupFor],
  )
  const sumReq = locRows.reduce((s, x) => s + x.r.rolling.requiredH, 0)
  const sumTech = locRows.reduce((s, x) => s + x.r.rolling.techH, 0)
  const reconciles = Math.abs(sumReq - k.requiredH) < 1e-6 && Math.abs(sumTech - k.techH) < 1e-6

  const pm = pmCompliance(data.workOrders, d.weeks[0], now)
  const planned = plannedRatio(data.workOrders, d.weeks[0])
  const open = data.alerts.filter((a) => a.status !== 'Closed')
  const pendingAuth = open.filter((a) => a.authorization?.state === 'Pending')
  const overdue = open.filter((a) => isOverdue(a, now))
  const eligible = d.allEpisodes.filter((e) => !e.migrated && e.start >= data.cutover)
  const perf = predictionPerformance(data.alerts, eligible.length, eligible.filter((e) => data.precededEpisodes.includes(e.id)).length)

  const statusParts = STATUS_ORDER.filter((s) => s !== 'FOR_DISPOSAL').map((s) => ({ key: s, label: STATUSES[s].label, color: `var(${STATUSES[s].colorVar})`, value: d.activeUnits.filter((u) => d.rel.get(u.assetId)?.currentStatus?.status === s).length }))
  const down = d.activeUnits
    .map((u) => ({ u, cs: d.rel.get(u.assetId)!.currentStatus! }))
    .filter((x) => x.cs.status !== 'OPERATIONAL')
    .sort((a, b) => a.cs.at - b.cs.at)
  const atRisk = d.activeUnits
    .map((u) => ({ u, s: d.scores.get(u.assetId) }))
    .filter((x) => x.s?.level === 'Critical' || x.s?.level === 'High')
    .sort((a, b) => b.s!.score - a.s!.score)
  const riskCounts = RISK_LEVELS.map((l) => ({ l, n: d.activeUnits.filter((u) => d.scores.get(u.assetId)?.level === l).length }))
  const noScore = d.activeUnits.filter((u) => d.scores.get(u.assetId) && !d.scores.get(u.assetId)!.level).length

  const target = 90
  const avail = k.availabilityPct ?? 0

  return (
    <div className="flex flex-col gap-4">
      {/* Hero row */}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)]">
        <section className="card p-5 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-medium text-ink-2">Fleet availability · rolling 13 weeks</span>
            <span className="chip">
              <Icon name="target" size={12} /> Target ≥ {target}% (BO-03)
            </span>
          </div>
          <div className="flex items-end gap-3">
            <div className="text-[56px] leading-none font-semibold tracking-tight tnum">{fmtPct(k.availabilityPct)}</div>
            <div className="pb-1.5 text-[13px]" style={{ color: avail >= target ? 'var(--ok-ink)' : 'var(--danger)' }}>
              {avail >= target ? '▲' : '▼'} {Math.abs(avail - target).toFixed(1)} pts vs target
            </div>
          </div>
          <div className="text-[12px] text-ink-3 tnum">
            {fleet.units} active units · 12 locations · last week {fmtPct(fleet.weekly.at(-1)?.availabilityPct)} · inherent {fmtPct(k.inherentAvailabilityPct)}
          </div>
          <div className="flex flex-col gap-1.5">
            <DistributionBar parts={statusParts} />
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {statusParts
                .filter((p) => p.value > 0)
                .map((p) => (
                  <span key={p.key} className="inline-flex items-center gap-1 text-[11.5px] text-ink-2">
                    <StatusDot status={p.key} size={12} /> {STATUSES[p.key].short} <b className="text-ink tnum">{p.value}</b>
                  </span>
                ))}
            </div>
          </div>
        </section>

        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <StatTile label="MTBF" value={fmtHours(k.mtbfH)} sub="operating h between failures" icon="clock" onClick={() => nav.go({ page: 'reliability' })} />
          <StatTile label="MTTR" value={fmtHours(k.mttrH)} sub={`parts delay avg ${fmtHours(k.partsDelayH)}`} icon="wrench" onClick={() => nav.go({ page: 'reliability' })} />
          <StatTile label="Failure events" value={k.failureEvents} sub={`${fmtPct(k.repeatRatePct, 0)} repeat failures`} tone={(k.repeatRatePct ?? 0) > 15 ? 'danger' : undefined} icon="alert" />
          <StatTile label="Technical downtime" value={fmtHours(k.techH)} sub={`+ ${fmtHours(k.extH)} operational constraint`} icon="stop" />
          <StatTile label="PM compliance" value={fmtPct(pm.pct)} sub={`${pm.overdue.length} overdue · target ≥ 95%`} tone={(pm.pct ?? 0) >= 95 ? 'ok' : 'warn'} icon="calendar" onClick={() => nav.go({ page: 'pm' })} />
          <StatTile label="Planned maintenance" value={fmtPct(planned)} sub="PM + predictive ÷ all WOs · target ≥ 80%" tone={(planned ?? 0) >= 80 ? 'ok' : 'warn'} icon="sliders" />
          <StatTile label="Open alerts" value={open.length} sub={`${pendingAuth.length} await your authorization · ${overdue.length} past SLA`} tone={pendingAuth.length || overdue.length ? 'danger' : undefined} icon="bell" onClick={() => nav.go({ page: 'alerts' })} />
          <StatTile label="Alert precision / recall" value={`${fmtPct(perf.precisionPct, 0)} / ${fmtPct(perf.recallPct, 0)}`} sub="targets ≥ 60% / ≥ 70% (BO-04)" tone={(perf.precisionPct ?? 0) >= 60 && (perf.recallPct ?? 0) >= 70 ? 'ok' : 'warn'} icon="pulse" onClick={() => nav.go({ page: 'performance' })} />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <ChartCard
          title="Nationwide availability — weekly, with 13-week forecast"
          subtitle="Time-weighted from hour-level status; forecast by Holt damped trend (benchmark per NFR-M06)"
          table={{ head: ['Week', 'Availability %', 'Technical downtime h', 'Failure events', 'Constraint h'], rows: fleet.weekly.map((w, i) => [labels[i] + (i < migratedWeeks ? ' (approx.)' : ''), fmtPct(w.availabilityPct), w.techH.toFixed(0), w.failureEvents, w.extH.toFixed(0)]) }}
        >
          <LineChart
            labels={labels}
            height={240}
            yMin={Math.max(0, Math.floor(Math.min(target, ...weekly, ...fc.forecast.map((v, i) => v - fc.band[i])) - 2))}
            yMax={100}
            format={(v) => `${v.toFixed(0)}%`}
            refLines={[{ value: target, label: `Target ${target}%` }]}
            shadeFrom={nHist}
            shadeLabel="Forecast (estimate)"
            series={[
              { name: 'Availability', color: 'var(--c1)', values: [...weekly, ...Array(13).fill(null)] },
              { name: 'Forecast', color: 'var(--c1)', dashed: true, values: [...Array(nHist - 1).fill(null), weekly[nHist - 1], ...fc.forecast] },
            ]}
            band={{ lower: [...Array(nHist).fill(null), ...fc.forecast.map((v, i) => Math.max(0, v - fc.band[i]))], upper: [...Array(nHist).fill(null), ...fc.forecast.map((v, i) => Math.min(100, v + fc.band[i]))], color: 'var(--c1)' }}
          />
          {migratedWeeks > 0 && <Caveat>The first {migratedWeeks} weeks are migrated from YardPulse weekly snapshots — approximations that miss failures recovered within a week (C-05, NFR-U07).</Caveat>}
        </ChartCard>

        <section className="card p-4 flex flex-col gap-3">
          <header className="flex items-center justify-between">
            <h3 className="text-[13.5px] font-semibold">Units at risk</h3>
            <span className="text-[11.5px] text-ink-3">30-day horizon · rules-v0.1</span>
          </header>
          <div className="grid grid-cols-5 gap-1.5 text-center">
            {riskCounts.map(({ l, n }) => (
              <button key={l} className="rounded-lg p-2 bg-surface-2 hover:brightness-95" onClick={() => nav.go({ page: 'board' })}>
                <div className="text-[18px] font-semibold tnum">{n}</div>
                <div className="text-[11px] text-ink-2 inline-flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full" style={{ background: `var(${RISK_META[l].colorVar})` }} />
                  {l}
                </div>
              </button>
            ))}
            <div className="rounded-lg p-2 bg-surface-2" title="Not enough readings in the last 30 days (FR-16)">
              <div className="text-[18px] font-semibold tnum">{noScore}</div>
              <div className="text-[11px] text-ink-2">No score</div>
            </div>
          </div>
          <div className="scroll-area max-h-[230px] flex flex-col">
            {atRisk.length === 0 && <div className="text-ink-3 py-3">No High or Critical units.</div>}
            {atRisk.map(({ u, s }) => (
              <button key={u.assetId} className="flex items-center justify-between gap-2 py-1.5 border-b border-line last:border-0 text-left" onClick={() => nav.openUnit(u.assetId)}>
                <div className="min-w-0">
                  <div className="font-semibold">
                    {u.assetId} <span className="font-normal text-ink-3">· {u.location}</span>
                  </div>
                  <div className="text-[11.5px] text-ink-3 truncate">{s!.factors[0]?.label}</div>
                </div>
                <RiskBadge level={s!.level} score={s!.score} />
              </button>
            ))}
          </div>
        </section>
      </div>

      <section className="card p-4 flex flex-col gap-2">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-[13.5px] font-semibold">Location roll-up · rolling 13 weeks</h3>
            <div className="text-[12px] text-ink-3">Every figure is summed from unit hours and counts, so locations reconcile exactly with nationwide (FR-37, AC-03)</div>
          </div>
          <span className="chip" style={{ color: reconciles ? 'var(--ok-ink)' : 'var(--danger)' }}>
            <Icon name={reconciles ? 'check' : 'alert'} size={12} /> {reconciles ? 'Σ locations = nationwide' : 'Reconciliation mismatch'}
          </span>
        </header>
        <div className="scroll-area">
          <table className="table">
            <thead>
              <tr>
                <th>Location</th>
                <th className="num">Units</th>
                <th className="num">Down now</th>
                <th className="num">Availability</th>
                <th>13-week trend</th>
                <th className="num">Failure events</th>
                <th className="num">MTBF</th>
                <th className="num">MTTR</th>
                <th className="num">Constraint h</th>
                <th className="num">High/Crit.</th>
              </tr>
            </thead>
            <tbody>
              {locRows.map(({ l, r, downNow, atRisk: ar }) => (
                <tr key={l} className="clickable" onClick={() => nav.go({ page: 'board', filter: l })}>
                  <td className="font-medium">{l}</td>
                  <td className="num">{r.units}</td>
                  <td className="num">{downNow || '·'}</td>
                  <td className="num font-semibold" style={{ color: (r.rolling.availabilityPct ?? 100) < 85 ? 'var(--danger)' : undefined }}>
                    {fmtPct(r.rolling.availabilityPct)}
                  </td>
                  <td>
                    <Sparkline values={r.weekly.map((w) => w.availabilityPct)} min={50} max={100} />
                  </td>
                  <td className="num">{r.rolling.failureEvents}</td>
                  <td className="num">{fmtHours(r.rolling.mtbfH)}</td>
                  <td className="num">{fmtHours(r.rolling.mttrH)}</td>
                  <td className="num">{fmtNum(r.rolling.extH)}</td>
                  <td className="num">{ar || '·'}</td>
                </tr>
              ))}
              <tr>
                <td className="font-semibold">Nationwide</td>
                <td className="num font-semibold">{fleet.units}</td>
                <td className="num font-semibold">{down.length}</td>
                <td className="num font-semibold">{fmtPct(k.availabilityPct)}</td>
                <td>
                  <Sparkline values={weekly} min={50} max={100} />
                </td>
                <td className="num font-semibold">{k.failureEvents}</td>
                <td className="num font-semibold">{fmtHours(k.mtbfH)}</td>
                <td className="num font-semibold">{fmtHours(k.mttrH)}</td>
                <td className="num font-semibold">{fmtNum(k.extH)}</td>
                <td className="num font-semibold">{atRisk.length}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="text-[11.5px] text-ink-3">Locations below 85% are highlighted (BO-03: no location below 85%). External downtime is shown as constraint hours and excluded from availability, MTBF and MTTR.</div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4 flex flex-col gap-2">
          <h3 className="text-[13.5px] font-semibold">Down now · {down.length} units</h3>
          <div className="scroll-area max-h-[280px]">
            <table className="table">
              <thead>
                <tr>
                  <th>Unit</th>
                  <th>Status</th>
                  <th className="num">Down for</th>
                </tr>
              </thead>
              <tbody>
                {down.map(({ u, cs }) => {
                  const stalled = (cs.status === 'AWAITING_PARTS' || cs.status === 'AWAITING_PO') && now - cs.at > STALLED_LIMIT_HOURS * HOUR
                  const ep = (d.episodesByUnit.get(u.assetId) ?? []).at(-1)
                  return (
                    <tr key={u.assetId} className="clickable" onClick={() => nav.openUnit(u.assetId)}>
                      <td>
                        <b>{u.assetId}</b> <span className="text-ink-3">· {u.location}</span>
                      </td>
                      <td>
                        <StatusBadge status={cs.status} cause={cs.cause} short />
                        {stalled && <span className="ml-1.5 text-[11px] text-danger">stalled</span>}
                      </td>
                      <td className="num">{ep && ep.end === null ? fmtHours((now - ep.start) / HOUR) : fmtAgo(cs.at, now)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card p-4 flex flex-col gap-3">
          <h3 className="text-[13.5px] font-semibold">Data freshness & nightly run</h3>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-surface-2 p-2.5">
              <div className="label">EMMS sync</div>
              <div className="font-semibold">{fmtAgo(data.sync.emmsLastSync, now)}</div>
              <div className="text-[11px] text-ink-3">daily, complete by 06:00 · {data.sync.mode === 'api' ? 'EMMS API' : 'simulated EMMS'}</div>
            </div>
            <div className="rounded-lg bg-surface-2 p-2.5">
              <div className="label">Risk scoring run</div>
              <div className="font-semibold">{fmtAgo(data.sync.scoringLastRun, now)}</div>
              <div className="text-[11px] text-ink-3">stale warning after 26 h</div>
            </div>
          </div>
          <div className="text-[12px] text-ink-2">{data.sync.exceptions.length} EMMS records are on the exception list (unmatched asset IDs).</div>
          <div className="flex flex-wrap gap-2">
            {can('runBatch') && (
              <button
                className="btn btn-primary"
                onClick={async () => {
                  const r = await runBatch()
                  nav.toast(r.error ? `EMMS import failed (${r.error}). Scores were refreshed on existing data.` : `Nightly batch complete — ${r.scored} units processed, ${r.created} new alert${r.created === 1 ? '' : 's'}.`, r.error ? 'danger' : 'ok')
                }}
              >
                <Icon name="sync" size={14} /> Run nightly batch now
              </button>
            )}
            <button className="btn" onClick={() => nav.go({ page: 'data' })}>
              Data & sync details
            </button>
          </div>
          <div className="text-[11px] text-ink-3">Release 1 has no sensor feed: scores refresh daily from EMMS history, hour meters and pre-op readings (C-01).</div>
        </section>
      </div>
    </div>
  )
}
