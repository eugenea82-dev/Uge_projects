import { useEffect, useRef, useState } from 'react'
import type { User } from '../domain/types.ts'
import { AppIcon, Icon } from '../ui/Icon.tsx'
import { DEMO_HINTS, PUBLIC_ACCOUNTS, signIn } from './accounts.ts'

const ROLE_LABEL: Record<User['role'], string> = {
  EQUIPMENT_SPECIALIST: 'Equipment Specialist Portal',
  AM_MANAGER: 'Command Center',
}

function Avatar({ u, size = 72, selected }: { u: User; size?: number; selected?: boolean }) {
  const hue = u.role === 'AM_MANAGER' ? 'linear-gradient(160deg,#ff9f0a,#ff375f)' : u.username === 'preyes' ? 'linear-gradient(160deg,#64d2ff,#0a84ff)' : 'linear-gradient(160deg,#30d158,#0a9f6e)'
  return (
    <div
      className="rounded-full flex items-center justify-center text-white font-semibold transition-transform"
      style={{
        width: size,
        height: size,
        background: hue,
        fontSize: size * 0.36,
        boxShadow: selected ? '0 0 0 3px rgba(255,255,255,0.9), 0 10px 30px rgba(0,0,0,0.35)' : '0 6px 20px rgba(0,0,0,0.25)',
      }}
    >
      {u.initials}
    </div>
  )
}

export function Login({ onSignedIn, notice }: { onSignedIn: (u: User) => void; notice?: string }) {
  const [now, setNow] = useState(() => new Date())
  const [selected, setSelected] = useState<string | null>(null)
  const [other, setOther] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [shake, setShake] = useState(0)
  const [caps, setCaps] = useState(false)
  const [showHints, setShowHints] = useState(false)
  const pwRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (selected || other) pwRef.current?.focus()
  }, [selected, other])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const res = await signIn(other ? username : selected ?? '', password)
    setBusy(false)
    if (res.ok) onSignedIn(res.user)
    else {
      setError(res.message)
      setPassword('')
      setShake((s) => s + 1)
    }
  }

  const sel = PUBLIC_ACCOUNTS.find((u) => u.username === selected)
  const choosing = !selected && !other

  return (
    <div className="fixed inset-0 wallpaper overflow-auto" style={{ ['--wallpaper' as string]: 'radial-gradient(1200px 700px at 15% 10%, #2856c9 0%, transparent 60%), radial-gradient(900px 600px at 85% 15%, #8a2f8f 0%, transparent 55%), radial-gradient(1100px 800px at 55% 105%, #117a72 0%, transparent 60%), linear-gradient(135deg, #0d1638 0%, #1c1b3d 50%, #2a1430 100%)' }}>
      <div className="min-h-full flex flex-col items-center text-white px-4">
        <div className="mt-[7vh] text-center select-none">
          <div className="text-[17px] font-medium text-white/85">{now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          <div className="text-[84px] leading-none font-semibold tracking-tight text-white/95 tnum" style={{ textShadow: '0 4px 30px rgba(0,0,0,0.25)' }}>
            {now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, '')}
          </div>
        </div>

        <div className="mt-6 flex items-center gap-2.5 text-white/90">
          <AppIcon size={30} />
          <span className="text-[15px] font-semibold">AssetPulse AI</span>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center w-full py-8">
          {notice && (
            <div className="mb-6 rounded-xl px-4 py-2 text-[12.5px] bg-black/30 backdrop-blur-md flex items-center gap-2">
              <Icon name="lock" size={14} /> {notice}
            </div>
          )}

          {choosing ? (
            <div className="animate-in flex flex-col items-center">
              <div className="flex flex-wrap justify-center gap-8">
                {PUBLIC_ACCOUNTS.map((u) => (
                  <button key={u.username} className="group flex flex-col items-center gap-2.5 w-[150px] rounded-2xl p-3 hover:bg-white/10 focus-visible:bg-white/10 outline-none" onClick={() => setSelected(u.username)}>
                    <Avatar u={u} />
                    <span className="text-[14px] font-semibold">{u.displayName}</span>
                    <span className="text-[11.5px] text-white/65 -mt-2 text-center leading-tight">
                      {u.title}
                      <br />
                      <span className="text-white/45">{ROLE_LABEL[u.role]}</span>
                    </span>
                  </button>
                ))}
              </div>
              <button className="mt-6 text-[12.5px] text-white/70 hover:text-white inline-flex items-center gap-1.5" onClick={() => setOther(true)}>
                <Icon name="user" size={14} /> Other user…
              </button>
            </div>
          ) : (
            <form key={shake} onSubmit={submit} className={`flex flex-col items-center w-[260px] ${shake ? 'shake' : 'animate-in'}`} noValidate>
              {sel ? (
                <>
                  <Avatar u={sel} size={84} selected />
                  <div className="mt-3 text-[16px] font-semibold">{sel.displayName}</div>
                  <div className="text-[11.5px] text-white/60">{sel.title}</div>
                </>
              ) : (
                <>
                  <div className="w-[84px] h-[84px] rounded-full bg-white/20 flex items-center justify-center">
                    <Icon name="user" size={40} />
                  </div>
                  <input
                    className="mt-4 w-full h-[34px] rounded-full px-4 bg-white/20 placeholder-white/60 text-white outline-none focus:bg-white/25 backdrop-blur-md text-[13.5px]"
                    placeholder="User ID"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    aria-label="User ID"
                  />
                </>
              )}
              <div className="mt-4 relative w-full">
                <input
                  ref={pwRef}
                  type="password"
                  className="w-full h-[34px] rounded-full pl-4 pr-11 bg-white/20 placeholder-white/60 text-white outline-none focus:bg-white/25 backdrop-blur-md text-[13.5px]"
                  placeholder="Enter Password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyUp={(e) => setCaps(e.getModifierState('CapsLock'))}
                  aria-label="Password"
                  aria-invalid={!!error}
                  aria-describedby="login-error"
                />
                <button
                  type="submit"
                  disabled={busy || !password}
                  className="absolute right-1 top-1 w-[26px] h-[26px] rounded-full bg-white/85 text-black/80 flex items-center justify-center disabled:opacity-40"
                  aria-label="Sign in"
                >
                  {busy ? <span className="w-3 h-3 rounded-full border-2 border-black/40 border-t-transparent animate-spin" /> : <Icon name="chevronRight" size={14} strokeWidth={2.6} />}
                </button>
              </div>
              <div id="login-error" className="min-h-[34px] mt-2 text-center text-[12px] text-white/90" role="alert">
                {error ?? (caps ? 'Caps Lock is on.' : '')}
              </div>
              <button
                type="button"
                className="text-[12px] text-white/65 hover:text-white inline-flex items-center gap-1"
                onClick={() => {
                  setSelected(null)
                  setOther(false)
                  setPassword('')
                  setError(null)
                }}
              >
                <Icon name="chevronLeft" size={13} /> Back to users
              </button>
            </form>
          )}
        </div>

        <div className="mb-8 flex flex-col items-center gap-3 w-full max-w-[520px]">
          <button
            disabled
            className="h-[32px] px-4 rounded-full bg-white/15 text-white/60 text-[12.5px] inline-flex items-center gap-2 cursor-not-allowed"
            title="Pending IT confirmation of 2GO single sign-on (BRD Open item 6)"
          >
            <Icon name="key" size={14} /> Sign in with 2GO SSO <span className="text-white/40">· pending IT</span>
          </button>

          <div className="w-full">
            <button className="mx-auto flex items-center gap-1 text-[11.5px] text-white/55 hover:text-white/85" onClick={() => setShowHints((v) => !v)} aria-expanded={showHints}>
              <Icon name="info" size={13} /> Demo credentials
            </button>
            {showHints && (
              <div className="mt-2 rounded-xl bg-black/30 backdrop-blur-md p-3 text-[12px] text-white/85 animate-in">
                <table className="w-full">
                  <tbody>
                    {DEMO_HINTS.map((h) => {
                      const u = PUBLIC_ACCOUNTS.find((a) => a.username === h.username)!
                      return (
                        <tr key={h.username}>
                          <td className="py-0.5 pr-3 text-white/60">{ROLE_LABEL[u.role]}</td>
                          <td className="py-0.5 pr-3 font-mono">{h.username}</td>
                          <td className="py-0.5 font-mono">{h.password}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <p className="text-center text-[11px] text-white/45 leading-relaxed">
            Authorized 2GO users only. Access and changes are logged (FR-30) and personal data is processed under RA 10173.
            <br />
            Sessions lock after 30 minutes of inactivity.
          </p>
        </div>
      </div>
    </div>
  )
}
