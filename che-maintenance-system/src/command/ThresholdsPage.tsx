// Threshold and baseline settings (FR-11). Only the Asset Maintenance Manager
// can change limits; every change is written to the audit trail.

import { useState } from 'react'
import { BASELINE_TOLERANCE_SD, PARAMS, TREND_CONSECUTIVE } from '../domain/constants.ts'
import type { EquipmentType, ParamKey, Threshold } from '../domain/types.ts'
import { useStore } from '../store.tsx'
import { Caveat } from '../ui/badges.tsx'

const TYPES: EquipmentType[] = ['Reach Stacker', 'Forklift', 'Empty Container Handler', 'Yard Tractor']

export function ThresholdsPage() {
  const { data, can, setThreshold } = useStore()
  const [type, setType] = useState<EquipmentType>('Reach Stacker')
  const editable = can('configureThresholds')
  const t = data.thresholds[type]
  const [err, setErr] = useState<string | null>(null)

  const commit = (key: ParamKey, field: keyof Threshold, raw: string) => {
    const v = Number(raw)
    const p = PARAMS.find((x) => x.key === key)!
    const cur = t[key]
    const next = { ...cur, [field]: v }
    if (!Number.isFinite(v)) return setErr('Enter a number.')
    const okOrder = p.direction === 'high' ? next.warning < next.critical : next.warning > next.critical
    if (!okOrder) return setErr(`${p.label}: the warning limit must be ${p.direction === 'high' ? 'below' : 'above'} the critical limit.`)
    if (next.min >= next.max) return setErr(`${p.label}: the valid range minimum must be below the maximum.`)
    setErr(null)
    setThreshold(type, key, field, v)
  }

  return (
    <div className="flex flex-col gap-4 max-w-[1100px]">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="segmented">
          {TYPES.map((x) => (
            <button key={x} aria-pressed={type === x} onClick={() => setType(x)}>
              {x}
            </button>
          ))}
        </div>
        {!editable && <span className="text-[12px] text-ink-3">View only — thresholds are set by the Asset Maintenance Manager</span>}
      </div>
      <Caveat>Defaults are placeholders until OEM manuals are loaded for every make/model (A-06). Changes apply on the next reading save and nightly scoring run, and are audited.</Caveat>
      {err && <div className="caveat notice-danger" role="alert">{err}</div>}
      <section className="card overflow-hidden">
        <table className="table">
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Component</th>
              <th>Worse when</th>
              <th className="num">Warning</th>
              <th className="num">Critical</th>
              <th className="num">Valid min</th>
              <th className="num">Valid max</th>
            </tr>
          </thead>
          <tbody>
            {PARAMS.map((p) => (
              <tr key={p.key}>
                <td className="font-medium">
                  {p.label} <span className="text-ink-3">({p.unit})</span>
                </td>
                <td>{p.component}</td>
                <td className="text-ink-2">{p.direction === 'high' ? 'Higher' : 'Lower'}</td>
                {(['warning', 'critical', 'min', 'max'] as const).map((f) => (
                  <td key={f} className="num">
                    <input
                      key={`${type}-${p.key}-${f}-${t[p.key][f]}`}
                      className="field tnum text-right !w-[86px]"
                      defaultValue={t[p.key][f]}
                      disabled={!editable}
                      inputMode="decimal"
                      onBlur={(e) => e.target.value !== String(t[p.key][f]) && commit(p.key, f, e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      aria-label={`${p.label} ${f}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card p-4 grid gap-3 sm:grid-cols-2">
        <div>
          <div className="label">Baseline tolerance</div>
          <div className="text-[15px] font-semibold">± {BASELINE_TOLERANCE_SD} σ</div>
          <div className="text-[12px] text-ink-3">Each unit’s baseline is calculated from its own first 30 readings (FR-11, FR-12).</div>
        </div>
        <div>
          <div className="label">Sustained deterioration</div>
          <div className="text-[15px] font-semibold">{TREND_CONSECUTIVE} consecutive worsening readings</div>
          <div className="text-[12px] text-ink-3">Flags a trend even while still below the limit (FR-13).</div>
        </div>
      </section>
    </div>
  )
}
