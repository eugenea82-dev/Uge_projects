// Demo accounts for the prototype.
//
// FR-31 calls for 2GO single sign-on (Open item 6). Until IT confirms it, the
// prototype signs in locally with a work email against salted SHA-256 hashes.
// This is for UI testing only: production authentication must be server-side,
// with MFA for admin accounts (NFR-S01) and password policy per 2GO IT.

import type { User } from '../domain/types.ts'

interface Account extends User {
  hash: string
}

const ACCOUNTS: Account[] = [
  {
    username: 'ernick.borres@2go.com.ph',
    displayName: 'Ernick Borres',
    title: 'LBE Specialist · Manila',
    role: 'LBE_SPECIALIST',
    locations: ['Manila CY1', 'Manila CY2', 'Manila CY3', 'Asinan'],
    initials: 'EB',
    hash: '55c09f830ce1ee3dd95e106086470883df2e87cb272d56bd34493d8abf72bbee',
  },
  {
    username: 'adrian.booc@2go.com.ph',
    displayName: 'Adrian Booc',
    title: 'LBE Specialist · Visayas',
    role: 'LBE_SPECIALIST',
    locations: ['Cebu', 'Iloilo', 'Bacolod'],
    initials: 'AB',
    hash: '5b826fa15f8999ba289f7662d11bde75638ea9c596ba3eae3ce2c06bd2a96e60',
  },
  {
    username: 'markanthony.palacay@2go.com.ph',
    displayName: 'Mark Anthony Palacay',
    title: 'Asset Maintenance Manager',
    role: 'AM_MANAGER',
    locations: null,
    initials: 'MP',
    hash: '76d992b4cd3207357021e9e650b8b0ba849cfd72dd8a28c2f899acd9030be4f7',
  },
]

/** Prefilled on the sign-in screen so testers can get in. Remove for any real deployment. */
export const DEMO_PASSWORDS: Record<string, string> = {
  'ernick.borres@2go.com.ph': 'Specialist@2026',
  'adrian.booc@2go.com.ph': 'Specialist@2026',
  'markanthony.palacay@2go.com.ph': 'Manager@2026',
}

export const PUBLIC_ACCOUNTS: User[] = ACCOUNTS.map(({ hash: _hash, ...u }) => u)

export function findAccount(email: string): User | undefined {
  const e = email.trim().toLowerCase()
  return PUBLIC_ACCOUNTS.find((u) => u.username === e)
}

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const LOCK_KEY = 'chems.v02.lockout'
const MAX_ATTEMPTS = 5
const LOCK_MINUTES = 5

interface LockState {
  [email: string]: { fails: number; until?: number }
}

function readLock(): LockState {
  try {
    return JSON.parse(localStorage.getItem(LOCK_KEY) ?? '{}') as LockState
  } catch {
    return {}
  }
}

function writeLock(s: LockState) {
  try {
    localStorage.setItem(LOCK_KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

export type SignInResult = { ok: true; user: User } | { ok: false; message: string; field: 'email' | 'password' | 'form' }

export async function signIn(emailRaw: string, password: string): Promise<SignInResult> {
  const email = emailRaw.trim().toLowerCase()
  if (!email) return { ok: false, field: 'email', message: 'Enter your 2GO work email.' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, field: 'email', message: 'Enter a valid email address, e.g. name@2go.com.ph.' }
  if (!password) return { ok: false, field: 'password', message: 'Enter your password.' }
  const locks = readLock()
  const lock = locks[email]
  if (lock?.until && lock.until > Date.now()) {
    const mins = Math.ceil((lock.until - Date.now()) / 60_000)
    return { ok: false, field: 'form', message: `Too many failed attempts. Try again in ${mins} minute${mins > 1 ? 's' : ''}.` }
  }
  const acct = ACCOUNTS.find((a) => a.username === email)
  const hash = await sha256(`chems:${email}:${password}`)
  if (!acct || acct.hash !== hash) {
    const fails = (lock?.fails ?? 0) + 1
    locks[email] = fails >= MAX_ATTEMPTS ? { fails: 0, until: Date.now() + LOCK_MINUTES * 60_000 } : { fails }
    writeLock(locks)
    const left = MAX_ATTEMPTS - fails
    return {
      ok: false,
      field: 'form',
      message: fails >= MAX_ATTEMPTS ? `Account locked for ${LOCK_MINUTES} minutes after ${MAX_ATTEMPTS} failed attempts.` : `Incorrect email or password. ${left} attempt${left > 1 ? 's' : ''} left before the account locks.`,
    }
  }
  delete locks[email]
  writeLock(locks)
  const { hash: _h, ...user } = acct
  return { ok: true, user }
}

const SESSION_KEY = 'chems.v02.session'
const REMEMBER_KEY = 'chems.v02.remember'

/** "Keep me signed in" keeps the session across browser restarts; the 30-minute idle lock still applies (NFR-S03). */
export function saveSession(user: User, keep: boolean) {
  try {
    const v = JSON.stringify({ username: user.username, at: Date.now() })
    sessionStorage.setItem(SESSION_KEY, v)
    if (keep) localStorage.setItem(SESSION_KEY, v)
    else localStorage.removeItem(SESSION_KEY)
    localStorage.setItem(REMEMBER_KEY, user.username)
  } catch {
    /* ignore */
  }
}

/** Last email used on this device, to prefill the sign-in form. */
export function rememberedEmail(): string | null {
  try {
    return localStorage.getItem(REMEMBER_KEY)
  } catch {
    return null
  }
}

function readSession(): { username: string; at: number } | null {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? localStorage.getItem(SESSION_KEY) ?? 'null')
  } catch {
    return null
  }
}

export function restoreSession(timeoutMin: number): User | null {
  const s = readSession()
  if (!s || Date.now() - s.at > timeoutMin * 60_000) return null
  return findAccount(s.username) ?? null
}

export function touchSession() {
  try {
    const now = JSON.stringify({ ...readSession(), at: Date.now() })
    if (sessionStorage.getItem(SESSION_KEY)) sessionStorage.setItem(SESSION_KEY, now)
    if (localStorage.getItem(SESSION_KEY)) localStorage.setItem(SESSION_KEY, now)
  } catch {
    /* ignore */
  }
}

export function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY)
    localStorage.removeItem(SESSION_KEY)
  } catch {
    /* ignore */
  }
}
