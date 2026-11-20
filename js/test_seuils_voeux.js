// test_seuils_voeux.js — Seuils sur le nombre de vœux dans un fichier académique (une ligne = un élève) :
// « dont le nombre de vœux dépasse 5 », « nombre de vœux compris entre 5 et 10 », « 15 vœux ou plus de Gironde »,
// « exactement 3 vœux », « moins de 3 vœux ou plus de 20 vœux ». Vérité recalculée sur les lignes, avec la définition
// SAIO (« candidats » = au moins un vœu confirmé ; « élèves » = tout le fichier).
// Banc v27.5.94 sur le vrai fichier (hors dépôt) : 33 chiffres faux sur 200 avant, 0 sur 600 après.
// Le garde-fou « condition non comprise » ne doit pas être trompé par le filtre SAIO « au moins un vœu ».
// node js/test_seuils_voeux.js

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
const N = r => { const t = String(r[NBV] ?? '').trim(); return t === '' ? null : Number(t); };
const tous = f => R.filter(r => f(r)).length;
const avec = (f, p = () => true) => n(r => N(r) !== null && f(N(r)) && p(r));
const G = r => r[DEP] === 'Gironde';

await describe('Mesure nommée avant le seuil : « dont le nombre de vœux dépasse 5 » (avant : tous les candidats)', () => {
  assert(cnt(ask('combien de candidats dont le nombre de vœux dépasse 5')) === avec(v => v > 5), '« dont le nombre de vœux dépasse 5 »');
  assert(cnt(ask('combien de candidats sans proposition dont le nombre de vœux dépasse 5')) === avec(v => v > 5, r => r[PROP] === 'Non'), '« sans proposition dont le nombre de vœux dépasse 5 »');
  assert(cnt(ask('combien de candidats ayant un nombre de vœux supérieur à 8 de Gironde')) === avec(v => v > 8, G), '« ayant un nombre de vœux supérieur à 8 de Gironde »');
  assert(cnt(ask('combien de candidats dont le nombre de vœux dépasse 12 admis en BTS')) === avec(v => v > 12, r => A(r) && g('BTS')(r)), '« dépasse 12 admis en BTS » : « 12 admis » n\'est pas une seconde condition');
  assert(cnt(ask('combien de candidats avec un nombre de vœux compris entre 5 et 10 boursiers')) === avec(v => v >= 5 && v <= 10, B), '« nombre de vœux compris entre 5 et 10 »');
  const e = ask("nombre d'élèves avec un nombre de vœux compris entre 5 et 10");
  assert(cnt(e) === R.filter(r => N(r) !== null && N(r) >= 5 && N(r) <= 10).length, '« élèves … compris entre 5 et 10 » (avant : tout le fichier)');
});

await describe('« ou plus », « ou moins » suivis d\'un autre critère (avant : seuil perdu ou « exactement »)', () => {
  assert(cnt(ask('combien de candidats avec 15 vœux ou plus de Gironde')) === avec(v => v >= 15, G), '« 15 vœux ou plus de Gironde »');
  assert(cnt(ask('combien de candidats ayant 12 vœux ou moins de Gironde')) === avec(v => v <= 12, G), '« 12 vœux ou moins de Gironde » (avant : exactement 12)');
  assert(cnt(ask("nombre d'élèves qui ont fait 3 vœux et plus de bac général")) === R.filter(r => N(r) !== null && N(r) >= 3 && r[TYPE] === 'Générale').length, '« 3 vœux et plus de bac général »');
  assert(cnt(ask('combien de candidats ayant exactement 3 vœux')) === avec(v => v === 3), '« exactement 3 vœux »');
  assert(cnt(ask('combien de candidats avec moins de 3 vœux ou plus de 20 vœux')) === avec(v => v < 3 || v > 20), '« moins de 3 vœux ou plus de 20 vœux »');
});

await describe('Faux positifs et garde-fou', () => {
  assert(cnt(ask('combien de candidats')) === n(() => true), '« combien de candidats » : définition SAIO inchangée');
  assert(cnt(ask("combien d'élèves")) === R.length, '« combien d\'élèves » : tout le fichier');
  assert(cnt(ask('combien de candidats avec plus de 10 vœux')) === avec(v => v > 10), '« plus de 10 vœux » : inchangé');
  assert(cnt(ask('combien de candidats ayant fait entre 5 et 10 vœux')) === avec(v => v >= 5 && v <= 10), '« entre 5 et 10 vœux » : inchangé');
  const total = n(() => true);
  for (const q of ['combien de candidats dont la moyenne dépasse 12', 'combien de candidats dont le rang est supérieur à 100', 'combien de candidats avec une note comprise entre 10 et 15']) {
    const e = ask(q);
    assert(!e || e.kind === 'unresolved' || cnt(e) !== total, `« ${q} » (aucune colonne) : arrêt, jamais tous les candidats (le filtre SAIO ne compte pas comme condition lue)`);
  }
});

await describe('Origine après le lieu d\'accueil : « admis à Bordeaux de Pau » (avant : Pau perdu, tous les admis à Bordeaux)', () => {
  const COMO = 2;
  assert(cnt(ask('combien de candidats admis à Bordeaux de Pau')) === n(r => A(r) && r[COMA] === 'Bordeaux' && r[COMO] === 'Pau'), '« admis à Bordeaux de Pau » = venant de Pau');
  assert(cnt(ask('combien de candidats de Pau admis à Bordeaux')) === n(r => A(r) && r[COMA] === 'Bordeaux' && r[COMO] === 'Pau'), '« de Pau admis à Bordeaux » : même chiffre (inchangé)');
  const e = ask('nombre minimal de vœux des candidats admis à Bordeaux de Pau');
  const v = R.filter(r => V(r) && A(r) && r[COMA] === 'Bordeaux' && r[COMO] === 'Pau').map(N);
  assert(e && e.kind === 'stats' && e.result.min === Math.min(...v), 'statistique sur la même population');
  assert(cnt(ask('combien de candidats admis en BTS de Pau')) === n(r => A(r) && g('BTS')(r) && r[COMA] === 'Pau'), '« admis en BTS de Pau » : BTS situé à Pau (règle inchangée)');
});

await describe('Moyenne de vœux avec conditions', () => {
  const v = R.filter(r => V(r) && B(r) && r[DEP] === 'Gironde').map(N);
  const e = ask('nombre moyen de vœux des candidats boursiers de Gironde');
  assert(e && e.kind === 'stats' && Math.round(e.result.avg * 100) === Math.round(v.reduce((a, b) => a + b, 0) / v.length * 100), 'moyenne des vœux des boursiers de Gironde');
  const e2 = ask('nombre maximal de vœux des candidats de bac général');
  assert(e2 && e2.kind === 'stats' && e2.result.max === Math.max(...R.filter(r => V(r) && r[TYPE] === 'Générale').map(N)), '« maximal » sur le fichier académique');
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
