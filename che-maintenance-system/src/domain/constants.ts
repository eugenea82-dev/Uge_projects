import type {
  ArmCategory,
  Cause,
  EquipmentType,
  ExternalReason,
  ParamDef,
  ParamKey,
  RejectReason,
  RiskLevel,
  Role,
  StatusCode,
  ThresholdTable,
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

export const PARAMS: ParamDef[] = [
  { key: 'engineTemp', label: 'Engine temperature', unit: '°C', kind: 'temperature', component: 'Engine', direction: 'high' },
  { key: 'transmissionTemp', label: 'Transmission temperature', unit: '°C', kind: 'temperature', component: 'Transmission', direction: 'high' },
  { key: 'hydraulicOilTemp', label: 'Hydraulic oil temperature', unit: '°C', kind: 'temperature', component: 'Hydraulic system', direction: 'high' },
  { key: 'coolantTemp', label: 'Coolant temperature', unit: '°C', kind: 'temperature', component: 'Cooling system', direction: 'high' },
  { key: 'hydraulicPressure', label: 'Hydraulic pressure', unit: 'bar', kind: 'pressure', component: 'Hydraulic system', direction: 'low' },
  { key: 'engineOilPressure', label: 'Engine oil pressure', unit: 'bar', kind: 'pressure', component: 'Engine', direction: 'low' },
  { key: 'transmissionPressure', label: 'Transmission pressure', unit: 'bar', kind: 'pressure', component: 'Transmission', direction: 'low' },
]

export const PARAM_BY_KEY = Object.fromEntries(PARAMS.map((p) => [p.key, p])) as Record<ParamKey, ParamDef>

export const BAR_PER_PSI = 0.0689476

/** Nominal operating value per parameter (used by the simulator and as a baseline seed). */
export const NOMINAL: Record<ParamKey, number> = {
  engineTemp: 88,
  transmissionTemp: 82,
  hydraulicOilTemp: 60,
  coolantTemp: 85,
  hydraulicPressure: 190,
  engineOilPressure: 3.8,
  transmissionPressure: 17,
}

const BASE_THRESHOLDS: Record<ParamKey, { warning: number; critical: number; min: number; max: number }> = {
  engineTemp: { warning: 98, critical: 105, min: 0, max: 150 },
  transmissionTemp: { warning: 95, critical: 110, min: 0, max: 160 },
  hydraulicOilTemp: { warning: 75, critical: 85, min: 0, max: 130 },
  coolantTemp: { warning: 96, critical: 103, min: 0, max: 140 },
  hydraulicPressure: { warning: 170, critical: 155, min: 0, max: 350 },
  engineOilPressure: { warning: 2.5, critical: 1.8, min: 0, max: 10 },
  transmissionPressure: { warning: 14, critical: 12, min: 0, max: 40 },
}

/** Default (OEM-derived) thresholds per type — placeholders until OEM manuals are loaded (A-06). */
export function defaultThresholds(): ThresholdTable {
  const types: EquipmentType[] = ['Reach Stacker', 'Forklift', 'Empty Container Handler', 'Yard Tractor']
  const out = {} as ThresholdTable
  for (const t of types) {
    out[t] = structuredClone(BASE_THRESHOLDS)
    if (t === 'Yard Tractor') {
      out[t].hydraulicPressure = { warning: 120, critical: 105, min: 0, max: 250 }
    }
  }
  return out
}

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
