// test_specialites_formulations.js — Spécialités du lycée, taux par groupe et moyennes, formulés librement, sur un fichier
// académique (une ligne = un élève). Un banc de 600 questions a tourné sur le vrai fichier (hors dépôt) : 0 chiffre faux
// après correction. Erreur trouvée et corrigée (v27.5.89) :
// - « candidats ayant suivi mathématiques », « qui ont pris mathématiques » (mot entier) : la formation d'accueil
//   « Mathématiques » (602) au lieu de la spécialité suivie au lycée (7 797 sur le vrai fichier). « ayant suivi »,
//   « qui ont pris », « suivant » désignent maintenant la spécialité ; « candidats en mathématiques » reste l'accueil.
// Données FICTIVES (js/fixtures/donnees_simulees.mjs) ; chaque valeur attendue est recalculée sur les lignes.
// node js/test_specialites_formulations.js

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
const [DEP, , COM, , , , PROP, ACC, , BOUR, , , TYPE, SERIE, , ENS, NBV, GRP, , MENT] = H.map((_, i) => i);
const V = r => String(r[NBV] ?? '').trim() !== '' && Number(r[NBV]) >= 1;
const A = r => r[ACC] === 'Oui';
const spe = r => String(r[ENS] || '').split('|').map(x => x.replace(/Msgn\/\s*/, '').trim()).filter(Boolean);
const has = nom => r => spe(r).includes(nom);
const n = f => R.filter(f).length;
const cnt = e => e?.kind === 'count' ? e.result.count : e?.kind;

await describe('« ayant suivi », « qui ont pris » : la spécialité du lycée, même écrite en toutes lettres', () => {
  const maths = has('Mathématiques'), ses = has('Sciences Economiques et Sociales');
  for (const q of ['combien de candidats ayant suivi mathématiques', 'combien de candidats qui ont pris mathématiques', 'combien de candidats ayant suivi la spécialité mathématiques', 'combien de candidats ayant suivi maths']) {
    assert(cnt(ask(q)) === n(r => maths(r) && V(r)), `« ${q} » : ${n(r => maths(r) && V(r))} (avant, en toutes lettres : la formation d'accueil)`);
  }
  assert(cnt(ask('combien de candidats qui ont pris SES admis en licence')) === n(r => ses(r) && V(r) && A(r) && String(r[GRP]).startsWith('L1')), 'SES admis en licence');
  const e = ask('combien de candidats en mathématiques');
  assert(e?.kind === 'count' && !(e.plan.filters || []).some(f => f.source === 'specialite_lycee') && (e.plan.filters || []).some(f => f.op === 'contains_all'), 'faux positif : « candidats en mathématiques » = la formation d\'accueil, pas la spécialité');
});

await describe('Taux par groupe et moyennes (vus sur le vrai fichier : justes)', () => {
  const e = ask('taux de proposition des candidats par série');
  const m = {}; R.filter(V).forEach(r => { const k = r[SERIE]; m[k] = m[k] || [0, 0]; m[k][1]++; if (r[PROP] === 'Oui') m[k][0]++; });
  assert(e?.kind === 'part_groupes' && (e.result.groupes || []).every(g => m[g.valeur] && `${g.num}/${g.den}` === m[g.valeur].join('/')), 'taux de proposition par série : chaque série recalculée (petites séries comprises)');
  const v = R.filter(r => r[TYPE] === 'Professionnelle' && V(r)).map(r => Number(r[NBV]));
  const s = ask('nombre moyen de vœux des candidats de bac pro');
  assert(s?.kind === 'stats' && Math.abs(s.result.avg - v.reduce((a, b) => a + b, 0) / v.length) < 1e-9, 'nombre moyen de vœux des candidats de bac pro');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
