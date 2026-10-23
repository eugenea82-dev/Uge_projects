// Audit trail (FR-30): append-only; there is no edit or delete anywhere in the UI.

import { useMemo, useState } from 'react'
import { useStore } from '../store.tsx'
import { downloadCsv, fmtDateTime } from '../ui/format.ts'
import { Icon } from '../ui/Icon.tsx'

export function AuditPage() {
  const { data } = useStore()
  const [q, setQ] = useState('')
  const [action, setAction] = useState('all')
  const actions = useMemo(() => [...new Set(data.audit.map((a) => a.action))].sort(), [data.audit])
  const rows = useMemo(
    () =>
      [...data.audit]
        .sort((a, b) => b.at - a.at)
        .filter((a) => action === 'all' || a.action === action)
        .filter((a) => !q || `${a.user} ${a.action} ${a.entity} ${a.before ?? ''} ${a.after ?? ''}`.toLowerCase().includes(q.toLowerCase())),
    [data.audit, q, action],
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-[260px]">
          <Icon name="search" size={14} className="absolute left-2 top-[7px] text-ink-3" />
          <input className="field !pl-7" placeholder="Search user, unit, value…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search audit trail" />
        </div>
        <select className="field !w-auto" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action">
          <option value="all">All actions</option>
          {actions.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <div className="flex-1" />
        <span className="text-[12px] text-ink-3">{rows.length} records · read-only</span>
        <button className="btn" onClick={() => downloadCsv('audit-trail.csv', [['Time', 'User', 'Role', 'Action', 'Entity', 'Before', 'After'], ...rows.map((a) => [new Date(a.at).toISOString(), a.user, a.role, a.action, a.entity, a.before, a.after])])}>
          <Icon name="download" size={14} /> CSV
        </button>
      </div>
      <section className="card overflow-hidden">
        <div className="scroll-area max-h-[72vh]">
          <table className="table">
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Before</th>
                <th>After</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap tnum text-ink-2">{fmtDateTime(a.at)}</td>
                  <td className="whitespace-nowrap">
                    {a.user}
                    <div className="text-[11px] text-ink-3">{a.role === 'SYSTEM' ? 'System' : a.role === 'AM_MANAGER' ? 'AM Manager' : 'Equipment Specialist'}</div>
                  </td>
                  <td className="whitespace-nowrap font-medium">{a.action}</td>
                  <td>{a.entity}</td>
                  <td className="text-ink-3">{a.before ?? '—'}</td>
                  <td className="text-ink-2">{a.after ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
