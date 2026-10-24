// Build-time EMMS configuration (see .env.example). Defaults to the simulated
// client, so the app runs with no setup. Set VITE_EMMS_MODE=api and
// VITE_EMMS_BASE_URL to the integration gateway to go live.

import { HttpEmmsClient, MockEmmsClient, type EmmsClient } from './client.ts'

export interface EmmsConfig {
  mode: 'mock' | 'api'
  baseUrl: string
  timeoutMs: number
  pageSize: number
}

export const emmsConfig: EmmsConfig = {
  mode: import.meta.env.VITE_EMMS_MODE === 'api' ? 'api' : 'mock',
  baseUrl: import.meta.env.VITE_EMMS_BASE_URL ?? '',
  timeoutMs: Number(import.meta.env.VITE_EMMS_TIMEOUT_MS ?? 15000),
  pageSize: Number(import.meta.env.VITE_EMMS_PAGE_SIZE ?? 500),
}

export function createEmmsClient(cfg: EmmsConfig = emmsConfig): EmmsClient {
  return cfg.mode === 'api' ? new HttpEmmsClient({ baseUrl: cfg.baseUrl, timeoutMs: cfg.timeoutMs, pageSize: cfg.pageSize }) : new MockEmmsClient()
}
