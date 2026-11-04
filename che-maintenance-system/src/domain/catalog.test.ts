// The parameter catalog against the source "CHE Data Entry" sheet:
// every row is mapped, every rule is quantified, and boundaries follow the sheet's wording.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { DAILY, DAILY_BY_KEY, EQUIPMENT_TYPES, LAB, LAB_BY_KEY, bands, defaultLabThresholds, defaultThresholds, evaluate, evaluateOilReport, resolveLimits } from './catalog.ts'

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') q = false
      else cell += ch
    } else if (ch === '"') q = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      if (row.some((c) => c.trim())) rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell || row.length) rows.push([...row, cell])
  return rows
}

const csvRows = parseCsv(readFileSync(new URL('../../docs/CHE_Data_Entry_source.csv', import.meta.url), 'utf8'))
  .slice(1)
  .filter((r) => r[1] !== 'Parameter') // the sheet repeats its header inside the gear-oil block

/** Typos in the source sheet, corrected in the catalog. */
const TYPO_FIXES: Record<string, string> = { 'Oil oxidation and acid formatio': 'Oil oxidation and acid formation' }

const daily = defaultThresholds()
const labTh = defaultLabThresholds()

describe('CSV coverage', () => {
  const all = [...DAILY, ...LAB]
  it('has 38 data rows and 38 catalog entries', () => {
    assert.equal(csvRows.length, 38)
    assert.equal(all.length, 38)
  })
  it('maps every sheet row to exactly one parameter, with its wording unchanged', () => {
    for (const [loc, name, warn, crit, indication] of csvRows) {
      const hits = all.filter((d) => d.csvLocation === loc && d.csvName === name)
      assert.equal(hits.length, 1, `${loc} / ${name}`)
      assert.equal(hits[0].csvWarning, warn, `${name} warning`)
      assert.equal(hits[0].csvCritical, crit, `${name} critical`)
      assert.equal(hits[0].indication, TYPO_FIXES[indication.trim()] ?? indication.trim(), `${name} indication`)
    }
  })
  it('routes gauge readings to the daily check and lab results to the oil report', () => {
    assert.equal(DAILY.length, 13)
    assert.equal(DAILY.filter((d) => d.required).length, 10) // fuel consumption required since v0.3
    assert.ok(DAILY_BY_KEY.fuelRate.required)
    assert.ok(DAILY.every((d) => !d.csvLocation.includes('Oil Analysis')))
    assert.ok(LAB.every((d) => d.csvLocation.includes('Oil Analysis') || d.csvLocation.includes('Oil /')))
  })
})

describe('Every parameter is quantified', () => {
  it('daily rules resolve to finite numbers for every equipment type', () => {
    for (const t of EQUIPMENT_TYPES)
      for (const d of DAILY) {
        const lim = resolveLimits(d, daily[t][d.key])
        const nums = [lim.lowWarn, lim.lowCrit, lim.highWarn, lim.highCrit].filter((v) => v !== undefined)
        assert.ok(nums.length >= 2 && nums.every((v) => Number.isFinite(v)), `${t} ${d.key}`)
      }
  })
  it('lab rules resolve to numbers, a target code or a category list', () => {
    for (const d of LAB) {
      if (d.rule === 'category') assert.ok(d.options && d.options.length >= 2)
      else if (d.rule === 'isoAboveRef') assert.ok(labTh[d.key].refCode)
      else assert.ok([resolveLimits(d, labTh[d.key]).highWarn, resolveLimits(d, labTh[d.key]).lowWarn].some((v) => Number.isFinite(v)), d.key)
    }
  })
  it('every "TBA / As per OEM" or relative-only threshold carries an assumption note', () => {
    for (const d of [...DAILY, ...LAB]) {
      if (/TBA|OEM|baseline|^$/.test(d.csvWarning + '|' + d.csvCritical) && d.rule !== 'above' && d.rule !== 'below') assert.ok(d.assumed || d.ref === 'unitBaseline' || d.ref === 'oem', d.key)
      if (/TBA/.test(d.csvWarning + d.csvCritical) || d.csvWarning === '') assert.ok(d.assumed, `${d.key} needs an assumption`)
    }
  })
})

describe('Boundaries follow the sheet', () => {
  const rs = daily['Reach Stacker']
  const ev = (key: keyof typeof DAILY_BY_KEY, v: number, base?: number | null) => evaluate(DAILY_BY_KEY[key], rs[key], v, base)
  it('"110°C" counts the limit itself; "Above 100°C" does not', () => {
    assert.equal(ev('engineOilTemp', 109), 'ok')
    assert.equal(ev('engineOilTemp', 110), 'warning')
    assert.equal(ev('engineOilTemp', 120), 'critical')
    assert.equal(ev('transOilTemp', 100), 'ok')
    assert.equal(ev('transOilTemp', 100.5), 'warning')
    assert.equal(ev('transOilTemp', 121), 'critical')
  })
  it('hydraulic pressure is measured against the OEM target for the type', () => {
    assert.equal(ev('hydOilPressure', 199), 'ok') // 220 × 0.9 = 198
    assert.equal(ev('hydOilPressure', 197), 'warning')
    assert.equal(ev('hydOilPressure', 175), 'critical') // < 176
    assert.equal(evaluate(DAILY_BY_KEY.hydOilPressure, daily['Yard Tractor'].hydOilPressure, 110), 'warning') // YT target 130
  })
  it('fuel consumption uses the unit’s own baseline when it has one', () => {
    assert.equal(ev('fuelRate', 11.6, 10), 'warning')
    assert.equal(ev('fuelRate', 12.6, 10), 'critical')
    assert.equal(ev('fuelRate', 15, null), 'ok') // fleet default 14 L/h
  })
  it('battery and charging voltage', () => {
    assert.equal(ev('batteryVoltage', 24), 'ok')
    assert.equal(ev('batteryVoltage', 23.9), 'warning')
    assert.equal(ev('batteryVoltage', 22.9), 'critical')
    assert.equal(ev('chargingVoltage', 28), 'ok')
    assert.equal(ev('chargingVoltage', 27.3), 'warning')
    assert.equal(ev('chargingVoltage', 26.9), 'critical')
    assert.equal(ev('chargingVoltage', 29.1), 'critical')
  })
  it('oil analysis: viscosity band, TAN increase, ISO code, glycol, ferrous baseline', () => {
    const e = (k: string, v: number | string, base?: number) => evaluate(LAB_BY_KEY[k], labTh[k], v, base)
    assert.equal(e('eng.visc100', 14.5), 'ok')
    assert.equal(e('eng.visc100', 12.0), 'warning') // below 12.33
    assert.equal(e('eng.visc100', 10.5), 'critical') // below 10.88
    assert.equal(e('eng.tan', 3.9), 'ok')
    assert.equal(e('eng.tan', 4.0), 'warning') // fresh 2.0 + 2
    assert.equal(e('eng.tan', 5.0), 'critical')
    assert.equal(e('hyd.iso', '18/16/13'), 'ok')
    assert.equal(e('hyd.iso', '19/16/13'), 'warning')
    assert.equal(e('hyd.iso', '20/18/13'), 'critical')
    assert.equal(e('eng.glycol', 'Confirmed'), 'critical')
    assert.equal(e('trn.fe', 61, 40), 'warning')
    assert.equal(e('trn.fe', 81, 40), 'critical')
    assert.equal(e('gear.si', 21, 10), 'warning')
  })
  it('an oil report takes the worst parameter as its severity', () => {
    const r = evaluateOilReport('Engine', { 'eng.water': 0.25, 'eng.soot': 3 }, labTh, [])
    assert.equal(r.severity, 'Critical')
    assert.equal(r.findings[0].level, 'critical')
    assert.equal(evaluateOilReport('Engine', { 'eng.water': 0.05 }, labTh, []).severity, 'Normal')
  })
  it('gives the mechanic plain bands', () => {
    assert.deepEqual(bands(DAILY_BY_KEY.engineOilTemp, rs.engineOilTemp), { ok: 'below 110 °C', check: '110 or more', stop: '120 °C or more' })
    assert.deepEqual(bands(DAILY_BY_KEY.batteryVoltage, rs.batteryVoltage), { ok: '24 V or more', check: 'below 24', stop: 'below 23 V' })
  })
})
