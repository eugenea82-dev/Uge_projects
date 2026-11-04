// Writes docs/CHE_Data_Entry_quantified.csv from the parameter catalog, so the
// business mapping always matches what the app enforces.
//   npm run export:mapping

import { writeFileSync } from 'node:fs'
import { DAILY, EQUIPMENT_TYPES, LAB, bands, defaultLabThresholds, defaultThresholds, refLabel, ruleText, type DailyDef, type LabDef } from '../src/domain/catalog.ts'

const daily = defaultThresholds()
const lab = defaultLabThresholds()

const head = [
  'Location',
  'Data entry',
  'Portal',
  'Screen › section',
  'Field',
  'Unit',
  'Required',
  'Sheet warning',
  'Sheet critical',
  'Quantified rule',
  'Reference',
  'OK',
  'Check (warning)',
  'Stop (critical)',
  'Limits by equipment type',
  'Assumed',
  'Assumption to confirm',
  'Possible indication',
  'Catalog key',
  'Source document',
]

const esc = (v: string | number) => {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const SHORT: Record<string, string> = { 'Reach Stacker': 'RS', Forklift: 'FL', 'Empty Container Handler': 'ECH', 'Yard Tractor': 'YT' }

function dailyRow(d: DailyDef) {
  const rs = daily['Reach Stacker'][d.key]
  const b = bands(d, rs)
  const perType = EQUIPMENT_TYPES.map((t) => {
    const x = bands(d, daily[t][d.key])
    return `${SHORT[t]}: Check ${x.check} / Stop ${x.stop}`
  })
  const varies = new Set(perType.map((p) => p.slice(p.indexOf(':')))).size > 1
  return [
    d.csvLocation,
    d.csvName,
    'LBE Specialist Portal',
    `Capture Readings › Daily check › ${d.required ? d.system : 'Extra readings'}`,
    d.label,
    d.unit,
    d.required ? 'Yes' : 'Optional (diagnostic tool / display)',
    d.csvWarning,
    d.csvCritical,
    ruleText(d, rs),
    d.ref ? `${refLabel(d)}: ${rs.ref}${varies ? ' (Reach Stacker)' : ''}` : '',
    b.ok,
    b.check,
    b.stop,
    varies ? perType.join(' | ') : 'Same for all types',
    d.assumed ? 'Yes' : 'No',
    d.assumed ?? '',
    d.indication,
    d.key,
    'CHE Data Entry sheet',
  ]
}

function labRow(d: LabDef) {
  const t = lab[d.key]
  const b = bands(d, t)
  return [
    d.csvLocation,
    d.csvName,
    'LBE Specialist Portal (planner / engineer)',
    `Capture Readings › Oil lab report › ${d.compartment} › ${d.element ? 'Wear & contamination metals' : 'Oil condition'}`,
    d.label,
    d.unit,
    'Per lab report',
    d.csvWarning || (d.origin === 'elements' ? '(not given)' : ''),
    d.csvCritical || (d.origin === 'elements' ? '(not given)' : ''),
    ruleText(d, t),
    d.rule === 'isoAboveRef' ? `OEM target code: ${t.refCode}` : d.ref ? `${refLabel(d)}: ${t.ref}` : '',
    b.ok,
    b.check,
    b.stop,
    'Same for all types',
    d.assumed ? 'Yes' : 'No',
    d.assumed ?? '',
    d.sources && d.origin === 'sheet' ? `${d.indication} (element table: ${d.sources})` : d.indication,
    d.key,
    d.origin === 'elements' ? 'Oil-analysis element table' : 'CHE Data Entry sheet',
  ]
}

const rows = [head, ...DAILY.map(dailyRow), ...LAB.map(labRow)]
const out = new URL('../docs/CHE_Data_Entry_quantified.csv', import.meta.url)
writeFileSync(out, '\uFEFF' + rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n')
console.log(`Wrote ${rows.length - 1} parameters to ${out.pathname}`)
