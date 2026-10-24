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
2. **Capture Readings** → pick a unit → enter an engine temperature of `108` °C → **Save**. The reading is flagged against the critical limit and an alert is raised immediately, unless one is already open for that unit and component.
3. **Update Status** → set a unit **Down / Critical** (technical, failure code required), then later **Operational**. The failure event and MTTR update straight away.
4. Open **RS-001** (Manila CY1): it's *Operational* now, but last week's availability is **57.1%**, the BRD's worked example (AC-02).
5. Sign out (red traffic light) → sign in as **Mark Anthony Palacay**. Review the **Command Center**, then approve a Critical removal under **Alerts & Approvals**.
6. **Reliability** → switch the Pareto between failure code, unit, model and location. Every chart has a **Table** toggle.
7. **Data & Sync** → **Test connection**, then **Run nightly batch now**. This pulls from (simulated) EMMS, re-scores the fleet and raises new or stalled-restoration alerts. Download the **Sample export file** and load it with **Import EMMS export** to watch one record merge and one land on the exception list.

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
npm test           # 37 domain, acceptance and EMMS integration tests (Node test runner)
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
    kpi.test.ts        Acceptance tests (AC-02 to AC-06, AC-08, …)
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
