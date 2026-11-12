// test_serie12.js — Série 12 : vœux et moyennes « par formation / par lycée ».
// Réponses fausses données comme exactes (avant) :
// - « nombre total de vœux confirmés » : le nombre de candidats (fichier de candidats) ;
// - « combien de candidats ont fait entre 5 et 10 vœux » : tout le fichier (condition perdue) ;
// - « quel lycée a le plus de vœux en moyenne » : classement sur le TOTAL ;
// - « nombre moyen de candidats par formation en BTS » : une moyenne par intitulé ; « nombre moyen d'admis par formation » :
//   la moyenne des capacités.
// Non traitées (avant : arrêt) : « nombre moyen de vœux par lycée », « un seul vœu », « candidats en moyenne par BTS ».
// Garde-fou gardé : « candidats sans vœu » quand la colonne est vide (pas à 0) : arrêt, pas « 0 ».
// Données FICTIVES (js/fixtures/donnees_simulees.mjs) ; chaque valeur attendue est recalculée sur les lignes.
// node js/test_serie12.js

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

const v = e => !e ? 'pas de calcul' : e.kind === 'unresolved' ? 'arrêt' : e.kind === 'count' ? e.result.count : e.kind === 'sum' ? e.result.sum : e.kind === 'stats' ? Math.round(e.result.avg * 1e6) / 1e6 : e.kind;
const moy = a => Math.round(a.reduce((s, x) => s + x, 0) / a.length * 1e6) / 1e6;

// ── Fichier de candidats (vœux : quelques cases vides, comme dans les vrais exports) ──
const ROWS = D.exportAcademique(3000, 21).map((r, i) => i > 0 && i % 23 === 0 ? r.map((c, k) => k === 16 ? '' : c) : r);
const L = ROWS.slice(1);
const H = D.EXPORT_ACADEMIQUE_ENTETES;
const cf = makeCtx();
cf.XLSX.read = () => ({ SheetNames: ['BDD'], Sheets: { BDD: 'ws' } });
cf.XLSX.utils.sheet_to_json = () => ROWS.map(r => r.slice());
await run(cf, 'importSpreadsheetFile')({ name: 'BDD.xlsx', size: 1000, arrayBuffer: async () => new ArrayBuffer(8) });
const qf = asker(cf);
const VX = 16, ETAB = 4, BOURS = 9;
const nb = r => (r[VX] === '' || r[VX] === null || r[VX] === undefined) ? null : Number(r[VX]);
const avec = L.filter(r => nb(r) !== null);

await describe('Fichier de candidats : vœux', () => {
  const tot = avec.reduce((s, r) => s + nb(r), 0);
  const e = qf('nombre total de vœux confirmés');
  assert(e?.kind === 'sum' && e.result.sum === tot, `nombre total de vœux : ${tot} (obtenu : ${v(e)} ; avant : ${L.length}, le nombre de candidats)`);
  const b = qf('combien de vœux au total pour les boursiers');
  assert(v(b) === avec.filter(r => r[BOURS] === 'Boursier des lycées').reduce((s, r) => s + nb(r), 0), 'vœux des boursiers : somme');
  assert(v(qf('combien de candidats ont fait entre 5 et 10 vœux')) === avec.filter(r => nb(r) >= 5 && nb(r) <= 10).length, 'entre 5 et 10 vœux, bornes comprises (avant : tout le fichier)');
  assert(v(qf('combien de candidats ont fait de 5 à 10 vœux')) === avec.filter(r => nb(r) >= 5 && nb(r) <= 10).length, '« de 5 à 10 vœux »');
  assert(v(qf('combien de candidats ont fait un seul vœu')) === avec.filter(r => nb(r) === 1).length, 'un seul vœu (avant : arrêt)');
  assert(v(qf('combien de candidats n\'ont qu\'un vœu')) === avec.filter(r => nb(r) === 1).length, '« n\'ont qu\'un vœu »');
  assert(v(qf('combien de candidats ont fait plus de 20 vœux')) === avec.filter(r => nb(r) > 20).length, 'faux positif : « plus de 20 vœux » reste un comptage de candidats');
  assert(v(qf('combien de candidats sans vœu')) === 'arrêt', 'colonne vide (pas de 0) : « sans vœu » s\'arrête, pas « 0 » affiché comme exact');
  assert(qf('combien de vœux au maximum')?.kind === 'stats', 'faux positif : « combien de vœux au maximum » reste une statistique');
});

await describe('Fichier de candidats : moyenne par lycée, classement sur la moyenne', () => {
  const parLycee = {};
  avec.forEach(r => { (parLycee[r[ETAB]] = parLycee[r[ETAB]] || []).push(nb(r)); });
  const e = qf('nombre moyen de vœux par lycée');
  assert(e?.kind === 'stats_groupes' && e.result.dim === H[ETAB] && e.result.groupes.every(g => Math.abs(g.avg - moy(parLycee[g.valeur])) < 1e-6), `une moyenne par lycée d'origine (avant : arrêt ; obtenu : ${e?.kind} ${e?.result?.dim})`);
  const meilleur = Object.entries(parLycee).map(([k, a]) => [k, moy(a)]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'))[0];
  const c = qf('quel lycée a le plus de vœux en moyenne');
  assert(c?.kind === 'stats_groupes' && c.result.groupes[0].valeur === meilleur[0], `classé sur la moyenne : ${meilleur[0]} en tête (avant : le total ; obtenu : ${c?.kind} ${c?.result?.groupes?.[0]?.valeur})`);
  const t = qf('quel lycée a le plus de vœux');
  assert(t?.kind === 'classement', 'faux positif : sans « en moyenne », le classement sur le total');
});

// ── Open data ──
const OD = D.openData(3000, 17);
const co = makeCtx();
co.__t = D.tableOpenData(OD);
run(co, "defaultOpenDataTable = __t; defaultOpenDataState = 'ready';");
const qo = asker(co);
const m = (f, k) => moy(OD.filter(f).map(o => Number(o[k])));

await describe('Open data : « par formation », « par BTS » = l\'unité', () => {
  for (const [q, att] of [['nombre moyen de candidats par formation en BTS', m(o => o.fili === 'BTS', 'voe')], ['combien de candidats en moyenne par BTS', m(o => o.fili === 'BTS', 'voe')],
    ['nombre moyen d\'admis par formation en CPGE', m(o => o.fili === 'CPGE', 'acc')], ['nombre moyen de places par licence en Gironde', m(o => o.fili === 'Licence' && o.dep === 'Gironde', 'capa')]]) {
    assert(v(qo(q)) === att, `« ${q} » : ${att} (obtenu : ${v(qo(q))})`);
  }
  const f = qo('capacité moyenne par filière');
  assert(f?.kind === 'stats_groupes', 'faux positif : « par filière » reste un regroupement');
  const a = qo('taux d\'accès moyen des BTS par académie');
  assert(a?.kind === 'stats_groupes' && /^Académie/.test(a.result.dim), 'faux positif : « par académie » reste un regroupement');
  const p = qo('quelle académie a le plus de places en moyenne');
  assert(p?.kind === 'stats_groupes' && /^Académie/.test(p.result.dim), 'classement des académies sur la capacité moyenne');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
