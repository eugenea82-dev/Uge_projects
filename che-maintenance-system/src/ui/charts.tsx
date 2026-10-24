// Lightweight SVG charts. Spec: 2px lines, hairline solid gridlines, bars ≤ 24px
// with 4px rounded data-ends, 2px surface gaps between stacked segments, a
// legend for ≥ 2 series, hover tooltips, and a table view on every chart card.

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(600)
  useLayoutEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver((entries) => setW(Math.max(120, entries[0].contentRect.width)))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || 1
  const raw = span / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const start = Math.ceil(min / step) * step
  const out: number[] = []
  for (let v = start; v <= max + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000)
  return out
}

export interface LineSeries {
  name: string
  color: string
  values: (number | null)[]
  dashed?: boolean
}

export function Legend({ items }: { items: { name: string; color: string; dashed?: boolean; swatch?: 'line' | 'box' }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink-2">
      {items.map((i) => (
        <span key={i.name} className="inline-flex items-center gap-1.5">
          {i.swatch === 'box' ? (
            <span className="inline-block w-2.5 h-2.5 rounded-[3px]" style={{ background: i.color }} />
          ) : (
            <svg width="16" height="8" aria-hidden>
              <line x1="1" y1="4" x2="15" y2="4" stroke={i.color} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={i.dashed ? '3 3' : undefined} />
            </svg>
          )}
          {i.name}
        </span>
      ))}
    </div>
  )
}

export function LineChart({
  labels,
  series,
  height = 220,
  yMin,
  yMax,
  refLines = [],
  band,
  format = (v) => v.toFixed(1),
  shadeFrom,
  shadeLabel,
}: {
  labels: string[]
  series: LineSeries[]
  height?: number
  yMin?: number
  yMax?: number
  refLines?: { value: number; label: string; color?: string }[]
  band?: { lower: (number | null)[]; upper: (number | null)[]; color: string }
  format?: (v: number) => string
  /** shade the plot area from this index on (e.g., forecast region) */
  shadeFrom?: number
  shadeLabel?: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const m = { l: 40, r: 14, t: 12, b: 24 }
  const iw = width - m.l - m.r
  const ih = height - m.t - m.b
  const all = [
    ...series.flatMap((s) => s.values.filter((v): v is number => v !== null)),
    ...refLines.map((r) => r.value),
    ...(band ? [...band.lower, ...band.upper].filter((v): v is number => v !== null) : []),
  ]
  const lo = yMin ?? Math.floor(Math.min(...all) - 1)
  const hi = yMax ?? Math.ceil(Math.max(...all) + 1)
  const n = labels.length
  const x = (i: number) => m.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw)
  const y = (v: number) => m.t + ih - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo || 1)) * ih
  const ticks = niceTicks(lo, hi, 4)
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 56))))

  const path = (vals: (number | null)[]) => {
    let d = ''
    let pen = false
    vals.forEach((v, i) => {
      if (v === null) {
        pen = false
        return
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
      pen = true
    })
    return d
  }

  let bandPath = ''
  if (band) {
    const idx = band.lower.map((v, i) => (v !== null && band.upper[i] !== null ? i : -1)).filter((i) => i >= 0)
    if (idx.length) {
      bandPath = idx.map((i, k) => `${k ? 'L' : 'M'}${x(i)},${y(band.upper[i]!)}`).join('') + [...idx].reverse().map((i) => `L${x(i)},${y(band.lower[i]!)}`).join('') + 'Z'
    }
  }

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    const i = Math.round((px / rect.width) * (n - 1))
    setHover(Math.max(0, Math.min(n - 1, i)))
  }

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      <svg width={width} height={height} role="img" aria-label={series.map((s) => s.name).join(', ')}>
        {shadeFrom !== undefined && shadeFrom < n && (
          <g>
            <rect x={x(shadeFrom)} y={m.t} width={m.l + iw - x(shadeFrom)} height={ih} fill="var(--surface-2)" />
            {shadeLabel && (
              <text x={x(shadeFrom) + 6} y={m.t + 12} fontSize="10.5" fill="var(--ink-3)">
                {shadeLabel}
              </text>
            )}
          </g>
        )}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={m.l + iw} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth="1" />
            <text x={m.l - 6} y={y(t) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--ink-3)" className="tnum">
              {format(t)}
            </text>
          </g>
        ))}
        {labels.map((l, i) =>
          i % labelEvery === 0 || i === n - 1 ? (
            <text key={i} x={x(i)} y={height - 6} textAnchor="middle" fontSize="10.5" fill="var(--ink-3)">
              {l}
            </text>
          ) : null,
        )}
        {bandPath && <path d={bandPath} fill={band!.color} opacity="0.14" />}
        {refLines.map((r) => (
          <g key={r.label}>
            <line x1={m.l} x2={m.l + iw} y1={y(r.value)} y2={y(r.value)} stroke={r.color ?? 'var(--ink-3)'} strokeWidth="1.25" strokeDasharray="5 4" />
            <text x={m.l + iw - 4} y={y(r.value) - 4} textAnchor="end" fontSize="10.5" fill="var(--ink-2)">
              {r.label}
            </text>
          </g>
        ))}
        {series.map((s) => (
          <path key={s.name} d={path(s.values)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? '5 4' : undefined} />
        ))}
        {series.map((s) => {
          const last = s.values.reduce<number>((acc, v, i) => (v !== null ? i : acc), -1)
          return last >= 0 ? <circle key={s.name} cx={x(last)} cy={y(s.values[last]!)} r="4" fill={s.color} stroke="var(--surface)" strokeWidth="2" /> : null
        })}
        {hover !== null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + ih} stroke="var(--line-strong)" strokeWidth="1" />
            {series.map((s) =>
              s.values[hover] !== null && s.values[hover] !== undefined ? (
                <circle key={s.name} cx={x(hover)} cy={y(s.values[hover]!)} r="4.5" fill={s.color} stroke="var(--surface)" strokeWidth="2" />
              ) : null,
            )}
          </g>
        )}
        <rect x={m.l} y={m.t} width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      {hover !== null && (
        <div
          className="absolute pointer-events-none card px-2.5 py-1.5 text-[11.5px] z-10"
          style={{ left: Math.min(Math.max(x(hover) + 10, 0), width - 170), top: 6, minWidth: 140 }}
        >
          <div className="font-semibold mb-0.5">{labels[hover]}</div>
          {series.map((s) =>
            s.values[hover] !== null && s.values[hover] !== undefined ? (
              <div key={s.name} className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-ink-2">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ background: s.color }} />
                  {s.name}
                </span>
                <span className="tnum font-medium">{format(s.values[hover]!)}</span>
              </div>
            ) : null,
          )}
          {band && band.lower[hover] !== null && band.upper[hover] !== null && (
            <div className="text-ink-3 mt-0.5 tnum">
              range {format(band.lower[hover]!)}–{format(band.upper[hover]!)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function Sparkline({ values, color = 'var(--c1)', width = 84, height = 22, min, max }: { values: (number | null)[]; color?: string; width?: number; height?: number; min?: number; max?: number }) {
  const vs = values.filter((v): v is number => v !== null)
  if (!vs.length) return <span className="text-ink-3">—</span>
  const lo = min ?? Math.min(...vs)
  const hi = max ?? Math.max(...vs)
  const x = (i: number) => 2 + (i / Math.max(1, values.length - 1)) * (width - 6)
  const y = (v: number) => 2 + (height - 4) - ((v - lo) / (hi - lo || 1)) * (height - 4)
  let d = ''
  values.forEach((v, i) => {
    if (v !== null) d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
  })
  const lastI = values.reduce<number>((a, v, i) => (v !== null ? i : a), 0)
  return (
    <svg width={width} height={height} aria-hidden>
      <path d={d} fill="none" stroke="var(--ink-3)" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={x(lastI)} cy={y(values[lastI]!)} r="2.5" fill={color} />
    </svg>
  )
}

export interface BarRow {
  key: string
  label: ReactNode
  value: number
  detail?: string
  onClick?: () => void
}

/** Horizontal ranked bars (Pareto). Value at the tip; hover shows detail. */
export function BarList({ rows, color = 'var(--c1)', format = (v) => v.toFixed(0), max }: { rows: BarRow[]; color?: string; format?: (v: number) => string; max?: number }) {
  const [hover, setHover] = useState<string | null>(null)
  const top = max ?? Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <div
          key={r.key}
          className={`grid items-center gap-2 rounded-md px-1 ${r.onClick ? 'cursor-pointer' : ''}`}
          style={{ gridTemplateColumns: 'minmax(90px, 32%) 1fr', background: hover === r.key ? 'var(--surface-2)' : undefined }}
          onPointerEnter={() => setHover(r.key)}
          onPointerLeave={() => setHover(null)}
          onClick={r.onClick}
          title={r.detail}
        >
          <div className="truncate text-ink-2 text-[12px]">{r.label}</div>
          <div className="flex items-center gap-2 h-5">
            <div
              className="h-3.5"
              style={{ width: `${Math.max(1.5, (r.value / top) * 82)}%`, background: color, borderRadius: '0 4px 4px 0', opacity: hover && hover !== r.key ? 0.55 : 1 }}
            />
            <span className="text-[11.5px] tnum text-ink whitespace-nowrap">{format(r.value)}</span>
            {hover === r.key && r.detail && <span className="text-[11.5px] text-ink-3 whitespace-nowrap">· {r.detail}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Horizontal stacked bars with 2px surface gaps between segments. */
export function StackedBars({
  rows,
  keys,
  colors,
  format = (v) => v.toFixed(1),
}: {
  rows: { label: string; values: number[] }[]
  keys: string[]
  colors: string[]
  format?: (v: number) => string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...rows.map((r) => r.values.reduce((s, v) => s + v, 0)))
  return (
    <div className="flex flex-col gap-2">
      <Legend items={keys.map((k, i) => ({ name: k, color: colors[i], swatch: 'box' }))} />
      <div className="flex flex-col gap-1.5 relative">
        {rows.map((r, ri) => {
          const total = r.values.reduce((s, v) => s + v, 0)
          return (
            <div key={r.label} className="grid items-center gap-2 relative" style={{ gridTemplateColumns: 'minmax(90px, 26%) 1fr' }} onPointerEnter={() => setHover(ri)} onPointerLeave={() => setHover(null)}>
              <div className="truncate text-ink-2 text-[12px]">{r.label}</div>
              <div className="flex items-center gap-2 h-5">
                <div className="flex h-3.5 gap-[2px]" style={{ width: `${(total / max) * 82}%`, minWidth: total > 0 ? 3 : 0 }}>
                  {r.values.map((v, i) =>
                    v > 0 ? (
                      <div
                        key={i}
                        style={{
                          flexGrow: v,
                          flexBasis: 0,
                          background: colors[i],
                          borderRadius: i === r.values.map((x, k) => (x > 0 ? k : -1)).filter((k) => k >= 0).pop() ? '0 4px 4px 0' : 0,
                          opacity: hover !== null && hover !== ri ? 0.55 : 1,
                        }}
                      />
                    ) : null,
                  )}
                </div>
                <span className="text-[11.5px] tnum whitespace-nowrap">{format(total)}</span>
              </div>
              {hover === ri && (
                <div className="absolute left-[26%] top-6 z-20 card px-2.5 py-1.5 text-[11.5px] pointer-events-none" style={{ minWidth: 190 }}>
                  <div className="font-semibold mb-0.5">{r.label}</div>
                  {keys.map((k, i) => (
                    <div key={k} className="flex justify-between gap-3">
                      <span className="inline-flex items-center gap-1.5 text-ink-2">
                        <span className="inline-block w-2 h-2 rounded-[2px]" style={{ background: colors[i] }} />
                        {k}
                      </span>
                      <span className="tnum">{format(r.values[i])}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** One-row distribution bar, e.g. fleet by status. */
export function DistributionBar({ parts }: { parts: { key: string; label: string; value: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1
  return (
    <div className="flex h-3 w-full gap-[2px] rounded-[4px] overflow-hidden">
      {parts
        .filter((p) => p.value > 0)
        .map((p) => (
          <div key={p.key} title={`${p.label}: ${p.value}`} style={{ flexGrow: p.value / total, flexBasis: 0, background: p.color }} />
        ))}
    </div>
  )
}

/** Chart card with a Chart / Table toggle — the table is the accessible fallback. */
export function ChartCard({
  title,
  subtitle,
  children,
  table,
  actions,
  className = '',
}: {
  title: string
  subtitle?: ReactNode
  children: ReactNode
  table?: { head: string[]; rows: (string | number)[][] }
  actions?: ReactNode
  className?: string
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  return (
    <section className={`card p-4 flex flex-col gap-3 min-w-0 ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-[220px]">
          <h3 className="text-[13.5px] font-semibold">{title}</h3>
          {subtitle && <div className="text-[12px] text-ink-3 mt-0.5">{subtitle}</div>}
        </div>
        <div className="flex flex-wrap items-center gap-2 no-print">
          {actions}
          {table && (
            <div className="segmented" role="group" aria-label="View">
              <button aria-pressed={view === 'chart'} onClick={() => setView('chart')}>
                Chart
              </button>
              <button aria-pressed={view === 'table'} onClick={() => setView('table')}>
                Table
              </button>
            </div>
          )}
        </div>
      </header>
      {view === 'chart' || !table ? (
        children
      ) : (
        <div className="scroll-area max-h-[320px]">
          <table className="table">
            <thead>
              <tr>
                {table.head.map((h, i) => (
                  <th key={h} className={i ? 'num' : ''}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className={j ? 'num' : ''}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
