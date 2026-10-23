// Status and risk always use colour + icon + text label together (NFR-U03).

import type { ReactNode } from 'react'
import { RISK_META, STATUSES } from '../domain/constants.ts'
import type { AlertStatus, Cause, DataSufficiency, RiskLevel, StatusCode } from '../domain/types.ts'
import { Icon } from './Icon.tsx'

export function StatusDot({ status, size = 18 }: { status: StatusCode; size?: number }) {
  const s = STATUSES[status]
  return (
    <span
      className="inline-flex items-center justify-center rounded-full shrink-0"
      style={{ width: size, height: size, background: `var(${s.colorVar})`, color: s.colorName === 'Yellow' || s.colorName === 'Amber' ? '#1d1d1f' : '#fff' }}
      title={s.label}
    >
      <Icon name={s.icon} size={size * 0.62} strokeWidth={2.4} />
    </span>
  )
}

export function StatusBadge({ status, cause, short }: { status: StatusCode; cause?: Cause | null; short?: boolean }) {
  const s = STATUSES[status]
  return (
    <span className="chip">
      <StatusDot status={status} size={14} />
      {short ? s.short : s.label}
      {cause === 'external' && <span className="text-ink-3">· external</span>}
    </span>
  )
}

export function RiskBadge({ level, score }: { level: RiskLevel | null; score?: number }) {
  if (!level) {
    return (
      <span className="chip" title="Not enough recent readings to score this unit (FR-16)">
        <span className="inline-block w-3 h-3 rounded-full" style={{ boxShadow: 'inset 0 0 0 1.5px var(--ink-3)' }} />
        No score
      </span>
    )
  }
  const m = RISK_META[level]
  return (
    <span className="chip">
      <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full" style={{ background: `var(${m.colorVar})`, color: level === 'Medium' ? '#0b0b0b' : '#fff' }}>
        <Icon name={m.icon} size={9} strokeWidth={2.6} />
      </span>
      {level}
      {score !== undefined && <span className="text-ink-3 tnum">{score}</span>}
    </span>
  )
}

const ALERT_STATUS_ICON: Record<AlertStatus, string> = {
  Open: 'bell',
  Acknowledged: 'check',
  Scheduled: 'calendar',
  'In Progress': 'wrench',
  Closed: 'archive',
}

export function AlertStatusBadge({ status }: { status: AlertStatus }) {
  return (
    <span className="chip">
      <Icon name={ALERT_STATUS_ICON[status]} size={12} className="text-ink-2" />
      {status}
    </span>
  )
}

export function SufficiencyBadge({ s }: { s: DataSufficiency }) {
  const bars = s === 'Good' ? 3 : s === 'Limited' ? 2 : 1
  return (
    <span className="chip" title="Data sufficiency: readings captured in the last 30 days (FR-16, NFR-M02)">
      <span className="inline-flex items-end gap-[1.5px] h-3">
        {[1, 2, 3].map((b) => (
          <span key={b} className="w-[3px] rounded-[1px]" style={{ height: 3 + b * 3, background: b <= bars ? 'var(--ink-2)' : 'var(--line-strong)' }} />
        ))}
      </span>
      Data: {s}
    </span>
  )
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'danger' | 'ok' | 'info' }) {
  const color = tone === 'danger' ? 'var(--danger)' : tone === 'ok' ? 'var(--ok-ink)' : tone === 'info' ? 'var(--accent)' : 'var(--ink-2)'
  return (
    <span className="chip" style={{ color }}>
      {children}
    </span>
  )
}

/** Plain-language caveat for approximated figures (NFR-U07). */
export function Caveat({ children }: { children: ReactNode }) {
  return (
    <div className="caveat" role="note">
      <Icon name="info" size={15} className="mt-[1px] text-ink-2" />
      <div>{children}</div>
    </div>
  )
}
