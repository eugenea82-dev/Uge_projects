import type { AuditDocumentMeta, PolicyClause } from '../data/types';
import { seedPolicyLibrary } from '../data/policyLibrary';

const POLICY_KEY = 'audit-app.policy-library.v1';
const META_KEY = 'audit-app.document-meta.v1';

export function loadPolicyLibrary(): PolicyClause[] {
  try {
    const raw = localStorage.getItem(POLICY_KEY);
    if (!raw) return seedPolicyLibrary;
    const parsed = JSON.parse(raw) as PolicyClause[];
    if (!Array.isArray(parsed) || parsed.length === 0) return seedPolicyLibrary;
    return parsed;
  } catch {
    return seedPolicyLibrary;
  }
}

export function savePolicyLibrary(policies: PolicyClause[]): void {
  try {
    localStorage.setItem(POLICY_KEY, JSON.stringify(policies));
  } catch {
    // localStorage unavailable (private mode, quota) — silently skip persistence.
  }
}

export function resetPolicyLibrary(): PolicyClause[] {
  savePolicyLibrary(seedPolicyLibrary);
  return seedPolicyLibrary;
}

export const emptyDocumentMeta: AuditDocumentMeta = {
  documentTitle: '',
  documentNumber: '',
  effectivityDate: '',
  revisionNumber: '',
  auditorName: '',
  auditDate: '',
  department: '',
};

export function loadDocumentMeta(): AuditDocumentMeta {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return emptyDocumentMeta;
    return { ...emptyDocumentMeta, ...(JSON.parse(raw) as Partial<AuditDocumentMeta>) };
  } catch {
    return emptyDocumentMeta;
  }
}

export function saveDocumentMeta(meta: AuditDocumentMeta): void {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    // ignore
  }
}
