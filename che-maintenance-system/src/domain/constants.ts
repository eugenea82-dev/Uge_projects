import type {
  ArmCategory,
  Cause,
  ExternalReason,
  ParamKey,
  RejectReason,
  RiskLevel,
  Role,
  StatusCode,
} from './types.ts'

export const HOUR = 3_600_000
export const DAY = 24 * HOUR
export const WEEK = 7 * DAY

/** Required time basis: 168 h per week (A-10). */
export const REQUIRED_HOURS_PER_WEEK = 168
export const ROLLING_WEEKS = 13
export const REPEAT_WINDOW_WEEKS = 8
export const STALLED_LIMIT_HOURS = 72 // FR-39 [e.g., 3 days]
export const STALE_DATA_HOURS = 26 // NFR-C04
export const SESSION_TIMEOUT_MIN = 30 // NFR-S03
export const MODEL_VERSION = 'rules-v0.1'

export const LOCATIONS = [
  'Manila CY1',
  'Manila CY2',
  'Manila CY3',
  'Asinan',
  'Batangas',
  'Bacolod',
  'Iloilo',
  'Cebu',
  'Cagayan',
  'Davao',
  'Gensan',
  'Zamboanga',
] as const

export interface StatusDef {
  code: StatusCode
  label: string
  short: string
  colorVar: string // CSS custom property with the YardPulse status colour
  colorName: string
  icon: string
  /** A-R-M category when the cause is technical (Annex C.3) */
  arm: ArmCategory
  /** bucket used for the MTTR breakdown (FR-38) */
  mttrBucket?: MttrBucket
}

export type MttrBucket = 'Technician wait' | 'Diagnosis' | 'PO / approval wait' | 'Parts wait' | 'Repair' | 'Testing'

export const MTTR_BUCKETS: MttrBucket[] = [
  'Technician wait',
  'Diagnosis',
  'PO / approval wait',
  'Parts wait',
  'Repair',
  'Testing',
]

// The YardPulse 8-status convention (FR-32, Annex C.3).
export const STATUSES: Record<StatusCode, StatusDef> = {
  OPERATIONAL: { code: 'OPERATIONAL', label: 'Operational', short: 'Operational', colorVar: '--st-green', colorName: 'Green', icon: 'check', arm: 'AVAILABLE' },
  DOWN: { code: 'DOWN', label: 'Down / Critical', short: 'Down', colorVar: '--st-red', colorName: 'Red', icon: 'stop', arm: 'UNAVAILABLE_TECHNICAL', mttrBucket: 'Technician wait' },
  UNDER_REPAIR: { code: 'UNDER_REPAIR', label: 'Under Repair', short: 'Repair', colorVar: '--st-amber', colorName: 'Amber', icon: 'wrench', arm: 'UNAVAILABLE_TECHNICAL', mttrBucket: 'Repair' },
  AWAITING_PARTS: { code: 'AWAITING_PARTS', label: 'Awaiting Parts / Dependency', short: 'Parts', colorVar: '--st-orange', colorName: 'Orange', icon: 'box', arm: 'UNAVAILABLE_TECHNICAL', mttrBucket: 'Parts wait' },
  UNDER_REVIEW: { code: 'UNDER_REVIEW', label: 'Under Review / Troubleshooting', short: 'Review', colorVar: '--st-yellow', colorName: 'Yellow', icon: 'search', arm: 'UNAVAILABLE_TECHNICAL', mttrBucket: 'Diagnosis' },
  AWAITING_PO: { code: 'AWAITING_PO', label: 'Awaiting PO / Approval', short: 'PO', colorVar: '--st-purple', colorName: 'Purple', icon: 'doc', arm: 'UNAVAILABLE_TECHNICAL', mttrBucket: 'PO / approval wait' },
  TESTING: { code: 'TESTING', label: 'Testing / Commissioning', short: 'Testing', colorVar: '--st-blue', colorName: 'Blue', icon: 'gauge', arm: 'UNAVAILABLE_TECHNICAL', mttrBucket: 'Testing' },
  FOR_DISPOSAL: { code: 'FOR_DISPOSAL', label: 'For Disposal', short: 'Disposal', colorVar: '--st-gray', colorName: 'Gray', icon: 'archive', arm: 'EXCLUDED' },
}

export const STATUS_ORDER: StatusCode[] = [
  'OPERATIONAL',
  'DOWN',
  'UNDER_REVIEW',
  'AWAITING_PO',
  'AWAITING_PARTS',
  'UNDER_REPAIR',
  'TESTING',
  'FOR_DISPOSAL',
]

/** Annex C.3 mapping: any status with an external cause is Unavailable – External. */
export function armCategory(status: StatusCode, cause: Cause | null): ArmCategory {
  if (status === 'FOR_DISPOSAL') return 'EXCLUDED'
  if (status === 'OPERATIONAL') return 'AVAILABLE'
  if (cause === 'external') return 'UNAVAILABLE_EXTERNAL'
  return 'UNAVAILABLE_TECHNICAL'
}

export const EXTERNAL_REASONS: ExternalReason[] = ['No operator', 'No job', 'Weather', 'Yard congestion']

export const RISK_LEVELS: RiskLevel[] = ['Low', 'Medium', 'High', 'Critical']

export const RISK_META: Record<RiskLevel, { colorVar: string; icon: string; min: number }> = {
  Low: { colorVar: '--risk-low', icon: 'shield', min: 0 },
  Medium: { colorVar: '--risk-medium', icon: 'alert', min: 30 },
  High: { colorVar: '--risk-high', icon: 'alert', min: 50 },
  Critical: { colorVar: '--risk-critical', icon: 'bolt', min: 70 },
}

/** Decision SLA per severity (TO-BE step 8). Working days simplified to 24 h. */
export const DECISION_SLA_HOURS: Record<RiskLevel, number> = {
  Low: 0,
  Medium: 72,
  High: 24,
  Critical: 4,
}

export const BAR_PER_PSI = 0.0689476

/** Nominal operating value per daily parameter, used only by the simulator. Pressures and fuel use the per-type reference. */
export const NOMINAL: Partial<Record<ParamKey, number>> = {
  engineOilTemp: 92,
  engineOilPressure: 3.6,
  coolantTemp: 84,
  engineRpm: 2150,
  transOilTemp: 82,
  transOilPressure: 17,
  hydOilTemp: 58,
  batteryVoltage: 25.2,
  chargingVoltage: 28,
}

// Thresholds now live in the parameter catalog (catalog.ts), quantified from the CHE Data Entry sheet.
export { defaultThresholds, defaultLabThresholds } from './catalog.ts'

/** Baseline deviation tolerance in standard deviations (FR-12). */
export const BASELINE_TOLERANCE_SD = 3
/** Sustained deterioration: N consecutive worsening readings (FR-13). */
export const TREND_CONSECUTIVE = 5

export const FAILURE_CODES: { code: string; label: string; component: string }[] = [
  { code: 'ENG-OVH', label: 'Engine overheating', component: 'Engine' },
  { code: 'ENG-OIL', label: 'Engine oil pressure loss', component: 'Engine' },
  { code: 'HYD-LEAK', label: 'Hydraulic hose / seal leak', component: 'Hydraulic system' },
  { code: 'HYD-PUMP', label: 'Hydraulic pump failure', component: 'Hydraulic system' },
  { code: 'TRN-SLIP', label: 'Transmission slipping', component: 'Transmission' },
  { code: 'CLG-RAD', label: 'Radiator / cooling fault', component: 'Cooling system' },
  { code: 'ELE-STR', label: 'Starter / electrical fault', component: 'Electrical' },
  { code: 'ELE-CHG', label: 'Alternator / charging fault', component: 'Electrical' },
  { code: 'FUE-INJ', label: 'Fuel pump / injector fault', component: 'Fuel system' },
  { code: 'AXL-GEAR', label: 'Axle / differential gear wear', component: 'Final drive' },
  { code: 'BRK-WEAR', label: 'Brake wear / failure', component: 'Brakes' },
  { code: 'TYR-DMG', label: 'Tyre damage', component: 'Tyres' },
  { code: 'SPR-TWL', label: 'Spreader twistlock fault', component: 'Spreader / attachment' },
  { code: 'STR-CRK', label: 'Structural crack (boom / mast)', component: 'Structure' },
]

/** Configurable action library (FR-19). */
export const ACTION_LIBRARY: Record<string, string> = {
  Engine: 'Inspect cooling and lubrication circuits; check oil level and pressure sender; schedule engine diagnostic within the horizon.',
  Transmission: 'Check transmission fluid level and condition; inspect cooler lines; schedule transmission pressure test.',
  'Hydraulic system': 'Inspect hydraulic hoses, seals and pump; take hydraulic oil sample; replace filter if differential pressure is high.',
  'Cooling system': 'Pressure-test radiator and hoses; clean radiator core; verify fan and thermostat operation.',
  'Fuel system': 'Replace fuel filters; check fuel rail pressure and injector balance with the diagnostic tool; review operator idling.',
  Electrical: 'Load-test batteries; check alternator output and regulator; clean and tighten terminals and earth straps.',
  'Final drive': 'Take a gear-oil sample; inspect axle breathers and seals for dirt and water ingress; check differential for play and noise.',
  Structure: 'Remove from lifting duty; perform confirmatory NDT on the flagged weld/boom section before return to service.',
  'Whole unit': 'Review recent failure history with the Supervisor; plan a combined inspection at next PM opportunity.',
  'PM schedule': 'Schedule the overdue preventive maintenance service per LBE-SOP-2026-001.',
}

export const REJECT_REASONS: RejectReason[] = [
  'Reading error',
  'Known condition — already planned',
  'Within acceptable operating band',
  'Duplicate of existing work',
  'Other',
]

/** Role permissions (BRD §3.3), reduced to the two personas in this release. */
export const PERMISSIONS: Record<Role, Record<string, boolean>> = {
  LBE_SPECIALIST: {
    captureReadings: true,
    updateStatus: true,
    uploadLabNdt: true,
    decideAlerts: true,
    authorize: false,
    recordOutcome: true,
    configureThresholds: false,
    exportReports: true,
    runBatch: false,
  },
  AM_MANAGER: {
    captureReadings: false,
    updateStatus: false,
    uploadLabNdt: false,
    decideAlerts: true,
    authorize: true,
    recordOutcome: true,
    configureThresholds: true,
    exportReports: true,
    runBatch: true,
  },
}
