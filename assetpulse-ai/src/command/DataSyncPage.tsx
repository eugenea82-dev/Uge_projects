// EMMS import status and exception list (FR-03), data-quality view per branch
// (NFR-D02) and YardPulse migration status (FR-45).

import { DAY, HOUR, LOCATIONS } from '../domain/constants.ts'
import { currentStatus } from '../domain/kpi.ts'
import { useNav } from '../shell/nav.tsx'
import { useStore } from '../store.tsx'
import { Caveat } from '../ui/badges.tsx'
import { fmtAgo, fmtDate, fmtDateTime, fmtPct } from '../ui/format.ts'
import { Icon } from '../ui/Icon.tsx'

export function DataSyncPage() {
  const { data, d, now, can, runBatch } = useStore()
  const nav = useNav()
  const from = d.weeks[0]

  const quality = LOCATIONS.map((l) => {
    const units = d.activeUnits.filter((u) => u.location === l)
    const eps = units.flatMap((u) => d.episodesByUnit.get(u.assetId) ?? []).filter((e) => e.start >= from)
    const coded = eps.filter((e) => e.failureCode).length
    const hourly = eps.filter((e) => !e.migrated).length
    let opDays = 0
    let captured = 0
    for (const u of units) {
      const evs = d.eventsByUnit.get(u.assetId) ?? []
      const rds = d.readingsByUnit.get(u.assetId) ?? []
      for (let k = 1; k <= 30; k++) {
        const day = new Date(now - k * DAY).setHours(0, 0, 0, 0)
        if (currentStatus(evs, day + 6 * HOUR)?.status !== 'OPERATIONAL') continue
        opDays++
        if (rds.some((r) => r.at >= day && r.at < day + DAY)) captured++
      }
    }
    return { l, events: eps.length, codedPct: eps.length ? (coded / eps.length) * 100 : null, hourlyPct: eps.length ? (hourly / eps.length) * 100 : null, capturePct: opDays ? (captured / opDays) * 100 : null }
  })

  const stale = now - data.sync.scoringLastRun > 26 * HOUR
  const tone = (v: number | null, target: number) => (v === null ? undefined : v >= target ? 'var(--ok-ink)' : 'var(--danger)')

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-3">
        <section className="card p-4 flex flex-col gap-1">
          <div className="label">EMMS import</div>
          <div className="text-[17px] font-semibold">{fmtDateTime(data.sync.emmsLastSync)}</div>
          <div className="text-[12px] text-ink-3">{fmtAgo(data.sync.emmsLastSync, now)} · daily, read-only service account (NFR-S05) · method pending IT (D-01)</div>
        </section>
        <section className="card p-4 flex flex-col gap-1">
          <div className="label">KPI & risk scoring run</div>
          <div className="text-[17px] font-semibold" style={{ color: stale ? 'var(--danger)' : undefined }}>
            {fmtDateTime(data.sync.scoringLastRun)}
          </div>
          <div className="text-[12px] text-ink-3">{stale ? 'Older than 26 h — stale-data warning shown on dashboards' : 'Within 26 h freshness window (NFR-C04)'}</div>
        </section>
        <section className="card p-4 flex flex-col gap-2 justify-between">
          <div>
            <div className="label">Manual run</div>
            <div className="text-[12px] text-ink-3">Simulates the nightly batch: import → KPIs → risk scores → alerts → stalled-restoration check.</div>
          </div>
          <button
            className="btn btn-primary self-start"
            disabled={!can('runBatch')}
            onClick={() => {
              const r = runBatch()
              nav.toast(`Batch complete — ${r.scored} units processed, ${r.created} new alert${r.created === 1 ? '' : 's'}.`)
            }}
          >
            <Icon name="sync" size={14} /> Run nightly batch now
          </button>
        </section>
      </div>

      <section className="card p-4 flex flex-col gap-2">
        <h3 className="text-[13.5px] font-semibold">EMMS exception list · {data.sync.exceptions.length}</h3>
        <div className="text-[12px] text-ink-3">Records that could not be matched to a unit by asset ID. They are held here — never dropped or re-keyed by hand (FR-03, AC-10).</div>
        <table className="table">
          <thead>
            <tr>
              <th>EMMS record</th>
              <th>Asset ID received</th>
              <th>Reason</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {data.sync.exceptions.map((x) => (
              <tr key={x.recordId}>
                <td>{x.recordId}</td>
                <td className="font-mono">{x.assetId}</td>
                <td>{x.reason}</td>
                <td className="text-ink-3">Fix asset ID in EMMS; re-imported on next sync</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card p-4 flex flex-col gap-2">
        <h3 className="text-[13.5px] font-semibold">Data quality by branch</h3>
        <div className="text-[12px] text-ink-3">Prediction quality depends on these. Targets from BO-06 (by month 3): 100% coded failure events with hour-level timestamps; readings on every operating day (R-02).</div>
        <div className="scroll-area">
          <table className="table">
            <thead>
              <tr>
                <th>Location</th>
                <th className="num">Failure events (13 wk)</th>
                <th className="num">With failure code</th>
                <th className="num">With hour-level timestamps</th>
                <th className="num">Operating days with readings (30 d)</th>
              </tr>
            </thead>
            <tbody>
              {quality.map((q) => (
                <tr key={q.l} className="clickable" onClick={() => nav.go({ page: 'board', filter: q.l })}>
                  <td className="font-medium">{q.l}</td>
                  <td className="num">{q.events}</td>
                  <td className="num" style={{ color: tone(q.codedPct, 100) }}>
                    {fmtPct(q.codedPct, 0)}
                  </td>
                  <td className="num" style={{ color: tone(q.hourlyPct, 100) }}>
                    {fmtPct(q.hourlyPct, 0)}
                  </td>
                  <td className="num" style={{ color: tone(q.capturePct, 90) }}>
                    {fmtPct(q.capturePct, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card p-4 flex flex-col gap-2">
        <h3 className="text-[13.5px] font-semibold">YardPulse migration (FR-45)</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <div className="label">Hour-level capture since</div>
            <div className="font-semibold">{fmtDate(data.cutover)}</div>
          </div>
          <div>
            <div className="label">Migrated history</div>
            <div className="font-semibold">Weekly snapshots before cutover</div>
          </div>
          <div>
            <div className="label">Parallel run</div>
            <div className="font-semibold">4 weeks · reconciliation pending</div>
          </div>
        </div>
        <Caveat>Migrated weeks carry the YardPulse convention (status at the weekly snapshot applied to the whole week). They are used for baseline and trend only — never as hour-level failure data for model training (C-05). Import of the three YardPulse paste formats (native wide, short, legacy) is specified for the build phase (NFR-K04).</Caveat>
      </section>
    </div>
  )
}
