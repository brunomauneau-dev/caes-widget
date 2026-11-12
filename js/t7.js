// test_serie7.js — Série 7 : questions longues à plusieurs critères, sur des fichiers Excel aux colonnes nommées de
// façons différentes (noms complets, abrégés, en majuscules sans accents, « Colonne A… »).
// Règle : chaque critère de la question est appliqué, quel que soit le nom des colonnes ; sinon le widget s'arrête et
// le dit (« Critère non reconnu »). Jamais un chiffre faux affiché comme exact.
// Données FICTIVES (js/fixtures/donnees_simulees.mjs) ; chaque valeur attendue est recalculée sur les lignes.
// node js/test_serie7.js

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


function valeur(e) {
  if (!e) return 'pas de calcul';
  if (e.kind === 'unresolved') return 'arrêt';
  if (e.kind === 'count') return e.result.count;
  if (e.kind === 'part') return `${e.result.num}/${e.result.den}`;
  if (e.kind === 'group_by' || e.kind === 'top') return Object.fromEntries((e.result.rows || []).map(r => [r.value, r.count]));
  return e.kind;
}
const egal = (a, b) => JSON.stringify(a) === JSON.stringify(b) || (a && b && typeof a === 'object' && typeof b === 'object' && Object.keys(a).length === Object.keys(b).length && Object.entries(b).every(([k, v]) => a[k] === v));
const grouper = (rows, cle) => { const m = {}; rows.forEach(r => { m[cle(r)] = (m[cle(r)] || 0) + 1; }); return m; };

const L = D.candidats(3000, 71);
const nf = f => L.filter(f).length;
const sansAccents = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, ' ').toUpperCase();
const NOMS = {
  complets: D.enTetes.complets,
  abreges: D.enTetes.abreges,
  majuscules: Object.fromEntries(Object.entries(D.enTetes.complets).map(([k, v]) => [k, sansAccents(v)])),
  vagues: D.enTetes.vagues,
};
async function contexte(noms, opts = {}) {
  const ctx = makeCtx();
  const rows = D.versTableau(L, noms, opts);
  ctx.XLSX.read = () => ({ SheetNames: ['Extraction'], Sheets: { Extraction: 'ws' } });
  ctx.XLSX.utils.sheet_to_json = () => rows.map(r => r.slice());
  await run(ctx, 'importSpreadsheetFile')({ name: 'extraction.xlsx', size: 1000, arrayBuffer: async () => new ArrayBuffer(8) });
  return ctx;
}

const QUESTIONS = [
  ['combien de candidates boursières de série générale admises en CPGE', nf(r => r.sexe === 'Féminin' && r.boursier === 'Oui' && r.serie === 'Générale' && r.groupe === 'CPGE')],
  ['combien de garçons non boursiers venant du lycée Montaigne admis en licence', nf(r => r.sexe === 'Masculin' && r.boursier === 'Non' && r.lycee_origine === 'Lycée Montaigne' && r.groupe === 'Licence')],
  ['parmi les candidats du pays basque, combien de boursiers sont admis en BTS', nf(r => r.basque === 'Oui' && r.boursier === 'Oui' && r.groupe === 'BTS')],
  ['nombre d\'apprentis de série professionnelle admis en BTS dans l\'académie de Bordeaux', nf(r => r.apprenti === 'Oui' && r.serie === 'Professionnelle' && r.groupe === 'BTS' && r.aca_accueil === 'Bordeaux')],
  ['part des boursiers parmi les candidats de Gironde admis en PASS', `${nf(r => r.dep_origine === 'Gironde' && r.groupe === 'PASS' && r.boursier === 'Oui')}/${nf(r => r.dep_origine === 'Gironde' && r.groupe === 'PASS')}`],
  ['combien de candidats de Dordogne ou des Landes ont été admis en IFSI', nf(r => ['Dordogne', 'Landes'].includes(r.dep_origine) && r.groupe === 'IFSI')],
  ['répartition par groupe de formation des candidates boursières de série technologique', grouper(L.filter(r => r.sexe === 'Féminin' && r.boursier === 'Oui' && r.serie === 'Technologique'), r => r.groupe)],
  ['combien de candidats ayant plus de 10 vœux confirmés sont admis en CPGE dans l\'académie de Paris', nf(r => r.nb_voeux > 10 && r.groupe === 'CPGE' && r.aca_accueil === 'Paris')],
  ['combien de candidats de série générale non boursiers originaires de Pau ou de Bayonne', nf(r => r.serie === 'Générale' && r.boursier === 'Non' && ['Pau', 'Bayonne'].includes(r.commune_origine))],
  ['combien de filles admises en BUT hors de l\'académie de Bordeaux', nf(r => r.sexe === 'Féminin' && r.groupe === 'BUT' && r.aca_accueil !== 'Bordeaux')],
  ['combien de boursiers du lycée Louis Barthou admis à l\'université de Bordeaux', nf(r => r.boursier === 'Oui' && r.lycee_origine === 'Lycée Louis Barthou' && r.etab_accueil === 'Université de Bordeaux')],
  ['combien d\'élèves de série technologique de Gironde, boursiers et apprentis', nf(r => r.serie === 'Technologique' && r.dep_origine === 'Gironde' && r.boursier === 'Oui' && r.apprenti === 'Oui')],
  ['combien de candidats non boursiers hors Gironde admis en BTS ou en BUT', nf(r => r.boursier === 'Non' && r.dep_origine !== 'Gironde' && ['BTS', 'BUT'].includes(r.groupe))],
  ['taux de boursiers parmi les filles de série technologique admises en BTS', `${nf(r => r.sexe === 'Féminin' && r.serie === 'Technologique' && r.groupe === 'BTS' && r.boursier === 'Oui')}/${nf(r => r.sexe === 'Féminin' && r.serie === 'Technologique' && r.groupe === 'BTS')}`],
  ['combien de candidats de série générale ou technologique du lycée Borda', nf(r => ['Générale', 'Technologique'].includes(r.serie) && r.lycee_origine === 'Lycée Borda')],
  ['combien de candidats des Landes, de Dordogne et du Lot-et-Garonne admis en licence', nf(r => ['Landes', 'Dordogne', 'Lot-et-Garonne'].includes(r.dep_origine) && r.groupe === 'Licence')],
];

const VARIANTES = [
  ...Object.entries(NOMS).map(([nom, noms]) => [nom, noms, {}]),
  ['complets + titres au-dessus, ligne « Total », colonne vide', NOMS.complets, { titres: true, total: true, colonneVide: true }],
  ['abrégés + valeurs « Boursier des lycées », « F » / « M »', NOMS.abreges, { valeursBO: true }],
  ['complets + états en 1 / 0', NOMS.complets, { etats: 'chiffres' }],
  ['abrégés + états en VRAI / FAUX', NOMS.abreges, { etats: 'vraifaux' }],
];
for (const [nom, noms, opts] of VARIANTES) {
  await describe(`Colonnes « ${nom} » (${Object.values(noms).slice(0, 3).join(', ')}…)`, async () => {
    const ctx = await contexte(noms, opts);
    const ask = asker(ctx);
    for (const [q, att] of QUESTIONS) {
      const v = valeur(ask(q));
      if (nom === 'vagues') assert(egal(v, att) || v === 'arrêt' || v === 'pas de calcul', `« ${q} » : ${JSON.stringify(att).slice(0, 60)} ou arrêt — jamais un autre chiffre (obtenu : ${JSON.stringify(v).slice(0, 60)})`);
      else assert(egal(v, att), `« ${q} » : ${JSON.stringify(att).slice(0, 60)} (obtenu : ${JSON.stringify(v).slice(0, 60)})`);
    }
  });
}

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
