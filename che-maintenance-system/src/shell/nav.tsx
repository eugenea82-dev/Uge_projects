import { createContext, useContext, type ReactNode } from 'react'

export type AppId = 'portal' | 'command'

export interface Route {
  app: AppId
  page: string
  assetId?: string
  alertId?: string
  /** optional preselected filter, e.g. a location */
  filter?: string
}

export interface NavCtx {
  route: Route
  go: (r: Partial<Route> & { page: string }) => void
  openUnit: (assetId: string) => void
  openAlert: (alertId: string) => void
  back: () => void
  canGoBack: boolean
  toast: (message: ReactNode, tone?: 'ok' | 'danger' | 'info') => void
}

export const Nav = createContext<NavCtx | null>(null)

export function useNav() {
  const n = useContext(Nav)
  if (!n) throw new Error('useNav outside provider')
  return n
}
