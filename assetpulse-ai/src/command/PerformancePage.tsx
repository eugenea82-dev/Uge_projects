// Prediction performance (FR-25) and model governance (NFR-M04 to M06).

import { useState } from 'react'
import { predictionPerformance } from '../domain/alerts.ts'
import type { EquipmentType } from '../domain/types.ts'
import { useStore } from '../store.tsx'
import { Caveat, Pill } from '../ui/badges.tsx'
import { BarList, ChartCard } from '../ui/charts.tsx'
import { fmtDate, fmtNum, fmtPct } from '../ui/format.ts'
import { Icon } from '../ui/Icon.tsx'
import { StatTile } from '../ui/StatTile.tsx'

const TYPES: EquipmentType[] = ['Reach Stacker', 'Forklift', 'Empty Container Handler', 'Yard Tractor']

export function PerformancePage() {
  const { data, d } = useStore()
  const [showRejects, setShowRejects] = useState(true)
  const eligible = d.allEpisodes.filter((e) => !e.migrated && e.start >= data.cutover && !d.rel.get(e.assetId)?.excluded)
  const preceded = new Set(data.precededEpisodes)
  const overall = predictionPerformance(data.alerts, eligible.length, eligible.filter((e) => preceded.has(e.id)).length)

  const byType = TYPES.map((t) => {
    const ids = new Set(data.units.filter((u) => u.type === t).map((u) => u.assetId))
    const eps = eligible.filter((e) => ids.has(e.assetId))
    return { t, p: predictionPerformance(data.alerts.filter((a) => ids.has(a.assetId)), eps.length, eps.filter((e) => preceded.has(e.id)).length) }
  })

  const rejects = new Map<string, number>()
  for (const a of data.alerts) if (a.decision?.type === 'reject') rejects.set(a.decision.rejectReason ?? 'Other', (rejects.get(a.decision.rejectReason ?? 'Other') ?? 0) + 1)
  const outcomes = new Map<string, number>()
  for (const a of data.alerts) if (a.outcome) outcomes.set(a.outcome.type, (outcomes.get(a.outcome.type) ?? 0) + 1)

  const ok = (overall.precisionPct ?? 0) >= 60 && (overall.recallPct ?? 0) >= 70

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        <StatTile label="Alert precision" value={fmtPct(overall.precisionPct, 0)} sub={`${overall.confirmed} confirmed of ${overall.closed} closed · target ≥ 60%`} tone={(overall.precisionPct ?? 0) >= 60 ? 'ok' : 'danger'} icon="target" />
        <StatTile label="Alert recall (≥ 7-day lead)" value={fmtPct(overall.recallPct, 0)} sub={`${overall.precededFailures} of ${overall.failures} failures · target ≥ 70%`} tone={(overall.recallPct ?? 0) >= 70 ? 'ok' : 'danger'} icon="pulse" />
        <StatTile label="Average lead time" value={overall.avgLeadDays ? `${overall.avgLeadDays.toFixed(1)} d` : '—'} sub="alert → confirmed fault" icon="clock" />
        <StatTile label="False-alarm rate" value={fmtPct(overall.falseAlarmPct, 0)} sub="closed as No fault found" tone={(overall.falseAlarmPct ?? 0) > 35 ? 'danger' : undefined} icon="alert" />
      </div>
      <Caveat>
        {ok ? 'Release 1 targets are being met.' : 'Below the Release 1 target — review thresholds and reject reasons at the monthly review.'} Recall counts hour-level failure events since hour-level capture began ({fmtDate(data.cutover)}); migrated YardPulse weeks are excluded. Historical alert outcomes in this prototype are simulated.
      </Caveat>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="card p-4 flex flex-col gap-2">
          <h3 className="text-[13.5px] font-semibold">By asset group</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Asset group</th>
                <th className="num">Closed</th>
                <th className="num">Precision</th>
                <th className="num">Failures</th>
                <th className="num">Recall</th>
                <th className="num">Lead (d)</th>
              </tr>
            </thead>
            <tbody>
              {byType.map(({ t, p }) => (
                <tr key={t}>
                  <td>{t}</td>
                  <td className="num">{p.closed}</td>
                  <td className="num">{fmtPct(p.precisionPct, 0)}</td>
                  <td className="num">{p.failures}</td>
                  <td className="num">{fmtPct(p.recallPct, 0)}</td>
                  <td className="num">{fmtNum(p.avgLeadDays, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-[11.5px] text-ink-3">NFR-M03: asset groups with fewer than 10 recorded failures stay on rule-based thresholds only.</div>
        </section>

        <ChartCard
          title={showRejects ? 'Why alerts were rejected' : 'Alert outcomes'}
          subtitle="Analysed monthly to tune thresholds and cut false alerts (R-03)"
          actions={
            <div className="segmented">
              <button aria-pressed={showRejects} onClick={() => setShowRejects(true)}>
                Reject reasons
              </button>
              <button aria-pressed={!showRejects} onClick={() => setShowRejects(false)}>
                Outcomes
              </button>
            </div>
          }
          table={{ head: ['Category', 'Count'], rows: [...(showRejects ? rejects : outcomes).entries()].map(([k, v]) => [k, v]) }}
        >
          <BarList rows={[...(showRejects ? rejects : outcomes).entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ key: k, label: k, value: v }))} />
        </ChartCard>
      </div>

      <section className="card p-4 flex flex-col gap-3">
        <h3 className="text-[13.5px] font-semibold">Model registry</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Version</th>
              <th>Method</th>
              <th>Status</th>
              <th>Backtest vs. benchmark</th>
              <th>Approval</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="font-semibold">rules-v0.1</td>
              <td>Rule-based thresholds, baseline deviation, trend, history, oil/NDT, PM</td>
              <td>
                <Pill tone="ok">
                  <Icon name="check" size={11} /> Live
                </Pill>
              </td>
              <td className="text-ink-3">Benchmark (rule set) · Holt damped trend for availability forecast</td>
              <td>Approved by Asset Maintenance Manager</td>
            </tr>
            <tr>
              <td className="font-semibold">ml-v0.2</td>
              <td>Gradient-boosted failure classifier (planned)</td>
              <td>
                <Pill>Awaiting data readiness (D-02)</Pill>
              </td>
              <td className="text-ink-3">Not run — needs ≥ 12 months of coded EMMS history</td>
              <td>
                <button className="btn" disabled title="A model goes live only after it beats the benchmark in backtesting and is approved (NFR-M05, NFR-M06)">
                  Approve release
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <div className="text-[11.5px] text-ink-3">Every prediction stores its model version. Retrain at least quarterly, or when precision or recall falls below the BO-04 target (NFR-M04).</div>
      </section>
    </div>
  )
}
