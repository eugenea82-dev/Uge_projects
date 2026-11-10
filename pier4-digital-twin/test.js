// Headless check of the engine: runs every preset scenario and prints KPIs.
const E = require('./engine.js');
const clk = (t, s0 = 19 * 3600) => { if (t == null) return '--'; const x = Math.round((s0 + t) / 60); const d = Math.floor(x / 1440); return String(Math.floor(x / 60) % 24).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0') + (d ? '+' + d : ''); };
let fail = 0;
const runs = E.SCENARIOS.map(s => ({ s, r: E.simulate(E.merge(s.p, { name: s.name })) }));
runs.push({ s: { name: 'Option 2 RS' }, r: E.simulate({ sourcing: 'rs' }) });
runs.push({ s: { name: 'Empirical' }, r: E.simulate({ durMode: 'empirical' }) });
runs.push({ s: { name: 'Staging cap 6 + balanced' }, r: E.simulate({ stagingCap: 6, ytPriority: 'balanced' }) });
for (const { s, r } of runs) {
  console.log('\n== ' + s.name, '| events', r.events.length, '| end', clk(r.endT), '| ok', r.ok);
  for (const v of r.vessels) console.log(' ', v.id, 'ATA', clk(v.arrival), 'ready', clk(v.readyAt), 'gate', clk(v.gateOpen), 'D', clk(v.dStart), '-', clk(v.dEnd), 'L', clk(v.lStart), '-', clk(v.lEnd), 'ATD', clk(v.depart), 'TAT h', v.turnaround && (v.turnaround / 3600).toFixed(2), 'blocked h', (v.ytBlocked / 3600).toFixed(1), 'starved h', (v.ytStarved / 3600).toFixed(1));
  console.log('  BR peak', r.br.peak, 'firstFull', clk(r.br.firstFull), 'full h', (r.br.tFull / 3600).toFixed(2), 'clear/h', r.br.clearRate.toFixed(1), 'cleared', clk(r.br.cleared));
  console.log('  YT util', r.totals.ytUtil.toFixed(2), 'cycle', r.totals.ytCycle.toFixed(0), '| RT util', r.totals.rtUtil.toFixed(2), 'cycle', r.totals.rtCycle.toFixed(0), 'handled/h', r.totals.perHour.toFixed(1));
  for (const c of r.checks) if (!c.ok) { fail++; console.log('  FAIL', c.name, c.detail); }
}
const a = E.simulate({}), b = E.simulate({});
if (JSON.stringify(a.vessels) !== JSON.stringify(b.vessels)) { fail++; console.log('FAIL not reproducible'); }
console.log(fail ? '\n' + fail + ' check(s) failed' : '\nAll checks passed');
process.exit(fail ? 1 : 0);
