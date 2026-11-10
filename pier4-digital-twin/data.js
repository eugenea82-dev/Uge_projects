/* Pier 4 Digital Twin — source data extracted from TMS-Vessel_Ops_Activity.xlsx
 * and the master prompt (TMS_DIGITAL_TWIN_1st_Build.docx).
 *
 * Every number here is traceable: `src` names the worksheet and cells.
 * `cls` is one of:
 *   observed   – read directly from the workbook
 *   calculated – statistic computed from observed values
 *   derived    – computed from observed values plus a stated rule
 *   assumed    – no source value; adjustable, needs operational validation
 *
 * Stopwatch note: the Discharging sheet and Hustling Ob 1–4 and 6 are stored
 * in Excel as h:mm but the column headers say "(M:SS)". They are read here as
 * minutes:seconds of a running stopwatch. Hustling Ob 5, 7 and 8 carry cell
 * comments saying they are literal clock times (a.m.), so they are kept apart.
 */
(function (root) {
  'use strict';

  var activities = {
    yt_ascend: {
      name: 'YT ramp ascent (alight to vessel ramp)', eq: 'YT', unit: 's', cls: 'observed',
      src: 'Discharging!B24:AC24 (end − start per observation)',
      obs: [10, 14, 8, 10, 33, 10, 10, 25, 11, 7, 10, 14, 12, 19],
      note: 'Obs 5 (33 s) and Obs 8 (25 s) overlap another YT on the ramp and likely include queueing.'
    },
    yt_take: {
      name: 'YT takes the container on board (discharge)', eq: 'YT', unit: 's', cls: 'observed',
      src: 'Discharging!B25:AC25',
      obs: [143, 114, 45, 180, 40, 31, 72, 50, 111, 103, 112, 80, 44, 185],
      note: 'Wide spread (31–185 s). Trips with two container numbers are not consistently the slow ones.'
    },
    yt_descend: {
      name: 'YT ramp descent (down vessel ramp)', eq: 'YT', unit: 's', cls: 'observed',
      src: 'Discharging!B26:AC26',
      obs: [35, 45, 12, 30, 13, 80, 15, 9, 27, 12, 18, 34, 11, 22],
      note: 'Obs 6 (80 s) is an outlier with no remark in the sheet.'
    },
    yt_travel_rt: {
      name: 'YT travel ramp → BR → back to ramp (round trip incl. drop)', eq: 'YT', unit: 's', cls: 'observed',
      src: 'Discharging!B28:AC28',
      obs: [183, 173, 112, 135, 158, 90, 97, 96, 114, 165, 187, 158, 214],
      excluded: [{ value: 14, why: 'Obs 14 ends 14 s after leaving the ramp; the recording stopped before the trip finished.' }],
      note: 'Recorded as one element. The model splits it 50/50 into ramp→BR and BR→ramp (assumed split).'
    },
    yt_landing_leg: {
      name: 'Adjust landing leg', eq: 'YT', unit: 's', cls: 'observed',
      src: 'Discharging!H27:I27',
      obs: [18],
      note: 'Seen once in 14 trips (Obs 13 notes "did not stop"). Not added to the modelled cycle.',
      inModel: false
    },
    yt_cycle: {
      name: 'YT full discharge cycle (start to next start)', eq: 'YT', unit: 's', cls: 'observed',
      src: 'Discharging!C5:D18',
      obs: [371, 346, 177, 375, 244, 211, 194, 180, 263, 287, 327, 286, 281, 240],
      note: 'Used to validate the simulated cycle, not as a direct input. Workbook average 4:30.',
      inModel: false
    },
    yt_load_ascend_obs: {
      name: 'YT ramp ascent while loading ("Akyat Ramp")', eq: 'YT', unit: 's', cls: 'observed',
      src: 'Loading!B24:C24',
      obs: [29],
      note: 'Only one complete loading observation exists. Too few to use; the discharge ascent is used as proxy.',
      inModel: false
    },
    yt_load_place: {
      name: 'YT places the container on board (loading)', eq: 'YT', unit: 's', cls: 'assumed',
      src: 'No usable record (Loading sheet is blank). Proxy: Discharging!B25:AC25',
      proxyOf: 'yt_take',
      note: 'Assumed equal to the discharge "takes the container" element until loading is timed.'
    },
    yt_load_travel: {
      name: 'YT travel shipside ↔ 2GO assigned area (round trip)', eq: 'YT', unit: 's', cls: 'assumed',
      src: 'No usable record. Proxy: Discharging!B28:AC28',
      proxyOf: 'yt_travel_rt',
      note: 'Assumed equal to the ramp↔BR round trip until the loading haul is timed.'
    },
    rt_pullout: {
      name: 'RT pulls out container in BR (hook-up to stop before PTB)', eq: 'RT', unit: 's', cls: 'observed',
      src: 'Hustling!B5:G6 (row 13)',
      obs: [33, 39, 45, 55, 78],
      excluded: [{ value: '41 (Ob 5)', why: 'Ob 5 is flagged as literal clock time; 2:08→2:49 would be 41 minutes, not seconds.' }],
      note: 'Ob 1–4 and 6, read as stopwatch m:ss.'
    },
    rt_ptb: {
      name: 'RT stop before PTB and chassis inspection (to hustle start)', eq: 'RT', unit: 's', cls: 'observed',
      src: 'Hustling!B6:G8 (row 14)',
      obs: [118, 76, 346, 48, 37],
      note: 'Ob 3 (346 s) is a long inspection hold. Kept, because the sheet keeps it in its own average.'
    },
    rt_tat: {
      name: 'RT hustle turnaround, laden (BR → NorthPort → back), MSK only', eq: 'RT', unit: 's', cls: 'observed',
      src: 'Hustling!B8:E9 (row 15)',
      obs: [671, 716, 700],
      note: 'Ob 1, 2 and 4, read as stopwatch m:ss (11:11, 11:56, 11:40). Covers the 2.2 km round trip and the set-down.'
    },
    rt_tat_congested: {
      name: 'RT hustle turnaround while MSK and MLG both work', eq: 'RT', unit: 's', cls: 'observed',
      src: 'Hustling!F15, H15, I15 (cell comments: literal clock times)',
      obs: [2640, 2400, 2700],
      note: '44, 40 and 45 minutes by wall clock. Elements were not dissected, so waiting is included. Used only in the congested-hustling scenario.'
    },
    rt_tat_empty: {
      name: 'RT hustle turnaround, empty container (BR → empty set-down → back)', eq: 'RT', unit: 's', cls: 'derived',
      src: 'Derived from Hustling row 15 and the route distances in the master prompt (600 m vs 2.2 km)',
      obs: [],
      note: 'Travel share of the laden turnaround scaled by 600/2200; handling share unchanged. No empty trip was timed.'
    },
    rs_mount: {
      name: 'Reach Stacker mounts container on chassis', eq: 'RS', unit: 's', cls: 'assumed',
      src: 'No record in the workbook',
      obs: [], assumed: 180,
      note: 'Placeholder of 3 minutes. Must be timed before Option 2 results are relied on.'
    }
  };

  /* Observed vessel timeline — Sheet1 rows 6–26 (clock times) */
  var actual = {
    simStartClock: 19 * 3600,
    MSK: { ata: '20:18', dStart: '21:46', lStart: '23:00', dEnd: '02:27+1', lEnd: '07:44+1', atd: '08:12+1' },
    MLG: { ata: '01:30+1', dStart: '02:49+1', lStart: '06:27+1', dEnd: '10:35+1', lEnd: '13:35+1', atd: '14:30+1' },
    brFull: '01:35+1',
    notes: {
      mskDStartAlt: 'Sheet1!A64 gives 21:14 for the start of MSK unloading; the timeline row A8 gives 21:46. The timeline is used.',
      mskLStartAlt: 'Sheet1!A65 gives 00:10 for the start of MSK loading; the timeline row A10 gives 23:00. The timeline is used.',
      mlgTimes: 'MLG unloading end (10:35) and loading start (06:27) come from Sheet1!A69:B70; arrival, discharge start, loading end and departure from the timeline rows 12, 14, 25, 26.'
    }
  };

  var facts = [
    { k: 'BR capacity', v: '120 TEU', src: 'Sheet1!C57, C1' },
    { k: 'BR occupancy before MSK arrival', v: '43 units', src: 'Sheet1!B1, H6, A76' },
    { k: 'MSK v78 discharge', v: '160 TEU', src: 'Sheet1!F7, D45' },
    { k: 'MSK v78 loading', v: '178 TEU', src: 'Sheet1!F10, D46' },
    { k: 'MLG v87 discharge', v: '227 TEU + 20×40′ empty on chassis (247 used)', src: 'Sheet1!F14, H16, F15' },
    { k: 'MLG v87 loading', v: '211 TEU', src: 'Sheet1!D49' },
    { k: 'MSK YTs', v: 'YT205, YT208 on board; YT207, YT407 on ground; YT183 down', src: 'Sheet1!C53' },
    { k: 'MLG YTs', v: 'YT408, YT504, YT203', src: 'Sheet1!C54' },
    { k: 'NorthPort RTs', v: '6 for MSK; MLG entry is "x" (not recorded)', src: 'Sheet1!C55:C56' },
    { k: 'NorthPort productivity', v: '30 boxes per hour', src: 'Sheet1!B58, F2' },
    { k: 'MSK discharge rate', v: '32 TEU/h (160 TEU in 5 h)', src: 'Sheet1!F8, J13' },
    { k: 'MSK loading rate', v: '22 TEU/h', src: 'Sheet1!F11' },
    { k: 'Port stay standard', v: '11 h (actual 12 h both vessels)', src: 'Sheet1!C51:D52' },
    { k: 'BR → NorthPort set-down (laden)', v: '1.1 km one way, 2.2 km round trip', src: 'Master prompt §3' },
    { k: 'BR → empty set-down', v: '300 m one way, 600 m round trip', src: 'Master prompt §3' }
  ];

  var dictionary = [
    ['Observation', 'Sequence number of a timed YT trip', 'TMS workbook', 'Discharging!A5:A18', 'Text'],
    ['YT No.', 'Yard tractor observed on that trip', 'TMS workbook', 'Discharging!B5:B18', 'Text'],
    ['Start / End (M:SS)', 'Stopwatch reading at trip start and end', 'TMS workbook', 'Discharging!C5:D18', 'Time stored as h:mm, read as m:ss'],
    ['Cycle Time', 'End − Start of one YT trip', 'TMS workbook', 'Discharging!E5:E18', 'Formula'],
    ['YT alight to Vessel Ramp', 'Start/end of ramp ascent', 'TMS workbook', 'Discharging!B24:AC24', 'Time pair, m:ss'],
    ['YT takes the Container', 'Start/end of hook-up on board', 'TMS workbook', 'Discharging!B25:AC25', 'Time pair, m:ss'],
    ['YT down Vessel Ramp', 'Start/end of ramp descent', 'TMS workbook', 'Discharging!B26:AC26', 'Time pair, m:ss'],
    ['Adjust landing leg', 'Stop to adjust the chassis landing leg', 'TMS workbook', 'Discharging!B27:AC27', 'Time pair, m:ss (1 record)'],
    ['Travel going to BR back to Ramp', 'Start/end of the BR round trip', 'TMS workbook', 'Discharging!B28:AC28', 'Time pair, m:ss'],
    ['Container numbers', 'Container IDs noted per trip', 'TMS workbook', 'Discharging!J21:Y22, B29:AC30', 'Free text'],
    ['Akyat Ramp / Baba ng Ramp', 'Loading ramp ascent / descent', 'TMS workbook', 'Loading!A24:AC28', 'Time pair (1 record only)'],
    ['RT number', 'NorthPort tractor observed', 'TMS workbook', 'Hustling!B3:I3', 'Text'],
    ['Pull out container in BR', 'Stopwatch reading at hook-up in BR', 'TMS workbook', 'Hustling!B5:I5', 'm:ss (Ob 1–4, 6); clock (Ob 5, 7, 8)'],
    ['Stop before PTB', 'Reading at the stop before the passenger terminal', 'TMS workbook', 'Hustling!B6:I6', 'm:ss'],
    ['Checking Chassis/Inspection', 'Reading at chassis inspection', 'TMS workbook', 'Hustling!B7:I7', 'm:ss'],
    ['Hustle Turnaround Time start / End', 'Reading when the hustle trip starts and when the RT is back', 'TMS workbook', 'Hustling!B8:I9', 'm:ss or clock'],
    ['Observation window flag', '"observe during MSK only" vs "MSK & MLG"', 'TMS workbook', 'Hustling!B2:I2', 'Text'],
    ['Time / Situation / Activity', 'Vessel event timeline by clock time', 'TMS workbook', 'Sheet1!A6:D26', 'Clock time + text'],
    ['BR', 'Starting occupancy and capacity', 'TMS workbook', 'Sheet1!B1:C1, C57', 'Number'],
    ['Load Factor', 'Volumes and vessel capacity per voyage', 'TMS workbook', 'Sheet1!B44:F49', 'Text + formula'],
    ['Port Stay', 'Standard vs actual hours in port', 'TMS workbook', 'Sheet1!B51:F52', 'Text'],
    ['Equipment', 'Deployed YTs and RTs per vessel', 'TMS workbook', 'Sheet1!B53:C56', 'Text'],
    ['Simulation table', 'Start/end of each vessel phase', 'TMS workbook', 'Sheet1!A62:D70', 'Datetime'],
    ['Route distances', 'BR to laden and empty set-down points', 'Master prompt', '§3 Route Distances', 'Metres'],
    ['Port layout', 'Satellite image of the pier', 'Master prompt', 'Embedded image "Google Map Reference"', 'PNG 917×448']
  ];

  var gaps = [
    { sev: 'High', item: 'The map carries no labels', detail: 'The embedded Google Map image has no markings for Pier 4.5, Pier 4.2, the Backreach, the 2GO assigned area, the NorthPort set-down point or the Orange Road. Positions in the model are placed by reading the image and by the 1.1 km and 300 m distances. Use "Edit layout" on the Simulation page to drag each point to its true position.', need: 'A marked-up map or a walk-through with operations.' },
    { sev: 'High', item: 'Which berth each vessel uses', detail: 'The model puts MSK at the west face and MLG at the east face of the pier. The workbook does not say which face is Pier 4.5 and which is Pier 4.2.', need: 'Confirm berth sides.' },
    { sev: 'High', item: 'Time format of the stopwatch sheets', detail: 'Discharging and Hustling values are stored as h:mm but headed "(M:SS)". They are read as minutes:seconds. Read as hours:minutes they would give 4-hour YT cycles and 11-hour hustles, which is not credible, and the m:ss reading reproduces the stated 30 boxes per hour for 6 RTs.', need: 'Confirm with the observer.' },
    { sev: 'High', item: 'Hustle turnaround under two-vessel operation', detail: 'Three wall-clock records (40, 44, 45 min) taken while MSK and MLG both worked are 3.5 times the MSK-only stopwatch records (11–12 min). The elements were not dissected, so the cause (queueing, waiting for work, a longer route) is unknown. The baseline uses the stopwatch value; the congested-hustling scenario uses the wall-clock value.', need: 'Re-time RT trips during overlap with elements split out.' },
    { sev: 'High', item: 'Loading was not timed', detail: 'The Loading sheet has one partial record. Loading elements use the discharge elements as proxies.', need: 'Time at least 10 loading trips.' },
    { sev: 'High', item: 'Capacity unit', detail: 'The workbook subtracts 43 "units" from 120 "TEU" and quotes NorthPort in "boxes". The model follows the workbook and treats 1 unit = 1 TEU = 1 box. If many boxes are 40-footers or 10-footers this understates or overstates BR pressure.', need: 'Box size mix per voyage.' },
    { sev: 'Medium', item: 'Units per YT trip', detail: '18 container numbers were written against 14 timed trips (4 trips carried two). The model uses 1.29 units per YT trip. The sample is small.', need: 'Tally from the gate or tally sheet.' },
    { sev: 'Medium', item: 'RTs serving MLG', detail: 'The MLG RT entry is "x". The model keeps the same 6 RTs for both vessels. RT IDs 08, 10, 15 and 16 were seen; the other two are unnamed.', need: 'NorthPort deployment log.' },
    { sev: 'Medium', item: 'MLG berthing and set-up time', detail: 'MLG started discharging 79 minutes after arrival, which mixes set-up with any wait for BR space. The model assumes 56 minutes of set-up (the MSK pre-ops idle in Sheet1!A63:B63) and lets the BR rule decide the rest.', need: 'Time of MLG ramp down / ready to work.' },
    { sev: 'Medium', item: 'BR space MLG needs before it may start', detail: 'No rule is documented. The model requires free BR space for MSK\'s remaining discharge plus 20 units. The 20 is a placeholder.', need: 'The rule operations actually applies.' },
    { sev: 'Medium', item: 'Conflicting start times for MSK', detail: 'Discharge start is 21:46 in the timeline and 21:14 in the simulation table; loading start is 23:00 and 00:10. The timeline values are used.', need: 'Confirm against the vessel log.' },
    { sev: 'Medium', item: 'What the 43 units already in BR are', detail: 'They are treated as laden inbound boxes that NorthPort still has to pull out.', need: 'Confirm status and owner.' },
    { sev: 'Medium', item: 'Share of empties', detail: 'Only MLG\'s 20 empty 40-footers are recorded. MSK empties are set to zero. No empty trip was timed; its duration is scaled from the laden trip by distance.', need: 'Empty/laden split and a timed empty trip.' },
    { sev: 'Low', item: 'Split of combined elements', detail: 'The YT BR round trip is split 50/50. The RT turnaround is split 40% out, 20% set-down, 40% back, with the last tenth of the return leg used to reposition from the 2GO area to BR.', need: 'Element-level timing.' },
    { sev: 'Low', item: 'Reach Stacker mounting time', detail: 'Not recorded. 180 s is a placeholder.', need: 'Time the mounting.' },
    { sev: 'Low', item: 'On-board vs ground YTs', detail: 'The workbook separates YTs on board from YTs on the ground. The model lets every YT run the full ramp-to-BR cycle, as the timed YT205 (on board) and YT207/YT407 (ground) all did.', need: 'Confirm the working pattern.' },
    { sev: 'Low', item: 'Return route', detail: 'The return is assumed to follow the same road and distance as the outbound trip.', need: 'Verify the return route.' }
  ];

  var D = { activities: activities, actual: actual, facts: facts, dictionary: dictionary, gaps: gaps };
  if (typeof module !== 'undefined' && module.exports) module.exports = D;
  root.P4DATA = D;
})(typeof window !== 'undefined' ? window : globalThis);
