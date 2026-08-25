import { useRef, useState } from 'react';
import type { PolicyClause, PolicySeverity } from '../data/types';
import { resetPolicyLibrary } from '../lib/storage';

interface Props {
  policies: PolicyClause[];
  onChange: (policies: PolicyClause[]) => void;
}

const emptyDraft: Omit<PolicyClause, 'id'> = {
  code: '',
  title: '',
  category: '',
  severity: 'major',
  description: '',
  keywords: [],
  isCustom: true,
};

const severityOptions: PolicySeverity[] = ['critical', 'major', 'minor', 'informational'];

function isPolicySeverity(value: unknown): value is PolicySeverity {
  return typeof value === 'string' && (severityOptions as string[]).includes(value);
}

export default function PolicyManager({ policies, onChange }: Props) {
  const [draft, setDraft] = useState<Omit<PolicyClause, 'id'>>(emptyDraft);
  const [keywordsInput, setKeywordsInput] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const startEdit = (policy: PolicyClause) => {
    setEditingId(policy.id);
    setDraft(policy);
    setKeywordsInput(policy.keywords.join(', '));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(emptyDraft);
    setKeywordsInput('');
  };

  const submit = () => {
    if (!draft.code.trim() || !draft.title.trim()) return;
    const keywords = keywordsInput
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);

    if (editingId) {
      onChange(policies.map((p) => (p.id === editingId ? { ...draft, keywords, id: editingId } : p)));
    } else {
      const id = `custom-${draft.code.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`;
      onChange([...policies, { ...draft, keywords, id, isCustom: true }]);
    }
    cancelEdit();
  };

  const remove = (id: string) => {
    onChange(policies.filter((p) => p.id !== id));
    if (editingId === id) cancelEdit();
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(policies, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `policy-library-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as unknown;
        if (!Array.isArray(parsed)) {
          throw new Error('The file must contain a JSON array of policy clauses (e.g. [{ "code": "...", "title": "...", ... }]).');
        }
        if (parsed.length === 0) {
          throw new Error('The file contains an empty array — nothing to import.');
        }

        const usedIds = new Set<string>();
        let skipped = 0;
        const normalized: PolicyClause[] = [];

        for (const raw of parsed as Record<string, unknown>[]) {
          const code = typeof raw.code === 'string' ? raw.code.trim() : '';
          const title = typeof raw.title === 'string' ? raw.title.trim() : '';
          if (!code || !title) {
            skipped++;
            continue;
          }
          let id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `imported-${code.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${normalized.length}`;
          while (usedIds.has(id)) id = `${id}-${Math.random().toString(36).slice(2, 6)}`;
          usedIds.add(id);

          normalized.push({
            id,
            code,
            title,
            category: typeof raw.category === 'string' ? raw.category : '',
            severity: isPolicySeverity(raw.severity) ? raw.severity : 'major',
            description: typeof raw.description === 'string' ? raw.description : '',
            keywords: Array.isArray(raw.keywords) ? raw.keywords.filter((k): k is string => typeof k === 'string') : [],
            isCustom: true,
          });
        }

        if (normalized.length === 0) {
          throw new Error('No valid entries found — each clause needs at least a "code" and a "title".');
        }

        onChange(normalized);
        setStatus({
          kind: 'success',
          message: `Imported ${normalized.length} clause${normalized.length === 1 ? '' : 's'}, replacing the current library.${skipped ? ` Skipped ${skipped} entr${skipped === 1 ? 'y' : 'ies'} missing "code" or "title".` : ''}`,
        });
      } catch (err) {
        setStatus({ kind: 'error', message: `Could not import "${file.name}": ${(err as Error).message}` });
      }
    };
    reader.onerror = () => setStatus({ kind: 'error', message: `Could not read "${file.name}".` });
    reader.readAsText(file);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
        This library ships with generic, representative audit-policy clauses for a freight &amp;
        logistics operation. It is a <strong>starter template</strong>, not verified text from the
        actual 2GO Freight Policy &amp; Procedures Manual. Replace or extend it below — via manual
        entry or JSON import — with the current, official clause text, numbering, and revision data
        before relying on cross-reference results in a real audit.
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {editingId ? 'Edit Policy Clause' : 'Add Policy Clause'}
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Code</span>
            <input
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              placeholder="e.g., CGO-03"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Title</span>
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="e.g., Cold-Chain Cargo Handling"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Category</span>
            <input
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              placeholder="e.g., Cargo Handling & Loss Prevention"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Severity</span>
            <select
              value={draft.severity}
              onChange={(e) => setDraft({ ...draft, severity: e.target.value as PolicySeverity })}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {severityOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-slate-700">Description / Clause Text</span>
            <textarea
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              className="min-h-20 rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-slate-700">Keywords (comma-separated)</span>
            <input
              value={keywordsInput}
              onChange={(e) => setKeywordsInput(e.target.value)}
              placeholder="e.g., undeclared, hazardous cargo, mislabeled"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <span className="text-xs text-slate-400">
              A draft statement is flagged against this clause when it contains any of these words or
              phrases.
            </span>
          </label>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            onClick={submit}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            {editingId ? 'Save Changes' : 'Add Clause'}
          </button>
          {editingId && (
            <button
              onClick={cancelEdit}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Policy Clauses ({policies.length})
          </h2>
          <div className="flex gap-2">
            <button
              onClick={exportJson}
              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Export JSON
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Import JSON
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) importJson(file);
                e.target.value = '';
              }}
            />
            {confirmingReset ? (
              <span className="flex items-center gap-1.5 rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-xs">
                <span className="text-rose-700">Replace current library with the template?</span>
                <button
                  onClick={() => {
                    onChange(resetPolicyLibrary());
                    cancelEdit();
                    setConfirmingReset(false);
                    setStatus({ kind: 'success', message: 'Policy library reset to the built-in starter template.' });
                  }}
                  className="rounded bg-rose-600 px-2 py-0.5 font-medium text-white hover:bg-rose-700"
                >
                  Yes, reset
                </button>
                <button
                  onClick={() => setConfirmingReset(false)}
                  className="rounded border border-slate-300 px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmingReset(true)}
                className="rounded-md border border-rose-300 px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50"
              >
                Reset to Template
              </button>
            )}
          </div>
        </div>
        {status && (
          <div
            role="status"
            className={`mb-3 flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm ${
              status.kind === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-rose-200 bg-rose-50 text-rose-800'
            }`}
          >
            <span>{status.message}</span>
            <button
              onClick={() => setStatus(null)}
              aria-label="Dismiss"
              className="shrink-0 text-xs font-medium underline opacity-70 hover:opacity-100"
            >
              Dismiss
            </button>
          </div>
        )}
        <ul className="flex flex-col gap-2">
          {policies.map((p) => (
            <li key={p.id} className="flex items-start justify-between gap-3 rounded-md border border-slate-200 p-3 text-sm">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">
                    {p.code} — {p.title}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs uppercase tracking-wide text-slate-600">
                    {p.severity}
                  </span>
                  {p.isCustom && (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                      custom
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs uppercase tracking-wide text-slate-400">{p.category}</p>
                <p className="mt-1 text-slate-600">{p.description}</p>
                <p className="mt-1 text-xs text-slate-400">Keywords: {p.keywords.join(', ')}</p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <button
                  onClick={() => startEdit(p)}
                  className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Edit
                </button>
                <button
                  onClick={() => remove(p.id)}
                  className="rounded border border-rose-300 px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
