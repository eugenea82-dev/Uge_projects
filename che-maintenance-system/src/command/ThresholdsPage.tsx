// Threshold and baseline settings (FR-11), quantified from the CHE Data Entry sheet.
// Shows the sheet's own wording next to the rule and numbers that implement it,
// flags every value we had to assume, and lets the Asset Maintenance Manager
// change the numbers. Every change is written to the audit trail.

import { useState } from 'react'
import { BASELINE_TOLERANCE_SD, TREND_CONSECUTIVE } from '../domain/constants.ts'
import { COMPARTMENTS, COMPARTMENT_LABEL, DAILY, DAILY_SYSTEMS, EQUIPMENT_TYPES, LAB, bands, refLabel, ruleText, type DailyDef, type LabDef } from '../domain/catalog.ts'
import type { EquipmentType, Threshold } from '../domain/types.ts'
import { useStore } from '../store.tsx'
import { Caveat } from '../ui/badges.tsx'
import { Icon } from '../ui/Icon.tsx'

type NumField = 'warning' | 'critical' | 'ref'

/** Warning must be the milder of the two for the rule to make sense. */
function orderProblem(def: DailyDef | LabDef, t: Threshold): string | null {
  if (def.rule === 'category') return null
  const milderIsLarger = def.rule === 'below'
  const ok = milderIsLarger ? t.warning > t.critical : t.warning < t.critical
  if (!ok) return `${def.label}: the Check value must be ${milderIsLarger ? 'above' : 'below'} the Stop value for this rule.`
  if (def.ref && def.rule !== 'isoAboveRef' && !(Number(t.ref) > 0)) return `${def.label}: the reference must be a positive number.`
  return null
}

function AssumedBadge({ text }: { text?: string }) {
  return text ? (
    <span className="chip mt-1" style={{ color: 'var(--st-orange)' }} title={text}>
      <Icon name="info" size={11} /> Assumed
    </span>
  ) : null
}

export function ThresholdsPage() {
  const { data, can, setThreshold, setLabThreshold } = useStore()
  const [tab, setTab] = useState<'daily' | 'oil'>('daily')
  const [type, setType] = useState<EquipmentType>('Reach Stacker')
  const [err, setErr] = useState<string | null>(null)
  const editable = can('configureThresholds')
  const assumedCount = [...DAILY, ...LAB].filter((d) => d.assumed).length

  const commitDaily = (def: DailyDef, field: NumField, raw: string) => {
    const v = Number(raw)
    if (!Number.isFinite(v)) return setErr('Enter a number.')
    const next = { ...data.thresholds[type][def.key], [field]: v }
    const p = orderProblem(def, next)
    if (p) return setErr(p)
    setErr(null)
    setThreshold(type, def.key, field, v)
  }
  const commitLab = (def: LabDef, field: NumField | 'refCode', raw: string) => {
    const v: number | string = field === 'refCode' ? raw.trim() : Number(raw)
    if (typeof v === 'number' && !Number.isFinite(v)) return setErr('Enter a number.')
    if (field === 'refCode' && !/^\d{1,2}\/\d{1,2}(\/\d{1,2})?$/.test(String(v))) return setErr('ISO target code like 18/16/13.')
    const next = { ...data.labThresholds[def.key], [field]: v }
    const p = orderProblem(def, next)
    if (p) return setErr(p)
    setErr(null)
    setLabThreshold(def.key, field, v)
  }

  const numInput = (label: string, value: number | string | undefined, onCommit: (raw: string) => void, wide = false) => (
    <input
      key={`${label}-${value}`}
      className={`field tnum text-right ${wide ? '!w-[92px]' : '!w-[72px]'}`}
      defaultValue={value ?? ''}
      disabled={!editable}
      inputMode="decimal"
      onBlur={(e) => e.target.value !== String(value ?? '') && onCommit(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      aria-label={label}
    />
  )

  const rowFor = (def: DailyDef | LabDef, t: Threshold, onCommit: (f: NumField | 'refCode', raw: string) => void) => {
    const b = def.rule === 'category' ? null : bands(def, t)
    return (
      <tr key={def.key}>
        <td className="align-top">
          <div className="font-medium">{def.label}</div>
          <div className="text-[11.5px] text-ink-3">
            Sheet: {def.csvWarning ? `Warning “${def.csvWarning}”` : 'no warning level'} · Critical “{def.csvCritical}”
          </div>
          <AssumedBadge text={def.assumed} />
        </td>
        <td className="align-top text-ink-2 text-[12px] max-w-[220px]">{ruleText(def, t)}</td>
        <td className="num align-top">
          {def.rule === 'isoAboveRef' ? (
            numInput(`${def.label} target code`, t.refCode, (raw) => onCommit('refCode', raw), true)
          ) : def.ref ? (
            <div className="flex flex-col items-end gap-0.5">
              {numInput(`${def.label} reference`, t.ref, (raw) => onCommit('ref', raw), true)}
              <span className="text-[10.5px] text-ink-3">{refLabel(def)}</span>
            </div>
          ) : (
            <span className="text-ink-3">—</span>
          )}
        </td>
        <td className="num align-top">{def.rule === 'category' ? <span className="text-ink-3">list</span> : numInput(`${def.label} check value`, t.warning, (raw) => onCommit('warning', raw))}</td>
        <td className="num align-top">{def.rule === 'category' ? <span className="text-ink-3">list</span> : numInput(`${def.label} stop value`, t.critical, (raw) => onCommit('critical', raw))}</td>
        <td className="align-top text-[12px]">
          {b ? (
            <div className="flex flex-col gap-0.5">
              <span>
                <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: 'var(--st-green)' }} />
                OK {b.ok}
              </span>
              <span>
                <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: 'var(--risk-medium)' }} />
                Check {b.check}
              </span>
              <span>
                <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: 'var(--risk-critical)' }} />
                Stop {b.stop}
              </span>
            </div>
          ) : (
            (def as LabDef).options?.map((o) => `${o.value} → ${o.level === 'ok' ? 'OK' : o.level === 'warning' ? 'Check' : 'Stop'}`).join(' · ')
          )}
        </td>
      </tr>
    )
  }

  const head = (
    <thead>
      <tr>
        <th>Parameter</th>
        <th>Rule</th>
        <th className="num">Reference</th>
        <th className="num">Check</th>
        <th className="num">Stop</th>
        <th>Resulting limits</th>
      </tr>
    </thead>
  )

  return (
    <div className="flex flex-col gap-4 max-w-[1250px]">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="segmented">
          <button aria-pressed={tab === 'daily'} onClick={() => setTab('daily')}>
            Daily readings · {DAILY.length}
          </button>
          <button aria-pressed={tab === 'oil'} onClick={() => setTab('oil')}>
            Oil analysis · {LAB.length}
          </button>
        </div>
        {tab === 'daily' && (
          <div className="segmented">
            {EQUIPMENT_TYPES.map((x) => (
              <button key={x} aria-pressed={type === x} onClick={() => setType(x)}>
                {x}
              </button>
            ))}
          </div>
        )}
        {!editable && <span className="text-[12px] text-ink-3">View only — thresholds are set by the Asset Maintenance Manager</span>}
      </div>
      <Caveat>
        All {DAILY.length + LAB.length} parameters from the CHE Data Entry sheet are quantified here. <b>{assumedCount} use assumed numbers</b> where the sheet says “TBA / As per OEM”, gives no warning level, or measures against an OEM target or new-oil value we do not have yet. Hover “Assumed” to see the assumption; confirm each with the OEM manual or the lab (A-06). Changes apply to the next reading saved and are audited.
      </Caveat>
      {err && (
        <div className="caveat notice-danger" role="alert">
          {err}
        </div>
      )}

      {tab === 'daily' &&
        DAILY_SYSTEMS.map((sys) => (
          <section key={sys.id} className="card overflow-hidden">
            <h3 className="px-4 pt-3 text-[13.5px] font-semibold">{sys.title}</h3>
            <div className="scroll-area">
              <table className="table">
                {head}
                <tbody>{DAILY.filter((d) => d.system === sys.id).map((d) => rowFor(d, data.thresholds[type][d.key], (f, raw) => f !== 'refCode' && commitDaily(d, f, raw)))}</tbody>
              </table>
            </div>
          </section>
        ))}

      {tab === 'oil' &&
        COMPARTMENTS.map((c) => (
          <section key={c} className="card overflow-hidden">
            <h3 className="px-4 pt-3 text-[13.5px] font-semibold">{COMPARTMENT_LABEL[c]} analysis</h3>
            <div className="scroll-area">
              <table className="table">
                {head}
                <tbody>{LAB.filter((d) => d.compartment === c).map((d) => rowFor(d, data.labThresholds[d.key], (f, raw) => commitLab(d, f, raw)))}</tbody>
              </table>
            </div>
          </section>
        ))}

      <section className="card p-4 grid gap-3 sm:grid-cols-3">
        <div>
          <div className="label">Unit baseline</div>
          <div className="text-[15px] font-semibold">Own history</div>
          <div className="text-[12px] text-ink-3">“Above/below baseline” rules use the unit’s first 30 daily readings (needs 10) or its earlier lab reports (needs 3). Until then the fleet default reference applies.</div>
        </div>
        <div>
          <div className="label">Baseline deviation</div>
          <div className="text-[15px] font-semibold">± {BASELINE_TOLERANCE_SD} σ</div>
          <div className="text-[12px] text-ink-3">Extra early warning for absolute-limit readings that drift far from the unit’s normal (FR-12).</div>
        </div>
        <div>
          <div className="label">Sustained deterioration</div>
          <div className="text-[15px] font-semibold">{TREND_CONSECUTIVE} readings in a row</div>
          <div className="text-[12px] text-ink-3">Flags a trend even while still inside the limits (FR-13).</div>
        </div>
      </section>
    </div>
  )
}
