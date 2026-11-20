// test_stats_conditions.js — Moyennes, médianes, minimums et maximums avec conditions sur l'open data :
// « nombre de places moyen des licences ayant un taux d'accès inférieur à 30 % » (la mesure demandée, pas celle de la
// condition), « pourcentage de boursiers maximum » (pas une part), « maximal / minimal », « quel est le plus petit
// nombre de places des BTS… » (un minimum, pas un classement), vœux = candidats sur l'open data.
// Banc v27.5.96 : 126 chiffres faux sur 400 avant, 0 sur 1 200 après (3 tirages).
// node js/test_stats_conditions.js
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

// ─── Open data simulé ────────────────────────────────────────────────────────
const OD = D.openData(3000, 5);
const od = ctxOpenData(OD);
const BTS = o => o.fili === 'BTS', CPGE = o => o.fili === 'CPGE', LIC = o => o.fili === 'Licence', BUT = o => o.fili === 'BUT';
const r2 = x => Math.round(x * 100) / 100;
const vals = (pred, k) => OD.filter(pred).map(o => o[k]).filter(v => typeof v === 'number' && (k !== 'taux' || v > 0));
const moy = a => r2(a.reduce((x, y) => x + y, 0) / a.length);
const med = a => { const s = [...a].sort((x, y) => x - y); const n = s.length; return r2(n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2); };
const stat = (q, k) => { const e = ask(od, q); return e && e.kind === 'stats' ? r2(e.result[k]) : `${e?.kind}`; };

await describe('La mesure demandée, pas celle de la condition (avant : moyenne du taux d\'accès)', () => {
  assert(stat("nombre de places moyen des licences ayant un taux d'accès inférieur à 30 %", 'avg') === moy(vals(o => LIC(o) && o.taux < 30, 'capa')), 'places moyennes des licences sélectives');
  assert(stat("nombre moyen de candidats des BUT ayant un taux d'accès inférieur à 30 %", 'avg') === moy(vals(o => BUT(o) && o.taux < 30, 'voe')), 'candidats moyens des BUT sélectifs');
  assert(stat('nombre de vœux médian des BUT qui ont entre 20 et 40 admis', 'median') === med(vals(o => BUT(o) && o.acc >= 20 && o.acc <= 40, 'voe')), 'vœux médians (open data : vœux = candidats), condition sur les admis');
  assert(stat('capacité médiane des BTS avec plus de 20 % de boursiers', 'median') === med(vals(o => BTS(o) && o.pct_bours > 20, 'capa')), 'capacité médiane, condition sur le % de boursiers');
  assert(stat("taux d'accès moyen des BTS de plus de 30 places", 'avg') === moy(vals(o => BTS(o) && o.capa > 30, 'taux')), "taux d'accès moyen, condition sur les places (inchangé)");
  assert(stat("pourcentage de boursiers moyen des BUT ayant un taux d'accès inférieur à 30 %", 'avg') === moy(vals(o => BUT(o) && o.taux < 30, 'pct_bours')), '% de boursiers moyen avec condition sur le taux (avant : arrêt « boursiers »)');
});

await describe('Maximum et minimum : « maximal », « le plus grand », « pourcentage maximum »', () => {
  assert(stat('capacité maximale des CPGE en Gironde', 'max') === Math.max(...vals(o => CPGE(o) && o.dep === 'Gironde', 'capa')), '« capacité maximale » (avant : pas de calcul)');
  assert(stat("nombre d'admis minimal des licences de plus de 30 places", 'min') === Math.min(...vals(o => LIC(o) && o.capa > 30, 'acc')), '« minimal » (avant : mot non reconnu)');
  assert(stat('pourcentage de boursiers maximum des CPGE avec plus de 1000 candidats', 'max') === Math.max(...vals(o => CPGE(o) && o.voe > 1000, 'pct_bours')), '« pourcentage maximum » : pas la part globale des boursiers');
  assert(stat('quel est le plus petit nombre de places des BTS qui ont entre 20 et 40 admis', 'min') === Math.min(...vals(o => BTS(o) && o.acc >= 20 && o.acc <= 40, 'capa')), '« le plus petit nombre de places » : un minimum (avant : classement sur les admis)');
  assert(stat("quel est le plus grand % de boursiers des BTS ayant un taux d'accès inférieur à 30 %", 'max') === Math.max(...vals(o => BTS(o) && o.taux < 30, 'pct_bours')), '« le plus grand % de boursiers »');
  assert(stat('quel est le plus petit capacité des BUT en Gironde', 'min') === Math.min(...vals(o => BUT(o) && o.dep === 'Gironde', 'capa')), '« le plus petit capacité » (accent, faute d\'accord)');
});

await describe('Faux positifs : ce qui ne doit pas changer', () => {
  const c = ask(od, 'quelle formation a le plus grand nombre de candidats');
  assert(c && c.kind === 'classement' && Number(c.result.lignes[0].valeur) === Math.max(...vals(() => true, 'voe')), '« quelle formation a le plus grand nombre… » : toujours un classement (on demande la formation)');
  assert(ask(od, 'quelle est la formation la plus sélective')?.kind === 'classement', '« la plus sélective » : classement');
  assert(ask(od, 'part des boursiers parmi les admis en BTS')?.kind === 'part', 'part des boursiers : toujours une part');
  assert(stat('nombre médian de places en licence', 'median') === med(vals(LIC, 'capa')), 'médiane sans condition : inchangée');
  const g = ask(od, 'le plus grand nombre de formations par académie');
  assert(g && g.kind !== 'stats', '« le plus grand nombre de formations par académie » : pas une statistique d\'une colonne');
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
