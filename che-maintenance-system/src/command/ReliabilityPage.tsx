// Maintainability and reliability analysis: MTTR breakdown (FR-38), top
// downtime contributors (FR-40), repeat failures (FR-14) and the aging &
// replacement outlook (FR-41).

import { useState } from 'react'
import { DAY, FAILURE_CODES, LOCATIONS, MTTR_BUCKETS } from '../domain/constants.ts'
import { pareto, weekEnd, type Episode } from '../domain/kpi.ts'
import { useNav } from '../shell/nav.tsx'
import { useStore } from '../store.tsx'
import { Caveat, RiskBadge } from '../ui/badges.tsx'
import { BarList, ChartCard, StackedBars } from '../ui/charts.tsx'
import { downloadCsv, fmtHours, fmtPct, fmtPhp } from '../ui/format.ts'
import { Icon } from '../ui/Icon.tsx'

const BUCKET_COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)']

type Dim = 'code' | 'unit' | 'model' | 'location'

export function ReliabilityPage() {
  const { d, data, now, rollupFor } = useStore()
  const nav = useNav()
  const [dim, setDim] = useState<Dim>('code')
  const [metric, setMetric] = useState<'hours' | 'events'>('hours')
  const from = d.weeks[0]
  const to = weekEnd(d.weeks[d.weeks.length - 1])

  const activeIds = new Set(d.activeUnits.map((u) => u.assetId))
  const eps = d.allEpisodes.filter((e) => activeIds.has(e.assetId))

  const keyOf: Record<Dim, (e: Episode) => string> = {
    code: (e) => e.failureCode ?? 'Uncoded',
    unit: (e) => e.assetId,
    model: (e) => {
      const u = d.unitById.get(e.assetId)!
      return `${u.make} ${u.model}`
    },
    location: (e) => d.unitById.get(e.assetId)!.location,
  }
  const rows = pareto(eps, keyOf[dim], from, to)
    .sort((a, b) => (metric === 'hours' ? b.downtimeH - a.downtimeH : b.events - a.events))
    .slice(0, 10)
  const codeLabel = (k: string) => FAILURE_CODES.find((f) => f.code === k)?.label

  const mttrRows = LOCATIONS.map((l) => {
    const r = rollupFor(d.activeUnits.filter((u) => u.location === l), l).rolling
    return { label: l, values: MTTR_BUCKETS.map((b) => (r.closedEvents ? r.buckets[b] / r.closedEvents : 0)) }
  }).filter((r) => r.values.some((v) => v > 0))
  const fleetR = rollupFor(d.activeUnits, 'Nationwide').rolling

  // MTTR by component (from failure code)
  const byComponent = (() => {
    const m = new Map<string, { h: number; n: number }>()
    for (const e of eps) {
      if (e.end === null || e.start < from || e.start >= to) continue
      const comp = FAILURE_CODES.find((f) => f.code === e.failureCode)?.component ?? 'Uncoded'
      const x = m.get(comp) ?? { h: 0, n: 0 }
      x.h += e.hours
      x.n++
      m.set(comp, x)
    }
    return [...m.entries()].map(([k, v]) => ({ k, mttr: v.h / v.n, n: v.n })).sort((a, b) => b.mttr - a.mttr)
  })()

  // Repeat failures: units with ≥ 2 events within 8 weeks
  const repeats = d.activeUnits
    .map((u) => ({ u, r: d.rel.get(u.assetId)!.rolling }))
    .filter((x) => x.r.repeatFailures > 0)
    .sort((a, b) => b.r.failureEvents - a.r.failureEvents)

  // Aging & replacement outlook (FR-41): age, rolling availability, MTBF trend, corrective cost
  const aging = (() => {
    const yearAgo = now - 365 * DAY
    const half = from + (to - from) / 2
    return d.activeUnits
      .map((u) => {
        const r = d.rel.get(u.assetId)!.rolling
        const age = new Date(now).getFullYear() - u.year
        const cost = data.workOrders.filter((w) => w.assetId === u.assetId && w.kind === 'Corrective' && w.openedAt >= yearAgo).reduce((s, w) => s + w.cost, 0)
        const uEps = (d.episodesByUnit.get(u.assetId) ?? []).filter((e) => e.start >= from && e.start < to)
        const first = uEps.filter((e) => e.start < half).length
        const second = uEps.filter((e) => e.start >= half).length
        const trend = second - first // more failures recently = worsening MTBF
        const score = Math.min(100, Math.round(Math.min(age, 20) * 2 + Math.max(0, 95 - (r.availabilityPct ?? 100)) * 3 + Math.max(0, trend) * 8 + Math.min(cost / 20000, 25)))
        return { u, age, avail: r.availabilityPct, cost, trend, score }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
  })()

  const exportAging = () =>
    downloadCsv('aging-replacement-outlook.csv', [['Asset', 'Location', 'Type', 'Age (y)', 'Availability 13w %', 'Failure trend (2nd half − 1st half)', 'Corrective cost 12m PHP', 'Replacement score'], ...aging.map((x) => [x.u.assetId, x.u.location, x.u.type, x.age, x.avail?.toFixed(1) ?? '', x.trend, x.cost, x.score])])

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        {MTTR_BUCKETS.map((b, i) => (
          <div key={b} className="card p-3">
            <div className="flex items-center gap-1.5 text-[12px] text-ink-2">
              <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: BUCKET_COLORS[i] }} />
              {b}
            </div>
            <div className="text-[20px] font-semibold tnum mt-0.5">{fleetR.closedEvents ? fmtHours(fleetR.buckets[b] / fleetR.closedEvents) : '—'}</div>
            <div className="text-[11px] text-ink-3">avg per failure event · {fleetR.restorationH ? fmtPct((fleetR.buckets[b] / fleetR.restorationH) * 100, 0) : '—'} of MTTR</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="MTTR breakdown by location"
          subtitle="Average hours per closed failure event, split by restoration stage from status timestamps (FR-38)"
          table={{ head: ['Location', ...MTTR_BUCKETS, 'MTTR'], rows: mttrRows.map((r) => [r.label, ...r.values.map((v) => v.toFixed(1)), r.values.reduce((s, v) => s + v, 0).toFixed(1)]) }}
        >
          <StackedBars rows={mttrRows} keys={MTTR_BUCKETS} colors={BUCKET_COLORS} format={(v) => `${v.toFixed(1)} h`} />
        </ChartCard>

        <ChartCard
          title="Top downtime contributors"
          subtitle={`Ranked by ${metric === 'hours' ? 'downtime hours' : 'failure events'} — not down-week counts (FR-40) · rolling 13 weeks`}
          actions={
            <>
              <select className="field !w-auto" value={dim} onChange={(e) => setDim(e.target.value as Dim)} aria-label="Group by">
                <option value="code">Failure code</option>
                <option value="unit">Unit</option>
                <option value="model">Model</option>
                <option value="location">Location</option>
              </select>
              <div className="segmented">
                <button aria-pressed={metric === 'hours'} onClick={() => setMetric('hours')}>
                  Hours
                </button>
                <button aria-pressed={metric === 'events'} onClick={() => setMetric('events')}>
                  Events
                </button>
              </div>
            </>
          }
          table={{ head: ['Key', 'Downtime h', 'Events'], rows: rows.map((r) => [dim === 'code' ? `${r.key} ${codeLabel(r.key) ?? ''}` : r.key, r.downtimeH.toFixed(1), r.events]) }}
        >
          <BarList
            color="var(--c1)"
            format={(v) => (metric === 'hours' ? `${v.toFixed(0)} h` : `${v}`)}
            rows={rows.map((r) => ({
              key: r.key,
              label: dim === 'code' ? `${r.key} · ${codeLabel(r.key) ?? ''}` : r.key,
              value: metric === 'hours' ? r.downtimeH : r.events,
              detail: metric === 'hours' ? `${r.events} events` : `${r.downtimeH.toFixed(0)} h`,
              onClick: dim === 'unit' ? () => nav.openUnit(r.key) : dim === 'location' ? () => nav.go({ page: 'board', filter: r.key }) : undefined,
            }))}
          />
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <section className="card p-4 flex flex-col gap-2">
          <h3 className="text-[13.5px] font-semibold">MTTR by component</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Component</th>
                <th className="num">Events</th>
                <th className="num">MTTR</th>
              </tr>
            </thead>
            <tbody>
              {byComponent.map((c) => (
                <tr key={c.k}>
                  <td>{c.k}</td>
                  <td className="num">{c.n}</td>
                  <td className="num">{fmtHours(c.mttr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 className="text-[13.5px] font-semibold mt-3">Repeat failures (2+ events in 8 weeks)</h3>
          <div className="text-[12px] text-ink-3 -mt-1">Signals an ineffective repair · fleet repeat rate {fmtPct(fleetR.repeatRatePct, 0)}</div>
          {repeats.length === 0 ? (
            <div className="text-ink-3">None in the window.</div>
          ) : (
            <table className="table">
              <tbody>
                {repeats.map(({ u, r }) => (
                  <tr key={u.assetId} className="clickable" onClick={() => nav.openUnit(u.assetId)}>
                    <td>
                      <b>{u.assetId}</b> <span className="text-ink-3">· {u.location}</span>
                    </td>
                    <td className="num">{r.failureEvents} events</td>
                    <td className="num">{r.repeatFailures} repeat</td>
                    <td className="num">{fmtPct(r.availabilityPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card p-4 flex flex-col gap-2">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-[13.5px] font-semibold">Aging & replacement outlook</h3>
              <div className="text-[12px] text-ink-3">Age, rolling availability, failure trend and 12-month corrective cost combined into a replacement score (FR-41)</div>
            </div>
            <button className="btn" onClick={exportAging}>
              <Icon name="download" size={14} /> CSV
            </button>
          </header>
          <div className="scroll-area">
            <table className="table">
              <thead>
                <tr>
                  <th>Unit</th>
                  <th className="num">Age</th>
                  <th className="num">Avail. 13w</th>
                  <th className="num">Failure trend</th>
                  <th className="num">Corrective 12m</th>
                  <th>Risk</th>
                  <th className="num">Score</th>
                </tr>
              </thead>
              <tbody>
                {aging.map((x) => (
                  <tr key={x.u.assetId} className="clickable" onClick={() => nav.openUnit(x.u.assetId)}>
                    <td>
                      <b>{x.u.assetId}</b>
                      <div className="text-[11px] text-ink-3">
                        {x.u.type} · {x.u.location}
                      </div>
                    </td>
                    <td className="num">{x.age} y</td>
                    <td className="num">{fmtPct(x.avail)}</td>
                    <td className="num" style={{ color: x.trend > 0 ? 'var(--danger)' : undefined }}>
                      {x.trend > 0 ? `▲ +${x.trend}` : x.trend < 0 ? `▼ ${x.trend}` : '—'}
                    </td>
                    <td className="num">{fmtPhp(x.cost)}</td>
                    <td>
                      <RiskBadge level={d.scores.get(x.u.assetId)?.level ?? null} />
                    </td>
                    <td className="num font-semibold">{x.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Caveat>Replacement score weights are an initial proposal for BPA and the Asset Maintenance Manager to confirm; corrective cost sums EMMS corrective work orders from the last 12 months (the simulated history covers about 22 weeks).</Caveat>
        </section>
      </div>
    </div>
  )
}
