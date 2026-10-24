// EMMS integration tests: mapping, merge/exception rules (FR-03, AC-10) and the
// HTTP client's paging, retry and error handling against a fake gateway.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Unit, WorkOrder } from '../../domain/types.ts'
import { EmmsError, HttpEmmsClient } from './client.ts'
import type { EmmsWorkOrderDto } from './contract.ts'
import { importWorkOrders, mapWorkOrder, mergeExceptions, parseExport, reconcileAssets } from './mapper.ts'

const unit = (assetId: string): Unit => ({ assetId, type: 'Reach Stacker', make: 'Kalmar', model: 'DRG450', serialNo: 'X', year: 2020, location: 'Manila CY1', criticality: 'A', hourMeter: 0, pmIntervalHours: 500, lastPmHourMeter: 0 })
const units = [unit('RS-001'), unit('FL-002')]
const dto = (o: Partial<EmmsWorkOrderDto> = {}): EmmsWorkOrderDto => ({
  wo_no: 'WO-500001',
  asset_id: 'RS-001',
  wo_type: 'CM',
  status: 'CLOSED',
  description: 'Hydraulic hose replaced',
  failure_code: 'HYD-LEAK',
  date_opened: '2026-10-01T08:00:00+08:00',
  repair_start: '2026-10-01T10:00:00+08:00',
  repair_end: '2026-10-02T09:00:00+08:00',
  rts_date: '2026-10-02T10:00:00+08:00',
  parts_wait_hours: 6,
  total_cost: 48500,
  updated_at: '2026-10-02T10:05:00+08:00',
  ...o,
})

describe('mapWorkOrder', () => {
  const known = new Set(units.map((u) => u.assetId))
  it('maps a closed corrective WO', () => {
    const r = mapWorkOrder(dto(), known)
    assert.ok(r.ok)
    assert.equal(r.wo.kind, 'Corrective')
    assert.equal(r.wo.closedAt, Date.parse('2026-10-02T10:00:00+08:00'))
    assert.equal(r.wo.partsWaitH, 6)
  })
  it('rejects unknown asset IDs to the exception list (FR-03)', () => {
    const r = mapWorkOrder(dto({ asset_id: 'FL-099' }), known)
    assert.ok(!r.ok && !r.skip && r.reason.includes('not found in register'))
  })
  it('requires a failure code on closed corrective WOs (BO-06)', () => {
    const r = mapWorkOrder(dto({ failure_code: null }), known)
    assert.ok(!r.ok && r.reason.includes('failure code'))
  })
  it('rejects bad dates and repair end before start', () => {
    assert.ok(!mapWorkOrder(dto({ date_opened: 'yesterday' }), known).ok)
    assert.ok(!mapWorkOrder(dto({ repair_end: '2026-09-30T00:00:00+08:00' }), known).ok)
  })
  it('skips cancelled WOs without raising an exception', () => {
    const r = mapWorkOrder(dto({ status: 'CANCELLED' }), known)
    assert.ok(!r.ok && r.skip)
  })
  it('falls back to repair_end when rts_date is absent', () => {
    const r = mapWorkOrder(dto({ rts_date: null }), known)
    assert.ok(r.ok && r.wo.closedAt === Date.parse('2026-10-02T09:00:00+08:00'))
  })
})

describe('importWorkOrders', () => {
  const existing: WorkOrder[] = [{ woNumber: 'WO-500001', assetId: 'RS-001', kind: 'Corrective', description: 'old', openedAt: 0, cost: 0 }]
  it('upserts by WO number, is idempotent, and reports exceptions', () => {
    const batch = [dto({ description: 'new text' }), dto({ wo_no: 'WO-500002', wo_type: 'PM', status: 'OPEN', failure_code: null, due_date: '2026-10-20T08:00:00+08:00' }), dto({ wo_no: 'WO-500003', asset_id: 'XX-1' }), dto({ wo_no: 'WO-500004', status: 'CANCELLED' })]
    const a = importWorkOrders(existing, batch, units)
    assert.deepEqual([a.received, a.added, a.updated, a.skipped, a.rejected], [4, 1, 1, 1, 1])
    assert.equal(a.workOrders.length, 2)
    assert.equal(a.workOrders.find((w) => w.woNumber === 'WO-500001')!.description, 'new text')
    assert.equal(a.watermark, Date.parse('2026-10-02T10:05:00+08:00'))
    const b = importWorkOrders(a.workOrders, batch, units)
    assert.deepEqual([b.added, b.updated], [0, 0])
    assert.equal(b.workOrders.length, 2)
  })
  it('clears an exception once EMMS sends a valid version', () => {
    const prev = [{ recordId: 'WO-1', assetId: 'X', reason: 'r' }, { recordId: 'WO-2', assetId: 'Y', reason: 'r' }]
    assert.deepEqual(mergeExceptions(prev, [], new Set(['WO-1'])).map((e) => e.recordId), ['WO-2'])
  })
})

describe('parseExport / reconcileAssets', () => {
  it('accepts arrays and paged envelopes', () => {
    assert.equal(parseExport([dto()]).length, 1)
    assert.equal(parseExport({ items: [dto()], next_page: null }).length, 1)
    assert.throws(() => parseExport({ foo: 1 }))
  })
  it('lists register/EMMS differences, ignoring disposed assets', () => {
    const r = reconcileAssets(
      [
        { asset_id: 'RS-001', equipment_type: 'RS', make: 'K', model: 'M', branch: 'CY1', status: 'ACTIVE' },
        { asset_id: 'YT-900', equipment_type: 'YT', make: 'T', model: 'M', branch: 'CY1', status: 'ACTIVE' },
        { asset_id: 'FL-777', equipment_type: 'FL', make: 'T', model: 'M', branch: 'CY1', status: 'DISPOSED' },
      ],
      units,
    )
    assert.deepEqual(r, { missingInRegister: ['YT-900'], missingInEmms: ['FL-002'] })
  })
})

describe('HttpEmmsClient', () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const noSleep = async () => {}

  it('follows next_page and sends the updated_since watermark', async () => {
    const urls: string[] = []
    const fetchImpl = (async (url: string) => {
      urls.push(url)
      return url.includes('page=1') ? json({ items: [dto()], next_page: 2 }) : json({ items: [dto({ wo_no: 'WO-2' })], next_page: null })
    }) as unknown as typeof fetch
    const c = new HttpEmmsClient({ baseUrl: 'https://gw.test/emms/', fetchImpl, sleep: noSleep, pageSize: 1 })
    const items = await c.fetchWorkOrders(new Date('2026-10-01T00:00:00Z'))
    assert.equal(items.length, 2)
    assert.ok(urls[0].startsWith('https://gw.test/emms/work-orders?updated_since=2026-10-01T00%3A00%3A00.000Z&page=1&page_size=1'))
  })

  it('retries 503 with backoff, then succeeds', async () => {
    let calls = 0
    const waits: number[] = []
    const fetchImpl = (async () => (++calls < 3 ? json({}, 503) : json({ status: 'ok' }))) as unknown as typeof fetch
    const c = new HttpEmmsClient({ baseUrl: 'https://gw.test', fetchImpl, sleep: async (ms) => void waits.push(ms) })
    const h = await c.health()
    assert.ok(h.ok)
    assert.equal(calls, 3)
    assert.deepEqual(waits, [500, 1000])
  })

  it('does not retry 401 and explains the failure', async () => {
    let calls = 0
    const fetchImpl = (async () => (calls++, json({}, 401))) as unknown as typeof fetch
    const c = new HttpEmmsClient({ baseUrl: 'https://gw.test', fetchImpl, sleep: noSleep })
    await assert.rejects(c.fetchWorkOrders(null), (e: unknown) => e instanceof EmmsError && e.status === 401 && /refused access/.test(e.message))
    assert.equal(calls, 1)
  })

  it('gives up after maxRetries on network errors', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls++
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const c = new HttpEmmsClient({ baseUrl: 'https://gw.test', fetchImpl, sleep: noSleep, maxRetries: 2 })
    await assert.rejects(c.health(), /Cannot reach EMMS gateway/)
    assert.equal(calls, 3)
  })

  it('refuses to start without a base URL', () => {
    assert.throws(() => new HttpEmmsClient({ baseUrl: '' }), /not configured/)
  })
})
