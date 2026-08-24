import type { ClaritySuggestion } from '../lib/clarityEngine';

const typeLabels: Record<ClaritySuggestion['type'], { label: string; color: string }> = {
  'passive-voice': { label: 'Passive voice', color: 'bg-sky-100 text-sky-800' },
  'run-on-sentence': { label: 'Long sentence', color: 'bg-orange-100 text-orange-800' },
  'vague-quantifier': { label: 'Vague quantifier', color: 'bg-purple-100 text-purple-800' },
  'hedging-language': { label: 'Hedging language', color: 'bg-rose-100 text-rose-800' },
  'informal-tone': { label: 'Informal tone', color: 'bg-slate-200 text-slate-800' },
};

export default function SuggestionsList({ suggestions }: { suggestions: ClaritySuggestion[] }) {
  if (suggestions.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No style issues detected by the automated checks. Review the corrected text manually before
        finalizing.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {suggestions.map((s, i) => {
        const meta = typeLabels[s.type];
        return (
          <li key={i} className="rounded-md border border-slate-200 p-2.5 text-sm">
            <span className={`mr-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${meta.color}`}>
              {meta.label}
            </span>
            <span className="text-slate-700">{s.message}</span>
            <p className="mt-1 rounded bg-slate-50 px-2 py-1 text-xs italic text-slate-500">
              &ldquo;{s.excerpt}&rdquo;
            </p>
          </li>
        );
      })}
    </ul>
  );
}
