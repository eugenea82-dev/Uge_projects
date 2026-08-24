import type { CrossReferenceHit, PolicyClause, RegulatoryAgency } from '../data/types';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findMatchedKeywords(text: string, keywords: string[]): string[] {
  const lower = text.toLowerCase();
  const matched: string[] = [];
  for (const keyword of keywords) {
    const kw = keyword.toLowerCase();
    const pattern = /^[a-z0-9]+$/.test(kw)
      ? new RegExp(`\\b${escapeRegExp(kw)}\\b`, 'i')
      : new RegExp(escapeRegExp(kw), 'i');
    if (pattern.test(lower)) matched.push(keyword);
  }
  return matched;
}

export function crossReferencePolicies(
  text: string,
  policies: PolicyClause[],
): CrossReferenceHit<PolicyClause>[] {
  if (!text.trim()) return [];
  const hits: CrossReferenceHit<PolicyClause>[] = [];
  for (const policy of policies) {
    const matchedKeywords = findMatchedKeywords(text, policy.keywords);
    if (matchedKeywords.length > 0) {
      hits.push({ item: policy, matchedKeywords, score: matchedKeywords.length });
    }
  }
  return hits.sort((a, b) => b.score - a.score);
}

export function crossReferenceAgencies(
  text: string,
  agencies: RegulatoryAgency[],
): CrossReferenceHit<RegulatoryAgency>[] {
  if (!text.trim()) return [];
  const hits: CrossReferenceHit<RegulatoryAgency>[] = [];
  for (const agency of agencies) {
    const matchedKeywords = findMatchedKeywords(text, agency.keywords);
    if (matchedKeywords.length > 0) {
      hits.push({ item: agency, matchedKeywords, score: matchedKeywords.length });
    }
  }
  return hits.sort((a, b) => b.score - a.score);
}
