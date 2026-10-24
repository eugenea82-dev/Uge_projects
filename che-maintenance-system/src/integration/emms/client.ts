// EMMS client. The app talks to EMMS only through this interface, so moving
// from simulated data to the live API is a configuration change.
//
// Security: the browser must never hold the EMMS service-account credentials.
// HttpEmmsClient is meant to call a 2GO integration gateway (same-origin API /
// BFF) that owns the dedicated read-only EMMS account (NFR-S05) and forwards
// requests. It authenticates with the user's session cookie, not a token in
// the bundle.

import type { EmmsAssetDto, EmmsHealth, EmmsPage, EmmsWorkOrderDto } from './contract.ts'

export interface EmmsClient {
  readonly mode: 'mock' | 'api'
  health(): Promise<EmmsHealth>
  /** All work orders created or updated after `since` (inclusive of later pages). */
  fetchWorkOrders(since: Date | null): Promise<EmmsWorkOrderDto[]>
  fetchAssets(): Promise<EmmsAssetDto[]>
}

export class EmmsError extends Error {
  status: number | null
  retryable: boolean
  constructor(message: string, status: number | null, retryable: boolean) {
    super(message)
    this.name = 'EmmsError'
    this.status = status
    this.retryable = retryable
  }
}

export interface HttpEmmsConfig {
  baseUrl: string
  timeoutMs?: number
  pageSize?: number
  maxRetries?: number
  /** injectable for tests */
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

const MAX_PAGES = 200

export class HttpEmmsClient implements EmmsClient {
  readonly mode = 'api' as const
  private base: string
  private timeoutMs: number
  private pageSize: number
  private maxRetries: number
  private fetchImpl: typeof fetch
  private sleep: (ms: number) => Promise<void>

  constructor(cfg: HttpEmmsConfig) {
    if (!cfg.baseUrl) throw new EmmsError('EMMS base URL is not configured (VITE_EMMS_BASE_URL).', null, false)
    this.base = cfg.baseUrl.replace(/\/+$/, '')
    this.timeoutMs = cfg.timeoutMs ?? 15_000
    this.pageSize = cfg.pageSize ?? 500
    this.maxRetries = cfg.maxRetries ?? 3
    this.fetchImpl = cfg.fetchImpl ?? ((...a) => fetch(...a))
    this.sleep = cfg.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }

  private async get<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
    const qs = Object.entries(query)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&')
    const url = `${this.base}${path}${qs ? `?${qs}` : ''}`
    let attempt = 0
    for (;;) {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs)
      try {
        const res = await this.fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'include', signal: ctrl.signal })
        if (res.ok) return (await res.json()) as T
        const retryable = res.status === 429 || res.status >= 500
        const msg = res.status === 401 || res.status === 403 ? `EMMS gateway refused access (${res.status}). Check the integration account and your session.` : `EMMS request failed: ${res.status} ${res.statusText}`
        throw new EmmsError(msg, res.status, retryable)
      } catch (e) {
        const err = e instanceof EmmsError ? e : new EmmsError((e as Error).name === 'AbortError' ? `EMMS did not respond within ${this.timeoutMs / 1000} s.` : `Cannot reach EMMS gateway: ${(e as Error).message}`, null, true)
        if (!err.retryable || attempt >= this.maxRetries) throw err
        await this.sleep(500 * 2 ** attempt) // 0.5 s, 1 s, 2 s …
        attempt++
      } finally {
        clearTimeout(timer)
      }
    }
  }

  async health(): Promise<EmmsHealth> {
    const t0 = Date.now()
    const r = await this.get<{ status?: string; version?: string }>('/health')
    return { ok: r.status === 'ok' || r.status === 'UP', mode: 'api', latencyMs: Date.now() - t0, detail: `EMMS gateway ${r.status ?? 'unknown'}${r.version ? ` · ${r.version}` : ''}` }
  }

  async fetchWorkOrders(since: Date | null): Promise<EmmsWorkOrderDto[]> {
    const out: EmmsWorkOrderDto[] = []
    let page: number | null = 1
    for (let n = 0; page !== null; n++) {
      if (n >= MAX_PAGES) throw new EmmsError(`Stopped after ${MAX_PAGES} pages — check the updated_since filter.`, null, false)
      const res: EmmsPage<EmmsWorkOrderDto> = await this.get<EmmsPage<EmmsWorkOrderDto>>('/work-orders', { updated_since: since?.toISOString(), page, page_size: this.pageSize })
      if (!res || !Array.isArray(res.items)) throw new EmmsError('Unexpected response shape from /work-orders (expected { items, next_page }).', null, false)
      out.push(...res.items)
      page = res.next_page
    }
    return out
  }

  async fetchAssets(): Promise<EmmsAssetDto[]> {
    const out: EmmsAssetDto[] = []
    let page: number | null = 1
    for (let n = 0; page !== null && n < MAX_PAGES; n++) {
      const res: EmmsPage<EmmsAssetDto> = await this.get<EmmsPage<EmmsAssetDto>>('/assets', { page, page_size: this.pageSize })
      out.push(...res.items)
      page = res.next_page
    }
    return out
  }
}

/**
 * Simulated EMMS used until the API is connected. The fleet's history is
 * already generated locally, so each sync only re-sends the two records that
 * EMMS cannot match to the register — enough to exercise the full pipeline.
 */
export class MockEmmsClient implements EmmsClient {
  readonly mode = 'mock' as const

  async health(): Promise<EmmsHealth> {
    return { ok: true, mode: 'mock', latencyMs: 0, detail: 'Simulated EMMS — no live connection' }
  }

  async fetchWorkOrders(): Promise<EmmsWorkOrderDto[]> {
    const now = new Date().toISOString()
    return [
      { wo_no: 'WO-990007', asset_id: 'FL-099', wo_type: 'CM', status: 'OPEN', description: 'Mast chain adjustment', date_opened: now, updated_at: now },
      { wo_no: 'WO-990009', asset_id: 'RS-0l4', wo_type: 'PM', status: 'OPEN', description: 'PM service 500 h', date_opened: now, due_date: now, updated_at: now },
    ]
  }

  async fetchAssets(): Promise<EmmsAssetDto[]> {
    return []
  }
}
