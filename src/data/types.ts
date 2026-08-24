export interface RegulatoryAgency {
  id: string;
  acronym: string;
  name: string;
  parentDepartment?: string;
  mandate: string;
  legalBasis: string[];
  relevanceToShipping: string;
  keywords: string[];
  website?: string;
}

export type PolicySeverity = 'critical' | 'major' | 'minor' | 'informational';

export interface PolicyClause {
  id: string;
  code: string;
  title: string;
  category: string;
  severity: PolicySeverity;
  description: string;
  keywords: string[];
  isCustom?: boolean;
}

export interface CrossReferenceHit<T> {
  item: T;
  matchedKeywords: string[];
  score: number;
}

export interface AuditDocumentMeta {
  documentTitle: string;
  documentNumber: string;
  effectivityDate: string;
  revisionNumber: string;
  auditorName: string;
  auditDate: string;
  department: string;
}
