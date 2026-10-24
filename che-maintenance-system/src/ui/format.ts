import { DAY, HOUR } from '../domain/constants.ts'

export const fmtPct = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? '—' : `${v.toFixed(digits)}%`)

export const fmtHours = (v: number | null | undefined) => {
  if (v === null || v === undefined) return '—'
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K h`
  if (v >= 100) return `${Math.round(v)} h`
  return `${v.toFixed(1)} h`
}

export const fmtNum = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })

export const fmtPhp = (v: number) => `₱${v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v.toFixed(0)}`

export const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

export const fmtDateTime = (t: number) =>
  new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export const fmtTime = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

export function fmtAgo(t: number, now: number) {
  const d = now - t
  if (d < 0) return `in ${fmtDuration(-d)}`
  if (d < 60_000) return 'just now'
  return `${fmtDuration(d)} ago`
}

export function fmtDuration(ms: number) {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / 60_000))} min`
  if (ms < DAY) return `${(ms / HOUR).toFixed(ms < 10 * HOUR ? 1 : 0)} h`
  return `${(ms / DAY).toFixed(ms < 10 * DAY ? 1 : 0)} d`
}

/** Local date+time string for <input type="datetime-local">. */
export function toLocalInput(t: number) {
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function toLocalDateInput(t: number) {
  return toLocalInput(t).slice(0, 10)
}

/** Build and download a CSV file (FR-28 / NFR-K02). */
export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
