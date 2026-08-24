import { useEffect, useMemo, useState } from 'react';
import DocumentMetaForm from './components/DocumentMetaForm';
import DiffView from './components/DiffView';
import SuggestionsList from './components/SuggestionsList';
import { PolicyHits, AgencyHits } from './components/CrossReferencePanel';
import PolicyManager from './components/PolicyManager';
import { applyClarityCorrections } from './lib/clarityEngine';
import { crossReferenceAgencies, crossReferencePolicies } from './lib/crossReference';
import { regulatoryAgencies } from './data/regulations';
import type { AuditDocumentMeta, PolicyClause } from './data/types';
import {
  loadDocumentMeta,
  loadPolicyLibrary,
  saveDocumentMeta,
  savePolicyLibrary,
} from './lib/storage';

type Tab = 'checker' | 'policies';

function fmtDate(value: string) {
  if (!value) return '—';
  const d = new Date(value + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function App() {
  const [tab, setTab] = useState<Tab>('checker');
  const [meta, setMeta] = useState<AuditDocumentMeta>(loadDocumentMeta);
  const [policies, setPolicies] = useState<PolicyClause[]>(loadPolicyLibrary);

  const [draftText, setDraftText] = useState('');
  const [correctedText, setCorrectedText] = useState('');
  const [correctedTouched, setCorrectedTouched] = useState(false);
  const [showDiff, setShowDiff] = useState(true);

  useEffect(() => saveDocumentMeta(meta), [meta]);
  useEffect(() => savePolicyLibrary(policies), [policies]);

  const clarity = useMemo(() => applyClarityCorrections(draftText), [draftText]);

  useEffect(() => {
    if (!correctedTouched) setCorrectedText(clarity.correctedText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clarity.correctedText]);

  const policyHits = useMemo(() => crossReferencePolicies(draftText, policies), [draftText, policies]);
  const agencyHits = useMemo(
    () => crossReferenceAgencies(draftText, regulatoryAgencies),
    [draftText],
  );

  const missingRequiredMeta = !meta.effectivityDate || !meta.revisionNumber;

  return (
    <div className="min-h-full bg-slate-50 pb-16 print:bg-white">
      <header className="border-b border-slate-200 bg-white print:hidden">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <h1 className="text-lg font-bold text-slate-900">
              Audit Statement &amp; Policy Cross-Reference Checker
            </h1>
            <p className="text-sm text-slate-500">
              Clarity correction and cross-reference against 2GO Freight audit policy and Philippine
              shipping-regulatory agencies.
            </p>
          </div>
          <nav className="flex gap-2">
            <button
              onClick={() => setTab('checker')}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                tab === 'checker' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Statement Checker
            </button>
            <button
              onClick={() => setTab('policies')}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                tab === 'policies' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Policy Library ({policies.length})
            </button>
            {tab === 'checker' && (
              <button
                onClick={() => window.print()}
                className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900"
              >
                Print / Export Report
              </button>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 print:max-w-full print:px-8">
        {tab === 'policies' ? (
          <PolicyManager policies={policies} onChange={setPolicies} />
        ) : (
          <div className="flex flex-col gap-5">
            <div className="hidden print:block">
              <h1 className="text-xl font-bold">Audit Statement Report</h1>
              <p className="text-sm text-slate-600">
                Generated {new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>

            <DocumentMetaForm meta={meta} onChange={setMeta} />

            {missingRequiredMeta && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 print:hidden">
                Effectivity date and revision number are required fields on the final audit report and
                will show as "—" on the printed report until completed above.
              </div>
            )}

            <div className="hidden grid-cols-2 gap-8 text-sm print:grid">
              <div>
                <span className="font-semibold">Effectivity Date:</span> {fmtDate(meta.effectivityDate)}
              </div>
              <div>
                <span className="font-semibold">Revision Number:</span> {meta.revisionNumber || '—'}
              </div>
              <div>
                <span className="font-semibold">Auditor:</span> {meta.auditorName || '—'}
              </div>
              <div>
                <span className="font-semibold">Audit Date:</span> {fmtDate(meta.auditDate)}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <section className="flex flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm print:border-black print:shadow-none">
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                  Draft Statement
                </h2>
                <textarea
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  placeholder="Paste the auditor's draft statement here…"
                  className="min-h-[280px] flex-1 resize-y rounded-md border border-slate-300 p-3 text-sm leading-relaxed focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 print:hidden"
                />
                <p className="mt-2 hidden whitespace-pre-wrap text-sm leading-relaxed print:block">
                  {draftText}
                </p>
              </section>

              <section className="flex flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm print:border-black print:shadow-none">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                    Corrected Statement
                  </h2>
                  <div className="flex gap-2 print:hidden">
                    <button
                      onClick={() => setShowDiff((v) => !v)}
                      className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      {showDiff ? 'Edit text' : 'Show changes'}
                    </button>
                    <button
                      onClick={() => {
                        setCorrectedText(clarity.correctedText);
                        setCorrectedTouched(false);
                      }}
                      className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Reset to auto-corrected
                    </button>
                  </div>
                </div>
                {showDiff ? (
                  <div className="min-h-[280px] flex-1 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-3 print:border-none print:bg-white print:p-0">
                    <DiffView oldText={draftText} newText={correctedText} />
                  </div>
                ) : (
                  <textarea
                    value={correctedText}
                    onChange={(e) => {
                      setCorrectedText(e.target.value);
                      setCorrectedTouched(true);
                    }}
                    className="min-h-[280px] flex-1 resize-y rounded-md border border-slate-300 p-3 text-sm leading-relaxed focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                )}
              </section>
            </div>

            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm print:border-black print:shadow-none">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Clarity &amp; Style Notes ({clarity.suggestions.length})
              </h2>
              <SuggestionsList suggestions={clarity.suggestions} />
            </section>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm print:border-black print:shadow-none">
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                  2GO Freight Policy Cross-Reference ({policyHits.length})
                </h2>
                <PolicyHits hits={policyHits} />
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm print:border-black print:shadow-none">
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                  Philippine Shipping-Regulatory Agencies ({agencyHits.length})
                </h2>
                <AgencyHits hits={agencyHits} />
              </section>
            </div>

            <footer className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-xs text-slate-500 print:mt-4 print:border-black print:bg-white print:text-black">
              Effectivity Date: {fmtDate(meta.effectivityDate)} · Revision Number:{' '}
              {meta.revisionNumber || '—'}. Automated clarity correction and cross-reference results
              are decision support only and do not replace an auditor's professional judgment or the
              official 2GO Freight Policy &amp; Procedures Manual and current issuances of the cited
              government agencies.
            </footer>
          </div>
        )}
      </main>
    </div>
  );
}
