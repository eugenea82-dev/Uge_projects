// Alert creation and the decision workflow (FR-19 to FR-25).
// Status flow: Open → Acknowledged → Scheduled → In Progress → Closed.
// The system never removes a unit or changes a schedule on its own (NFR-M01):
// every transition below is triggered by a named user.

import { ACTION_LIBRARY, DECISION_SLA_HOURS, HOUR } from './constants.ts'
import type { Alert, OutcomeType, RejectReason, RiskScore } from './types.ts'

export function recommendedAction(component: string): string {
  return ACTION_LIBRARY[component] ?? ACTION_LIBRARY['Whole unit']
}

/** High/Critical alerts on Structure, or any Critical alert, require removal from service → BM authorization (FR-22). */
export function requiresRemoval(level: Alert['level'], component: string): boolean {
  return level === 'Critical' || (level === 'High' && component === 'Structure')
}

/** Create an alert for Medium risk and above; never a duplicate open alert for the same unit/component (FR-19). */
export function alertFromScore(score: RiskScore, existing: Alert[], now: number, id: string): Alert | null {
  if (!score.level || score.level === 'Low') return null
  const dup = existing.some((a) => a.assetId === score.assetId && a.component === score.component && a.status !== 'Closed')
  if (dup) return null
  const top = score.factors.slice(0, 2).map((f) => f.label)
  return {
    id,
    assetId: score.assetId,
    component: score.component,
    level: score.level,
    score: score.score,
    reason: top.join('; '),
    factors: score.factors,
    recommendedAction: recommendedAction(score.component),
    dataDate: score.dataDate,
    createdAt: now,
    dueAt: now + DECISION_SLA_HOURS[score.level] * HOUR,
    status: 'Open',
    source: 'risk-score',
    modelVersion: score.modelVersion,
    requiresRemoval: requiresRemoval(score.level, score.component),
  }
}

export class WorkflowError extends Error {}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new WorkflowError(msg)
}

export function accept(a: Alert, by: string, now: number, remarks?: string): Alert {
  assert(a.status === 'Open', 'Only open alerts can be accepted.')
  return {
    ...a,
    status: 'Acknowledged',
    decision: { type: 'accept', by, at: now, remarks },
    authorization: a.requiresRemoval ? { state: 'Pending' } : a.authorization,
  }
}

export function defer(a: Alert, by: string, now: number, deferUntil: number, remarks?: string): Alert {
  assert(a.status === 'Open' || a.status === 'Acknowledged', 'This alert can no longer be deferred.')
  assert(Number.isFinite(deferUntil) && deferUntil > now, 'A defer date in the future is required.')
  return { ...a, status: 'Acknowledged', decision: { type: 'defer', by, at: now, deferUntil, remarks } }
}

/** Reject closes the alert; the outcome is recorded as Not actioned with the reason (AC-08). */
export function reject(a: Alert, by: string, now: number, reason: RejectReason | undefined, remarks?: string): Alert {
  assert(a.status === 'Open' || a.status === 'Acknowledged', 'This alert can no longer be rejected.')
  assert(reason, 'A reject reason code is required.')
  assert(reason !== 'Other' || (remarks && remarks.trim()), 'Describe the reason when choosing “Other”.')
  return {
    ...a,
    status: 'Closed',
    decision: { type: 'reject', by, at: now, rejectReason: reason, remarks },
    outcome: { type: 'Not actioned', findings: `Rejected: ${reason}${remarks ? ` — ${remarks}` : ''}`, by, at: now },
  }
}

export function authorize(a: Alert, by: string, now: number, approve: boolean, remarks?: string): Alert {
  assert(a.authorization?.state === 'Pending', 'No authorization is pending on this alert.')
  assert(approve || (remarks && remarks.trim()), 'Remarks are required when returning an alert.')
  return { ...a, authorization: { state: approve ? 'Approved' : 'Returned', by, at: now, remarks } }
}

/** Link the EMMS work order (FR-23). Blocked until BM authorization is approved where required. */
export function linkWorkOrder(a: Alert, woNumber: string): Alert {
  assert(a.status === 'Acknowledged', 'Accept or defer the alert before scheduling work.')
  assert(!a.requiresRemoval || a.authorization?.state === 'Approved', 'Removal from service needs Branch Manager authorization first.')
  assert(/^WO-\d{6,}$/.test(woNumber.trim()), 'Enter the EMMS work order number in the format WO-000000.')
  return { ...a, status: 'Scheduled', woNumber: woNumber.trim() }
}

export function startWork(a: Alert): Alert {
  assert(a.status === 'Scheduled', 'Work can start only on a scheduled alert.')
  return { ...a, status: 'In Progress' }
}

/** An alert cannot be closed without a decision and a recorded outcome (AC-08, FR-24). */
export function recordOutcome(a: Alert, by: string, now: number, type: OutcomeType | undefined, findings: string, failureCode?: string): Alert {
  assert(a.decision, 'Record a decision before closing the alert.')
  assert(a.status === 'In Progress' || a.status === 'Scheduled', 'Outcome is recorded at work-order closure.')
  assert(type, 'Choose the outcome.')
  assert(findings.trim().length >= 5, 'Describe what was found (at least a few words).')
  assert(type !== 'Confirmed fault' || failureCode, 'A failure code is required for a confirmed fault.')
  return { ...a, status: 'Closed', outcome: { type, findings: findings.trim(), failureCode, by, at: now } }
}

export function isOverdue(a: Alert, now: number): boolean {
  return a.status === 'Open' && now > a.dueAt
}

export interface PredictionPerformance {
  closed: number
  confirmed: number
  precisionPct: number | null
  falseAlarmPct: number | null
  avgLeadDays: number | null
  failures: number
  precededFailures: number
  recallPct: number | null
}

/**
 * Alert precision = alerts closed as Confirmed fault ÷ alerts closed.
 * Alert recall = failures preceded by an alert ≥ lead time ÷ total failures (FR-25, Annex C.2).
 */
export function predictionPerformance(alerts: Alert[], failures: number, precededFailures: number): PredictionPerformance {
  const closed = alerts.filter((a) => a.status === 'Closed' && a.outcome)
  const confirmed = closed.filter((a) => a.outcome!.type === 'Confirmed fault')
  const noFault = closed.filter((a) => a.outcome!.type === 'No fault found')
  const leads = confirmed.map((a) => a.leadTimeDays).filter((v): v is number => v !== undefined)
  return {
    closed: closed.length,
    confirmed: confirmed.length,
    precisionPct: closed.length ? (confirmed.length / closed.length) * 100 : null,
    falseAlarmPct: closed.length ? (noFault.length / closed.length) * 100 : null,
    avgLeadDays: leads.length ? leads.reduce((s, v) => s + v, 0) / leads.length : null,
    failures,
    precededFailures,
    recallPct: failures ? (precededFailures / failures) * 100 : null,
  }
}
