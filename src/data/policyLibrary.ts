import type { PolicyClause } from './types';

/**
 * STARTER / TEMPLATE POLICY LIBRARY
 * ----------------------------------
 * These clauses are generic, representative examples of the kind of
 * control areas found in a freight & logistics company's internal audit
 * manual (cargo handling, dangerous goods, fleet safety, customs
 * compliance, etc.). They are NOT verified excerpts of 2GO Freight's
 * actual policy manual — this application does not have access to that
 * proprietary document.
 *
 * Before relying on cross-reference results in a real audit, replace or
 * supplement these entries with the actual clause text, numbering, and
 * revision data from the current 2GO Freight Policy & Procedures Manual
 * via the Policy Manager screen (Import JSON or manual entry).
 */
export const seedPolicyLibrary: PolicyClause[] = [
  {
    id: 'cgo-01',
    code: 'CGO-01',
    title: 'Cargo Acceptance and Inspection',
    category: 'Cargo Handling & Loss Prevention',
    severity: 'major',
    description:
      'All inbound cargo must be visually inspected and weighed at acceptance, with discrepancies against the waybill/manifest logged before the shipment is admitted into the warehouse or vessel.',
    keywords: ['cargo acceptance', 'unverified', 'no inspection', 'discrepancy', 'weight mismatch', 'without inspection'],
  },
  {
    id: 'cgo-02',
    code: 'CGO-02',
    title: 'Shortage, Damage, and Loss Reporting',
    category: 'Cargo Handling & Loss Prevention',
    severity: 'critical',
    description:
      'Any cargo shortage, damage, or loss must be reported through the incident reporting system within 24 hours and escalated to the branch manager for claims processing.',
    keywords: ['shortage', 'pilferage', 'cargo loss', 'damaged cargo', 'not reported', 'unreported loss', 'missing cargo'],
  },
  {
    id: 'dg-01',
    code: 'DG-01',
    title: 'Dangerous Goods Declaration and Segregation',
    category: 'Dangerous Goods / Hazardous Cargo',
    severity: 'critical',
    description:
      'Shipments containing dangerous or hazardous goods must carry a signed shipper declaration and be segregated and labeled in accordance with applicable IMDG/PCG carriage rules before loading.',
    keywords: ['dangerous goods', 'hazardous cargo', 'flammable', 'undeclared', 'no declaration', 'mislabeled', 'chemical shipment'],
  },
  {
    id: 'dg-02',
    code: 'DG-02',
    title: 'Dangerous Goods Personnel Training',
    category: 'Dangerous Goods / Hazardous Cargo',
    severity: 'major',
    description:
      'Personnel handling or accepting dangerous goods shipments must hold a current dangerous goods handling certification, renewed per the training calendar.',
    keywords: ['untrained personnel', 'expired certification', 'no training record', 'dangerous goods handler'],
  },
  {
    id: 'wh-01',
    code: 'WH-01',
    title: 'Warehouse Access Control',
    category: 'Warehouse & Inventory Control',
    severity: 'major',
    description:
      'Access to bonded and high-value storage areas is restricted to authorized personnel with logged entry/exit using ID badges or biometric verification.',
    keywords: ['unrestricted access', 'no access log', 'shared keys', 'unauthorized entry', 'no badge'],
  },
  {
    id: 'wh-02',
    code: 'WH-02',
    title: 'Periodic Inventory Reconciliation',
    category: 'Warehouse & Inventory Control',
    severity: 'major',
    description:
      'Warehouse inventory must be reconciled against the WMS/system-of-record on a monthly basis, with variances beyond threshold escalated to Finance and Internal Audit.',
    keywords: ['inventory variance', 'no reconciliation', 'unreconciled', 'stock discrepancy', 'physical count mismatch'],
  },
  {
    id: 'flt-01',
    code: 'FLT-01',
    title: 'Vehicle Roadworthiness and Preventive Maintenance',
    category: 'Fleet Safety & Driver Conduct',
    severity: 'major',
    description:
      'Company and contracted delivery vehicles must pass a documented preventive maintenance inspection on the schedule defined in the fleet maintenance program before dispatch.',
    keywords: ['unroadworthy', 'no maintenance record', 'overdue pms', 'defective vehicle', 'not inspected'],
  },
  {
    id: 'flt-02',
    code: 'FLT-02',
    title: 'Driver Qualification and Conduct',
    category: 'Fleet Safety & Driver Conduct',
    severity: 'major',
    description:
      'Drivers must hold a valid professional driver\'s license appropriate to the vehicle class and complete defensive driving training prior to route assignment.',
    keywords: ['unlicensed driver', 'expired license', 'no driving record', 'reckless driving', 'overloading'],
  },
  {
    id: 'cus-01',
    code: 'CUS-01',
    title: 'Customs Documentation Accuracy',
    category: 'Customs & Trade Compliance',
    severity: 'critical',
    description:
      'Import/export declarations and cargo manifests must match the actual shipment description, quantity, and value before submission to the Bureau of Customs.',
    keywords: ['manifest discrepancy', 'misdeclaration', 'under-declared', 'incorrect classification', 'customs violation'],
  },
  {
    id: 'abc-01',
    code: 'ABC-01',
    title: 'Anti-Bribery and Facilitation Payments',
    category: 'Anti-Bribery & Corruption',
    severity: 'critical',
    description:
      'Employees are prohibited from offering, giving, or accepting facilitation payments to expedite cargo clearance, port entry, or regulatory inspection.',
    keywords: ['facilitation payment', 'bribe', 'grease money', 'expedite fee', 'under the table', 'kickback'],
  },
  {
    id: 'dp-01',
    code: 'DP-01',
    title: 'Customer and Shipment Data Privacy',
    category: 'Data Privacy & Confidentiality',
    severity: 'major',
    description:
      'Customer, consignee, and shipment data must be handled per the Data Privacy Act, with access limited to personnel with a legitimate business need.',
    keywords: ['data breach', 'unauthorized disclosure', 'shared customer data', 'no consent', 'personal data'],
  },
  {
    id: 'osh-01',
    code: 'OSH-01',
    title: 'Workplace Safety at Terminals and Warehouses',
    category: 'Occupational Health & Safety',
    severity: 'major',
    description:
      'Personal protective equipment (PPE) is mandatory in loading/unloading zones, and near-miss or accident incidents must be logged in the OSH register.',
    keywords: ['no ppe', 'unsafe condition', 'near miss', 'workplace accident', 'not wearing ppe'],
  },
  {
    id: 'fin-01',
    code: 'FIN-01',
    title: 'Expense Reporting and Approval Authority',
    category: 'Financial Controls & Expense Reporting',
    severity: 'major',
    description:
      'Operational expenses (fuel, tolls, incidental cargo charges) must be supported by official receipts and approved within the delegated authority matrix.',
    keywords: ['no receipt', 'unapproved expense', 'exceeds authority', 'unsupported disbursement'],
  },
  {
    id: 'cs-01',
    code: 'CS-01',
    title: 'Customer Claims Turnaround',
    category: 'Customer Service & Claims Handling',
    severity: 'minor',
    description:
      'Cargo claims must be acknowledged within 48 hours and resolved or escalated within the service level defined in the customer claims procedure.',
    keywords: ['delayed claim', 'no acknowledgment', 'unresolved complaint', 'missed sla'],
  },
  {
    id: 'env-01',
    code: 'ENV-01',
    title: 'Hazardous Waste and Used Oil Disposal',
    category: 'Environmental Compliance',
    severity: 'major',
    description:
      'Used oil, batteries, and other hazardous waste from fleet maintenance must be disposed of only through a DENR-accredited transporter/treater.',
    keywords: ['improper disposal', 'unaccredited hauler', 'dumped', 'no manifest for waste', 'used oil disposal'],
  },
];
