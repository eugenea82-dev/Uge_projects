// Maps EMMS payloads into the domain model and merges them into the store.
//
// Rules (FR-03, AC-10): records are matched to units by asset ID; records that
// cannot be matched or fail validation go to the exception list with a plain
// reason — they are never dropped silently or re-keyed by hand. Imports are
// idempotent: a work order is upserted by its number.

import type { SyncException, Unit, WorkOrder } from '../../domain/types.ts'
import type { EmmsAssetDto, EmmsWorkOrderDto } from './contract.ts'

const KIND: Record<EmmsWorkOrderDto['wo_type'], WorkOrder['kind']> = { CM: 'Corrective', PM: 'PM', PDM: 'Predictive' }

function time(v: string | null | undefined): number | undefined | null {
  if (v === null || v === undefined || v === '') return undefined
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null // null = present but invalid
}

export type MapResult = { ok: true; wo: WorkOrder } | { ok: false; skip: true; reason: string } | { ok: false; skip: false; reason: string }

export function mapWorkOrder(dto: EmmsWorkOrderDto, knownAssets: Set<string>, source: WorkOrder['source'] = 'EMMS'): MapResult {
  const problems: string[] = []
  if (!dto || typeof dto !== 'object') return { ok: false, skip: false, reason: 'Record is not an object' }
  if (!dto.wo_no || typeof dto.wo_no !== 'string') problems.push('wo_no is missing')
  if (dto.status === 'CANCELLED') return { ok: false, skip: true, reason: 'Cancelled in EMMS' }
  const assetId = typeof dto.asset_id === 'string' ? dto.asset_id.trim() : ''
  if (!assetId) problems.push('asset_id is missing')
  else if (!knownAssets.has(assetId)) problems.push('Asset ID not found in register')
  const kind = KIND[dto.wo_type]
  if (!kind) problems.push(`Unknown wo_type “${String(dto.wo_type)}”`)
  const opened = time(dto.date_opened)
  if (opened === undefined || opened === null) problems.push('date_opened is missing or not a date')
  const due = time(dto.due_date)
  const rs = time(dto.repair_start)
  const re = time(dto.repair_end)
  const rts = time(dto.rts_date)
  const upd = time(dto.updated_at)
  for (const [k, v] of [['due_date', due], ['repair_start', rs], ['repair_end', re], ['rts_date', rts], ['updated_at', upd]] as const) if (v === null) problems.push(`${k} is not a valid date`)
  if (typeof rs === 'number' && typeof re === 'number' && re < rs) problems.push('repair_end is before repair_start')
  if (dto.parts_wait_hours !== undefined && dto.parts_wait_hours !== null && !(dto.parts_wait_hours >= 0)) problems.push('parts_wait_hours must be ≥ 0')
  if (dto.total_cost !== undefined && dto.total_cost !== null && !(dto.total_cost >= 0)) problems.push('total_cost must be ≥ 0')
  const closed = dto.status === 'CLOSED'
  if (closed && kind === 'Corrective' && !dto.failure_code) problems.push('Closed corrective WO has no failure code (BO-06)')
  if (problems.length) return { ok: false, skip: false, reason: problems.join('; ') }

  return {
    ok: true,
    wo: {
      woNumber: dto.wo_no.trim(),
      assetId,
      kind,
      failureCode: dto.failure_code ?? undefined,
      description: dto.description ?? '',
      openedAt: opened as number,
      dueAt: due ?? undefined,
      closedAt: closed ? ((rts ?? re ?? upd) as number | undefined) : undefined,
      cost: dto.total_cost ?? 0,
      repairStart: rs ?? undefined,
      repairEnd: re ?? undefined,
      partsWaitH: dto.parts_wait_hours ?? undefined,
      updatedAt: upd ?? undefined,
      source,
    },
  }
}

const COMPARED: (keyof WorkOrder)[] = ['assetId', 'kind', 'failureCode', 'description', 'openedAt', 'dueAt', 'closedAt', 'cost', 'repairStart', 'repairEnd', 'partsWaitH', 'updatedAt']

/** True when an incoming record carries no change to fields EMMS owns. */
function sameWorkOrder(a: WorkOrder, b: WorkOrder): boolean {
  return COMPARED.every((k) => (a[k] ?? null) === (b[k] ?? null))
}

export interface ImportResult {
  workOrders: WorkOrder[] // merged list
  exceptions: SyncException[] // records that need fixing in EMMS
  received: number
  added: number
  updated: number
  skipped: number
  rejected: number
  watermark?: number
}

/** Map a batch of EMMS records and upsert them into the existing work orders. */
export function importWorkOrders(existing: WorkOrder[], dtos: EmmsWorkOrderDto[], units: Unit[], source: WorkOrder['source'] = 'EMMS'): ImportResult {
  const known = new Set(units.map((u) => u.assetId))
  const byNo = new Map(existing.map((w) => [w.woNumber, w]))
  const exceptions: SyncException[] = []
  let added = 0
  let updated = 0
  let skipped = 0
  let watermark: number | undefined
  for (const dto of dtos) {
    const r = mapWorkOrder(dto, known, source)
    if (!r.ok) {
      if (r.skip) skipped++
      else exceptions.push({ recordId: String(dto?.wo_no ?? '(no number)'), assetId: String(dto?.asset_id ?? ''), reason: r.reason })
      continue
    }
    const prev = byNo.get(r.wo.woNumber)
    if (!prev) added++
    else if (!sameWorkOrder(prev, r.wo)) updated++
    byNo.set(r.wo.woNumber, prev ? { ...prev, ...r.wo } : r.wo)
    if (r.wo.updatedAt !== undefined && (watermark === undefined || r.wo.updatedAt > watermark)) watermark = r.wo.updatedAt
  }
  return { workOrders: [...byNo.values()], exceptions, received: dtos.length, added, updated, skipped, rejected: exceptions.length, watermark }
}

/** Replace exceptions for re-sent records, keep the rest (an exception clears once EMMS sends a valid version). */
export function mergeExceptions(prev: SyncException[], next: SyncException[], importedWoNumbers: Set<string>): SyncException[] {
  const map = new Map(prev.filter((e) => !importedWoNumbers.has(e.recordId)).map((e) => [e.recordId, e]))
  for (const e of next) map.set(e.recordId, e)
  return [...map.values()]
}

/** Compare the EMMS asset master with the register (FR-01, D-05). */
export function reconcileAssets(dtos: EmmsAssetDto[], units: Unit[]) {
  const reg = new Set(units.map((u) => u.assetId))
  const emms = new Set(dtos.filter((d) => d.status !== 'DISPOSED').map((d) => d.asset_id))
  return {
    missingInRegister: [...emms].filter((id) => !reg.has(id)).sort(),
    missingInEmms: [...reg].filter((id) => !emms.has(id)).sort(),
  }
}

/** Accepts either a bare array or a paged envelope from an EMMS export file. */
export function parseExport(json: unknown): EmmsWorkOrderDto[] {
  if (Array.isArray(json)) return json as EmmsWorkOrderDto[]
  if (json && typeof json === 'object' && Array.isArray((json as { items?: unknown }).items)) return (json as { items: EmmsWorkOrderDto[] }).items
  throw new Error('Expected a JSON array of work orders or an object with an “items” array.')
}
