import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { isOverdue } from '../domain/alerts.ts'
import { HOUR, LOCATIONS, STALE_DATA_HOURS } from '../domain/constants.ts'
import type { User } from '../domain/types.ts'
import { useStore } from '../store.tsx'
import { downloadCsv, fmtAgo, fmtTime } from '../ui/format.ts'
import { AppIcon, Icon } from '../ui/Icon.tsx'
import { Sheet, Toast } from '../ui/Sheet.tsx'
import { AboutSheet, KpiGuideSheet } from './HelpSheets.tsx'
import { Nav, useNav, type AppId, type NavCtx, type Route } from './nav.tsx'
import { PAGES, type PageDef } from './pages.tsx'

export type ThemePref = 'system' | 'light' | 'dark'

const APP_META: Record<AppId, { name: string; icon: string; tint: string }> = {
  portal: { name: 'Equipment Specialist Portal', icon: 'wrench', tint: 'linear-gradient(160deg,#64d2ff,#0a84ff)' },
  command: { name: 'Command Center', icon: 'target', tint: 'linear-gradient(160deg,#ff9f0a,#ff375f)' },
}

export function Desktop({ user, onSignOut, onLock, theme, setTheme }: { user: User; onSignOut: () => void; onLock: () => void; theme: ThemePref; setTheme: (t: ThemePref) => void }) {
  const store = useStore()
  const apps: AppId[] = user.role === 'AM_MANAGER' ? ['command', 'portal'] : ['portal']
  const [route, setRoute] = useState<Route>({ app: apps[0], page: apps[0] === 'command' ? 'overview' : 'home' })
  const [history, setHistory] = useState<Route[]>([])
  const [maximized, setMaximized] = useState(false)
  const [sidebar, setSidebar] = useState(true)
  const [sheet, setSheet] = useState<'about' | 'kpi' | 'reset' | null>(null)
  const [toast, setToast] = useState<{ message: ReactNode; tone: 'ok' | 'danger' | 'info' } | null>(null)

  const go = useCallback<NavCtx['go']>((r) => {
    setRoute((cur) => {
      setHistory((h) => [...h.slice(-30), cur])
      return { app: r.app ?? cur.app, page: r.page, assetId: r.assetId, alertId: r.alertId, filter: r.filter }
    })
  }, [])
  const nav: NavCtx = {
    route,
    go,
    openUnit: (assetId) => go({ page: 'unit', assetId }),
    openAlert: (alertId) => go({ page: 'alerts', alertId }),
    back: () =>
      setHistory((h) => {
        const prev = h[h.length - 1]
        if (prev) setRoute(prev)
        return h.slice(0, -1)
      }),
    canGoBack: history.length > 0,
    toast: (message, tone = 'ok') => setToast({ message, tone }),
  }

  const pages = PAGES[route.app]
  const page: PageDef = pages.find((p) => p.id === route.page) ?? pages[0]

  // Badges: alerts needing this user's action
  const { data: sData, inScope, now } = store
  const actionable = useMemo(() => {
    const scoped = sData.alerts.filter((a) => a.status !== 'Closed' && inScope(a.assetId))
    const needDecision = scoped.filter((a) => a.status === 'Open')
    const overdue = needDecision.filter((a) => isOverdue(a, now))
    const pendingAuth = scoped.filter((a) => a.authorization?.state === 'Pending')
    return { needDecision, overdue, pendingAuth }
  }, [sData.alerts, inScope, now])

  const badgeFor = (id: string) => {
    if (id === 'alerts') return route.app === 'command' ? actionable.pendingAuth.length + actionable.overdue.length : actionable.needDecision.length
    return 0
  }

  const switchApp = (app: AppId) => go({ app, page: app === 'command' ? 'overview' : 'home' })

  return (
    <Nav.Provider value={nav}>
      <div className="fixed inset-0 wallpaper flex flex-col">
        <MenuBar
          user={user}
          app={route.app}
          pages={pages}
          theme={theme}
          setTheme={setTheme}
          onSignOut={onSignOut}
          onLock={onLock}
          onSheet={setSheet}
          onToggleSidebar={() => setSidebar((s) => !s)}
          onToggleMax={() => setMaximized((m) => !m)}
          notifications={actionable}
        />
        <div className={`flex-1 min-h-0 flex justify-center ${maximized ? '' : 'px-2 pt-2 sm:px-4 sm:pt-4 lg:px-6 pb-[84px]'}`}>
          <div className={`mac-window w-full flex flex-col min-h-0 ${maximized ? '!rounded-none' : 'max-w-[1600px]'}`}>
            <div className="flex-1 min-h-0 flex">
              {sidebar && (
                <aside className="sidebar hidden md:flex flex-col w-[232px] shrink-0 min-h-0">
                  <div className="h-[52px] flex items-center gap-2 px-4 shrink-0">
                    <TrafficLights onClose={onSignOut} onMin={onLock} onMax={() => setMaximized((m) => !m)} />
                  </div>
                  <nav className="scroll-area flex-1 px-2.5 pb-4 flex flex-col gap-0.5" aria-label="Sections">
                    <div className="label px-2 pt-1 pb-1.5">{APP_META[route.app].name}</div>
                    {pages
                      .filter((p) => !p.hidden)
                      .map((p) => {
                        const b = badgeFor(p.id)
                        const active = page.id === p.id && !(p.id === 'board' && route.filter)
                        return (
                          <button key={p.id} className="side-item" aria-current={active ? 'page' : undefined} onClick={() => go({ page: p.id })}>
                            <Icon name={p.icon} size={16} className="side-icon" />
                            <span className="flex-1 truncate">{p.title}</span>
                            {b > 0 && <span className="text-[11px] tnum px-1.5 rounded-full bg-surface-3 text-ink-2">{b}</span>}
                          </button>
                        )
                      })}
                    <div className="label px-2 pt-4 pb-1.5">{user.locations ? 'My branches' : 'Locations'}</div>
                    {(user.locations ?? [...LOCATIONS]).map((loc) => (
                      <button key={loc} className="side-item" aria-current={route.page === 'board' && route.filter === loc ? 'page' : undefined} onClick={() => go({ page: 'board', filter: loc })}>
                        <Icon name="building" size={15} className="side-icon" />
                        <span className="flex-1 truncate">{loc}</span>
                        <LocationDot loc={loc} />
                      </button>
                    ))}
                  </nav>
                  <div className="px-4 py-3 border-t border-line text-[11px] text-ink-3 leading-snug">
                    Release 1 pilot prototype · v0.1
                    <br />
                    All figures are simulated
                  </div>
                </aside>
              )}
              <main className="flex-1 min-w-0 flex flex-col min-h-0 bg-[var(--window)]">
                <div className="toolbar h-[52px] shrink-0 flex items-center gap-3 px-4">
                  {!sidebar && <TrafficLights onClose={onSignOut} onMin={onLock} onMax={() => setMaximized((m) => !m)} />}
                  <button className="btn !h-7 !w-7 !p-0 hidden md:inline-flex" onClick={() => setSidebar((s) => !s)} aria-label="Toggle sidebar" title="Toggle sidebar">
                    <Icon name="list" size={15} />
                  </button>
                  <button className="btn !h-7 !w-7 !p-0" onClick={nav.back} disabled={!nav.canGoBack} aria-label="Back" title="Back">
                    <Icon name="chevronLeft" size={15} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold truncate">{route.page === 'board' && route.filter ? `${route.filter} · Status Board` : page.title}</div>
                    <div className="text-[11px] text-ink-3 truncate">{page.subtitle}</div>
                  </div>
                  <MobileNav pages={pages} current={page.id} go={(id) => go({ page: id })} />
                  <UnitSearch />
                </div>
                <div className="flex-1 min-h-0 scroll-area" key={`${route.app}/${route.page}/${route.assetId ?? ''}/${route.filter ?? ''}`}>
                  <StaleBanner />
                  <div className="p-4 lg:p-5 animate-in">{page.render(route)}</div>
                </div>
              </main>
            </div>
          </div>
        </div>
        {!maximized && <Dock apps={apps} active={route.app} onApp={switchApp} onHelp={() => setSheet('kpi')} onLock={onLock} />}
        {sheet === 'about' && <AboutSheet onClose={() => setSheet(null)} />}
        {sheet === 'kpi' && <KpiGuideSheet onClose={() => setSheet(null)} />}
        {sheet === 'reset' && (
          <Sheet
            title="Reset demo data?"
            onClose={() => setSheet(null)}
            width={440}
            footer={
              <>
                <button className="btn" onClick={() => setSheet(null)}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    store.resetDemo()
                    setSheet(null)
                    nav.toast('Demo data regenerated.')
                  }}
                >
                  Reset
                </button>
              </>
            }
          >
            <p className="text-ink-2">This discards every reading, status change, alert decision and threshold edit made in this browser and regenerates the simulated fleet.</p>
          </Sheet>
        )}
        {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
      </div>
    </Nav.Provider>
  )
}

function LocationDot({ loc }: { loc: string }) {
  const { d } = useStore()
  const units = d.activeUnits.filter((u) => u.location === loc)
  const down = units.filter((u) => d.rel.get(u.assetId)?.currentStatus?.status !== 'OPERATIONAL').length
  if (!down) return null
  return (
    <span className="text-[11px] tnum text-ink-3" title={`${down} unit(s) not operational`}>
      {down} down
    </span>
  )
}

function TrafficLights({ onClose, onMin, onMax }: { onClose: () => void; onMin: () => void; onMax: () => void }) {
  return (
    <div className="traffic-group flex items-center gap-2 no-print">
      <button className="traffic" style={{ background: '#ff5f57' }} onClick={onClose} title="Sign out" aria-label="Sign out">
        <Icon name="x" size={8} strokeWidth={3} className="text-black" />
      </button>
      <button className="traffic" style={{ background: '#febc2e' }} onClick={onMin} title="Lock screen" aria-label="Lock screen">
        <Icon name="minus" size={8} strokeWidth={3} className="text-black" />
      </button>
      <button className="traffic" style={{ background: '#28c840' }} onClick={onMax} title="Full screen" aria-label="Toggle full screen">
        <Icon name="expand" size={8} strokeWidth={3} className="text-black" />
      </button>
    </div>
  )
}

function MobileNav({ pages, current, go }: { pages: PageDef[]; current: string; go: (id: string) => void }) {
  return (
    <select className="field md:hidden !w-auto max-w-[150px]" value={current} onChange={(e) => go(e.target.value)} aria-label="Section">
      {pages
        .filter((p) => !p.hidden)
        .map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
    </select>
  )
}

/** Find a unit by asset ID, type, model, branch or risk level (FR-02). */
function UnitSearch() {
  const { scopedUnits, d } = useStore()
  const nav = useNav()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const ql = q.trim().toLowerCase()
  const hits = ql
    ? scopedUnits
        .filter((u) => {
          const s = d.scores.get(u.assetId)
          return [u.assetId, u.type, u.make, u.model, u.location, s?.level ?? ''].some((f) => f.toLowerCase().includes(ql))
        })
        .slice(0, 8)
    : []
  return (
    <div className="relative hidden sm:block w-[220px]">
      <Icon name="search" size={14} className="absolute left-2 top-[7px] text-ink-3" />
      <input
        className="field !pl-7"
        placeholder="Search units, models, risk…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && hits[0]) {
            nav.openUnit(hits[0].assetId)
            setQ('')
          }
        }}
        aria-label="Search units"
      />
      {open && hits.length > 0 && (
        <div className="menu-panel right-0 !top-[32px] w-[300px]">
          {hits.map((u) => (
            <button
              key={u.assetId}
              onMouseDown={() => {
                nav.openUnit(u.assetId)
                setQ('')
              }}
            >
              <span>
                <span className="font-semibold">{u.assetId}</span> <span className="opacity-70">· {u.type}</span>
              </span>
              <span className="opacity-70 text-[11px]">{u.location}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** NFR-C04: warn when the last EMMS sync or scoring run is older than 26 hours. */
function StaleBanner() {
  const { data, now } = useStore()
  const age = now - Math.min(data.sync.emmsLastSync, data.sync.scoringLastRun)
  if (age < STALE_DATA_HOURS * HOUR) return null
  return (
    <div className="mx-4 lg:mx-5 mt-4 caveat notice-danger">
      <Icon name="alert" size={15} className="text-danger mt-[1px]" />
      <div>
        <b>Stale data.</b> The last EMMS sync / risk-scoring run was {fmtAgo(Math.min(data.sync.emmsLastSync, data.sync.scoringLastRun), now)}. Figures may not reflect today’s work orders.
      </div>
    </div>
  )
}

function MenuBar({
  user,
  app,
  pages,
  theme,
  setTheme,
  onSignOut,
  onLock,
  onSheet,
  onToggleSidebar,
  onToggleMax,
  notifications,
}: {
  user: User
  app: AppId
  pages: PageDef[]
  theme: ThemePref
  setTheme: (t: ThemePref) => void
  onSignOut: () => void
  onLock: () => void
  onSheet: (s: 'about' | 'kpi' | 'reset') => void
  onToggleSidebar: () => void
  onToggleMax: () => void
  notifications: { needDecision: { id: string; assetId: string; level: string; component: string }[]; overdue: unknown[]; pendingAuth: { id: string; assetId: string; level: string; component: string }[] }
}) {
  const { data, now, d } = useStore()
  const nav = useNav()
  const [open, setOpen] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [])

  const exportKpis = () => {
    const rows: (string | number)[][] = [['Asset ID', 'Type', 'Make', 'Model', 'Location', 'Current status', 'Availability 13w %', 'Failure events 13w', 'MTBF h', 'MTTR h', 'Operational constraint h', 'Risk level', 'Risk score']]
    for (const u of d.activeUnits) {
      const r = d.rel.get(u.assetId)!
      const s = d.scores.get(u.assetId)
      rows.push([u.assetId, u.type, u.make, u.model, u.location, r.currentStatus?.status ?? '', r.rolling.availabilityPct?.toFixed(1) ?? '', r.rolling.failureEvents, r.rolling.mtbfH?.toFixed(0) ?? '', r.rolling.mttrH?.toFixed(1) ?? '', r.rolling.extH.toFixed(1), s?.level ?? 'Insufficient data', s?.score ?? ''])
    }
    downloadCsv(`assetpulse-fleet-kpis-${new Date(now).toISOString().slice(0, 10)}.csv`, rows)
  }

  const stale = now - Math.min(data.sync.emmsLastSync, data.sync.scoringLastRun) > STALE_DATA_HOURS * HOUR
  const bellCount = app === 'command' ? notifications.pendingAuth.length + notifications.overdue.length : notifications.needDecision.length
  const bellItems = app === 'command' ? notifications.pendingAuth : notifications.needDecision

  return (
    <div ref={ref} className="menubar shrink-0 flex items-center px-2 gap-0.5 text-[13px] z-40 no-print">
      <span className="px-2 flex items-center">
        <AppIcon size={16} />
      </span>
      <Menu open={open} setOpen={setOpen} id="app" label="AssetPulse AI" bold>
        <button onClick={() => onSheet('about')}>About AssetPulse AI</button>
        <div className="menu-sep" />
        <button onClick={() => onSheet('reset')}>Reset demo data…</button>
        <div className="menu-sep" />
        <button onClick={onLock}>
          Lock Screen <span className="opacity-60">⌃⌘Q</span>
        </button>
        <button onClick={onSignOut}>Sign Out {user.displayName}</button>
      </Menu>
      <span className="hidden sm:flex">
        <Menu open={open} setOpen={setOpen} id="file" label="File">
          <button onClick={exportKpis}>Export fleet KPIs (CSV)</button>
          <button onClick={() => window.print()}>
            Print / Save as PDF… <span className="opacity-60">⌘P</span>
          </button>
        </Menu>
        <Menu open={open} setOpen={setOpen} id="view" label="View">
          {(['system', 'light', 'dark'] as ThemePref[]).map((t) => (
            <button key={t} onClick={() => setTheme(t)}>
              <span>{theme === t ? '✓ ' : ' '}Appearance: {t[0].toUpperCase() + t.slice(1)}</span>
            </button>
          ))}
          <div className="menu-sep" />
          <button onClick={onToggleSidebar}>Toggle Sidebar</button>
          <button onClick={onToggleMax}>Enter / Exit Full Screen</button>
        </Menu>
        <Menu open={open} setOpen={setOpen} id="go" label="Go">
          {pages
            .filter((p) => !p.hidden)
            .map((p) => (
              <button key={p.id} onClick={() => nav.go({ page: p.id })}>
                {p.title}
              </button>
            ))}
        </Menu>
        <Menu open={open} setOpen={setOpen} id="help" label="Help">
          <button onClick={() => onSheet('kpi')}>KPI definitions & status model</button>
          <button onClick={() => onSheet('about')}>About this release</button>
        </Menu>
      </span>
      <div className="flex-1" />
      <span className="menu-item hidden lg:inline-flex gap-1.5 text-[12px]" title={`EMMS last sync ${new Date(data.sync.emmsLastSync).toLocaleString()} · scoring run ${new Date(data.sync.scoringLastRun).toLocaleString()}`}>
        <span className="w-2 h-2 rounded-full" style={{ background: stale ? 'var(--danger)' : 'var(--st-green)' }} />
        {stale ? 'Data stale' : `Data as of ${fmtTime(data.sync.scoringLastRun)}`}
      </span>
      <div className="relative">
        <button className="menu-item gap-1" aria-expanded={open === 'bell'} onClick={() => setOpen(open === 'bell' ? null : 'bell')} aria-label={`${bellCount} notifications`}>
          <Icon name="bell" size={15} />
          {bellCount > 0 && <span className="text-[11px] tnum font-semibold">{bellCount}</span>}
        </button>
        {open === 'bell' && (
          <div className="menu-panel right-0 w-[320px]" onClick={() => setOpen(null)}>
            <div className="menu-row !justify-start font-semibold">{app === 'command' ? 'Awaiting your authorization' : 'Alerts awaiting decision'}</div>
            {bellItems.length === 0 && <div className="menu-row opacity-60">Nothing waiting — you’re up to date.</div>}
            {bellItems.slice(0, 8).map((a) => (
              <button key={a.id} onClick={() => nav.openAlert(a.id)}>
                <span>
                  <b>{a.assetId}</b> · {a.component}
                </span>
                <span className="opacity-70 text-[11px]">{a.level}</span>
              </button>
            ))}
            {app === 'command' && notifications.overdue.length > 0 && (
              <>
                <div className="menu-sep" />
                <button onClick={() => nav.go({ page: 'alerts' })}>
                  <span>{notifications.overdue.length} alert(s) past decision SLA — escalated</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>
      <span className="menu-item hidden sm:inline-flex">{user.displayName}</span>
      <span className="menu-item tnum">{new Date(now).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
    </div>
  )
}

function Menu({ id, label, children, bold, open, setOpen }: { id: string; label: ReactNode; children: ReactNode; bold?: boolean; open: string | null; setOpen: (v: string | null) => void }) {
  return (
    <div className="relative">
      <button className={`menu-item ${bold ? 'font-semibold' : ''}`} aria-expanded={open === id} onClick={() => setOpen(open === id ? null : id)} onMouseEnter={() => open && setOpen(id)}>
        {label}
      </button>
      {open === id && (
        <div className="menu-panel left-0" onClick={() => setOpen(null)}>
          {children}
        </div>
      )}
    </div>
  )
}

function Dock({ apps, active, onApp, onHelp, onLock }: { apps: AppId[]; active: AppId; onApp: (a: AppId) => void; onHelp: () => void; onLock: () => void }) {
  const items: { key: string; label: string; icon: ReactNode; onClick: () => void; active?: boolean }[] = [
    ...apps.map((a) => ({
      key: a,
      label: APP_META[a].name,
      active: a === active,
      onClick: () => onApp(a),
      icon: (
        <span className="w-full h-full rounded-[12px] flex items-center justify-center text-white" style={{ background: APP_META[a].tint }}>
          <Icon name={APP_META[a].icon} size={24} strokeWidth={2} />
        </span>
      ),
    })),
    {
      key: 'help',
      label: 'KPI Guide',
      onClick: onHelp,
      icon: (
        <span className="w-full h-full rounded-[12px] flex items-center justify-center text-white" style={{ background: 'linear-gradient(160deg,#bf5af2,#5e5ce6)' }}>
          <Icon name="info" size={24} strokeWidth={2} />
        </span>
      ),
    },
    {
      key: 'lock',
      label: 'Lock Screen',
      onClick: onLock,
      icon: (
        <span className="w-full h-full rounded-[12px] flex items-center justify-center text-white" style={{ background: 'linear-gradient(160deg,#8e8e93,#48484a)' }}>
          <Icon name="lock" size={22} strokeWidth={2} />
        </span>
      ),
    },
  ]
  return (
    <div className="fixed bottom-2 left-1/2 -translate-x-1/2 z-30 no-print">
      <div className="dock flex items-end gap-2 px-2.5 py-2 rounded-[20px]">
        {items.map((it) => (
          <button key={it.key} className="dock-icon relative group flex flex-col items-center" onClick={it.onClick} aria-label={it.label}>
            <span className="pointer-events-none absolute -top-9 whitespace-nowrap rounded-md px-2 py-1 text-[11.5px] card opacity-0 group-hover:opacity-100 transition-opacity">{it.label}</span>
            <span className="block w-[46px] h-[46px] shadow-md rounded-[12px]">{it.icon}</span>
            <span className="h-[4px] w-[4px] mt-1 rounded-full" style={{ background: it.active ? 'rgba(0,0,0,0.55)' : 'transparent', boxShadow: it.active ? '0 0 0 0.5px rgba(255,255,255,0.6)' : undefined }} />
          </button>
        ))}
      </div>
    </div>
  )
}
