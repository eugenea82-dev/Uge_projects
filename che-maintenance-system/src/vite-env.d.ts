/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'mock' (default) or 'api' */
  readonly VITE_EMMS_MODE?: string
  /** Integration gateway base URL, e.g. https://integration.2go.com.ph/emms/v1 */
  readonly VITE_EMMS_BASE_URL?: string
  readonly VITE_EMMS_TIMEOUT_MS?: string
  readonly VITE_EMMS_PAGE_SIZE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
