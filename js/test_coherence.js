// test_coherence.js — Étape 1 de fiabilité : le widget vérifie que sa réponse porte sur ce qui est demandé.
// Constat (test de l'utilisateur, open data réel, 11/11/2026) : chaque question seule était comprise, mais
// « donne moi la liste » exportait les 14 252 lignes sans filtre, et « liste des établissements… » listait des
// intitulés. Sondage : « combien d'académies proposent des PASS » répondait 67 (le nombre de PASS), « combien de
// communes ont un BTS » 1 212 (le nombre de BTS) — affichés comme calcul exact.
// Garde-fous :
//   1. « J'ai compris : … » en tête de chaque réponse (l'opération calculée, en clair) ;
//   2. objet demandé respecté : établissements, académies, départements, communes, régions comptés comme tels
//      (valeurs différentes), sinon arrêt ;
//   3. relances : un export juste après un résultat filtré garde ses filtres (sauf « toute la table ») ;
//      « donne-moi la liste » sans question précédente : « la liste de quoi ? ».
// Données FICTIVES (js/fixtures/donnees_simulees.mjs) ; chaque valeur attendue est recalculée sur les lignes.
// node js/test_coherence.js

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
    document: { getElementById: noopEl, querySelector: noopEl, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, click() {} }) },
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

const OD = D.openData(3000, 17);
const co = makeCtx();
co.__t = D.tableOpenData(OD);
run(co, "defaultOpenDataTable = __t; defaultOpenDataState = 'ready';");
const qo = asker(co);
const compris = e => (String(e?.html || '').match(/🧭 <strong>J'ai compris<\/strong> : ([^<]*)\./) || [])[1] || '';
const distinct = (pred, k) => new Set(OD.filter(pred).map(k)).size;

await describe('1. « J\'ai compris : … » en tête de chaque réponse', () => {
  for (const [q, re] of [
    ['combien de BTS en Gironde', /^nombre de formations$/],
    ['nombre de places en BTS', /^somme de « Capacité/],
    ['répartition des BTS par académie', /^répartition des formations par « Académie/],
    ['capacité moyenne des BTS', /^moyenne de « Capacité/],
    ['part des boursiers par académie', /^part des admis boursiers parmi les admis néo-bacheliers, calculée dans chaque valeur de « Académie/],
    ['quels établissements proposent un BTS en Gironde', /^liste des établissements/],
    ['combien de lycées proposent des BTS', /^nombre d'établissements différents/],
    ['les 10 BTS les plus sélectifs', /^classement des formations selon/],
  ]) {
    const e = qo(q);
    assert(re.test(compris(e)), `« ${q} » → « J'ai compris : ${compris(e)} »`);
  }
  const e = qo('combien de BTS en Gironde');
  assert(e.html.indexOf("J'ai compris") < e.html.indexOf('Sur quoi porte ce calcul'), 'placé avant le périmètre');
});

await describe('2. Objet demandé : académies, départements, communes comptés comme tels', () => {
  const a = qo("combien d'académies proposent des PASS");
  const att = distinct(o => o.fili === 'PASS', o => o.aca);
  assert(a?.kind === 'count' && a.result.count === att && a.result.valeurs === 'académies', `combien d'académies proposent des PASS : ${att} (avant : le nombre de PASS ; obtenu : ${a?.result?.count})`);
  assert(/nombre de académies différent|nombre d'académies|académies différent/.test(compris(a)) && /académies différentes/.test(a.html), 'le texte dit « académies différentes »');
  const c = qo('combien de communes ont un BTS');
  assert(c?.result?.count === distinct(o => o.fili === 'BTS', o => o.commune), `combien de communes ont un BTS : ${distinct(o => o.fili === 'BTS', o => o.commune)} (avant : le nombre de BTS)`);
  const d = qo('combien de départements ont un BTS MCO');
  assert(d?.result?.count === distinct(o => o.fili === 'BTS' && /Management Commercial Opérationnel/i.test(o.nom), o => o.dep), 'combien de départements ont un BTS MCO');
  const l = qo('quelles académies proposent des PASS');
  assert(l?.kind === 'group_by' && /^Académie/.test(l.plan.targetCol) && l.result.distinct === att, 'quelles académies proposent des PASS : une ligne par académie');
  const f = qo('combien de formations par département');
  assert(f?.kind === 'group_by', 'faux positif : « combien de formations par département » reste une répartition');
  const p = qo('les académies avec le plus de places');
  assert(p?.kind === 'classement', 'faux positif : classement des académies inchangé');
});

await describe('3. Relances : rien de perdu', () => {
  const c = qo('combien de BTS MCO en gironde ?');
  const x = qo('exporte', true);
  assert(x?.kind === 'export' && (x.plan.filters || []).length === (c.plan.filters || []).length, `« exporte » après un résultat filtré : mêmes filtres (obtenu : ${(x?.plan?.filters || []).length})`);
  qo('combien de BTS MCO en gironde ?');
  const t = qo('exporte toute la table', true);
  assert(t?.kind === 'export' && !(t.plan.filters || []).length, '« exporte toute la table » : tout, sans filtre');
  const l = qo('donne moi la liste');
  assert(l?.kind === 'unresolved' && /la liste de quoi/.test(l.text), '« donne moi la liste » sans question précédente : « la liste de quoi ? » (avant : export de toute la table)');
  const e = qo('exporte les BTS en Gironde');
  assert(e?.kind === 'export' && (e.plan.filters || []).length === 2, 'faux positif : un export avec ses propres critères');
});

await describe('Fichier de candidats : lieux de scolarité, objet absent', async () => {
  const ROWS = D.exportAcademique(2000, 21);
  const cf = makeCtx();
  cf.XLSX.read = () => ({ SheetNames: ['BDD'], Sheets: { BDD: 'ws' } });
  cf.XLSX.utils.sheet_to_json = () => ROWS.map(r => r.slice());
  await run(cf, 'importSpreadsheetFile')({ name: 'BDD.xlsx', size: 1000, arrayBuffer: async () => new ArrayBuffer(8) });
  const qf = asker(cf);
  const L = ROWS.slice(1);
  const c = qf('combien de communes ont des boursiers');
  assert(c?.result?.count === new Set(L.filter(r => r[9] === 'Boursier des lycées').map(r => r[2])).size, 'combien de communes (de scolarité) ont des boursiers');
  const a = qf("combien d'académies accueillent des candidats en BTS");
  assert(a?.result?.count === new Set(L.filter(r => r[17].startsWith('BTS') && r[18]).map(r => r[18])).size, "combien d'académies accueillent des candidats en BTS : académies d'accueil");
  const r = qf('combien de régions ont des candidats admis');
  assert(r?.kind === 'unresolved' && /vous demandez des régions/.test(r.text), 'pas de colonne région : arrêt « vous demandez des régions »');
  assert(/candidats \(lignes du fichier\)/.test(compris(qf('combien de boursiers'))), '« J\'ai compris : nombre de candidats » sur un fichier');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
