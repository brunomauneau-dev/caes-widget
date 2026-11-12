// test_serie15.js — Série 15 : écarts (« combien de … de plus … que … »), rangs (« la deuxième académie »), « environ ».
// Réponses fausses données comme exactes (avant) :
// - « y a-t-il plus de boursiers à Pau ou à Bayonne » : Pau 10 / Bayonne 45 (un filtre « commune d'accueil = Bayonne »
//   appliqué aux deux groupes) ;
// - « combien d'admis de plus en BTS qu'en CPGE » : 0 (BTS ET CPGE exigés).
// Non traitées (avant : arrêt) : « combien de BTS de plus en Gironde que dans les Landes », « différence entre… »,
// « y a-t-il plus de … ou … », « la deuxième académie pour le nombre de BTS », « environ combien… ».
// Une comparaison de deux groupes affiche maintenant l'écart.
// Données FICTIVES (js/fixtures/donnees_simulees.mjs) ; chaque valeur attendue est recalculée sur les lignes.
// node js/test_serie15.js

import fs from 'fs';
import vm from 'vm';
import { fileURLToPath } from 'url';
import path from 'path';
import * as D from './fixtures/donnees_simulees.mjs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let passed = 0, failed = 0;
function assert(condition, label) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}`); failed++; }
}
async function describe(label, fn) {
  console.log(`\n${label}`);
  try { await fn(); } catch (e) { console.error(`  ✗ erreur : ${e.stack || e.message}`); failed++; }
}
function makeCtx() {
  const noopEl = () => null;
  const ctx = {
    console: { ...console, log() {}, warn() {}, info() {} }, setTimeout: () => null, clearTimeout() {}, URLSearchParams, TextDecoder, TextEncoder,
    document: { getElementById: noopEl, querySelector: noopEl, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, fetch: () => Promise.reject(new Error('hors ligne')),
    escapeHtml: s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  };
  ctx.XLSX = { utils: { json_to_sheet: () => ({}), book_new: () => ({}), book_append_sheet() {}, sheet_to_csv: () => '', sheet_to_json: () => [], aoa_to_sheet: () => ({}) }, writeFile() {} };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.selectedDocIds = new Set();
  vm.createContext(ctx);
  for (const f of ['config.js', 'knowledge.js', 'documents.js', 'planner.js', 'dataEngine.js', 'sessions.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
  ctx.resetContextSilent = () => {};
  return ctx;
}
const run = (ctx, code) => vm.runInContext(code, ctx);
const asker = ctx => (q, suite = false) => {
  if (!suite) run(ctx, 'window.__DATA_ENGINE_STATE = { lastPlan: null, lastExecution: null, history: [] }');
  ctx.__q = q;
  const plan = run(ctx, 'isDataEngineQuestion(__q)') ? run(ctx, 'detectDataEnginePlan(__q)') : null;
  return plan ? run(ctx, 'runDataEnginePlan')(plan, []) : null;
};

// valeur rendue par le moteur, sous une forme comparable à la vérité calculée
function valeur(e) {
  if (!e) return 'pas de calcul';
  if (e.kind === 'unresolved') return 'arrêt';
  if (e.kind === 'count') return e.result.count;
  if (e.kind === 'sum') return e.result.sum;
  if (e.kind === 'stats') return Math.round(e.result.avg * 100) / 100;
  if (e.kind === 'part') return `${e.result.num}/${e.result.den}`;
  if (e.kind === 'group_by' || e.kind === 'top') return Object.fromEntries((e.result.rows || []).map(r => [r.value, r.count]));
  return e.kind;
}
const egal = (a, b) => JSON.stringify(a) === JSON.stringify(b) || (typeof a === 'object' && typeof b === 'object' && a && b && Object.keys(b).length === Object.keys(a).length && Object.entries(b).every(([k, v]) => a[k] === v));
function chaine(ask, etapes, titre) {
  let suite = false;
  for (const [q, attendu] of etapes) {
    const e = ask(q, suite);
    suite = true;
    const v = valeur(e);
    assert(egal(v, attendu), `${titre} — « ${q} » : ${JSON.stringify(attendu).slice(0, 90)} (obtenu : ${JSON.stringify(v).slice(0, 90)})`);
  }
}
const grouper = (rows, cle, val = () => 1) => { const m = {}; rows.forEach(r => { const k = cle(r); if (k === '' || k == null) return; m[k] = (m[k] || 0) + val(r); }); return m; };

const v = e => !e ? 'pas de calcul' : e.kind === 'unresolved' ? 'arrêt' : e.kind === 'count' ? e.result.count : e.kind === 'compare' ? e.result.rows.map(r => `${r.label}:${r.count}`).join(' / ') : e.kind;
const OD = D.openData(3000, 17);
const co = makeCtx();
co.__t = D.tableOpenData(OD);
run(co, "defaultOpenDataTable = __t; defaultOpenDataState = 'ready';");
const qo = asker(co);
const n = f => OD.filter(f).length;
const G = n(o => o.fili === 'BTS' && o.dep === 'Gironde'), La = n(o => o.fili === 'BTS' && o.dep === 'Landes');

await describe('Écarts entre deux lieux (open data)', () => {
  for (const q of ['combien de BTS de plus en Gironde que dans les Landes', 'quelle est la différence entre le nombre de BTS en Gironde et dans les Landes', 'y a-t-il plus de BTS en Gironde ou dans les Landes', 'quel est l\'écart entre le nombre de BTS en Gironde et dans les Landes']) {
    const e = qo(q);
    assert(v(e) === `Gironde:${G} / Landes:${La}`, `« ${q} » : Gironde ${G} / Landes ${La} (avant : arrêt ; obtenu : ${v(e)})`);
  }
  const html = qo('combien de BTS de plus en Gironde que dans les Landes').html.replace(/<[^>]+>/g, '').replace(/ | /g, ' ');
  assert(html.includes(`Gironde − Landes = +${G - La}`), `écart affiché : +${G - La}`);
  assert(v(qo('y a-t-il des BTS à Pau')) === n(o => o.fili === 'BTS' && o.commune === 'Pau'), 'faux positif : « y a-t-il des BTS à Pau » reste un comptage');
});

await describe('Rangs et « environ »', () => {
  const e = qo('quelle est la deuxième académie pour le nombre de BTS');
  const tri = Object.entries(OD.filter(o => o.fili === 'BTS').reduce((m, o) => (m[o.aca] = (m[o.aca] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]);
  assert(e?.kind === 'top' && e.result.rows[1].value === tri[1][0] && e.result.rows[1].count === tri[1][1], `deuxième académie : ${tri[1].join(' ')} (classement affiché ; avant : arrêt)`);
  assert(v(qo('environ combien de BTS en Gironde')) === G, `« environ combien » : ${G} (avant : arrêt sur « environ »)`);
});

const ROWS = D.exportAcademique(3000, 21);
const L = ROWS.slice(1);
const cf = makeCtx();
cf.XLSX.read = () => ({ SheetNames: ['BDD'], Sheets: { BDD: 'ws' } });
cf.XLSX.utils.sheet_to_json = () => ROWS.map(r => r.slice());
await run(cf, 'importSpreadsheetFile')({ name: 'BDD.xlsx', size: 1000, arrayBuffer: async () => new ArrayBuffer(8) });
const qf = asker(cf);
const nf = f => L.filter(f).length;
const ORI = 2, ADM = 7, BOURS = 9, GRP = 17;
const B = r => r[BOURS] === 'Boursier des lycées';

await describe('Écarts (fichier de candidats)', () => {
  const e = qf('y a-t-il plus de boursiers à Pau ou à Bayonne');
  assert(v(e) === `Pau:${nf(r => B(r) && r[ORI] === 'Pau')} / Bayonne:${nf(r => B(r) && r[ORI] === 'Bayonne')}`, `boursiers de Pau / de Bayonne (avant : un filtre « Bayonne » appliqué aux deux ; obtenu : ${v(e)})`);
  const a = r => r[ADM] === 'Oui';
  const b = qf('combien d\'admis de plus en BTS qu\'en CPGE');
  assert(v(b) === `BTS - BTSA - DTS - DMA:${nf(r => a(r) && r[GRP] === 'BTS - BTSA - DTS - DMA')} / CPGE - CPES:${nf(r => a(r) && r[GRP] === 'CPGE - CPES')}`, `« de plus en BTS qu'en CPGE » : BTS puis CPGE (avant : 0 ; obtenu : ${v(b)})`);
  assert(v(qf('comparer les admis en CPGE et en BTS')).startsWith('CPGE'), 'faux positif : l\'ordre de la question est gardé (CPGE puis BTS)');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
