import type { CrossReferenceHit, PolicyClause, RegulatoryAgency } from '../data/types';

const severityColor: Record<PolicyClause['severity'], string> = {
  critical: 'bg-rose-100 text-rose-800 border-rose-200',
  major: 'bg-orange-100 text-orange-800 border-orange-200',
  minor: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  informational: 'bg-slate-100 text-slate-700 border-slate-200',
};

export function PolicyHits({ hits }: { hits: CrossReferenceHit<PolicyClause>[] }) {
  if (hits.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No matches against the current policy library. This does not confirm the statement is
        policy-compliant — it means no configured keyword matched.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {hits.map((hit) => (
        <li key={hit.item.id} className={`rounded-md border p-3 ${severityColor[hit.item.severity]}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">
              {hit.item.code} — {hit.item.title}
            </span>
            <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium uppercase tracking-wide">
              {hit.item.severity}
            </span>
          </div>
          <p className="mt-1 text-xs uppercase tracking-wide opacity-70">{hit.item.category}</p>
          <p className="mt-1.5 text-sm">{hit.item.description}</p>
          <p className="mt-1.5 text-xs opacity-80">
            Matched terms: {hit.matchedKeywords.map((k) => `"${k}"`).join(', ')}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function AgencyHits({ hits }: { hits: CrossReferenceHit<RegulatoryAgency>[] }) {
  if (hits.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No Philippine shipping-regulatory agency was flagged based on the current text.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {hits.map((hit) => (
        <li key={hit.item.id} className="rounded-md border border-blue-200 bg-blue-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-blue-900">
              {hit.item.acronym} — {hit.item.name}
            </span>
            {hit.item.parentDepartment && (
              <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-blue-800">
                {hit.item.parentDepartment}
              </span>
            )}
          </div>
          <p className="mt-1.5 text-sm text-blue-950">{hit.item.relevanceToShipping}</p>
          <p className="mt-1.5 text-xs text-blue-800">
            Legal basis: {hit.item.legalBasis.join('; ')}
          </p>
          <p className="mt-1 text-xs text-blue-700">
            Matched terms: {hit.matchedKeywords.map((k) => `"${k}"`).join(', ')}
          </p>
        </li>
      ))}
    </ul>
  );
}
