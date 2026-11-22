// P13 probe: score a Gemini placement answer (<dir>/answer.txt, pasted from the chat)
// against the stripped timestamps in <dir>/truth.json.
// usage: node score.mjs <dir>
import { readFileSync } from 'node:fs';
const dir = process.argv[2];
const truth = JSON.parse(readFileSync(`${dir}/truth.json`, 'utf8'));
const ans = new Map(readFileSync(`${dir}/answer.txt`, 'utf8').trim().split(/\s+/).map((l) => { const [id, s, c] = l.split('|'); return [Number(id), { s, c: Number(c) }]; }));
const errs = []; const rows = [];
for (const t of truth) {
  const a = ans.get(t.id);
  if (t.t === null) continue;
  const got = a?.s; const num = Number(got);
  const err = Number.isFinite(num) && got !== '' ? num - t.t : null;
  if (err !== null) errs.push(Math.abs(err));
  rows.push(`${String(t.id).padStart(3)} truth ${String(t.t).padStart(4)} got ${String(got).padStart(4)} err ${err === null ? '  -' : String(err).padStart(4)}  ${t.text.slice(0, 70)}`);
}
console.log(rows.join('\n'));
errs.sort((a, b) => a - b);
const q = (p) => errs[Math.floor(p * (errs.length - 1))];
const within = (s) => errs.filter((e) => e <= s).length;
console.log(`\ntimestamped=${rows.length} placed=${errs.length} median=${q(0.5)} p75=${q(0.75)} p90=${q(0.9)} within5=${within(5)} within15=${within(15)} within30=${within(30)}`);
const nt = truth.filter((t) => t.t === null).map((t) => ans.get(t.id)?.s);
console.log(`untimestamped=${nt.length} placed=${nt.filter((s) => /^\d+$/.test(s)).length} a=${nt.filter((s) => s === 'a').length} x=${nt.filter((s) => s === 'x').length}`);
const allSecs = [...ans.values()].map((a) => a.s).filter((s) => /^\d+$/.test(s));
console.log(`distinct seconds used=${new Set(allSecs).size} of ${allSecs.length}`);
