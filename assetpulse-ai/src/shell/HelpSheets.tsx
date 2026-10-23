import { STATUS_ORDER, STATUSES } from '../domain/constants.ts'
import { useStore } from '../store.tsx'
import { StatusBadge } from '../ui/badges.tsx'
import { AppIcon } from '../ui/Icon.tsx'
import { Sheet } from '../ui/Sheet.tsx'

const KPIS: [string, string][] = [
  ['Availability %', '(Required time − Technical downtime) ÷ Required time × 100. Required time is 168 h/week. Weekly and rolling 13-week.'],
  ['Technical downtime', 'Hours in any Unavailable – Technical status.'],
  ['Operational constraint time', 'Hours a healthy unit cannot work for external reasons (no operator, no job, weather, yard congestion). Reported separately; excluded from availability, MTBF and MTTR.'],
  ['Failure events', 'Count of discrete technical down episodes. Consecutive non-available statuses form one event, however many statuses or weeks it spans.'],
  ['MTBF', 'Operating hours ÷ failure events. v0.1 uses uptime hours as the operating-hour basis until hour-meter deltas are validated.'],
  ['MTTR', 'Total restoration time (first loss of availability to return to service) ÷ closed failure events, broken down into technician wait, diagnosis, PO/approval wait, parts wait, repair and testing.'],
  ['Inherent availability', 'MTBF ÷ (MTBF + MTTR) — secondary check on BO-03.'],
  ['Repeat failure', 'A failure event within 8 weeks of the previous one on the same unit. Rate = repeat failures ÷ total failures.'],
  ['PM compliance %', 'PM work orders completed on schedule (within 1 day of due) ÷ PM work orders scheduled.'],
  ['Planned maintenance ratio', '(PM + predictive) work orders ÷ total work orders.'],
  ['Alert precision', 'Alerts closed as Confirmed fault ÷ alerts closed.'],
  ['Alert recall', 'Failures preceded by an alert ≥ 7 days before ÷ total failures in covered components.'],
]

export function KpiGuideSheet({ onClose }: { onClose: () => void }) {
  const { data } = useStore()
  return (
    <Sheet title="KPI definitions & status model" subtitle="BRD v2.0 · Annex C.2 and C.3" onClose={onClose} width={720}>
      <h3 className="label mb-2">8-status model → A-R-M category</h3>
      <table className="table mb-5">
        <thead>
          <tr>
            <th>Status</th>
            <th>Colour</th>
            <th>A-R-M category</th>
            <th>MTTR bucket</th>
          </tr>
        </thead>
        <tbody>
          {STATUS_ORDER.map((c) => {
            const s = STATUSES[c]
            return (
              <tr key={c}>
                <td>
                  <StatusBadge status={c} />
                </td>
                <td>{s.colorName}</td>
                <td>{s.arm === 'AVAILABLE' ? 'Available (uptime)' : s.arm === 'EXCLUDED' ? 'Excluded from all calculations' : 'Unavailable – Technical'}</td>
                <td className="text-ink-3">{s.mttrBucket ?? '—'}</td>
              </tr>
            )
          })}
          <tr>
            <td colSpan={2}>Any status with an external cause</td>
            <td>Unavailable – External</td>
            <td className="text-ink-3">Operational constraint time</td>
          </tr>
        </tbody>
      </table>
      <h3 className="label mb-2">KPI formulas</h3>
      <dl className="grid gap-2.5">
        {KPIS.map(([k, v]) => (
          <div key={k} className="grid sm:grid-cols-[190px_1fr] gap-1 sm:gap-3">
            <dt className="font-semibold">{k}</dt>
            <dd className="text-ink-2">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="caveat mt-5">
        <div>
          <b>Worked example (AC-02).</b> A unit down Monday–Wednesday (72 h) and operational Thursday–Sunday (96 h) shows status Operational, but its weekly availability is 96 ÷ 168 = <b>57.1%</b>, with 1 failure event, 72 h downtime and 72 h MTTR. The seeded unit {data.workedExampleAssetId} reproduces this in the last complete week.
        </div>
      </div>
    </Sheet>
  )
}

export function AboutSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="About AssetPulse AI" onClose={onClose} width={560}>
      <div className="flex items-center gap-4 mb-4">
        <AppIcon size={64} />
        <div>
          <div className="text-[18px] font-semibold">2GO AssetPulse AI</div>
          <div className="text-ink-3">Version 0.1 · Release 1 pilot prototype</div>
        </div>
      </div>
      <p className="text-ink-2 mb-3">
        CHE predictive maintenance and monitoring for ~75 reach stackers, forklifts, empty container handlers and yard tractors across 12 locations. Built from BRD v2.0 (23 Oct 2026), adopting the YardPulse 8-status model and A-R-M KPI framework.
      </p>
      <h3 className="label mb-1.5">What this prototype is</h3>
      <ul className="list-disc pl-5 text-ink-2 space-y-1 mb-3">
        <li>A clickable, front-end-only build for requirements validation and UAT scripting.</li>
        <li>All units, readings, work orders and alerts are <b>simulated</b>; nothing is read from EMMS yet (D-01).</li>
        <li>Risk scoring is rule-based (rules-v0.1) per C-03 / NFR-M03 — every score lists its contributing factors.</li>
        <li>Sign-in is local with demo accounts; 2GO SSO is pending IT (Open item 6).</li>
        <li>Data is stored in this browser only (localStorage). Use “Reset demo data” to start over.</li>
      </ul>
      <h3 className="label mb-1.5">Decision support only</h3>
      <p className="text-ink-2">AI output never replaces physical inspections, engineering judgment or OEM-mandated safety procedures (NFR-R04). The system never removes a unit from service on its own (NFR-M01).</p>
    </Sheet>
  )
}
