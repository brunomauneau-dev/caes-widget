// test_exclusions_listes.js — Exclusions, listes et « ou » combinés, sur un fichier académique (une ligne = un élève).
// Un banc de 800 questions a tourné sur le vrai fichier (hors dépôt) : 125 chiffres faux sur 400 avant, 0 après.
// Erreurs trouvées et corrigées (v27.5.92) :
// - « combien de candidats admis hors BTS », « admis sauf en licence » : l'exclusion d'UNE formation était lue comme
//   son contraire (4 975 admis EN BTS au lieu de 18 137 sur le vrai fichier) ;
// - deux exclusions dans la même question (« hors Gironde … admis hors BTS ») : seule la première était lue ;
// - « hors Gironde admis à Toulouse », « sauf la Gironde admis à Bordeaux » : la négation s'étendait au lieu d'accueil
//   (académie ≠ Bordeaux ajoutée) ;
// - « de Pau, Dax et Bayonne admis… » : la liste lue comme communes d'ACCUEIL dès qu'un verbe d'accueil existait ;
// - deux « ou » (« de Pau ou de Bayonne admis à Bordeaux ou à Toulouse ») : 0 ; une liste + un « ou » : Dax oublié.
// Données FICTIVES (js/fixtures/donnees_simulees.mjs) ; chaque valeur attendue est recalculée sur les lignes.
// node js/test_exclusions_listes.js

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

const ROWS = D.exportAcademique(3000, 21);
const H = D.EXPORT_ACADEMIQUE_ENTETES;
const cf = makeCtx();
cf.XLSX.read = () => ({ SheetNames: ['BDD'], Sheets: { BDD: 'ws' } });
cf.XLSX.utils.sheet_to_json = () => ROWS.map(r => r.slice());
await run(cf, 'importSpreadsheetFile')({ name: 'BDD.xlsx', size: 1000, arrayBuffer: async () => new ArrayBuffer(8) });
const ask = asker(cf);
const R = ROWS.slice(1);
const [DEP, , COM, , , , PROP, ACC, , BOUR, , , TYPE, , , , NBV, GRP, ACA, , , COMA] = H.map((_, i) => i);
const V = r => String(r[NBV] ?? '').trim() !== '' && Number(r[NBV]) >= 1;
const A = r => r[ACC] === 'Oui', B = r => r[BOUR] === 'Boursier des lycées', NB = r => r[BOUR] === 'Non boursier du secondaire';
const n = f => R.filter(r => V(r) && f(r)).length;
const cnt = e => e?.kind === 'count' ? e.result.count : e?.kind;
const g = p => r => String(r[GRP]).startsWith(p);

await describe('Une formation exclue (avant : lue comme son contraire)', () => {
  const t = [
    ['combien de candidats admis hors BTS', r => A(r) && r[GRP] !== '' && !g('BTS')(r)],
    ['combien de candidats admis sauf en licence', r => A(r) && r[GRP] !== '' && !g('L1')(r)],
    ['combien de candidats de bac général admis sauf en licence', r => r[TYPE] === 'Générale' && A(r) && r[GRP] !== '' && !g('L1')(r)],
    ['combien de candidats du privé admis hors BTS', r => r[11] !== 'Public' && A(r) && r[GRP] !== '' && !g('BTS')(r)],
  ];
  for (const [q, f] of t) assert(cnt(ask(q)) === n(f), `« ${q} » : ${n(f)} (obtenu : ${cnt(ask(q))})`);
  assert(cnt(ask('combien de candidats admis en BTS')) === n(r => A(r) && g('BTS')(r)), 'faux positif : « admis en BTS » inchangé');
  assert(cnt(ask('combien de candidats admis sauf en CPGE et en BTS')) === n(r => A(r) && r[GRP] !== '' && !g('BTS')(r) && !g('CPGE')(r)), 'faux positif : deux formations exclues (inchangé)');
});

await describe('Deux exclusions, et la négation qui s\'arrête au verbe d\'accueil', () => {
  assert(cnt(ask('combien de candidats hors Gironde admis hors BTS')) === n(r => r[DEP] !== 'Gironde' && A(r) && r[GRP] !== '' && !g('BTS')(r)), 'hors Gironde ET hors BTS (avant : seule la première exclusion)');
  assert(cnt(ask('combien de candidats hors Gironde admis à Toulouse')) === n(r => r[DEP] !== 'Gironde' && A(r) && r[COMA] === 'Toulouse'), '« hors Gironde admis à Toulouse » : Toulouse n\'est pas exclu');
  assert(cnt(ask('combien de candidats sauf la Gironde admis à Bordeaux ou à Toulouse')) === n(r => r[DEP] !== 'Gironde' && A(r) && ['Bordeaux', 'Toulouse'].includes(r[COMA])), '« sauf la Gironde admis à Bordeaux ou à Toulouse » (avant : académie ≠ Bordeaux ajoutée)');
  assert(cnt(ask('combien de candidats admis hors de l\'académie de Bordeaux')) === n(r => A(r) && r[ACA] !== '' && r[ACA] !== 'Bordeaux'), 'faux positif : « hors de l\'académie de Bordeaux » reste une exclusion');
});

await describe('Listes de communes et « ou » multiples', () => {
  const L3 = ['Pau', 'Bayonne', 'Agen'];
  assert(cnt(ask('combien de candidats de Pau, Bayonne et Agen admis hors BTS')) === n(r => L3.includes(r[COM]) && A(r) && r[GRP] !== '' && !g('BTS')(r)), 'liste avant « admis » = communes d\'origine (avant : communes d\'accueil)');
  assert(cnt(ask('combien de candidats de Pau, Bayonne et Agen admis en BTS ou en BUT')) === n(r => L3.includes(r[COM]) && A(r) && (g('BTS')(r) || r[GRP] === 'DUT')), 'liste + « ou » : aucune commune oubliée');
  assert(cnt(ask('combien de candidats de Pau ou de Bayonne admis à Bordeaux ou à Toulouse')) === n(r => ['Pau', 'Bayonne'].includes(r[COM]) && A(r) && ['Bordeaux', 'Toulouse'].includes(r[COMA])), 'deux « ou » (avant : 0)');
  assert(cnt(ask('combien de candidats de Pau, Bayonne et Agen non boursiers admis à Bordeaux ou à Toulouse')) === n(r => L3.includes(r[COM]) && NB(r) && A(r) && ['Bordeaux', 'Toulouse'].includes(r[COMA])), 'liste + non boursiers + « ou » : rien de perdu');
  assert(cnt(ask('combien de candidats admis à Bordeaux, Pessac et Talence')) === n(r => A(r) && ['Bordeaux', 'Pessac', 'Talence'].includes(r[COMA])), 'faux positif : liste APRÈS « admis à » = communes d\'accueil');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
