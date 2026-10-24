import { useEffect, type ReactNode } from 'react'
import { Icon } from './Icon.tsx'

/** macOS-style sheet (modal dialog). Esc or the backdrop closes it. */
export function Sheet({ title, subtitle, onClose, children, footer, width = 560 }: { title: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 sheet-backdrop flex items-start justify-center pt-[6vh] px-3" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet animate-in w-full flex flex-col max-h-[86vh]" style={{ maxWidth: width }} role="dialog" aria-modal="true">
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-line">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold">{title}</h2>
            {subtitle && <div className="text-[12px] text-ink-3 mt-0.5">{subtitle}</div>}
          </div>
          <button className="btn !h-7 !w-7 !p-0 !rounded-full" onClick={onClose} aria-label="Close">
            <Icon name="x" size={13} />
          </button>
        </div>
        <div className="px-5 py-4 scroll-area flex-1">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-line flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}

export function Field({ label, hint, error, children, htmlFor }: { label: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <label htmlFor={htmlFor} className="text-[12px] font-medium text-ink-2">
        {label}
      </label>
      {children}
      {error ? <div className="text-[11.5px] text-danger">{error}</div> : hint ? <div className="text-[11.5px] text-ink-3">{hint}</div> : null}
    </div>
  )
}

export function Empty({ icon = 'check', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 text-ink-3 gap-2">
      <Icon name={icon} size={28} />
      <div className="text-[13px] font-medium text-ink-2">{title}</div>
      {children && <div className="text-[12px] max-w-[360px]">{children}</div>}
    </div>
  )
}

export function Toast({ message, tone = 'ok', onClose }: { message: ReactNode; tone?: 'ok' | 'danger' | 'info'; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 5000)
    return () => clearTimeout(t)
  }, [onClose, message])
  return (
    <div className="fixed top-10 right-4 z-[70] animate-in card px-4 py-3 max-w-[380px] flex items-start gap-2.5" role="status">
      <Icon name={tone === 'danger' ? 'alert' : tone === 'info' ? 'info' : 'check'} size={16} className={tone === 'danger' ? 'text-danger' : 'text-accent'} />
      <div className="text-[12.5px] flex-1">{message}</div>
      <button onClick={onClose} className="text-ink-3" aria-label="Dismiss">
        <Icon name="x" size={12} />
      </button>
    </div>
  )
}
