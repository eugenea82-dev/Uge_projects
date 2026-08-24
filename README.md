# Audit Statement & Policy Cross-Reference Checker

A web application for auditors to draft, clean up, and cross-reference audit
statements before they go into a final report. It is built for a shipping /
freight-logistics context (modeled on 2GO Freight), and pairs a clarity/grammar
pass with two cross-reference lookups: internal policy clauses and Philippine
government agencies that regulate the shipping industry.

Everything runs client-side in the browser — no backend, no external AI API
calls, and no audit data leaves the device. Policy data and document metadata
are persisted to the browser's `localStorage` only.

## Features

- **Draft → Corrected two-pane editor.** Paste a draft statement on the left;
  the right pane shows an automatically clarity-corrected version, with
  changes highlighted. You can toggle to a plain editable view and hand-edit
  the corrected text at any time.
- **Clarity/grammar engine** (`src/lib/clarityEngine.ts`) — a deterministic,
  rule-based corrector (no external AI call): expands contractions, trims
  wordy/redundant audit-writing phrases, fixes punctuation spacing and
  sentence capitalization, and standardizes common agency acronyms. It also
  flags — but does not silently auto-rewrite — passive voice, run-on
  sentences, vague quantifiers ("some", "several"), hedging language
  ("appears to", "might have"), and informal wording, since fixing those
  can change a finding's meaning or certainty and needs an auditor's call.
- **2GO Freight policy cross-reference.** Matches the draft against a
  keyword-tagged policy clause library and lists which clauses may be
  implicated, with severity and matched terms. **The bundled library is a
  generic starter template representative of common freight/logistics audit
  control areas — it is not verified text from 2GO Freight's actual Policy &
  Procedures Manual.** Replace or extend it with the real manual's clauses
  via the Policy Library screen (manual entry or JSON import) before relying
  on results in a real audit.
- **Philippine shipping-regulatory agency cross-reference.** Matches the
  draft against a dataset of national agencies whose mandates commonly
  intersect with shipping/logistics audit findings — MARINA, PPA, PCG, BOC,
  DOTr, DMW, DENR-EMB, DOLE, DTI, and LTFRB/LTO — each with its mandate and
  legal basis (verified against public legislative sources at time of
  writing; confirm current issuances before citing in a final report).
- **Document metadata always captured.** Document title, control number,
  **effectivity date**, **revision number**, auditor name, audit date, and
  department are required fields on every statement and appear on the
  printed report.
- **Policy Library manager.** Add, edit, delete, import, or export policy
  clauses as JSON, or reset back to the starter template.
- **Print / export report.** A print-optimized layout (browser print-to-PDF)
  includes the metadata block, draft, corrected statement, clarity notes,
  and both cross-reference sections.

## Getting started

```bash
npm install
npm run dev       # start the dev server (http://localhost:5173)
npm run build     # type-check and produce a production build in dist/
npm run preview   # preview the production build locally
npm run lint      # run oxlint
```

## Deployment

The app builds to static files (`dist/`) and has no server-side component,
so it can be deployed to any static host — GitHub Pages, Netlify, Vercel, S3,
an internal web server, etc. No environment variables or API keys are
required.

## Project structure

```
src/
  data/
    types.ts            Shared TypeScript types
    regulations.ts       Philippine shipping-regulatory agency dataset
    policyLibrary.ts      Starter/template 2GO Freight-style policy clauses
  lib/
    clarityEngine.ts       Rule-based grammar/clarity corrector
    crossReference.ts       Keyword cross-reference matching
    diff.ts                  Word-level diff for the draft/corrected view
    storage.ts                localStorage persistence helpers
  components/
    DocumentMetaForm.tsx      Effectivity date, revision number, etc.
    DiffView.tsx                Highlighted draft→corrected diff
    SuggestionsList.tsx          Clarity/style suggestion cards
    CrossReferencePanel.tsx       Policy & agency match cards
    PolicyManager.tsx              Policy Library CRUD + import/export
  App.tsx                Top-level layout, tabs, state wiring
```

## Important disclaimers

- **Policy library accuracy:** The seeded policy clauses are illustrative
  only. Load the actual 2GO Freight Policy & Procedures Manual content
  (with correct clause numbers and revision history) before treating
  cross-reference hits as authoritative.
- **Regulatory accuracy:** Agency mandates and legal citations were checked
  against public sources at time of writing but government issuances,
  circulars, and agency reorganizations change over time — verify against
  the agency's official website before citing in a final audit report.
- **Not a substitute for professional judgment:** Clarity suggestions and
  cross-reference matches are decision support for the auditor, not an
  automated compliance determination.
