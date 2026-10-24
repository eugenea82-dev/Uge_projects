import { useCallback, useEffect, useRef, useState } from 'react'
import { clearSession, restoreSession, saveSession, touchSession } from './auth/accounts.ts'
import { Login } from './auth/Login.tsx'
import { Splash } from './auth/Splash.tsx'
import { SESSION_TIMEOUT_MIN } from './domain/constants.ts'
import type { User } from './domain/types.ts'
import { Desktop, type ThemePref } from './shell/Desktop.tsx'
import { StoreProvider } from './store.tsx'

const THEME_KEY = 'chems.v02.theme'

function readTheme(): ThemePref {
  try {
    const t = localStorage.getItem(THEME_KEY)
    return t === 'light' || t === 'dark' ? t : 'system'
  } catch {
    return 'system'
  }
}

export default function App() {
  const [phase, setPhase] = useState<'splash' | 'login' | 'app'>('splash')
  const [user, setUser] = useState<User | null>(() => restoreSession(SESSION_TIMEOUT_MIN))
  const [notice, setNotice] = useState<string | undefined>()
  const [theme, setThemeState] = useState<ThemePref>(readTheme)
  const lastActive = useRef(0)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      /* ignore */
    }
  }, [theme])

  const endSession = useCallback((message?: string) => {
    clearSession()
    setUser(null)
    setNotice(message)
    setPhase('login')
  }, [])

  // NFR-S03: lock after 30 minutes of inactivity.
  useEffect(() => {
    if (phase !== 'app') return
    lastActive.current = Date.now()
    let lastTouch = 0
    const onActivity = () => {
      lastActive.current = Date.now()
      if (lastActive.current - lastTouch > 30_000) {
        lastTouch = lastActive.current
        touchSession()
      }
    }
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }))
    const t = setInterval(() => {
      if (Date.now() - lastActive.current > SESSION_TIMEOUT_MIN * 60_000) endSession(`Locked after ${SESSION_TIMEOUT_MIN} minutes of inactivity. Sign in to continue.`)
    }, 15_000)
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.metaKey && e.key.toLowerCase() === 'q') endSession('Screen locked.')
    }
    window.addEventListener('keydown', onKey)
    return () => {
      events.forEach((e) => window.removeEventListener(e, onActivity))
      window.removeEventListener('keydown', onKey)
      clearInterval(t)
    }
  }, [phase, endSession])

  const afterSplash = useCallback(() => setPhase((p) => (p === 'splash' ? (user ? 'app' : 'login') : p)), [user])

  if (phase === 'splash') return <Splash onDone={afterSplash} />
  if (phase === 'login' || !user)
    return (
      <Login
        notice={notice}
        onSignedIn={(u, keep) => {
          saveSession(u, keep)
          setUser(u)
          setNotice(undefined)
          setPhase('app')
        }}
      />
    )
  return (
    <StoreProvider key={user.username} user={user}>
      <Desktop user={user} theme={theme} setTheme={setThemeState} onSignOut={() => endSession('Signed out.')} onLock={() => endSession('Screen locked.')} />
    </StoreProvider>
  )
}
