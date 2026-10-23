// PM compliance tracker (FR-44, BO-07) and planned-maintenance ratio (BO-05).

import { LOCATIONS } from '../domain/constants.ts'
import { plannedRatio, pmCompliance } from '../domain/kpi.ts'
import { useNav } from '../shell/nav.tsx'
import { useStore } from '../store.tsx'
import { BarList, ChartCard } from '../ui/charts.tsx'
import { downloadCsv, fmtDate, fmtDuration, fmtPct } from '../ui/format.ts'
import { Icon } from '../ui/Icon.tsx'
import { StatTile } from '../ui/StatTile.tsx'

export function PmPage() {
  const { data, d, now } = useStore()
  const nav = useNav()
  const from = d.weeks[0]
  const active = new Set(d.activeUnits.map((u) => u.assetId))
  const wos = data.workOrders.filter((w) => active.has(w.assetId))
  const all = pmCompliance(wos, from, now)
  const planned = plannedRatio(wos, from)
  const byLoc = LOCATIONS.map((l) => {
    const ids = new Set(d.activeUnits.filter((u) => u.location === l).map((u) => u.assetId))
    return { l, pm: pmCompliance(wos.filter((w) => ids.has(w.assetId)), from, now) }
  })
  const upcoming = wos.filter((w) => w.kind === 'PM' && w.dueAt && w.dueAt > now && w.dueAt < now + 14 * 86_400_000 && !w.closedAt).sort((a, b) => a.dueAt! - b.dueAt!)

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        <StatTile label="PM compliance · 13 wk" value={fmtPct(all.pct)} sub="on schedule ÷ scheduled · target ≥ 95%" tone={(all.pct ?? 0) >= 95 ? 'ok' : 'warn'} icon="calendar" />
        <StatTile label="Scheduled PMs" value={all.scheduled} sub={`${all.onTime} on time · ${all.late} late`} icon="list" />
        <StatTile label="Overdue PMs" value={all.overdue.length} sub="due, not closed in EMMS" tone={all.overdue.length ? 'danger' : 'ok'} icon="alert" />
        <StatTile label="Planned maintenance ratio" value={fmtPct(planned)} sub="PM + predictive ÷ all WOs · target ≥ 80%" tone={(planned ?? 0) >= 80 ? 'ok' : 'warn'} icon="sliders" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="PM compliance by location" subtitle="Rolling 13 weeks · from EMMS PM work orders" table={{ head: ['Location', 'Scheduled', 'On time', 'Late', 'Overdue', 'Compliance %'], rows: byLoc.map(({ l, pm }) => [l, pm.scheduled, pm.onTime, pm.late, pm.overdue.length, fmtPct(pm.pct)]) }}>
          <BarList max={100} format={(v) => `${v.toFixed(0)}%`} rows={byLoc.map(({ l, pm }) => ({ key: l, label: l, value: pm.pct ?? 0, detail: `${pm.onTime}/${pm.scheduled} on time · ${pm.overdue.length} overdue` }))} />
        </ChartCard>
        <section className="card p-4 flex flex-col gap-2">
          <header className="flex items-center justify-between">
            <h3 className="text-[13.5px] font-semibold">Overdue PMs</h3>
            <button className="btn" onClick={() => downloadCsv('overdue-pm.csv', [['WO', 'Asset', 'Location', 'Due', 'Days overdue'], ...all.overdue.map((w) => [w.woNumber, w.assetId, d.unitById.get(w.assetId)?.location, fmtDate(w.dueAt!), ((now - w.dueAt!) / 86_400_000).toFixed(0)])])}>
              <Icon name="download" size={14} /> CSV
            </button>
          </header>
          <table className="table">
            <thead>
              <tr>
                <th>Work order</th>
                <th>Unit</th>
                <th>Due</th>
                <th className="num">Overdue</th>
              </tr>
            </thead>
            <tbody>
              {all.overdue.map((w) => (
                <tr key={w.woNumber} className="clickable" onClick={() => nav.openUnit(w.assetId)}>
                  <td>{w.woNumber}</td>
                  <td>
                    <b>{w.assetId}</b> <span className="text-ink-3">· {d.unitById.get(w.assetId)?.location}</span>
                  </td>
                  <td>{fmtDate(w.dueAt!)}</td>
                  <td className="num text-danger">{fmtDuration(now - w.dueAt!)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 className="text-[13.5px] font-semibold mt-3">Due in the next 14 days · {upcoming.length}</h3>
          <div className="flex flex-wrap gap-1.5">
            {upcoming.slice(0, 30).map((w) => (
              <button key={w.woNumber} className="chip" onClick={() => nav.openUnit(w.assetId)} title={w.woNumber}>
                {w.assetId} · {fmtDate(w.dueAt!)}
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
