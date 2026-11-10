// test_bilan_lycee.js — Questions d'un bilan de lycée sur l'export de candidats : relances sur une partie de la
// population, taux de deux groupes, parts « des candidats admis en X », classements et comparaisons d'établissements.
// Essai sur l'export réel (10/11/2026) :
// - « combien de candidats du lycée Montaigne » puis « combien ont eu une proposition » : tout le fichier (27 753
//   au lieu de 254) ; « et parmi eux combien de boursiers » : « eux » inconnu, arrêt ;
// - « taux de proposition des boursiers et des non boursiers » : seuls les non-boursiers ;
// - « part des candidats admis en BTS » : 100 % (les admis en BTS parmi les admis en BTS) ;
// - « les universités qui accueillent le plus de candidats » : universités cherchées parmi les lycées d'origine (0) ;
// - « les 5 établissements d'accueil les plus fréquents » : « d'accueil les plus fréquents » lu comme un nom ;
// - « quel lycée a le plus de candidats admis en CPGE », « comparer le lycée Montaigne et le lycée Victor Louis » :
//   pas de calcul (envoyé à Albert).
// Données FICTIVES (js/fixtures/donnees_simulees.mjs) ; chaque valeur attendue est recalculée sur les lignes.
// node js/test_bilan_lycee.js

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
  ctx.window = ctx; ctx.globalThis = ctx; ctx.selectedDocIds = new Set();
  vm.createContext(ctx);
  for (const f of ['config.js', 'knowledge.js', 'documents.js', 'planner.js', 'dataEngine.js', 'sessions.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
  ctx.resetContextSilent = () => {};
  return ctx;
}
const run = (ctx, code) => vm.runInContext(code, ctx);

const ROWS = D.exportAcademique(4000, 21);
const ctx = makeCtx();
ctx.XLSX = { read: () => ({ SheetNames: ['BDD'], Sheets: { BDD: 'ws' } }), utils: { sheet_to_json: () => ROWS.map(r => r.slice()) } };
await run(ctx, 'importSpreadsheetFile')({ name: 'BDD.xlsx', size: 1000, arrayBuffer: async () => new ArrayBuffer(8) });
const H = D.EXPORT_ACADEMIQUE_ENTETES;
const [, , , , ETAB, , PROP, ACC, APP, BOURS, , , , , , , , GRP, , , ETABA] = H;
const L = ROWS.slice(1).map(r => Object.fromEntries(H.map((h, i) => [h, r[i]])));
const nb = pred => L.filter(pred).length;
const B = r => r[BOURS] === 'Boursier des lycées';
const M = r => r[ETAB] === 'Lycée Montaigne';

function ask(q, suite = false) {
  if (!suite) run(ctx, 'window.__DATA_ENGINE_STATE = { lastPlan: null, lastExecution: null, history: [] }');
  ctx.__q = q;
  const plan = run(ctx, 'isDataEngineQuestion(__q)') ? run(ctx, 'detectDataEnginePlan(__q)') : null;
  return plan ? run(ctx, 'runDataEnginePlan')(plan, []) : null;
}
const cnt = e => e?.kind === 'count' ? e.result.count : null;

await describe('Relances sur une partie de la population', () => {
  assert(cnt(ask('combien de candidats du lycée Montaigne')) === nb(M), 'lycée Montaigne');
  const p = ask('combien ont eu une proposition', true);
  assert(cnt(p) === nb(r => M(r) && r[PROP] === 'Oui'), `>> « combien ont eu une proposition » : parmi les candidats du lycée (avant : tout le fichier ; obtenu : ${cnt(p)})`);
  const b = ask('et parmi eux combien de boursiers', true);
  assert(cnt(b) === nb(r => M(r) && r[PROP] === 'Oui' && B(r)), `>> « et parmi eux combien de boursiers » (avant : « eux » inconnu ; obtenu : ${cnt(b)})`);
  const c = ask('dont combien admis en CPGE', true);
  assert(cnt(c) === nb(r => M(r) && r[PROP] === 'Oui' && B(r) && r[ACC] === 'Oui' && r[GRP] === 'CPGE - CPES'), '>> « dont combien admis en CPGE »');
  ask('combien de boursiers');
  const e = ask("combien d'entre eux sont admis en BTS", true);
  assert(cnt(e) === nb(r => B(r) && r[ACC] === 'Oui' && r[GRP].startsWith('BTS')), '« combien de boursiers » >> « combien d\'entre eux sont admis en BTS »');
  ask('combien de boursiers');
  const f = ask('combien de candidats ont eu une proposition', true);
  assert(cnt(f) === nb(r => r[PROP] === 'Oui'), 'faux positif : une question complète (« combien de candidats ont… ») repart de tout le fichier');
});

await describe('Taux de deux groupes, parts « des candidats admis en X »', () => {
  const t = ask('taux de proposition des boursiers et des non boursiers');
  const g = v => t?.result?.groupes?.find(x => x.valeur === v);
  assert(t?.kind === 'part_groupes' && g('Boursier des lycées')?.den === nb(B) && g('Boursier des lycées')?.num === nb(r => B(r) && r[PROP] === 'Oui')
    && g('Non boursier du secondaire')?.den === nb(r => !B(r)), `boursiers ET non-boursiers : un taux chacun (avant : seuls les non-boursiers ; obtenu : ${t?.kind})`);
  const a = ask('part des candidats admis en BTS');
  assert(a?.kind === 'part' && a.result.num === nb(r => r[ACC] === 'Oui' && r[GRP].startsWith('BTS')) && a.result.den === L.length, `part des candidats admis en BTS = admis en BTS / tous (avant : 100 % ; obtenu : ${a?.result?.num} / ${a?.result?.den})`);
  const c = ask('part des boursiers admis en CPGE');
  assert(c?.kind === 'part' && c.result.num === nb(r => B(r) && r[ACC] === 'Oui' && r[GRP] === 'CPGE - CPES') && c.result.den === nb(r => r[ACC] === 'Oui' && r[GRP] === 'CPGE - CPES'), 'faux positif : « part des boursiers admis en CPGE » = boursiers parmi les admis en CPGE');
  const ap = ask('part des candidats admis en BTS chez les apprentis et les non apprentis');
  const go = ap?.result?.groupes?.find(x => x.valeur === 'Oui');
  assert(ap?.kind === 'part_groupes' && go && go.den === nb(r => r[APP] === 'Oui') && go.num === nb(r => r[APP] === 'Oui' && r[ACC] === 'Oui' && r[GRP].startsWith('BTS')), 'apprentis et non-apprentis : part des admis en BTS dans chacun');
});

await describe('Classements d\'établissements', () => {
  const t = ask('quel lycée a le plus de candidats admis en CPGE');
  const attendu = Object.entries(L.filter(r => r[ACC] === 'Oui' && r[GRP] === 'CPGE - CPES').reduce((m, r) => (m[r[ETAB]] = (m[r[ETAB]] || 0) + 1, m), {})).sort((x, y) => y[1] - x[1])[0];
  assert(t?.kind === 'top' && t.plan.targetCol === ETAB && t.result.rows[0].value === attendu[0] && t.result.rows[0].count === attendu[1], `lycée d'origine avec le plus d'admis en CPGE : ${attendu[0]} (${attendu[1]}) (avant : pas de calcul ; obtenu : ${t?.kind})`);
  const f = ask("quels sont les 5 établissements d'accueil les plus fréquents");
  assert(f?.kind === 'top' && f.plan.targetCol === ETABA && f.result.rows.length === 5, `établissements d'accueil les plus fréquents (avant : « d'accueil les plus fréquents » lu comme un nom ; obtenu : ${f?.kind})`);
  const u = ask('les universités qui accueillent le plus de candidats');
  assert(u?.kind === 'top' && u.plan.targetCol === ETABA && u.result.rows.length && u.result.rows.every(r => /Université/.test(r.value)), `universités d'accueil (avant : cherchées parmi les lycées d'origine, 0 ; obtenu : ${u?.kind} ${u?.result?.rows?.length})`);
  const ac = ask('quels lycées accueillent le plus de candidats en CPGE');
  assert(ac?.kind === 'top' && ac.plan.targetCol === ETABA, '« quels lycées accueillent… » : établissement d\'accueil');
  const en = ask('quels lycées envoient le plus de candidats en CPGE');
  assert(en?.kind === 'top' && en.plan.targetCol === ETAB, '« quels lycées envoient… » : lycée d\'origine');
  const bo = ask('les lycées avec le plus de boursiers');
  assert(bo?.kind === 'top' && bo.plan.targetCol === ETAB, 'les lycées avec le plus de boursiers : lycées d\'origine');
});

await describe('Comparer deux établissements', () => {
  const c = ask('comparer les candidats du lycée Montaigne et du lycée Victor Louis');
  const r = c?.result?.rows || [];
  assert(c?.kind === 'compare' && r.length === 2 && r[0].count === nb(M) && r[1].count === nb(x => x[ETAB] === 'Lycée Victor Louis'), `deux groupes : Montaigne et Victor Louis (avant : pas de calcul ; obtenu : ${c?.kind})`);
  const v = ask('lycée Max Linder versus lycée Louis Barthou');
  assert(v?.kind === 'compare' && v.result.rows[0].count === nb(x => x[ETAB] === 'Lycée Max Linder'), '« versus »');
  const bo = ask('comparer boursiers et non boursiers');
  assert(bo?.kind === 'compare' && bo.result.rows[0].count === nb(B), 'faux positif : comparaison boursiers / non-boursiers inchangée');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
