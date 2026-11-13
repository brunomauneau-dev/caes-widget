// test_serie18.js — Série 18 : « par spécialité » dans un fichier de candidats (trois colonnes possibles).
// Avant : toujours la spécialité du bac pro (presque vide : « admis en PASS par spécialité » = 3 lignes), « par spécialité
// de la formation » aussi ; « par enseignement de spécialité » groupait les COMBINAISONS (« Maths | PC ») ; « suivie au
// lycée », « en terminale » : arrêt.
// Maintenant : le contexte décide (enseignement / lycée / terminale → enseignements suivis, comptés un par un ; formation /
// accueil / mention → la formation d'accueil ; bac pro → la spécialité du bac) ; sans indice, le widget demande de préciser.
// Données FICTIVES (js/fixtures/donnees_simulees.mjs) ; chaque valeur attendue est recalculée sur les lignes.
// node js/test_serie18.js

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
const H = D.EXPORT_ACADEMIQUE_ENTETES;
const cf = makeCtx();
cf.XLSX.read = () => ({ SheetNames: ['BDD'], Sheets: { BDD: 'ws' } });
cf.XLSX.utils.sheet_to_json = () => ROWS.map(r => r.slice());
await run(cf, 'importSpreadsheetFile')({ name: 'BDD.xlsx', size: 1000, arrayBuffer: async () => new ArrayBuffer(8) });
const qf = asker(cf);
const ADM = 7, SPE_BAC = 14, ENS = 15, GRP = 17, MENTION = 19;
const lignes = e => Object.fromEntries((e?.result?.rows || []).map(r => [r.value, r.count]));
const eclate = rows => { const m = {}; rows.forEach(r => [...new Set(String(r[ENS] || '').split('|').map(x => x.trim().replace(/^Msgn\/\s*/, '')).filter(Boolean))].forEach(x => { m[x] = (m[x] || 0) + 1; })); return m; };
const simple = (rows, k) => { const m = {}; rows.forEach(r => { if (r[k] === '' || r[k] == null) return; m[r[k]] = (m[r[k]] || 0) + 1; }); return m; };
const inclus = (a, b) => Object.entries(a).every(([k, v]) => b[k] === v);
const CPGE = r => r[ADM] === 'Oui' && r[GRP] === 'CPGE - CPES';

await describe('Enseignements de spécialité : comptés un par un', () => {
  for (const q of ['répartition des admis en CPGE par spécialité suivie au lycée', 'répartition des admis en CPGE par enseignement de spécialité']) {
    const e = qf(q);
    assert(e?.kind === 'group_by' && e.plan.targetCol === H[ENS] && inclus(lignes(e), eclate(L.filter(CPGE))) && !Object.keys(lignes(e)).some(k => k.includes('|')), `« ${q} » : chaque spécialité comptée (avant : combinaisons, ou arrêt) (obtenu : ${e?.kind} ${e?.plan?.targetCol})`);
    assert(/compté dans chacune/.test(e.html), '   … et le texte dit qu\'un candidat compte dans chacune de ses spécialités');
  }
  const t = qf('combien de candidats par spécialité en terminale');
  assert(t?.kind === 'group_by' && inclus(lignes(t), eclate(LC)), '« par spécialité en terminale » : enseignements suivis (avant : arrêt)');
});

await describe('Formation d\'accueil, bac pro, ou demande de précision', () => {
  const a = qf('répartition des admis en licence par spécialité de la formation');
  assert(a?.kind === 'group_by' && a.plan.targetCol === H[MENTION] && inclus(lignes(a), simple(L.filter(r => r[ADM] === 'Oui' && r[GRP] === 'L1 - CUPGE - DEUST - DU'), MENTION)), `« par spécialité de la formation » : la mention d'accueil (avant : spécialité du bac pro ; obtenu : ${a?.plan?.targetCol})`);
  const b = qf('répartition des bacheliers pro par spécialité');
  assert(b?.kind === 'group_by' && b.plan.targetCol === H[SPE_BAC], '« bacheliers pro par spécialité » : la spécialité du bac');
  for (const q of ['répartition des candidats par spécialité', 'répartition des admis en PASS par spécialité']) {
    const e = qf(q);
    assert(e?.kind === 'unresolved' && /précisez/.test(e.text) && /enseignements de spécialité/.test(e.text), `« ${q} » : ambigu, le widget demande de préciser (avant : la spécialité du bac pro)`);
  }
});

await describe('Faux positifs', () => {
  const s = qf('combien de candidats ayant suivi SVT');
  assert(s?.kind === 'count', '« ayant suivi SVT » reste un comptage');
  const r = qf('répartition des admis par grand groupe de formation');
  assert(r?.kind === 'group_by' && r.plan.targetCol === H[GRP], '« par grand groupe de formation » inchangé');
  const co = makeCtx();
  co.__t = D.tableOpenData(D.openData(1000, 17));
  run(co, "defaultOpenDataTable = __t; defaultOpenDataState = 'ready';");
  assert(run(co, '_dimensionSpecialite')(co.__t, 'répartition des BTS par spécialité') === null, 'open data (une seule notion de spécialité) : pas de demande de précision');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
