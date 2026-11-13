// test_serie13.js — Série 13 : spécialités du lycée combinées (« ou »), comparaisons de formations.
// Réponses fausses données comme exactes (avant) :
// - « combien de candidats ont suivi SES ou HGGSP » : les deux spécialités exigées (2 223 au lieu de 8 390 sur le vrai fichier) ;
// - « comparer les admis en CPGE et en BTS » : « Admis : 0 / Non admis : 0 » ;
// - « comparer les CPGE et les BTS » : 0 / 0 (intitulé « contenant CPGE et BTS » ajouté aux deux groupes) ;
// - « comparer les boursiers admis en CPGE et en BTS » : « Boursiers : 0 / Non-boursiers : 0 ».
// Open data : « comparer les BTS et les BUT en Gironde » calculé (avant : Albert) ; « comparer le nombre de PLACES en BTS
// et en BUT » : arrêt (une comparaison compte des formations, pas des places).
// Données FICTIVES (js/fixtures/donnees_simulees.mjs) ; chaque valeur attendue est recalculée sur les lignes.
// node js/test_serie13.js

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

const ROWS = D.exportAcademique(3000, 21);
const L = ROWS.slice(1);
// v27.5.82 — définition SAIO : un « candidat » a confirmé au moins un vœu (colonne 16 non vide et ≥ 1). Les questions qui
// disent « candidats », et les taux de proposition / d'admission, portent sur LC ; les autres sur tout le fichier (L).
const CAND = r => String(r[16] ?? '').trim() !== '' && Number(r[16]) >= 1;
const LC = L.filter(CAND);
const nfc = f => LC.filter(f).length;
const cf = makeCtx();
cf.XLSX.read = () => ({ SheetNames: ['BDD'], Sheets: { BDD: 'ws' } });
cf.XLSX.utils.sheet_to_json = () => ROWS.map(r => r.slice());
await run(cf, 'importSpreadsheetFile')({ name: 'BDD.xlsx', size: 1000, arrayBuffer: async () => new ArrayBuffer(8) });
const qf = asker(cf);
const nf = f => L.filter(f).length;
const ADM = 7, BOURS = 9, SPE = 15, GRP = 17;
const spe = r => String(r[SPE] || '').split('|').map(x => x.trim());
const B = r => r[BOURS] === 'Boursier des lycées';
const CPGE = r => r[GRP] === 'CPGE - CPES', BTS = r => r[GRP] === 'BTS - BTSA - DTS - DMA';
const SES = r => spe(r).includes('Sciences Economiques et Sociales'), HG = r => spe(r).some(x => /^Histoire-Géographie/.test(x));
const v = e => !e ? 'pas de calcul' : e.kind === 'unresolved' ? 'arrêt' : e.kind === 'count' ? e.result.count : e.kind === 'compare' ? e.result.rows.map(r => `${r.label}:${r.count}`).join(' / ') : e.kind;

await describe('Spécialités du lycée : « ou » = l\'une ou l\'autre', () => {
  assert(nf(r => SES(r) && HG(r)) > 0 && nf(r => SES(r) || HG(r)) > nf(r => SES(r) && HG(r)), 'jeu de données : des candidats ont l\'une, l\'autre, ou les deux');
  assert(v(qf('combien de candidats ont suivi SES ou HGGSP')) === nfc(r => SES(r) || HG(r)), `SES ou HGGSP : ${nfc(r => SES(r) || HG(r))} (obtenu : ${v(qf('combien de candidats ont suivi SES ou HGGSP'))} ; avant : ${nfc(r => SES(r) && HG(r))}, les deux)`);
  assert(v(qf('combien de candidats ont suivi SES et HGGSP')) === nfc(r => SES(r) && HG(r)), 'faux positif : « SES et HGGSP » = les deux');
  const MP = r => spe(r).includes('Mathématiques') || spe(r).some(x => /^Physique-Chimie/.test(x));
  assert(v(qf('combien de candidats ayant suivi maths ou physique admis en CPGE')) === nfc(r => r[ADM] === 'Oui' && CPGE(r) && MP(r)), '« maths ou physique » admis en CPGE');
});

await describe('Comparer deux formations (fichier de candidats)', () => {
  const ad = r => r[ADM] === 'Oui';
  assert(v(qf('comparer les admis en CPGE et en BTS')) === `CPGE - CPES:${nf(r => ad(r) && CPGE(r))} / BTS - BTSA - DTS - DMA:${nf(r => ad(r) && BTS(r))}`, `admis en CPGE et en BTS (avant : Admis 0 / Non admis 0 ; obtenu : ${v(qf('comparer les admis en CPGE et en BTS'))})`);
  assert(v(qf('comparer les CPGE et les BTS')) === `CPGE - CPES:${nf(CPGE)} / BTS - BTSA - DTS - DMA:${nf(BTS)}`, `CPGE et BTS (avant : 0 / 0 ; obtenu : ${v(qf('comparer les CPGE et les BTS'))})`);
  assert(v(qf('comparer les boursiers admis en CPGE et en BTS')) === `CPGE - CPES:${nf(r => B(r) && ad(r) && CPGE(r))} / BTS - BTSA - DTS - DMA:${nf(r => B(r) && ad(r) && BTS(r))}`, `boursiers admis en CPGE et en BTS (avant : Boursiers 0 / Non-boursiers 0)`);
  assert(v(qf('comparer boursiers et non boursiers')) === `Boursiers:${nf(B)} / Non-boursiers:${nf(r => !B(r))}`, 'faux positif : « boursiers et non boursiers » inchangé');
  assert(v(qf('comparer les boursiers et non boursiers admis en CPGE')) === `Boursiers:${nf(r => B(r) && ad(r) && CPGE(r))} / Non-boursiers:${nf(r => !B(r) && ad(r) && CPGE(r))}`, 'faux positif : une seule formation, boursiers contre non-boursiers');
  assert(v(qf('comparer admis et non admis')) === `Admis:${nf(ad)} / Non admis:${nf(r => r[ADM] === 'Non')}`, 'faux positif : « admis et non admis » inchangé');
});

const OD = D.openData(3000, 17);
const co = makeCtx();
co.__t = D.tableOpenData(OD);
run(co, "defaultOpenDataTable = __t; defaultOpenDataState = 'ready';");
const qo = asker(co);
const n = f => OD.filter(f).length;

await describe('Comparer deux filières (open data)', () => {
  assert(v(qo('comparer les BTS et les BUT en Gironde')) === `BTS:${n(o => o.fili === 'BTS' && o.dep === 'Gironde')} / BUT:${n(o => o.fili === 'BUT' && o.dep === 'Gironde')}`, 'BTS et BUT en Gironde (avant : Albert, sans calcul)');
  assert(v(qo('comparer les CPGE et les licences')) === `CPGE:${n(o => o.fili === 'CPGE')} / Licence:${n(o => o.fili === 'Licence')}`, 'CPGE et licences');
  assert(v(qo('comparer le nombre de places en BTS et en BUT')) === 'arrêt', 'places : arrêt (une comparaison compte des formations, pas des places)');
  assert(v(qo('compare le nombre de BTS en Gironde et dans les Landes')) === `Gironde:${n(o => o.fili === 'BTS' && o.dep === 'Gironde')} / Landes:${n(o => o.fili === 'BTS' && o.dep === 'Landes')}`, 'faux positif : « nombre de BTS » (des formations) comparé entre deux lieux');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
