// Core domain types for AssetPulse AI (BRD v2.0).
// Field names follow the BRD terminology so requirements stay traceable.

export type StatusCode =
  | 'OPERATIONAL'
  | 'DOWN'
  | 'UNDER_REPAIR'
  | 'AWAITING_PARTS'
  | 'UNDER_REVIEW'
  | 'AWAITING_PO'
  | 'TESTING'
  | 'FOR_DISPOSAL'

/** A-R-M roll-up category (Annex C.3). */
export type ArmCategory = 'AVAILABLE' | 'UNAVAILABLE_TECHNICAL' | 'UNAVAILABLE_EXTERNAL' | 'EXCLUDED'

export type Cause = 'technical' | 'external'

export type ExternalReason = 'No operator' | 'No job' | 'Weather' | 'Yard congestion'

export type EquipmentType = 'Reach Stacker' | 'Forklift' | 'Empty Container Handler' | 'Yard Tractor'

export type Criticality = 'A' | 'B' | 'C'

export type RiskLevel = 'Low' | 'Medium' | 'High' | 'Critical'

export type Role = 'EQUIPMENT_SPECIALIST' | 'AM_MANAGER'

export interface Unit {
  assetId: string // same as EMMS asset ID (NFR-D01)
  type: EquipmentType
  make: string
  model: string
  serialNo: string
  year: number
  location: string
  criticality: Criticality
  hourMeter: number
  pmIntervalHours: number
  lastPmHourMeter: number
}

export interface StatusEvent {
  id: string
  assetId: string
  at: number // epoch ms — the status holds until the next event
  status: StatusCode
  cause: Cause | null // null only for OPERATIONAL / FOR_DISPOSAL
  externalReason?: ExternalReason
  failureCode?: string
  user: string
  note?: string
  migrated?: boolean // week-granular YardPulse history (C-05, NFR-U07)
}

export type ParamKey =
  | 'engineTemp'
  | 'transmissionTemp'
  | 'hydraulicOilTemp'
  | 'coolantTemp'
  | 'hydraulicPressure'
  | 'engineOilPressure'
  | 'transmissionPressure'

export interface ParamDef {
  key: ParamKey
  label: string
  unit: '°C' | 'bar'
  kind: 'temperature' | 'pressure'
  component: string
  /** 'high' = higher is worse; 'low' = lower is worse */
  direction: 'high' | 'low'
}

export interface Threshold {
  warning: number
  critical: number
  /** plausible input range for validation (FR-10) */
  min: number
  max: number
}

/** Thresholds per equipment type and parameter (FR-11). */
export type ThresholdTable = Record<EquipmentType, Record<ParamKey, Threshold>>

export interface Reading {
  id: string
  assetId: string
  at: number
  user: string
  hourMeter: number
  values: Partial<Record<ParamKey, number>> // stored in standard units (°C, bar)
}

export type FindingSeverity = 'warning' | 'critical'

export interface ReadingFinding {
  param: ParamKey | 'hourMeter'
  kind: 'limit' | 'baseline' | 'trend' | 'hourMeter'
  severity: FindingSeverity
  message: string
}

export type OilSeverity = 'Normal' | 'Caution' | 'Critical'

export interface OilSample {
  id: string
  assetId: string
  sampledAt: number
  lab: string
  compartment: 'Engine' | 'Transmission' | 'Hydraulic'
  viscosity: number
  waterPct: number
  fuelDilutionPct: number
  ironPpm: number
  particleCode: string
  severity: OilSeverity
  attachment?: string
  user: string
}

export type NdtSeverity = 'None' | 'Minor' | 'Major' | 'Critical'

export interface NdtFinding {
  id: string
  assetId: string
  inspectedAt: number
  method: 'Ultrasonic' | 'Magnetic particle' | 'Dye penetrant' | 'Visual'
  location: string
  finding: string
  defectSizeMm: number
  severity: NdtSeverity
  inspector: string
  attachment?: string
  user: string
}

export interface WorkOrder {
  woNumber: string
  assetId: string
  kind: 'Corrective' | 'PM' | 'Predictive'
  failureCode?: string
  description: string
  openedAt: number
  dueAt?: number // PM schedule date
  closedAt?: number
  cost: number // PHP
}

export interface RiskFactor {
  label: string
  points: number
  component: string
}

export type DataSufficiency = 'Good' | 'Limited' | 'Insufficient'

export interface RiskScore {
  assetId: string
  score: number
  level: RiskLevel | null // null when data is insufficient (FR-16)
  factors: RiskFactor[]
  sufficiency: DataSufficiency
  component: string
  dataDate: number
  modelVersion: string
  method: 'rule-based' // NFR-M03: rule-based until enough failure history exists
}

export type AlertStatus = 'Open' | 'Acknowledged' | 'Scheduled' | 'In Progress' | 'Closed'

export type DecisionType = 'accept' | 'defer' | 'reject'

export type RejectReason =
  | 'Reading error'
  | 'Known condition — already planned'
  | 'Within acceptable operating band'
  | 'Duplicate of existing work'
  | 'Other'

export type OutcomeType = 'Confirmed fault' | 'No fault found' | 'Failed before action' | 'Not actioned'

export interface Alert {
  id: string
  assetId: string
  component: string
  level: RiskLevel
  score: number
  reason: string
  factors: RiskFactor[]
  recommendedAction: string
  dataDate: number
  createdAt: number
  dueAt: number // decision SLA
  status: AlertStatus
  source: 'risk-score' | 'ndt-critical' | 'stalled-restoration'
  modelVersion: string
  requiresRemoval: boolean
  decision?: {
    type: DecisionType
    by: string
    at: number
    deferUntil?: number
    rejectReason?: RejectReason
    remarks?: string
  }
  authorization?: {
    state: 'Pending' | 'Approved' | 'Returned'
    by?: string
    at?: number
    remarks?: string
  }
  woNumber?: string
  outcome?: {
    type: OutcomeType
    findings: string
    failureCode?: string
    by: string
    at: number
  }
  /** for prediction-performance: lead time between alert and confirmed failure */
  leadTimeDays?: number
}

export interface AuditEntry {
  id: string
  at: number
  user: string
  role: Role | 'SYSTEM'
  action: string
  entity: string
  before?: string
  after?: string
}

export interface User {
  username: string
  displayName: string
  title: string
  role: Role
  /** null = nationwide; otherwise branch scope ('B' in the permissions matrix) */
  locations: string[] | null
  initials: string
}

export interface SyncInfo {
  emmsLastSync: number
  scoringLastRun: number
  exceptions: { recordId: string; assetId: string; reason: string }[]
}
