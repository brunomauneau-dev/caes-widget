// test_saio_recoupement.js — Erreurs trouvées en recoupant le widget avec le bilan Parcoursup 2025 du SAIO (académie de
// Bordeaux, données au 26/09/2025). Le fichier académique contient le vivier des terminales, y compris les élèves sans vœu :
// - « combien de candidats ont confirmé au moins un vœu » : tout le fichier (« au moins un vœu » ignoré ; SAIO : 29 543) ;
// - « combien de bacheliers généraux ont confirmé au moins un vœu » : tous les généraux (SAIO : 18 222) ;
// - « nombre moyen de vœux par type de classe » : un classement de lycées (« classe » lu comme « classer »).
// Avec les corrections, le widget retrouve les chiffres du SAIO sur le vrai fichier (29 543 ; 18 222 ; 96,8 % de proposition).
// Données FICTIVES ici (js/fixtures/donnees_simulees.mjs) ; chaque valeur attendue est recalculée sur les lignes.
// node js/test_saio_recoupement.js

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

// vivier : quelques élèves sans vœu (case vide), comme dans le vrai fichier
const ROWS = D.exportAcademique(3000, 21).map((r, i) => i > 0 && i % 7 === 0 ? r.map((c, k) => k === 16 ? '' : c) : r);
const L = ROWS.slice(1);
const H = D.EXPORT_ACADEMIQUE_ENTETES;
const cf = makeCtx();
cf.XLSX.read = () => ({ SheetNames: ['BDD'], Sheets: { BDD: 'ws' } });
cf.XLSX.utils.sheet_to_json = () => ROWS.map(r => r.slice());
await run(cf, 'importSpreadsheetFile')({ name: 'BDD.xlsx', size: 1000, arrayBuffer: async () => new ArrayBuffer(8) });
const qf = asker(cf);
const nf = f => L.filter(f).length;
const PROP = 6, ADM = 7, TYPE = 12, VX = 16;
const V = r => r[VX] !== '' && Number(r[VX]) >= 1;
const v = e => !e ? 'pas de calcul' : e.kind === 'unresolved' ? 'arrêt' : e.kind === 'count' ? e.result.count : e.kind === 'part' ? `${e.result.num}/${e.result.den}` : e.kind;

await describe('« au moins un vœu » : les candidats, pas tout le vivier', () => {
  assert(nf(V) < L.length, 'jeu de données : des élèves sans vœu existent');
  for (const q of ['combien de candidats ont confirmé au moins un vœu', 'combien de candidats avec au moins 1 vœu', 'combien de candidats ayant au moins un vœu']) {
    assert(v(qf(q)) === nf(V), `« ${q} » : ${nf(V)} (avant : ${L.length}, tout le fichier)`);
  }
  assert(v(qf('combien de bacheliers généraux ont confirmé au moins un vœu')) === nf(r => r[TYPE] === 'Générale' && V(r)), 'bacheliers généraux ayant confirmé un vœu');
  assert(v(qf('taux de proposition des bacheliers généraux ayant confirmé au moins un vœu')) === `${nf(r => r[TYPE] === 'Générale' && V(r) && r[PROP] === 'Oui')}/${nf(r => r[TYPE] === 'Générale' && V(r))}`, 'taux de proposition parmi les candidats (définition du SAIO)');
  assert(v(qf('combien de candidats admis ayant confirmé au moins un vœu')) === nf(r => r[ADM] === 'Oui' && V(r)), 'admis ayant confirmé un vœu');
  assert(v(qf('combien de candidats ont fait plus d\'un vœu')) === nf(r => r[VX] !== '' && Number(r[VX]) > 1), '« plus d\'un vœu »');
  assert(v(qf('combien de candidats avec plus de 10 vœux')) === nf(r => r[VX] !== '' && Number(r[VX]) > 10), 'faux positif : « plus de 10 vœux » inchangé');
});

await describe('« par type de classe » : la classe du lycée, pas un classement', () => {
  const e = qf('nombre moyen de vœux par type de classe');
  assert(e?.kind === 'stats_groupes' && e.result.dim === H[TYPE], `une moyenne par type de classe (avant : un classement de lycées ; obtenu : ${e?.kind} ${e?.result?.dim})`);
  const g = {}; L.filter(r => r[VX] !== '').forEach(r => { (g[r[TYPE]] = g[r[TYPE]] || []).push(Number(r[VX])); });
  assert(e.result.groupes.every(x => Math.abs(x.avg - g[x.valeur].reduce((a, b) => a + b, 0) / g[x.valeur].length) < 1e-9), 'moyennes recalculées sur les lignes');
  assert(qf('classement des lycées par nombre d\'admis en CPGE')?.kind === 'top', 'faux positif : « classement des lycées… » reste un classement');
  assert(qf('quels lycées ont le plus d\'admis')?.kind === 'top', 'faux positif : « le plus d\'admis » reste un classement');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
