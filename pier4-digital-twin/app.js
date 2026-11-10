/* Pier 4 Digital Twin — interface. Everything shown here is read from the
 * result object returned by P4Engine.simulate(); nothing is entered by hand. */
(function () {
  'use strict';
  var D = window.P4DATA, E = window.P4Engine, H = 3600;
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }

  /* ---------- formatting ---------- */
  var T0 = E.DEFAULTS.startClock;
  function clk(t, sec) {
    if (t == null) return '–';
    var x = Math.round(T0 + t), d = Math.floor(x / 86400), h = Math.floor(x / 3600) % 24, m = Math.floor(x / 60) % 60, s = x % 60;
    if (!sec) { var r = Math.round((T0 + t) / 60); d = Math.floor(r / 1440); h = Math.floor(r / 60) % 24; m = r % 60; }
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + (sec ? ':' + String(s).padStart(2, '0') : '') + (d ? ' +' + d + 'd' : '');
  }
  function hrs(s, n) { return s == null ? '–' : (s / H).toFixed(n == null ? 1 : n) + ' h'; }
  function mss(s) { if (s == null || isNaN(s)) return '–'; s = Math.round(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function pct(x) { return x == null ? '–' : Math.round(x * 100) + '%'; }
  function num(x, n) { return x == null || isNaN(x) ? '–' : (+x).toFixed(n == null ? 1 : n); }
  function parseActual(s) { if (!s) return null; var p = s.split('+'), hm = p[0].split(':'); return ((+hm[0]) * 60 + (+hm[1]) + (p[1] ? 1440 : 0)) * 60 - T0; }

  /* ---------- state ---------- */
  var scenarioId = 'baseline', custom = null, cur = null, T = 0, playing = false, speed = 300, lastTs = 0;
  var evBy = {}, cache = {};
  function scenarioParams(id) { var s = E.SCENARIOS.filter(function (x) { return x.id === id; })[0]; return E.merge(E.DEFAULTS, s ? s.p : {}); }
  function activeParams() { return custom || scenarioParams(scenarioId); }
  function run(p) { var k = JSON.stringify(p); return cache[k] || (cache[k] = E.simulate(p)); }

  function runCurrent() {
    cur = run(activeParams());
    evBy = {}; eqIndex = {};
    cur.equipment.forEach(function (q) { eqIndex[q.id] = q; });
    cur.events.forEach(function (e) { (evBy[e.eq] = evBy[e.eq] || []).push(e); });
    T = Math.min(T, cur.endT);
    $('seek').max = Math.ceil(cur.endT);
    var st = $('runState');
    st.className = 'pill ' + (cur.ok ? 'good' : 'crit');
    st.textContent = cur.ok ? 'All ' + cur.checks.length + ' validation checks pass' : (cur.complete ? 'Validation check failed' : 'Run did not complete');
    dirty = {}; renderPage(page); drawAll(true);
  }

  /* ---------- tabs ---------- */
  var PAGES = [['sim', 'Simulation'], ['flow', 'Process flow'], ['log', 'Event log'], ['times', 'Activity times'], ['equip', 'Equipment'], ['br', 'BR congestion'], ['vessels', 'Vessels'], ['scenarios', 'Scenarios'], ['findings', 'Findings'], ['data', 'Data and assumptions']];
  var PID = { scenarios: 'p-scen', findings: 'p-find' };
  var page = 'sim', dirty = {};
  function pid(p) { return PID[p] || 'p-' + p; }
  function showPage(p) {
    if (!PAGES.some(function (x) { return x[0] === p; })) p = 'sim';
    page = p;
    PAGES.forEach(function (x) { $(pid(x[0])).hidden = x[0] !== p; });
    Array.prototype.forEach.call($('tabs').children, function (a) { a.setAttribute('aria-current', a.dataset.p === p ? 'true' : 'false'); });
    renderPage(p);
    if (p === 'sim') { sizeCanvas(); drawAll(true); }
  }
  function renderPage(p) {
    if (!cur || dirty[p]) return; dirty[p] = true;
    var f = { flow: renderFlow, log: renderLog, times: renderTimes, equip: renderEquip, br: renderBR, vessels: renderVessels, scenarios: renderScen, findings: renderFind, data: renderData }[p];
    if (f) f();
  }

  /* ---------- layout (image pixels on the 917×448 map) ---------- */
  var NODES0 = {
    MSK_DECK: [789, 318], MSK_SHIP: [811, 366], MLG_DECK: [879, 330], MLG_SHIP: [859, 372],
    AREA: [835, 322], BR: [841, 261], PTB: [800, 238], NP: [96, 126], MT: [640, 170],
    PW: [812, 288], PE: [860, 290], PC: [836, 287],
    R1: [826, 242], R2: [770, 226], R3: [712, 207], R4: [655, 190], R5: [600, 172], R6: [500, 145], R7: [400, 118], R8: [300, 96], R9: [215, 78], R10: [150, 80]
  };
  var LABELS = { MSK_SHIP: 'MSK Ramp 1 · Pier 4.5', MLG_SHIP: 'MLG Ramp 1 · Pier 4.2', AREA: '2GO assigned area', BR: 'Backreach (BR)', PTB: 'PTB stop', NP: 'NorthPort set-down', MT: 'Empty set-down', MSK_DECK: 'MSK v78', MLG_DECK: 'MLG v87' };
  var NODES = JSON.parse(JSON.stringify(NODES0));
  (function () { var s = store('p4.layout'); if (s) Object.keys(s).forEach(function (k) { if (NODES[k] && s[k] && s[k].length === 2) NODES[k] = s[k]; }); })();
  var ROAD = ['R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10'];
  var PATHS = {
    'MSK_SHIP>MSK_DECK': ['MSK_SHIP', 'MSK_DECK'], 'MLG_SHIP>MLG_DECK': ['MLG_SHIP', 'MLG_DECK'],
    'MSK_SHIP>BR': ['MSK_SHIP', 'PW', 'BR'], 'MLG_SHIP>BR': ['MLG_SHIP', 'PE', 'BR'],
    'MSK_SHIP>AREA': ['MSK_SHIP', 'AREA'], 'MLG_SHIP>AREA': ['MLG_SHIP', 'AREA'],
    'BR>PTB': ['BR', 'R1', 'PTB'], 'PTB>NP': ['PTB'].concat(ROAD, ['NP']), 'PTB>MT': ['PTB', 'R2', 'R3', 'R4', 'MT'],
    'BR>NP': ['BR', 'R1'].concat(ROAD, ['NP']), 'BR>AREA': ['BR', 'PC', 'AREA'],
    'AREA>NP': ['AREA', 'PC', 'R1'].concat(ROAD, ['NP']), 'AREA>MT': ['AREA', 'PC', 'R1', 'R2', 'R3', 'R4', 'MT']
  };
  function pathPts(from, to) {
    var p = PATHS[from + '>' + to], rev = false;
    if (!p) { p = PATHS[to + '>' + from]; rev = true; }
    if (!p) p = [from, to], rev = false;
    var pts = p.map(function (k) { return NODES[k]; });
    return rev ? pts.slice().reverse() : pts;
  }
  function along(pts, f) {
    var L = 0, seg = [], i;
    for (i = 1; i < pts.length; i++) { var d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); L += d; }
    var x = Math.max(0, Math.min(1, f)) * L;
    for (i = 0; i < seg.length; i++) { if (x <= seg[i] || i === seg.length - 1) { var r = seg[i] ? x / seg[i] : 0; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * r, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * r]; } x -= seg[i]; }
    return pts[0];
  }

  /* ---------- state of the world at time T ---------- */
  function evAt(id, t) {
    var a = evBy[id]; if (!a || !a.length) return null;
    var lo = 0, hi = a.length - 1;
    while (lo < hi) { var m = (lo + hi + 1) >> 1; if (a[m].t0 <= t) lo = m; else hi = m - 1; }
    return a[lo].t0 <= t ? a[lo] : null;
  }
  function brAt(t) { var s = cur.brSeries, lo = 0, hi = s.length - 1; while (lo < hi) { var m = (lo + hi + 1) >> 1; if (s[m][0] <= t) lo = m; else hi = m - 1; } return s[lo]; }
  function stateAt(c, t) { var h = c.hist, s = h[0][1]; for (var i = 1; i < h.length && h[i][0] <= t; i++) s = h[i][1]; return s; }
  function vesselStatus(v, t) {
    if (t < v.arrival) return ['Not yet arrived', ''];
    if (v.depart != null && t >= v.depart) return ['Departed', 'good'];
    if (t < v.readyAt) return ['Berthing and set-up', ''];
    if (v.discharge && (v.gateOpen == null || t < v.gateOpen)) return ['Waiting for BR space', 'crit'];
    var dOn = v.dStart != null && t >= v.dStart && (v.dEnd == null || t < v.dEnd), lOn = v.lStart != null && t >= v.lStart && (v.lEnd == null || t < v.lEnd);
    if (dOn && lOn) return ['Discharging and loading', 'run'];
    if (dOn) return ['Discharging', 'run'];
    if (lOn) return ['Loading', 'run'];
    if (v.dEnd != null && t >= v.dEnd && v.lEnd != null && t >= v.lEnd) return ['Work complete, preparing to sail', 'good'];
    return ['Working', 'run'];
  }
  function snapshot(t) {
    var s = { eq: {}, counts: {}, cs: {} };
    cur.equipment.forEach(function (q) {
      var e = evAt(q.id, t), st = e ? (t < e.t1 ? e.after : (e.work ? e.after : e.after)) : 'Available';
      s.eq[q.id] = { ev: e, status: st, kind: e && !e.work ? (e.kind || 'idle') : 'busy' };
      var c = s.counts[q.type] = s.counts[q.type] || { n: 0, busy: 0, wait: 0, idle: 0 };
      c.n++; if (!e || (!e.work && (e.kind || 'idle') === 'idle')) c.idle++; else if (!e.work) c.wait++; else c.busy++;
    });
    cur.containers.forEach(function (c) { var x = stateAt(c, t); s.cs[x] = (s.cs[x] || 0) + 1; });
    // cumulative time split up to t
    s.cum = {};
    cur.equipment.forEach(function (q) { s.cum[q.id] = { busy: 0, blocked: 0, wait: 0, idle: 0, win: Math.max(0, Math.min(t, q.w1) - q.w0), trips: 0, units: 0 }; });
    cur.events.forEach(function (e) {
      if (e.t0 >= t) return;
      var q = s.cum[e.eq], eqd = eqIndex[e.eq];
      var d = Math.max(0, Math.min(e.t1, t, eqd.w1) - Math.max(e.t0, eqd.w0));
      if (e.work) q.busy += d; else if (e.kind === 'blocked') q.blocked += d; else if (e.kind === 'wait' || e.kind === 'queue') q.wait += d; else q.idle += d;
    });
    return s;
  }
  var eqIndex = {};

  /* ---------- map ---------- */
  var cv = $('map'), ctx = cv.getContext('2d'), img = new Image(), imgOk = false, K = 2, dpr = 1, editing = false, dragKey = null, hoverEq = null;
  img.onload = function () { imgOk = true; drawAll(true); };
  img.src = 'gmap.jpg';
  function sizeCanvas() {
    var w = cv.parentNode.clientWidth; if (!w) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(w * dpr); cv.height = Math.round(w * 448 / 917 * dpr); K = cv.width / 917;
  }
  function P(k) { var n = typeof k === 'string' ? NODES[k] : k; return [n[0] * K, n[1] * K]; }
  function poly(keys, color, width, dash) {
    ctx.beginPath(); keys.forEach(function (k, i) { var p = P(k); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
    ctx.strokeStyle = color; ctx.lineWidth = width * dpr; ctx.setLineDash((dash || []).map(function (x) { return x * dpr; })); ctx.stroke(); ctx.setLineDash([]);
  }
  function label(txt, x, y, o) {
    o = o || {}; if (cv.width / dpr < 560 && !o.bold) return 0; var fs = (o.size || 10.5) * dpr; ctx.font = (o.bold ? '600 ' : '500 ') + fs + 'px "IBM Plex Sans", sans-serif';
    var w = ctx.measureText(txt).width, px = 4 * dpr, hh = fs + 5 * dpr;
    var bx = o.align === 'right' ? x - w - 2 * px : (o.align === 'center' ? x - w / 2 - px : x);
    bx = Math.max(2, Math.min(cv.width - w - 2 * px - 2, bx));
    ctx.fillStyle = o.bg || 'rgba(12,22,30,.82)'; ctx.fillRect(bx, y - hh / 2, w + 2 * px, hh);
    ctx.fillStyle = o.fg || '#fff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(txt, bx + px, y + 0.5);
    return w + 2 * px;
  }
  var C = { go2: '#3d8dee', np: '#f0703a', rs: '#22c08a', crit: '#ff5a5a', warn: '#fab219' };
  var drawn = [];
  function drawMap(snap) {
    var W = cv.width, Hh = cv.height;
    ctx.clearRect(0, 0, W, Hh);
    if (imgOk) ctx.drawImage(img, 0, 0, W, Hh); else { ctx.fillStyle = '#1d3a55'; ctx.fillRect(0, 0, W, Hh); }
    ctx.fillStyle = 'rgba(8,16,24,.30)'; ctx.fillRect(0, 0, W, Hh);
    // routes
    poly(['BR', 'R1'].concat(ROAD, ['NP']), 'rgba(240,112,58,.95)', 2.2, [7, 5]);
    poly(['R4', 'MT'], 'rgba(240,112,58,.95)', 2.2, [3, 4]);
    poly(['R1', 'PC', 'AREA'], 'rgba(240,112,58,.7)', 1.4, [3, 4]);
    poly(['MSK_SHIP', 'PW', 'BR'], 'rgba(61,141,238,.8)', 1.6); poly(['MLG_SHIP', 'PE', 'BR'], 'rgba(61,141,238,.8)', 1.6);
    poly(['MSK_SHIP', 'AREA', 'MLG_SHIP'], 'rgba(61,141,238,.55)', 1.2, [2, 3]);
    // vessels
    cur.vessels.forEach(function (v) {
      var d = P(v.id + '_DECK'), st = vesselStatus(v, T), inPort = T >= v.arrival && !(v.depart != null && T >= v.depart);
      var w = 15 * K, h = 62 * K;
      ctx.lineWidth = 2 * dpr; ctx.setLineDash(inPort ? [] : [4 * dpr, 4 * dpr]);
      ctx.strokeStyle = !inPort ? 'rgba(255,255,255,.55)' : (st[1] === 'crit' ? C.crit : (st[1] === 'good' ? '#5fe07a' : '#fff'));
      if (!inPort) { ctx.fillStyle = 'rgba(20,45,70,.78)'; ctx.fillRect(d[0] - w, d[1] - h, 2 * w, 2 * h); }
      ctx.strokeRect(d[0] - w, d[1] - h, 2 * w, 2 * h); ctx.setLineDash([]);
      var left = v.id === 'MSK', ly = left ? d[1] - h + 8 * dpr : d[1] + h + 26 * dpr;
      label(v.id + ' · ' + st[0], d[0] + (left ? -w - 4 * dpr : w + 4 * dpr), ly, { align: left ? 'right' : 'left', bold: true, bg: st[1] === 'crit' ? 'rgba(160,30,30,.92)' : null });
      if (inPort) {
        var dis = 0, ld = 0;
        cur.containers.forEach(function (c) { if (c.vessel !== v.id) return; var s = stateAt(c, T); if (c.dir === 'in' && s !== 'Awaiting Discharge' && s !== 'Discharging') dis++; if (s === 'Loaded on Vessel') ld++; });
        label('out ' + dis + '/' + v.discharge + ' · in ' + ld + '/' + v.load, d[0] + (left ? -w - 4 * dpr : w + 4 * dpr), ly + 16 * dpr, { align: left ? 'right' : 'left', size: 10 });
      }
    });
    // BR
    var b = brAt(T), cap = cur.br.capacity, bp = P('BR'), bw = 46 * dpr, frac = Math.min(1, b[1] / cap);
    ctx.fillStyle = 'rgba(12,22,30,.85)'; ctx.fillRect(bp[0] + 10 * dpr, bp[1] - 7 * dpr, bw, 8 * dpr);
    ctx.fillStyle = b[1] + b[2] >= cap ? C.crit : (frac >= 0.9 ? C.warn : '#5fe07a'); ctx.fillRect(bp[0] + 10 * dpr, bp[1] - 7 * dpr, bw * frac, 8 * dpr);
    label('BR ' + b[1] + '/' + cap + (b[1] + b[2] >= cap ? ' FULL' : ''), bp[0] + 10 * dpr, bp[1] - 18 * dpr, { bold: true, bg: b[1] + b[2] >= cap ? 'rgba(160,30,30,.92)' : null });
    // other nodes
    function dot(k) { var p = P(k); ctx.beginPath(); ctx.arc(p[0], p[1], 3.5 * dpr, 0, 6.3); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#0c161e'; ctx.lineWidth = dpr; ctx.stroke(); return p; }
    var cs = snap.cs, p;
    p = dot('NP'); label('NorthPort set-down · ' + (cs['At NorthPort'] || 0) + ' delivered, ' + (cs['At NorthPort (outbound)'] || 0) + ' outbound waiting', p[0] + 8 * dpr, p[1] + 14 * dpr);
    p = dot('MT'); label('Empty set-down · ' + (cs['At Empty Set-down'] || 0), p[0], p[1] - 13 * dpr, { align: 'center' });
    p = dot('PTB'); label('PTB stop', p[0] - 6 * dpr, p[1] - 11 * dpr, { align: 'right', size: 9.5 });
    p = dot('AREA'); label('2GO area · ' + ((cs['At 2GO Assigned Area'] || 0)) + ' staged' + (cur.params.sourcing === 'rs' ? ', ' + (cs['At 2GO Stack'] || 0) + ' in stack' : ''), p[0], p[1] - 16 * dpr, { align: 'center', size: 9.5 });
    p = P('R6'); label('Orange Road · 1.1 km to NorthPort, 300 m to empty set-down', p[0], p[1] - 16 * dpr, { align: 'center', size: 9.5, bg: 'rgba(150,60,20,.9)' });
    dot('BR');
    ['MSK_SHIP', 'MLG_SHIP'].forEach(function (k) { var q = dot(k); label(LABELS[k], q[0] - (k === 'MSK_SHIP' ? 8 * dpr : 0), q[1] + 13 * dpr, { align: k === 'MSK_SHIP' ? 'right' : 'left', size: 9.5 }); });
    // equipment
    drawn = [];
    var parked = {};
    cur.equipment.forEach(function (q) {
      var s = snap.eq[q.id], e = s.ev, pos, moving = e && e.work && e.from !== e.to && T < e.t1;
      if (moving) pos = along(pathPts(e.from, e.to), (T - e.t0) / Math.max(1e-6, e.t1 - e.t0));
      else {
        var at = e ? (e.work && T >= e.t1 ? e.to : (e.work ? e.from : e.to)) : (q.type === 'YT' ? q.vessel + '_SHIP' : (q.type === 'RT' ? 'BR' : 'AREA'));
        var i = parked[at] = (parked[at] || 0) + 1, n = NODES[at] || NODES.BR;
        var sx = at.indexOf('MSK') === 0 ? -1 : 1;
        pos = at === 'BR' ? [n[0] - 8 - ((i - 1) % 4) * 7, n[1] - 9 - Math.floor((i - 1) / 4) * 7] : [n[0] + sx * (6 + ((i - 1) % 3) * 7), n[1] + (at.indexOf('DECK') > 0 ? -20 : 4) + Math.floor((i - 1) / 3) * 7];
      }
      var x = pos[0] * K, y = pos[1] * K, r = 4.6 * dpr, col = q.type === 'YT' ? C.go2 : (q.type === 'RT' ? C.np : C.rs);
      ctx.beginPath();
      if (q.type === 'YT') ctx.arc(x, y, r, 0, 6.3);
      else if (q.type === 'RT') { ctx.moveTo(x, y - r * 1.25); ctx.lineTo(x + r * 1.25, y); ctx.lineTo(x, y + r * 1.25); ctx.lineTo(x - r * 1.25, y); ctx.closePath(); }
      else ctx.rect(x - r, y - r, 2 * r, 2 * r);
      ctx.fillStyle = s.kind === 'idle' ? 'rgba(160,170,178,.95)' : col; ctx.fill();
      ctx.lineWidth = 1.6 * dpr; ctx.strokeStyle = s.kind === 'blocked' ? C.crit : (s.kind === 'wait' || s.kind === 'queue' ? C.warn : '#0c161e'); ctx.stroke();
      if (e && e.work && T < e.t1 && (e.cid || e.cstatus === 'Empty chassis')) {
        var n2 = e.cid ? e.cid.split('+').length : 0, bx = x + r + 2 * dpr, sz = 5 * dpr;
        if (!n2) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * dpr; ctx.beginPath(); ctx.moveTo(bx, y); ctx.lineTo(bx + 8 * dpr, y); ctx.stroke(); }
        for (var j = 0; j < n2; j++) {
          ctx.lineWidth = 1.4 * dpr;
          if (e.cstatus === 'Empty') { ctx.strokeStyle = '#fff'; ctx.strokeRect(bx + j * (sz + dpr), y - sz / 2, sz, sz); }
          else { ctx.fillStyle = '#fff'; ctx.fillRect(bx + j * (sz + dpr), y - sz / 2, sz, sz); ctx.strokeStyle = '#0c161e'; ctx.strokeRect(bx + j * (sz + dpr), y - sz / 2, sz, sz); }
        }
      }
      if (hoverEq === q.id) label(q.id, x, y - 13 * dpr, { align: 'center', size: 9.5, bold: true });
      drawn.push({ id: q.id, x: x, y: y, s: s });
    });
    if (editing) Object.keys(NODES).forEach(function (k) {
      var q = P(k); ctx.beginPath(); ctx.arc(q[0], q[1], 5 * dpr, 0, 6.3); ctx.fillStyle = LABELS[k] ? '#ffe14d' : 'rgba(255,225,77,.55)'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = dpr; ctx.stroke();
      if (LABELS[k]) label(LABELS[k], q[0] + 8 * dpr, q[1] - 10 * dpr, { size: 9.5, bg: 'rgba(90,75,0,.9)' });
    });
    label(clk(T) + '  ·  ' + cur.params.name, 8 * dpr, 14 * dpr, { bold: true, size: 12 });
    label('Model run, not a recording of the actual operation', 8 * dpr, Hh - 12 * dpr, { size: 9.5 });
  }
  function canvasPos(ev) { var r = cv.getBoundingClientRect(); return [(ev.clientX - r.left) * cv.width / r.width, (ev.clientY - r.top) * cv.height / r.height]; }
  cv.addEventListener('pointerdown', function (ev) {
    if (!editing) return; var m = canvasPos(ev), best = null, bd = 14 * dpr;
    Object.keys(NODES).forEach(function (k) { var q = P(k), d = Math.hypot(q[0] - m[0], q[1] - m[1]); if (d < bd) { bd = d; best = k; } });
    dragKey = best; if (best) cv.setPointerCapture(ev.pointerId);
  });
  cv.addEventListener('pointermove', function (ev) {
    var m = canvasPos(ev);
    if (editing && dragKey) { NODES[dragKey] = [Math.round(m[0] / K), Math.round(m[1] / K)]; drawAll(); return; }
    var best = null, bd = 10 * dpr; drawn.forEach(function (d) { var x = Math.hypot(d.x - m[0], d.y - m[1]); if (x < bd) { bd = x; best = d; } });
    var id = best ? best.id : null;
    if (best) { var e = best.s.ev; showTip(ev, best.id + ' · ' + best.s.status + (e ? '\n' + e.activity + (e.note ? ': ' + e.note : '') + (e.cid ? '\n' + e.cid + ' (' + e.cstatus + ')' : '') : '')); } else hideTip();
    if (id !== hoverEq) { hoverEq = id; if (!playing) drawAll(); }
  });
  cv.addEventListener('pointerup', function () { if (dragKey) { store('p4.layout', NODES); dragKey = null; } });
  cv.addEventListener('pointerleave', function () { hideTip(); hoverEq = null; });

  /* ---------- tooltip / toast ---------- */
  function showTip(ev, txt) { var t = $('tip'); t.textContent = txt; t.hidden = false; var x = ev.clientX + 12, y = ev.clientY + 12; t.style.left = Math.min(x, window.innerWidth - t.offsetWidth - 6) + 'px'; t.style.top = Math.min(y, window.innerHeight - t.offsetHeight - 6) + 'px'; }
  function hideTip() { $('tip').hidden = true; }
  document.addEventListener('mousemove', function (ev) { var el = ev.target.closest && ev.target.closest('[data-tip]'); if (el) showTip(ev, el.getAttribute('data-tip')); else if (ev.target !== cv) hideTip(); });
  var toastTimer; function toast(m) { var t = $('toast'); t.textContent = m; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3500); }

  /* ---------- live dashboard ---------- */
  var lastLive = 0;
  function bottleneckNow(snap) {
    var blocked = 0, starved = 0, rtIdle = snap.counts.RT ? snap.counts.RT.idle : 0, ytBusy = snap.counts.YT.busy, gate = false;
    Object.keys(snap.eq).forEach(function (k) { var s = snap.eq[k]; if (s.ev && !s.ev.work) { if (s.kind === 'blocked') { blocked++; if (/not permitted/.test(s.ev.note)) gate = true; } else if (s.kind === 'wait' && /outbound/.test(s.ev.note)) starved++; } });
    if (gate) return ['MLG held: BR space short', 'crit'];
    if (blocked) return ['BR full: ' + blocked + ' YT held, pull-out rate is the limit', 'crit'];
    if (starved) return [starved + ' YT waiting for outbound boxes: RT trips are the limit', 'warn'];
    if (rtIdle && ytBusy) return ['YT and ramp cycle (RTs have spare time)', ''];
    if (!ytBusy && !(snap.counts.RT && snap.counts.RT.busy)) return ['No work in progress', ''];
    return ['No unit is held up', 'good'];
  }
  function renderLive(force) {
    var nowTs = Date.now(); if (!force && nowTs - lastLive < 220) return; lastLive = nowTs;
    var snap = snapshot(T), b = brAt(T), cap = cur.br.capacity, cs = snap.cs, h = '';
    h += '<div class="panel"><h3>Vessels</h3>';
    cur.vessels.forEach(function (v) {
      var st = vesselStatus(v, T), wait = v.gateOpen != null ? Math.min(Math.max(0, T - v.readyAt), v.gateWait) : Math.max(0, T - v.readyAt);
      var dis = 0, ld = 0; cur.containers.forEach(function (c) { if (c.vessel !== v.id) return; var s = stateAt(c, T); if (c.dir === 'in' && s !== 'Awaiting Discharge' && s !== 'Discharging') dis++; if (s === 'Loaded on Vessel') ld++; });
      function done(t) { return t != null && T >= t ? clk(t) : '…'; }
      h += '<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:4px"><b>' + v.id + '</b><span class="pill ' + st[1] + '">' + st[0] + '</span></div><div class="kv">' +
        '<span>Arrival</span><b>' + clk(v.arrival) + '</b>' +
        '<span>Discharging ' + dis + ' / ' + v.discharge + '</span><b>' + done(v.dStart) + ' – ' + done(v.dEnd) + '</b>' +
        '<span>Loading ' + ld + ' / ' + v.load + '</span><b>' + done(v.lStart) + ' – ' + done(v.lEnd) + '</b>' +
        '<span>Wait for BR space before start</span><b>' + Math.round(wait / 60) + ' min</b>' +
        '<span>Turnaround' + (v.depart != null && T >= v.depart ? '' : ' so far') + '</span><b>' + (T < v.arrival ? '–' : hrs(Math.min(T, v.depart != null ? v.depart : T) - v.arrival)) + '</b></div></div>';
    });
    h += '</div>';
    var full = b[1] + b[2] >= cap, util = b[1] / cap, since = Math.max(1, T - cur.rtDeployAt), pulled = (cs['At NorthPort'] || 0) + (cs['At Empty Set-down'] || 0);
    h += '<div class="panel"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><h3>Backreach</h3><span class="pill ' + (full ? 'crit' : (util >= 0.9 ? 'warn' : 'good')) + '">' + (full ? 'Full' : (util >= 0.9 ? 'Above 90%' : 'Space available')) + '</span></div>' +
      '<div class="tiles"><div class="tile"><span>Occupied</span><b>' + b[1] + ' / ' + cap + '</b><small>' + b[2] + ' slots reserved by YTs in transit</small></div><div class="tile"><span>Available</span><b>' + (cap - b[1] - b[2]) + '</b><small>' + pct(util) + ' utilised</small></div></div>' +
      '<div class="meter ' + (full ? 'crit' : (util >= 0.9 ? 'warn' : '')) + '" style="margin:8px 0"><i style="width:' + Math.min(100, util * 100) + '%"></i></div>' +
      '<div class="kv"><span>Clearance rate so far</span><b>' + (T > cur.rtDeployAt ? num(pulled / (since / H)) : '–') + ' /h</b></div>' +
      '<div class="chart" style="margin-top:6px">' + lineChart({ series: [{ name: 'BR occupancy', color: 'var(--s-2go)', pts: cur.brSeries.map(function (s) { return [s[0], s[1]]; }) }], yMax: cap * 1.08, hlines: [{ v: cap, label: 'capacity ' + cap }], tEnd: cur.endT, w: 420, h: 130, cursor: T, compact: true }) + '</div></div>';
    h += '<div class="panel"><h3>Containers</h3><div class="kv">' +
      '<span>Discharged from vessels</span><b>' + cur.containers.filter(function (c) { return c.dir === 'in' && c.vessel !== 'PRE' && ['Awaiting Discharge', 'Discharging'].indexOf(stateAt(c, T)) < 0; }).length + '</b>' +
      '<span>Loaded on vessels</span><b>' + (cs['Loaded on Vessel'] || 0) + '</b>' +
      '<span>Pulled out of BR</span><b>' + (pulled + (cs['Being Pulled Out'] || 0)) + '</b>' +
      '<span>In BR now</span><b>' + b[1] + '</b>' +
      '<span>Awaiting discharge (on board)</span><b>' + (cs['Awaiting Discharge'] || 0) + '</b>' +
      '<span>Awaiting loading (not yet on board)</span><b>' + cur.containers.filter(function (c) { return c.dir === 'out' && stateAt(c, T) !== 'Loaded on Vessel'; }).length + '</b>' +
      '<span>Staged at 2GO area</span><b>' + (cs['At 2GO Assigned Area'] || 0) + '</b></div></div>';
    h += '<div class="panel"><h3>Equipment</h3><div class="tw"><table><tr><th>Fleet</th><th class="n">Busy</th><th class="n">Waiting</th><th class="n">Idle</th><th class="n">Utilised</th></tr>';
    var tw = 0, ti = 0;
    [['YT', '2GO yard tractors'], ['RT', 'NorthPort RTs'], ['RS', 'Reach Stackers']].forEach(function (x) {
      var c = snap.counts[x[0]]; if (!c) return; var bz = 0, wn = 0;
      cur.equipment.forEach(function (q) { if (q.type !== x[0]) return; var u = snap.cum[q.id]; bz += u.busy; wn += u.win; tw += u.blocked + u.wait; ti += u.idle; });
      h += '<tr><td>' + x[1] + '</td><td class="n">' + c.busy + '</td><td class="n">' + c.wait + '</td><td class="n">' + c.idle + '</td><td class="n">' + (wn ? pct(bz / wn) : '–') + '</td></tr>';
    });
    var bn = bottleneckNow(snap);
    h += '</table></div><div class="kv" style="margin-top:8px"><span>Waiting time so far (all units)</span><b>' + hrs(tw) + '</b><span>Idle time so far (all units)</span><b>' + hrs(ti) + '</b></div>' +
      '<p style="margin:8px 0 0"><span class="eyebrow">Constraint right now</span><br><span class="pill ' + bn[1] + '">' + esc(bn[0]) + '</span></p></div>';
    $('live').innerHTML = h;
  }

  function drawAll(force) {
    if (!cur || page !== 'sim') return;
    var snap = snapshot(T);
    drawMap(snap);
    $('clock').textContent = clk(T);
    $('seek').value = T;
    var u = $('tunit').value; $('elapsed').textContent = 'T+' + (u === 'h' ? (T / H).toFixed(2) + ' h' : (u === 'm' ? Math.round(T / 60) + ' min' : Math.round(T) + ' s'));
    renderLive(force);
  }
  function frame(ts) {
    if (playing) {
      var dt = Math.min(0.1, (ts - lastTs) / 1000); lastTs = ts;
      T = Math.min(cur.endT, T + dt * speed);
      if (T >= cur.endT) { playing = false; $('play').textContent = 'Start'; drawAll(true); }
      else drawAll();
      requestAnimationFrame(frame);
    }
  }
  function setPlaying(p) {
    if (p && T >= cur.endT) T = 0;
    playing = p; $('play').textContent = p ? 'Pause' : (T > 0 && T < cur.endT ? 'Resume' : 'Start');
    if (p) { lastTs = performance.now(); requestAnimationFrame(frame); } else drawAll(true);
  }

  /* ---------- SVG charts ---------- */
  function hourTicks(tEnd) { var out = [], step = tEnd > 30 * H ? 4 : 2, first = Math.ceil(T0 / H); for (var hh = first; hh * H - T0 <= tEnd; hh++) if (hh % step === 0) out.push(hh * H - T0); return out; }
  function lineChart(o) {
    var w = o.w || 900, h = o.h || 280, ml = o.compact ? 30 : 40, mr = 12, mt = 14, mb = 22, pw = w - ml - mr, ph = h - mt - mb, tEnd = o.tEnd, yMax = o.yMax;
    function X(t) { return ml + pw * t / tEnd; } function Y(v) { return mt + ph * (1 - v / yMax); }
    var s = '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(o.label || 'Line chart') + '">';
    var ys = o.compact ? 2 : 4;
    for (var i = 0; i <= ys; i++) { var v = Math.round(yMax / 1.08 * i / ys); s += '<line x1="' + ml + '" x2="' + (w - mr) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="var(--line)" stroke-width="1"/><text x="' + (ml - 5) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + v + '</text>'; }
    hourTicks(tEnd).forEach(function (t, i) { if (o.compact && i % 2) return; s += '<text x="' + X(t) + '" y="' + (h - 6) + '" text-anchor="middle">' + clk(t).slice(0, 5) + '</text>'; });
    (o.bands || []).forEach(function (b) { s += '<rect x="' + X(b.t0) + '" y="' + mt + '" width="' + Math.max(1, X(b.t1) - X(b.t0)) + '" height="' + ph + '" fill="' + b.color + '" fill-opacity=".12"/>'; });
    (o.hlines || []).forEach(function (l) { s += '<line x1="' + ml + '" x2="' + (w - mr) + '" y1="' + Y(l.v) + '" y2="' + Y(l.v) + '" stroke="var(--crit)" stroke-width="1.5" stroke-dasharray="5 4"/><text class="lbl" x="' + (w - mr - 2) + '" y="' + (Y(l.v) - 4) + '" text-anchor="end">' + esc(l.label) + '</text>'; });
    (o.marks || []).forEach(function (m, i) { s += '<line x1="' + X(m.t) + '" x2="' + X(m.t) + '" y1="' + mt + '" y2="' + (mt + ph) + '" stroke="var(--muted)" stroke-width="1" stroke-dasharray="2 3"/><text x="' + (X(m.t) + 3) + '" y="' + (mt + 10 + (i % 3) * 12) + '">' + esc(m.label) + '</text>'; });
    o.series.forEach(function (sr) {
      var d = ''; sr.pts.forEach(function (p, i) { d += (i ? 'H' + X(p[0]).toFixed(1) + 'V' : 'M' + X(p[0]).toFixed(1) + ',') + Y(p[1]).toFixed(1); }); d += 'H' + X(tEnd).toFixed(1);
      s += '<path d="' + d + '" fill="none" stroke="' + sr.color + '" stroke-width="2" stroke-linejoin="round"' + (sr.dash ? ' stroke-dasharray="' + sr.dash + '"' : '') + '/>';
    });
    if (o.cursor != null) s += '<line x1="' + X(o.cursor) + '" x2="' + X(o.cursor) + '" y1="' + mt + '" y2="' + (mt + ph) + '" stroke="var(--ink)" stroke-width="1.5"/>';
    if (!o.compact) {
      var step = tEnd / 96;
      for (var t = 0; t < tEnd; t += step) {
        var tip = clk(t + step / 2); o.series.forEach(function (sr) { var val = sr.pts[0][1]; for (var j = 0; j < sr.pts.length && sr.pts[j][0] <= t + step / 2; j++) val = sr.pts[j][1]; tip += '\n' + sr.name + ': ' + val; });
        s += '<rect class="hit" x="' + X(t) + '" y="' + mt + '" width="' + (pw * step / tEnd) + '" height="' + ph + '" fill="transparent" data-tip="' + esc(tip) + '"/>';
      }
    }
    return s + '</svg>';
  }
  /* grouped horizontal bars: rows = categories, one bar per series */
  function barChart(o) {
    var rowH = 15, gap = 12, ml = 190, mr = 56, w = o.w || 900, n = o.series.length, top = o.ref ? 20 : 6, h = o.cats.length * (n * (rowH + 2) + gap) + 20 + top, pw = w - ml - mr;
    var max = o.max || Math.max.apply(null, o.series.map(function (s) { return Math.max.apply(null, s.vals.map(function (v) { return v || 0; })); })) * 1.05 || 1;
    if (o.ref) max = Math.max(max, o.ref.v * 1.05);
    max = max > 8 ? Math.ceil(max / 4) * 4 : max;
    var s = '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(o.label || 'Bar chart') + '">', y = top;
    for (var g = 0; g <= 4; g++) { var gx = ml + pw * g / 4; s += '<line x1="' + gx + '" x2="' + gx + '" y1="0" y2="' + (h - 20) + '" stroke="var(--line)"/><text x="' + gx + '" y="' + (h - 6) + '" text-anchor="middle">' + num(max * g / 4, o.dec == null ? 0 : o.dec) + '</text>'; }
    if (o.ref) { var rx = ml + pw * o.ref.v / max; s += '<line x1="' + rx + '" x2="' + rx + '" y1="0" y2="' + (h - 20) + '" stroke="var(--crit)" stroke-dasharray="5 4" stroke-width="1.5"/><text class="lbl" x="' + (rx + 4) + '" y="10">' + esc(o.ref.label) + '</text>'; }
    o.cats.forEach(function (c, i) {
      s += '<text class="lbl" x="' + (ml - 8) + '" y="' + (y + n * (rowH + 2) / 2 + 3) + '" text-anchor="end">' + esc(c) + '</text>';
      o.series.forEach(function (sr) {
        var v = sr.vals[i], bw = v == null ? 0 : Math.max(1, pw * v / max);
        s += '<rect x="' + ml + '" y="' + y + '" width="' + bw + '" height="' + rowH + '" rx="3" fill="' + sr.color + '" data-tip="' + esc(c + '\n' + sr.name + ': ' + (v == null ? 'did not finish' : num(v, o.dec == null ? 1 : o.dec) + ' ' + (o.unit || ''))) + '"/>' +
          '<text class="lbl" x="' + (ml + bw + 5) + '" y="' + (y + rowH - 3.5) + '">' + (v == null ? 'n/a' : num(v, o.dec == null ? 1 : o.dec)) + '</text>';
        y += rowH + 2;
      });
      y += gap;
    });
    return s + '</svg>';
  }
  function legendHtml(items) { return '<div class="cl">' + items.map(function (i) { return '<span><i class="' + (i[2] || 'b') + '" style="background:' + i[1] + '"></i>' + esc(i[0]) + '</span>'; }).join('') + '</div>'; }

  /* ---------- exports ---------- */
  function saveFile(name, blob) {
    var use = window.claude && window.claude.use;
    if (use) {
      return window.claude.use('downloads').then(function (dl) {
        if (!dl) return fallback();
        return dl.save({ filename: name, data: blob }).then(function () { toast('Saved ' + name); }, function (e) { if (!e || e.code !== 'declined') toast('This view cannot save files (' + ((e && e.code) || 'unavailable') + ').'); });
      });
    }
    return fallback();
    function fallback() { try { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); toast('Saved ' + name); } catch (e) { toast('Could not save the file here.'); } }
  }
  function csv(rows) { return rows.map(function (r) { return r.map(function (c) { c = c == null ? '' : String(c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); }).join('\r\n'); }
  function saveCsv(name, rows) { saveFile(name, new Blob(['﻿' + csv(rows)], { type: 'text/csv' })); }
  function saveXlsx(name, sheets) {
    if (!window.XLSX) { toast('Excel library did not load; saving CSV instead.'); return saveCsv(name.replace(/\.xlsx$/, '.csv'), sheets[0][1]); }
    var wb = XLSX.utils.book_new(); sheets.forEach(function (s) { XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s[1]), s[0].slice(0, 31)); });
    saveFile(name, new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  }
  function eventRows(list) {
    var rows = [['Event ID', 'Start', 'End', 'Start (s)', 'End (s)', 'Duration (s)', 'Vessel', 'Equipment', 'Type', 'Operator', 'Activity', 'Origin', 'Destination', 'Container', 'Container status', 'Status before', 'Status after', 'BR change', 'BR occupancy', 'Result', 'Note']];
    list.forEach(function (e) { rows.push([e.id, clk(e.t0, 1), clk(e.t1, 1), Math.round(e.t0), Math.round(e.t1), Math.round(e.dur), e.vessel, e.eq, e.eqType, e.owner, e.activity, e.from, e.to, e.cid, e.cstatus, e.before, e.after, e.brDelta || '', e.brOcc, e.result, e.note]); });
    return rows;
  }

  /* ---------- page: process flow ---------- */
  function flow(steps) { return '<div class="flow">' + steps.map(function (s, i) { return (i ? '<span class="arr">→</span>' : '') + '<div class="step ' + s[0] + '"><b>' + s[1] + '</b><small>' + s[2] + '</small></div>'; }).join('') + '</div>'; }
  function renderFlow() {
    var m = function (k) { return mss(E.mean(D.activities[D.activities[k].proxyOf || k].obs)); };
    $('p-flow').innerHTML =
      '<div><h2>Process flow</h2><p class="sub">Each step is one event type in the engine. The stripe shows who owns the equipment: blue for 2GO, orange for NorthPort, green for the Reach Stacker, red for a rule that can hold work. Times are workbook averages.</p></div>' +
      '<div class="panel"><h3>A · Discharging and NorthPort pull-out</h3>' + flow([
        ['rule', 'BR slot reserved', 'Before a YT goes up the ramp a BR slot is held for its load. No slot, no trip.'],
        ['go2', 'Ramp ascent · ' + m('yt_ascend'), '2GO YT · shipside → vessel deck · one YT on the ramp at a time'],
        ['go2', 'Take container · ' + m('yt_take'), '2GO YT · on board'],
        ['go2', 'Ramp descent · ' + m('yt_descend'), '2GO YT · deck → shipside'],
        ['go2', 'Travel to BR · ' + mss(E.mean(D.activities.yt_travel_rt.obs) / 2), '2GO YT · ramp → BR · BR occupancy +1 or +2 on arrival'],
        ['go2', 'Return to ramp · ' + mss(E.mean(D.activities.yt_travel_rt.obs) / 2), '2GO YT · empty chassis']
      ]) + '<div style="height:8px"></div>' + flow([
        ['np', 'Pull out in BR · ' + m('rt_pullout'), 'NorthPort RT · oldest box first · BR occupancy −1 when it leaves'],
        ['np', 'PTB stop and inspection · ' + m('rt_ptb'), 'NorthPort RT · BR → PTB'],
        ['np', 'Hustle on Orange Road', 'Laden: 1.1 km to NorthPort. Empty: 300 m to the empty set-down.'],
        ['np', 'Set-down', 'Round trip incl. set-down ' + m('rt_tat') + ' laden (observed)'],
        ['np', 'Return', 'Laden trip in Option 1 brings an outbound box back. Otherwise empty chassis.']
      ]) + '</div>' +
      '<div class="panel"><h3>B · Container preparation and loading</h3><p class="eyebrow">Option 1 · NorthPort hustling</p>' + flow([
        ['np', 'RT returns laden', 'NorthPort RT · NorthPort → 2GO assigned area · MSK boxes first'],
        ['np', 'Drop at 2GO area', 'Box is staged and becomes available to a YT'],
        ['go2', 'YT hauls to shipside', '2GO YT · 2GO area → shipside'],
        ['go2', 'Ramp alignment and ascent', '2GO YT · waits if the ramp is in use'],
        ['go2', 'Place on board', '2GO YT · box becomes "Loaded on Vessel"'],
        ['go2', 'Ramp descent', '2GO YT · back to shipside for the next box']
      ]) + '<p class="eyebrow" style="margin-top:10px">Option 2 · Reach Stacker mounting</p>' + flow([
        ['np', 'RT returns with empty chassis', 'NorthPort RT · chassis left at the 2GO area'],
        ['rs', 'Reach Stacker mounts box', '2GO Reach Stacker · 3 min assumed, not timed'],
        ['go2', 'YT hauls to shipside', '2GO YT'],
        ['go2', 'Ramp, place, descend', 'Same loading sequence as Option 1']
      ]) + '</div>' +
      '<div class="panel"><h3>C · MLG arrival and the BR rule</h3>' + flow([
        ['', 'MLG arrives', 'MSK may still be working'],
        ['', 'Berthing and set-up', cur.params.vessels.MLG.setupMin + ' min assumed'],
        ['rule', 'BR space check', 'MLG may start discharging when free BR space ≥ MSK boxes still to discharge + ' + cur.params.mlgGate],
        ['go2', 'MLG YTs discharge to BR', 'Each trip still needs a free slot. MSK YTs are served first.'],
        ['np', 'RTs keep pulling out', 'Every pull-out frees one slot'],
        ['go2', 'MLG loading at Pier 4.2', 'Opens ' + cur.params.vessels.MLG.loadOffsetMin + ' min after discharge starts (observed gap)']
      ]) + '</div>' +
      '<div class="panel"><h3>Who does what</h3><div class="tw"><table><tr><th>Equipment</th><th>Operator</th><th>Units in this run</th><th>Work</th><th>Never does</th></tr>' +
      '<tr><td>Yard tractor (YT)</td><td>2GO</td><td>' + cur.equipment.filter(function (e) { return e.type === 'YT'; }).map(function (e) { return e.id + ' (' + e.vessel + ')'; }).join(', ') + '</td><td>Ramp work, vessel ↔ BR, 2GO area ↔ shipside</td><td>Leaves the pier; serves the other vessel</td></tr>' +
      '<tr><td>RT (hustling tractor)</td><td>NorthPort</td><td>' + cur.equipment.filter(function (e) { return e.type === 'RT'; }).map(function (e) { return e.id; }).join(', ') + '</td><td>BR pull-out, Orange Road, set-down, return load</td><td>Goes on the vessel ramp</td></tr>' +
      '<tr><td>Reach Stacker</td><td>2GO</td><td>' + cur.equipment.filter(function (e) { return e.type === 'RS'; }).map(function (e) { return e.id; }).join(', ') + '</td><td>Mounts boxes on chassis in Option 2</td><td>Travels</td></tr></table></div>' +
      '<p class="note" style="margin-top:8px">RT IDs 08, 10, 15 and 16 were seen in the workbook. "RT-U1" and "RT-U2" stand for the two RTs whose numbers were not recorded.</p></div>';
  }

  /* ---------- page: event log ---------- */
  var logF = { v: '', eq: '', kind: '', q: '', pg: 0 };
  function logFiltered() {
    var q = logF.q.toLowerCase();
    return cur.events.filter(function (e) {
      if (logF.v && e.vessel !== logF.v) return false;
      if (logF.eq && e.eq !== logF.eq && e.eqType !== logF.eq) return false;
      if (logF.kind === 'work' && !e.work) return false;
      if (logF.kind === 'held' && (e.work || e.result === 'completed')) return false;
      if (logF.kind === 'br' && !e.brDelta) return false;
      if (q && (e.activity + ' ' + e.cid + ' ' + e.note + ' ' + e.eq).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function renderLog() {
    var el = $('p-log');
    if (!el.dataset.built) {
      el.dataset.built = 1;
      el.innerHTML = '<div><h2>Event log</h2><p class="sub">Every activity, wait and idle period the engine produced, in time order. The map and every figure in this application are computed from these rows.</p></div>' +
        '<div class="panel"><div class="filters"><select id="lf-v" aria-label="Vessel"><option value="">All vessels</option><option>MSK</option><option>MLG</option><option value="PRE">Boxes already in BR</option></select>' +
        '<select id="lf-eq" aria-label="Equipment"></select><select id="lf-kind" aria-label="Event kind"><option value="">All events</option><option value="work">Work only</option><option value="held">Waiting, queued or blocked</option><option value="br">BR in / out only</option></select>' +
        '<input type="text" id="lf-q" placeholder="Search activity, container, note" aria-label="Search"><button id="lf-csv">Export CSV</button><button id="lf-br">Export BR series CSV</button><span class="note" id="lf-count"></span></div>' +
        '<div class="tw" style="max-height:560px;overflow-y:auto;margin-top:10px"><table id="lf-t"></table></div><div class="controls"><button id="lf-prev">Previous</button><button id="lf-next">Next</button><span class="note" id="lf-pg"></span></div></div>';
      ['v', 'eq', 'kind'].forEach(function (k) { $('lf-' + k).onchange = function () { logF[k] = this.value; logF.pg = 0; drawLog(); }; });
      $('lf-q').oninput = function () { logF.q = this.value; logF.pg = 0; drawLog(); };
      $('lf-prev').onclick = function () { logF.pg = Math.max(0, logF.pg - 1); drawLog(); };
      $('lf-next').onclick = function () { logF.pg++; drawLog(); };
      $('lf-csv').onclick = function () { saveCsv('pier4-event-log.csv', eventRows(logFiltered())); };
      $('lf-br').onclick = function () { saveCsv('pier4-br-occupancy.csv', [['Clock', 'Seconds', 'Occupied', 'Reserved', 'Capacity']].concat(cur.brSeries.map(function (s) { return [clk(s[0], 1), Math.round(s[0]), s[1], s[2], cur.br.capacity]; }))); };
    }
    $('lf-eq').innerHTML = '<option value="">All equipment</option><option value="YT">All YTs</option><option value="RT">All RTs</option>' + cur.equipment.map(function (e) { return '<option>' + e.id + '</option>'; }).join('');
    $('lf-eq').value = logF.eq; if ($('lf-eq').value !== logF.eq) logF.eq = '';
    drawLog();
  }
  function drawLog() {
    var list = logFiltered(), per = 150, pages = Math.max(1, Math.ceil(list.length / per)); logF.pg = Math.min(logF.pg, pages - 1);
    var h = '<tr><th>ID</th><th>Start</th><th>End</th><th class="n">Dur</th><th>Vessel</th><th>Equip.</th><th>Activity</th><th>From → To</th><th>Container</th><th>Status before → after</th><th class="n">BR</th><th>Result</th></tr>';
    list.slice(logF.pg * per, logF.pg * per + per).forEach(function (e) {
      h += '<tr><td class="n">' + e.id + '</td><td class="n">' + clk(e.t0, 1) + '</td><td class="n">' + clk(e.t1, 1) + '</td><td class="n">' + mss(e.dur) + '</td><td>' + e.vessel + '</td><td class="nw">' + e.eq + '</td><td>' + esc(e.activity) + (e.note ? '<br><span class="note">' + esc(e.note) + '</span>' : '') + '</td><td class="nw">' + e.from + (e.to !== e.from ? ' → ' + e.to : '') + '</td><td class="nw">' + esc(e.cid.replace('+', ' + ')) + (e.cstatus ? '<br><span class="note">' + e.cstatus + '</span>' : '') + '</td><td>' + e.before + ' → ' + e.after + '</td><td class="n">' + (e.brDelta ? (e.brDelta > 0 ? '+' : '') + e.brDelta + ' → ' + e.brOcc : '') + '</td><td>' + e.result + '</td></tr>';
    });
    $('lf-t').innerHTML = h; $('lf-count').textContent = list.length + ' of ' + cur.events.length + ' events';
    $('lf-pg').textContent = 'Page ' + (logF.pg + 1) + ' of ' + pages;
  }

  /* ---------- page: activity times ---------- */
  function usedValue(k) {
    var p = cur.params, a = D.activities[k];
    if (p.overrides[k] != null && p.overrides[k] !== '') return [+p.overrides[k], 'user-defined'];
    if (k === 'rt_tat_empty') { var t = usedValue('rt_tat')[0], h = p.npHandlingShare; return [t * (1 - h) * p.distEmpty / p.distLaden + t * h, 'derived']; }
    var o = a.proxyOf ? D.activities[a.proxyOf].obs : a.obs;
    if (!o.length) return [a.assumed, 'assumed'];
    return p.durMode === 'median' ? [E.median(o), 'median'] : (p.durMode === 'empirical' ? [E.mean(o), 'sampled from the observations (mean shown)'] : [E.mean(o), 'mean']);
  }
  function timesRows() {
    var rows = [['Activity', 'Equipment', 'Source worksheet and cells', 'Valid observations', 'Min (s)', 'Max (s)', 'Average (s)', 'Median (s)', 'Value used in this run (s)', 'Basis of value used', 'Class', 'Used by the model', 'Method', 'Reliability and limits']];
    Object.keys(D.activities).forEach(function (k) {
      var a = D.activities[k], o = a.proxyOf ? D.activities[a.proxyOf].obs : a.obs, s = E.stats(o), u = a.inModel === false ? ['', ''] : usedValue(k);
      rows.push([a.name, a.eq, a.src, s.n, s.n ? s.min : '', s.n ? s.max : '', s.n ? +s.mean.toFixed(1) : '', s.n ? s.median : '', u[0] === '' ? '' : +(+u[0]).toFixed(1), u[1], a.cls, a.inModel === false ? 'No (reference only)' : 'Yes',
        a.cls === 'observed' ? 'End reading minus start reading for each observation' : (a.cls === 'derived' ? 'Computed from observed values and the stated rule' : (a.proxyOf ? 'Proxy from another timed element' : 'Placeholder')),
        a.note + (a.excluded ? ' Excluded: ' + a.excluded.map(function (x) { return x.value + ' (' + x.why + ')'; }).join('; ') : '')]);
    });
    return rows;
  }
  function renderTimes() {
    var h = '<div><h2>Activity-time reference</h2><p class="sub">Durations come from the TMS workbook. Stopwatch cells are stored as h:mm in Excel and read here as minutes:seconds. Type a value in "Your value" to override an activity, then run again.</p></div><div class="panel"><div class="controls" style="margin:0 0 10px"><button id="tm-run" class="primary">Run with my values</button><button id="tm-clear">Clear my values</button><button id="tm-x">Export to Excel</button><span class="note">Duration model for this run: <b>' + cur.params.durMode + '</b> (change it under Scenario settings).</span></div><div class="tw"><table><tr><th>Activity</th><th>Source</th><th class="n">n</th><th class="n">Min</th><th class="n">Max</th><th class="n">Average</th><th class="n">Median</th><th class="n">Used (m:ss)</th><th>Your value (s)</th><th>Class</th><th>Reliability and limits</th></tr>';
    Object.keys(D.activities).forEach(function (k) {
      var a = D.activities[k], o = a.proxyOf ? D.activities[a.proxyOf].obs : a.obs, s = E.stats(o), inM = a.inModel !== false, u = inM ? usedValue(k) : null;
      h += '<tr><td><b>' + esc(a.name) + '</b><br><span class="note">' + a.eq + (inM ? '' : ' · reference only, not a model input') + '</span></td><td class="note">' + esc(a.src) + '</td><td class="n">' + s.n + '</td><td class="n">' + (s.n ? mss(s.min) : '–') + '</td><td class="n">' + (s.n ? mss(s.max) : '–') + '</td><td class="n">' + (s.n ? mss(s.mean) : '–') + '</td><td class="n">' + (s.n ? mss(s.median) : '–') + '</td><td class="n">' + (u ? mss(u[0]) + '<br><span class="note">' + u[1] + '</span>' : '–') + '</td><td>' + (inM && k !== 'rt_tat_congested' ? '<input type="number" min="1" step="1" id="ov-' + k + '" data-ov="' + k + '" value="' + (cur.params.overrides[k] != null ? cur.params.overrides[k] : '') + '" aria-label="Your value for ' + esc(a.name) + '">' : '') + '</td><td><span class="tag ' + a.cls + '">' + a.cls + '</span></td><td class="note" style="min-width:240px">' + esc(a.note) + (a.excluded ? ' Excluded: ' + esc(a.excluded.map(function (x) { return x.value + ' — ' + x.why; }).join('; ')) : '') + '</td></tr>';
    });
    h += '</table></div><p class="note" style="margin-top:8px">Observed = read from the workbook. Calculated = min, max, average and median of those readings. Derived = computed by a stated rule. Assumed = no record, needs validation. Variability is off unless the duration model is set to "empirical", which samples the listed observations with a fixed seed.</p></div>';
    var cyc = E.stats(D.activities.yt_cycle.obs), rtObs = E.mean(D.activities.rt_pullout.obs) + E.mean(D.activities.rt_ptb.obs) + E.mean(D.activities.rt_tat.obs);
    h += '<div class="panel"><h3>Cross-checks against the workbook</h3><div class="tw"><table><tr><th>Check</th><th class="n">Workbook</th><th class="n">This run</th><th>Reading</th></tr>' +
      '<tr><td>YT discharge cycle</td><td class="n">' + mss(cyc.mean) + ' (n=14)</td><td class="n">' + mss(cur.totals.ytCycle) + '</td><td>Simulated working time per YT trip, all trip types. Excludes time held at a full BR.</td></tr>' +
      '<tr><td>RT cycle, laden</td><td class="n">' + mss(rtObs) + '</td><td class="n">' + mss(cur.totals.rtCycle) + '</td><td>Workbook figure is the sum of the three timed elements.</td></tr>' +
      '<tr><td>NorthPort productivity</td><td class="n">30 boxes/h</td><td class="n">' + num(cur.br.clearRate) + ' /h</td><td>BR pull-outs per hour over the RT deployment in this run.</td></tr>' +
      '<tr><td>Six RTs at the timed cycle</td><td class="n">30 boxes/h</td><td class="n">' + num(6 * H / rtObs) + ' /h</td><td>6 × 3600 ÷ timed cycle. Supports the minutes:seconds reading.</td></tr></table></div></div>';
    $('p-times').innerHTML = h;
    $('tm-run').onclick = function () { var p = JSON.parse(JSON.stringify(activeParams())); p.overrides = {}; Array.prototype.forEach.call(document.querySelectorAll('[data-ov]'), function (i) { if (i.value !== '' && +i.value > 0) p.overrides[i.dataset.ov] = +i.value; }); setCustom(p); };
    $('tm-clear').onclick = function () { var p = JSON.parse(JSON.stringify(activeParams())); p.overrides = {}; setCustom(p); };
    $('tm-x').onclick = function () { saveXlsx('pier4-activity-times.xlsx', [['Activity times', timesRows()], ['Observations', [['Activity', 'Observations (s)']].concat(Object.keys(D.activities).map(function (k) { return [D.activities[k].name].concat(D.activities[k].obs); }))]]); };
  }

  /* ---------- page: equipment ---------- */
  function splitBar(q) {
    var parts = [['Working', q.busy, 'var(--s-2go)'], ['Blocked', q.blocked, 'var(--crit)'], ['Waiting / queued', q.wait + q.queued, 'var(--warn)'], ['Idle', q.idle, 'var(--idle)']];
    return '<div style="display:flex;gap:2px;height:14px;min-width:160px">' + parts.map(function (p) { var f = p[1] / q.window; return f > 0.002 ? '<div style="flex:' + f + ' 0 0;background:' + p[2] + ';border-radius:2px" data-tip="' + q.id + '\n' + p[0] + ': ' + hrs(p[1], 2) + ' (' + pct(f) + ')"></div>' : ''; }).join('') + '</div>';
  }
  function renderEquip() {
    var t = cur.totals, h = '<div><h2>Equipment productivity and utilisation</h2><p class="sub">Each unit is measured over the time it was deployed: YTs from the moment their vessel is ready to work until it sails, RTs from deployment until the run ends.</p></div>' +
      '<div class="tiles"><div class="tile"><span>YT utilisation</span><b>' + pct(t.ytUtil) + '</b><small>working ÷ deployed time</small></div><div class="tile"><span>RT utilisation</span><b>' + pct(t.rtUtil) + '</b><small>working ÷ deployed time</small></div><div class="tile"><span>YT productivity</span><b>' + num(t.ytPerHour) + '</b><small>units per YT-hour</small></div><div class="tile"><span>RT productivity</span><b>' + num(t.rtPerHour) + '</b><small>units per RT-hour</small></div><div class="tile"><span>YT hours blocked at BR</span><b>' + hrs(t.ytBlocked) + '</b><small>held for a BR slot</small></div><div class="tile"><span>YT hours waiting</span><b>' + hrs(t.ytWait) + '</b><small>for outbound boxes or the ramp</small></div></div>';
    h += '<div class="panel">' + legendHtml([['Working', 'var(--s-2go)'], ['Blocked (BR full or start not permitted)', 'var(--crit)'], ['Waiting or queued', 'var(--warn)'], ['Idle, no work', 'var(--idle)']]) + '<div class="tw"><table><tr><th>Unit</th><th>Operator</th><th>Vessel</th><th class="n">Trips</th><th class="n">Units</th><th class="n">Units / h</th><th class="n">Avg cycle</th><th class="n">Utilised</th><th class="n">Working</th><th class="n">Blocked</th><th class="n">Waiting</th><th class="n">Idle</th><th>Time split</th></tr>';
    cur.equipment.forEach(function (q) {
      h += '<tr><td class="nw"><b>' + q.id + '</b></td><td>' + q.owner + '</td><td>' + (q.vessel || 'both') + '</td><td class="n">' + q.trips + '</td><td class="n">' + q.units + '</td><td class="n">' + num(q.perHour) + '</td><td class="n">' + mss(q.cycle) + '</td><td class="n">' + pct(q.util) + '</td><td class="n">' + hrs(q.busy) + '</td><td class="n">' + hrs(q.blocked) + '</td><td class="n">' + hrs(q.wait + q.queued) + '</td><td class="n">' + hrs(q.idle) + '</td><td>' + splitBar(q) + '</td></tr>';
    });
    h += '</table></div><p class="note" style="margin-top:8px">How the figures are built: Units / h = units moved ÷ hours deployed. Avg cycle = working time ÷ trips. Utilised = working time ÷ deployed time. Blocked = held because BR had no free slot or MLG was not yet permitted to discharge. Waiting = no outbound box staged, ramp in use, or staging full. Idle = no work existed for the unit.</p></div>';
    var reasons = {};
    cur.events.forEach(function (e) { if (!e.work && e.dur > 0) { var k = e.eqType + ' · ' + e.note; reasons[k] = (reasons[k] || 0) + e.dur; } });
    h += '<div class="panel"><h3>Where the non-working time went</h3><div class="tw"><table><tr><th>Equipment · reason</th><th class="n">Unit-hours</th></tr>' + Object.keys(reasons).sort(function (a, b) { return reasons[b] - reasons[a]; }).map(function (k) { return '<tr><td>' + esc(k) + '</td><td class="n">' + num(reasons[k] / H, 1) + '</td></tr>'; }).join('') + '</table></div></div>';
    $('p-equip').innerHTML = h;
  }

  /* ---------- page: BR ---------- */
  function hourly() {
    var rows = [], n = Math.ceil(cur.endT / H);
    for (var i = 0; i < n; i++) {
      var a = i * H, b = a + H, inn = 0, out = 0;
      cur.events.forEach(function (e) { if (e.brDelta && e.t1 > a && e.t1 <= b) { if (e.brDelta > 0) inn += e.brDelta; else out -= e.brDelta; } });
      var occ = brAt(Math.min(b, cur.endT))[1], peak = 0; cur.brSeries.forEach(function (s) { if (s[0] >= a && s[0] <= b) peak = Math.max(peak, s[1]); }); peak = Math.max(peak, brAt(a)[1]);
      rows.push([clk(a) + ' – ' + clk(b).slice(0, 5), inn, out, occ, peak, occ / cur.br.capacity]);
    }
    return rows;
  }
  function renderBR() {
    var b = cur.br, marks = [];
    cur.vessels.forEach(function (v) { marks.push({ t: v.arrival, label: v.id + ' arrives' }); if (v.dStart != null) marks.push({ t: v.dStart, label: v.id + ' discharge starts' }); if (v.dEnd != null) marks.push({ t: v.dEnd, label: v.id + ' discharge ends' }); });
    var h = '<div><h2>BR congestion</h2><p class="sub">Capacity is counted in units, with 1 unit = 1 TEU = 1 box as the workbook does. A slot is also held for every load already on its way from the ramp, so BR counts as full when occupied plus reserved reaches capacity.</p></div>' +
      '<div class="tiles"><div class="tile"><span>Capacity</span><b>' + b.capacity + '</b><small>' + b.initial + ' already there at 19:00</small></div><div class="tile"><span>Peak occupancy</span><b>' + b.peak + '</b><small>' + pct(b.peakPct) + ' of capacity</small></div><div class="tile"><span>First full</span><b>' + clk(b.firstFull) + '</b><small>observed note: 01:35</small></div><div class="tile"><span>Time full</span><b>' + hrs(b.tFull) + '</b><small>no free slot</small></div><div class="tile"><span>Time above 90%</span><b>' + hrs(b.t90) + '</b></div><div class="tile"><span>Clearance rate</span><b>' + num(b.clearRate) + ' /h</b><small>pull-outs per hour</small></div><div class="tile"><span>BR cleared at</span><b>' + clk(b.cleared) + '</b><small>' + b.pulled + ' pulled out</small></div></div>' +
      '<div class="panel"><h3>BR occupancy over the run</h3><div class="chart">' + lineChart({ label: 'BR occupancy over time', series: [{ name: 'Occupied', color: 'var(--s-2go)', pts: cur.brSeries.map(function (s) { return [s[0], s[1]]; }) }], yMax: b.capacity * 1.08, hlines: [{ v: b.capacity, label: 'capacity ' + b.capacity }], marks: marks, tEnd: cur.endT }) + '</div></div>';
    var hr = hourly();
    h += '<div class="panel"><div class="controls" style="margin:0 0 8px;justify-content:space-between"><h3 style="margin:0">BR by clock hour, with NorthPort pull-outs</h3><button id="br-csv">Export CSV</button></div><div class="tw"><table><tr><th>Hour</th><th class="n">In from vessels</th><th class="n">Pulled out by RTs</th><th class="n">Occupied at end</th><th class="n">Peak in hour</th><th class="n">Utilised at end</th></tr>' + hr.map(function (r) { return '<tr><td class="n" style="text-align:left">' + r[0] + '</td><td class="n">' + r[1] + '</td><td class="n">' + r[2] + '</td><td class="n">' + r[3] + '</td><td class="n">' + r[4] + '</td><td class="n">' + pct(r[5]) + '</td></tr>'; }).join('') + '</table></div><p class="note" style="margin-top:8px">This is the hourly BR utilisation and RT productivity table left blank at the bottom of Sheet1 in the workbook (rows 72–76), filled from the model.</p></div>';
    $('p-br').innerHTML = h;
    $('br-csv').onclick = function () { saveCsv('pier4-br-hourly.csv', [['Hour', 'In from vessels', 'Pulled out by RTs', 'Occupied at end', 'Peak in hour', 'Utilised at end']].concat(hr.map(function (r) { return [r[0], r[1], r[2], r[3], r[4], Math.round(r[5] * 100) + '%']; }))); };
  }

  /* ---------- page: vessels ---------- */
  function gantt() {
    var act = D.actual, rows = [], tEnd = cur.endT;
    cur.vessels.forEach(function (v) {
      rows.push({ name: v.id + ' · model', a: v.arrival, r: v.readyAt, g: v.gateOpen, d0: v.dStart, d1: v.dEnd, l0: v.lStart, l1: v.lEnd, z: v.depart });
      var A = act[v.id]; rows.push({ name: v.id + ' · observed', a: parseActual(A.ata), d0: parseActual(A.dStart), d1: parseActual(A.dEnd), l0: parseActual(A.lStart), l1: parseActual(A.lEnd), z: parseActual(A.atd), obs: true });
    });
    rows.forEach(function (r) { tEnd = Math.max(tEnd, r.z || 0); });
    var w = 900, ml = 118, mr = 12, rh = 40, h = rows.length * rh + 26, pw = w - ml - mr;
    function X(t) { return ml + pw * t / tEnd; }
    var s = '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Vessel timelines, model against observed">';
    hourTicks(tEnd).forEach(function (t) { s += '<line x1="' + X(t) + '" x2="' + X(t) + '" y1="0" y2="' + (h - 20) + '" stroke="var(--line)"/><text x="' + X(t) + '" y="' + (h - 6) + '" text-anchor="middle">' + clk(t).slice(0, 5) + '</text>'; });
    rows.forEach(function (r, i) {
      var y = i * rh + 6, op = r.obs ? '.55' : '1';
      function bar(a, b, yy, hh, col, name) { if (a == null) return ''; if (b == null) b = tEnd; return '<rect x="' + X(a) + '" y="' + yy + '" width="' + Math.max(2, X(b) - X(a)) + '" height="' + hh + '" rx="3" fill="' + col + '" fill-opacity="' + op + '" data-tip="' + esc(r.name + '\n' + name + ': ' + clk(a) + ' – ' + clk(b) + ' (' + hrs(b - a) + ')') + '"/>'; }
      s += '<text class="lbl" x="' + (ml - 8) + '" y="' + (y + 17) + '" text-anchor="end">' + r.name + '</text>';
      s += bar(r.a, r.z, y + 12, 4, 'var(--idle)', 'In port');
      if (r.r != null && r.g != null && r.g > r.r) s += bar(r.r, r.g, y, 12, 'var(--crit)', 'Waiting for BR space');
      s += bar(r.d0, r.d1, y, 12, 'var(--v-a)', 'Discharging') + bar(r.l0, r.l1, y + 16, 12, 'var(--v-b)', 'Loading');
    });
    return s + '</svg>';
  }
  function renderVessels() {
    var act = D.actual, h = '<div><h2>Vessel performance</h2><p class="sub">Model results beside the times recorded in the workbook for MSK v78 and MLG v87. The observed rows are history; the model rows are projections from the rules and durations in this run.</p></div><div class="tiles">';
    cur.vessels.forEach(function (v) { h += '<div class="tile"><span>' + v.id + ' turnaround</span><b>' + hrs(v.turnaround) + '</b><small>observed ' + hrs(parseActual(act[v.id].atd) - parseActual(act[v.id].ata)) + ' · standard 11 h</small></div><div class="tile"><span>' + v.id + ' discharge rate</span><b>' + num(v.dRate) + ' /h</b><small>' + v.discharged + ' units</small></div><div class="tile"><span>' + v.id + ' loading rate</span><b>' + num(v.lRate) + ' /h</b><small>' + v.loaded + ' units</small></div>'; });
    h += '</div><div class="panel"><h3>Timeline</h3>' + legendHtml([['Discharging', 'var(--v-a)'], ['Loading', 'var(--v-b)'], ['Waiting for BR space', 'var(--crit)'], ['In port', 'var(--idle)']]) + '<div class="chart">' + gantt() + '</div><p class="note">Faded rows are the observed times.</p></div>';
    h += '<div class="panel"><h3>Milestones, model against observed</h3><div class="tw"><table><tr><th>Vessel</th><th>Milestone</th><th class="n">Model</th><th class="n">Observed</th><th class="n">Difference</th></tr>';
    cur.vessels.forEach(function (v) {
      var A = act[v.id];
      [['Arrival', v.arrival, A.ata], ['Ready to work', v.readyAt, null], ['Discharge permitted', v.gateOpen, null], ['Discharging starts', v.dStart, A.dStart], ['Discharging ends', v.dEnd, A.dEnd], ['Loading starts', v.lStart, A.lStart], ['Loading ends', v.lEnd, A.lEnd], ['Departure', v.depart, A.atd]].forEach(function (m) {
        var o = parseActual(m[2]), d = m[1] != null && o != null ? Math.round((m[1] - o) / 60) : null;
        h += '<tr><td>' + v.id + '</td><td>' + m[0] + '</td><td class="n">' + clk(m[1]) + '</td><td class="n">' + (o != null ? clk(o) : '–') + '</td><td class="n">' + (d == null ? '–' : (d > 0 ? '+' : '') + d + ' min') + '</td></tr>';
      });
      h += '<tr><td>' + v.id + '</td><td>Wait for BR space before discharge</td><td class="n">' + Math.round(v.gateWait / 60) + ' min</td><td class="n">–</td><td class="n">–</td></tr><tr><td>' + v.id + '</td><td>YT hours blocked at BR / waiting for boxes</td><td class="n">' + hrs(v.ytBlocked) + ' / ' + hrs(v.ytStarved) + '</td><td class="n">–</td><td class="n">–</td></tr><tr><td>' + v.id + '</td><td><b>Turnaround</b></td><td class="n"><b>' + hrs(v.turnaround, 2) + '</b></td><td class="n">' + hrs(parseActual(A.atd) - parseActual(A.ata), 2) + '</td><td class="n">' + (v.turnaround == null ? '–' : num((v.turnaround - (parseActual(A.atd) - parseActual(A.ata))) / H, 2) + ' h') + '</td></tr>';
    });
    h += '</table></div><p class="note" style="margin-top:8px">Why model and observed differ: the model works every YT at the timed pace from the first minute, so it fills BR sooner than the 01:35 noted; the loading elements are proxies; and the number of RTs that served MLG is not in the workbook. ' + esc(act.notes.mskDStartAlt) + ' ' + esc(act.notes.mskLStartAlt) + '</p></div>';
    $('p-vessels').innerHTML = h;
  }

  /* ---------- scenario runs ---------- */
  function scenarioSet() {
    var list = E.SCENARIOS.map(function (s) { return { name: s.name, desc: s.desc, r: run(E.merge(E.DEFAULTS, E.merge(s.p, { name: s.name }))) }; });
    if (custom) list.push({ name: 'Your settings', desc: 'The settings currently applied.', r: cur });
    return list;
  }
  function metricRows(list) {
    function v(r, id, f) { var x = r.vessels.filter(function (q) { return q.id === id; })[0]; return x[f]; }
    var defs = [
      ['MSK turnaround (h)', function (r) { return v(r, 'MSK', 'turnaround') == null ? null : v(r, 'MSK', 'turnaround') / H; }, 2],
      ['MLG turnaround (h)', function (r) { return v(r, 'MLG', 'turnaround') == null ? null : v(r, 'MLG', 'turnaround') / H; }, 2],
      ['MSK discharge start', function (r) { return clk(v(r, 'MSK', 'dStart')); }], ['MSK departure', function (r) { return clk(v(r, 'MSK', 'depart')); }],
      ['MLG discharge start', function (r) { return clk(v(r, 'MLG', 'dStart')); }], ['MLG wait for BR before start (min)', function (r) { return v(r, 'MLG', 'gateWait') / 60; }, 0], ['MLG departure', function (r) { return clk(v(r, 'MLG', 'depart')); }],
      ['Total containers handled', function (r) { return r.totals.handled; }, 0], ['Containers handled per hour', function (r) { return r.totals.perHour; }, 1],
      ['RT productivity (units per RT-hour)', function (r) { return r.totals.rtPerHour; }, 2], ['YT productivity (units per YT-hour)', function (r) { return r.totals.ytPerHour; }, 2],
      ['RT utilisation (%)', function (r) { return r.totals.rtUtil * 100; }, 0], ['YT utilisation (%)', function (r) { return r.totals.ytUtil * 100; }, 0],
      ['YT hours blocked at BR', function (r) { return r.totals.ytBlocked / H; }, 1], ['YT hours waiting', function (r) { return r.totals.ytWait / H; }, 1], ['YT hours idle', function (r) { return r.totals.ytIdle / H; }, 1], ['RT hours idle', function (r) { return r.totals.rtIdle / H; }, 1],
      ['BR peak occupancy', function (r) { return r.br.peak; }, 0], ['BR hours full', function (r) { return r.br.tFull / H; }, 2], ['BR hours above 90%', function (r) { return r.br.t90 / H; }, 2], ['BR clearance (pull-outs per hour)', function (r) { return r.br.clearRate; }, 1],
      ['Validation checks passed', function (r) { return r.checks.filter(function (c) { return c.ok; }).length + ' / ' + r.checks.length; }]
    ];
    return defs.map(function (d) { return [d[0]].concat(list.map(function (s) { var x = d[1](s.r); return typeof x === 'number' ? +x.toFixed(d[2] == null ? 1 : d[2]) : (x == null ? 'did not finish' : x); })); });
  }
  function renderScen() {
    var list = scenarioSet(), rows = metricRows(list), base = list[0].r;
    var cats = list.map(function (s) { return s.name; });
    function tat(id) { return list.map(function (s) { var x = s.r.vessels.filter(function (q) { return q.id === id; })[0].turnaround; return x == null ? null : x / H; }); }
    var h = '<div><h2>Scenario comparison</h2><p class="sub">All scenarios are model projections run with the same engine, durations and seed, so differences come only from the setting that was changed. None of these rows is historical performance.</p></div>' +
      '<div class="panel"><h3>What each scenario changes</h3><div class="tw"><table>' + list.map(function (s) { return '<tr><td class="nw"><b>' + esc(s.name) + '</b></td><td>' + esc(s.desc) + '</td></tr>'; }).join('') + '</table></div></div>' +
      '<div class="grid g2"><div class="panel"><h3>Vessel turnaround, hours</h3>' + legendHtml([['MSK', 'var(--v-a)'], ['MLG', 'var(--v-b)']]) + '<div class="chart">' + barChart({ label: 'Turnaround by scenario', cats: cats, series: [{ name: 'MSK', color: 'var(--v-a)', vals: tat('MSK') }, { name: 'MLG', color: 'var(--v-b)', vals: tat('MLG') }], unit: 'h', dec: 1, ref: { v: 11, label: 'standard 11 h' }, w: 620 }) + '</div></div>' +
      '<div class="panel"><h3>Hours BR was full</h3><div class="chart">' + barChart({ label: 'Hours BR full by scenario', cats: cats, series: [{ name: 'BR full', color: 'var(--s-2go)', vals: list.map(function (s) { return s.r.br.tFull / H; }) }], unit: 'h', dec: 1, w: 620 }) + '</div><h3 style="margin-top:10px">Containers handled per hour</h3><div class="chart">' + barChart({ label: 'Handled per hour by scenario', cats: cats, series: [{ name: 'Handled per hour', color: 'var(--s-2go)', vals: list.map(function (s) { return s.r.totals.perHour; }) }], unit: '/h', dec: 1, w: 620 }) + '</div></div></div>' +
      '<div class="panel"><h3>BR occupancy by scenario</h3><div class="grid g2">' + list.map(function (s) { return '<div><div class="note"><b>' + esc(s.name) + '</b> · peak ' + s.r.br.peak + ', full ' + hrs(s.r.br.tFull) + '</div><div class="chart">' + lineChart({ series: [{ name: 'Occupied', color: 'var(--s-2go)', pts: s.r.brSeries.map(function (x) { return [x[0], x[1]]; }) }], yMax: s.r.br.capacity * 1.08, hlines: [{ v: s.r.br.capacity, label: 'capacity' }], tEnd: Math.max.apply(null, list.map(function (q) { return q.r.endT; })), w: 620, h: 150, compact: true }) + '</div></div>'; }).join('') + '</div></div>' +
      '<div class="panel"><div class="controls" style="margin:0 0 8px;justify-content:space-between"><h3 style="margin:0">Summary table</h3><button id="sc-x">Export to Excel</button></div><div class="tw"><table><tr><th>Metric</th>' + cats.map(function (c) { return '<th class="n">' + esc(c) + '</th>'; }).join('') + '</tr>' + rows.map(function (r) { return '<tr><td>' + r[0] + '</td>' + r.slice(1).map(function (x, i) { var b = r[1]; var d = i > 0 && typeof x === 'number' && typeof b === 'number' && x !== b ? ' <span class="note">(' + (x > b ? '+' : '') + (+(x - b).toFixed(2)) + ')</span>' : ''; return '<td class="n">' + x + d + '</td>'; }).join('') + '</tr>'; }).join('') + '</table></div><p class="note" style="margin-top:8px">Figures in brackets are the change from the baseline. A scenario is an improvement only where these numbers say so.</p></div>';
    $('p-scen').innerHTML = h; void base;
    $('sc-x').onclick = function () { saveXlsx('pier4-scenario-comparison.xlsx', [['Scenario comparison', [['Metric'].concat(cats)].concat(rows)], ['Scenario definitions', [['Scenario', 'Change']].concat(list.map(function (s) { return [s.name, s.desc]; }))]]); };
  }

  /* ---------- page: findings ---------- */
  function analysis() {
    var p = activeParams(), k = function (o) { var q = E.merge(p, o); q.name = p.name; return run(q); };
    var a = { base: cur };
    a.openBR = k({ brCapacity: 100000, mlgGate: 0 });
    a.rt = []; for (var n = Math.max(2, p.rtCount - 2); n <= p.rtCount + 6; n++) a.rt.push({ n: n, r: k({ rtCount: n }) });
    a.yt = [0, 1, 2].map(function (d) { return { d: d, r: k({ vessels: { MSK: { ytCount: p.vessels.MSK.ytCount + d }, MLG: { ytCount: p.vessels.MLG.ytCount + d } } }) }; });
    a.pre = k({ rtDeploy: 'arrival' });
    a.br = [p.brCapacity, p.brCapacity + 40, p.brCapacity + 80].map(function (c) { return { c: c, r: k({ brCapacity: c }) }; });
    a.both = k({ rtDeploy: 'arrival', rtCount: p.rtCount + 2 });
    return a;
  }
  function vt(r, id) { return r.vessels.filter(function (q) { return q.id === id; })[0]; }
  function findingsModel() {
    var a = analysis(), r = cur, t = r.totals, F = [], msk = vt(r, 'MSK'), mlg = vt(r, 'MLG');
    function dh(x, y) { return x == null || y == null ? 'n/a' : (x - y >= 0 ? '+' : '') + ((x - y) / H).toFixed(1) + ' h'; }
    var rt2 = a.rt.filter(function (x) { return x.n === r.params.rtCount + 2; })[0].r, yt1 = a.yt[1].r;
    var constraint = t.rtUtil > t.ytUtil + 0.1 ? 'the NorthPort RT fleet' : (t.ytUtil > t.rtUtil + 0.1 ? 'the 2GO YT and ramp cycle' : 'shared between RTs and YTs');
    F.push({ q: '1. Where is the operational bottleneck?', a: 'In this run the constraint is ' + constraint + '.', pts: [
      'RTs worked ' + pct(t.rtUtil) + ' of their deployed time; YTs worked ' + pct(t.ytUtil) + '.',
      'YTs lost ' + hrs(t.ytBlocked) + ' held at a full BR and ' + hrs(t.ytWait) + ' waiting for outbound boxes or the ramp. Both waits end only when an RT completes a trip.',
      r.params.rtCount + ' RTs at the simulated ' + mss(t.rtCycle) + ' cycle clear ' + num(r.br.clearRate) + ' boxes an hour. MSK\'s ' + r.params.vessels.MSK.ytCount + ' YTs at the timed cycle can deliver about ' + num(r.params.vessels.MSK.ytCount * H / E.mean(D.activities.yt_cycle.obs) * r.params.unitsPerYtTrip, 0) + ' an hour, so BR fills from ' + r.br.initial + ' to ' + r.br.capacity + ' and discharge then runs at RT pace.',
      'Test: one more YT per vessel changes MSK turnaround by ' + dh(vt(yt1, 'MSK').turnaround, msk.turnaround) + ' and MLG by ' + dh(vt(yt1, 'MLG').turnaround, mlg.turnaround) + '. Two more RTs change them by ' + dh(vt(rt2, 'MSK').turnaround, msk.turnaround) + ' and ' + dh(vt(rt2, 'MLG').turnaround, mlg.turnaround) + '.'] });
    var freeAtReady = (function () { var s = r.brSeries, v = s[0]; for (var i = 0; i < s.length && s[i][0] <= mlg.readyAt; i++) v = s[i]; return r.br.capacity - v[1] - v[2]; })();
    var o = vt(a.openBR, 'MLG');
    F.push({ q: '2. Why is MLG delayed from commencing discharging?', a: mlg.gateWait > 60 ? 'MLG was ready at ' + clk(mlg.readyAt) + ' but was held ' + Math.round(mlg.gateWait / 60) + ' minutes because BR did not have the space the start rule requires.' : 'In this run MLG was not held at the start: BR had ' + freeAtReady + ' free units when MLG was ready at ' + clk(mlg.readyAt) + '. BR slows MLG during discharge instead.', pts: [
      'Start rule in the model: free BR space must cover MSK\'s remaining discharge plus ' + r.params.mlgGate + ' units. The threshold is an assumption.',
      'MLG YTs spent ' + hrs(mlg.ytBlocked) + ' held for a BR slot. MLG discharge finished at ' + clk(mlg.dEnd) + '; with unlimited BR space it would finish at ' + clk(o.dEnd) + ' (' + dh(mlg.dEnd, o.dEnd) + ' attributable to BR).',
      'BR is full because pull-out runs at ' + num(r.br.clearRate) + ' an hour while MSK and then MLG can discharge faster than that, and BR starts with ' + r.br.initial + ' of ' + r.br.capacity + ' already used.',
      'Observed: MLG started 79 minutes after arrival, with "Full BR" noted at 01:35 and MSK discharge ending at 02:27. The records cannot split those 79 minutes between set-up and waiting for BR.'] });
    var std = 11 * H, need = a.rt.filter(function (x) { return x.r.complete && x.r.vessels.every(function (v) { return v.turnaround <= std; }); })[0];
    var flat = null; for (var i = 1; i < a.rt.length; i++) { var d = vt(a.rt[i - 1].r, 'MLG').turnaround - vt(a.rt[i].r, 'MLG').turnaround; if (a.rt[i].n > r.params.rtCount && d < 0.25 * H && flat == null) flat = a.rt[i - 1].n; }
    F.push({ q: '3. How much additional equipment is actually required, if any?', a: (need ? (need.n <= r.params.rtCount ? 'No more RTs are needed to meet the 11-hour standard under these settings.' : 'About ' + (need.n - r.params.rtCount) + ' more RTs (' + need.n + ' in total) bring both vessels inside the 11-hour standard port stay.') : 'No RT count in the tested range brings both vessels inside the 11-hour standard.') + ' More YTs are not required.', pts: [
      'RT count against turnaround is in the table below. ' + (flat ? 'Beyond ' + flat + ' RTs the gain per added RT falls under 15 minutes for MLG, because the YT and ramp cycle becomes the limit.' : ''),
      'Adding YTs while RTs stay at ' + r.params.rtCount + ' moves turnaround by ' + dh(vt(a.yt[1].r, 'MLG').turnaround, mlg.turnaround) + ' (+1 each) and ' + dh(vt(a.yt[2].r, 'MLG').turnaround, mlg.turnaround) + ' (+2 each) for MLG. The extra YTs add waiting time.',
      'These counts depend on the 11–12 minute hustle turnaround. If the 40–45 minute turnaround seen during two-vessel work is real travel and not waiting, the requirement is far higher; see the congested-hustling scenario.'],
      table: [['RTs deployed', 'MSK turnaround', 'MLG turnaround', 'BR hours full', 'RT utilised']].concat(a.rt.map(function (x) { return [x.n + (x.n === r.params.rtCount ? ' (this run)' : ''), hrs(vt(x.r, 'MSK').turnaround), hrs(vt(x.r, 'MLG').turnaround), hrs(x.r.br.tFull), pct(x.r.totals.rtUtil)]; })) });
    F.push({ q: '4. How can BR congestion be reduced?', a: 'Raise the pull-out rate or start it earlier. Space alone delays the problem without removing it.', pts: [
      'Two more RTs: BR full for ' + hrs(rt2.br.tFull) + ' instead of ' + hrs(r.br.tFull) + '.',
      'Start pulling the ' + r.br.initial + ' boxes at MSK arrival instead of at discharge start: BR full for ' + hrs(a.pre.br.tFull) + ', first full at ' + clk(a.pre.br.firstFull) + ' instead of ' + clk(r.br.firstFull) + '. This costs no equipment.',
      'Both together: BR full for ' + hrs(a.both.br.tFull) + '; MSK ' + hrs(vt(a.both, 'MSK').turnaround) + ', MLG ' + hrs(vt(a.both, 'MLG').turnaround) + ' turnaround.',
      'More BR space with the same RTs: ' + a.br.slice(1).map(function (x) { return x.c + ' units gives BR full ' + hrs(x.r.br.tFull) + ', MLG turnaround ' + hrs(vt(x.r, 'MLG').turnaround); }).join('; ') + '.'] });
    F.push({ q: '5. What measurable impact will the improvements have?', a: 'Projected change against this run, same durations and volumes.', pts: [],
      table: [['Change', 'MSK turnaround', 'MLG turnaround', 'Handled per hour', 'BR hours full']].concat([['This run', r], ['Two more RTs', rt2], ['One more YT per vessel', yt1], ['Pull out from MSK arrival', a.pre], ['Two more RTs and early pull-out', a.both]].map(function (x) { var q = x[1]; return [x[0], hrs(vt(q, 'MSK').turnaround) + (q === r ? '' : ' (' + dh(vt(q, 'MSK').turnaround, msk.turnaround) + ')'), hrs(vt(q, 'MLG').turnaround) + (q === r ? '' : ' (' + dh(vt(q, 'MLG').turnaround, mlg.turnaround) + ')'), num(q.totals.perHour), hrs(q.br.tFull)]; })) });
    return F;
  }
  function renderFind() {
    var F = findingsModel();
    var h = '<div><h2>Findings for management</h2><p class="sub">Answers are written from the current run (' + esc(cur.params.name) + ') and extra runs made with one setting changed. They are model projections. The data gaps on the last page limit how far they can be relied on, most of all the hustle turnaround during two-vessel work.</p><div class="controls"><button id="fd-pdf">Save management report as PDF</button></div></div>';
    F.forEach(function (f) {
      h += '<div class="panel finding"><h3>' + esc(f.q) + '</h3><p><b>' + esc(f.a) + '</b></p>' + (f.pts.length ? '<ul class="tight">' + f.pts.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' : '') + (f.table ? '<div class="tw"><table>' + f.table.map(function (r, i) { return '<tr>' + r.map(function (c, j) { return i ? '<td class="' + (j ? 'n' : '') + '">' + esc(c) + '</td>' : '<th class="' + (j ? 'n' : '') + '">' + esc(c) + '</th>'; }).join('') + '</tr>'; }).join('') + '</table></div>' : '') + '</div>';
    });
    $('p-find').innerHTML = h;
    $('fd-pdf').onclick = function () { pdfReport(F); };
  }
  function pdfReport(F) {
    if (!window.jspdf) return toast('PDF library did not load.');
    var doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' }), y = 50, W = 515, L = 40;
    function clean(s) { return String(s).replace(/[–—]/g, '-').replace(/→/g, '->').replace(/≥/g, '>=').replace(/÷/g, '/').replace(/×/g, 'x').replace(/′/g, "'").replace(/[^\x00-\xff]/g, ''); }
    function line(txt, size, bold, indent) { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.splitTextToSize(clean(txt), W - (indent || 0)).forEach(function (l) { if (y > 790) { doc.addPage(); y = 50; } doc.text(l, L + (indent || 0), y); y += size * 1.35; }); }
    function table(rows) { var cw = W / rows[0].length; rows.forEach(function (r, i) { if (y > 780) { doc.addPage(); y = 50; } doc.setFont('helvetica', i ? 'normal' : 'bold'); doc.setFontSize(8.5); r.forEach(function (c, j) { doc.text(doc.splitTextToSize(clean(c), cw - 6)[0], L + j * cw, y); }); y += 12; }); y += 6; }
    line('Pier 4 Digital Twin: management report', 16, true); line('MSK v78 and MLG v87 · scenario: ' + cur.params.name + ' · model projection, not historical performance', 9); y += 8;
    line('Vessel results', 12, true);
    table([['Vessel', 'Arrival', 'Discharge', 'Loading', 'Departure', 'Turnaround']].concat(cur.vessels.map(function (v) { return [v.id, clk(v.arrival), clk(v.dStart) + ' - ' + clk(v.dEnd), clk(v.lStart) + ' - ' + clk(v.lEnd), clk(v.depart), hrs(v.turnaround, 2)]; })));
    line('Backreach: peak ' + cur.br.peak + ' of ' + cur.br.capacity + ', full for ' + hrs(cur.br.tFull) + ', first full at ' + clk(cur.br.firstFull) + ', clearance ' + num(cur.br.clearRate) + ' per hour.', 9.5);
    line('Equipment: RT utilisation ' + pct(cur.totals.rtUtil) + ', YT utilisation ' + pct(cur.totals.ytUtil) + ', YT hours blocked at BR ' + hrs(cur.totals.ytBlocked) + ', YT hours waiting ' + hrs(cur.totals.ytWait) + '.', 9.5); y += 8;
    F.forEach(function (f) { line(f.q, 12, true); line(f.a, 10, true); f.pts.forEach(function (p) { line('- ' + p, 9.5, false, 8); }); if (f.table) { y += 4; table(f.table); } y += 6; });
    line('Validation checks', 12, true); cur.checks.forEach(function (c) { line((c.ok ? 'PASS  ' : 'FAIL  ') + c.name + ': ' + c.detail, 9); }); y += 8;
    line('Data gaps and assumptions', 12, true); D.gaps.forEach(function (g) { line('[' + g.sev + '] ' + g.item + ': ' + g.detail, 9); });
    saveFile('pier4-management-report.pdf', doc.output('blob'));
  }

  /* ---------- page: data & assumptions ---------- */
  function renderData() {
    var p = cur.params, h = '<div><h2>Data, assumptions and validation</h2><p class="sub">What the source files contain, what had to be assumed, and whether this run passes its own integrity checks.</p></div>';
    h += '<div class="panel"><h3>Validation checks for this run</h3><div class="tw"><table><tr><th>Check</th><th>Result</th></tr>' + cur.checks.map(function (c) { return '<tr><td class="' + (c.ok ? 'ok' : 'bad') + '">' + esc(c.name) + '</td><td>' + esc(c.detail) + '</td></tr>'; }).join('') + '</table></div><h3 style="margin-top:12px">Where every container ended up</h3><div class="tw"><table><tr><th>Final location / state</th><th class="n">Containers</th></tr>' + Object.keys(cur.byState).map(function (k) { return '<tr><td>' + k + '</td><td class="n">' + cur.byState[k] + '</td></tr>'; }).join('') + '<tr><td><b>Total tracked</b></td><td class="n"><b>' + cur.containers.length + '</b></td></tr></table></div></div>';
    h += '<div class="panel"><h3>Data gaps and what is needed to close them</h3><div class="tw"><table><tr><th>Priority</th><th>Gap</th><th>How the model handles it</th><th>Needed from operations</th></tr>' + D.gaps.map(function (g) { return '<tr><td><span class="pill ' + (g.sev === 'High' ? 'crit' : (g.sev === 'Medium' ? 'warn' : '')) + '">' + g.sev + '</span></td><td><b>' + esc(g.item) + '</b></td><td>' + esc(g.detail) + '</td><td>' + esc(g.need) + '</td></tr>'; }).join('') + '</table></div></div>';
    var ass = [
      ['BR capacity', p.brCapacity + ' units', 'observed', 'Sheet1!C57'], ['BR occupancy at 19:00', p.brInitial + ' units', 'observed', 'Sheet1!B1'], ['MSK arrival / set-up', clk(p.vessels.MSK.arrivalMin * 60) + ' / ' + p.vessels.MSK.setupMin + ' min', 'observed', 'Sheet1!A7:A8'],
      ['MLG arrival', clk(p.vessels.MLG.arrivalMin * 60), 'observed', 'Sheet1!A12'], ['MLG set-up', p.vessels.MLG.setupMin + ' min', 'assumed', 'Upper bound 79 min from Sheet1!A12:A14'],
      ['Loading opens after discharge start', 'MSK ' + p.vessels.MSK.loadOffsetMin + ' min, MLG ' + p.vessels.MLG.loadOffsetMin + ' min', 'derived', 'Sheet1 timeline gaps'], ['Departure after last move', 'MSK ' + p.vessels.MSK.departMin + ' min, MLG ' + p.vessels.MLG.departMin + ' min', 'derived', 'Sheet1 timeline gaps'],
      ['Units per YT trip', p.unitsPerYtTrip, 'derived', '18 container numbers over 14 trips'], ['Units per RT trip', 1, 'assumed', 'Consistent with 30 boxes/h for 6 RTs'], ['BR space MLG needs to start', 'MSK remaining + ' + p.mlgGate, 'assumed', 'No documented rule'],
      ['RTs deployed from', p.rtDeploy === 'arrival' ? 'first vessel arrival' : 'first discharge start', 'assumed', 'BR still held 43 at MSK arrival'], ['RT spacing', p.rtStagger ? 'evenly spaced over one cycle' : 'all start together', 'assumed', 'Avoids an artificial six-RT convoy'], ['RT set-down share of turnaround', pct(p.npHandlingShare), 'assumed', 'Elements not dissected'],
      ['Ramp capacity', '1 YT at a time', 'assumed', 'Obs 4/5 overlap on the Discharging sheet suggests queueing'], ['Laden / empty distance', p.distLaden + ' m / ' + p.distEmpty + ' m one way', 'observed', 'Master prompt §3'], ['Staging limit at 2GO area', p.stagingCap || 'none', 'assumed', 'Not documented']
    ];
    h += '<div class="panel"><h3>Parameters in this run</h3><div class="tw"><table><tr><th>Parameter</th><th>Value</th><th>Class</th><th>Basis</th></tr>' + ass.map(function (a) { return '<tr><td>' + a[0] + '</td><td class="mono">' + a[1] + '</td><td><span class="tag ' + a[2] + '">' + a[2] + '</span></td><td class="note">' + a[3] + '</td></tr>'; }).join('') + '</table></div></div>';
    h += '<div class="grid g2"><div class="panel"><h3>Facts taken from the sources</h3><div class="tw"><table><tr><th>Item</th><th>Value</th><th>Source</th></tr>' + D.facts.map(function (f) { return '<tr><td>' + esc(f.k) + '</td><td>' + esc(f.v) + '</td><td class="note">' + esc(f.src) + '</td></tr>'; }).join('') + '</table></div></div>' +
      '<div class="panel"><h3>Source inventory</h3><div class="tw"><table><tr><th>File</th><th>Content</th><th>Use</th></tr><tr><td>TMS-Vessel_Ops_Activity.xlsx</td><td>Discharging (14 timed YT trips), Loading (1 partial), Hustling and Hustling (2) (8 RT trips; the two sheets are near-identical), Sheet1 (vessel timeline, volumes, equipment, BR)</td><td>All durations, volumes, fleet sizes, timeline</td></tr><tr><td>TMS_DIGITAL_TWIN_1st_Build.docx</td><td>Master prompt with workflow rules and route distances; one embedded satellite image, no labels</td><td>Process logic, distances, map background</td></tr></table></div></div></div>';
    h += '<div class="panel"><h3>Data dictionary</h3><div class="tw"><table><tr><th>Field</th><th>Description</th><th>Source file</th><th>Worksheet / field</th><th>Data type</th></tr>' + D.dictionary.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table></div></div>';
    h += '<div class="panel"><h3>Container states the engine enforces</h3><div class="tw"><table><tr><th>From</th><th>May move to</th></tr>' + Object.keys(E.TRANSITIONS).map(function (k) { return '<tr><td>' + k + '</td><td>' + E.TRANSITIONS[k].join(', ') + '</td></tr>'; }).join('') + '</table></div><p class="note" style="margin-top:8px">Any other move is recorded as a violation and fails the validation check above.</p></div>';
    $('p-data').innerHTML = h;
  }

  /* ---------- scenario settings form ---------- */
  var FIELDS = [
    ['Equipment', [['rtCount', 'NorthPort RTs', 1, 20, 1], ['vessels.MSK.ytCount', 'MSK yard tractors', 1, 10, 1], ['vessels.MLG.ytCount', 'MLG yard tractors', 1, 10, 1], ['rsCount', 'Reach Stackers', 0, 5, 1], ['unitsPerYtTrip', 'Units per YT trip', 1, 2, 0.01]]],
    ['Backreach', [['brCapacity', 'BR capacity (units)', 10, 2000, 1], ['brInitial', 'In BR at 19:00', 0, 2000, 1], ['mlgGate', 'Free space MLG needs to start', 0, 500, 1], ['stagingCap', '2GO staging limit (0 = none)', 0, 500, 1]]],
    ['MSK v78', [['vessels.MSK.arrivalMin', 'Arrival', 'time'], ['vessels.MSK.setupMin', 'Berthing and set-up (min)', 0, 600, 1], ['vessels.MSK.discharge', 'Discharge (units)', 0, 1000, 1], ['vessels.MSK.empties', 'of which empty', 0, 1000, 1], ['vessels.MSK.load', 'Loading (units)', 0, 1000, 1]]],
    ['MLG v87', [['vessels.MLG.arrivalMin', 'Arrival', 'time'], ['vessels.MLG.setupMin', 'Berthing and set-up (min)', 0, 600, 1], ['vessels.MLG.discharge', 'Discharge (units)', 0, 1000, 1], ['vessels.MLG.empties', 'of which empty', 0, 1000, 1], ['vessels.MLG.load', 'Loading (units)', 0, 1000, 1]]],
    ['Rules', [['sourcing', 'Outbound boxes come from', 'sel', [['hustle', 'Option 1 · NorthPort hustling'], ['rs', 'Option 2 · Reach Stacker']]], ['ytPriority', 'YT priority', 'sel', [['discharge', 'Discharge first'], ['loading', 'Loading first'], ['balanced', 'Alternate']]], ['rtDeploy', 'RTs start pulling out', 'sel', [['discharge', 'When discharge starts'], ['arrival', 'When MSK arrives']]], ['rtCongested', 'Hustle time while both vessels work', 'sel', [['false', 'Timed 11–12 min'], ['true', 'Wall-clock 40–45 min']]], ['durMode', 'Duration model', 'sel', [['mean', 'Fixed average'], ['median', 'Median'], ['empirical', 'Empirical (sampled, seeded)']]], ['seed', 'Random seed', 1, 9999, 1]]]
  ];
  function getP(o, path) { return path.split('.').reduce(function (a, k) { return a[k]; }, o); }
  function setP(o, path, v) { var ks = path.split('.'), l = ks.pop(); ks.reduce(function (a, k) { return a[k]; }, o)[l] = v; }
  function fillParams() {
    var p = activeParams(), h = '';
    FIELDS.forEach(function (g) {
      h += '<fieldset><legend>' + g[0] + '</legend>';
      g[1].forEach(function (f) {
        var id = 'f-' + f[0].replace(/\./g, '-'), v = getP(p, f[0]);
        if (f[2] === 'sel') h += '<label for="' + id + '">' + f[1] + '<select id="' + id + '" data-f="' + f[0] + '">' + f[3].map(function (o) { return '<option value="' + o[0] + '"' + (String(v) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>';
        else if (f[2] === 'time') { var m = (T0 / 60 + v) % 1440; h += '<label for="' + id + '">' + f[1] + '<input type="time" id="' + id + '" data-f="' + f[0] + '" data-t="1" value="' + String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0') + '"></label>'; }
        else h += '<label for="' + id + '">' + f[1] + '<input type="number" id="' + id + '" data-f="' + f[0] + '" min="' + f[2] + '" max="' + f[3] + '" step="' + f[4] + '" value="' + v + '"></label>';
      });
      h += '</fieldset>';
    });
    $('params').innerHTML = h;
  }
  function readParams() {
    var p = JSON.parse(JSON.stringify(activeParams()));
    Array.prototype.forEach.call(document.querySelectorAll('#params [data-f]'), function (i) {
      var k = i.dataset.f, v;
      if (i.dataset.t) { var hm = (i.value || '00:00').split(':'); v = ((+hm[0]) * 60 + (+hm[1]) - T0 / 60 + 1440) % 1440; }
      else if (i.tagName === 'SELECT') v = i.value === 'true' ? true : (i.value === 'false' ? false : i.value);
      else { v = +i.value; if (isNaN(v)) v = +i.min; v = Math.max(+i.min, Math.min(+i.max, v)); if (+i.step === 1) v = Math.round(v); }
      setP(p, k, v);
    });
    ['MSK', 'MLG'].forEach(function (id) { p.vessels[id].empties = Math.min(p.vessels[id].empties, p.vessels[id].discharge); });
    p.brInitial = Math.min(p.brInitial, p.brCapacity);
    return p;
  }
  function setCustom(p) {
    var base = scenarioParams(scenarioId); p.name = base.name;
    if (JSON.stringify(p) === JSON.stringify(base)) custom = null; else { p.name = 'Your settings'; custom = p; }
    store('p4.custom', custom); fillScenarios(); fillParams(); runCurrent();
    if (!cur.complete) toast('This run did not finish. Check BR capacity, the MLG start rule and fleet sizes.');
  }
  function fillScenarios() {
    $('scn').innerHTML = E.SCENARIOS.map(function (s) { return '<option value="' + s.id + '">' + s.name + '</option>'; }).join('') + (custom ? '<option value="custom">Your settings</option>' : '');
    $('scn').value = custom ? 'custom' : scenarioId;
  }

  /* ---------- wiring ---------- */
  function pngSnapshot() {
    try {
      var c = document.createElement('canvas'), pad = 20 * dpr, lines = [];
      cur.vessels.forEach(function (v) { lines.push(v.id + ': ' + vesselStatus(v, T)[0] + ' | discharge ' + clk(v.dStart) + ' to ' + clk(v.dEnd) + ' | loading ' + clk(v.lStart) + ' to ' + clk(v.lEnd) + ' | turnaround ' + hrs(v.turnaround, 2)); });
      var b = brAt(T); lines.push('BR at ' + clk(T) + ': ' + b[1] + ' of ' + cur.br.capacity + ' | peak ' + cur.br.peak + ' | full for ' + hrs(cur.br.tFull) + ' | clearance ' + num(cur.br.clearRate) + ' per hour');
      lines.push('RT utilisation ' + pct(cur.totals.rtUtil) + ' | YT utilisation ' + pct(cur.totals.ytUtil) + ' | handled per hour ' + num(cur.totals.perHour) + ' | scenario: ' + cur.params.name + ' (model projection)');
      c.width = cv.width; c.height = cv.height + pad * 2 + lines.length * 20 * dpr;
      var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(cv, 0, 0);
      x.fillStyle = '#0f1c24'; x.font = (13 * dpr) + 'px "IBM Plex Sans", sans-serif'; x.textBaseline = 'top';
      lines.forEach(function (l, i) { x.fillText(l, pad, cv.height + pad + i * 20 * dpr); });
      c.toBlob(function (bl) { if (bl) saveFile('pier4-snapshot-' + clk(T).replace(/[: +]/g, '') + '.png', bl); else toast('Could not create the image.'); });
    } catch (e) { toast('The browser blocked the image export. Open the app from a web server, not from a file.'); }
  }
  function init() {
    $('tabs').innerHTML = PAGES.map(function (p) { return '<a href="#' + p[0] + '" data-p="' + p[0] + '">' + p[1] + '</a>'; }).join('');
    var sv = store('p4.custom'); if (sv && sv.vessels && sv.overrides) custom = E.merge(E.DEFAULTS, sv);
    fillScenarios(); fillParams();
    $('scn').onchange = function () { if (this.value === 'custom') return; scenarioId = this.value; custom = null; store('p4.custom', null); fillScenarios(); fillParams(); T = 0; setPlaying(false); runCurrent(); };
    $('apply').onclick = function () { setCustom(readParams()); };
    $('revert').onclick = function () { custom = null; store('p4.custom', null); fillScenarios(); fillParams(); runCurrent(); };
    $('play').onclick = function () { setPlaying(!playing); };
    $('reset').onclick = function () { T = 0; setPlaying(false); };
    $('seek').oninput = function () { T = +this.value; if (!playing) { $('play').textContent = T > 0 && T < cur.endT ? 'Resume' : 'Start'; drawAll(true); } };
    $('speed').onchange = function () { speed = +this.value; };
    $('tunit').onchange = function () { drawAll(true); };
    $('editLayout').onclick = function () { editing = !editing; this.textContent = editing ? 'Done editing' : 'Edit layout'; $('resetLayout').hidden = !editing; $('layoutNote').textContent = editing ? 'Drag the yellow points to their true positions. Travel times use the stated distances, so moving a point changes the picture only.' : 'Positions are read off the unlabelled satellite image and need confirmation.'; drawAll(true); };
    $('resetLayout').onclick = function () { NODES = JSON.parse(JSON.stringify(NODES0)); store('p4.layout', null); drawAll(true); };
    $('pngMap').onclick = pngSnapshot;
    window.addEventListener('hashchange', function () { showPage(location.hash.slice(1)); });
    window.addEventListener('resize', function () { sizeCanvas(); drawAll(true); });
    sizeCanvas(); runCurrent(); showPage(location.hash.slice(1) || 'sim');
  }
  init();
  window.P4App = { get result() { return cur; }, seek: function (t) { T = t; drawAll(true); } };
})();
