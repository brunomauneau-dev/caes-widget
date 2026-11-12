// test_serie11.js — Série 11 : effectifs précis (néo-bacheliers, bacheliers généraux, filles admises), valeurs à zéro
// (« aucun admis », « pas de places »), exclusions multiples (« hors BTS et hors BUT »), négations (« pas en série générale »).
// Réponses fausses données comme exactes (avant) :
// - « combien de néo-bacheliers admis en BUT », « bacheliers généraux admis en licence » : TOUS les admis additionnés ;
// - « combien de formations n'ont aucun admis » : toutes les formations ; « BTS n'ayant pas de places » : la somme des places ;
// - « hors BTS et hors BUT » : BTS exclu mais BUT exigé ; « sauf en CPGE et en BTS » : CPGE ou BTS (inclusion) ;
// - « boursiers qui ne sont pas en série générale » : boursiers EN série générale.
// Données FICTIVES (js/fixtures/donnees_simulees.mjs) ; chaque valeur attendue est recalculée sur les lignes.
// node js/test_serie11.js

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

// open data, avec quelques formations sans admis ni places (cas réels : formations nouvelles, fermées)
const OD = D.openData(3000, 17).map((o, i) => i % 97 === 0 ? { ...o, acc: 0, acc_neobac: 0, acc_bg: 0, acc_f: 0, acc_bours: 0 } : i % 131 === 0 ? { ...o, capa: 0 } : o);
const co = makeCtx();
co.__t = D.tableOpenData(OD);
run(co, "defaultOpenDataTable = __t; defaultOpenDataState = 'ready';");
const qo = asker(co);
const n = f => OD.filter(f).length;
const S = (f, k) => OD.filter(f).reduce((t, o) => t + Number(o[k]), 0);
const v = e => !e ? 'pas de calcul' : e.kind === 'unresolved' ? 'arrêt' : e.kind === 'count' ? e.result.count : e.kind === 'sum' ? e.result.sum : e.kind;
const verifie = (q, att, note = '') => { const r = v(qo(q)); assert(r === att, `« ${q} » : ${att} (obtenu : ${r})${note}`); };

await describe('Effectifs précis : néo-bacheliers, bacheliers généraux, filles admises', () => {
  verifie('combien de néo-bacheliers admis en BUT', S(o => o.fili === 'BUT', 'acc_neobac'), ` — avant : ${S(o => o.fili === 'BUT', 'acc')}, tous les admis`);
  verifie('combien de bacheliers généraux admis en licence', S(o => o.fili === 'Licence', 'acc_bg'), ' — avant : tous les admis, LAS comprises');
  verifie('nombre de filles admises en CPGE à Bordeaux', S(o => o.fili === 'CPGE' && o.commune === 'Bordeaux', 'acc_f'), ' — avant : arrêt');
  verifie('combien de bacheliers technologiques admis en BTS', 'arrêt', ' (colonne absente : le widget le dit, pas tous les admis)');
  verifie('combien d\'admis en BTS', S(o => o.fili === 'BTS', 'acc'), ' (faux positif : « admis » seul inchangé)');
  verifie('combien de candidates en BTS en Gironde', S(o => o.fili === 'BTS' && o.dep === 'Gironde', 'voe_f'), ' (faux positif : candidates, pas admises)');
});

await describe('Valeurs à zéro : « aucun admis », « pas de places »', () => {
  verifie('combien de formations n\'ont aucun admis', n(o => o.acc === 0), ` — avant : ${OD.length}, toutes les formations`);
  verifie('combien de formations avec 0 admis en Gironde', n(o => o.acc === 0 && o.dep === 'Gironde'));
  verifie('combien de BTS n\'ayant pas de places', n(o => o.fili === 'BTS' && o.capa === 0), ' — avant : la somme des places');
  verifie('combien de places dans les formations sans admis', S(o => o.acc === 0, 'capa'));
  assert(n(o => o.acc === 0) > 0 && n(o => o.fili === 'BTS' && o.capa === 0) > 0, 'jeu de données : des formations à zéro existent (le test n\'est pas vide)');
});

await describe('Exclusions multiples (open data)', () => {
  const G = o => o.dep === 'Gironde';
  verifie('combien de formations hors BTS et hors BUT en Gironde', n(o => G(o) && !['BTS', 'BUT'].includes(o.fili)), ' — avant : BUT exigé');
  verifie('combien de formations en Gironde sauf les BTS et les BUT', n(o => G(o) && !['BTS', 'BUT'].includes(o.fili)));
  verifie('combien de formations en Gironde sauf BTS, BUT et CPGE', n(o => G(o) && !['BTS', 'BUT', 'CPGE'].includes(o.fili)));
  verifie('combien de BTS, BUT et CPGE en Gironde', n(o => G(o) && ['BTS', 'BUT', 'CPGE'].includes(o.fili)), ' (faux positif : sans « sauf », une inclusion)');
  verifie('combien de formations en Gironde sauf les BTS', n(o => G(o) && o.fili !== 'BTS'));
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
const ADM = 7, BOURS = 9, TYPE = 12, GRP = 17;
const B = r => r[BOURS] === 'Boursier des lycées';

await describe('Fichier de candidats : négations et exclusions', () => {
  const vf = q => v(qf(q));
  const types = [...new Set(L.map(r => r[TYPE]))];
  assert(types.includes('Générale'), `colonne « Type de la classe » : ${types.join(', ')}`);
  let a = nf(r => B(r) && r[TYPE] !== 'Générale' && r[TYPE] !== '');
  assert(vf('combien de boursiers qui ne sont pas en série générale') === a, `boursiers pas en série générale : ${a} (obtenu : ${vf('combien de boursiers qui ne sont pas en série générale')} ; avant : boursiers EN série générale)`);
  a = nf(r => r[TYPE] !== 'Professionnelle' && r[TYPE] !== '');
  assert(vf('combien de candidats hors bac pro') === a, `hors bac pro : ${a}`);
  assert(vf('combien de boursiers en série générale') === nf(r => B(r) && r[TYPE] === 'Générale'), 'faux positif : « en série générale » inchangé');
  const hors = g => r => r[ADM] === 'Oui' && r[GRP] !== '' && !g.includes(r[GRP]);
  a = nf(hors(['CPGE - CPES', 'BTS - BTSA - DTS - DMA']));
  assert(vf('combien de candidats admis sauf en CPGE et en BTS') === a, `admis sauf en CPGE et en BTS : ${a} (obtenu : ${vf('combien de candidats admis sauf en CPGE et en BTS')} ; avant : CPGE ou BTS)`);
  a = nf(hors(['BTS - BTSA - DTS - DMA', 'L1 - CUPGE - DEUST - DU']));
  assert(vf('combien de candidats admis hors BTS et hors licence') === a, `admis hors BTS et hors licence : ${a} (obtenu : ${vf('combien de candidats admis hors BTS et hors licence')})`);
  assert(vf('combien de candidats admis en CPGE et en BTS') === nf(r => r[ADM] === 'Oui' && ['CPGE - CPES', 'BTS - BTSA - DTS - DMA'].includes(r[GRP])), 'faux positif : « en CPGE et en BTS » = l\'un ou l\'autre');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
