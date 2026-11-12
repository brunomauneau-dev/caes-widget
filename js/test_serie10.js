// test_serie10.js — Série 10 : parts et pourcentages, établissements précis, lieux composés, « de X ».
// Réponses fausses données comme exactes (avant) :
// - « combien de formations à l'IUT Tarbes 3 » : les 9 IUT de Tarbes (numéro ignoré ; même cas que « Paris 1 » / « Paris 8 ») ;
// - « combien de formations au lycée Bayonne 13 en 2025 » : 0 (« 13 » lu comme une capacité de 13 places) ;
// - « quelle part des places en BTS est dans le privé » : 415 / 3 000 formations (BTS perdu, formations comptées au
//   lieu des places) ; « pourcentage des places de BTS en Gironde » : 50 / 120 formations.
// Non traitées (avant : arrêt ou Albert) : « quelles formations propose le lycée X », « formations de Lyon / Lille ».
// Données FICTIVES (js/fixtures/donnees_simulees.mjs) ; chaque valeur attendue est recalculée sur les lignes.
// node js/test_serie10.js

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

const OD = D.openData(3000, 17);
const co = makeCtx();
co.__t = D.tableOpenData(OD);
run(co, "defaultOpenDataTable = __t; defaultOpenDataState = 'ready';");
const qo = asker(co);
const n = f => OD.filter(f).length;
const S = (f, k) => OD.filter(f).reduce((t, o) => t + Number(o[k]), 0);
const bts = o => o.fili === 'BTS';

await describe('Établissement précis : le numéro fait partie du nom', () => {
  const e = qo('combien de formations à l\'IUT Tarbes 3');
  assert(e?.result?.count === n(o => o.etab === 'IUT Tarbes 3'), `IUT Tarbes 3 : ${n(o => o.etab === 'IUT Tarbes 3')} (obtenu : ${e?.result?.count} ; avant : ${n(o => /^IUT Tarbes /.test(o.etab))}, tous les IUT de Tarbes)`);
  const t = qo('combien de formations à l\'IUT Tarbes');
  assert(t?.result?.count === n(o => /^IUT Tarbes /.test(o.etab)), 'faux positif : sans numéro, tous les IUT de Tarbes');
  const p = qo('combien de formations au Lycée Paris 1');
  assert(p?.result?.count === n(o => o.etab === 'Lycée Paris 1'), `Lycée Paris 1 : ${n(o => o.etab === 'Lycée Paris 1')} (pas Paris 10, 14…)`);
  for (const q of ['combien de formations au lycée Bayonne 13', 'combien de formations au lycée Bayonne 13 en 2025']) {
    const b = qo(q);
    assert(b?.result?.count === n(o => o.etab === 'Lycée Bayonne 13'), `« ${q} » : ${n(o => o.etab === 'Lycée Bayonne 13')} (obtenu : ${b?.result?.count} ; avant : 0, « Capacité = 13 »)`);
  }
});

await describe('« Quelles formations propose le lycée X ? » : la liste calculée', () => {
  const att = OD.filter(o => o.etab === 'Lycée Bayonne 13').length;
  for (const q of ['quelles formations propose le Lycée Bayonne 13', 'que propose le lycée Bayonne 13', 'liste des formations du lycée Bayonne 13']) {
    const e = qo(q);
    const tot = (e?.result?.rows || []).reduce((t, r) => t + r.count, 0);
    assert(e?.kind === 'group_by' && tot === att && (e.plan.filters || []).some(f => f.source === 'etablissement'), `« ${q} » : ${att} formations listées (obtenu : ${e?.kind} ${tot})`);
  }
  assert(!run(co, 'isDataEngineQuestion')('quelles formations propose Parcoursup'), 'faux positif : « quelles formations propose Parcoursup » reste pour Albert');
});

await describe('Part d\'une quantité (places, candidats) : somme ÷ somme', () => {
  const pr = o => bts(o) && o.statut !== 'Public';
  for (const q of ['quelle part des places en BTS est dans le privé', 'part des places de BTS dans le privé', 'part des places en BTS offertes par le privé']) {
    const e = qo(q);
    assert(e?.kind === 'part' && e.result.num === S(pr, 'capa') && e.result.den === S(bts, 'capa'), `« ${q} » : ${S(pr, 'capa')} / ${S(bts, 'capa')} places (obtenu : ${e?.result?.num} / ${e?.result?.den} ; avant : 415 / 3 000 formations)`);
  }
  const g = qo('pourcentage des places de BTS en Gironde');
  assert(g?.result?.num === S(o => bts(o) && o.dep === 'Gironde', 'capa') && g.result.den === S(bts, 'capa'), 'places de BTS en Gironde ÷ places de BTS');
  const c = qo('part des candidats de BTS en Gironde');
  assert(c?.result?.num === S(o => bts(o) && o.dep === 'Gironde', 'voe') && c.result.den === S(bts, 'voe'), 'candidats de BTS en Gironde ÷ candidats de BTS');
  assert(/places « hors Public »/.test(qo('part des places de BTS dans le privé').html) && /somme de « Capacité/.test(qo('part des places de BTS dans le privé').html), 'libellé et méthode en clair (somme des places)');
  const f = qo('part des formations sélectives en Gironde');
  assert(f?.result?.num === n(o => o.dep === 'Gironde' && o.selectivite === 'formation sélective') && f.result.den === n(o => o.dep === 'Gironde'), 'faux positif : part de FORMATIONS, comptées');
  const b = qo('part des boursiers parmi les admis en BTS');
  assert(b?.result?.num === S(bts, 'acc_bours') && b.result.den === S(bts, 'acc_neobac'), 'faux positif : part des boursiers inchangée (définition du ministère)');
  const t = qo('taux de proposition par académie');
  assert(t?.kind === 'part_groupes', 'faux positif : « par académie » reste un taux par groupe');
});

await describe('« de X » = l\'académie X (comme « de Bordeaux »), lieux composés', () => {
  for (const [q, f] of [['combien de formations de Lille', o => o.aca === 'Lille'], ['combien de formations dans les établissements de Lyon', o => o.aca === 'Lyon'], ['combien de BTS de Nantes', o => bts(o) && o.aca === 'Nantes'], ['combien de formations de Bordeaux', o => o.aca === 'Bordeaux']]) {
    const e = qo(q);
    assert(e?.result?.count === n(f), `« ${q} » : ${n(f)} (obtenu : ${e?.kind} ${e?.result?.count})`);
  }
  for (const [q, f] of [['combien de formations à Mont-de-Marsan', o => o.commune === 'Mont-de-Marsan'], ['combien de formations à la Rochelle', o => o.commune === 'La Rochelle'], ['combien de BTS en charente maritime', o => bts(o) && o.dep === 'Charente-Maritime']]) {
    assert(qo(q)?.result?.count === n(f), `« ${q} » : ${n(f)}`);
  }
  assert(qo('combien de formations à Lyon')?.result?.count === n(o => o.commune === 'Lyon'), 'faux positif : « à Lyon » reste la commune');
  assert(qo('combien de formations à l\'université de Lille')?.kind === 'unresolved', 'faux positif : « université de Lille » est un nom d\'établissement (absent : arrêt)');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
