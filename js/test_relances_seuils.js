// test_relances_seuils.js — Relances de conversation avec seuils et lieux sur l'open data : « et avec plus de 30 places ? »
// (ajout), « et celles de moins de 20 places ? » (remplace le seuil), « parmi elles, combien ont plus de 30 places ? »
// (garde les deux), « même question pour les BUT », « et dans l'académie de Bordeaux ? » après « à Paris » (le niveau
// cité compte), enchaînements à trois questions. Chiffres recalculés sur les lignes.
// Banc v27.5.95 : 42 chiffres faux et 179 relances sans calcul sur 375 avant ; 0 et 0 sur 1 136 après (3 tirages).
// node js/test_relances_seuils.js
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
const n = pred => OD.filter(pred).length;
const somme = (pred, k) => OD.filter(pred).reduce((a, o) => a + o[k], 0);
const BTS = o => o.fili === 'BTS', CPGE = o => o.fili === 'CPGE', LIC = o => o.fili === 'Licence', BUT = o => o.fili === 'BUT';
const chaine = (...qs) => { let e = ask(od, qs[0]); for (const q of qs.slice(1)) e = suite(od, q); return e; };
const vaut = (e, attendu) => !!e && e.kind === 'count' && e.result.count === attendu;
const PARIS = o => o.commune === 'Paris', GIR = o => o.dep === 'Gironde';

await describe('Ajouter un seuil par une relance (avant : pas de calcul)', () => {
  assert(vaut(chaine('combien de BTS en Gironde', 'et avec plus de 30 places ?'), n(o => BTS(o) && GIR(o) && o.capa > 30)), '« et avec plus de 30 places ? »');
  assert(vaut(chaine("combien de BTS avec un taux d'accès inférieur à 30 %", 'et avec plus de 20 % de boursiers ?'), n(o => BTS(o) && o.taux < 30 && o.pct_bours > 20)), 'seuil sur le taux puis seuil sur les boursiers : les deux');
  assert(vaut(chaine('combien de CPGE publiques', 'et celles ayant 1000 candidats ou plus ?'), n(o => CPGE(o) && o.statut === 'Public' && o.voe >= 1000)), '« et celles ayant 1000 candidats ou plus ? »');
});

await describe('Même colonne : remplacer, sauf « parmi elles »', () => {
  assert(vaut(chaine('combien de BTS avec plus de 30 places', 'et celles de moins de 20 places ?'), n(o => BTS(o) && o.capa < 20)), '« et celles de moins de 20 places ? » remplace « plus de 30 » (sinon 0)');
  assert(vaut(chaine("combien de licences avec un taux d'accès inférieur à 30 %", "et avec un taux d'accès supérieur à 50 % ?"), n(o => LIC(o) && o.taux > 50)), 'nouveau seuil sur le taux : remplace');
  assert(vaut(chaine('combien de licences avec moins de 100 places', 'parmi elles, combien ont plus de 30 places ?'), n(o => LIC(o) && o.capa < 100 && o.capa > 30)), '« parmi elles » : les deux seuils (avant : « moins de 100 » perdu)');
  assert(vaut(chaine('combien de licences avec moins de 100 places', 'et parmi elles, combien ont au moins 30 places ?'), n(o => LIC(o) && o.capa < 100 && o.capa >= 30)), '« et parmi elles … au moins 30 places »');
});

await describe('Changer de formation ou de lieu en gardant le seuil', () => {
  assert(vaut(chaine('combien de CPGE avec plus de 30 places', 'même question pour les BUT'), n(o => BUT(o) && o.capa > 30)), '« même question pour les BUT » (avant : mot « question » non reconnu)');
  assert(vaut(chaine('combien de BTS avec plus de 30 places', 'et pour les licences ?'), n(o => LIC(o) && o.capa > 30)), '« et pour les licences ? » garde le seuil');
  assert(vaut(chaine('combien de BTS à Paris ayant 1000 candidats ou plus', "et dans l'académie de Bordeaux ?"), n(o => BTS(o) && o.aca === 'Bordeaux' && o.voe >= 1000)), "« à Paris » puis « et dans l'académie de Bordeaux ? » : l'académie (avant : la commune de Bordeaux)");
  assert(vaut(chaine('combien de BTS à Paris', "et dans l'académie de Bordeaux ?"), n(o => BTS(o) && o.aca === 'Bordeaux')), "même chose sans seuil");
  assert(vaut(chaine('combien de BTS en Gironde', 'et avec plus de 30 places ?', 'et pour les BUT ?'), n(o => BUT(o) && GIR(o) && o.capa > 30)), 'trois questions : lieu + seuil gardés, formation remplacée');
  assert(vaut(chaine('combien de CPGE en Gironde', 'et avec plus de 20 % de boursiers ?', 'même question pour les BUT'), n(o => BUT(o) && GIR(o) && o.pct_bours > 20)), 'trois questions avec « même question »');
});

await describe('Faux positifs : ce qui ne doit pas changer', () => {
  assert(vaut(chaine('combien de BTS à Paris', 'et à Bordeaux ?'), n(o => BTS(o) && o.commune === 'Bordeaux')), '« et à Bordeaux ? » après « à Paris » : la commune (inchangé)');
  assert(vaut(chaine('combien de BTS à Paris', 'et en Gironde ?'), n(o => BTS(o) && GIR(o))), '« et en Gironde ? » : le département remplace la commune');
  assert(vaut(chaine('combien de BTS avec plus de 30 places', 'combien de licences'), n(LIC)), 'nouvelle question complète : aucun seuil hérité');
  assert(vaut(chaine('combien de BTS avec plus de 30 places', 'combien de licences avec moins de 50 places'), n(o => LIC(o) && o.capa < 50)), 'nouvelle question avec son propre seuil');
  const e = chaine('combien de BTS avec plus de 30 places', 'et alors ?');
  assert(!e || e.kind !== 'count' || e.result.count === n(o => BTS(o) && o.capa > 30), '« et alors ? » : aucun nouveau chiffre inventé');
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
