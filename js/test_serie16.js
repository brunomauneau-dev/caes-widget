// test_serie16.js — Série 16 : noms de formations de la langue courante (psycho, compta, éco, prépa éco, ingé, kiné,
// école d'infirmiers, la fac).
// Réponse fausse donnée comme exacte (avant) : « combien de formations à la fac à Bordeaux » = 0 quand aucune université
// n'existe dans les données (au lieu d'un arrêt).
// Non traitées (avant : arrêt « non reconnu ») : psycho, compta, éco, prépa éco, ingé, école d'infirmiers.
// Règle gardée (tests existants) : « licences de droit » / « d'économie » = l'intitulé exact, sans les LAS.
// Données FICTIVES (js/fixtures/donnees_simulees.mjs) ; chaque valeur attendue est recalculée sur les lignes.
// node js/test_serie16.js

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
const v = e => !e ? 'pas de calcul' : e.kind === 'unresolved' ? 'arrêt' : e.kind === 'count' ? e.result.count : e.kind;
const verifie = (q, att, note = '') => { const r = v(qo(q)); assert(r === att, `« ${q} » : ${att} (obtenu : ${r})${note}`); };

await describe('Abréviations de formations (open data)', () => {
  const psy = v(qo('combien de licences de psychologie'));
  verifie('combien de licences de psycho', psy, ' — même chiffre que « psychologie » en toutes lettres ; avant : arrêt');
  assert(psy === n(o => o.fili === 'Licence' && o.detail === 'Psychologie'), `« psychologie » : ${psy} (recalculé sur les lignes)`);
  verifie('combien de BTS compta', n(o => /BTS/.test(o.nom) && /Comptabilité/i.test(o.nom)), ' — avant : arrêt');
  verifie('combien de prépas éco', n(o => /préparatoire économique/.test(o.nom)), ' — avant : arrêt');
  verifie('combien de prépas scientifiques', n(o => /préparatoire scientifique/.test(o.nom)));
  verifie('combien de prépas scientifiques en Gironde', n(o => /préparatoire scientifique/.test(o.nom) && o.dep === 'Gironde'));
  verifie('combien de licences d\'éco', n(o => o.nom === 'Licence - Économie - Économie'), ' (intitulé exact, comme « licences de droit »)');
  verifie('combien d\'écoles d\'infirmiers en Nouvelle-Aquitaine', n(o => o.fili === 'IFSI' && o.region === 'Nouvelle-Aquitaine'), ' — « école d\'infirmiers » = IFSI');
  verifie('combien de prépas en Gironde', n(o => o.fili === 'CPGE' && o.dep === 'Gironde'), ' (faux positif : « prépas » seul inchangé)');
  verifie('combien de BTS en Gironde', n(o => o.fili === 'BTS' && o.dep === 'Gironde'), ' (faux positif)');
});

await describe('Absent des données : arrêt, jamais 0 ni un autre chiffre', () => {
  verifie('combien de formations à la fac à Bordeaux', 'arrêt', ' (aucune université dans ces données ; avant : 0)');
  verifie('combien de formations de kiné', 'arrêt');
  verifie('combien de formations de médecine', 'arrêt');
  const t = qo('combien de formations dans les lycées de Bordeaux');
  assert(t?.kind === 'count' && t.result.count === n(o => o.aca === 'Bordeaux' && /^Lycée/.test(o.etab)), 'faux positif : « les lycées de Bordeaux » existent, comptés');
});

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
const ADM = 7, GRP = 17, ETAB_ACC = 20;

await describe('Fichier de candidats : « la fac », « prépa »', () => {
  const fac = nf(r => r[ADM] === 'Oui' && /(^|\s)Université(\s|$)/.test(r[ETAB_ACC]));
  assert(fac > 0 && v(qf('combien de candidats admis à la fac')) === fac, `admis à la fac = établissement d'accueil « Université… » : ${fac} (obtenu : ${v(qf('combien de candidats admis à la fac'))})`);
  assert(v(qf('combien de candidats admis en prépa')) === nf(r => r[ADM] === 'Oui' && r[GRP] === 'CPGE - CPES'), 'admis en prépa = CPGE');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
