import type { ReactNode } from 'react'
import { AuditPage } from '../command/AuditPage.tsx'
import { CommandOverview } from '../command/CommandOverview.tsx'
import { DataSyncPage } from '../command/DataSyncPage.tsx'
import { PerformancePage } from '../command/PerformancePage.tsx'
import { PmPage } from '../command/PmPage.tsx'
import { ReliabilityPage } from '../command/ReliabilityPage.tsx'
import { ThresholdsPage } from '../command/ThresholdsPage.tsx'
import { AlertsPage } from '../portal/AlertsPage.tsx'
import { CaptureReadings } from '../portal/CaptureReadings.tsx'
import { FleetBoard } from '../portal/FleetBoard.tsx'
import { LabNdtPage } from '../portal/LabNdtPage.tsx'
import { SpecialistHome } from '../portal/SpecialistHome.tsx'
import { StatusUpdate } from '../portal/StatusUpdate.tsx'
import { UnitDetail } from '../portal/UnitDetail.tsx'
import type { AppId, Route } from './nav.tsx'

export interface PageDef {
  id: string
  title: string
  subtitle: string
  icon: string
  hidden?: boolean
  render: (r: Route) => ReactNode
}

const unitPage: PageDef = { id: 'unit', title: 'Unit Health', subtitle: 'Single timeline of status, readings, alerts and work orders (FR-27)', icon: 'truck', hidden: true, render: (r) => <UnitDetail assetId={r.assetId} /> }

export const PAGES: Record<AppId, PageDef[]> = {
  portal: [
    { id: 'home', title: 'Today', subtitle: 'Your branches at a glance', icon: 'home', render: () => <SpecialistHome /> },
    { id: 'board', title: 'Status Board', subtitle: 'Current status beside rolling 13-week availability (FR-32, FR-36)', icon: 'grid', render: (r) => <FleetBoard filter={r.filter} /> },
    { id: 'capture', title: 'Capture Readings', subtitle: 'Daily pre-operational inspection — hour meter, temperatures, pressures (FR-04–FR-06)', icon: 'pencil', render: (r) => <CaptureReadings assetId={r.assetId} /> },
    { id: 'status', title: 'Update Status', subtitle: '8-status model with technical vs. external cause (FR-33, FR-35)', icon: 'pulse', render: (r) => <StatusUpdate assetId={r.assetId} /> },
    { id: 'lab', title: 'Oil & NDT Results', subtitle: 'Laboratory oil analysis and NDT findings (FR-07, FR-08)', icon: 'flask', render: (r) => <LabNdtPage assetId={r.assetId} /> },
    { id: 'alerts', title: 'Alerts', subtitle: 'Review, decide, schedule and close out (FR-19–FR-24)', icon: 'bell', render: (r) => <AlertsPage alertId={r.alertId} /> },
    unitPage,
  ],
  command: [
    { id: 'overview', title: 'Command Center', subtitle: 'Nationwide fleet health, A-R-M KPIs and forecast (FR-26)', icon: 'target', render: () => <CommandOverview /> },
    { id: 'board', title: 'Fleet Status Board', subtitle: 'All 12 locations · current status beside rolling 13-week availability', icon: 'grid', render: (r) => <FleetBoard filter={r.filter} /> },
    { id: 'reliability', title: 'Reliability (A-R-M)', subtitle: 'Roll-ups, MTTR breakdown, downtime Pareto, aging & replacement (FR-37–FR-41)', icon: 'chart', render: () => <ReliabilityPage /> },
    { id: 'alerts', title: 'Alerts & Approvals', subtitle: 'Authorize High/Critical actions; monitor SLA and escalations (FR-20, FR-22)', icon: 'bell', render: (r) => <AlertsPage alertId={r.alertId} /> },
    { id: 'performance', title: 'Prediction Performance', subtitle: 'Alert precision, recall and lead time; model governance (FR-25, NFR-M04/M05)', icon: 'pulse', render: () => <PerformancePage /> },
    { id: 'pm', title: 'PM Compliance', subtitle: 'Scheduled vs. on-time PM work orders from EMMS (FR-44)', icon: 'calendar', render: () => <PmPage /> },
    { id: 'thresholds', title: 'Thresholds', subtitle: 'Warning and critical limits per model and parameter (FR-11)', icon: 'sliders', render: () => <ThresholdsPage /> },
    { id: 'data', title: 'Data & Sync', subtitle: 'EMMS import, exception list and data quality (FR-03, NFR-D02)', icon: 'sync', render: () => <DataSyncPage /> },
    { id: 'audit', title: 'Audit Trail', subtitle: 'Every create, edit, decision and approval (FR-30)', icon: 'list', render: () => <AuditPage /> },
    unitPage,
  ],
}
