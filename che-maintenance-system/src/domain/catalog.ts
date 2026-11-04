// Parameter catalog — every row of the "CHE Data Entry" sheet, quantified.
//
// The sheet gives each parameter a warning and a critical threshold, but many
// are relative ("10% below OEM", "above baseline") or left as "TBA / As per
// OEM". Each entry here turns that wording into a rule with concrete numbers,
// so every value a mechanic or planner enters can be classed OK / Check / Stop.
// Numbers we had to choose are marked `assumed` and listed on the Thresholds
// page until the OEM manuals and lab specs confirm them (A-06).
//
// Daily gauge readings → Capture Readings › Daily check (mechanics).
// Oil-analysis results  → Capture Readings › Oil lab report (planner/engineer).

import type { EquipmentType, LabKey, OilCompartment, OilSeverity, ParamKey, Reading, Threshold, ThresholdTable } from './types.ts'

export const EQUIPMENT_TYPES: EquipmentType[] = ['Reach Stacker', 'Forklift', 'Empty Container Handler', 'Yard Tractor']

/**
 * How a parameter's warning/critical numbers are applied:
 *  above / below      absolute limits
 *  pctBelowRef        more than N % below the reference
 *  pctAboveRef        more than N % above the reference
 *  pctBandRef         more than ±N % from the reference
 *  deltaBandRef       more than ±N units from the reference
 *  deltaAboveRef      more than N units above the reference
 *  ratioAboveRef      more than N × the reference
 *  isoAboveRef        ISO 4406 code steps above the target code
 *  category           a lab result chosen from a list
 */
export type RuleKind = 'above' | 'below' | 'pctBelowRef' | 'pctAboveRef' | 'pctBandRef' | 'deltaBandRef' | 'deltaAboveRef' | 'ratioAboveRef' | 'isoAboveRef' | 'category'

/** What the reference is: an OEM target, the new/fresh-oil value, or the unit's own baseline (fleet default until it has enough history). */
export type RefKind = 'oem' | 'newOil' | 'freshOil' | 'unitBaseline'

export type Level = 'ok' | 'warning' | 'critical'

interface BaseDef {
  key: string
  /** the sheet's "Location" and "Data entry" columns, verbatim */
  csvLocation: string
  csvName: string
  csvWarning: string
  csvCritical: string
  /** the sheet's "Possible indication" column — shown to the user when a reading is flagged */
  indication: string
  label: string
  unit: string
  rule: RuleKind
  ref?: RefKind
  /** true when the sheet says "above/below/more than" (limit itself is still OK) */
  strict: boolean
  decimals: number
  component: string
  /** what we assumed to make the rule numeric — confirm with OEM / lab */
  assumed?: string
}

export type DailySystem = 'Engine' | 'Transmission' | 'Hydraulic' | 'Fuel' | 'Electrical'

export interface DailyDef extends BaseDef {
  key: ParamKey
  system: DailySystem
  /** mandatory on every daily check; optional ones need a diagnostic tool or display */
  required: boolean
  pressure?: boolean
  /** plain instruction for the mechanic */
  how: string
  defaults: Record<EquipmentType, Threshold>
}

export interface LabDef extends BaseDef {
  compartment: OilCompartment
  /** text results: ISO code or a category */
  text?: boolean
  options?: { value: string; level: Level }[]
  defaults: Threshold
}

const same = (t: Threshold): Record<EquipmentType, Threshold> => Object.fromEntries(EQUIPMENT_TYPES.map((e) => [e, { ...t }])) as Record<EquipmentType, Threshold>
const perType = (base: Omit<Threshold, 'ref'>, refs: Record<EquipmentType, number>): Record<EquipmentType, Threshold> =>
  Object.fromEntries(EQUIPMENT_TYPES.map((e) => [e, { ...base, ref: refs[e] }])) as Record<EquipmentType, Threshold>

const HYD_TARGET: Record<EquipmentType, number> = { 'Reach Stacker': 220, Forklift: 180, 'Empty Container Handler': 190, 'Yard Tractor': 130 }
const FUEL_BASE: Record<EquipmentType, number> = { 'Reach Stacker': 14, Forklift: 7, 'Empty Container Handler': 11, 'Yard Tractor': 9 }

// ---------------------------------------------------------------------------
// Daily gauge readings (13)
// ---------------------------------------------------------------------------
export const DAILY: DailyDef[] = [
  {
    key: 'engineOilTemp', system: 'Engine', csvLocation: 'Engine Health', csvName: 'Engine Temperature (oil temperature)', csvWarning: '110°C', csvCritical: '120°C',
    indication: 'Excessive engine heat, oil degradation, inadequate cooling, or excessive engine load',
    label: 'Engine oil temperature', unit: '°C', rule: 'above', strict: false, decimals: 0, component: 'Engine', required: true,
    how: 'Dash gauge, engine warm (after 5 minutes running)',
    defaults: same({ warning: 110, critical: 120, min: 0, max: 160 }),
  },
  {
    key: 'engineOilPressure', system: 'Engine', csvLocation: 'Engine Health', csvName: 'Engine Oil Pressure', csvWarning: 'TBA / As per OEM', csvCritical: 'TBA / As per OEM',
    indication: 'Low oil level, worn bearings, failing oil pump, clogged oil filter, or internal engine wear',
    label: 'Engine oil pressure', unit: 'bar', rule: 'below', strict: true, decimals: 1, component: 'Engine', required: true, pressure: true,
    how: 'Dash gauge, engine warm at working speed',
    assumed: 'Sheet says TBA / As per OEM. Assumed Check below 2.0 bar and Stop below 1.5 bar (engine warm, working speed).',
    defaults: same({ warning: 2.0, critical: 1.5, min: 0, max: 10 }),
  },
  {
    key: 'coolantTemp', system: 'Engine', csvLocation: 'Engine Health', csvName: 'Coolant Temperature', csvWarning: '95°C', csvCritical: '105°C',
    indication: 'Cooling system failure, low coolant, radiator blockage, defective thermostat, or water pump malfunction',
    label: 'Coolant temperature', unit: '°C', rule: 'above', strict: false, decimals: 0, component: 'Cooling system', required: true,
    how: 'Dash gauge, engine warm',
    defaults: same({ warning: 95, critical: 105, min: 0, max: 140 }),
  },
  {
    key: 'engineRpm', system: 'Engine', csvLocation: 'Engine Health', csvName: 'Engine RPM', csvWarning: 'TBA / As per OEM', csvCritical: 'TBA / As per OEM',
    indication: 'Over-revving, incorrect operation, or engine control problem',
    label: 'Engine speed at full throttle', unit: 'rpm', rule: 'above', strict: false, decimals: 0, component: 'Engine', required: false,
    how: 'Tachometer at full throttle, no load (high idle)',
    assumed: 'Sheet says TBA / As per OEM. Assumed high-idle Check at 2,300 rpm and Stop at 2,500 rpm.',
    defaults: same({ warning: 2300, critical: 2500, min: 0, max: 4000 }),
  },
  {
    key: 'transOilTemp', system: 'Transmission', csvLocation: 'Transmission Health', csvName: 'Transmission Oil Temperature', csvWarning: 'Above 100°C', csvCritical: 'Above 120°C',
    indication: 'Overheating, transmission overload, oil cooler blockage, or internal clutch slippage',
    label: 'Transmission oil temperature', unit: '°C', rule: 'above', strict: true, decimals: 0, component: 'Transmission', required: true,
    how: 'Dash gauge after normal driving',
    defaults: same({ warning: 100, critical: 120, min: 0, max: 160 }),
  },
  {
    key: 'transOilPressure', system: 'Transmission', csvLocation: 'Transmission Health', csvName: 'Transmission Oil Pressure', csvWarning: 'Below OEM minimum', csvCritical: 'Below OEM shutdown limit',
    indication: 'Low oil level, worn transmission pump, clogged filter, or internal leakage',
    label: 'Transmission oil pressure', unit: 'bar', rule: 'below', strict: true, decimals: 1, component: 'Transmission', required: true, pressure: true,
    how: 'Dash gauge, in gear with service brake applied',
    assumed: 'Sheet says below OEM minimum / shutdown limit. Assumed OEM minimum 14 bar and shutdown 12 bar.',
    defaults: same({ warning: 14, critical: 12, min: 0, max: 40 }),
  },
  {
    key: 'hydOilTemp', system: 'Hydraulic', csvLocation: 'Hydraulic System Health', csvName: 'Hydraulic Oil Temperature', csvWarning: 'Above 70°C', csvCritical: 'Above 80°C',
    indication: 'Hydraulic overheating, oil cooler blockage, excessive internal leakage, or continuous heavy operation',
    label: 'Hydraulic oil temperature', unit: '°C', rule: 'above', strict: true, decimals: 0, component: 'Hydraulic system', required: true,
    how: 'Dash gauge or tank thermometer',
    defaults: same({ warning: 70, critical: 80, min: 0, max: 130 }),
  },
  {
    key: 'hydOilPressure', system: 'Hydraulic', csvLocation: 'Hydraulic System Health', csvName: 'Hydraulic Oil Pressure', csvWarning: 'More than 10% below OEM', csvCritical: 'More than 20% below OEM target',
    indication: 'Pump wear, internal leakage, pressure relief valve malfunction, or hydraulic system failure',
    label: 'Hydraulic system pressure', unit: 'bar', rule: 'pctBelowRef', ref: 'oem', strict: true, decimals: 0, component: 'Hydraulic system', required: true, pressure: true,
    how: 'Gauge at relief: oil warm, lift held at full stroke',
    assumed: 'OEM target pressure assumed per type: Reach Stacker 220, Forklift 180, Empty Container Handler 190, Yard Tractor 130 bar.',
    defaults: perType({ warning: 10, critical: 20, min: 0, max: 350 }, HYD_TARGET),
  },
  {
    key: 'hydPumpPressure', system: 'Hydraulic', csvLocation: 'Hydraulic System Health', csvName: 'Hydraulic Pump Pressure', csvWarning: 'TBA / As per OEM', csvCritical: 'More than 10% below baseline',
    indication: 'Pump wear or internal leakage',
    label: 'Hydraulic pump pressure', unit: 'bar', rule: 'pctBelowRef', ref: 'unitBaseline', strict: true, decimals: 0, component: 'Hydraulic system', required: false, pressure: true,
    how: 'Test-port gauge (diagnostic kit)',
    assumed: 'Sheet gives no warning level. Assumed Check at more than 5% below the unit’s baseline; fleet default baseline = OEM system pressure until 10 readings exist.',
    defaults: perType({ warning: 5, critical: 10, min: 0, max: 350 }, HYD_TARGET),
  },
  {
    key: 'fuelRate', system: 'Fuel', csvLocation: 'Fuel Consumption and Engine Efficiency', csvName: 'Fuel Consumption', csvWarning: '15% above baseline', csvCritical: '25% above baseline',
    indication: 'Increased fuel consumption, engine inefficiency, or abnormal operating load',
    label: 'Fuel consumption', unit: 'L/h', rule: 'pctAboveRef', ref: 'unitBaseline', strict: true, decimals: 1, component: 'Fuel system', required: false,
    how: 'Fuel-rate display, or litres refuelled ÷ hours since last fill',
    assumed: 'Fleet default baselines used until the unit has 10 readings: Reach Stacker 14, Forklift 7, Empty Container Handler 11, Yard Tractor 9 L/h.',
    defaults: perType({ warning: 15, critical: 25, min: 0, max: 80 }, FUEL_BASE),
  },
  {
    key: 'fuelRailPressure', system: 'Fuel', csvLocation: 'Fuel Consumption and Engine Efficiency', csvName: 'Fuel Rail Pressure', csvWarning: 'More than 10% deviation from target', csvCritical: 'More than 20% deviation',
    indication: 'Fuel pump deterioration, clogged fuel filter, or injector problems',
    label: 'Fuel rail pressure', unit: 'bar', rule: 'pctBandRef', ref: 'oem', strict: true, decimals: 0, component: 'Fuel system', required: false, pressure: true,
    how: 'Diagnostic tool at working speed',
    assumed: 'OEM target assumed 1,600 bar at working speed until confirmed per engine model.',
    defaults: same({ warning: 10, critical: 20, ref: 1600, min: 0, max: 2500 }),
  },
  {
    key: 'batteryVoltage', system: 'Electrical', csvLocation: 'Electrical and Battery System Health', csvName: 'Battery Voltage (24V system)', csvWarning: 'Below 24V with engine off', csvCritical: 'Below 23V with engine off',
    indication: 'Low battery charge',
    label: 'Battery voltage, engine off', unit: 'V', rule: 'below', strict: true, decimals: 1, component: 'Electrical', required: true,
    how: 'Multimeter on battery terminals before starting',
    defaults: same({ warning: 24, critical: 23, min: 0, max: 32 }),
  },
  {
    key: 'chargingVoltage', system: 'Electrical', csvLocation: 'Electrical and Battery System Health', csvName: 'Charging Voltage', csvWarning: '', csvCritical: 'Below 27V or above 29V while running',
    indication: 'Alternator or voltage regulator problem',
    label: 'Charging voltage, engine running', unit: 'V', rule: 'deltaBandRef', ref: 'oem', strict: true, decimals: 1, component: 'Electrical', required: true,
    how: 'Multimeter on battery terminals, engine running',
    assumed: 'Sheet gives no warning level. Assumed normal band 27.4–28.6 V (28.0 ± 0.6); Stop below 27 V or above 29 V as per sheet.',
    defaults: same({ warning: 0.6, critical: 1.0, ref: 28, min: 0, max: 36 }),
  },
]

// ---------------------------------------------------------------------------
// Oil-analysis results (25)
// ---------------------------------------------------------------------------
const lab = (d: Omit<LabDef, 'strict' | 'decimals'> & { strict?: boolean; decimals?: number }): LabDef => ({ strict: true, decimals: 2, ...d })

const VISC_NOTE = (oil: string, v: number, t: number) => `New-oil viscosity assumed ${v} cSt at ${t} °C (${oil}) until the lubricant spec is confirmed.`
const TAN_NOTE = (v: number) => `Fresh-oil TAN assumed ${v} mg KOH/g.`
const OX_NOTE = 'Fresh-oil oxidation baseline assumed 10 Abs/cm.'
const FE_NOTE = (ppm: number) =>
  `“Above baseline” quantified as more than 1.5 × the unit’s baseline and “rapid increase” as more than 2 ×; fleet default baseline ${ppm} ppm until the unit has 3 samples.`

export const LAB: LabDef[] = [
  // Engine oil
  lab({ key: 'eng.visc100', compartment: 'Engine', csvLocation: 'Engine Oil Analysis', csvName: 'Viscosity @ 100°C', csvWarning: '±15% from new oil', csvCritical: '±25%', indication: 'Oil thickening or thinning; possible oxidation or fuel dilution', label: 'Viscosity at 100 °C', unit: 'cSt', rule: 'pctBandRef', ref: 'newOil', decimals: 1, component: 'Engine', assumed: VISC_NOTE('15W-40', 14.5, 100), defaults: { warning: 15, critical: 25, ref: 14.5, min: 0, max: 60 } }),
  lab({ key: 'eng.water', compartment: 'Engine', csvLocation: 'Engine Oil Analysis', csvName: 'Water Content', csvWarning: 'Above 0.10%', csvCritical: 'Above 0.20%', indication: 'Water contamination, condensation, or coolant leakage', label: 'Water', unit: '%', rule: 'above', component: 'Engine', defaults: { warning: 0.1, critical: 0.2, min: 0, max: 100 } }),
  lab({ key: 'eng.fuel', compartment: 'Engine', csvLocation: 'Engine Oil Analysis', csvName: 'Fuel Dilution', csvWarning: 'Above 2%', csvCritical: 'Above 5%', indication: 'Injector leakage, incomplete combustion, or excessive idling', label: 'Fuel dilution', unit: '%', rule: 'above', decimals: 1, component: 'Engine', defaults: { warning: 2, critical: 5, min: 0, max: 100 } }),
  lab({ key: 'eng.soot', compartment: 'Engine', csvLocation: 'Engine Oil Analysis', csvName: 'Soot Content', csvWarning: 'Above 2.5%', csvCritical: 'Above 5%', indication: 'Poor combustion, excessive idling, or restricted air intake', label: 'Soot', unit: '%', rule: 'above', decimals: 1, component: 'Engine', defaults: { warning: 2.5, critical: 5, min: 0, max: 100 } }),
  lab({ key: 'eng.tbn', compartment: 'Engine', csvLocation: 'Engine Oil Analysis', csvName: 'TBN', csvWarning: 'Below 4 mg KOH/g', csvCritical: 'Below 3 mg KOH/g', indication: 'Reduced oil reserve against acidic combustion products', label: 'TBN', unit: 'mg KOH/g', rule: 'below', decimals: 1, component: 'Engine', defaults: { warning: 4, critical: 3, min: 0, max: 30 } }),
  lab({ key: 'eng.tan', compartment: 'Engine', csvLocation: 'Engine Oil Analysis', csvName: 'TAN', csvWarning: 'Increase of 2 mg KOH/g from fresh oil', csvCritical: 'Increase of 3 mg KOH/g', indication: 'Oil oxidation and acid formation', label: 'TAN', unit: 'mg KOH/g', rule: 'deltaAboveRef', ref: 'freshOil', strict: false, decimals: 1, component: 'Engine', assumed: TAN_NOTE(2.0), defaults: { warning: 2, critical: 3, ref: 2.0, min: 0, max: 30 } }),
  lab({ key: 'eng.oxid', compartment: 'Engine', csvLocation: 'Engine Oil Analysis', csvName: 'Oxidation', csvWarning: '20% above fresh oil baseline', csvCritical: '30% above baseline', indication: 'Oil degradation due to excessive heat', label: 'Oxidation', unit: 'Abs/cm', rule: 'pctAboveRef', ref: 'freshOil', decimals: 1, component: 'Engine', assumed: OX_NOTE, defaults: { warning: 20, critical: 30, ref: 10, min: 0, max: 200 } }),
  lab({ key: 'eng.glycol', compartment: 'Engine', csvLocation: 'Engine Oil Analysis', csvName: 'Glycol', csvWarning: 'Any confirmed detection', csvCritical: 'Confirmed detection', indication: 'Coolant entering engine oil', label: 'Glycol (coolant)', unit: 'result', rule: 'category', text: true, decimals: 0, component: 'Cooling system', assumed: 'Sheet gives the same wording for both levels. Quantified as Suspected/trace = Check (retest), Confirmed = Stop.', options: [{ value: 'Negative', level: 'ok' }, { value: 'Suspected / trace', level: 'warning' }, { value: 'Confirmed', level: 'critical' }], defaults: { warning: 0, critical: 0, min: 0, max: 0 } }),
  // Transmission oil
  lab({ key: 'trn.visc100', compartment: 'Transmission', csvLocation: 'Transmission Oil Analysis', csvName: 'Viscosity @ 100°C', csvWarning: '±10% from new oil', csvCritical: '±15%', indication: 'Oil degradation or incorrect lubricant', label: 'Viscosity at 100 °C', unit: 'cSt', rule: 'pctBandRef', ref: 'newOil', decimals: 1, component: 'Transmission', assumed: VISC_NOTE('TO-4 SAE 30', 11, 100), defaults: { warning: 10, critical: 15, ref: 11, min: 0, max: 60 } }),
  lab({ key: 'trn.water', compartment: 'Transmission', csvLocation: 'Transmission Oil Analysis', csvName: 'Water Content', csvWarning: 'Above 0.05%', csvCritical: 'Above 0.10%', indication: 'Water ingress, condensation, or cooler leakage', label: 'Water', unit: '%', rule: 'above', component: 'Transmission', defaults: { warning: 0.05, critical: 0.1, min: 0, max: 100 } }),
  lab({ key: 'trn.tan', compartment: 'Transmission', csvLocation: 'Transmission Oil Analysis', csvName: 'TAN', csvWarning: 'Increase of 1 mg KOH/g', csvCritical: 'Increase of 2 mg KOH/g', indication: 'Oxidation and lubricant deterioration', label: 'TAN', unit: 'mg KOH/g', rule: 'deltaAboveRef', ref: 'freshOil', strict: false, decimals: 1, component: 'Transmission', assumed: TAN_NOTE(1.0), defaults: { warning: 1, critical: 2, ref: 1.0, min: 0, max: 30 } }),
  lab({ key: 'trn.oxid', compartment: 'Transmission', csvLocation: 'Transmission Oil Analysis', csvName: 'Oxidation', csvWarning: '20% above baseline', csvCritical: '30% above baseline', indication: 'Overheating and oil deterioration', label: 'Oxidation', unit: 'Abs/cm', rule: 'pctAboveRef', ref: 'freshOil', decimals: 1, component: 'Transmission', assumed: OX_NOTE, defaults: { warning: 20, critical: 30, ref: 10, min: 0, max: 200 } }),
  lab({ key: 'trn.fe', compartment: 'Transmission', csvLocation: 'Transmission Oil Analysis', csvName: 'Ferrous Wear Debris', csvWarning: 'Above established baseline', csvCritical: 'Rapid increase from baseline', indication: 'Gear, clutch, bearing, or shaft deterioration', label: 'Iron (ferrous wear)', unit: 'ppm', rule: 'ratioAboveRef', ref: 'unitBaseline', decimals: 0, component: 'Transmission', assumed: FE_NOTE(40), defaults: { warning: 1.5, critical: 2, ref: 40, min: 0, max: 5000 } }),
  // Hydraulic oil
  lab({ key: 'hyd.visc40', compartment: 'Hydraulic', csvLocation: 'Hydraulic Oil Analysis', csvName: 'Viscosity @ 40°C', csvWarning: '±10% from new oil', csvCritical: '±15%', indication: 'Oil degradation, overheating, or cross-contamination', label: 'Viscosity at 40 °C', unit: 'cSt', rule: 'pctBandRef', ref: 'newOil', decimals: 1, component: 'Hydraulic system', assumed: VISC_NOTE('ISO VG 46', 46, 40), defaults: { warning: 10, critical: 15, ref: 46, min: 0, max: 500 } }),
  lab({ key: 'hyd.water', compartment: 'Hydraulic', csvLocation: 'Hydraulic Oil Analysis', csvName: 'Water Content', csvWarning: 'Above 0.05%', csvCritical: 'Above 0.10%', indication: 'Water contamination, corrosion, and reduced lubrication', label: 'Water', unit: '%', rule: 'above', component: 'Hydraulic system', defaults: { warning: 0.05, critical: 0.1, min: 0, max: 100 } }),
  lab({ key: 'hyd.tan', compartment: 'Hydraulic', csvLocation: 'Hydraulic Oil Analysis', csvName: 'TAN', csvWarning: 'Increase of 0.5 mg KOH/g', csvCritical: 'Increase of 1 mg KOH/g', indication: 'Oil oxidation and degradation', label: 'TAN', unit: 'mg KOH/g', rule: 'deltaAboveRef', ref: 'freshOil', strict: false, component: 'Hydraulic system', assumed: TAN_NOTE(0.5), defaults: { warning: 0.5, critical: 1, ref: 0.5, min: 0, max: 30 } }),
  lab({ key: 'hyd.oxid', compartment: 'Hydraulic', csvLocation: 'Hydraulic Oil Analysis', csvName: 'Oxidation', csvWarning: '20% above baseline', csvCritical: '30% above baseline', indication: 'Excessive heat and oil deterioration', label: 'Oxidation', unit: 'Abs/cm', rule: 'pctAboveRef', ref: 'freshOil', decimals: 1, component: 'Hydraulic system', assumed: OX_NOTE, defaults: { warning: 20, critical: 30, ref: 10, min: 0, max: 200 } }),
  lab({ key: 'hyd.iso', compartment: 'Hydraulic', csvLocation: 'Hydraulic Oil Analysis', csvName: 'ISO Cleanliness Code', csvWarning: 'Above OEM target', csvCritical: '2 or more ISO code increases from target', indication: 'Dirt contamination and accelerated pump/valve wear', label: 'ISO cleanliness code', unit: 'ISO 4406', rule: 'isoAboveRef', ref: 'oem', strict: false, text: true, decimals: 0, component: 'Hydraulic system', assumed: 'OEM target code assumed 18/16/13. Check = any range 1 code above target; Stop = 2 or more codes above.', defaults: { warning: 1, critical: 2, refCode: '18/16/13', min: 0, max: 0 } }),
  lab({ key: 'hyd.fe', compartment: 'Hydraulic', csvLocation: 'Hydraulic Oil Analysis', csvName: 'Ferrous Wear Debris', csvWarning: 'Above established baseline', csvCritical: 'Rapid increase from baseline', indication: 'Hydraulic pump, cylinder rod, or valve wear', label: 'Iron (ferrous wear)', unit: 'ppm', rule: 'ratioAboveRef', ref: 'unitBaseline', decimals: 0, component: 'Hydraulic system', assumed: FE_NOTE(10), defaults: { warning: 1.5, critical: 2, ref: 10, min: 0, max: 5000 } }),
  // Gear / differential oil
  lab({ key: 'gear.visc40', compartment: 'Gear', csvLocation: 'Gear Oil / Differential Oil Analysis', csvName: 'Viscosity @ 40°C', csvWarning: '±10% from new oil', csvCritical: '±15%', indication: 'Oil degradation or incorrect lubricant', label: 'Viscosity at 40 °C', unit: 'cSt', rule: 'pctBandRef', ref: 'newOil', decimals: 0, component: 'Final drive', assumed: VISC_NOTE('SAE 80W-90', 135, 40), defaults: { warning: 10, critical: 15, ref: 135, min: 0, max: 1000 } }),
  lab({ key: 'gear.water', compartment: 'Gear', csvLocation: 'Gear Oil / Differential Oil Analysis', csvName: 'Water Content', csvWarning: 'Above 0.05%', csvCritical: 'Above 0.10%', indication: 'Water ingress, condensation, or seal failure', label: 'Water', unit: '%', rule: 'above', component: 'Final drive', defaults: { warning: 0.05, critical: 0.1, min: 0, max: 100 } }),
  lab({ key: 'gear.tan', compartment: 'Gear', csvLocation: 'Gear Oil / Differential Oil Analysis', csvName: 'TAN', csvWarning: 'Increase of 1 mg KOH/g', csvCritical: 'Increase of 2 mg KOH/g', indication: 'Oxidation and lubricant deterioration', label: 'TAN', unit: 'mg KOH/g', rule: 'deltaAboveRef', ref: 'freshOil', strict: false, decimals: 1, component: 'Final drive', assumed: TAN_NOTE(1.0), defaults: { warning: 1, critical: 2, ref: 1.0, min: 0, max: 30 } }),
  lab({ key: 'gear.oxid', compartment: 'Gear', csvLocation: 'Gear Oil / Differential Oil Analysis', csvName: 'Oxidation', csvWarning: '20% above baseline', csvCritical: '30% above baseline', indication: 'Excessive heat and lubricant breakdown', label: 'Oxidation', unit: 'Abs/cm', rule: 'pctAboveRef', ref: 'freshOil', decimals: 1, component: 'Final drive', assumed: OX_NOTE, defaults: { warning: 20, critical: 30, ref: 10, min: 0, max: 200 } }),
  lab({ key: 'gear.fe', compartment: 'Gear', csvLocation: 'Gear Oil / Differential Oil Analysis', csvName: 'Ferrous Wear Debris', csvWarning: 'Above established baseline', csvCritical: 'Rapid increase from baseline', indication: 'Gear teeth, pinion, or bearing deterioration', label: 'Iron (ferrous wear)', unit: 'ppm', rule: 'ratioAboveRef', ref: 'unitBaseline', decimals: 0, component: 'Final drive', assumed: FE_NOTE(150), defaults: { warning: 1.5, critical: 2, ref: 150, min: 0, max: 5000 } }),
  lab({ key: 'gear.si', compartment: 'Gear', csvLocation: 'Gear Oil / Differential Oil Analysis', csvName: 'Silicon', csvWarning: 'Above baseline by 10 ppm', csvCritical: 'Above baseline by 20 ppm', indication: 'Possible dirt or dust ingress', label: 'Silicon (dirt)', unit: 'ppm', rule: 'deltaAboveRef', ref: 'unitBaseline', decimals: 0, component: 'Final drive', assumed: 'Fleet default silicon baseline 10 ppm until the unit has 3 samples.', defaults: { warning: 10, critical: 20, ref: 10, min: 0, max: 5000 } }),
]

export const DAILY_BY_KEY = Object.fromEntries(DAILY.map((d) => [d.key, d])) as Record<ParamKey, DailyDef>
export const LAB_BY_KEY: Record<LabKey, LabDef> = Object.fromEntries(LAB.map((d) => [d.key, d]))
export const COMPARTMENTS: OilCompartment[] = ['Engine', 'Transmission', 'Hydraulic', 'Gear']
export const COMPARTMENT_LABEL: Record<OilCompartment, string> = { Engine: 'Engine oil', Transmission: 'Transmission oil', Hydraulic: 'Hydraulic oil', Gear: 'Gear / differential oil' }
export const DAILY_SYSTEMS: { id: DailySystem; title: string; icon: string }[] = [
  { id: 'Engine', title: 'Engine', icon: 'gauge' },
  { id: 'Transmission', title: 'Transmission', icon: 'sync' },
  { id: 'Hydraulic', title: 'Hydraulics', icon: 'flask' },
  { id: 'Fuel', title: 'Fuel', icon: 'pulse' },
  { id: 'Electrical', title: 'Battery & charging', icon: 'bolt' },
]

export function defaultThresholds(): ThresholdTable {
  const out = {} as ThresholdTable
  for (const t of EQUIPMENT_TYPES) out[t] = Object.fromEntries(DAILY.map((d) => [d.key, { ...d.defaults[t] }])) as Record<ParamKey, Threshold>
  return out
}

export function defaultLabThresholds(): Record<LabKey, Threshold> {
  return Object.fromEntries(LAB.map((d) => [d.key, { ...d.defaults }]))
}

// ---------------------------------------------------------------------------
// Turning rules into numbers
// ---------------------------------------------------------------------------

/** Concrete limits in the parameter's unit. A side that is undefined does not apply. */
export interface Limits {
  lowWarn?: number
  lowCrit?: number
  highWarn?: number
  highCrit?: number
  strict: boolean
  ref?: number
}

/** The reference value in force: the unit's own baseline when it has one, else the configured value. */
export function effectiveRef(def: BaseDef, th: Threshold, unitBaseline?: number | null): number | undefined {
  if (def.ref === 'unitBaseline' && unitBaseline !== undefined && unitBaseline !== null && Number.isFinite(unitBaseline)) return unitBaseline
  return th.ref
}

export function resolveLimits(def: BaseDef, th: Threshold, unitBaseline?: number | null): Limits {
  const r = effectiveRef(def, th, unitBaseline) ?? 0
  const w = th.warning
  const c = th.critical
  const base = { strict: def.strict, ref: def.ref ? r : undefined }
  switch (def.rule) {
    case 'above':
      return { ...base, highWarn: w, highCrit: c }
    case 'below':
      return { ...base, lowWarn: w, lowCrit: c }
    case 'pctBelowRef':
      return { ...base, lowWarn: r * (1 - w / 100), lowCrit: r * (1 - c / 100) }
    case 'pctAboveRef':
      return { ...base, highWarn: r * (1 + w / 100), highCrit: r * (1 + c / 100) }
    case 'pctBandRef':
      return { ...base, lowWarn: r * (1 - w / 100), lowCrit: r * (1 - c / 100), highWarn: r * (1 + w / 100), highCrit: r * (1 + c / 100) }
    case 'deltaBandRef':
      return { ...base, lowWarn: r - w, lowCrit: r - c, highWarn: r + w, highCrit: r + c }
    case 'deltaAboveRef':
      return { ...base, highWarn: r + w, highCrit: r + c }
    case 'ratioAboveRef':
      return { ...base, highWarn: r * w, highCrit: r * c }
    default:
      return base
  }
}

/** Which way is worse — used for trend detection. */
export function direction(def: BaseDef): 'high' | 'low' | 'band' | 'none' {
  if (['above', 'pctAboveRef', 'deltaAboveRef', 'ratioAboveRef'].includes(def.rule)) return 'high'
  if (['below', 'pctBelowRef'].includes(def.rule)) return 'low'
  if (['pctBandRef', 'deltaBandRef'].includes(def.rule)) return 'band'
  return 'none'
}

export function classify(v: number, lim: Limits): Level {
  const hi = (t: number | undefined) => t !== undefined && (lim.strict ? v > t : v >= t)
  const lo = (t: number | undefined) => t !== undefined && (lim.strict ? v < t : v <= t)
  if (hi(lim.highCrit) || lo(lim.lowCrit)) return 'critical'
  if (hi(lim.highWarn) || lo(lim.lowWarn)) return 'warning'
  return 'ok'
}

export function parseIso(code: string): number[] | null {
  const parts = code.trim().split('/').map((x) => Number(x.trim()))
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 30)) return null
  return parts.length === 2 ? [NaN, ...parts] : parts
}

/** Classify any value (number or text) against a parameter's rule. Returns null for an empty or invalid value. */
export function evaluate(def: BaseDef & { options?: LabDef['options'] }, th: Threshold, value: number | string | undefined | null, unitBaseline?: number | null): Level | null {
  if (value === undefined || value === null || value === '') return null
  if (def.rule === 'category') return def.options?.find((o) => o.value === value)?.level ?? null
  if (def.rule === 'isoAboveRef') {
    const got = parseIso(String(value))
    const target = parseIso(th.refCode ?? '')
    if (!got || !target) return null
    const steps = Math.max(...got.map((g, i) => (Number.isNaN(g) || Number.isNaN(target[i]) ? -Infinity : g - target[i])))
    return steps >= th.critical ? 'critical' : steps >= th.warning ? 'warning' : 'ok'
  }
  const v = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(v)) return null
  return classify(v, resolveLimits(def, th, unitBaseline))
}

export function fmtValue(v: number, decimals: number): string {
  return Number(v.toFixed(decimals)).toLocaleString('en-US', { maximumFractionDigits: decimals })
}

/** Plain-language bands for the mechanic: what is OK, what to check, when to stop. */
export function bands(def: BaseDef & { options?: LabDef['options'] }, th: Threshold, unitBaseline?: number | null, convert: (v: number) => number = (v) => v, unit = def.unit): { ok: string; check: string; stop: string } {
  if (def.rule === 'category') {
    const by = (l: Level) => def.options!.filter((o) => o.level === l).map((o) => o.value).join(', ')
    return { ok: by('ok'), check: by('warning'), stop: by('critical') }
  }
  if (def.rule === 'isoAboveRef') {
    return { ok: `${th.refCode} or cleaner`, check: `${th.warning} code above ${th.refCode}`, stop: `${th.critical}+ codes above ${th.refCode}` }
  }
  const lim = resolveLimits(def, th, unitBaseline)
  const f = (v: number) => `${fmtValue(convert(v), def.decimals)}`
  const u = unit === 'result' ? '' : ` ${unit}`
  const s = lim.strict
  const hasHigh = lim.highWarn !== undefined
  const hasLow = lim.lowWarn !== undefined
  if (hasHigh && hasLow) {
    return {
      ok: `${f(lim.lowWarn!)}–${f(lim.highWarn!)}${u}`,
      check: `outside ${f(lim.lowWarn!)}–${f(lim.highWarn!)}`,
      stop: `below ${f(lim.lowCrit!)} or above ${f(lim.highCrit!)}${u}`,
    }
  }
  if (hasHigh) {
    return s
      ? { ok: `up to ${f(lim.highWarn!)}${u}`, check: `above ${f(lim.highWarn!)}`, stop: `above ${f(lim.highCrit!)}${u}` }
      : { ok: `below ${f(lim.highWarn!)}${u}`, check: `${f(lim.highWarn!)} or more`, stop: `${f(lim.highCrit!)}${u} or more` }
  }
  return s
    ? { ok: `${f(lim.lowWarn!)}${u} or more`, check: `below ${f(lim.lowWarn!)}`, stop: `below ${f(lim.lowCrit!)}${u}` }
    : { ok: `above ${f(lim.lowWarn!)}${u}`, check: `${f(lim.lowWarn!)} or less`, stop: `${f(lim.lowCrit!)}${u} or less` }
}

/** How the rule reads in words, for the Thresholds page and the exported mapping. */
export function ruleText(def: BaseDef, th: Threshold): string {
  const refName = def.ref === 'oem' ? 'OEM target' : def.ref === 'newOil' ? 'new-oil value' : def.ref === 'freshOil' ? 'fresh-oil value' : 'unit baseline'
  const u = def.unit
  switch (def.rule) {
    case 'above': return `Check ${def.strict ? '>' : '≥'} ${th.warning} ${u}; Stop ${def.strict ? '>' : '≥'} ${th.critical} ${u}`
    case 'below': return `Check ${def.strict ? '<' : '≤'} ${th.warning} ${u}; Stop ${def.strict ? '<' : '≤'} ${th.critical} ${u}`
    case 'pctBelowRef': return `Check > ${th.warning}% below ${refName}; Stop > ${th.critical}% below`
    case 'pctAboveRef': return `Check > ${th.warning}% above ${refName}; Stop > ${th.critical}% above`
    case 'pctBandRef': return `Check > ±${th.warning}% from ${refName}; Stop > ±${th.critical}%`
    case 'deltaBandRef': return `Check > ±${th.warning} ${u} from ${refName}; Stop > ±${th.critical} ${u}`
    case 'deltaAboveRef': return `Check ${def.strict ? '>' : '≥'} +${th.warning} ${u} over ${refName}; Stop ${def.strict ? '>' : '≥'} +${th.critical} ${u}`
    case 'ratioAboveRef': return `Check > ${th.warning} × ${refName}; Stop > ${th.critical} × ${refName}`
    case 'isoAboveRef': return `Check ≥ ${th.warning} code above target; Stop ≥ ${th.critical} codes above`
    case 'category': return 'Lab result category'
  }
}

export function refLabel(def: BaseDef): string | null {
  if (!def.ref) return null
  return def.ref === 'oem' ? 'OEM target' : def.ref === 'newOil' ? 'New-oil value' : def.ref === 'freshOil' ? 'Fresh-oil value' : 'Fleet default baseline'
}

/** Unit baseline for a daily parameter: mean of its first 30 readings, needs ≥ 10. */
export function dailyBaseline(history: Reading[], key: ParamKey): number | null {
  const vals = history
    .map((h) => h.values[key])
    .filter((v): v is number => v !== undefined)
    .slice(0, 30)
  if (vals.length < 10) return null
  return vals.reduce((s, v) => s + v, 0) / vals.length
}

/** Unit baseline for a lab parameter: mean of the unit's earlier samples, needs ≥ 3. */
export function labBaseline(previous: { values: Record<LabKey, number | string> }[], key: LabKey): number | null {
  const vals = previous.map((p) => p.values[key]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (vals.length < 3) return null
  return vals.reduce((s, v) => s + v, 0) / vals.length
}

export interface LabFinding {
  key: LabKey
  level: Exclude<Level, 'ok'>
  message: string
  indication: string
}

/** Classify a whole oil report. Severity is the worst parameter (Normal / Caution / Critical). */
export function evaluateOilReport(compartment: OilCompartment, values: Record<LabKey, number | string>, table: Record<LabKey, Threshold>, previous: { values: Record<LabKey, number | string> }[]): { severity: OilSeverity; findings: LabFinding[] } {
  const findings: LabFinding[] = []
  for (const def of LAB.filter((d) => d.compartment === compartment)) {
    const th = table[def.key] ?? def.defaults
    const v = values[def.key]
    const lvl = evaluate(def, th, v, labBaseline(previous, def.key))
    if (!lvl || lvl === 'ok') continue
    const b = bands(def, th, labBaseline(previous, def.key))
    const shown = typeof v === 'number' ? `${fmtValue(v, def.decimals)}${def.unit === 'result' ? '' : ` ${def.unit}`}` : String(v)
    findings.push({ key: def.key, level: lvl, message: `${def.label} ${shown} — ${lvl === 'critical' ? `Stop (${b.stop})` : `Check (${b.check})`}`, indication: def.indication })
  }
  findings.sort((a, b) => (a.level === b.level ? 0 : a.level === 'critical' ? -1 : 1))
  const severity: OilSeverity = findings.some((f) => f.level === 'critical') ? 'Critical' : findings.length ? 'Caution' : 'Normal'
  return { severity, findings }
}
