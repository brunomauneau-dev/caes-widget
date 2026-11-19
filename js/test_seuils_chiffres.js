// test_seuils_chiffres.js — Seuils chiffrés écrits librement sur l'open data : « 20 admis ou plus », « 30 places ou
// moins », « taux d'accès compris entre 30 et 50 % », « plus de 20 % de boursiers », « entre 10 et 20 places »,
// « plus de 30 places ou moins de 10 places », « ont 30 places », « dépasse ». Chaque chiffre est recalculé sur les
// lignes ; une condition non comprise arrête le moteur (jamais le total des formations).
// Banc v27.5.93 : 129 chiffres faux sur 400 avant, 0 sur 2 400 après (3 tirages).
// node js/test_seuils_chiffres.js

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
const n = pred => OD.filter(pred).length;
const somme = (pred, k) => OD.filter(pred).reduce((a, o) => a + o[k], 0);
const BTS = o => o.fili === 'BTS', CPGE = o => o.fili === 'CPGE', LIC = o => o.fili === 'Licence', BUT = o => o.fili === 'BUT';
const compte = (q, attendu) => { const e = ask(od, q); return !!e && e.kind === 'count' && e.result.count === attendu; };
const arretOuPasTout = (q, total) => { const e = ask(od, q); return !e || e.kind === 'unresolved' || (e.kind === 'count' && e.result.count !== total); };

await describe('Seuil placé après le nombre : « 20 admis ou plus », « 30 places ou moins »', () => {
  assert(compte('combien de BTS ont 20 admis ou plus', n(o => BTS(o) && o.acc >= 20)), '« 20 admis ou plus » = au moins 20 (avant : exactement 20)');
  assert(compte('combien de BTS ont 30 places ou moins', n(o => BTS(o) && o.capa <= 30)), '« 30 places ou moins » : des BTS comptés (avant : toutes les places additionnées)');
  assert(compte('combien de CPGE ont 500 candidatures ou plus', n(o => CPGE(o) && o.voe >= 500)), '« 500 candidatures ou plus » : colonne des candidats');
  assert(compte('combien de licences ont 100 places et plus', n(o => LIC(o) && o.capa >= 100)), '« 100 places et plus »');
  const s = ask(od, 'nombre de places dans les BTS avec 20 admis ou plus');
  assert(s && s.kind === 'sum' && s.result.sum === somme(o => BTS(o) && o.acc >= 20, 'capa'), 'somme des places des BTS ayant au moins 20 admis');
});

await describe('« entre … et … » : bornes comprises, la condition n\'est jamais perdue', () => {
  assert(compte("combien de BTS ont un taux d'accès entre 30 et 50 %", n(o => BTS(o) && o.taux >= 30 && o.taux <= 50)), "taux d'accès entre 30 et 50 % (avant : tous les BTS)");
  assert(compte("nombre de licences avec un taux d'accès compris entre 10 % et 30 %", n(o => LIC(o) && o.taux >= 10 && o.taux <= 30)), '« compris entre 10 % et 30 % »');
  assert(compte('combien de CPGE ont entre 10 et 20 places', n(o => CPGE(o) && o.capa >= 10 && o.capa <= 20)), '« ont entre 10 et 20 places » : des CPGE comptées (avant : places additionnées)');
  assert(compte('combien de BTS ont entre 20 admis et 40 admis', n(o => BTS(o) && o.acc >= 20 && o.acc <= 40)), '« entre 20 admis et 40 admis » (unité répétée)');
  assert(compte('combien de BUT ont entre 100 et 200 admis', n(o => BUT(o) && o.acc >= 100 && o.acc <= 200)), '« entre 100 et 200 » : pas lu « 100 admis ou 200 admis »');
  assert(compte('combien de CPGE ont entre 10 et 20 % de boursiers', n(o => CPGE(o) && o.pct_bours >= 10 && o.pct_bours <= 20)), '« entre 10 et 20 % de boursiers » (avant : part des boursiers)');
});

await describe('Pourcentage de boursiers : un seuil, pas une part demandée', () => {
  assert(compte('combien de BTS ont plus de 20 % de boursiers', n(o => BTS(o) && o.pct_bours > 20)), '« plus de 20 % de boursiers »');
  assert(compte("combien de BTS ont 30 % de boursiers ou moins", n(o => BTS(o) && o.pct_bours <= 30)), '« 30 % de boursiers ou moins » (avant : part des boursiers de tous les BTS)');
  assert(compte("combien de BTS ont moins de 20% d'admis boursiers", n(o => BTS(o) && o.pct_bours < 20)), "« moins de 20% d'admis boursiers »");
  assert(compte('combien de BTS ont un taux de boursiers supérieur à 20 %', n(o => BTS(o) && o.pct_bours > 20)), '« taux de boursiers supérieur à 20 % »');
  assert(compte('nombre de BTS dont le pourcentage de boursiers est supérieur à 30 %', n(o => BTS(o) && o.pct_bours > 30)), '« dont le pourcentage de boursiers est supérieur à » (avant : répartition)');
  assert(compte("combien de formations ont plus de 10 % de boursiers et un taux d'accès inférieur à 20 %", n(o => o.pct_bours > 10 && o.taux < 20)), 'deux conditions : % de boursiers ET taux (avant : « égal à 10 »)');
  assert(compte('combien de BTS ont plus de 20 boursiers', n(o => BTS(o) && o.acc_bours > 20)), 'sans « % » : un effectif d\'admis boursiers');
});

await describe('« ou » entre deux seuils, valeur exacte, verbes courants', () => {
  assert(compte('combien de BTS ont plus de 30 places ou moins de 15 places', n(o => BTS(o) && (o.capa > 30 || o.capa < 15))), "l'un OU l'autre (avant : les deux exigés, 0)");
  assert(compte('combien de licences ont plus de 200 places ou bien moins de 30 places', n(o => LIC(o) && (o.capa > 200 || o.capa < 30))), '« ou bien »');
  assert(compte('combien de BTS ont 30 places', n(o => BTS(o) && o.capa === 30)), '« ont 30 places » = exactement 30 (avant : toutes les places additionnées)');
  assert(compte('combien de BTS avec 25 places en Gironde', n(o => BTS(o) && o.capa === 25 && o.dep === 'Gironde')), '« avec 25 places en Gironde »');
  assert(compte('combien de BTS comptent plus de 1000 candidats', n(o => BTS(o) && o.voe > 1000)), '« comptent » (avant : mot non reconnu, arrêt)');
  assert(compte('combien de CPGE accueillent plus de 35 places', n(o => CPGE(o) && o.capa > 35)), '« accueillent »');
  assert(compte('combien de BTS ont plus de 1000 vœux', n(o => BTS(o) && o.voe > 1000)), 'open data : les vœux d\'une formation = ses candidats (comme « combien de vœux en BTS »)');
  assert(compte('combien de formations dont la capacité dépasse 100', n(o => o.capa > 100)), '« dépasse »');
});

await describe('Faux positifs : ce qui ne doit pas changer', () => {
  const p = ask(od, 'part des boursiers parmi les admis en BTS');
  assert(p && p.kind === 'part' && p.result.num === somme(BTS, 'acc_bours') && p.result.den === somme(BTS, 'acc_neobac'), 'part des boursiers : toujours une part (somme ÷ somme)');
  assert(ask(od, 'pourcentage de boursiers en BTS')?.kind === 'part', '« pourcentage de boursiers en BTS » : une part');
  assert(compte('combien de BTS ont plus de 30 places et plus de 1000 candidats', n(o => BTS(o) && o.capa > 30 && o.voe > 1000)), '« … places ET plus de … » : les deux exigées (« et plus de » n\'est pas « et plus »)');
  assert(compte('combien de BTS en 2025', n(BTS)), 'une année ne filtre rien');
  const s = ask(od, 'nombre de places en BTS');
  assert(s && s.kind === 'sum' && s.result.sum === somme(BTS, 'capa'), '« nombre de places en BTS » : toujours la somme des places');
  const l = ask(od, 'liste des formations à Paris avec plus de 100 places');
  assert(l && l.kind === 'export' && l.result.rows === n(o => o.commune === 'Paris' && o.capa > 100), 'liste : toujours un export, avec le bon nombre de lignes');
  assert(arretOuPasTout("combien de BTS ont plus de 30 % d'admis", n(BTS)), "« 30 % d'admis » (aucune colonne sûre) : arrêt, jamais tous les BTS");
  assert(arretOuPasTout('combien de BTS avec plus de 30 % de filles', n(BTS)), '« % de filles » non pris en charge : arrêt, jamais tous les BTS');
  assert(arretOuPasTout('combien de formations dont la capacité frôle les 100', OD.length), '« frôle les 100 » : arrêt');
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
