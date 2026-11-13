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

// ── Open data (une ligne = une formation) ──
const OD = D.openData(3000, 17);
const co = makeCtx();
co.__t = D.tableOpenData(OD);
run(co, "defaultOpenDataTable = __t; defaultOpenDataState = 'ready';");
const qo = asker(co);
const n = f => OD.filter(f).length;
const somme = (f, k) => OD.filter(f).reduce((t, o) => t + Number(o[k]), 0);
const moy = (f, k) => { const v = OD.filter(f).map(o => Number(o[k])).filter(Number.isFinite); return Math.round(v.reduce((a, b) => a + b, 0) / v.length * 100) / 100; };

await describe('Open data : la formation, le lieu, la mesure', () => {
  chaine(qo, [
    ['combien de BTS en Gironde', n(o => o.fili === 'BTS' && o.dep === 'Gironde')],
    ['et dans les Landes ?', n(o => o.fili === 'BTS' && o.dep === 'Landes')],
    ['et les BUT ?', n(o => o.fili === 'BUT' && o.dep === 'Landes')],
    ['et à Pau ?', n(o => o.fili === 'BUT' && o.commune === 'Pau')],
  ], 'C1');
  chaine(qo, [
    ['nombre de places en CPGE', somme(o => o.fili === 'CPGE', 'capa')],
    ['et en Gironde ?', somme(o => o.fili === 'CPGE' && o.dep === 'Gironde', 'capa')],
    ['et pour les BTS ?', somme(o => o.fili === 'BTS' && o.dep === 'Gironde', 'capa')],
  ], 'C2');
  chaine(qo, [
    ['taux d\'accès moyen des BTS', moy(o => o.fili === 'BTS', 'taux')],
    ['et en Gironde ?', moy(o => o.fili === 'BTS' && o.dep === 'Gironde', 'taux')],
    ['et pour les BUT ?', moy(o => o.fili === 'BUT' && o.dep === 'Gironde', 'taux')],
  ], 'C4');
  chaine(qo, [
    ['combien de formations publiques en Gironde', n(o => o.statut === 'Public' && o.dep === 'Gironde')],
    ['et privées ?', n(o => o.statut !== 'Public' && o.dep === 'Gironde')],
  ], 'C5');
  chaine(qo, [
    ['combien de BTS en Gironde', n(o => o.fili === 'BTS' && o.dep === 'Gironde')],
    ['et hors Gironde ?', n(o => o.fili === 'BTS' && o.dep !== 'Gironde')],
  ], 'C8');
  chaine(qo, [
    ['combien de candidats pour les BTS de Gironde', somme(o => o.fili === 'BTS' && o.dep === 'Gironde', 'voe')],
    ['et combien d\'admis ?', somme(o => o.fili === 'BTS' && o.dep === 'Gironde', 'acc')],
  ], 'C9');
  chaine(qo, [
    ['combien de BTS en Gironde', n(o => o.fili === 'BTS' && o.dep === 'Gironde')],
    ['combien de places ?', somme(o => o.fili === 'BTS' && o.dep === 'Gironde', 'capa')],
  ], 'C10');
  chaine(qo, [
    ['combien de BTS en Gironde', n(o => o.fili === 'BTS' && o.dep === 'Gironde')],
    ['parmi eux combien sont sélectifs ?', n(o => o.fili === 'BTS' && o.dep === 'Gironde' && o.selectivite === 'formation sélective')],
  ], 'C11');
  chaine(qo, [
    ['répartition des BTS par département', grouper(OD.filter(o => o.fili === 'BTS'), o => o.dep)],
    ['et pour les BUT ?', grouper(OD.filter(o => o.fili === 'BUT'), o => o.dep)],
  ], 'C7');
  chaine(qo, [
    ['combien de licences à Bordeaux', n(o => o.fili === 'Licence' && o.commune === 'Bordeaux')],
    ['et à Toulouse ?', n(o => o.fili === 'Licence' && o.commune === 'Toulouse')],
    ['et les CPGE ?', n(o => o.fili === 'CPGE' && o.commune === 'Toulouse')],
  ], 'C12');
  chaine(qo, [
    ['combien de CPGE à Bordeaux', n(o => o.fili === 'CPGE' && o.commune === 'Bordeaux')],
    ['combien de places ?', somme(o => o.fili === 'CPGE' && o.commune === 'Bordeaux', 'capa')],
    ['et à Toulouse ?', somme(o => o.fili === 'CPGE' && o.commune === 'Toulouse', 'capa')],
  ], 'C14');
  chaine(qo, [
    ['combien de BTS sélectifs en Gironde', n(o => o.fili === 'BTS' && o.dep === 'Gironde' && o.selectivite === 'formation sélective')],
    ['et non sélectifs ?', n(o => o.fili === 'BTS' && o.dep === 'Gironde' && o.selectivite === 'formation non sélective')],
  ], 'C16');
  chaine(qo, [
    ['nombre de places en BTS en Gironde', somme(o => o.fili === 'BTS' && o.dep === 'Gironde', 'capa')],
    ['et le nombre de candidats ?', somme(o => o.fili === 'BTS' && o.dep === 'Gironde', 'voe')],
  ], 'C18');
  chaine(qo, [
    ['combien de BTS en Nouvelle-Aquitaine', n(o => o.fili === 'BTS' && o.region === 'Nouvelle-Aquitaine')],
    ['et en Gironde ?', n(o => o.fili === 'BTS' && o.dep === 'Gironde')],
    ['et dans l\'académie de Toulouse ?', n(o => o.fili === 'BTS' && o.aca === 'Toulouse')],
  ], 'C19');
});

// ── Fichier de candidats ──
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
const DEP = 0, ORI = 2, PROP = 6, ADM = 7, APP = 8, BOURS = 9, GRP = 17, ACC = 21;
const B = r => r[BOURS] === 'Boursier des lycées';
const BTS = r => r[GRP] === 'BTS - BTSA - DTS - DMA', CPGE = r => r[GRP] === 'CPGE - CPES';

await describe('Fichier de candidats : population, sous-population, lieu', () => {
  chaine(qf, [
    ['combien de candidats de Pau', nf(r => r[ORI] === 'Pau')],
    ['combien ont eu une proposition ?', nf(r => r[ORI] === 'Pau' && r[PROP] === 'Oui')],
    ['et parmi eux combien de boursiers ?', nf(r => r[ORI] === 'Pau' && r[PROP] === 'Oui' && B(r))],
  ], 'F1');
  chaine(qf, [
    ['combien de candidats admis en BTS', nf(r => r[ADM] === 'Oui' && BTS(r))],
    ['et en CPGE ?', nf(r => r[ADM] === 'Oui' && CPGE(r))],
    ['et les boursiers ?', nf(r => r[ADM] === 'Oui' && CPGE(r) && B(r))],
  ], 'F2');
  chaine(qf, [
    ['combien de boursiers', nft(B)],
    ['et de Pau ?', nft(r => B(r) && r[ORI] === 'Pau')],
  ], 'F3');
  chaine(qf, [
    ['taux d\'admission des boursiers', `${nf(r => B(r) && r[ADM] === 'Oui')}/${nf(B)}`],
    ['et des non boursiers ?', `${nf(r => !B(r) && r[ADM] === 'Oui')}/${nf(r => !B(r))}`],
  ], 'F4');
  chaine(qf, [
    ['combien de candidats de Gironde', nf(r => r[DEP] === 'Gironde')],
    ['et des Landes ?', nf(r => r[DEP] === 'Landes')],
  ], 'F6');
  chaine(qf, [
    ['combien d\'apprentis', nft(r => r[APP] === 'Oui')],
    ['dont combien admis en BTS ?', nft(r => r[APP] === 'Oui' && r[ADM] === 'Oui' && BTS(r))],
  ], 'F7');
  chaine(qf, [
    ['combien de candidats de Pau', nf(r => r[ORI] === 'Pau')],
    ['et de Bayonne ?', nf(r => r[ORI] === 'Bayonne')],
    ['et parmi eux combien d\'admis ?', nf(r => r[ORI] === 'Bayonne' && r[ADM] === 'Oui')],
  ], 'F9');
  chaine(qf, [
    ['combien de candidats admis à Bordeaux', nf(r => r[ADM] === 'Oui' && r[ACC] === 'Bordeaux')],
    ['et à Talence ?', nf(r => r[ADM] === 'Oui' && r[ACC] === 'Talence')],
    ['et à Pessac ?', nf(r => r[ADM] === 'Oui' && r[ACC] === 'Pessac')],
  ], 'F10');
  chaine(qf, [
    ['combien de boursiers admis en CPGE', nft(r => B(r) && r[ADM] === 'Oui' && CPGE(r))],
    ['et les non boursiers ?', nft(r => !B(r) && r[ADM] === 'Oui' && CPGE(r))],
    ['et en BTS ?', nft(r => !B(r) && r[ADM] === 'Oui' && BTS(r))],
  ], 'F11');
  chaine(qf, [
    ['répartition des admis par grand groupe de formation', grouper(L_TOUT.filter(r => r[ADM] === 'Oui'), r => r[GRP])],
    ['et pour les boursiers ?', grouper(L_TOUT.filter(r => r[ADM] === 'Oui' && B(r)), r => r[GRP])],
  ], 'F8');
  chaine(qf, [
    ['combien de candidats de Pau', nf(r => r[ORI] === 'Pau')],
    ['et de Gironde ?', nf(r => r[DEP] === 'Gironde')],
  ], 'F13');
  chaine(qf, [
    ['combien de candidats admis en BTS', nf(r => r[ADM] === 'Oui' && BTS(r))],
    ['et à Bordeaux ?', nf(r => r[ADM] === 'Oui' && BTS(r) && r[ACC] === 'Bordeaux')],
  ], 'F14');
  chaine(qf, [
    ['taux de proposition des candidats de Pau', `${nf(r => r[ORI] === 'Pau' && r[PROP] === 'Oui')}/${nf(r => r[ORI] === 'Pau')}`],
    ['et de Bayonne ?', `${nf(r => r[ORI] === 'Bayonne' && r[PROP] === 'Oui')}/${nf(r => r[ORI] === 'Bayonne')}`],
  ], 'F15');
  chaine(qf, [
    ['combien de candidats de Gironde', nf(r => r[DEP] === 'Gironde')],
    ['combien d\'admis ?', nf(r => r[DEP] === 'Gironde' && r[ADM] === 'Oui')],
  ], 'F16');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
