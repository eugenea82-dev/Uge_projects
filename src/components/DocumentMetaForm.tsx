import type { AuditDocumentMeta } from '../data/types';

interface Props {
  meta: AuditDocumentMeta;
  onChange: (meta: AuditDocumentMeta) => void;
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-slate-700">
        {label}
        {required && <span className="text-rose-600"> *</span>}
      </span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
    </label>
  );
}

export default function DocumentMetaForm({ meta, onChange }: Props) {
  const set = <K extends keyof AuditDocumentMeta>(key: K, value: AuditDocumentMeta[K]) =>
    onChange({ ...meta, [key]: value });

  const missingRequired = !meta.effectivityDate || !meta.revisionNumber;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm print:border-black print:shadow-none">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Document Information
        </h2>
        {missingRequired && (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 print:hidden">
            Effectivity date &amp; revision number required for the report
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          label="Document Title"
          value={meta.documentTitle}
          onChange={(v) => set('documentTitle', v)}
          placeholder="e.g., Cargo Handling Audit Statement"
        />
        <Field
          label="Document / Control Number"
          value={meta.documentNumber}
          onChange={(v) => set('documentNumber', v)}
          placeholder="e.g., AUD-2026-014"
        />
        <Field
          label="Effectivity Date"
          value={meta.effectivityDate}
          onChange={(v) => set('effectivityDate', v)}
          type="date"
          required
        />
        <Field
          label="Revision Number"
          value={meta.revisionNumber}
          onChange={(v) => set('revisionNumber', v)}
          placeholder="e.g., Rev. 03"
          required
        />
        <Field
          label="Auditor Name"
          value={meta.auditorName}
          onChange={(v) => set('auditorName', v)}
          placeholder="e.g., Juan D. Cruz"
        />
        <Field
          label="Audit Date"
          value={meta.auditDate}
          onChange={(v) => set('auditDate', v)}
          type="date"
        />
        <Field
          label="Department / Branch"
          value={meta.department}
          onChange={(v) => set('department', v)}
          placeholder="e.g., Cebu Hub Operations"
        />
      </div>
    </section>
  );
}
