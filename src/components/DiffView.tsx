import { diffWords } from '../lib/diff';

interface Props {
  oldText: string;
  newText: string;
}

export default function DiffView({ oldText, newText }: Props) {
  const tokens = diffWords(oldText, newText);

  if (!newText.trim()) {
    return <p className="text-sm italic text-slate-400">Corrected statement will appear here.</p>;
  }

  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
      {tokens.map((token, i) => {
        if (token.type === 'removed') return null;
        if (token.type === 'added') {
          return (
            <span key={i} className="rounded bg-emerald-100 px-0.5 text-emerald-900">
              {token.value}
            </span>
          );
        }
        return <span key={i}>{token.value}</span>;
      })}
    </p>
  );
}
