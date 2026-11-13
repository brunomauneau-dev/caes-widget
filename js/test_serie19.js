// test_serie19.js — Série 19 : banc de contrôle de 100 questions sur le vrai fichier de candidats (hors dépôt : données
// réelles) ; deux réponses fausses trouvées, reproduites ici sur des données FICTIVES :
// - « combien de candidats scolarisés à Bordeaux admis à Bordeaux » : un seul des deux lieux gardé (4 383 au lieu de 1 167) ;
// - « … et des Landes ? » puis « combien de boursiers parmi eux ? » : tous les boursiers du fichier (6 360 au lieu de 678).
// Chaque valeur attendue est recalculée sur les lignes.
// node js/test_serie19.js

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
// v27.5.82 — définition SAIO : un « candidat » a confirmé au moins un vœu ; les valeurs attendues portent sur ces lignes
// (les élèves sans vœu, case vide, ne sont plus comptés comme candidats). L_TOUT = toutes les lignes du fichier.
const L_TOUT = ROWS.slice(1);
const L = L_TOUT.filter(r => String(r[16] ?? '').trim() !== '' && Number(r[16]) >= 1);
const cf = makeCtx();
cf.XLSX.read = () => ({ SheetNames: ['BDD'], Sheets: { BDD: 'ws' } });
cf.XLSX.utils.sheet_to_json = () => ROWS.map(r => r.slice());
await run(cf, 'importSpreadsheetFile')({ name: 'BDD.xlsx', size: 1000, arrayBuffer: async () => new ArrayBuffer(8) });
const qf = asker(cf);
const nf = f => L.filter(f).length;
const nft = f => L_TOUT.filter(f).length; // questions sans « candidats » : tout le fichier (élèves sans vœu compris)
const DEP = 0, ORI = 2, ADM = 7, BOURS = 9, ACC = 21;
const B = r => r[BOURS] === 'Boursier des lycées', A = r => r[ADM] === 'Oui';
const v = e => !e ? 'pas de calcul' : e.kind === 'unresolved' ? 'arrêt' : e.kind === 'count' ? e.result.count : e.kind;

await describe('Deux lieux, deux rôles (lycée d\'origine et accueil)', () => {
  const att = nf(r => r[ORI] === 'Bordeaux' && A(r) && r[ACC] === 'Bordeaux');
  assert(att > 0 && att < nf(r => r[ORI] === 'Bordeaux' && A(r)), 'jeu de données : des scolarisés à Bordeaux admis ailleurs existent');
  assert(v(qf('combien de candidats scolarisés à Bordeaux admis à Bordeaux')) === att, `scolarisés à Bordeaux admis à Bordeaux : ${att} (avant : ${nf(r => r[ORI] === 'Bordeaux' && A(r))}, un seul lieu)`);
  assert(v(qf('combien de candidats de Pau admis à Bordeaux')) === nf(r => r[ORI] === 'Pau' && A(r) && r[ACC] === 'Bordeaux'), '« de Pau admis à Bordeaux » : les deux lieux');
  assert(v(qf('combien de candidats admis à Bordeaux')) === nf(r => A(r) && r[ACC] === 'Bordeaux'), 'faux positif : « admis à Bordeaux » seul = la commune d\'accueil');
  assert(v(qf('combien de candidats des lycées de Bordeaux')) === nf(r => r[ORI] === 'Bordeaux'), 'faux positif : « lycées de Bordeaux » = la commune de scolarité');
});

await describe('« combien de X parmi eux ? » en relance', () => {
  const qs = ['combien de candidats de Gironde', 'et des Landes ?', 'combien de boursiers parmi eux ?'];
  let e; qs.forEach((q, i) => { e = qf(q, i > 0); });
  assert(v(e) === nf(r => r[DEP] === 'Landes' && B(r)), `boursiers parmi les candidats des Landes : ${nf(r => r[DEP] === 'Landes' && B(r))} (avant : ${nf(B)}, tous les boursiers)`);
  qf('combien de candidats de Pau');
  assert(v(qf('combien d\'admis d\'entre eux ?', true)) === nf(r => r[ORI] === 'Pau' && A(r)), '« combien d\'admis d\'entre eux ? »');
  assert(v(qf('combien de boursiers')) === nft(B), 'faux positif : « combien de boursiers » seul (nouvelle question) = tous les boursiers');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
