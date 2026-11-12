// test_serie3.js — Série 3 de questions nouvelles (12/11/2026) : erreurs trouvées et corrigées.
// Réponses fausses données comme exactes (avant) :
// - « combien de formations en Gironde sauf les BTS » : les BTS SEULS (la négation avec article était ignorée) ;
// - « quel pourcentage des candidats boursiers ont accepté une proposition » : rapporté à tout le fichier (35 286)
//   au lieu des boursiers ;
// - « combien de candidats de Pau » puis « et de Bayonne ? » : le chiffre de Pau redonné ; « et à Bayonne ? » cumulait
//   Pau (scolarité) et Bayonne (accueil) ;
// - « combien de candidats admis en BTS de Pau » : Pau perdu (tous les admis en BTS) ;
// - comparaison de deux lieux : critère commun (BTS) perdu ; « comparer les boursiers de Pau et de Bayonne » donnait
//   boursiers contre non-boursiers.
// Questions non traitées (avant : arrêt ou Albert) : énumération de 3 valeurs (« Bordeaux, Toulouse et Poitiers »),
// « en moyenne combien de places a un BUT », « je cherche les IFSI de… », « comparer la Gironde et les Landes ».
// Données FICTIVES (js/fixtures/donnees_simulees.mjs) ; chaque valeur attendue est recalculée sur les lignes.
// node js/test_serie3.js

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
const conv = (ask, qs) => qs.map((q, i) => ask(q, i > 0));

// ── Open data (une ligne = une formation) ──
const OD = D.openData(3000, 17);
const co = makeCtx();
co.__t = D.tableOpenData(OD);
run(co, "defaultOpenDataTable = __t; defaultOpenDataState = 'ready';");
const qo = asker(co);
const n = f => OD.filter(f).length;

// ── Fichier de candidats ──
const H = D.EXPORT_ACADEMIQUE_ENTETES;
const ROWS = D.exportAcademique(3000, 21);
const L = ROWS.slice(1);
const cf = makeCtx();
cf.XLSX.read = () => ({ SheetNames: ['BDD'], Sheets: { BDD: 'ws' } });
cf.XLSX.utils.sheet_to_json = () => ROWS.map(r => r.slice());
await run(cf, 'importSpreadsheetFile')({ name: 'BDD.xlsx', size: 1000, arrayBuffer: async () => new ArrayBuffer(8) });
const qf = asker(cf);
const nf = f => L.filter(f).length;
const ORI = 2, ACC = 21, PROP = 6, ADM = 7, BOURS = 9, GRP = 17;
const estBoursier = r => /^boursier/i.test(String(r[BOURS])) && !/non/i.test(String(r[BOURS]));

await describe('Négation avec article : « sauf les BTS », « à l\'exception des BTS »', () => {
  const att = n(o => o.dep === 'Gironde' && o.fili !== 'BTS');
  for (const q of ['combien de formations en Gironde sauf les BTS', 'combien de formations en Gironde à l\'exception des BTS', 'combien de formations en Gironde en dehors des BTS']) {
    const e = qo(q);
    assert(e?.kind === 'count' && e.result.count === att, `« ${q} » : ${att} (obtenu : ${e?.result?.count} ; avant : les BTS seuls, ${n(o => o.dep === 'Gironde' && o.fili === 'BTS')})`);
  }
  const p = qo('combien de BTS en Gironde');
  assert(p?.result?.count === n(o => o.dep === 'Gironde' && o.fili === 'BTS'), 'faux positif : « combien de BTS en Gironde » reste les BTS');
});

await describe('Taux « des candidats X ayant / qui ont Y » : rapporté aux X', () => {
  const B = L.filter(estBoursier);
  for (const [q, col] of [['quel pourcentage des candidats boursiers ont accepté une proposition', ADM], ['part des boursiers ayant eu une proposition', PROP]]) {
    const e = qf(q);
    const num = B.filter(r => r[col] === 'Oui').length;
    assert(e?.kind === 'part' && e.result.num === num && e.result.den === B.length, `« ${q} » : ${num} / ${B.length} (obtenu : ${e?.result?.num} / ${e?.result?.den} ; avant : / ${L.length})`);
  }
});

await describe('Relance de lieu : « et de Bayonne ? », « et à Bayonne ? »', () => {
  const pau = nf(r => r[ORI] === 'Pau'), bay = nf(r => r[ORI] === 'Bayonne');
  const [a, b] = conv(qf, ['combien de candidats de Pau', 'et de Bayonne ?']);
  assert(a?.result?.count === pau && b?.result?.count === bay, `Pau ${pau} puis Bayonne ${bay} (obtenu : ${a?.result?.count} puis ${b?.result?.count} ; avant : ${pau} redonné)`);
  const [, c] = conv(qf, ['combien de candidats de Pau', 'et à Bayonne ?']);
  assert(c?.result?.count === bay && (c.plan.filters || []).length === 1 && c.plan.filters[0].col === H[ORI], `« et à Bayonne ? » : même colonne (scolarité), ${bay} (obtenu : ${c?.result?.count})`);
  const [, d] = conv(qo, ['combien de BTS en Gironde', 'et en Dordogne ?']);
  assert(d?.result?.count === n(o => o.fili === 'BTS' && o.dep === 'Dordogne'), 'open data : « et en Dordogne ? » garde BTS, change le département');
  const [, x] = conv(qf, ['combien de candidats admis à Pau', 'et à Toulouse ?']);
  assert(x?.result?.count === nf(r => r[ADM] === 'Oui' && r[ACC] === 'Toulouse'), '« admis à Pau » puis « et à Toulouse ? » : commune d\'accueil, admis gardé');
});

await describe('« admis en BTS de Pau » : la commune n\'est plus perdue', () => {
  const att = nf(r => r[ADM] === 'Oui' && /^BTS/.test(r[GRP]) && r[ACC] === 'Pau');
  const e = qf('combien de candidats admis en BTS de Pau');
  assert(e?.result?.count === att, `${att} (obtenu : ${e?.result?.count} ; avant : ${nf(r => r[ADM] === 'Oui' && /^BTS/.test(r[GRP]))}, tous les admis en BTS)`);
  const f = qf('combien de candidats de Pau');
  assert(f?.result?.count === nf(r => r[ORI] === 'Pau'), 'faux positif : « candidats de Pau » reste la commune de scolarité');
  const g = qf('combien de candidats de l\'académie de Bordeaux');
  assert(g?.kind === 'count' && !(g.plan.filters || []).some(x => /Commune/.test(x.col)), 'faux positif : « l\'académie de Bordeaux » ne devient pas une commune');
});

await describe('Énumération de 3 valeurs ou plus', () => {
  const aca = new Set(['Bordeaux', 'Toulouse', 'Poitiers']);
  const e = qo('combien de BUT dans les académies de Bordeaux, Toulouse et Poitiers');
  assert(e?.kind === 'count' && e.result.count === n(o => o.fili === 'BUT' && aca.has(o.aca)), `3 académies : ${n(o => o.fili === 'BUT' && aca.has(o.aca))} (obtenu : ${e?.kind} ${e?.result?.count} ; avant : arrêt)`);
  const deps = new Set(['Gironde', 'Landes', 'Dordogne']);
  const d = qo('nombre de BTS en Gironde, Landes et Dordogne');
  assert(d?.result?.count === n(o => o.fili === 'BTS' && deps.has(o.dep)), '3 départements');
  const com = new Set(['Bordeaux', 'Pau', 'Bayonne']);
  const c = qo('combien de BTS à Bordeaux, Pau et Bayonne');
  assert(c?.result?.count === n(o => o.fili === 'BTS' && com.has(o.commune)) && (c.plan.filters || []).length === 2, '3 communes : sans filtre « académie = Bordeaux » en trop');
  const fil = new Set(['BTS', 'BUT', 'CPGE']);
  const fi = qo('combien de BTS, BUT et CPGE à Bordeaux');
  assert(fi?.result?.count === n(o => fil.has(o.fili) && o.commune === 'Bordeaux'), '3 filières : l\'une ou l\'autre (pas « intitulé contenant BTS ET BUT ET CPGE »)');
  const cand = qf('combien de candidats admis à Bordeaux, Pau et Toulouse');
  assert(cand?.result?.count === nf(r => r[ADM] === 'Oui' && ['Bordeaux', 'Pau', 'Toulouse'].includes(r[ACC])), 'fichier de candidats : « admis à … » = communes d\'accueil');
  const ori = qf('combien de candidats de Pau, Talence et Bayonne');
  assert(ori?.result?.count === nf(r => ['Pau', 'Talence', 'Bayonne'].includes(r[ORI])), '« candidats de … » = communes de scolarité');
  const deux = qo('combien de BUT dans les académies de Bordeaux et Toulouse');
  assert(deux?.result?.count === n(o => o.fili === 'BUT' && (o.aca === 'Bordeaux' || o.aca === 'Toulouse')), 'faux positif : deux valeurs (« et ») inchangées');
  const virg = qo('combien de BTS en Gironde, au total');
  assert(virg?.result?.count === n(o => o.fili === 'BTS' && o.dep === 'Gironde'), 'faux positif : une virgule sans énumération');
});

await describe('« combien de places en moyenne » : la capacité', () => {
  const caps = OD.filter(o => o.fili === 'BUT').map(o => Number(o.capa)).filter(Number.isFinite);
  const moy = caps.reduce((a, b) => a + b, 0) / caps.length;
  const e = qo('en moyenne combien de places a un BUT');
  assert(e?.kind === 'stats' && Math.abs(e.result.avg - moy) < 1e-9, `moyenne ${moy.toFixed(2)} (obtenu : ${e?.kind} ${e?.result?.avg} ; avant : arrêt)`);
});

await describe('« je cherche les IFSI de … » : la liste des établissements', () => {
  const e = qo('je cherche les BTS MCO en Gironde');
  const etabs = new Set(OD.filter(o => o.fili === 'BTS' && /Management Commercial Opérationnel/i.test(o.nom) && o.dep === 'Gironde').map(o => `${o.etab}|${o.commune}`));
  assert(e?.kind === 'group_by' && /^Établissement/.test(e.plan.targetCol) && new RegExp(`<strong>${etabs.size}</strong> établissement`).test(e.html), `${etabs.size} établissements (obtenu : ${e?.kind} ; avant : Albert, sans calcul)`);
  for (const q of ['je cherche des informations sur Parcoursup', 'je cherche les dates de Parcoursup']) {
    assert(!run(co, 'isDataEngineQuestion')(q), `faux positif : « ${q} » reste pour Albert`);
  }
});

await describe('Comparer deux lieux', () => {
  const e = qo('compare le nombre de BTS en Gironde et dans les Landes');
  const arr = e?.result?.rows || [];
  const gi = arr.find(x => x.label === 'Gironde'), la = arr.find(x => x.label === 'Landes');
  assert(e?.kind === 'compare' && gi?.count === n(o => o.fili === 'BTS' && o.dep === 'Gironde') && la?.count === n(o => o.fili === 'BTS' && o.dep === 'Landes'), `BTS Gironde ${n(o => o.fili === 'BTS' && o.dep === 'Gironde')} / Landes ${n(o => o.fili === 'BTS' && o.dep === 'Landes')} (BTS gardé ; obtenu : ${gi?.count} / ${la?.count})`);
  const b = qf('comparer les boursiers de Pau et de Bayonne');
  const bg = b?.result?.rows || [];
  assert(b?.kind === 'compare' && bg.map(x => x.label).join('/') === 'Pau/Bayonne' && bg[0].count === nf(r => estBoursier(r) && r[ORI] === 'Pau'), `boursiers de Pau contre Bayonne (avant : boursiers contre non-boursiers ; obtenu : ${bg.map(x => `${x.label} ${x.count}`).join(' / ')})`);
  const nb = qf('comparer boursiers et non boursiers');
  const ng = nb?.result?.rows || [];
  assert(nb?.kind === 'compare' && /Boursiers/.test(ng[0]?.label || '') && ng[0].count === nf(estBoursier), 'faux positif : « boursiers et non boursiers » reste boursiers contre non-boursiers');
});

await describe('v27.5.65 — « quels lycées envoient le plus de candidats en école de commerce » : les lycées d\'origine', () => {
  const c = new Map();
  L.filter(r => r[GRP] === 'Ecoles de commerce').forEach(r => c.set(r[4], (c.get(r[4]) || 0) + 1));
  const top = [...c].sort((a, b) => b[1] - a[1])[0];
  for (const q of ['quels lycées envoient le plus de candidats en école de commerce', 'quels lycées ont le plus de candidats admis en école de commerce']) {
    const e = qf(q);
    assert(e?.kind === 'top' && e.plan.targetCol === H[4] && e.result.rows[0].value === top[0] && e.result.rows[0].count === top[1], `« ${q} » : ${top[0]} (${top[1]}) en tête (obtenu : ${e?.plan?.targetCol} ${e?.result?.rows?.[0]?.value} ${e?.result?.rows?.[0]?.count} ; avant : les écoles d'accueil)`);
  }
  const u = qf('quelles écoles accueillent le plus de candidats');
  assert(u?.kind === 'top' && u.plan.targetCol === H[20], 'faux positif : « quelles écoles accueillent… » reste l\'établissement d\'accueil');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
