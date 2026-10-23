# Trucker Visibility Platform — Design (Version 4)

Container pick-up and delivery visibility and compliance platform. It has two
parts: **TAS (Trucker Application System)**, the mobile app that drivers use on their own smartphones to
confirm arrival, and a **web Command Center** for the TMD Team, Sales Support
and System Admin.

An interactive prototype of both parts is in [`prototype.html`](./prototype.html).
It runs on its own in a browser, with simulated data and a demo control panel.

| Version | Change |
|---|---|
| 1 | Trucker arrival app, Command Center, Hit/Miss rules, anti-cheat controls, exceptions, integration |
| 2 | Splash screen and credential sign-in for both apps (section 12) |
| 3 | Live map in the Command Center (section 13). Analytics: global filters, plain-language on-time rates, late reasons spelled out (section 14). "Hit rate (adjusted)" tile removed from the live board. Trucker app named **TAS** |
| 4 | TAS redesigned for drivers: one task per screen, Taglish labels, Filipino instructions and delay reasons. Both apps restyled to iOS (TAS) and macOS (Command Center) (section 15) |

---

## 1. Objective

| | |
|---|---|
| **Business question** | Did the truck arrive at the customer on or before the date and time agreed at booking? |
| **Result per job** | **Hit** if the trusted arrival time is at or before the agreed time (plus grace, default 0 min). **Miss** if it is later, or if the truck has not arrived when the agreed time passes. |
| **Integrity requirement** | The trucker cannot fake the arrival time or location. |
| **Accountability** | When a job is a Miss, the trucker must file an exception (reason and evidence). TMD reviews it. |
| **Primary KPI** | On-time rate (share of deliveries that were a Hit) |

### What "arrival" means (the key design decision)

The arrival time is **the moment the phone first enters the customer's geofence**,
timestamped with **server-trusted time**. It is not the moment the trucker taps
a button.

The tap ("Confirm arrival" with photo and container scan) is the *evidence* that
the right truck and container are at the right site. It does not set the time. This closes the two most
common workarounds:

- **Tapping early** (confirming before arriving) is blocked because the confirm
  button only unlocks inside the geofence.
- **Tapping late on purpose** (or forgetting) does not matter because the time
  was already captured on geofence entry.

---

## 2. Users and responsibilities (aligned to the framework)

| Framework step | Who | What they do in V1 |
|---|---|---|
| **1 Capture** | Trucker | Start trip, arrive, confirm with live photo + container QR scan, GPS and time captured automatically, works offline |
| **2 Arrival confirmation** | System · Branch Ops · Customer | System computes Hit/Miss and notifies stakeholders (TMD, Sales Support, customer by SMS/email) |
| **3 Integrate** | IT | Jobs flow in from TMD-Haulage, and arrival events flow back by API. Nobody re-encodes data. |
| **4 Govern** | BPA · DPO | KPIs, exception review, integrity flags, audit trail, data-privacy controls |

### Command Center roles and permissions

| Capability | TMD Team | Sales Support | System Admin |
|---|:-:|:-:|:-:|
| Live board (all jobs, map of status) | ✔ | ✔ (read-only) | ✔ |
| Job detail, evidence photo, timeline | ✔ | ✔ | ✔ |
| Trucker mobile number | ✔ | — | ✔ |
| Validate / reject exceptions | ✔ | — | — |
| Clear integrity flags | ✔ | — | — |
| Copy customer status update | ✔ | ✔ | — |
| Analytics (OTD, Pareto, per trucker) | ✔ | ✔ (by customer) | ✔ |
| Rules (grace, geofence radius, thresholds) | — | — | ✔ |
| Users, device binding, reset device | — | — | ✔ |
| Customer sites and geofences | view | view | ✔ |
| Exception reason codes | view | view | ✔ |
| Audit trail | view | — | ✔ |

---

## 3. Business rules

| ID | Rule |
|---|---|
| BR-01 | Agreed date/time comes from the booking in TMD-Haulage and cannot be edited in the app. A change requires a re-booking in TMD-Haulage, which is logged. |
| BR-02 | `arrival_time` = first trusted geofence entry for the customer stop. |
| BR-03 | **Hit** if `arrival_time ≤ agreed_time + grace`. Grace defaults to **0 min** and only System Admin can change it, with an audit entry. |
| BR-04 | Early arrival counts as a **Hit**. The board also shows it as "Early" so TMD can watch for customer complaints about early trucks. |
| BR-05 | Not arrived and `now > agreed_time + grace` → **Miss (not arrived)**. When the truck arrives later, the record keeps the Miss and the real arrival time is added. |
| BR-06 | **At risk** = not arrived and the agreed time is within 30 min (configurable). Shown to TMD for proactive action. |
| BR-07 | Every Miss requires an exception from the trucker within 30 min of arrival. The app will not close the job without one. |
| BR-08 | Exceptions **never change the raw Hit/Miss**. TMD classifies a validated exception as *Controllable* or *Uncontrollable*. The analytics figure **"On-time rate, excluding outside delays"** leaves out validated Uncontrollable misses. It is always shown next to the plain on-time rate, never instead of it. |
| BR-09 | Trucker may send a **delay pre-alert** before arrival (same reason codes). It notifies TMD and Sales Support early. It does not excuse the Miss. |
| BR-10 | Pick-up leg (port/depot) is captured the same way for visibility. V1 KPI is measured on the customer stop only. |

### Exception reason codes (starter list, admin-maintained)

| Code | Reason | Default class |
|---|---|---|
| CUS-01 | Customer not ready / asked for later arrival | Uncontrollable |
| CUS-02 | Gate closed / access refused at site | Uncontrollable |
| PRT-01 | Port or depot congestion at pick-up | Uncontrollable |
| PRT-02 | Container on hold / not released at pick-up | Uncontrollable |
| TRF-01 | Road closure, accident or heavy traffic | Uncontrollable |
| TRF-02 | Truck ban window (LGU/MMDA) | Controllable (should be planned) |
| WTH-01 | Weather or flooding | Uncontrollable |
| TRK-01 | Truck breakdown / flat tire | Controllable |
| TRK-02 | Late dispatch / driver late | Controllable |
| DOC-01 | Incomplete documents at pick-up | Controllable |
| OTH-99 | Other (remarks required) | Decided by TMD |

---

## 4. Anti-cheat controls

The trucker owns the phone, so the phone can't be fully trusted. The design
layers several independent checks so that one workaround is not enough. Each
check also raises an **integrity flag** for TMD instead of failing silently.

| How a trucker could cheat | Control in V1 | Flag shown to TMD |
|---|---|---|
| Confirm before reaching the customer | Confirm button unlocks only inside the geofence (default 150 m), with GPS accuracy ≤ 50 m | — (blocked) |
| Fake GPS / mock-location app | Android mock-provider detection + Play Integrity API; confirmation blocked while a mock app is active | `MOCK_LOCATION` |
| Change the phone clock | Server time is authoritative. Offline events use the phone's monotonic clock (time since boot) measured from the last server sync, so changing the wall clock has no effect | `CLOCK_DRIFT` (> 2 min) |
| Upload an old or someone else's photo | Camera-only capture (gallery disabled), photo watermarked with time, GPS and job ID, image hash stored to detect re-use | `PHOTO_REUSED` |
| Scan a QR from a photo sent by another driver | The QR scan must match this job's container number (ISO 6346 check digit validated). It only counts together with the geofence | `CONTAINER_MISMATCH` |
| Type the container number manually | Allowed only as a fallback (damaged label), always flagged | `MANUAL_ENTRY` |
| Go offline to hide the real time | Arrival is still captured offline with monotonic time. Events older than 4 h at sync are flagged | `LATE_SYNC` |
| Give the phone or login to another driver | One active device per trucker (device binding), OTP login, Admin-only device reset | `DEVICE_CHANGE` |
| Rooted or jailbroken phone | Integrity check at login and before each confirmation | `DEVICE_INTEGRITY` |
| Teleporting (impossible travel) | Speed check between GPS breadcrumbs while on trip (> 120 km/h sustained) | `IMPOSSIBLE_SPEED` |

**Optional, for high-risk customers:** customer OTP. On geofence entry the
customer's receiving contact gets a 4-digit code by SMS, and the trucker enters
it. This makes the customer a witness. It is off by default because it adds
friction at the gate.

**Residual risk:** a determined driver with a rooted phone and a spoofing tool
that defeats Play Integrity could still fake location. Mitigation: the
`IMPOSSIBLE_SPEED` and breadcrumb checks, and monthly BPA sampling of flagged
jobs against gate logs or CCTV at key customers.

---

## 5. TAS: Trucker Application System (mobile app)

### Recommendation: native Android first, not a web app

| Option | Mock-location detection | Background geofence | Block gallery | Offline | Verdict |
|---|:-:|:-:|:-:|:-:|---|
| Web app / PWA | ✘ | ✘ | partial | partial | Can't meet the anti-cheat requirement |
| Native Android (Kotlin) or Flutter | ✔ | ✔ | ✔ | ✔ | **Recommended for V1** |
| iOS | limited mock detection | ✔ | ✔ | ✔ | Phase 2, if drivers use iPhones |

Assumption: most contracted truckers use Android phones. Confirm with a quick
driver survey before the build starts.

Minimum device: Android 9+, GPS, rear camera, 2 GB RAM. App size target < 25 MB
(drivers on prepaid data).

### Screens

1. **Login**: mobile number + SMS OTP, first-time consent to location and camera
   use (Data Privacy Act notice), device binding.
2. **Today's jobs**: cards sorted by agreed time, with a countdown and status
   chip (Assigned · En route · Arrived · Closed). Pulled from TMD-Haulage.
3. **Job detail**: customer, site address, gate notes, agreed date and time,
   container number and size, booking reference. **Start trip** turns on
   location tracking for this job only.
4. **En route**: distance to site, ETA, **Report delay** (pre-alert). The app
   records geofence entry automatically.
5. **Arrival check**: four checks shown as a checklist (inside geofence, GPS
   accuracy, no fake GPS, trusted time). **Confirm arrival** unlocks only when
   all pass.
6. **Capture**: live photo of the container at the gate, then QR/container scan.
   Large buttons for one-handed use and gloves.
7. **Result**: Hit or Miss with the variance in minutes. A Miss opens the
   mandatory exception form (reason code, remarks, optional photo).
8. **Offline banner**: shows queued events and syncs automatically when the
   signal returns.

### Design principles for drivers

- Large touch targets (min 48 px), high contrast, readable in sunlight.
- Filipino and English labels (V1 in English with Tagalog helper text on key
  buttons).
- No typing in the happy path: scan, photo and tap only.
- Location tracking runs **only between Start trip and job close**. It does not
  run outside active jobs.

---

## 6. Web Command Center

| View | Purpose | Main elements |
|---|---|---|
| **Live board** | What is happening now | KPI strip (Due today, On-time rate, Miss, At risk, Exceptions to review, Flags), job table with status chips, filters (At risk, Miss, Flags, Customer), job detail panel |
| **Job detail** | Proof for one job | Timeline (assigned → trip start → geofence entry → confirmation → sync), evidence photo, GPS and accuracy, integrity checks, exception and review actions |
| **Exceptions** | TMD review queue | Pending exceptions oldest first, validate as Controllable/Uncontrollable or reject with comment |
| **Live map** | Where every truck is now | Map of trucks, customer sites and ports, status colours, route still to drive, truck list grouped by urgency (section 13) |
| **Analytics** | Performance | Global filters, on-time rate by day, why trucks were late, trucker and customer scorecards (section 14) |
| **Admin: Rules** | Settings | Grace min, geofence radius, GPS accuracy limit, clock-drift tolerance, at-risk window, late-sync limit, customer OTP toggle |
| **Admin: Users and devices** | Access control | Trucker list, bound device, app version, integrity status, reset device |
| **Admin: Sites** | Geofences | Customer site, coordinates, radius |
| **Audit trail** | Governance | Every rule change, review decision, device reset and flag clearance, with user and time. Records can't be edited. |

Notifications (V1): in-app alert on the board, plus email/SMS to Sales Support
and the customer contact on arrival confirmed and on Miss.

---

## 7. Integration (no re-encoding)

```
TMD-Haulage ──(job.assigned)──▶ Platform API ──▶ TAS
TAS ──(events, offline queue)──▶ Platform API
Platform API ──(webhook: arrival.confirmed / job.missed / exception.*)──▶ TMD-Haulage, customer systems
```

Events: `job.assigned`, `trip.started`, `geofence.entered`, `arrival.confirmed`,
`job.missed`, `delay.prealert`, `exception.filed`, `exception.reviewed`,
`integrity.flagged`.

Sample `arrival.confirmed` payload:

```json
{
  "event": "arrival.confirmed",
  "event_id": "evt_01JB7Q8K2Z",
  "job_id": "HJ-2610-0418",
  "booking_ref": "BKG-551820",
  "container_no": "TMDU2026451",
  "stop": "customer",
  "agreed_time": "2026-10-21T10:30:00+08:00",
  "arrival_time": "2026-10-21T10:21:40+08:00",
  "arrival_time_source": "server_trusted_geofence_entry",
  "result": "HIT",
  "variance_min": -8,
  "location": { "lat": 14.2117, "lng": 121.1653, "accuracy_m": 12 },
  "evidence": { "photo_id": "ph_9f2c", "photo_sha256": "…", "container_scan": "QR" },
  "integrity_flags": [],
  "captured_offline": false
}
```

Delivery: HTTPS webhook with HMAC signature, retries with backoff for 24 h,
`event_id` as idempotency key so receivers never double-count.

---

## 8. Core data model

| Entity | Key fields |
|---|---|
| Job | job_id, booking_ref, customer_id, site_id, container_no, size_type, move_type, agreed_time, trucker_id, plate_no, status, result, arrival_time |
| Stop | job_id, type (pick-up / customer), site_id, geofence_entry_time, confirmed_time |
| Event | event_id, job_id, type, trusted_time, device_time, monotonic_ms, lat, lng, accuracy_m, offline, payload |
| Evidence | photo_id, job_id, sha256, watermark, scan_value, scan_method |
| Exception | exc_id, job_id, code, remarks, filed_time, status (Pending/Validated/Rejected), class (Controllable/Uncontrollable), reviewer, review_time |
| Flag | flag_id, job_id, type, detail, status (Open/Cleared), cleared_by |
| Trucker / Device | trucker_id, name, mobile, haulier, device_id, bound_at, app_version, integrity_status |
| Site | site_id, customer_id, lat, lng, radius_m, gate_notes |
| AuditLog | who, role, action, before, after, time |

---

## 9. Governance and data privacy

- **KPIs**: on-time rate, on-time rate excluding outside delays, Miss count by reason, exception filing
  compliance (% of Misses with an exception within 30 min), TMD review time,
  integrity flags per 100 jobs.
- **Data Privacy Act of 2012 (RA 10173)**: the app runs on personal phones, so the
  DPO should approve a Privacy Impact Assessment before go-live. Controls:
  consent at first login, tracking only during active jobs, purpose limited to
  delivery compliance, role-based access (Sales Support doesn't see driver
  mobile numbers).
- **Retention (proposed, DPO to confirm)**: arrival events and results 5 years
  (audit), photos 1 year, location breadcrumbs 90 days.

---

## 10. V1 scope

**In V1:** Android app, customer-stop Hit/Miss, pick-up capture, geofence +
photo + container scan, offline mode, exceptions and review, live board,
analytics, admin rules, audit trail, webhook to TMD-Haulage.

**Later:** iOS app, customer OTP for all customers, proof of delivery and
e-signature, live map with traffic ETA, driver scorecard incentives, customer
self-service portal.

### Rollout

1. Pilot one branch with 15–20 truckers and 3–5 customers for 4 weeks, running
   alongside the current process.
2. Calibrate the geofence radius per site (large warehouses may need 250–300 m).
3. Compare platform Hit/Miss with the current manual report. Investigate
   differences above 5%.
4. Roll out by branch.

## 11. Assumptions and open questions

| # | Item | Type |
|---|---|---|
| 1 | Jobs with agreed date/time already exist in TMD-Haulage and can be exposed by API | Assumption, confirm with IT |
| 2 | Most truckers use Android phones | Assumption, confirm by survey |
| 3 | Agreed time is a single point, not a window. If customers book windows, use the window end for Hit/Miss | Open question |
| 4 | Who pays for truckers' mobile data (estimated < 50 MB/month per driver) | Open question |
| 5 | Whether a Miss affects trucker or haulier payment. This changes how strict exception review needs to be | Open question |
| 6 | Customer site coordinates are not yet captured. They need a one-time site survey or a first-visit capture approved by TMD | Dependency |

---

## 12. Version 2: splash screen and sign-in

Both apps open on a branded splash screen, then ask for credentials. Sign-in
is part of the anti-cheat design. It stops a trucker from confirming
arrivals on someone else's account or phone, and every access is traceable.

| | TAS | Command Center |
|---|---|---|
| **Splash** | Brand screen (about 1.5 s) while the app checks phone security: rooted phone, fake-GPS apps, app version | Brand screen while the session loads |
| **Credentials** | Mobile number + 6-digit PIN (numeric keypad, works with gloves) | Work email + password |
| **Second check** | The phone must be the driver's registered phone (device binding). A correct PIN on another driver's phone is **blocked**, logged and shown in the TMD feed | System Admin also enters a 6-digit authenticator code, because admins can change rules, geofences and devices |
| **Wrong tries** | 5 wrong PINs lock sign-in for 15 min | 5 wrong passwords lock the account for 15 min |
| **First sign-in** | One-time privacy consent: location only during active jobs, camera, data use (RA 10173). Acceptance is logged | Password set by a reset link from System Admin |
| **Role** | Trucker sees only own jobs | Role comes from the account (TMD Team, Sales Support or System Admin). Users can't pick a role at sign-in |
| **Sign out** | Sign out button on Today's jobs | Sign out in the side panel |
| **Forgot credentials** | TMD dispatcher resets the PIN | System Admin sends a password reset link |
| **Audit trail** | Signed in, signed out, blocked sign-in, sign-in locked, privacy consent | Signed in (with or without 2-step code), failed sign-in, failed 2-step code, locked, signed out |

### Build notes

- Store PINs and passwords as salted hashes (Argon2 or bcrypt). The
  prototype keeps demo credentials in the page only so the demo can run.
- Trucker sessions stay signed in for the shift (proposed 12 h) so drivers
  don't re-enter the PIN at every gate. Offline unlock checks the PIN against
  a hash cached on the phone.
- Command Center sessions sign out after 30 min of no activity (proposed).
- For production, connect the Command Center to the company's single sign-on
  if one exists (for example Microsoft Entra ID). Then password policy and
  2-step verification come from IT, not from this platform.

### Demo credentials (prototype only)

| App | Account | Credentials |
|---|---|---|
| TAS | Ramon Dela Cruz (owns the demo phone) | 0917 555 0142 · PIN 482100 |
| TAS | Mark Villanueva (blocked on Ramon's phone) | 0927 555 0218 · PIN 104512 |
| Command Center | TMD Team | l.ramos@tmd.example · Tmd@2026 |
| Command Center | Sales Support | a.torres@tmd.example · Sales@2026 |
| Command Center | System Admin | k.uy@tmd.example · Admin@2026 · code 246810 |

---

## 13. Version 3: live map (Command Center)

A new **Live map** page, next to the Live board, for TMD Team, Sales Support
and System Admin.

| Element | What it shows |
|---|---|
| Truck dot | One per truck. Position comes from TAS while a trip is active. Colour: violet on schedule, amber at risk, red late, green arrived on time, grey waiting to start |
| Dashed line | The part of the route the truck still has to drive |
| Rings | Dashed grey = no signal (shows last known position and time). Red = fake-GPS flag open |
| Customer site | Square with its geofence ring |
| Port / yard | Diamond (MICT, North Harbor, Valenzuela empty yard, Batangas Container Terminal) |
| Count tiles | Trucks today, on the road, late or at risk, at customer site. Each tile filters the map |
| Truck list | Grouped as Late or at risk, On the road, At customer site, Waiting to start, with km to go and ETA. Click opens the job panel |
| Views | Whole area, Metro Manila, Cavite · Laguna · Batangas |

Build notes:

- TAS sends a position every 30 s during an active trip only, which
  matches the privacy rule in section 9.
- The prototype draws a simplified map from real coordinates, because the
  prototype page can't load outside map images. Production should use a map
  service (Google Maps Platform or Mapbox) for streets, live traffic and
  better ETAs.
- One dot per truck: the truck's current job (en route), or its last
  delivery for 45 min after arrival, otherwise its next job.

## 14. Version 3: analytics changes

**Global filters.** One filter bar at the top applies to every number, chart
and table on the page: Period (Today, Last 7 days, Last 14 days, Month to
date), Customer, Haulier, Trucker, Move type. Clicking a row in a scorecard
filters the page to that trucker or customer.

**Plain names for the two rates.**

| Old name | New name | Meaning |
|---|---|---|
| Hit rate (raw) | **On-time rate** | Deliveries that arrived on or before the agreed time, out of all deliveries |
| Hit rate (adjusted) | **On-time rate, excluding outside delays** | The same, but late trips that TMD confirmed were caused by the customer, port, weather or road closures are not counted |

The live board shows only **On-time rate**. The "Hit rate (adjusted)" tile was
removed. The second rate appears only in Analytics, next to the first.

**Why trucks were late.** Each reason is written out in full, as the trucker
chose it in the exception, for example "Road closure, accident or heavy
traffic" and not only "TRF-01". Each row shows the count, its share of late
deliveries, whether it is within or outside our control, and an example
remark. Late deliveries with no exception yet are shown as their own row, so
they can't hide.

**Trend.** The day-by-day chart covers finished days only. Today's figure is
shown below the chart, because a half-finished day is misleading.

Prototype note: 1–20 October is generated sample history so the filters have
data to work on. Today comes from the live demo.

---

## 15. Version 4: TAS made simple, Apple look

**Goal:** a driver who has never been trained, or a 10-year-old, can finish a
delivery in TAS without help.

### Design rules

| Rule | How TAS follows it |
|---|---|
| One task per screen | Home shows only the next delivery and one button. Every screen has a single main action at the bottom, in thumb reach |
| Pictures before words | Delay reasons are big tiles with an icon. The result is a full green (on time) or red (late) screen |
| The driver's own language | Buttons and labels in Taglish, instructions in Filipino, 12-hour time (10:30 AM) |
| Nothing the driver doesn't need | Removed from the driver's view: booking ref, reason codes, GPS accuracy, the 4-point check list, phone-clock warnings, ISO and geofence wording. Container number and size fold under "Detalye ng job" |
| No typing in the normal flow | The arrival time records itself. Photo, then QR scan, which sends the arrival on its own. Typing is needed only for a damaged QR or "Iba pa" |

All integrity checks (fake GPS, phone clock, typed container number, offline
time) still run and still reach TMD. Only the driver's screen is simpler. The
one exception is fake GPS: the driver sees a red card telling them to turn it
off, because it blocks confirmation.

### Driver flow

| Screen | What the driver sees | Main button |
|---|---|---|
| Home | "Magandang umaga, Ramon!", next delivery: customer, "Dapat dumating 10:30 AM", time left | **Simulan ang Biyahe** |
| On the road | Truck moving to the customer, km left, "Darating mga 10:17 AM", on time / baka ma-late | **May Delay? I-report** |
| At the site | Big check, "Nandito ka na!", recorded arrival time | **Kumpirmahin ang Pagdating** |
| Photo (1 of 2) | "Kunan ng litrato ang container" | Shutter |
| Scan (2 of 2) | "I-scan ang QR code sa container" | **I-scan** (sends automatically) |
| Result | Full green "On Time!" or red "Late ng 11 min" | **Tapos Na** or **Piliin ang Dahilan** |
| Reason | "Bakit ka na-late?" / "Bakit ka male-late?", 11 picture tiles | **I-send** |

### Delay and late reasons in Filipino

| Code (TMD only) | TAS tile (driver) | Command Center (English) |
|---|---|---|
| TRF-01 | Traffic o aksidente | Road closure, accident or heavy traffic |
| PRT-01 | Mahabang pila sa port | Port or depot congestion at pick-up |
| CUS-01 | Hindi pa handa ang customer | Customer not ready / asked for later arrival |
| WTH-01 | Ulan o baha | Weather or flooding |
| TRK-01 | Nasira ang truck | Truck breakdown / flat tire |
| TRK-02 | Late akong nakaalis | Late dispatch / driver late |
| CUS-02 | Sarado ang gate | Gate closed / access refused at site |
| PRT-02 | Naka-hold ang container | Container on hold / not released |
| TRF-02 | Truck ban | Truck ban window (LGU / MMDA) |
| DOC-01 | Kulang ang papeles | Incomplete documents at pick-up |
| OTH-99 | Iba pa (note required) | Other |

The Command Center stays in English for TMD staff. It also shows the
driver's own choice, for example *Driver chose in TAS: "Traffic o aksidente"*,
so nothing is lost in translation.

**Recommendation:** have 3–5 drivers and a TMD supervisor review the Filipino
wording before the pilot. Terms differ by region, and drivers' own words work
best.

### Apple look

- **TAS (iOS):** iPhone frame, large titles, grouped lists, full-width
  rounded buttons, iOS system colours, notification banners, light and dark
  mode.
- **Command Center (macOS):** app window with traffic-light controls,
  translucent sidebar with icons, macOS tables, buttons and segmented controls,
  light and dark mode.
- **Fonts:** the system font (SF Pro) on Apple devices, Inter on others.
