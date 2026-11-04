# 2GO CHE Maintenance System — v0.2 (Release 1 pilot prototype)

CHE AI-powered predictive maintenance and monitoring platform for Freight
Land-Based Equipment: about 75 reach stackers, forklifts, empty container handlers
and yard tractors across 12 locations. Built from **BRD v2.0 (23 Oct 2026)**.

This is a **clickable, front-end-only prototype** for requirements validation,
stakeholder demos and UAT scripting. It runs on **simulated data**. The EMMS
client, field mapping and import pipeline are built and tested, but stay in
mock mode until IT confirms the interface (Open item 3); see
[EMMS integration](#emms-integration).

### What changed in v0.2

* Sign-in redesigned to the 2GO sample UI: menu bar, split window with the 2GO Freight brand panel, work-email sign-in, *Forgot password?*, *Keep me signed in*, failed sign-in state. The app accent is now 2GO magenta.
* Renamed **AssetPulse AI → CHE Maintenance System** and **Equipment Specialist → LBE Specialist**.
* Demo users renamed: Ernick Borres and Adrian Booc (LBE Specialists), Mark Anthony Palacay (Asset Maintenance Manager).
* EMMS-ready integration layer: typed API contract, mapper with per-record exception list, idempotent upsert, HTTP client with paging, timeouts and retries, a connection test, and an EMMS export-file import as the interim path.

## What's in v0.2

| Area | What you get | BRD refs |
|---|---|---|
| Splash + sign-in | Boot splash; 2GO-branded sign-in with work email, *Forgot password?*, *Keep me signed in* (the 30-min idle lock still applies), lockout after 5 failed attempts, caps-lock hint, demo-user switcher | FR-31, NFR-S01, NFR-S03 |
| macOS shell | Menu bar (File / View / Go / Help, data-freshness light, notification bell, clock), window chrome with traffic lights, translucent sidebar, dock, light/dark/system appearance | NFR-U03 |
| **LBE Specialist Portal** | Today page, Status Board, Unit Health timeline, Capture Readings (3 screens, tablet-sized), Update Status (8-status model + technical/external cause), Oil & NDT results with CSV bulk upload, Alerts (accept / defer / reject → link EMMS WO → start → record outcome) | FR-01–FR-13, FR-19–FR-24, FR-27, FR-32–FR-36 |
| **Command Center** (Asset Maintenance Manager) | Fleet availability vs. 90% target, A-R-M KPI tiles, weekly availability + 13-week Holt forecast, location roll-up that reconciles to nationwide, units at risk, down-now list, Reliability (MTTR breakdown, downtime Pareto, repeat failures, aging & replacement), Alerts & Approvals (BM authorization), Prediction Performance + model registry, PM Compliance, Thresholds, Data & Sync, Audit Trail | FR-14, FR-17, FR-20, FR-22, FR-25, FR-26, FR-28–FR-30, FR-37–FR-42, FR-44 |

### Demo accounts

| Role | User ID | Password | Scope |
|---|---|---|---|
| LBE Specialist — Ernick Borres | `ernick.borres@2go.com.ph` | `Specialist@2026` | Manila CY1–CY3, Asinan |
| LBE Specialist — Adrian Booc | `adrian.booc@2go.com.ph` | `Specialist@2026` | Cebu, Iloilo, Bacolod |
| Asset Maintenance Manager — Mark Anthony Palacay | `markanthony.palacay@2go.com.ph` | `Manager@2026` | Nationwide (Command Center + Portal) |

Credentials are prefilled on the sign-in screen; use **Switch demo user** to change account. Type the password `wrong` to see the failed sign-in state.

### Suggested demo script (≈ 10 min)

1. Sign in as **Ernick Borres**. On **Today**, open a Medium or High alert, **Accept** it, link `WO-123456`, **Start work**, then **Record outcome**. (Critical alerts first need the manager's authorization.)
2. **Capture Readings › Daily check** → pick a unit → enter an engine oil temperature of `121` °C (Stop is 120) and fill the other required fields → **Save readings**. The result says *STOP — hold the unit*, shows the likely cause from the sheet, and raises an alert unless one is already open for that unit and component. Then try **Oil lab report** → Engine oil → water `0.25` %.
3. **Update Status** → set a unit **Down / Critical** (technical, failure code required), then later **Operational**. The failure event and MTTR update straight away.
4. Open **RS-001** (Manila CY1): it's *Operational* now, but last week's availability is **57.1%**, the BRD's worked example (AC-02).
5. Sign out (red traffic light) → sign in as **Mark Anthony Palacay**. Review the **Command Center**, then approve a Critical removal under **Alerts & Approvals**.
6. **Reliability** → switch the Pareto between failure code, unit, model and location. Every chart has a **Table** toggle.
7. **Data & Sync** → **Test connection**, then **Run nightly batch now**. This pulls from (simulated) EMMS, re-scores the fleet and raises new or stalled-restoration alerts. Download the **Sample export file** and load it with **Import EMMS export** to watch one record merge and one land on the exception list.

## CHE data-entry sheet → Capture Readings

The 38 parameters in `docs/CHE_Data_Entry_source.csv` (the CHE Data Entry sheet, converted to UTF-8) are all entered through **Capture Readings**:

| Sheet location | Entered in | Who | Count |
|---|---|---|---|
| Engine, Transmission, Hydraulic System, Fuel, Electrical & Battery health | Capture Readings › **Daily check** — one card per system; diagnostic-tool readings under *Extra readings* | Mechanic / LBE Specialist | 13 (10 required incl. fuel consumption, 3 optional) |
| Engine, Transmission, Hydraulic, Gear/Differential oil analysis | Capture Readings › **Oil lab report** — one tab per compartment (bulk CSV on *NDT & Bulk Upload*) | Planner / engineer | 25 |

**Every parameter is quantified** in `src/domain/catalog.ts`: each row becomes a rule (absolute limit, % of an OEM target, % or × of the unit's own baseline, ± band around a new-oil value, ISO code steps, or a lab category) with concrete Check and Stop numbers. Where the sheet says *TBA / As per OEM*, gives no warning level, or needs a value we don't have (OEM target, new-oil viscosity, fresh-oil TAN), a number was assumed and flagged — **25 of 38** carry an *Assumed* note on the Thresholds page. The Asset Maintenance Manager can change any number there; changes are audited.

`docs/CHE_Data_Entry_quantified.csv` lists every row with its screen, field, rule, OK / Check / Stop limits per equipment type and the assumption to confirm. Regenerate it after changing the catalog with `npm run export:mapping`. Tests check that every sheet row maps to exactly one field with its wording unchanged (one typo in the sheet, “acid formatio”, is corrected).

**For mechanics:** large fields, the unit and the OK / Check / Stop numbers on every field, a live status as they type, a progress bar for required readings, units still to check listed first, and a plain result — *All good*, *Needs a check*, or *STOP — hold the unit* — with the sheet's “Possible indication” shown as the likely cause. Statistical early warnings (unusual for this unit, worsening trend) go to the engineer as notes and don't change the mechanic's result.

### Oil analysis — wear-source map (Command Center)

The oil-analysis element table (`docs/CHE_Oil_Elements_source.csv`) lists 10 metals — Fe, Cu, Cr, Al, Pb, Sn, Si, Na, Ni, Mo — and the parts each comes from in engine, transmission, hydraulic and gear/differential oil. They are entered in the oil lab report (*Wear & contamination metals*) and drive **Command Center › Oil Analysis**:

* headline tiles (reports, units Critical / Caution, most-flagged metal) and an *Oil condition* tile on the Command Center overview;
* the element table as a **wear-source map** — each cell keeps the table's source text and shows how many units are at Check or Stop in their latest report; select a cell to list them;
* flagged results with the likely worn part, CSV export, and each unit's **report history** graded report by report.

The table gives no numbers, so metals are quantified like the sheet's iron and silicon rules — against each unit's own baseline (fleet default until 3 reports): iron Check > 1.5 × / Stop > 2 ×, other metals ppm above baseline (e.g. Cu +15 / +30, Cr +5 / +10, Na +20 / +40). Molybdenum is trended only (often an additive). All 36 are flagged *Assumed* on the Thresholds page; the 4 metals already in the sheet keep the sheet's rule.

## EMMS integration

The app reads EMMS only through `src/integration/emms/`, so going live is a configuration change.

| File | Role |
|---|---|
| `contract.ts` | **Provisional** EMMS payload (work orders, assets, paging) and the field-mapping table shown on Data & Sync. Replace it when IT publishes the real contract. |
| `mapper.ts` | Validates and maps records. Unknown asset IDs and invalid records go to the **exception list** (FR-03, AC-10); cancelled WOs are skipped; closed corrective WOs need a failure code (BO-06). Upserts by WO number, so imports are idempotent. Tracks an `updated_at` watermark for incremental pulls. |
| `client.ts` | `EmmsClient` interface; `MockEmmsClient` (current); `HttpEmmsClient` with paging, 15 s timeout, retries with backoff on 5xx/429/network errors, and no retry on 401/403. |
| `config.ts` | Picks the client from build-time environment variables. |

**To connect:** copy `.env.example` to `.env.local`, set `VITE_EMMS_MODE=api` and `VITE_EMMS_BASE_URL`, rebuild, then use **Data & Sync → Test connection**. The client expects `GET /health`, `GET /work-orders?updated_since=&page=&page_size=` and `GET /assets` returning `{ items, next_page }`.

**Security:** point `VITE_EMMS_BASE_URL` at a 2GO integration gateway (API/BFF), not at EMMS itself. The gateway holds the dedicated read-only EMMS service account (NFR-S05) and authenticates users by session cookie. `VITE_` values are compiled into the browser bundle, so they must never contain credentials.

**Interim path (R-04):** while the API is pending, an EMMS export (JSON array, or `{ items: [...] }`) can be loaded on Data & Sync through the same mapper.

## How the numbers are built

* **Hour-level status log → failure events.** Every status change is time-stamped. Consecutive technical-unavailable statuses form one failure event, however many statuses or weeks it spans (FR-33).
* **Annex C.2 formulas, computed from additive totals** (hours and counts), so location and nationwide figures always equal the sum of their units (AC-03). For Disposal units are excluded everywhere (AC-04). External downtime is reported as *Operational Constraint Time* and excluded from availability, MTBF and MTTR (AC-05).
* **YardPulse migration is simulated.** History older than 8 weeks is week-granular (a weekly snapshot applied to the whole week) and carries a visible caveat (C-05, NFR-U07).
* **Risk scoring is rule-based (`rules-v0.1`)**, following C-03 and NFR-M03. Points come from limit breaches, sustained trends, recent and repeat failures, oil analysis, NDT, PM overdue and age. Every score lists its contributing factors and a data-sufficiency indicator. Units with fewer than 10 readings in 30 days aren't scored (FR-16).
* **Availability forecast** uses Holt damped-trend smoothing (α 0.3, β 0.1, φ 0.85) as the YardPulse benchmark (FR-42, NFR-M06). The parameters are placeholders until BPA hands over the YardPulse values.

## Run it

```bash
cd che-maintenance-system
npm install
npm run dev        # http://localhost:5173
npm test           # 53 domain, data-entry catalog, acceptance and EMMS tests (Node test runner)
npm run export:mapping  # regenerate docs/CHE_Data_Entry_quantified.csv from the catalog
npm run lint       # oxlint
npm run build      # type-check + static build in dist/ (any static host)
```

State is kept in the browser's `localStorage`. Use **CHE Maintenance System ▸ Reset demo data…** to regenerate the fleet.

## Project structure

```
src/
  domain/            Pure, tested business logic (no React)
    types.ts           Domain model (units, status events, readings, alerts…)
    constants.ts       8-status model, A-R-M mapping, thresholds, SLAs, permissions
    kpi.ts             Availability, failure events, MTBF/MTTR, roll-ups, Pareto, PM compliance
    forecast.ts        Holt damped-trend forecast
    detection.ts       Reading validation, limit/baseline/trend detection
    risk.ts            Rule-based failure-risk scoring with explanations
    alerts.ts          Alert creation + decision workflow state machine
    seed.ts            Deterministic fleet simulator
    catalog.ts         CHE data-entry parameters, quantified rules, OK/Check/Stop limits
    kpi.test.ts        Acceptance tests (AC-02 to AC-06, AC-08, …)
    catalog.test.ts    Sheet coverage and boundary tests
  integration/emms/  EMMS contract, mapper, clients (mock + HTTP), config, tests
  auth/              Demo accounts, splash, sign-in
  shell/             macOS desktop: menu bar, window, sidebar, dock, routing
  portal/            LBE Specialist Portal pages
  command/           Command Center pages
  ui/                Icons, badges, charts, sheets, stat tiles
  store.tsx          App state, derived KPIs, audited actions, persistence
```

## Prototype limits and production gaps

| Prototype (v0.1) | Production (Release 1) needs |
|---|---|
| Simulated fleet and history; EMMS client in mock mode | Confirmed EMMS contract (Open item 3), integration gateway with read-only service account, data-readiness check (D-02) |
| Local demo sign-in, hashes in the bundle | 2GO SSO or server-side auth with MFA for admins (FR-31, NFR-S01) |
| Browser `localStorage` | Server database, backups (RPO 24 h / RTO 8 h), 5-year retention (NFR-D03) |
| Audit trail is append-only in the UI | Tamper-evident server-side audit log |
| In-app toasts and a bell | Email and in-app notifications by role, branch and severity (FR-20) |
| Attachments record file names only | Document store for lab and NDT reports |
| Two personas (Specialist, AM Manager) | Full role matrix (Technician, Planner, Supervisor, BM, BPA, IT Admin; BRD §3.3) |
| Placeholder OEM limits and Holt parameters | OEM manuals per model (A-06), YardPulse parameters (D-06) |

AI output is decision support only. It never replaces physical inspections,
engineering judgment or OEM safety procedures (NFR-R04), and the system never
removes a unit from service on its own (NFR-M01).
