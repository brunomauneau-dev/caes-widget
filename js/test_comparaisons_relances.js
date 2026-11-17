// test_comparaisons_relances.js — Comparaisons, relances et classements sur un fichier académique (une ligne = un élève).
// Un banc de 600 questions (enchaînements « et parmi eux… », « et de Bayonne ? », comparaisons, classements) a tourné sur
// le vrai fichier académique (hors dépôt) : 0 chiffre faux après corrections. Erreurs trouvées et corrigées (v27.5.88) :
// - « comparer bac général et bac technologique », « comparer STMG et STI2D » : un seul groupe lu, pas de calcul ;
// - « comparer les bacheliers généraux et technologiques admis en BTS » : « technologiques » cherché aussi dans les
//   intitulés des formations d'accueil (2 / 3 au lieu de 900 / 1 863 sur le vrai fichier).
// Données FICTIVES (js/fixtures/donnees_simulees.mjs) ; chaque valeur attendue est recalculée sur les lignes.
// node js/test_comparaisons_relances.js

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
const [DEP, , COM, , ETAB, , PROP, ACC, APP, BOUR, , CONTRAT, TYPE, SERIE, , , NBV, GRP] = H.map((_, i) => i);
const V = r => String(r[NBV] ?? '').trim() !== '' && Number(r[NBV]) >= 1;
const A = r => r[ACC] === 'Oui', B = r => r[BOUR] === 'Boursier des lycées';
const n = f => R.filter(f).length;
const cmp = e => e?.kind === 'compare' ? (e.result.rows || []).map(x => x.count).join('/') : e?.kind;
const cnt = e => e?.kind === 'count' ? e.result.count : e?.kind;
const chaine = qs => { let e; qs.forEach((q, i) => { e = ask(q, i > 0); }); return e; };

await describe('Comparaisons par type de bac et par série (avant : un seul groupe, pas de calcul)', () => {
  const T = t => r => r[TYPE] === t;
  assert(cmp(ask('comparer les bac général et bac technologique')) === `${n(T('Générale'))}/${n(T('Technologique'))}`, 'bac général contre bac technologique');
  assert(cmp(ask('comparer les candidats de bac pro et de bac général')) === `${n(r => T('Professionnelle')(r) && V(r))}/${n(r => T('Générale')(r) && V(r))}`, 'candidats de bac pro contre bac général (définition SAIO), dans l\'ordre de la question');
  const S = re => r => re.test(r[SERIE]);
  assert(cmp(ask('comparer STMG et STI2D')) === `${n(S(/Management/))}/${n(S(/Industrie/))}`, 'STMG contre STI2D');
  const e = ask('comparer les bacheliers généraux et technologiques admis en BTS');
  const bts = r => A(r) && String(r[GRP]).startsWith('BTS');
  assert(cmp(e) === `${n(r => T('Générale')(r) && bts(r))}/${n(r => T('Technologique')(r) && bts(r))}`, `généraux contre technologiques admis en BTS (obtenu : ${cmp(e)})`);
  assert(!(e?.plan?.filters || []).some(f => f.op === 'contains_all'), '« technologiques » n\'est pas cherché dans les intitulés des formations d\'accueil');
  assert(cmp(ask('comparer les boursiers et non boursiers')) === `${n(B)}/${n(r => r[BOUR] === 'Non boursier du secondaire')}`, 'faux positif : boursiers contre non-boursiers inchangé');
  assert(cmp(ask('comparer les candidats admis en CPGE et en BTS')) === `${n(r => A(r) && r[GRP] === 'CPGE - CPES' && V(r))}/${n(r => bts(r) && V(r))}`, 'faux positif : CPGE contre BTS inchangé');
});

await describe('Relances (vues sur le vrai fichier : justes)', () => {
  const pau = 'Pau', bay = R.some(r => r[COM] === 'Bayonne') ? 'Bayonne' : R.find(r => r[COM] !== pau)[COM];
  assert(cnt(chaine([`combien de boursiers de ${pau}`, 'et les non boursiers ?'])) === n(r => r[BOUR] === 'Non boursier du secondaire' && r[COM] === pau), '« boursiers de Pau » >> « et les non boursiers ? » : les non-boursiers de Pau (remplacement)');
  assert(cnt(chaine([`combien de candidats de ${pau}`, 'dont combien admis en BTS ?', `et de ${bay} ?`])) === n(r => r[COM] === bay && V(r) && A(r) && String(r[GRP]).startsWith('BTS')), `trois questions : ${bay}, candidats admis en BTS`);
  assert(cnt(chaine([`combien de candidats boursiers de ${pau}`, 'et parmi eux combien ont eu une proposition ?'])) === n(r => B(r) && r[COM] === pau && V(r) && r[PROP] === 'Oui'), 'sous-ensemble : proposition parmi les boursiers de Pau');
});

await describe('Classement (vu sur le vrai fichier : juste)', () => {
  const m = {}; R.filter(r => A(r) && r[GRP] === 'CPGE - CPES' && V(r)).forEach(r => { m[r[ETAB]] = (m[r[ETAB]] || 0) + 1; });
  const [l1, c1] = Object.entries(m).sort((a, b) => b[1] - a[1])[0];
  const e = ask('quels lycées ont le plus de candidats admis en CPGE');
  assert(e?.kind === 'top' && e.result.rows[0].count === c1, `premier lycée : ${l1} (${c1}) (obtenu : ${e?.result?.rows?.[0]?.value} ${e?.result?.rows?.[0]?.count})`);
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
