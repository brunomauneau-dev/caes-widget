// test_fautes_frappe.js — Fautes de frappe sur les mots du calcul (open data et fichiers).
// « capaciité totale des BTS », « combien de candidatues », « liste des établisesments » : la mesure ou la liste était
// perdue (des formations comptées au lieu d'additionner des places). Correction quand UN SEUL mot du vocabulaire du
// calcul est à une lettre près (deux pour les mots de 11 lettres ou plus) ; mot proche de deux mots : le widget demande ;
// noms de lieux et de formations jamais corrigés (un lieu inconnu arrête le calcul). Données fictives.
// Banc v27.5.104 (questions déformées au hasard) : 25 chiffres faux sur 1 600 avant, 0 sur 4 000 après.
// node js/test_fautes_frappe.js

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

// ─── Widget chargé comme dans le navigateur (modules ensemble) ───────────────
function makeCtx() {
  const noopEl = () => null;
  const ctx = {
    console: { ...console, log() {}, warn() {}, info() {} },
    setTimeout: () => null, clearTimeout() {}, URLSearchParams, TextDecoder, TextEncoder,
    document: { getElementById: noopEl, querySelector: noopEl, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => Promise.reject(new Error('hors ligne')),
    escapeHtml: s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  };
  ctx.XLSX = { utils: { json_to_sheet: () => ({}), book_new: () => ({}), book_append_sheet() {}, sheet_to_csv: () => '' }, writeFile() {} };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.selectedDocIds = new Set();
  vm.createContext(ctx);
  for (const f of ['config.js', 'knowledge.js', 'documents.js', 'planner.js', 'dataEngine.js', 'sessions.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
  }
  ctx.resetContextSilent = () => {};
  return ctx;
}
const run = (ctx, code) => vm.runInContext(code, ctx);
function ask(ctx, q) {
  run(ctx, 'window.__DATA_ENGINE_STATE = { lastPlan: null, lastExecution: null, history: [] }');
  ctx.__q = q;
  const plan = run(ctx, 'isDataEngineQuestion(__q)') ? run(ctx, 'detectDataEnginePlan(__q)') : null;
  return plan ? run(ctx, 'runDataEnginePlan')(plan, []) : null;
}
const OD = D.openData(4000, 23);
const c = makeCtx(); c.__t = D.tableOpenData(OD);
run(c, "defaultOpenDataTable = __t; defaultOpenDataState = 'ready';");
const corrige = q => { c.__q = q; return run(c, 'corrigerFautesFrappe(__q)'); };
const somme = (pred, k) => OD.filter(pred).reduce((t, o) => t + o[k], 0);
const valeur = e => !e ? null : e.kind === 'unresolved' ? 'arrêt' : e.kind === 'sum' ? e.result.sum : e.kind === 'count' ? e.result.count : e.kind;

await describe('Correction des mots du calcul (une seule possibilité)', () => {
  assert(corrige('capaciité totale des BTS') === 'capacité totale des BTS', '« capaciité » → capacité');
  assert(corrige('capactié totale des IFSI') === 'capacité totale des IFSI', '« capactié » (lettres inversées) → capacité');
  assert(/établissements?/.test(corrige('liste des établisesments proposant des BTS')), '« établisesments » → établissements');
  assert(/candidatures/.test(corrige('combien de candidaturees en BTS')), '« candidaturees » → candidatures (pas une flexion)');
  assert(corrige('combien de BTS du publiic') === 'combien de BTS du public', '« publiic » → public');
});

await describe('Mots justes jamais modifiés (faux positifs)', () => {
  for (const q of ['je cherche des informations sur Parcoursup', 'compare boursiers et non boursiers', 'combien de formations sans sélection', "combien d'élèves ont demandé le lycée Montaigne", 'combien de BTS en Gironde', 'quelles licences de psychologie à Bordeaux'])
    assert(corrige(q) === q, `« ${q} » inchangée`);
  // noms de lieux et de formations : jamais corrigés (un lieu inconnu doit arrêter le calcul, pas devenir un autre lieu)
  assert(corrige('combien de BTS à Bordau') === 'combien de BTS à Bordau', 'nom de lieu mal écrit : non corrigé');
  assert(valeur(ask(c, 'combien de BTS à Bordau')) === 'arrêt', '… et le calcul s’arrête');
});

await describe('Les chiffres : la mesure et la liste ne sont plus perdues', () => {
  // avant : 7 formations comptées au lieu de la somme des places
  const pTour = o => o.fili === 'BTS' && o.detail === 'Tourisme' && o.statut === 'Public' && o.dep === 'Landes';
  assert(valeur(ask(c, 'capaciité totale des bts tourisme publics dans les landes')) === somme(pTour, 'capa'), 'capaciité totale : somme des places');
  const pIfsi = o => o.fili === 'IFSI' && o.statut !== 'Public' && o.commune === 'Bordeaux';
  assert(valeur(ask(c, 'capactié totale des IFSI privés a Bordeaux')) === somme(pIfsi, 'capa'), 'capactié totale : somme des places');
  const juste = ask(c, 'combien de candidatures pour les STAPS du public en Nouvelle-Aquitaine'), faute = ask(c, 'combien de candidaturees pour les STAPS du public en Nouvelle-Aquitaine');
  assert(faute?.kind === 'sum' && valeur(faute) === valeur(juste), 'candidaturees : même somme que « candidatures » (avant : des formations comptées)');
  const ndrc = o => o.fili === 'BTS' && o.detail === 'Négociation et Digitalisation de la Relation Client' && o.dep === 'Gironde';
  assert(valeur(ask(c, 'capacité totale des BTS NDRC du publiic en Gironde')) === somme(o => ndrc(o) && o.statut === 'Public', 'capa'), '« publiic » : le statut est gardé (avant : tous les statuts)');
  const liste = ask(c, 'liste des établisesments proposant des CPGE ECG privés en Gironde');
  const att = [...new Set(OD.filter(o => o.fili === 'CPGE' && /^ECG/.test(o.detail) && o.statut !== 'Public' && o.dep === 'Gironde').map(o => o.etab))].sort();
  assert(liste && JSON.stringify((liste.result?.rows || []).map(x => x.value).sort()) === JSON.stringify(att), 'établisesments : la liste des établissements (avant : des intitulés)');
});

await describe('Mot proche de deux mots : le widget demande', () => {
  const e = ask(c, 'combien de candidatues pour les BTS MCO du privé dans les Landes');
  assert(e?.kind === 'unresolved' && /candidatures/.test(e.text) && /candidates/.test(e.text), '« candidatues » : candidatures ou candidates ? (avant : des formations comptées)');
  // « pirés » (pour « privés ») est aussi un vrai mot (« les pires ») : seul le superlatif est ignoré
  assert(valeur(ask(c, 'il y a combien de bts ndrc pirés en Gironde')) === 'arrêt', '« BTS pirés » : arrêt (avant : tous les statuts)');
});

await describe('Fichier de candidats : inchangé', () => {
  const ca = makeCtx();
  const ROWS = D.exportAcademique(800, 21);
  ca.XLSX.read = () => ({ SheetNames: ['BDD'], Sheets: { BDD: 'ws' } });
  ca.XLSX.utils.sheet_to_json = () => ROWS.map(r => r.slice());
  return run(ca, 'importSpreadsheetFile')({ name: 'BDD.xlsx', size: 1000, arrayBuffer: async () => new ArrayBuffer(8) }).then(() => {
    const a = ask(ca, 'combien de candidats boursiers'), b = ask(ca, 'combien de candidats boursiers ');
    assert(a && a.kind === b?.kind && valeur(a) === valeur(b) && valeur(a) !== 'arrêt', 'question juste : même réponse');
  });
});

console.log(`\n${'─'.repeat(50)}\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
