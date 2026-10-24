// EMMS integration contract — PROVISIONAL.
//
// The EMMS interface (API / database view / scheduled file) is still Open item 3.
// These DTOs describe the payload this system expects from the EMMS API (or
// from a gateway in front of it). When IT publishes the real contract, change
// this file and mapper.ts only; nothing else in the app reads EMMS shapes.

/** EMMS work-order record (FR-03). Dates are ISO-8601 strings with offset. */
export interface EmmsWorkOrderDto {
  wo_no: string
  asset_id: string // must equal the asset register ID (NFR-D01)
  wo_type: 'CM' | 'PM' | 'PDM' // corrective / preventive / predictive
  status: 'OPEN' | 'IN_PROGRESS' | 'CLOSED' | 'CANCELLED'
  description: string
  failure_code?: string | null // mandatory on closed CM work orders (BO-06)
  date_opened: string
  due_date?: string | null // PM schedule date
  repair_start?: string | null
  repair_end?: string | null
  parts_wait_hours?: number | null
  rts_date?: string | null // return to service
  total_cost?: number | null // PHP
  updated_at: string
}

/** EMMS asset master record, used to reconcile the asset register (FR-01, D-05). */
export interface EmmsAssetDto {
  asset_id: string
  equipment_type: string
  make: string
  model: string
  serial_no?: string | null
  branch: string
  status: 'ACTIVE' | 'DISPOSED' | 'INACTIVE'
}

/** Paged response envelope. */
export interface EmmsPage<T> {
  items: T[]
  next_page: number | null
}

export interface EmmsHealth {
  ok: boolean
  mode: 'mock' | 'api'
  latencyMs: number
  detail: string
}

/** Field mapping shown on the Data & Sync page and used by the mapper. */
export const WORK_ORDER_FIELD_MAP: { emms: string; che: string; rule: string }[] = [
  { emms: 'wo_no', che: 'Work order number', rule: 'Required; unique key for upserts' },
  { emms: 'asset_id', che: 'Asset ID', rule: 'Must match the asset register; otherwise held on the exception list' },
  { emms: 'wo_type', che: 'Kind', rule: 'CM → Corrective, PM → PM, PDM → Predictive' },
  { emms: 'status', che: 'Open / closed', rule: 'CANCELLED records are skipped' },
  { emms: 'failure_code', che: 'Failure code', rule: 'Required on closed corrective WOs (BO-06)' },
  { emms: 'date_opened', che: 'Opened at', rule: 'Required ISO-8601 date' },
  { emms: 'due_date', che: 'PM due date', rule: 'Used for PM compliance (FR-44)' },
  { emms: 'repair_start / repair_end', che: 'Repair window', rule: 'Optional; end must be after start' },
  { emms: 'parts_wait_hours', che: 'Parts wait (h)', rule: 'Optional; ≥ 0' },
  { emms: 'rts_date', che: 'Closed at (return to service)', rule: 'Falls back to repair_end when closed' },
  { emms: 'total_cost', che: 'Cost (PHP)', rule: 'Optional; ≥ 0' },
  { emms: 'updated_at', che: 'Sync watermark', rule: 'Next import asks for records updated after the latest value' },
]
