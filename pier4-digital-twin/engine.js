/* Pier 4 Digital Twin — discrete-event simulation engine.
 * Pure logic: no DOM. One call to simulate(params) runs the whole operation
 * on a central clock and event queue and returns the event log, container
 * histories, BR occupancy series and KPIs. The UI only replays this result.
 */
(function (root) {
  'use strict';
  var D = root.P4DATA || (typeof require !== 'undefined' ? require('./data.js') : null);

  var H = 3600;
  var DEFAULTS = {
    name: 'Baseline',
    startClock: 19 * H,               // 19:00, start of the observation window
    brCapacity: 120, brInitial: 43, mlgGate: 20,
    rtCount: 6, rsCount: 1,
    unitsPerYtTrip: 1.29,
    sourcing: 'hustle',               // 'hustle' (Option 1) | 'rs' (Option 2)
    durMode: 'mean',                  // 'mean' | 'median' | 'empirical'
    seed: 4,
    overrides: {},                    // activity key -> seconds (user-defined)
    rtDeploy: 'discharge',            // 'discharge' = at first discharge start | 'arrival' = at first vessel arrival
    rtStagger: true,                  // RTs enter service evenly spaced over one cycle instead of as a convoy (assumed)
    rtCongested: false,               // use the 40–45 min wall-clock turnaround while both vessels work
    ytPriority: 'discharge',          // 'discharge' | 'loading' | 'balanced'
    stagingCap: 0,                    // 0 = no limit on containers staged at the 2GO area
    npHandlingShare: 0.2,             // share of RT turnaround spent at the set-down point (assumed)
    distLaden: 1100, distEmpty: 300,  // metres one way (master prompt)
    vessels: {
      MSK: { arrivalMin: 78, setupMin: 88, discharge: 160, empties: 0, load: 178, loadOffsetMin: 74, departMin: 28, ytCount: 4 },
      MLG: { arrivalMin: 390, setupMin: 56, discharge: 247, empties: 20, load: 211, loadOffsetMin: 218, departMin: 55, ytCount: 3 }
    }
  };
  var YT_IDS = { MSK: ['YT205', 'YT208', 'YT207', 'YT407'], MLG: ['YT408', 'YT504', 'YT203'] };
  var RT_IDS = ['RT08', 'RT10', 'RT15', 'RT16'];
  var ORDER = ['MSK', 'MLG'];         // MSK has priority

  var TRANSITIONS = {
    'Awaiting Discharge': ['Discharging'],
    'Discharging': ['In Transit to BR'],
    'In Transit to BR': ['In BR'],
    'In BR': ['Being Pulled Out'],
    'Being Pulled Out': ['At NorthPort', 'At Empty Set-down'],
    'At NorthPort (outbound)': ['Returning Laden'],
    'Returning Laden': ['At 2GO Assigned Area'],
    'At 2GO Stack': ['Under Reach Stacker Mounting'],
    'Under Reach Stacker Mounting': ['At 2GO Assigned Area'],
    'At 2GO Assigned Area': ['At Shipside'],
    'At Shipside': ['Being Loaded'],
    'Being Loaded': ['Loaded on Vessel']
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function merge(a, b) {
    var o = clone(a); if (!b) return o;
    Object.keys(b).forEach(function (k) {
      if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && o[k] && typeof o[k] === 'object') o[k] = merge(o[k], b[k]);
      else o[k] = b[k];
    });
    return o;
  }
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function mean(a) { return a.reduce(function (s, x) { return s + x; }, 0) / a.length; }
  function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }); var m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  function stats(a) { return a.length ? { n: a.length, min: Math.min.apply(null, a), max: Math.max.apply(null, a), mean: mean(a), median: median(a) } : { n: 0 }; }

  function obsFor(key) { var a = D.activities[key]; if (a.proxyOf) return D.activities[a.proxyOf].obs; return a.obs; }

  function simulate(params) {
    var P = merge(DEFAULTS, params);
    var rand = mulberry32(P.seed);
    var now = 0, seq = 0, evId = 0;
    var queue = [];
    var events = [], brSeries = [], violations = [];
    var containers = [], cById = {};

    function at(t, fn) { queue.push({ t: t, s: seq++, fn: fn }); }
    function popNext() {
      var bi = 0;
      for (var i = 1; i < queue.length; i++) { var q = queue[i], b = queue[bi]; if (q.t < b.t || (q.t === b.t && q.s < b.s)) bi = i; }
      return queue.splice(bi, 1)[0];
    }

    /* ---------- durations ---------- */
    function tatSplit(tat, empty) {
      var h = P.npHandlingShare, travel = tat * (1 - h), handle = tat * h;
      if (empty) travel = travel * (P.distEmpty / P.distLaden);
      return { out: travel / 2, handle: handle, back: travel / 2 };
    }
    function dur(key) {
      if (P.overrides[key] != null && P.overrides[key] !== '') return +P.overrides[key];
      if (key === 'rt_tat_empty') { var s = tatSplit(dur('rt_tat'), true); return s.out + s.handle + s.back; }
      var a = D.activities[key], o = obsFor(key);
      if (!o.length) return a.assumed;
      if (P.durMode === 'median') return median(o);
      if (P.durMode === 'empirical') return o[Math.floor(rand() * o.length)];
      return mean(o);
    }

    /* ---------- containers ---------- */
    function mkC(id, vessel, dir, status, state) {
      var c = { id: id, vessel: vessel, dir: dir, status: status, state: state, hist: [[0, state]] };
      containers.push(c); cById[id] = c; return c;
    }
    function setState(c, s) {
      var ok = TRANSITIONS[c.state] || [];
      if (ok.indexOf(s) < 0) violations.push('t=' + now + ' ' + c.id + ': ' + c.state + ' → ' + s);
      c.state = s; c.hist.push([now, s]);
    }

    /* ---------- state ---------- */
    var br = { cap: P.brCapacity, occ: 0, reserved: 0, q: [] };
    function brFree() { return br.cap - br.occ - br.reserved; }
    function brMark() { brSeries.push([now, br.occ, br.reserved]); }

    var V = {}, eqs = [], yts = [], rts = [], rss = [];
    var staging = { MSK: [], MLG: [] }, npOut = { MSK: [], MLG: [] }, stack = { MSK: [], MLG: [] };
    var chassisPool = 0, stagingWaiters = [];
    var pulledOut = 0;

    function mkEq(id, type, owner, vessel, home) {
      var e = { id: id, type: type, owner: owner, vessel: vessel, status: 'Available', loc: home, home: home, busy: false, wait: null, trips: 0, units: 0 };
      eqs.push(e); return e;
    }

    ORDER.forEach(function (vid) {
      var c = P.vessels[vid];
      var v = V[vid] = {
        id: vid, cfg: c, arrival: c.arrivalMin * 60, readyAt: (c.arrivalMin + c.setupMin) * 60,
        discharge: c.discharge, toDischarge: c.discharge, discharged: 0, inbound: [],
        load: c.load, loadAssigned: 0, loaded: 0,
        ready: false, dischargeOpen: false, loadOpen: false, departed: false, departing: false,
        tDStart: null, tDEnd: null, tLStart: null, tLEnd: null, tDepart: null, tGateOpen: null,
        rampBusy: false, rampQ: [], acc: { d: 0, l: 0 }, flip: 0, yts: []
      };
      var nE = Math.min(c.empties || 0, c.discharge), i;
      for (i = 0; i < c.discharge; i++) {
        // spread empties evenly through the discharge sequence
        var isE = nE > 0 && Math.floor((i + 1) * nE / c.discharge) > Math.floor(i * nE / c.discharge);
        v.inbound.push(mkC(vid + '-D' + String(i + 1).padStart(3, '0'), vid, 'in', isE ? 'Empty' : 'Laden', 'Awaiting Discharge'));
      }
      for (i = 0; i < c.load; i++) {
        var oc = mkC(vid + '-L' + String(i + 1).padStart(3, '0'), vid, 'out', 'Laden', P.sourcing === 'rs' ? 'At 2GO Stack' : 'At NorthPort (outbound)');
        (P.sourcing === 'rs' ? stack : npOut)[vid].push(oc);
      }
      for (i = 0; i < c.ytCount; i++) {
        var y = mkEq(YT_IDS[vid][i] || ('YT-' + vid + '-' + (i + 1)), 'YT', '2GO', vid, vid + '_SHIP');
        v.yts.push(y); yts.push(y);
      }
    });
    for (var i0 = 0; i0 < P.brInitial; i0++) {
      var pc = mkC('PRE-' + String(i0 + 1).padStart(3, '0'), 'PRE', 'in', 'Laden', 'In BR');
      br.q.push(pc); br.occ++;
    }
    for (var r0 = 0; r0 < P.rtCount; r0++) rts.push(mkEq(RT_IDS[r0] || ('RT-U' + (r0 - RT_IDS.length + 1)), 'RT', 'NorthPort', null, 'BR'));
    for (var s0 = 0; s0 < P.rsCount; s0++) rss.push(mkEq('RS' + String(s0 + 1).padStart(2, '0'), 'RS', '2GO', null, 'AREA'));
    brMark();

    var rtDeployAt = P.rtDeploy === 'arrival' ? Math.min(V.MSK.arrival, V.MLG.arrival) : Math.min(V.MSK.readyAt, V.MLG.readyAt);

    /* ---------- event log ---------- */
    function log(eq, o) {
      var e = {
        id: ++evId, t0: now, t1: now + (o.d || 0), vessel: o.vessel || eq.vessel || '', eq: eq.id, eqType: eq.type, owner: eq.owner,
        activity: o.a, from: o.from || eq.loc, to: o.to || o.from || eq.loc, cid: (o.c || []).map(function (c) { return c.id; }).join('+'),
        cstatus: o.c && o.c.length ? o.c[0].status : (o.carry || ''), dur: o.d || 0,
        before: eq.status, after: o.st, brDelta: o.br || 0, brOcc: null, result: o.res || 'completed', note: o.note || '',
        work: o.work !== false
      };
      eq.status = o.st; eq.loc = e.to;
      events.push(e); return e;
    }
    /* waiting / idle bookkeeping: one open record per unoccupied unit */
    function setWait(eq, kind, reason, vessel) {
      var w = eq.wait;
      if (w && w.kind === kind && w.reason === reason) return;
      closeWait(eq);
      eq.wait = { t0: now, kind: kind, reason: reason, vessel: vessel, before: eq.status };
      eq.status = kind === 'idle' ? 'Available' : (kind === 'queue' ? 'Queued' : 'Waiting');
    }
    function closeWait(eq) {
      var w = eq.wait; if (!w) return; eq.wait = null;
      if (now - w.t0 <= 0) return;
      events.push({
        id: ++evId, t0: w.t0, t1: now, vessel: w.vessel || eq.vessel || '', eq: eq.id, eqType: eq.type, owner: eq.owner,
        activity: w.kind === 'idle' ? 'Idle' : (w.kind === 'queue' ? 'Queued' : 'Waiting'), from: eq.loc, to: eq.loc, cid: '', cstatus: '',
        dur: now - w.t0, before: w.before, after: w.kind === 'idle' ? 'Available' : (w.kind === 'queue' ? 'Queued' : 'Waiting'),
        brDelta: 0, brOcc: null, result: w.kind === 'idle' ? 'completed' : (w.kind === 'blocked' ? 'blocked' : 'waiting'), note: w.reason, work: false, kind: w.kind
      });
    }

    /* ---------- ramp (one YT on a ramp at a time) ---------- */
    function reqRamp(v, yt, fn) {
      if (!v.rampBusy) { v.rampBusy = true; fn(); }
      else { setWait(yt, 'queue', 'Ramp occupied', v.id); v.rampQ.push(function () { closeWait(yt); fn(); }); }
    }
    function relRamp(v) { if (v.rampQ.length) v.rampQ.shift()(); else v.rampBusy = false; }

    /* ---------- vessel milestones ---------- */
    function checkVessel(v) {
      if (v.departing || !v.ready) return;
      if (v.discharged >= v.discharge && v.tDEnd == null) v.tDEnd = v.discharge ? now : v.readyAt;
      if (v.loaded >= v.load && v.tLEnd == null) v.tLEnd = v.load ? now : v.readyAt;
      if (v.tDEnd != null && v.tLEnd != null) {
        v.departing = true;
        at(now + v.cfg.departMin * 60, function () { v.departed = true; v.tDepart = now; dispatch(); });
      }
    }
    function openLoad(v) { v.loadOpen = true; dispatch(); }

    /* ---------- YT cycles ---------- */
    function tripUnits(v, dir, limit) {
      var want = Math.max(1, Math.floor(v.acc[dir] + P.unitsPerYtTrip));
      var n = Math.min(want, limit);
      v.acc[dir] = Math.min(1.999, v.acc[dir] + P.unitsPerYtTrip - n);
      return n;
    }
    function startDischarge(yt, v, n) {
      closeWait(yt); yt.busy = true; yt.trips++; yt.units += n;
      var cs = v.inbound.slice(v.discharge - v.toDischarge, v.discharge - v.toDischarge + n);
      v.toDischarge -= n; br.reserved += n; brMark();
      reqRamp(v, yt, function () {
        var d = dur('yt_ascend');
        log(yt, { a: 'Ramp ascent', from: v.id + '_SHIP', to: v.id + '_DECK', d: d, st: 'Moving', vessel: v.id });
        at(now + d, function () {
          relRamp(v);
          var d2 = dur('yt_take');
          if (v.tDStart == null) v.tDStart = now;
          cs.forEach(function (c) { setState(c, 'Discharging'); });
          log(yt, { a: 'Take container (discharge)', from: v.id + '_DECK', d: d2, st: 'Discharging', c: cs, vessel: v.id });
          at(now + d2, function () {
            reqRamp(v, yt, function () {
              var d3 = dur('yt_descend');
              log(yt, { a: 'Ramp descent', from: v.id + '_DECK', to: v.id + '_SHIP', d: d3, st: 'Moving', c: cs, vessel: v.id });
              at(now + d3, function () {
                relRamp(v);
                v.discharged += n; checkVessel(v);
                cs.forEach(function (c) { setState(c, 'In Transit to BR'); });
                var tr = dur('yt_travel_rt');
                var e = log(yt, { a: 'Travel ramp → BR', from: v.id + '_SHIP', to: 'BR', d: tr / 2, st: 'Moving', c: cs, br: n, vessel: v.id });
                at(now + tr / 2, function () {
                  br.reserved -= n; br.occ += n; e.brOcc = br.occ; brMark();
                  cs.forEach(function (c) { setState(c, 'In BR'); br.q.push(c); });
                  log(yt, { a: 'Return BR → shipside', from: 'BR', to: v.id + '_SHIP', d: tr / 2, st: 'Returning', vessel: v.id, carry: 'Empty chassis' });
                  dispatch();
                  at(now + tr / 2, function () { yt.busy = false; dispatch(); });
                });
                dispatch();
              });
            });
          });
        });
      });
    }
    function startLoad(yt, v, n) {
      closeWait(yt); yt.busy = true; yt.trips++; yt.units += n;
      var cs = staging[v.id].splice(0, n); v.loadAssigned += n;
      var tr = dur('yt_load_travel');
      log(yt, { a: 'Travel shipside → 2GO area', from: v.id + '_SHIP', to: 'AREA', d: tr / 2, st: 'Moving', vessel: v.id, carry: 'Empty chassis' });
      at(now + tr / 2, function () {
        log(yt, { a: 'Haul 2GO area → shipside', from: 'AREA', to: v.id + '_SHIP', d: tr / 2, st: 'Moving', c: cs, vessel: v.id });
        releaseStagingWaiters();
        at(now + tr / 2, function () {
          cs.forEach(function (c) { setState(c, 'At Shipside'); });
          reqRamp(v, yt, function () {
            var d = dur('yt_ascend');
            if (v.tLStart == null) v.tLStart = now;
            cs.forEach(function (c) { setState(c, 'Being Loaded'); });
            log(yt, { a: 'Ramp alignment and ascent', from: v.id + '_SHIP', to: v.id + '_DECK', d: d, st: 'Positioning', c: cs, vessel: v.id });
            at(now + d, function () {
              relRamp(v);
              var d2 = dur('yt_load_place');
              log(yt, { a: 'Place container (load)', from: v.id + '_DECK', d: d2, st: 'Loading', c: cs, vessel: v.id });
              at(now + d2, function () {
                cs.forEach(function (c) { setState(c, 'Loaded on Vessel'); });
                v.loaded += n; checkVessel(v);
                reqRamp(v, yt, function () {
                  var d3 = dur('yt_descend');
                  log(yt, { a: 'Ramp descent', from: v.id + '_DECK', to: v.id + '_SHIP', d: d3, st: 'Returning', vessel: v.id, carry: 'Empty chassis' });
                  at(now + d3, function () { relRamp(v); yt.busy = false; dispatch(); });
                });
              });
            });
          });
        });
      });
    }
    function tryYT(yt) {
      var v = V[yt.vessel];
      if (!v.ready) return setWait(yt, 'idle', v.arrival > now ? 'Vessel not yet arrived' : 'Vessel berthing / set-up', v.id);
      if (v.departing || v.departed) return setWait(yt, 'idle', 'Vessel work complete', v.id);
      var free = brFree();
      var wantD = v.toDischarge > 0, canD = wantD && v.dischargeOpen && free >= 1;
      var wantL = v.loadAssigned < v.load, canL = wantL && v.loadOpen && staging[v.id].length > 0;
      var pick = null;
      if (P.ytPriority === 'loading') pick = canL ? 'L' : (canD ? 'D' : null);
      else if (P.ytPriority === 'balanced') { pick = canD && canL ? (v.flip++ % 2 ? 'L' : 'D') : (canD ? 'D' : (canL ? 'L' : null)); }
      else pick = canD ? 'D' : (canL ? 'L' : null);
      if (pick === 'D') return startDischarge(yt, v, tripUnits(v, 'd', Math.min(v.toDischarge, free)));
      if (pick === 'L') return startLoad(yt, v, tripUnits(v, 'l', staging[v.id].length));
      if (wantD && !v.dischargeOpen) return setWait(yt, 'blocked', 'Discharge not permitted: BR space short', v.id);
      if (wantD) return setWait(yt, 'blocked', 'BR full: no slot for the next container', v.id);
      if (wantL && !v.loadOpen) return setWait(yt, 'idle', 'Loading not yet started', v.id);
      if (wantL) return setWait(yt, 'wait', 'No outbound container staged at the 2GO area', v.id);
      return setWait(yt, 'idle', 'Vessel work complete', v.id);
    }

    /* ---------- Reach Stacker (Option 2) ---------- */
    function tryRS(rs) {
      if (P.sourcing !== 'rs') return setWait(rs, 'idle', 'Not used in Option 1 (NorthPort hustling)');
      var v = null;
      ORDER.forEach(function (id) { if (!v && V[id].loadOpen && stack[id].length) v = V[id]; });
      if (!v) return setWait(rs, 'idle', 'No container to mount');
      if (chassisPool < 1) return setWait(rs, 'wait', 'Waiting for an empty chassis');
      closeWait(rs); rs.busy = true; chassisPool--; rs.trips++; rs.units++;
      var c = stack[v.id].shift(), d = dur('rs_mount');
      setState(c, 'Under Reach Stacker Mounting');
      log(rs, { a: 'Mount container on chassis', from: 'AREA', d: d, st: 'Loading', c: [c], vessel: v.id });
      at(now + d, function () { setState(c, 'At 2GO Assigned Area'); staging[v.id].push(c); rs.busy = false; dispatch(); });
    }

    /* ---------- NorthPort RT cycle ---------- */
    function stagedCount() { return staging.MSK.length + staging.MLG.length; }
    function releaseStagingWaiters() { while (stagingWaiters.length && (!P.stagingCap || stagedCount() < P.stagingCap)) stagingWaiters.shift()(); }
    function bothWorking() { return ORDER.filter(function (id) { return V[id].ready && !V[id].departing && !V[id].departed; }).length > 1; }
    function pickOutbound() {
      for (var i = 0; i < ORDER.length; i++) { var v = V[ORDER[i]]; if (v.loadOpen && npOut[v.id].length) return npOut[v.id].shift(); }
      return null;
    }
    function rtReturn(rt, from, back, cargo) {
      var carry = cargo ? [cargo] : [];
      if (cargo) setState(cargo, 'Returning Laden');
      log(rt, { a: 'Return ' + (from === 'NP' ? 'NorthPort' : 'empty set-down') + ' → 2GO area', from: from, to: 'AREA', d: back * 0.9, st: 'Returning', c: carry, carry: cargo ? '' : 'Empty chassis', vessel: cargo ? cargo.vessel : '' });
      at(now + back * 0.9, function () {
        function finish() {
          closeWait(rt);
          if (cargo) { setState(cargo, 'At 2GO Assigned Area'); staging[cargo.vessel].push(cargo); }
          else if (P.sourcing === 'rs') chassisPool++;
          log(rt, { a: 'Reposition 2GO area → BR', from: 'AREA', to: 'BR', d: back * 0.1, st: 'Returning', carry: 'Bobtail' });
          dispatch();
          at(now + back * 0.1, function () { rt.busy = false; dispatch(); });
        }
        if (cargo && P.stagingCap && stagedCount() >= P.stagingCap) { setWait(rt, 'queue', '2GO staging area full', cargo.vessel); stagingWaiters.push(finish); }
        else finish();
      });
    }
    function startPull(rt, c) {
      closeWait(rt); rt.busy = true; rt.trips++; rt.units++;
      var d = dur('rt_pullout');
      setState(c, 'Being Pulled Out');
      var e = log(rt, { a: 'Pull out container in BR', from: 'BR', d: d, st: 'Loading', c: [c], br: -1, vessel: c.vessel });
      at(now + d, function () {
        br.occ--; pulledOut++; e.brOcc = br.occ; brMark(); dispatch();
        var d2 = dur('rt_ptb');
        log(rt, { a: 'PTB stop and chassis inspection', from: 'BR', to: 'PTB', d: d2, st: 'Positioning', c: [c], vessel: c.vessel });
        at(now + d2, function () {
          var empty = c.status === 'Empty';
          var sp = tatSplit(dur(P.rtCongested && bothWorking() ? 'rt_tat_congested' : 'rt_tat'), empty);
          var dest = empty ? 'MT' : 'NP';
          log(rt, { a: 'Hustle PTB → ' + (empty ? 'empty set-down' : 'NorthPort'), from: 'PTB', to: dest, d: sp.out, st: 'Hustling', c: [c], vessel: c.vessel });
          at(now + sp.out, function () {
            log(rt, { a: 'Set-down at ' + (empty ? 'empty set-down' : 'NorthPort'), from: dest, d: sp.handle, st: 'Loading', c: [c], vessel: c.vessel });
            at(now + sp.handle, function () {
              setState(c, empty ? 'At Empty Set-down' : 'At NorthPort');
              rtReturn(rt, dest, sp.back, !empty && P.sourcing === 'hustle' ? pickOutbound() : null);
            });
          });
        });
      });
    }
    /* trip with nothing to pull out: fetch an outbound box (Option 1) or bring a chassis (Option 2) */
    function startFetch(rt) {
      closeWait(rt); rt.busy = true; rt.trips++;
      var sp = tatSplit(dur(P.rtCongested && bothWorking() ? 'rt_tat_congested' : 'rt_tat'), false);
      var cargo = pickOutbound(); rt.units++;
      log(rt, { a: 'Hustle BR → NorthPort (empty chassis)', from: 'BR', to: 'NP', d: sp.out, st: 'Hustling', carry: 'Empty chassis', vessel: cargo.vessel });
      at(now + sp.out, function () {
        log(rt, { a: 'Pick up outbound container at NorthPort', from: 'NP', d: sp.handle, st: 'Loading', c: [cargo], vessel: cargo.vessel });
        at(now + sp.handle, function () { rtReturn(rt, 'NP', sp.back, cargo); });
      });
    }
    function startChassis(rt) {
      closeWait(rt); rt.busy = true; rt.trips++;
      var leg = tatSplit(dur('rt_tat'), false).back * 0.1;
      log(rt, { a: 'Bring empty chassis BR → 2GO area', from: 'BR', to: 'AREA', d: leg, st: 'Moving', carry: 'Empty chassis' });
      at(now + leg, function () {
        chassisPool++;
        log(rt, { a: 'Reposition 2GO area → BR', from: 'AREA', to: 'BR', d: leg, st: 'Returning', carry: 'Bobtail' });
        dispatch();
        at(now + leg, function () { rt.busy = false; dispatch(); });
      });
    }
    var chassisOnWay = 0;
    function tryRT(rt) {
      if (now < rt.from) return setWait(rt, 'idle', 'Not yet deployed');
      if (br.q.length) return startPull(rt, br.q.shift());
      var openOut = ORDER.some(function (id) { return V[id].loadOpen && npOut[id].length; });
      if (P.sourcing === 'hustle' && openOut) return startFetch(rt);
      if (P.sourcing === 'rs') {
        var need = ORDER.reduce(function (s, id) { return s + (V[id].loadOpen ? stack[id].length : 0); }, 0);
        if (need > chassisPool + chassisOnWay) { chassisOnWay++; at(now + 1e-6, function () { chassisOnWay--; }); return startChassis(rt); }
      }
      setWait(rt, 'idle', 'No container in BR to pull out');
    }

    /* ---------- dispatcher: called after every state change ---------- */
    var dispatching = false, again = false;
    function dispatch() {
      if (dispatching) { again = true; return; }
      dispatching = true;
      do {
        again = false;
        ORDER.forEach(function (id) {
          var v = V[id];
          if (v.ready && !v.dischargeOpen && v.toDischarge > 0) {
            var ahead = 0;
            ORDER.slice(0, ORDER.indexOf(id)).forEach(function (h) { if (!V[h].departed && V[h].arrival <= now) ahead += V[h].toDischarge; });
            var need = id === ORDER[0] ? 1 : P.mlgGate + ahead;
            if (brFree() >= need) {
              v.dischargeOpen = true; v.tGateOpen = now;
              at(now + v.cfg.loadOffsetMin * 60, function () { openLoad(v); });
            }
          }
          if (v.ready && v.discharge === 0 && !v.loadOpen && !v.loadSched) { v.loadSched = true; at(now + v.cfg.loadOffsetMin * 60, function () { openLoad(v); }); }
        });
        yts.forEach(function (y) { if (!y.busy) tryYT(y); });
        rss.forEach(function (r) { if (!r.busy) tryRS(r); });
        rts.forEach(function (r) { if (!r.busy) tryRT(r); });
      } while (again);
      dispatching = false;
    }

    /* ---------- run ---------- */
    ORDER.forEach(function (id) {
      var v = V[id];
      at(v.arrival, function () { dispatch(); });
      at(v.readyAt, function () { v.ready = true; checkVessel(v); dispatch(); });
    });
    (function () {
      var cyc = mean(obsFor('rt_pullout')) + mean(obsFor('rt_ptb')) + mean(obsFor('rt_tat'));
      rts.forEach(function (r, i) { r.from = rtDeployAt + (P.rtStagger ? i * cyc / rts.length : 0); at(r.from, dispatch); });
    })();
    at(0, dispatch);
    var LIMIT = 96 * H, steps = 0, timedOut = false;
    while (queue.length) {
      var q = popNext();
      if (q.t > LIMIT || ++steps > 400000) { timedOut = true; break; }
      now = q.t; q.fn();
    }
    var endT = now;
    eqs.forEach(closeWait);
    events.sort(function (a, b) { return a.t0 - b.t0 || a.id - b.id; });
    // running BR occupancy per event row
    (function () {
      var k = 0, occ = P.brInitial;
      var ch = events.filter(function (e) { return e.brDelta; }).map(function (e) { return [e.t1, e.brDelta]; }).sort(function (a, b) { return a[0] - b[0]; });
      events.forEach(function (e) { while (k < ch.length && ch[k][0] <= e.t1) occ += ch[k++][1]; e.brOcc = occ; });
    })();

    return finish();

    /* ---------- KPIs and validation ---------- */
    function finish() {
      var res = { params: P, events: events, containers: containers, brSeries: brSeries, endT: endT, timedOut: timedOut, rtDeployAt: rtDeployAt, violations: violations };
      var complete = ORDER.every(function (id) { return V[id].departed; });
      res.complete = complete && !timedOut;

      res.vessels = ORDER.map(function (id) {
        var v = V[id];
        var gateWait = v.discharge && v.tGateOpen != null ? Math.max(0, v.tGateOpen - v.readyAt) : (v.discharge && v.tGateOpen == null ? endT - v.readyAt : 0);
        var blocked = 0, starved = 0;
        events.forEach(function (e) { if (e.eqType === 'YT' && e.vessel === id && !e.work) { if (e.result === 'blocked') blocked += e.dur; else if (e.result === 'waiting') starved += e.dur; } });
        return {
          id: id, arrival: v.arrival, readyAt: v.readyAt, gateOpen: v.tGateOpen, gateWait: gateWait,
          dStart: v.tDStart, dEnd: v.tDEnd, lStart: v.tLStart, lEnd: v.tLEnd, depart: v.tDepart, departed: v.departed,
          discharge: v.discharge, discharged: v.discharged, load: v.load, loaded: v.loaded,
          turnaround: v.tDepart != null ? v.tDepart - v.arrival : null,
          dRate: v.tDEnd != null && v.tDStart != null && v.tDEnd > v.tDStart ? v.discharge / ((v.tDEnd - v.tDStart) / H) : null,
          lRate: v.tLEnd != null && v.tLStart != null && v.tLEnd > v.tLStart ? v.load / ((v.tLEnd - v.tLStart) / H) : null,
          ytBlocked: blocked, ytStarved: starved
        };
      });
      var vBy = {}; res.vessels.forEach(function (v) { vBy[v.id] = v; });

      res.equipment = eqs.map(function (e) {
        var w0, w1;
        if (e.type === 'YT') { w0 = vBy[e.vessel].readyAt; w1 = vBy[e.vessel].depart != null ? vBy[e.vessel].depart : endT; }
        else { w0 = rtDeployAt; w1 = endT; }
        var busy = 0, blocked = 0, wait = 0, queued = 0, idle = 0, byAct = {};
        events.forEach(function (ev) {
          if (ev.eq !== e.id) return;
          var a = Math.max(ev.t0, w0), b = Math.min(ev.t1, w1), d = Math.max(0, b - a);
          if (ev.work) { busy += d; byAct[ev.activity] = (byAct[ev.activity] || 0) + d; }
          else if (ev.kind === 'blocked') blocked += d; else if (ev.kind === 'wait') wait += d; else if (ev.kind === 'queue') queued += d; else idle += d;
        });
        var win = Math.max(1, w1 - w0);
        return {
          id: e.id, type: e.type, owner: e.owner, vessel: e.vessel || '', window: win, w0: w0, w1: w1,
          busy: busy, blocked: blocked, wait: wait, queued: queued, idle: idle, util: busy / win,
          trips: e.trips, units: e.units, cycle: e.trips ? busy / e.trips : null, perHour: e.units / (win / H), byAct: byAct
        };
      });

      /* BR statistics */
      var cap = P.brCapacity, peak = 0, tFull = 0, t90 = 0, area = 0, firstFull = null;
      for (var i = 0; i < brSeries.length; i++) {
        var a = brSeries[i], t1 = i + 1 < brSeries.length ? brSeries[i + 1][0] : endT, d = t1 - a[0];
        peak = Math.max(peak, a[1]); area += a[1] * d;
        if (a[1] + a[2] >= cap) { tFull += d; if (firstFull == null && d > 0) firstFull = a[0]; }
        if (a[1] >= 0.9 * cap) t90 += d;
      }
      var lastPull = 0; events.forEach(function (e) { if (e.brDelta < 0) lastPull = Math.max(lastPull, e.t1); });
      res.br = {
        capacity: cap, initial: P.brInitial, peak: peak, peakPct: peak / cap, avg: area / Math.max(1, endT), tFull: tFull, t90: t90, firstFull: firstFull,
        entered: events.reduce(function (s, e) { return s + (e.brDelta > 0 ? e.brDelta : 0); }, 0), pulled: pulledOut, final: br.occ,
        clearRate: lastPull > rtDeployAt ? pulledOut / ((lastPull - rtDeployAt) / H) : 0, cleared: lastPull
      };

      /* totals */
      function sum(type, f) { return res.equipment.filter(function (e) { return e.type === type; }).reduce(function (s, e) { return s + e[f]; }, 0); }
      var tot = { discharged: 0, loaded: 0 };
      res.vessels.forEach(function (v) { tot.discharged += v.discharged; tot.loaded += v.loaded; });
      var opsStart = Math.min.apply(null, res.vessels.map(function (v) { return v.readyAt; }));
      var opsEnd = Math.max.apply(null, res.vessels.map(function (v) { return v.depart != null ? v.depart : endT; }));
      res.totals = {
        discharged: tot.discharged, loaded: tot.loaded, handled: tot.discharged + tot.loaded, pulled: pulledOut,
        perHour: (tot.discharged + tot.loaded) / Math.max(1e-9, (opsEnd - opsStart) / H), opsStart: opsStart, opsEnd: opsEnd,
        ytUtil: sum('YT', 'busy') / Math.max(1, sum('YT', 'window')), rtUtil: sum('RT', 'busy') / Math.max(1, sum('RT', 'window')),
        ytBlocked: sum('YT', 'blocked'), ytWait: sum('YT', 'wait') + sum('YT', 'queued'), ytIdle: sum('YT', 'idle'),
        rtIdle: sum('RT', 'idle'), rtWait: sum('RT', 'wait') + sum('RT', 'queued') + sum('RT', 'blocked'),
        ytPerHour: sum('YT', 'units') / Math.max(1e-9, sum('YT', 'window') / H), rtPerHour: sum('RT', 'units') / Math.max(1e-9, sum('RT', 'window') / H),
        ytCycle: sum('YT', 'trips') ? sum('YT', 'busy') / sum('YT', 'trips') : null, rtCycle: sum('RT', 'trips') ? sum('RT', 'busy') / sum('RT', 'trips') : null
      };

      /* validation checks */
      var byState = {}; containers.forEach(function (c) { byState[c.state] = (byState[c.state] || 0) + 1; });
      res.byState = byState;
      var dbl = 0, perEq = {};
      events.forEach(function (e) { (perEq[e.eq] = perEq[e.eq] || []).push(e); });
      Object.keys(perEq).forEach(function (k) { var a = perEq[k]; for (var j = 1; j < a.length; j++) if (a[j].t0 < a[j - 1].t1 - 1e-6) dbl++; });
      var maxOcc = 0; brSeries.forEach(function (s) { maxOcc = Math.max(maxOcc, s[1] + s[2]); });
      var atDest = (byState['At NorthPort'] || 0) + (byState['At Empty Set-down'] || 0);
      var inbound = P.brInitial + tot.discharged;
      res.checks = [
        { name: 'No equipment unit is double-booked', ok: dbl === 0, detail: dbl + ' overlapping event pairs across ' + eqs.length + ' units' },
        { name: 'Every container follows a valid state sequence', ok: violations.length === 0, detail: violations.length + ' invalid transitions across ' + containers.length + ' containers' },
        { name: 'BR never exceeds capacity (occupied + reserved)', ok: maxOcc <= cap, detail: 'Highest occupied + reserved ' + maxOcc + ' of ' + cap },
        { name: 'Discharged = entered BR', ok: res.br.entered === tot.discharged, detail: tot.discharged + ' discharged, ' + res.br.entered + ' entered BR' },
        { name: 'BR balance: initial + entered − pulled out = remaining', ok: P.brInitial + res.br.entered - pulledOut === br.occ, detail: P.brInitial + ' + ' + res.br.entered + ' − ' + pulledOut + ' = ' + br.occ },
        { name: 'Pulled-out containers all reached a set-down point', ok: atDest === pulledOut, detail: atDest + ' at NorthPort or empty set-down, ' + pulledOut + ' pulled out' },
        { name: 'Inbound balance: BR + set-down = initial + discharged', ok: br.occ + atDest === inbound, detail: (br.occ + atDest) + ' located, ' + inbound + ' expected' },
        { name: 'Loaded containers match the loading plan', ok: (byState['Loaded on Vessel'] || 0) === tot.loaded && res.vessels.every(function (v) { return !v.departed || v.loaded === v.load; }), detail: (byState['Loaded on Vessel'] || 0) + ' on board, plan ' + res.vessels.map(function (v) { return v.load; }).join(' + ') },
        { name: 'Every container is in exactly one location', ok: Object.keys(byState).reduce(function (s, k) { return s + byState[k]; }, 0) === containers.length, detail: containers.length + ' containers tracked' },
        { name: 'MLG discharge started only with BR space', ok: !vBy.MLG.gateOpen || vBy.MLG.gateOpen >= vBy.MLG.readyAt, detail: vBy.MLG.gateOpen != null ? 'Permitted ' + Math.round(vBy.MLG.gateWait / 60) + ' min after MLG was ready' : 'Never permitted' },
        { name: 'Both vessels completed and departed', ok: res.complete, detail: res.complete ? 'Run finished' : 'Run did not finish: check BR capacity, MLG start rule and fleet sizes' }
      ];
      res.ok = res.checks.every(function (c) { return c.ok; });
      return res;
    }
  }

  var SCENARIOS = [
    { id: 'baseline', name: '1 · Baseline', desc: 'Observed deployment: 4 MSK YTs, 3 MLG YTs, 6 NorthPort RTs, BR 120 with 43 on hand.', p: {} },
    { id: 'rt8', name: '2 · Two more RTs', desc: 'NorthPort deploys 8 RTs instead of 6.', p: { rtCount: 8 } },
    { id: 'yt', name: '3 · One more YT per vessel', desc: '5 YTs on MSK and 4 on MLG; RTs unchanged.', p: { vessels: { MSK: { ytCount: 5 }, MLG: { ytCount: 4 } } } },
    { id: 'preclear', name: '4 · Clear BR before discharge', desc: 'RTs start pulling the 43 boxes at MSK arrival instead of waiting for discharge to start.', p: { rtDeploy: 'arrival' } },
    { id: 'congested', name: '5 · Congested hustling', desc: 'Stress case: RT turnaround rises to the 40–45 min seen by wall clock whenever both vessels are working.', p: { rtCongested: true } }
  ];

  var API = { simulate: simulate, DEFAULTS: DEFAULTS, SCENARIOS: SCENARIOS, merge: merge, stats: stats, mean: mean, median: median, TRANSITIONS: TRANSITIONS };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.P4Engine = API;
})(typeof window !== 'undefined' ? window : globalThis);
