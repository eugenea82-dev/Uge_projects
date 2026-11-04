// NDT findings (FR-08 — a Critical finding raises an alert at once) and bulk
// upload of oil-analysis results (FR-07, FR-09) with a per-row error report.
// Single oil reports are keyed in Capture Readings › Oil lab report.

import { useState } from 'react'
import { DAY } from '../domain/constants.ts'
import { COMPARTMENTS, LAB, LAB_BY_KEY } from '../domain/catalog.ts'
import type { NdtFinding, NdtSeverity, OilCompartment } from '../domain/types.ts'
import { useNav } from '../shell/nav.tsx'
import { useStore, type OilReportInput } from '../store.tsx'
import { Pill } from '../ui/badges.tsx'
import { downloadCsv, fmtDate, toLocalDateInput } from '../ui/format.ts'
import { Icon } from '../ui/Icon.tsx'
import { Empty, Field } from '../ui/Sheet.tsx'

const NDT_METHODS: NdtFinding['method'][] = ['Ultrasonic', 'Magnetic particle', 'Dye penetrant', 'Visual']
const NDT_SEV: NdtSeverity[] = ['None', 'Minor', 'Major', 'Critical']
const CSV_HEAD = ['asset_id', 'sample_date', 'lab', 'compartment', 'parameter', 'value']

export function LabNdtPage({ assetId: initial }: { assetId?: string }) {
  const { scopedUnits, d, data, can, inScope, addOil, addNdt, now } = useStore()
  const nav = useNav()
  const units = scopedUnits.filter((u) => !d.rel.get(u.assetId)?.excluded)
  const [tab, setTab] = useState<'ndt' | 'bulk'>('ndt')
  const [assetId, setAssetId] = useState(initial ?? units[0]?.assetId ?? '')
  const [ndt, setNdt] = useState({ date: toLocalDateInput(now), method: 'Magnetic particle' as NdtFinding['method'], location: '', finding: '', size: '', severity: 'None' as NdtSeverity, inspector: '', file: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [bulk, setBulk] = useState<{ ok: number; errors: { row: number; message: string }[]; critical?: number } | null>(null)

  if (!can('uploadLabNdt')) return <Empty icon="lock" title="Oil and NDT results are uploaded by Planners and Engineers">You can view results on each unit’s health page (BRD §3.3).</Empty>

  const num = (s: string) => (s.trim() === '' ? NaN : Number(s))

  const saveNdt = () => {
    const e: Record<string, string> = {}
    const date = new Date(ndt.date).getTime()
    if (!ndt.date || date > now) e.date = 'Inspection date is required and cannot be in the future.'
    if (!ndt.location.trim()) e.location = 'Component / location is required.'
    if (!ndt.finding.trim()) e.finding = 'Describe the finding (or “No relevant indication”).'
    if (!(num(ndt.size) >= 0)) e.size = 'Defect size in mm (0 if none).'
    if (!ndt.inspector.trim()) e.inspector = 'Inspector name / level is required.'
    if (ndt.severity === 'Critical' && !ndt.file) e.file = 'Attach the NDT report for a Critical finding.'
    setErrors(e)
    if (Object.keys(e).length) return
    const alert = addNdt({ assetId, inspectedAt: date, method: ndt.method, location: ndt.location.trim(), finding: ndt.finding.trim(), defectSizeMm: num(ndt.size), severity: ndt.severity, inspector: ndt.inspector.trim(), attachment: ndt.file || undefined })
    nav.toast(alert ? <span>Critical NDT finding saved — alert <b>{alert.id}</b> raised immediately (FR-08).</span> : 'NDT finding saved.', alert ? 'danger' : 'ok')
    setNdt({ ...ndt, location: '', finding: '', size: '', severity: 'None', file: '' })
  }

  /**
   * Bulk upload in long format — one row per lab result, so all four compartments
   * and all 25 parameters share one template. Rows for the same unit, date, lab and
   * compartment become one report, graded by the catalog like a manual entry.
   */
  const onCsv = async (file: File) => {
    const text = await file.text()
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim())
    const errs: { row: number; message: string }[] = []
    const head = lines[0]?.split(',').map((h) => h.trim().toLowerCase())
    if (!head || CSV_HEAD.some((h, i) => head[i] !== h)) {
      setBulk({ ok: 0, errors: [{ row: 1, message: `Header must be: ${CSV_HEAD.join(',')}` }] })
      return
    }
    const reports = new Map<string, OilReportInput>()
    lines.slice(1).forEach((line, i) => {
      const row = i + 2
      const [id, date, labName, comp, key, raw] = line.split(',').map((x) => x.trim())
      const problems: string[] = []
      if (!d.unitById.has(id)) problems.push(`unknown asset ID “${id}”`)
      else if (!inScope(id)) problems.push(`${id} is outside your branch scope`)
      const t = new Date(date).getTime()
      if (!Number.isFinite(t) || t > now) problems.push('invalid or future sample_date')
      if (!COMPARTMENTS.includes(comp as OilCompartment)) problems.push(`compartment must be ${COMPARTMENTS.join('/')}`)
      const def = LAB_BY_KEY[key]
      if (!def) problems.push(`unknown parameter “${key}” — use a code from the template`)
      else if (def.compartment !== comp) problems.push(`${key} belongs to ${def.compartment}, not ${comp}`)
      let value: number | string | undefined
      if (def) {
        if (def.text) {
          if (def.options && !def.options.some((o) => o.value === raw)) problems.push(`${key} must be one of: ${def.options.map((o) => o.value).join(' / ')}`)
          else value = raw
        } else if (!(Number(raw) >= 0)) problems.push(`${key} must be a number ≥ 0`)
        else value = Number(raw)
      }
      if (problems.length || value === undefined) {
        errs.push({ row, message: problems.join('; ') || 'value missing' })
        return
      }
      const k = [id, date, labName, comp].join('|')
      const rep = reports.get(k) ?? { assetId: id, sampledAt: t, lab: labName || 'Laboratory', compartment: comp as OilCompartment, values: {}, attachment: file.name }
      rep.values[key] = value
      reports.set(k, rep)
    })
    let critical = 0
    for (const rep of reports.values()) if (addOil(rep).severity === 'Critical') critical++
    setBulk({ ok: reports.size, errors: errs, critical })
  }

  const template = (): (string | number)[][] => {
    const u = units[0]?.assetId ?? 'RS-001'
    const day = toLocalDateInput(now)
    return [CSV_HEAD, ...LAB.map((p) => [u, day, 'Intertek PH Lab', p.compartment, p.key, p.rule === 'category' ? 'Negative' : p.rule === 'isoAboveRef' ? '18/16/13' : `[${p.label} in ${p.unit}]`])]
  }

  const recentOil = data.oil.filter((o) => inScope(o.assetId) && o.sampledAt > now - 90 * DAY).sort((a, b) => b.sampledAt - a.sampledAt).slice(0, 10)
  const recentNdt = data.ndt.filter((n) => inScope(n.assetId)).sort((a, b) => b.inspectedAt - a.inspectedAt).slice(0, 8)
  const sevTone = (s: string) => (s === 'Critical' ? 'danger' : s === 'Caution' || s === 'Major' ? 'info' : 'neutral') as 'danger' | 'info' | 'neutral'

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] max-w-[1300px]">
      <section className="card p-4 flex flex-col gap-4 self-start">
        <div className="caveat notice-info">
          <Icon name="flask" size={15} className="text-accent" />
          <div className="flex-1">
            <b>Oil lab reports are entered in Capture Readings.</b> All 25 lab parameters from the CHE data-entry sheet, graded OK / Check / Stop as you type.
          </div>
          <button className="btn btn-primary" onClick={() => nav.go({ page: 'capture', filter: 'oil', assetId: undefined })}>
            Enter oil report
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="segmented" role="group" aria-label="Entry type">
            <button aria-pressed={tab === 'ndt'} onClick={() => { setTab('ndt'); setErrors({}) }}>
              NDT finding
            </button>
            <button aria-pressed={tab === 'bulk'} onClick={() => setTab('bulk')}>
              Bulk upload (CSV)
            </button>
          </div>
          {tab !== 'bulk' && (
            <select className="field !w-auto" value={assetId} onChange={(e) => setAssetId(e.target.value)} aria-label="Unit">
              {units.map((u) => (
                <option key={u.assetId} value={u.assetId}>
                  {u.assetId} · {u.type} · {u.location}
                </option>
              ))}
            </select>
          )}
        </div>

        {tab === 'ndt' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Inspection date" error={errors.date}>
              <input type="date" className="field" value={ndt.date} onChange={(e) => setNdt({ ...ndt, date: e.target.value })} />
            </Field>
            <Field label="Method">
              <select className="field" value={ndt.method} onChange={(e) => setNdt({ ...ndt, method: e.target.value as NdtFinding['method'] })}>
                {NDT_METHODS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </Field>
            <Field label="Component / location" error={errors.location}>
              <input className="field" value={ndt.location} onChange={(e) => setNdt({ ...ndt, location: e.target.value })} placeholder="e.g. Boom base weld, left side" aria-invalid={!!errors.location} />
            </Field>
            <Field label="Defect size (mm)" error={errors.size}>
              <input className="field tnum" inputMode="decimal" value={ndt.size} onChange={(e) => setNdt({ ...ndt, size: e.target.value })} aria-invalid={!!errors.size} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Finding" error={errors.finding}>
                <textarea className="field" rows={2} value={ndt.finding} onChange={(e) => setNdt({ ...ndt, finding: e.target.value })} aria-invalid={!!errors.finding} />
              </Field>
            </div>
            <Field label="Severity">
              <div className="segmented self-start">
                {NDT_SEV.map((s) => (
                  <button key={s} type="button" aria-pressed={ndt.severity === s} onClick={() => setNdt({ ...ndt, severity: s })}>
                    {s}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Inspector" error={errors.inspector}>
              <input className="field" value={ndt.inspector} onChange={(e) => setNdt({ ...ndt, inspector: e.target.value })} placeholder="Name · Level II" aria-invalid={!!errors.inspector} />
            </Field>
            <Field label="Report and photos" error={errors.file}>
              <input type="file" accept=".pdf,image/*" multiple className="text-[12px]" onChange={(e) => setNdt({ ...ndt, file: [...(e.target.files ?? [])].map((f) => f.name).join(', ') })} />
            </Field>
            {ndt.severity === 'Critical' && (
              <div className="sm:col-span-2 caveat notice-danger">
                <Icon name="alert" size={14} className="text-danger" /> A Critical finding raises an alert immediately and requires Branch Manager authorization before the unit returns to lifting duty.
              </div>
            )}
            <div className="sm:col-span-2 flex justify-end">
              <button className="btn btn-primary btn-touch !px-6" onClick={saveNdt}>
                Save NDT finding
              </button>
            </div>
          </div>
        )}

        {tab === 'bulk' && (
          <div className="flex flex-col gap-3">
            <p className="text-ink-2">Upload a laboratory export in bulk: one row per result (<code>{CSV_HEAD.join(',')}</code>). Rows for the same unit, date and compartment become one report, graded against the CHE limits like a manual entry. Every rejected row is listed with the reason.</p>
            <div className="flex flex-wrap gap-2">
              <button className="btn" onClick={() => downloadCsv('oil-analysis-template.csv', template())}>
                <Icon name="download" size={14} /> Download template
              </button>
              <label className="btn btn-primary cursor-pointer">
                <Icon name="plus" size={14} /> Upload CSV
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && onCsv(e.target.files[0])} />
              </label>
            </div>
            {bulk && (
              <div className="flex flex-col gap-2">
                <div className="caveat notice-info">
                  <Icon name="check" size={14} className="text-accent" /> {bulk.ok} report{bulk.ok === 1 ? '' : 's'} imported{bulk.critical ? ` (${bulk.critical} Critical — alert raised)` : ''} · {bulk.errors.length} row{bulk.errors.length === 1 ? '' : 's'} rejected
                </div>
                {bulk.errors.length > 0 && (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>Problem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulk.errors.map((e) => (
                        <tr key={e.row}>
                          <td className="tnum">{e.row}</td>
                          <td className="text-danger">{e.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      <div className="flex flex-col gap-4">
        <section className="card p-4">
          <h3 className="text-[14px] font-semibold mb-2">Recent oil results · 90 days</h3>
          {recentOil.map((o) => (
            <button key={o.id} className="w-full flex items-center justify-between gap-2 py-1.5 border-b border-line last:border-0 text-left" onClick={() => nav.openUnit(o.assetId)}>
              <span>
                <b>{o.assetId}</b> <span className="text-ink-3">· {o.compartment} · {fmtDate(o.sampledAt)}</span>
              </span>
              <Pill tone={sevTone(o.severity)}>{o.severity}</Pill>
            </button>
          ))}
        </section>
        <section className="card p-4">
          <h3 className="text-[14px] font-semibold mb-2">Recent NDT findings</h3>
          {recentNdt.map((n) => (
            <button key={n.id} className="w-full flex items-center justify-between gap-2 py-1.5 border-b border-line last:border-0 text-left" onClick={() => nav.openUnit(n.assetId)}>
              <span className="min-w-0">
                <b>{n.assetId}</b> <span className="text-ink-3">· {n.location} · {fmtDate(n.inspectedAt)}</span>
              </span>
              <Pill tone={sevTone(n.severity)}>{n.severity}</Pill>
            </button>
          ))}
        </section>
      </div>
    </div>
  )
}
