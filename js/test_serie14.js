// test_serie14.js — Série 14 : mobilité des candidats (« d'où viennent », « où vont », « hors académie »).
// Réponses fausses données comme exactes (avant) :
// - « quelle part des admis en CPGE viennent de Gironde » : 1 082 / 1 082 = 100 % (Gironde pris comme périmètre) ;
// - « part des candidats de Gironde admis hors académie » : 2 034 / 35 286 (tout le fichier au dénominateur).
// Non traitées (avant : Albert, sans calcul) : « d'où viennent les admis en CPGE », « où vont les boursiers »,
// « où partent les candidats de Gironde », « dans quelles formations vont les boursiers ».
// Données FICTIVES (js/fixtures/donnees_simulees.mjs) ; chaque valeur attendue est recalculée sur les lignes.
// node js/test_serie14.js

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

const ROWS = D.exportAcademique(3000, 21);
const L = ROWS.slice(1);
const cf = makeCtx();
cf.XLSX.read = () => ({ SheetNames: ['BDD'], Sheets: { BDD: 'ws' } });
cf.XLSX.utils.sheet_to_json = () => ROWS.map(r => r.slice());
await run(cf, 'importSpreadsheetFile')({ name: 'BDD.xlsx', size: 1000, arrayBuffer: async () => new ArrayBuffer(8) });
const qf = asker(cf);
const nf = f => L.filter(f).length;
const DEP = 0, ETAB = 4, ADM = 7, BOURS = 9, GRP = 17, ACA = 18;
const B = r => r[BOURS] === 'Boursier des lycées', CPGE = r => r[ADM] === 'Oui' && r[GRP] === 'CPGE - CPES';
const parCol = (rows, k) => { const m = {}; rows.forEach(r => { if (r[k] === '' || r[k] == null) return; m[r[k]] = (m[r[k]] || 0) + 1; }); return m; };
const lignes = e => Object.fromEntries((e?.result?.rows || []).map(r => [r.value, r.count]));
const meme = (a, b) => Object.keys(a).length === Object.keys(b).length && Object.entries(b).every(([k, x]) => a[k] === x);
const part = e => e?.kind === 'part' ? `${e.result.num}/${e.result.den}` : e?.kind;

await describe('Parts : « viennent de », « admis hors académie »', () => {
  assert(part(qf('quelle part des admis en CPGE viennent de Gironde')) === `${nf(r => CPGE(r) && r[DEP] === 'Gironde')}/${nf(CPGE)}`, `admis en CPGE venant de Gironde (avant : 100 % ; obtenu : ${part(qf('quelle part des admis en CPGE viennent de Gironde'))})`);
  assert(part(qf('quelle part des admis en CPGE sont originaires des Landes')) === `${nf(r => CPGE(r) && r[DEP] === 'Landes')}/${nf(CPGE)}`, '« sont originaires des Landes »');
  const G = r => r[DEP] === 'Gironde';
  assert(part(qf('part des candidats de Gironde admis hors académie')) === `${nf(r => G(r) && r[ACA] !== 'Bordeaux' && r[ACA] !== '')}/${nf(G)}`, `candidats de Gironde admis hors académie (avant : / ${L.length})`);
  assert(part(qf('part des boursiers admis en CPGE')) === `${nf(r => B(r) && CPGE(r))}/${nf(CPGE)}`, 'faux positif : « part des boursiers admis en CPGE » = parmi les admis en CPGE (lecture habituelle)');
  assert(part(qf('part des boursiers ayant eu une proposition')) === `${nf(r => B(r) && r[6] === 'Oui')}/${nf(B)}`, 'faux positif : « ayant eu une proposition » inchangé');
});

await describe('« D\'où viennent… », « où vont… » : répartitions calculées', () => {
  assert(meme(lignes(qf('d\'où viennent les admis en CPGE')), parCol(L.filter(CPGE), DEP)), 'd\'où viennent les admis en CPGE : par département d\'origine (avant : Albert)');
  assert(meme(lignes(qf('de quels lycées viennent les admis en CPGE')), (() => { const m = parCol(L.filter(CPGE), ETAB); return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, Object.keys(lignes(qf('de quels lycées viennent les admis en CPGE'))).length)); })()), 'de quels lycées viennent… : par lycée d\'origine');
  assert(meme(lignes(qf('où vont les boursiers')), parCol(L.filter(B), ACA)), 'où vont les boursiers : par académie d\'accueil');
  assert(meme(lignes(qf('où partent les candidats de Gironde')), parCol(L.filter(r => r[DEP] === 'Gironde'), ACA)), 'où partent les candidats de Gironde');
  assert(meme(lignes(qf('dans quelles formations vont les boursiers')), parCol(L.filter(B), GRP)), 'dans quelles formations vont les boursiers : par grand groupe');
});

await describe('Open data : pas de mobilité (une ligne = une formation)', () => {
  const co = makeCtx();
  co.__t = D.tableOpenData(D.openData(1000, 17));
  run(co, "defaultOpenDataTable = __t; defaultOpenDataState = 'ready';");
  assert(!run(co, 'isDataEngineQuestion')('où vont les BTS'), 'faux positif : « où vont les BTS » (open data) reste pour Albert');
  assert(run(co, 'reformulerMobilite')('d\'où viennent les admis en CPGE', co.__t) === 'd\'où viennent les admis en CPGE', 'faux positif : sans colonne d\'origine, pas de réécriture');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
