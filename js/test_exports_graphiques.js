// test_exports_graphiques.js — Ce qu'on exporte ou dessine après un calcul correspond au chiffre affiché :
// l'export d'un comptage ou d'une somme contient les lignes retenues (somme identique), l'en-tête du fichier écrit les
// seuils avec leur comparateur (« > 30 », pas « = 30 »), le graphique d'une répartition reprend ses barres, et un
// chiffre unique (comptage, somme, moyenne) ne donne pas de graphique inventé.
// Banc v27.5.97 : 188 problèmes sur 178 questions avant, 0 sur 714 après (3 tirages).
// node js/test_exports_graphiques.js
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
function ctxOpenData(lignes) {
  const ctx = makeCtx();
  ctx.__t = D.tableOpenData(lignes);
  run(ctx, "defaultOpenDataTable = __t; defaultOpenDataState = 'ready';");
  return ctx;
}
async function ctxCSV(rows, name = 'extraction.csv') {
  const ctx = makeCtx();
  const buf = new TextEncoder().encode(D.versCSV(rows));
  await run(ctx, 'importSpreadsheetFile')({ name, size: buf.length, arrayBuffer: async () => buf.buffer });
  return ctx;
}
// Question posée « à froid », comme une nouvelle conversation
function ask(ctx, q) {
  run(ctx, 'window.__DATA_ENGINE_STATE = { lastPlan: null, lastExecution: null, history: [] }');
  ctx.__q = q;
  const plan = run(ctx, 'isDataEngineQuestion(__q)') ? run(ctx, 'detectDataEnginePlan(__q)') : null;
  return plan ? run(ctx, 'runDataEnginePlan')(plan, []) : null;
}

function suite(ctx, q) {
  ctx.__q = q;
  const plan = run(ctx, 'isDataEngineQuestion(__q)') ? run(ctx, 'detectDataEnginePlan(__q)') : null;
  return plan ? run(ctx, 'runDataEnginePlan')(plan, []) : null;
}
// ─── Open data simulé ────────────────────────────────────────────────────────
const OD = D.openData(3000, 5);
const od = ctxOpenData(OD);
let capture = null;
od.downloadRowsAsFile = (rows, filename, format, meta) => { capture = { rows, meta, entete: run(od, 'buildExportMeta')(rows, meta) }; return { ok: true, html: 'ok', rows: rows.length }; };
const n = pred => OD.filter(pred).length;
const BTS = o => o.fili === 'BTS', LIC = o => o.fili === 'Licence';
const exporter = q => { ask(od, q); capture = null; suite(od, 'exporte en excel'); return capture; };
const barres = e => [...String(e?.html || '').matchAll(/data-bar-label="([^"]*)" data-bar-value="[^"]*" data-bar-count="([^"]*)"/g)].map(m => [m[1], Number(m[2].replace(/\s| /g, ''))]);

await describe('Export du résultat : les lignes du calcul', () => {
  const c = exporter('combien de BTS de plus de 30 places');
  assert(c && c.rows.length === n(o => BTS(o) && o.capa > 30), 'comptage : une ligne par formation comptée');
  const s = exporter('nombre de places dans les BTS en Gironde');
  const att = OD.filter(o => BTS(o) && o.dep === 'Gironde');
  assert(s && s.rows.length === att.length, 'somme : les formations additionnées (avant : « Aucune donnée à exporter »)');
  assert(s && s.rows.reduce((a, r) => a + r["Capacité de l'établissement par formation"], 0) === att.reduce((a, o) => a + o.capa, 0), 'somme : le total des lignes exportées = le chiffre affiché');
  const g = exporter('nombre de licences par académie');
  const e = ask(od, 'nombre de licences par académie');
  assert(g && g.rows.length === e.result.rows.length && g.rows.every((r, i) => r.Nombre === e.result.rows[i].count), 'répartition : les mêmes groupes et effectifs');
  const st = exporter("nombre de places moyen des licences ayant un taux d'accès inférieur à 30 %");
  assert(st && /Capacit/.test(st.rows[0].Colonne), 'moyenne : la colonne exportée est la mesure calculée (places), pas celle de la condition');
});

await describe("En-tête du fichier : les seuils avec leur comparateur (avant : « = »)", () => {
  const c = exporter('combien de BTS avec plus de 20 % de boursiers');
  assert(c && c.entete.some(l => /> "20"/.test(l)) && !c.entete.some(l => /= "20"/.test(l)), '« plus de 20 % » écrit « > 20 »');
  const d = exporter("combien de licences ayant un taux d'accès compris entre 10 et 30 %");
  assert(d && d.entete.some(l => /≥ "10"/.test(l) && /≤ "30"/.test(l)), '« entre 10 et 30 » écrit « ≥ 10 ; ≤ 30 »');
  const e = exporter('combien de BTS en Gironde');
  assert(e && e.entete.some(l => /= "Gironde"/.test(l)), 'un lieu reste écrit « = » (inchangé)');
});

await describe('Graphique du résultat', () => {
  ask(od, 'nombre de formations par académie');
  const g = suite(od, 'fais un graphique');
  const e = ask(od, 'nombre de formations par académie');
  assert(barres(g).length && barres(g).every(([l, v], i) => e.result.rows[i] && e.result.rows[i].count === v), 'répartition : les barres = les effectifs calculés');
  ask(od, 'combien de BTS en Gironde');
  const u = suite(od, 'fais un graphique');
  assert(u && u.kind === 'message' && !barres(u).length, 'comptage : pas de graphique inventé, une explication (avant : graphique vide)');
  ask(od, 'nombre de places moyen des BTS avec plus de 20 % de boursiers');
  const m = suite(od, 'en graphique');
  assert(m && m.kind === 'message' && !barres(m).length, 'moyenne : pas de barres par nombre de places (avant : « 30 places : 12 formations »)');
  ask(od, 'les 5 licences les plus demandées');
  const k = suite(od, 'fais un graphique');
  const kv = ask(od, 'les 5 licences les plus demandées');
  assert(barres(k).length === 5 && barres(k).every(([, v], i) => v === kv.result.lignes[i].valeur), 'classement : les 5 barres = les valeurs classées (inchangé)');
});

await describe('Fichier académique : la définition SAIO dans l\'export', async () => {
  const ROWS = D.exportAcademique(1500, 21);
  const ca = makeCtx();
  ca.XLSX.read = () => ({ SheetNames: ['BDD'], Sheets: { BDD: 'ws' } });
  ca.XLSX.utils.sheet_to_json = () => ROWS.map(r => r.slice());
  await run(ca, 'importSpreadsheetFile')({ name: 'BDD.xlsx', size: 1000, arrayBuffer: async () => new ArrayBuffer(8) });
  let cap = null;
  ca.downloadRowsAsFile = (rows, filename, format, meta) => { cap = rows; return { ok: true, html: 'ok', rows: rows.length }; };
  const e = ask(ca, 'combien de candidats boursiers');
  suite(ca, 'exporte en excel');
  assert(e && e.kind === 'count' && cap && cap.length === e.result.count, 'export = les candidats comptés (au moins un vœu confirmé)');
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
