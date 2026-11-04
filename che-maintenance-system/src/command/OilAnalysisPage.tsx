// Oil Analysis (Command Center): fleet oil condition from the latest lab report
// per unit and compartment. The oil-analysis element table becomes a live
// wear-source map: every metal × compartment cell keeps the table's "where it
// comes from" text and shows how many units are at Check or Stop right now, so
// a high metal points straight at the part that is wearing.

import { useMemo, useState } from 'react'
import { COMPARTMENTS, COMPARTMENT_LABEL, ELEMENTS, LAB, bands, evaluate, fmtValue, labBaseline, labGroups, type LabDef, type Level } from '../domain/catalog.ts'
import { DAY } from '../domain/constants.ts'
import type { OilCompartment, OilSample } from '../domain/types.ts'
import { useNav } from '../shell/nav.tsx'
import { useStore } from '../store.tsx'
import { Caveat } from '../ui/badges.tsx'
import { ChartCard, StackedBars } from '../ui/charts.tsx'
import { downloadCsv, fmtDate } from '../ui/format.ts'
import { Icon } from '../ui/Icon.tsx'
import { StatTile } from '../ui/StatTile.tsx'

const RECENT_DAYS = 180

interface Flag {
  sample: OilSample
  def: LabDef
  value: number | string
  level: Exclude<Level, 'ok'>
  limit: string
}

function LevelChip({ level }: { level: Level }) {
  const s = level === 'critical' ? { t: 'Stop', bg: 'var(--risk-critical)', fg: '#fff' } : level === 'warning' ? { t: 'Check', bg: 'var(--risk-medium)', fg: '#1d1d1f' } : { t: 'OK', bg: 'var(--st-green)', fg: '#fff' }
  return (
    <span className="inline-flex items-center justify-center min-w-[54px] h-[22px] px-2 rounded-full text-[11.5px] font-semibold" style={{ background: s.bg, color: s.fg }}>
      {s.t}
    </span>
  )
}

export function OilAnalysisPage() {
  const { data, d, now, inScope } = useStore()
  const nav = useNav()
  const [cell, setCell] = useState<{ element: string; comp: OilCompartment } | null>(null)
  const [comp, setComp] = useState<OilCompartment | 'all'>('all')
  const [drill, setDrill] = useState<{ assetId: string; comp: OilCompartment } | null>(null)

  const active = useMemo(() => new Set(d.activeUnits.filter((u) => inScope(u.assetId)).map((u) => u.assetId)), [d, inScope])

  // History per unit+compartment, oldest first.
  const histories = useMemo(() => {
    const m = new Map<string, OilSample[]>()
    for (const o of data.oil) {
      if (!active.has(o.assetId)) continue
      const k = `${o.assetId}|${o.compartment}`
      m.set(k, [...(m.get(k) ?? []), o])
    }
    for (const arr of m.values()) arr.sort((a, b) => a.sampledAt - b.sampledAt)
    return m
  }, [data.oil, active])

  // Latest report per unit+compartment in the window, graded against the unit's earlier reports.
  const { latest, flags } = useMemo(() => {
    const latest: OilSample[] = []
    const flags: Flag[] = []
    for (const hist of histories.values()) {
      const last = hist[hist.length - 1]
      if (last.sampledAt < now - RECENT_DAYS * DAY) continue
      latest.push(last)
      const prev = hist.slice(0, -1)
      for (const def of LAB.filter((x) => x.compartment === last.compartment)) {
        const v = last.values[def.key]
        if (v === undefined) continue
        const th = data.labThresholds[def.key]
        const base = labBaseline(prev, def.key)
        const level = evaluate(def, th, v, base)
        if (level === 'warning' || level === 'critical') {
          const b = bands(def, th, base)
          flags.push({ sample: last, def, value: v, level, limit: level === 'critical' ? `Stop ${b.stop}` : `Check ${b.check}` })
        }
      }
    }
    flags.sort((a, b) => (a.level === b.level ? b.sample.sampledAt - a.sample.sampledAt : a.level === 'critical' ? -1 : 1))
    return { latest, flags }
  }, [histories, data.labThresholds, now])

  const recentReports = data.oil.filter((o) => active.has(o.assetId) && o.sampledAt >= now - 90 * DAY).length
  const unitsWith = (sev: OilSample['severity']) => new Set(latest.filter((o) => o.severity === sev).map((o) => o.assetId)).size
  const metalFlags = flags.filter((f) => f.def.element)
  const topElement = ELEMENTS.map((e) => ({ e, n: metalFlags.filter((f) => f.def.element === e.name).length })).sort((a, b) => b.n - a.n)[0]

  const cellStats = (element: string, c: OilCompartment) => {
    const fs = flags.filter((f) => f.def.element === element && f.def.compartment === c)
    return { stop: fs.filter((f) => f.level === 'critical').length, check: fs.filter((f) => f.level === 'warning').length }
  }

  const sevRows = COMPARTMENTS.map((c) => {
    const ls = latest.filter((o) => o.compartment === c)
    return { label: COMPARTMENT_LABEL[c], values: [ls.filter((o) => o.severity === 'Normal').length, ls.filter((o) => o.severity === 'Caution').length, ls.filter((o) => o.severity === 'Critical').length] }
  })

  const shown = flags.filter((f) => (comp === 'all' || f.def.compartment === comp) && (!cell || (f.def.element === cell.element && f.def.compartment === cell.comp)))

  const exportCsv = () =>
    downloadCsv(`oil-analysis-flags-${new Date(now).toISOString().slice(0, 10)}.csv`, [
      ['Unit', 'Location', 'Compartment', 'Parameter', 'Value', 'Unit of measure', 'Level', 'Limit', 'Likely source / cause', 'Sample date', 'Lab'],
      ...shown.map((f) => [f.sample.assetId, d.unitById.get(f.sample.assetId)?.location ?? '', f.def.compartment, f.def.label, String(f.value), f.def.unit, f.level === 'critical' ? 'Stop' : 'Check', f.limit, f.def.sources ?? f.def.indication, fmtDate(f.sample.sampledAt), f.sample.lab]),
    ])

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <StatTile label="Lab reports · 90 days" value={recentReports} sub={`${latest.length} latest reports across ${active.size} units`} icon="flask" />
        <StatTile label="Units with Critical oil" value={unitsWith('Critical')} sub="latest report graded Critical" tone={unitsWith('Critical') ? 'danger' : 'ok'} icon="stop" />
        <StatTile label="Units with Caution" value={unitsWith('Caution')} sub="plan an action at next service" tone={unitsWith('Caution') ? 'warn' : 'ok'} icon="alert" />
        <StatTile label="Most flagged metal" value={topElement && topElement.n ? topElement.e.name.split(' ')[0] : 'None'} sub={topElement && topElement.n ? `${topElement.n} result${topElement.n > 1 ? 's' : ''} at Check or Stop` : 'all metals inside limits'} icon="target" />
      </div>

      <section className="card p-4 flex flex-col gap-3">
        <header className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-[13.5px] font-semibold">Wear-source map</h3>
            <div className="text-[12px] text-ink-3">Oil-analysis element table: where each metal comes from in each compartment, with units at Check or Stop in their latest report. Select a cell to list them.</div>
          </div>
          {cell && (
            <button className="btn" onClick={() => setCell(null)}>
              <Icon name="x" size={12} /> Clear selection
            </button>
          )}
        </header>
        <div className="scroll-area">
          <table className="table" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th>Element</th>
                {COMPARTMENTS.map((c) => (
                  <th key={c}>{COMPARTMENT_LABEL[c]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ELEMENTS.map((e) => (
                <tr key={e.sym}>
                  <td className="font-semibold whitespace-nowrap align-top">
                    {e.name}
                    <div className="text-[11px] font-normal text-ink-3">{e.kind === 'wear' ? 'Wear metal' : e.kind === 'contaminant' ? 'Contaminant' : 'Wear or additive'}</div>
                  </td>
                  {COMPARTMENTS.map((c) => {
                    const st = cellStats(e.name, c)
                    const selected = cell?.element === e.name && cell.comp === c
                    const tint = st.stop ? 'color-mix(in srgb, var(--risk-critical) 14%, transparent)' : st.check ? 'color-mix(in srgb, var(--risk-medium) 20%, transparent)' : undefined
                    return (
                      <td key={c} className="align-top !p-1">
                        <button
                          className="w-full text-left rounded-md px-2 py-1.5 flex flex-col gap-1 min-h-[52px]"
                          style={{ background: tint, boxShadow: selected ? 'inset 0 0 0 2px var(--accent)' : undefined }}
                          onClick={() => setCell(selected ? null : { element: e.name, comp: c })}
                          aria-pressed={selected}
                          aria-label={`${e.name} in ${COMPARTMENT_LABEL[c]}: ${st.stop} at Stop, ${st.check} at Check`}
                        >
                          <span className="text-[12px] text-ink-2 leading-snug">{e.sources[c]}</span>
                          <span className="flex gap-1.5 text-[11px] font-semibold">
                            {st.stop > 0 && <span className="px-1.5 rounded-full" style={{ background: 'var(--risk-critical)', color: '#fff' }}>{st.stop} Stop</span>}
                            {st.check > 0 && <span className="px-1.5 rounded-full" style={{ background: 'var(--risk-medium)', color: '#1d1d1f' }}>{st.check} Check</span>}
                            {!st.stop && !st.check && e.kind !== 'additive' && <span className="text-ink-3 font-normal">all OK</span>}
                            {e.kind === 'additive' && <span className="text-ink-3 font-normal">trended only</span>}
                          </span>
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Caveat>
          The element table gives no numeric limits. Metals are judged against each unit’s own baseline, the same way the data-entry sheet treats iron and silicon: iron above 1.5 × baseline is Check and above 2 × is Stop; other metals use ppm above baseline. Molybdenum is trended only, because it is often an oil additive. All these limits are assumptions to confirm with the laboratory and can be changed on the Thresholds page.
        </Caveat>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <ChartCard
          title="Oil condition by compartment"
          subtitle={`Latest report per unit · last ${RECENT_DAYS} days`}
          table={{ head: ['Compartment', 'Normal', 'Caution', 'Critical'], rows: sevRows.map((r) => [r.label, ...r.values]) }}
        >
          <StackedBars rows={sevRows} keys={['Normal', 'Caution', 'Critical']} colors={['var(--risk-low)', 'var(--risk-medium)', 'var(--risk-critical)']} format={(v) => `${v}`} />
        </ChartCard>

        <section className="card p-4 flex flex-col gap-2 min-w-0">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-[13.5px] font-semibold">Flagged results · {shown.length}</h3>
              <div className="text-[12px] text-ink-3">{cell ? `${cell.element} in ${COMPARTMENT_LABEL[cell.comp].toLowerCase()}` : 'Latest report per unit, Stop first'}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="segmented">
                <button aria-pressed={comp === 'all'} onClick={() => setComp('all')}>
                  All
                </button>
                {COMPARTMENTS.map((c) => (
                  <button key={c} aria-pressed={comp === c} onClick={() => setComp(c)}>
                    {c === 'Gear' ? 'Gear' : c}
                  </button>
                ))}
              </div>
              <button className="btn" onClick={exportCsv}>
                <Icon name="download" size={14} /> CSV
              </button>
            </div>
          </header>
          <div className="scroll-area max-h-[420px]">
            {shown.length === 0 ? (
              <div className="text-ink-3 py-6 text-center">No results at Check or Stop for this selection.</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Unit</th>
                    <th>Result</th>
                    <th>Level</th>
                    <th>Likely source / cause</th>
                    <th>Sampled</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((f, i) => (
                    <tr key={i} className="clickable" onClick={() => setDrill({ assetId: f.sample.assetId, comp: f.sample.compartment })}>
                      <td className="align-top">
                        <b>{f.sample.assetId}</b>
                        <div className="text-[11px] text-ink-3">{d.unitById.get(f.sample.assetId)?.location}</div>
                      </td>
                      <td className="align-top">
                        <div>
                          {COMPARTMENT_LABEL[f.def.compartment]} · {f.def.label}
                        </div>
                        <div className="text-[11.5px] text-ink-3 tnum">
                          {typeof f.value === 'number' ? `${fmtValue(f.value, f.def.decimals)} ${f.def.unit}` : f.value} — {f.limit}
                        </div>
                      </td>
                      <td className="align-top">
                        <LevelChip level={f.level} />
                      </td>
                      <td className="align-top text-[12px] text-ink-2 max-w-[260px]">{f.def.sources ?? f.def.indication}</td>
                      <td className="align-top whitespace-nowrap text-[12px]">{fmtDate(f.sample.sampledAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      {drill && <UnitOilHistory assetId={drill.assetId} comp={drill.comp} history={histories.get(`${drill.assetId}|${drill.comp}`) ?? []} onClose={() => setDrill(null)} onUnit={() => nav.openUnit(drill.assetId)} />}
    </div>
  )
}

function UnitOilHistory({ assetId, comp, history, onClose, onUnit }: { assetId: string; comp: OilCompartment; history: OilSample[]; onClose: () => void; onUnit: () => void }) {
  const { data, d } = useStore()
  const u = d.unitById.get(assetId)
  const { condition, metals } = labGroups(comp)
  const cols = [...condition, ...metals].filter((def) => history.some((h) => h.values[def.key] !== undefined))
  const levelAt = (def: LabDef, i: number): Level | null => evaluate(def, data.labThresholds[def.key], history[i].values[def.key], labBaseline(history.slice(0, i), def.key))
  const dot: Record<string, string> = { warning: 'var(--risk-medium)', critical: 'var(--risk-critical)' }
  return (
    <section className="card p-4 flex flex-col gap-2">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[13.5px] font-semibold">
            {assetId} · {COMPARTMENT_LABEL[comp]} — report history
          </h3>
          <div className="text-[12px] text-ink-3">
            {u?.type} · {u?.location} · each value graded against this unit’s earlier reports (its own baseline after 3 reports)
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn" onClick={onUnit}>
            Unit health <Icon name="chevronRight" size={13} />
          </button>
          <button className="btn" onClick={onClose} aria-label="Close history">
            <Icon name="x" size={12} />
          </button>
        </div>
      </header>
      <div className="scroll-area">
        <table className="table" style={{ minWidth: 300 + cols.length * 84 }}>
          <thead>
            <tr>
              <th>Sampled</th>
              <th>Grade</th>
              {cols.map((c) => (
                <th key={c.key} className="num" title={c.sources ?? c.indication}>
                  {c.element ? c.element.replace(/.*\((\w+)\)/, '$1') : c.label}
                  <div className="font-normal text-[10.5px]">{c.unit === 'result' ? '' : c.unit}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {history.map((h, i) => (
              <tr key={h.id}>
                <td className="whitespace-nowrap">{fmtDate(h.sampledAt)}</td>
                <td>
                  <LevelChip level={h.severity === 'Critical' ? 'critical' : h.severity === 'Caution' ? 'warning' : 'ok'} />
                </td>
                {cols.map((c) => {
                  const v = h.values[c.key]
                  const lvl = v === undefined ? null : levelAt(c, i)
                  return (
                    <td key={c.key} className="num" style={{ fontWeight: lvl === 'critical' || lvl === 'warning' ? 700 : undefined }}>
                      {lvl && dot[lvl] && <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: dot[lvl] }} aria-label={lvl === 'critical' ? 'Stop' : 'Check'} />}
                      {v === undefined ? '·' : typeof v === 'number' ? fmtValue(v, c.decimals) : v}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
