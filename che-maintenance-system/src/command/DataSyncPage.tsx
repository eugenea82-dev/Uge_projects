// EMMS import status and exception list (FR-03), connection and field mapping, data-quality view per branch
// (NFR-D02) and YardPulse migration status (FR-45).

import { useState } from 'react'
import { DAY, HOUR, LOCATIONS } from '../domain/constants.ts'
import { currentStatus } from '../domain/kpi.ts'
import { useNav } from '../shell/nav.tsx'
import { useStore } from '../store.tsx'
import { Caveat } from '../ui/badges.tsx'
import { fmtAgo, fmtDate, fmtDateTime, fmtPct } from '../ui/format.ts'
import { Icon } from '../ui/Icon.tsx'
import { WORK_ORDER_FIELD_MAP, type EmmsHealth } from '../integration/emms/contract.ts'
import { parseExport } from '../integration/emms/mapper.ts'

export function DataSyncPage() {
  const { data, d, now, can, runBatch, importEmmsFile, testEmms, emms } = useStore()
  const [busy, setBusy] = useState(false)
  const [health, setHealth] = useState<EmmsHealth | { ok: false; detail: string } | null>(null)
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

  const onFile = async (file: File) => {
    try {
      const dtos = parseExport(JSON.parse(await file.text()))
      const r = importEmmsFile(dtos, file.name)
      nav.toast(`${file.name}: ${r.added} added · ${r.updated} updated · ${r.skipped} skipped · ${r.rejected} sent to the exception list.`, r.rejected ? 'info' : 'ok')
    } catch (e) {
      nav.toast(`Could not read ${file.name}: ${(e as Error).message}`, 'danger')
    }
  }

  const sampleExport = () => {
    const u = d.activeUnits[0]?.assetId ?? 'RS-001'
    const iso = (t: number) => new Date(t).toISOString()
    const sample = {
      items: [
        { wo_no: 'WO-700001', asset_id: u, wo_type: 'CM', status: 'CLOSED', description: 'Replaced lift cylinder hose', failure_code: 'HYD-LEAK', date_opened: iso(now - 3 * DAY), repair_start: iso(now - 3 * DAY + 2 * HOUR), repair_end: iso(now - 2 * DAY), parts_wait_hours: 8, rts_date: iso(now - 2 * DAY + HOUR), total_cost: 42500, updated_at: iso(now - 2 * DAY + HOUR) },
        { wo_no: 'WO-700002', asset_id: u, wo_type: 'PM', status: 'OPEN', description: 'PM service 500 h', date_opened: iso(now - DAY), due_date: iso(now + 4 * DAY), updated_at: iso(now - DAY) },
        { wo_no: 'WO-700003', asset_id: 'XX-404', wo_type: 'CM', status: 'OPEN', description: 'Unknown unit — goes to the exception list', date_opened: iso(now - DAY), updated_at: iso(now - DAY) },
      ],
      next_page: null,
    }
    const blob = new Blob([JSON.stringify(sample, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'emms-work-orders-sample.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  const li = data.sync.lastImport
  const live = emms.mode === 'api'

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-4 flex flex-col gap-3">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[13.5px] font-semibold">EMMS connection</h3>
            <div className="text-[12px] text-ink-3">Read-only work-order feed (FR-03). The interface method is still Open item 3; the app is wired to an EMMS API through an integration gateway.</div>
          </div>
          <span className="chip" style={{ color: live ? 'var(--ok-ink)' : 'var(--ink-2)' }}>
            <span className="w-2 h-2 rounded-full" style={{ background: live ? 'var(--st-green)' : 'var(--st-gray)' }} />
            {live ? 'Live — EMMS API' : 'Not connected — simulated EMMS'}
          </span>
        </header>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg bg-surface-2 p-2.5">
            <div className="label">Mode</div>
            <div className="font-semibold">{live ? 'API' : 'Mock'}</div>
            <div className="text-[11px] text-ink-3">VITE_EMMS_MODE={emms.mode}</div>
          </div>
          <div className="rounded-lg bg-surface-2 p-2.5 min-w-0">
            <div className="label">Gateway URL</div>
            <div className="font-semibold truncate" title={emms.baseUrl}>{emms.baseUrl || '— not set'}</div>
            <div className="text-[11px] text-ink-3">VITE_EMMS_BASE_URL</div>
          </div>
          <div className="rounded-lg bg-surface-2 p-2.5">
            <div className="label">Last import</div>
            <div className="font-semibold">{fmtDateTime(data.sync.emmsLastSync)}</div>
            <div className="text-[11px] text-ink-3">
              {li ? `${li.received} received · ${li.added} new · ${li.updated} updated · ${li.rejected} exceptions (${li.source})` : `${fmtAgo(data.sync.emmsLastSync, now)} · daily, complete by 06:00`}
            </div>
          </div>
          <div className="rounded-lg bg-surface-2 p-2.5">
            <div className="label">Risk scoring run</div>
            <div className="font-semibold" style={{ color: stale ? 'var(--danger)' : undefined }}>
              {fmtDateTime(data.sync.scoringLastRun)}
            </div>
            <div className="text-[11px] text-ink-3">{stale ? 'Older than 26 h — dashboards show a stale-data warning' : 'Within the 26 h freshness window (NFR-C04)'}</div>
          </div>
        </div>
        {data.sync.lastError && (
          <div className="caveat notice-danger" role="alert">
            <Icon name="alert" size={14} className="text-danger" />
            <div>
              <b>Last EMMS import failed</b> {fmtAgo(data.sync.lastError.at, now)}: {data.sync.lastError.message} KPIs and risk scores were refreshed on the data already held.
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="btn btn-primary"
            disabled={!can('runBatch') || busy}
            onClick={async () => {
              setBusy(true)
              const r = await runBatch()
              setBusy(false)
              nav.toast(r.error ? `EMMS import failed: ${r.error}` : `Batch complete — ${r.import?.received ?? 0} EMMS records, ${r.scored} units scored, ${r.created} new alert${r.created === 1 ? '' : 's'}.`, r.error ? 'danger' : 'ok')
            }}
          >
            <Icon name="sync" size={14} /> {busy ? 'Running…' : 'Run nightly batch now'}
          </button>
          <button
            className="btn"
            onClick={async () => {
              setHealth(null)
              setHealth(await testEmms())
            }}
          >
            <Icon name="pulse" size={14} /> Test connection
          </button>
          <label className="btn cursor-pointer" title="Interim path while the API is pending (R-04): load an EMMS export through the same mapper">
            <Icon name="plus" size={14} /> Import EMMS export (JSON)
            <input type="file" accept=".json,application/json" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
          <button className="btn" onClick={sampleExport}>
            <Icon name="download" size={14} /> Sample export file
          </button>
          {health && (
            <span className="chip" style={{ color: health.ok ? 'var(--ok-ink)' : 'var(--danger)' }}>
              <Icon name={health.ok ? 'check' : 'alert'} size={12} /> {health.detail}
              {'latencyMs' in health && health.ok ? ` · ${health.latencyMs} ms` : ''}
            </span>
          )}
        </div>
      </section>

      <section className="card p-4 flex flex-col gap-2">
        <h3 className="text-[13.5px] font-semibold">Work-order field mapping (EMMS → CHE Maintenance System)</h3>
        <div className="text-[12px] text-ink-3">Provisional contract — confirm field names with the EMMS owner (D-01). Only this mapping changes when the real API is published.</div>
        <div className="scroll-area">
          <table className="table">
            <thead>
              <tr>
                <th>EMMS field</th>
                <th>Used as</th>
                <th>Rule</th>
              </tr>
            </thead>
            <tbody>
              {WORK_ORDER_FIELD_MAP.map((f) => (
                <tr key={f.emms}>
                  <td className="font-mono text-[12px]">{f.emms}</td>
                  <td>{f.che}</td>
                  <td className="text-ink-2">{f.rule}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

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
