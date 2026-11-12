// test_serie4.js — Série 4 : enchaînements de relances (2 à 4 questions à la suite).
// Chaque relance doit garder ce qui n'a pas changé (formation, lieu, population, mesure) et remplacer ce qui change.
// Avant la série 4, deux erreurs s'y cachaient (« et en BUT ? » après une somme de places : 0 affiché comme exact).
// Données FICTIVES (js/fixtures/donnees_simulees.mjs) ; chaque valeur attendue est recalculée sur les lignes.
// node js/test_serie4.js

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
const moy = (f, k) => { const v = OD.filter(f).map(o => Number(o[k])); return Math.round(v.reduce((a, b) => a + b, 0) / v.length * 100) / 100; };
const verifie = (q, attendu, note = '') => { const v = valeur(qo(q)); assert(egal(v, attendu), `« ${q} » : ${JSON.stringify(attendu).slice(0, 80)} (obtenu : ${JSON.stringify(v).slice(0, 80)})${note}`); };

await describe('Symboles : « > 80 % », « >= », « < 20 », « > 100 places »', () => {
  verifie('combien de BTS avec un taux d\'accès > 80 %', n(o => o.fili === 'BTS' && o.taux > 80), ` — avant : ${n(o => o.fili === 'BTS')}, tous les BTS`);
  verifie('combien de BTS avec un taux d\'accès >= 80%', n(o => o.fili === 'BTS' && o.taux >= 80));
  verifie('combien de BTS avec un taux d\'accès < 20', n(o => o.fili === 'BTS' && o.taux < 20));
  verifie('combien de formations avec > 100 places', n(o => o.capa > 100), ' — avant : formations ayant exactement 100 candidats');
  verifie('combien de formations de < 20 places', n(o => o.capa < 20));
  verifie('combien de formations avec plus de 100 places', n(o => o.capa > 100), ' (faux positif : forme en toutes lettres inchangée)');
});

await describe('Abréviations et saisie rapide', () => {
  const btsG = n(o => o.fili === 'BTS' && o.dep === 'Gironde');
  for (const q of ['cmb de BTS en Gironde', 'nombre de BTS ds le 33', 'combien de STS en Gironde', 'Bonjour, pourriez-vous me dire combien il y a de BTS en Gironde ?', 'combien de BTS en Gironde stp']) verifie(q, btsG);
  verifie('combien de bts a bdx', n(o => o.fili === 'BTS' && o.commune === 'Bordeaux'));
  verifie('tx d\'accès moyen des BTS', moy(o => o.fili === 'BTS', 'taux'));
  verifie('combien de PASS en NA', n(o => /PASS/.test(o.nom) && o.region === 'Nouvelle-Aquitaine'));
  verifie('combien de BTS en IDF', n(o => o.fili === 'BTS' && o.region === 'Île-de-France'));
  verifie('combien de licences en PACA', 'arrêt', ' (région absente des données : le widget le dit)');
  verifie('combien de licences pro en Gironde', 'arrêt', ' (licence professionnelle absente : pas toutes les licences)');
  assert(!/Nouvelle/.test(run(co, 'reformulerQuestion')('valeurs NA : 12')), 'faux positif : « NA » (non disponible) hors « en NA » inchangé');
});

await describe('Fautes de frappe sur un lieu', () => {
  verifie('combien de bts en giroonde', n(o => o.fili === 'BTS' && o.dep === 'Gironde'), ' — avant : arrêt');
  verifie('combien de BTS à Bordaux', n(o => o.fili === 'BTS' && o.commune === 'Bordeaux'));
  verifie('combien de BTS en Dordonge', n(o => o.fili === 'BTS' && o.dep === 'Dordogne'), ' (deux lettres inversées)');
  verifie('combien de licences à Toulouze', n(o => o.fili === 'Licence' && o.commune === 'Toulouse'));
  const c = run(co, 'corrigerFautesLieux');
  assert(c('combien de formations sélectives', co.__t) === 'combien de formations sélectives', 'faux positif : mots de la question jamais « corrigés »');
  assert(c('combien de BTS en Girondxx', co.__t) === 'combien de BTS en Girondxx', 'faux positif : deux lettres d\'écart, pas de correction (arrêt « non reconnu »)');
});

await describe('Valeur lue à l\'intérieur d\'une autre (« Rhône » dans « Auvergne-Rhône-Alpes »)', () => {
  const r = run(co, '_retirerValeursEmboitees');
  const f = (col, value) => ({ col, op: 'eq', value });
  const p1 = r({ question: 'combien de BTS en Auvergne-Rhône-Alpes', filters: [f('Filière', 'BTS'), f('Département', 'Rhône'), f('Région', 'Auvergne-Rhône-Alpes')] });
  assert(p1.filters.length === 2 && !p1.filters.some(x => x.value === 'Rhône'), 'département « Rhône » en trop retiré');
  const p2 = r({ question: 'combien de BTS en Auvergne-Rhône-Alpes dans le Rhône', filters: [f('Filière', 'BTS'), f('Département', 'Rhône'), f('Région', 'Auvergne-Rhône-Alpes')] });
  assert(p2.filters.length === 3, 'faux positif : « dans le Rhône » cité à part, filtre gardé');
  verifie('combien de BTS en AURA', n(o => o.fili === 'BTS' && o.region === 'Auvergne-Rhône-Alpes'));
});

await describe('Listes avec condition chiffrée', () => {
  const att = {};
  OD.filter(o => o.fili === 'BTS' && o.dep === 'Gironde' && o.taux < 10).forEach(o => { att[o.fil_det.replace(/^BTS - Services - |^BTS - Production - /, '')] = 0; });
  const e = qo('quels BTS ont un taux d\'accès inférieur à 10 % en Gironde');
  const total = (e?.result?.rows || []).reduce((t, r) => t + r.count, 0);
  assert(e?.kind === 'group_by' && e.plan.listMode && total === n(o => o.fili === 'BTS' && o.dep === 'Gironde' && o.taux < 10) && (e.plan.filters || []).some(f => f.op === 'lt'), `formations listées (${total}, condition gardée ; avant : Albert, sans calcul)`);
  const l = qo('les BTS dont le taux d\'accès est inférieur à 30%');
  assert(l?.kind === 'group_by' && (l.result.rows || []).reduce((t, r) => t + r.count, 0) === n(o => o.fili === 'BTS' && o.taux < 30), '« les BTS dont… » : liste calculée');
  assert(!run(co, 'isDataEngineQuestion')('les BTS sont-ils intéressants ?'), 'faux positif : « les BTS… » sans condition reste pour Albert');
});

// ── Fichier de candidats ──
const ROWS = D.exportAcademique(3000, 21);
const L = ROWS.slice(1);
const cf = makeCtx();
cf.XLSX.read = () => ({ SheetNames: ['BDD'], Sheets: { BDD: 'ws' } });
cf.XLSX.utils.sheet_to_json = () => ROWS.map(r => r.slice());
await run(cf, 'importSpreadsheetFile')({ name: 'BDD.xlsx', size: 1000, arrayBuffer: async () => new ArrayBuffer(8) });
const qf = asker(cf);
const nf = f => L.filter(f).length;

await describe('Fichier de candidats : symboles et fautes de frappe', () => {
  const v = qf('combien de candidats avec > 10 vœux');
  assert(valeur(v) === nf(r => Number(r[16]) > 10), `« > 10 vœux » : ${nf(r => Number(r[16]) > 10)} (obtenu : ${valeur(v)})`);
  const b = qf('cmb de boursiers de Bayone');
  assert(valeur(b) === nf(r => r[9] === 'Boursier des lycées' && r[2] === 'Bayonne'), `« cmb de boursiers de Bayone » : ${nf(r => r[9] === 'Boursier des lycées' && r[2] === 'Bayonne')} (obtenu : ${valeur(b)})`);
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
