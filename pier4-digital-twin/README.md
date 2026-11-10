# Pier 4 Digital Twin

Event-driven simulation of container handling at 2GO Pier 4 for two vessels,
MSK v78 (priority) and MLG v87 (succeeding), built from the master prompt in
`source/TMS_DIGITAL_TWIN_1st_Build.docx` and the time-and-motion workbook
`source/TMS-Vessel_Ops_Activity.xlsx`.

It answers five management questions: where the bottleneck is, why MLG is
delayed, how much extra equipment is needed, how to reduce Backreach (BR)
congestion, and what the improvements are worth in turnaround time.

## Run it

No build step. Serve the folder and open it in a browser:

```bash
cd pier4-digital-twin
python3 -m http.server 8080
```

Then open http://localhost:8080. (Opening `index.html` straight from disk
works too, except for the PNG export, which browsers block on `file://`.)

Headless check of the engine and all preset scenarios:

```bash
node test.js
```

## What is in the application

| Page | Content |
|---|---|
| Simulation | Animated map on the satellite image, play / pause / seek / speed, live dashboard, scenario settings, editable layout |
| Process flow | Discharge, pull-out, loading (Option 1 and 2) and the MLG BR rule, with equipment owner per step |
| Event log | Every activity, wait and idle period; filters; CSV export |
| Activity times | Source cell, n, min, max, average, median, value used, class, limits; user overrides; Excel export |
| Equipment | Productivity and utilisation per unit, time split, reasons for non-working time |
| BR congestion | Occupancy curve, peak, time full, clearance rate, hour-by-hour table |
| Vessels | Model against observed timeline and milestones |
| Scenarios | Baseline and four alternatives, charts and summary table, Excel export |
| Findings | The five management questions answered from the runs; PDF report |
| Data and assumptions | Validation checks, data gaps, parameter classes, data dictionary |

## How it is built

- `data.js` – every duration and fact taken from the workbook, with its
  worksheet and cell reference and a class (observed, calculated, derived,
  assumed), plus the data dictionary and the list of data gaps.
- `engine.js` – the discrete-event engine. One clock, one event queue.
  Each YT, RT and Reach Stacker is its own resource; each container is tracked
  through an enforced state sequence; BR is a capacity-limited store with slot
  reservation. No DOM code. Returns the event log, container histories, BR
  series, KPIs and eleven integrity checks.
- `app.js` – the interface. It replays the engine result, so the animation,
  the dashboard and every table read from the same event log.
- `test.js` – runs all scenarios and fails if any integrity check fails or the
  run is not reproducible.

## Read this before relying on the numbers

The results are model projections. The main limits, all listed in the app:

1. The map image has no labels. Berths, BR, the 2GO area, the NorthPort
   set-down point and the Orange Road are placed by reading the image and the
   stated 1.1 km and 300 m distances. Use **Edit layout** to correct them.
2. Stopwatch cells are stored as h:mm and read as minutes:seconds.
3. Loading was not timed; discharge elements are used as proxies.
4. Three wall-clock records show a 40–45 minute hustle turnaround while both
   vessels worked, against 11–12 minutes by stopwatch during MSK only. The
   baseline uses the stopwatch value. Scenario 5 shows the other case.
5. The workbook mixes TEU, units and boxes; the model treats them as equal.
