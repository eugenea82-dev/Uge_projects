// Demo accounts for the v0.1 prototype.
//
// FR-31 calls for 2GO single sign-on (Open item 6). Until IT confirms it, this
// prototype signs in locally against salted SHA-256 hashes. It is a stand-in
// for UI testing only — production authentication must be server-side, with
// MFA for admin accounts (NFR-S01) and password policy per 2GO IT.

import type { User } from '../domain/types.ts'

interface Account extends User {
  hash: string
}

const ACCOUNTS: Account[] = [
  {
    username: 'preyes',
    displayName: 'Paolo Reyes',
    title: 'Equipment Specialist · Manila',
    role: 'EQUIPMENT_SPECIALIST',
    locations: ['Manila CY1', 'Manila CY2', 'Manila CY3', 'Asinan'],
    initials: 'PR',
    hash: '0ce09a21affdc9feeb5320da4c415020a53d8989839fb15a2a32ea93d8bdf10c',
  },
  {
    username: 'gvillanueva',
    displayName: 'Grace Villanueva',
    title: 'Equipment Specialist · Visayas',
    role: 'EQUIPMENT_SPECIALIST',
    locations: ['Cebu', 'Iloilo', 'Bacolod'],
    initials: 'GV',
    hash: 'c3c35d3d789620ba7059eb9fffee109bf76b2d5673f975cfa6f3f0989f75129e',
  },
  {
    username: 'asantos',
    displayName: 'Andrea Santos',
    title: 'Asset Maintenance Manager',
    role: 'AM_MANAGER',
    locations: null,
    initials: 'AS',
    hash: '203fbff8f2410f8fd7b2ae50f234432c6ef82d92a367b5cef7de182ef6786fde',
  },
]

/** Shown on the sign-in screen so testers can get in. Remove for any real deployment. */
export const DEMO_HINTS = [
  { username: 'preyes', password: 'Specialist@2026' },
  { username: 'gvillanueva', password: 'Specialist@2026' },
  { username: 'asantos', password: 'Manager@2026' },
]

export const PUBLIC_ACCOUNTS: User[] = ACCOUNTS.map(({ hash: _hash, ...u }) => u)

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const LOCK_KEY = 'assetpulse.v01.lockout'
const MAX_ATTEMPTS = 5
const LOCK_MINUTES = 5

interface LockState {
  [username: string]: { fails: number; until?: number }
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

export type SignInResult = { ok: true; user: User } | { ok: false; message: string }

export async function signIn(usernameRaw: string, password: string): Promise<SignInResult> {
  const username = usernameRaw.trim().toLowerCase()
  if (!username || !password) return { ok: false, message: 'Enter your user ID and password.' }
  const locks = readLock()
  const lock = locks[username]
  if (lock?.until && lock.until > Date.now()) {
    const mins = Math.ceil((lock.until - Date.now()) / 60_000)
    return { ok: false, message: `Too many failed attempts. Try again in ${mins} minute${mins > 1 ? 's' : ''}.` }
  }
  const acct = ACCOUNTS.find((a) => a.username === username)
  const hash = await sha256(`assetpulse:${username}:${password}`)
  if (!acct || acct.hash !== hash) {
    const fails = (lock?.fails ?? 0) + 1
    locks[username] = fails >= MAX_ATTEMPTS ? { fails: 0, until: Date.now() + LOCK_MINUTES * 60_000 } : { fails }
    writeLock(locks)
    const left = MAX_ATTEMPTS - fails
    return { ok: false, message: fails >= MAX_ATTEMPTS ? `Account locked for ${LOCK_MINUTES} minutes after ${MAX_ATTEMPTS} failed attempts.` : `Incorrect user ID or password. ${left} attempt${left > 1 ? 's' : ''} left.` }
  }
  delete locks[username]
  writeLock(locks)
  const { hash: _h, ...user } = acct
  return { ok: true, user }
}

const SESSION_KEY = 'assetpulse.v01.session'

export function saveSession(user: User) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ username: user.username, at: Date.now() }))
  } catch {
    /* ignore */
  }
}

export function restoreSession(timeoutMin: number): User | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') as { username: string; at: number } | null
    if (!s || Date.now() - s.at > timeoutMin * 60_000) return null
    return PUBLIC_ACCOUNTS.find((u) => u.username === s.username) ?? null
  } catch {
    return null
  }
}

export function touchSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null')
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...s, at: Date.now() }))
  } catch {
    /* ignore */
  }
}

export function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY)
  } catch {
    /* ignore */
  }
}
