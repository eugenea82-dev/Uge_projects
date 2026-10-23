// Oil-analysis results (FR-07, incl. CSV bulk upload with a per-row error
// report) and NDT findings (FR-08 — a Critical finding raises an alert at once).

import { useState } from 'react'
import { DAY } from '../domain/constants.ts'
import type { NdtFinding, NdtSeverity, OilSample, OilSeverity } from '../domain/types.ts'
import { useNav } from '../shell/nav.tsx'
import { useStore } from '../store.tsx'
import { Pill } from '../ui/badges.tsx'
import { downloadCsv, fmtDate, toLocalDateInput } from '../ui/format.ts'
import { Icon } from '../ui/Icon.tsx'
import { Empty, Field } from '../ui/Sheet.tsx'

const COMPARTMENTS: OilSample['compartment'][] = ['Engine', 'Transmission', 'Hydraulic']
const OIL_SEV: OilSeverity[] = ['Normal', 'Caution', 'Critical']
const NDT_METHODS: NdtFinding['method'][] = ['Ultrasonic', 'Magnetic particle', 'Dye penetrant', 'Visual']
const NDT_SEV: NdtSeverity[] = ['None', 'Minor', 'Major', 'Critical']
const CSV_HEAD = ['asset_id', 'sample_date', 'lab', 'compartment', 'viscosity_cst', 'water_pct', 'fuel_dilution_pct', 'iron_ppm', 'iso_particle_code', 'lab_severity']

export function LabNdtPage({ assetId: initial }: { assetId?: string }) {
  const { scopedUnits, d, data, can, inScope, addOil, addNdt, now } = useStore()
  const nav = useNav()
  const units = scopedUnits.filter((u) => !d.rel.get(u.assetId)?.excluded)
  const [tab, setTab] = useState<'oil' | 'ndt' | 'bulk'>('oil')
  const [assetId, setAssetId] = useState(initial ?? units[0]?.assetId ?? '')
  const [oil, setOil] = useState({ date: toLocalDateInput(now), lab: 'Intertek PH Lab', compartment: 'Engine' as OilSample['compartment'], viscosity: '', water: '', fuel: '', iron: '', iso: '', severity: 'Normal' as OilSeverity, file: '' })
  const [ndt, setNdt] = useState({ date: toLocalDateInput(now), method: 'Magnetic particle' as NdtFinding['method'], location: '', finding: '', size: '', severity: 'None' as NdtSeverity, inspector: '', file: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [bulk, setBulk] = useState<{ ok: number; errors: { row: number; message: string }[] } | null>(null)

  if (!can('uploadLabNdt')) return <Empty icon="lock" title="Oil and NDT results are uploaded by Planners and Engineers">You can view results on each unit’s health page (BRD §3.3).</Empty>

  const num = (s: string) => (s.trim() === '' ? NaN : Number(s))

  const saveOil = () => {
    const e: Record<string, string> = {}
    const date = new Date(oil.date).getTime()
    if (!oil.date || date > now) e.date = 'Sample date is required and cannot be in the future.'
    if (!oil.lab.trim()) e.lab = 'Laboratory is required.'
    if (!(num(oil.viscosity) > 0 && num(oil.viscosity) < 100)) e.viscosity = 'Viscosity in cSt @100 °C, between 0 and 100.'
    if (!(num(oil.water) >= 0 && num(oil.water) <= 100)) e.water = 'Water % between 0 and 100.'
    if (!(num(oil.fuel) >= 0 && num(oil.fuel) <= 100)) e.fuel = 'Fuel dilution % between 0 and 100.'
    if (!(num(oil.iron) >= 0 && num(oil.iron) < 5000)) e.iron = 'Iron in ppm, 0–5000.'
    if (!/^\d{1,2}\/\d{1,2}\/\d{1,2}$/.test(oil.iso.trim())) e.iso = 'ISO 4406 code, e.g. 18/16/13.'
    setErrors(e)
    if (Object.keys(e).length) return
    const alert = addOil({ assetId, sampledAt: date, lab: oil.lab.trim(), compartment: oil.compartment, viscosity: num(oil.viscosity), waterPct: num(oil.water), fuelDilutionPct: num(oil.fuel), ironPpm: num(oil.iron), particleCode: oil.iso.trim(), severity: oil.severity, attachment: oil.file || undefined })
    nav.toast(alert ? `Oil result saved. Critical result raised alert ${alert.id}.` : 'Oil analysis result saved.', alert ? 'danger' : 'ok')
    setOil({ ...oil, viscosity: '', water: '', fuel: '', iron: '', iso: '', severity: 'Normal', file: '' })
  }

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

  const onCsv = async (file: File) => {
    const text = await file.text()
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
    const errs: { row: number; message: string }[] = []
    let ok = 0
    const head = lines[0]?.split(',').map((h) => h.trim().toLowerCase())
    if (!head || CSV_HEAD.some((h, i) => head[i] !== h)) {
      setBulk({ ok: 0, errors: [{ row: 1, message: `Header must be: ${CSV_HEAD.join(',')}` }] })
      return
    }
    lines.slice(1).forEach((line, i) => {
      const row = i + 2
      const c = line.split(',').map((x) => x.trim())
      const [id, date, lab, comp, visc, water, fuel, iron, iso, sev] = c
      const problems: string[] = []
      if (!d.unitById.has(id)) problems.push(`unknown asset ID “${id}”`)
      else if (!inScope(id)) problems.push(`${id} is outside your branch scope`)
      const t = new Date(date).getTime()
      if (!Number.isFinite(t) || t > now) problems.push('invalid or future sample_date')
      if (!COMPARTMENTS.includes(comp as OilSample['compartment'])) problems.push(`compartment must be ${COMPARTMENTS.join('/')}`)
      if (!OIL_SEV.includes(sev as OilSeverity)) problems.push(`lab_severity must be ${OIL_SEV.join('/')}`)
      for (const [k, v] of [['viscosity_cst', visc], ['water_pct', water], ['fuel_dilution_pct', fuel], ['iron_ppm', iron]] as const) if (!(Number(v) >= 0)) problems.push(`${k} must be a number ≥ 0`)
      if (!/^\d{1,2}\/\d{1,2}\/\d{1,2}$/.test(iso ?? '')) problems.push('iso_particle_code like 18/16/13')
      if (problems.length) {
        errs.push({ row, message: problems.join('; ') })
        return
      }
      addOil({ assetId: id, sampledAt: t, lab, compartment: comp as OilSample['compartment'], viscosity: Number(visc), waterPct: Number(water), fuelDilutionPct: Number(fuel), ironPpm: Number(iron), particleCode: iso, severity: sev as OilSeverity, attachment: file.name })
      ok++
    })
    setBulk({ ok, errors: errs })
  }

  const recentOil = data.oil.filter((o) => inScope(o.assetId) && o.sampledAt > now - 90 * DAY).sort((a, b) => b.sampledAt - a.sampledAt).slice(0, 10)
  const recentNdt = data.ndt.filter((n) => inScope(n.assetId)).sort((a, b) => b.inspectedAt - a.inspectedAt).slice(0, 8)
  const sevTone = (s: string) => (s === 'Critical' ? 'danger' : s === 'Caution' || s === 'Major' ? 'info' : 'neutral') as 'danger' | 'info' | 'neutral'

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] max-w-[1300px]">
      <section className="card p-4 flex flex-col gap-4 self-start">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="segmented" role="group" aria-label="Entry type">
            <button aria-pressed={tab === 'oil'} onClick={() => { setTab('oil'); setErrors({}) }}>
              Oil analysis
            </button>
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

        {tab === 'oil' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Sample date" error={errors.date}>
              <input type="date" className="field" value={oil.date} onChange={(e) => setOil({ ...oil, date: e.target.value })} aria-invalid={!!errors.date} />
            </Field>
            <Field label="Laboratory" error={errors.lab}>
              <input className="field" value={oil.lab} onChange={(e) => setOil({ ...oil, lab: e.target.value })} />
            </Field>
            <Field label="Compartment">
              <select className="field" value={oil.compartment} onChange={(e) => setOil({ ...oil, compartment: e.target.value as OilSample['compartment'] })}>
                {COMPARTMENTS.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Viscosity (cSt @100 °C)" error={errors.viscosity} hint="Typical 13–15">
              <input className="field tnum" inputMode="decimal" value={oil.viscosity} onChange={(e) => setOil({ ...oil, viscosity: e.target.value })} aria-invalid={!!errors.viscosity} />
            </Field>
            <Field label="Water (%)" error={errors.water} hint="Caution above 0.1%">
              <input className="field tnum" inputMode="decimal" value={oil.water} onChange={(e) => setOil({ ...oil, water: e.target.value })} aria-invalid={!!errors.water} />
            </Field>
            <Field label="Fuel dilution (%)" error={errors.fuel} hint="Caution above 2%">
              <input className="field tnum" inputMode="decimal" value={oil.fuel} onChange={(e) => setOil({ ...oil, fuel: e.target.value })} aria-invalid={!!errors.fuel} />
            </Field>
            <Field label="Iron — wear metal (ppm)" error={errors.iron} hint="Caution above 60 ppm">
              <input className="field tnum" inputMode="numeric" value={oil.iron} onChange={(e) => setOil({ ...oil, iron: e.target.value })} aria-invalid={!!errors.iron} />
            </Field>
            <Field label="Particle count (ISO 4406)" error={errors.iso} hint="e.g. 18/16/13">
              <input className="field tnum" value={oil.iso} onChange={(e) => setOil({ ...oil, iso: e.target.value })} aria-invalid={!!errors.iso} />
            </Field>
            <Field label="Lab severity">
              <div className="segmented self-start">
                {OIL_SEV.map((s) => (
                  <button key={s} type="button" aria-pressed={oil.severity === s} onClick={() => setOil({ ...oil, severity: s })}>
                    {s}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Lab report (PDF)" hint="Stored with the record in production">
              <input type="file" accept=".pdf,image/*" className="text-[12px]" onChange={(e) => setOil({ ...oil, file: e.target.files?.[0]?.name ?? '' })} />
            </Field>
            <div className="sm:col-span-2 flex justify-end">
              <button className="btn btn-primary btn-touch !px-6" onClick={saveOil}>
                Save oil result
              </button>
            </div>
          </div>
        )}

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
            <p className="text-ink-2">Upload oil-analysis results from the laboratory in bulk. Valid rows are saved; every rejected row is listed with the reason so it can be corrected and re-uploaded.</p>
            <div className="flex flex-wrap gap-2">
              <button className="btn" onClick={() => downloadCsv('oil-analysis-template.csv', [CSV_HEAD, [units[0]?.assetId ?? 'RS-001', toLocalDateInput(now), 'Intertek PH Lab', 'Hydraulic', 14.2, 0.04, 0.5, 22, '18/16/13', 'Normal']])}>
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
                  <Icon name="check" size={14} className="text-accent" /> {bulk.ok} row{bulk.ok === 1 ? '' : 's'} imported · {bulk.errors.length} rejected
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
