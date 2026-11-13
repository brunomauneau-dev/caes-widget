// test_part_groupes.js — Taux et parts « par » groupe, calculés à l'intérieur de chaque groupe.
// Avant : « pourcentage de candidats sans proposition par département » donnait la répartition des candidats sans
// proposition entre départements (« Gironde : 50 % » = la moitié des sans-proposition sont en Gironde), facile à lire
// comme « la moitié des candidats de Gironde n'ont pas de proposition » (en réalité 21,6 % sur l'export réel).
// Maintenant : pour chaque groupe, numérateur du groupe ÷ dénominateur du groupe, et la ligne « Ensemble ».
// Données FICTIVES (js/fixtures/donnees_simulees.mjs) ; chaque valeur attendue est recalculée sur les lignes.
// node js/test_part_groupes.js

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
  ctx.XLSX = { utils: { json_to_sheet: () => ({}), book_new: () => ({}), book_append_sheet() {}, sheet_to_csv: () => '' }, writeFile() {} };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.selectedDocIds = new Set();
  vm.createContext(ctx);
  for (const f of ['config.js', 'knowledge.js', 'documents.js', 'planner.js', 'dataEngine.js', 'sessions.js', 'retours.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
  ctx.resetContextSilent = () => {};
  return ctx;
}
const run = (ctx, code) => vm.runInContext(code, ctx);
function ask(ctx, q, suite = false) {
  if (!suite) run(ctx, 'window.__DATA_ENGINE_STATE = { lastPlan: null, lastExecution: null, history: [] }');
  ctx.__q = q;
  const plan = run(ctx, 'isDataEngineQuestion(__q)') ? run(ctx, 'detectDataEnginePlan(__q)') : null;
  return plan ? run(ctx, 'runDataEnginePlan')(plan, []) : null;
}
const groupe = (e, v) => (e?.result?.groupes || []).find(g => g.valeur === v);
const proche = (a, b) => a !== null && b !== null && Math.abs(a - b) < 1e-9;

// ─── Fichier de candidats ──────────────────────────────────────────────────
const ROWS = D.exportAcademique(4000, 21);
const H = D.EXPORT_ACADEMIQUE_ENTETES;
const [DEP, , , , ETAB, , PROP, ACC, , BOURS, , , TYPE, SERIE] = H;
// v27.5.82 — définition SAIO : un « candidat » a confirmé au moins un vœu ; les valeurs attendues portent sur ces lignes
// (les élèves sans vœu, case vide, ne sont plus comptés comme candidats). L_TOUT = toutes les lignes du fichier.
const L_TOUT = ROWS.slice(1).map(r => Object.fromEntries(H.map((h, i) => [h, r[i]])));
const L = L_TOUT.filter(r => String(r['Nb total de vœux confirmés en phase principale'] ?? '').trim() !== '' && Number(r['Nb total de vœux confirmés en phase principale']) >= 1);
const nb = pred => L.filter(pred).length;
const nbt = pred => L_TOUT.filter(pred).length; // questions sans « candidats » : tout le fichier (élèves sans vœu compris)
const B = r => r[BOURS] === 'Boursier des lycées';
const ctx = makeCtx();
ctx.XLSX.read = () => ({ SheetNames: ['BDD'], Sheets: { BDD: 'ws' } });
ctx.XLSX.utils.sheet_to_json = () => ROWS.map(r => r.slice());
await run(ctx, 'importSpreadsheetFile')({ name: 'BDD.xlsx', size: 1000, arrayBuffer: async () => new ArrayBuffer(8) });

await describe('Taux par groupe, dans chaque groupe', () => {
  const e = ask(ctx, 'pourcentage de candidats sans proposition par département');
  assert(e?.kind === 'part_groupes' && e.result.groupe === DEP, `une part par département (avant : répartition du total ; obtenu : ${e?.kind})`);
  let ok = true;
  for (const dep of new Set(L.map(r => r[DEP]))) {
    const g = groupe(e, dep), num = nb(r => r[DEP] === dep && r[PROP] === 'Non'), den = nb(r => r[DEP] === dep);
    if (!g || g.num !== num || g.den !== den || !proche(g.pct, num / den * 100)) ok = false;
  }
  assert(ok, 'chaque département : sans proposition du département ÷ candidats du département');
  assert(e.result.ensemble.num === nb(r => r[PROP] === 'Non') && e.result.ensemble.den === L.length, 'ligne « Ensemble » = taux de tout le périmètre');
  const pcts = e.result.groupes.map(g => g.pct);
  assert(pcts.every((v, i) => i === 0 || pcts[i - 1] >= v), 'groupes triés par part décroissante');
  assert(/Chaque part est calculée à l'intérieur du groupe/.test(e.html) && /Ensemble/.test(e.html), 'le tableau le dit et donne l\'ensemble');
  assert(/A eu une proposition au cours de la procédure Parcoursup \(Oui\/Non\)» = non|A eu une proposition au cours de la procédure Parcoursup \(Oui\/Non\) » = non/.test(e.html), 'la condition nomme sa colonne (pas « lignes « non » »)');
  const t = ask(ctx, 'taux de proposition des boursiers par département');
  const gi = groupe(t, 'Gironde');
  assert(t?.kind === 'part_groupes' && gi.num === nb(r => B(r) && r[DEP] === 'Gironde' && r[PROP] === 'Oui') && gi.den === nb(r => B(r) && r[DEP] === 'Gironde'), 'taux de proposition des boursiers par département : boursiers du département seulement');
  const s = ask(ctx, 'part des boursiers par série');
  const gs = groupe(s, 'Professionnelle');
  assert(s?.kind === 'part_groupes' && s.result.groupe === SERIE && gs.num === nbt(r => B(r) && r[SERIE] === 'Professionnelle') && gs.den === nbt(r => r[SERIE] === 'Professionnelle'), 'part des boursiers par série');
  const l = ask(ctx, "taux d'admission par lycée");
  const gl = groupe(l, 'Lycée Montaigne');
  assert(l?.kind === 'part_groupes' && l.result.groupe === ETAB && gl.num === nb(r => r[ETAB] === 'Lycée Montaigne' && r[ACC] === 'Oui'), "taux d'admission par lycée (de scolarité)");
});

await describe('Ce qui accompagne le résultat', () => {
  const e = ask(ctx, 'pourcentage de candidats sans proposition par département');
  const ex = run(ctx, 'currentExecutionToRows')(e);
  assert(ex.length === e.result.groupes.length && 'Part (%)' in ex[0] && DEP in ex[0], 'export Excel : une ligne par département');
  assert(/calculée dans chaque groupe/.test(run(ctx, 'dataEngineResultToContext')(e)), 'Albert reçoit le tableau des parts par groupe');
  assert(run(ctx, 'shouldAnswerLocallyWithoutAlbert')(e) === true, 'réponse locale');
  const g = run(ctx, 'renderCurrentChartExecution')({ question: 'graphique', tool: 'chart_current', sourceExecution: e });
  assert(g?.kind === 'part_groupes' && /Graphique/.test(g.html), 'graphique des parts');
  assert(/groupes \(ensemble/.test(run(ctx, 'resumeExecution')(e).chiffre), 'retour « À revoir » : résumé lisible');
});

await describe('Relances', () => {
  ask(ctx, 'taux de proposition des boursiers');
  const r = ask(ctx, 'et par département ?', true);
  const gi = groupe(r, 'Gironde');
  assert(r?.kind === 'part_groupes' && gi && gi.den === nb(x => B(x) && x[DEP] === 'Gironde'), '« taux de proposition des boursiers » >> « et par département ? » : taux dans chaque département (avant : répartition des boursiers)');
  const n = ask(ctx, 'et pour les non boursiers ?', true);
  const gn = groupe(n, 'Gironde');
  assert(n?.kind === 'part_groupes' && gn.num === nb(x => !B(x) && x[DEP] === 'Gironde' && x[PROP] === 'Oui') && gn.den === nb(x => !B(x) && x[DEP] === 'Gironde'), '>> « et pour les non boursiers ? » : même taux par département, autre population');
});

await describe('Faux positifs : inchangés', () => {
  const r = ask(ctx, 'répartition des candidats sans proposition par département');
  assert(r?.kind === 'group_by', '« répartition … par département » reste une répartition');
  const p = ask(ctx, 'pourcentage de candidats sans proposition en Gironde');
  assert(p?.kind === 'part' && p.result.den === nb(x => x[DEP] === 'Gironde'), 'taux pour un seul département : une part simple');
  const m = ask(ctx, 'nombre moyen de vœux par département');
  assert(m?.kind === 'stats_groupes', 'moyenne par département : statistiques par groupe');
  const c = ask(ctx, 'combien de candidats par type de la classe');
  assert(c?.kind === 'group_by' && c.plan.targetCol === TYPE, 'comptage par groupe : répartition');
});

// ─── Open data (une ligne = une formation) ──────────────────────────────────
const OD = D.openData(4000, 13);
const co = makeCtx();
co.__t = D.tableOpenData(OD);
run(co, "defaultOpenDataTable = __t; defaultOpenDataState = 'ready';");

await describe('Open data : parts par groupe en effectifs (somme ÷ somme dans chaque groupe)', () => {
  const e = ask(co, 'part des boursiers par académie');
  const bx = groupe(e, 'Bordeaux');
  const lb = OD.filter(o => o.aca === 'Bordeaux');
  const num = lb.reduce((t, o) => t + o.acc_bours, 0), den = lb.reduce((t, o) => t + o.acc_neobac, 0);
  assert(e?.kind === 'part_groupes' && e.result.mode === 'effectifs' && bx && bx.num === num && bx.den === den, `part des boursiers par académie : Bordeaux = ${num} / ${den} (obtenu : ${bx?.num} / ${bx?.den})`);
  const r = ask(co, 'taux de remplissage des BTS par académie');
  const rb = groupe(r, 'Bordeaux');
  const bts = OD.filter(o => o.aca === 'Bordeaux' && o.fili === 'BTS');
  assert(r?.kind === 'part_groupes' && rb.num === bts.reduce((t, o) => t + o.acc, 0) && rb.den === bts.reduce((t, o) => t + o.capa, 0), 'taux de remplissage des BTS par académie : admis ÷ places des BTS de chaque académie');
  const s = ask(co, 'pourcentage de formations sélectives par filière');
  const sb = groupe(s, 'BTS');
  assert(s?.kind === 'part_groupes' && sb.num === OD.filter(o => o.fili === 'BTS' && o.selectivite === 'formation sélective').length && sb.den === OD.filter(o => o.fili === 'BTS').length, 'pourcentage de formations sélectives par filière (mode lignes)');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
