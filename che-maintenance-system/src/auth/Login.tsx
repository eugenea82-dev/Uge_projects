// Sign-in screen modelled on the 2GO sample UI: macOS menu bar, a split
// window with the brand panel on the left and the credential form on the right.

import { useEffect, useRef, useState } from 'react'
import type { User } from '../domain/types.ts'
import { Icon } from '../ui/Icon.tsx'
import { DEMO_PASSWORDS, PUBLIC_ACCOUNTS, findAccount, rememberedEmail, signIn } from './accounts.ts'

const AVATAR_TINT: Record<string, string> = {
  'ernick.borres@2go.com.ph': 'linear-gradient(160deg,#2bb6f0,#0a74c4)',
  'adrian.booc@2go.com.ph': 'linear-gradient(160deg,#34d399,#0b8f6a)',
  'markanthony.palacay@2go.com.ph': 'linear-gradient(160deg,#ffa53d,#e5007e)',
}

function Avatar({ u, size }: { u: User | undefined; size: number }) {
  return (
    <div
      className="rounded-full flex items-center justify-center text-white font-semibold shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.34, background: u ? AVATAR_TINT[u.username] : 'linear-gradient(160deg,#c7c7cc,#8e8e93)', boxShadow: size > 40 ? '0 8px 22px rgba(10,116,196,0.28)' : undefined }}
      aria-hidden
    >
      {u ? u.initials : <Icon name="user" size={size * 0.45} />}
    </div>
  )
}

export function Login({ onSignedIn, notice }: { onSignedIn: (u: User, keep: boolean) => void; notice?: string }) {
  const initialEmail = rememberedEmail() ?? PUBLIC_ACCOUNTS[0].username
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState(DEMO_PASSWORDS[initialEmail] ?? '')
  const [keep, setKeep] = useState(true)
  const [error, setError] = useState<{ field: 'email' | 'password' | 'form'; message: string } | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [shake, setShake] = useState(0)
  const [caps, setCaps] = useState(false)
  const pwRef = useRef<HTMLInputElement>(null)
  const acct = findAccount(email)

  const pick = (u: User) => {
    setEmail(u.username)
    setPassword(DEMO_PASSWORDS[u.username] ?? '')
    setError(null)
    setInfo(null)
    pwRef.current?.focus()
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    setInfo(null)
    const res = await signIn(email, password)
    setBusy(false)
    if (res.ok) onSignedIn(res.user, keep)
    else {
      setError({ field: res.field, message: res.message })
      if (res.field === 'form') {
        setPassword('')
        setShake((s) => s + 1)
        pwRef.current?.focus()
      }
    }
  }

  return (
    <div className="fixed inset-0 flex flex-col overflow-auto" style={{ background: 'radial-gradient(900px 600px at 0% 0%, #f3c2dc 0%, transparent 60%), radial-gradient(1000px 700px at 100% 100%, #8fd0ec 0%, transparent 60%), linear-gradient(135deg, #f1d3e6 0%, #d9d4ec 45%, #b8dcef 100%)' }}>
      <LoginMenuBar />
      <div className="flex-1 flex items-center justify-center p-3 sm:p-6">
        <div className="w-full max-w-[1040px] grid md:grid-cols-[1fr_1fr] rounded-[12px] overflow-hidden animate-in" style={{ boxShadow: '0 0 0 0.5px rgba(0,0,0,0.12), 0 30px 80px rgba(60, 20, 70, 0.28)' }}>
          <BrandPanel />
          <div className="bg-white text-[#1d1d1f] flex flex-col items-center justify-center px-6 sm:px-14 py-10" style={{ colorScheme: 'light' }}>
            <Avatar u={acct} size={84} />
            <div className="mt-3.5 text-[20px] font-semibold text-center">{acct?.displayName ?? 'Sign in'}</div>
            <div className="text-[13px] text-[#6e6e73] mt-0.5 text-center">{acct?.title ?? 'Use your 2GO work email'}</div>

            {notice && (
              <div className="mt-4 w-full max-w-[340px] rounded-lg px-3 py-2 text-[12.5px] bg-[#f5f5f7] text-[#4b4b50] flex items-center gap-2">
                <Icon name="lock" size={14} /> {notice}
              </div>
            )}

            <form key={shake} onSubmit={submit} noValidate className={`mt-6 w-full max-w-[340px] flex flex-col gap-4 ${shake ? 'shake' : ''}`}>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="login-email" className="text-[12.5px] font-medium text-[#4b4b50]">
                  Work email
                </label>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="username"
                  className="login-field"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    setError(null)
                  }}
                  aria-invalid={error?.field === 'email'}
                  aria-describedby="login-msg"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="login-password" className="text-[12.5px] font-medium text-[#4b4b50]">
                    Password
                  </label>
                  <button type="button" className="text-[12.5px] font-medium underline underline-offset-2" style={{ color: 'var(--brand)' }} onClick={() => setInfo('Password resets go through the 2GO IT Service Desk. Once 2GO single sign-on is connected, use your network password here.')}>
                    Forgot password?
                  </button>
                </div>
                <input
                  id="login-password"
                  ref={pwRef}
                  type="password"
                  autoComplete="current-password"
                  className="login-field"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    if (error?.field === 'password') setError(null)
                  }}
                  onKeyUp={(e) => setCaps(e.getModifierState('CapsLock'))}
                  aria-invalid={error?.field === 'password' || error?.field === 'form'}
                  aria-describedby="login-msg"
                />
              </div>
              <label className="inline-flex items-center gap-2 text-[13px] text-[#1d1d1f] cursor-pointer select-none self-start">
                <input type="checkbox" className="w-4 h-4" style={{ accentColor: 'var(--brand)' }} checked={keep} onChange={(e) => setKeep(e.target.checked)} />
                Keep me signed in
              </label>
              <button type="submit" disabled={busy} className="h-[38px] rounded-[7px] text-white text-[14px] font-semibold flex items-center justify-center gap-2 disabled:opacity-70 hover:brightness-95 active:brightness-90" style={{ background: 'var(--brand)' }}>
                {busy && <span className="w-3.5 h-3.5 rounded-full border-2 border-white/50 border-t-transparent animate-spin" />}
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
              <div id="login-msg" role="alert" className="min-h-[18px] -mt-1 text-[12.5px] text-center" style={{ color: error ? '#c4002f' : '#6e6e73' }}>
                {error?.message ?? info ?? (caps ? 'Caps Lock is on.' : '')}
              </div>
            </form>

            <p className="max-w-[340px] text-center text-[12px] text-[#6e6e73] leading-relaxed">
              Demo build. Credentials are prefilled; change the password to <b className="text-[#1d1d1f]">wrong</b> to see the failed sign-in state.
            </p>
            <div className="mt-4 flex items-center gap-2">
              <span className="text-[11.5px] text-[#86868b]">Switch demo user</span>
              {PUBLIC_ACCOUNTS.map((u) => (
                <button key={u.username} type="button" onClick={() => pick(u)} title={`${u.displayName} — ${u.title}`} aria-label={`Use ${u.displayName}`} className="rounded-full" style={{ outline: acct?.username === u.username ? '2px solid var(--brand)' : undefined, outlineOffset: 2 }}>
                  <Avatar u={u} size={28} />
                </button>
              ))}
            </div>
            <p className="mt-6 text-center text-[11px] text-[#86868b] leading-relaxed max-w-[360px]">
              Authorized 2GO users only. Activity is logged (FR-30) and personal data is processed under RA 10173. 2GO single sign-on is pending IT confirmation.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function LoginMenuBar() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="h-[28px] shrink-0 flex items-center px-3 gap-1 text-[13px] text-[#1d1d1f] select-none" style={{ background: 'rgba(255,255,255,0.45)', backdropFilter: 'saturate(180%) blur(20px)', WebkitBackdropFilter: 'saturate(180%) blur(20px)' }}>
      <span className="inline-flex items-center justify-center h-[16px] px-[4px] rounded-[4px] text-white text-[8.5px] font-black tracking-tight mr-2" style={{ background: 'var(--brand)' }}>
        2GO
      </span>
      <span className="font-semibold mr-3">CHE Maintenance</span>
      {['File', 'Edit', 'View', 'Go', 'Window', 'Help'].map((m) => (
        <span key={m} className="hidden sm:inline px-2">
          {m}
        </span>
      ))}
      <span className="flex-1" />
      <svg width="16" height="12" viewBox="0 0 16 12" aria-label="Connected" className="mr-3">
        <path d="M8 11.2l2-2.4a3 3 0 00-4 0z M8 2a10 10 0 00-7 2.9l1.3 1.5A8 8 0 018 4a8 8 0 015.7 2.4L15 4.9A10 10 0 008 2z M8 5.6a6.4 6.4 0 00-4.5 1.9l1.3 1.5a4.6 4.6 0 016.4 0l1.3-1.5A6.4 6.4 0 008 5.6z" fill="currentColor" />
      </svg>
      <span className="tnum">
        {now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
      </span>
    </div>
  )
}

function BrandPanel() {
  return (
    <div className="relative flex flex-col text-white md:min-h-[560px]" style={{ background: 'var(--brand)' }}>
      <div className="relative h-[150px] md:h-[360px] overflow-hidden">
        <YardIllustration />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(120,0,60,0.35) 0%, rgba(229,0,126,0) 30%, rgba(229,0,126,0) 70%, var(--brand) 100%)' }} />
        <div className="absolute top-4 left-4 flex gap-2" aria-hidden>
          <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
          <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
          <span className="w-3 h-3 rounded-full bg-[#28c840]" />
        </div>
        <div className="absolute top-10 md:top-12 left-8 sm:left-11 flex items-baseline gap-2" style={{ textShadow: '0 2px 12px rgba(80,0,40,0.35)' }}>
          <span className="text-[38px] font-black tracking-[-0.04em] leading-none" style={{ fontFamily: 'var(--display)' }}>
            2GO
          </span>
          <span className="text-[21px] font-semibold" style={{ fontFamily: 'var(--display)' }}>
            Freight
          </span>
        </div>
      </div>
      <div className="flex-1 flex flex-col px-8 sm:px-11 pb-6 md:pb-9 -mt-4 md:-mt-6 relative">
        <h1 className="text-[26px] md:text-[42px] leading-[1.05] font-extrabold tracking-[-0.025em]" style={{ fontFamily: 'var(--display)' }}>
          CHE Maintenance
          <br className="hidden md:block" /> System
        </h1>
        <div className="hidden md:block h-px bg-white/35 my-6 max-w-[400px]" />
        <p className="hidden md:block text-[15px] leading-relaxed text-white/95 max-w-[400px]">Know which reach stacker, forklift or yard tractor is at risk, and fix it before it breaks down.</p>
        <div className="hidden md:flex mt-5 flex-wrap gap-2">
          {['Luzon', 'Visayas', 'Mindanao'].map((r) => (
            <span key={r} className="px-3 py-1 rounded-full text-[12.5px] font-semibold" style={{ background: 'rgba(255,255,255,0.22)' }}>
              {r}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Container-yard scene drawn in SVG (no photo asset needed): cranes, container stacks, a truck and a reach stacker. */
function YardIllustration() {
  const stack = (x: number, y: number, cols: number, rows: number, palette: string[], seed: number) => {
    const out = []
    for (let c = 0; c < cols; c++)
      for (let r = 0; r < rows; r++) {
        const fill = palette[(c * 3 + r * 5 + seed) % palette.length]
        const cx = x + c * 46
        const cy = y - (r + 1) * 22
        out.push(
          <g key={`${seed}-${c}-${r}`}>
            <rect x={cx} y={cy} width="44" height="21" fill={fill} />
            {[8, 16, 24, 32].map((d) => (
              <line key={d} x1={cx + d} x2={cx + d} y1={cy + 2} y2={cy + 19} stroke="rgba(0,0,0,0.14)" strokeWidth="1.2" />
            ))}
          </g>,
        )
      }
    return out
  }
  return (
    <svg viewBox="0 0 520 330" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full" aria-hidden>
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a3105a" />
          <stop offset="0.6" stopColor="#de4f97" />
          <stop offset="1" stopColor="#f7a9cf" />
        </linearGradient>
        <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d9b3c8" />
          <stop offset="1" stopColor="#b98aa5" />
        </linearGradient>
        <linearGradient id="box" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff2a96" />
          <stop offset="1" stopColor="#c9006d" />
        </linearGradient>
      </defs>
      <rect width="520" height="330" fill="url(#sky)" />
      {/* ship-to-shore cranes */}
      {[150, 300, 430].map((x, i) => (
        <g key={x} stroke="#ffd9ec" strokeWidth="5" fill="none" opacity={0.5 - i * 0.08}>
          <path d={`M${x} 230 L${x} 70 M${x + 40} 230 L${x + 40} 70 M${x - 30} 75 L${x + 120} 75 M${x} 120 L${x + 40} 90 M${x} 90 L${x + 40} 120`} />
          <path d={`M${x + 60} 75 L${x + 60} 105`} strokeWidth="3" />
        </g>
      ))}
      {/* background stacks */}
      <g opacity="0.9">{stack(0, 240, 12, 4, ['#c2185b', '#f48fb1', '#8e1d5a', '#f8bbd9', '#6d4c63', '#e0447f', '#5a7d9a'], 1)}</g>
      <rect x="0" y="236" width="520" height="94" fill="url(#ground)" />
      {/* foreground stacks */}
      <g>{stack(-14, 300, 3, 4, ['#ff3ea2', '#ffffff', '#e5007e', '#f7c2dc', '#b9006a'], 3)}</g>
      <g>{stack(392, 300, 3, 3, ['#ffffff', '#e5007e', '#ff6fb6', '#c3006c', '#f5d2e4'], 7)}</g>
      {/* truck with 2GO container */}
      <g>
        <rect x="150" y="196" width="190" height="82" rx="2" fill="url(#box)" />
        {Array.from({ length: 17 }, (_, i) => (
          <line key={i} x1={158 + i * 11} x2={158 + i * 11} y1="200" y2="274" stroke="rgba(0,0,0,0.13)" strokeWidth="1.5" />
        ))}
        <text x="270" y="246" textAnchor="middle" fontSize="34" fontWeight="900" fill="#fff" fontFamily="Arial Black, Arial, sans-serif" letterSpacing="-1.5">
          2GO
        </text>
        <rect x="146" y="278" width="214" height="8" fill="#3a2a33" />
        <path d="M340 220 h32 l18 22 v44 h-50 z" fill="#f4f4f6" />
        <path d="M346 226 h22 l13 16 h-35 z" fill="#7aa4c4" />
        {[178, 206, 300, 324, 372].map((x) => (
          <g key={x}>
            <circle cx={x} cy="292" r="12" fill="#222" />
            <circle cx={x} cy="292" r="5" fill="#888" />
          </g>
        ))}
      </g>
      {/* reach stacker */}
      <g transform="translate(40 206)">
        <path d="M-6 76 h70 v-30 h-22 l-10 -18 h-24 z" fill="#ffd23f" stroke="#6b4b00" strokeWidth="1" />
        <path d="M30 44 L104 -6" stroke="#ffd23f" strokeWidth="11" strokeLinecap="round" />
        <rect x="86" y="-26" width="58" height="8" fill="#555" />
        <rect x="-2" y="32" width="22" height="16" fill="#9cc0dc" />
        <circle cx="8" cy="80" r="11" fill="#222" />
        <circle cx="50" cy="80" r="11" fill="#222" />
      </g>
    </svg>
  )
}
