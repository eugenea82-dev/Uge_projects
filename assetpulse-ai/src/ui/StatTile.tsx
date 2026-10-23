import type { ReactNode } from 'react'
import { Icon } from './Icon.tsx'

export function StatTile({
  label,
  value,
  sub,
  icon,
  tone,
  onClick,
  trend,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  icon?: string
  tone?: 'ok' | 'danger' | 'warn'
  onClick?: () => void
  trend?: ReactNode
}) {
  const toneColor = tone === 'danger' ? 'var(--danger)' : tone === 'ok' ? 'var(--ok-ink)' : tone === 'warn' ? 'var(--st-orange)' : 'var(--ink-3)'
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag className={`card p-3.5 flex flex-col gap-1 text-left min-w-0 ${onClick ? 'hover:brightness-[0.98] cursor-pointer' : ''}`} onClick={onClick}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-ink-2 font-medium truncate">{label}</span>
        {icon && <Icon name={icon} size={15} className="text-ink-3" />}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="text-[24px] leading-tight font-semibold tracking-tight">{value}</div>
        {trend}
      </div>
      {sub && (
        <div className="text-[11.5px] line-clamp-2" style={{ color: toneColor }}>
          {sub}
        </div>
      )}
    </Tag>
  )
}
