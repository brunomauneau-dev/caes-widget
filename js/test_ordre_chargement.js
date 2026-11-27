// test_ordre_chargement.js — Les modules chargés DANS L'ORDRE DE LA PAGE (index.html), comme dans le navigateur.
// Les autres tests chargent documents.js avant dataEngine.js ; la page fait l'inverse. Bug réel (v27.5.104) : une table
// construite au chargement de dataEngine.js appelait normalizeText (documents.js), pas encore chargé → erreur au
// chargement, plus aucun calcul dans le widget, alors que toute la suite de tests passait.
// node js/test_ordre_chargement.js

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

// modules du calcul, dans l'ordre où index.html les charge
const MODULES = ['planner.js', 'dataEngine.js', 'config.js', 'knowledge.js', 'documents.js', 'sessions.js'];
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const ordre = [...html.matchAll(/<script src="js\/([\w.]+\.js)\?v=[\d.]+" defer><\/script>/g)].map(m => m[1]).filter(f => MODULES.includes(f));

function makeCtx(fichiers) {
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
  // dans la page, chaque script est un <script> séparé : une erreur dans l'un n'empêche pas les suivants
  const erreurs = [];
  for (const f of fichiers) { try { vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f }); } catch (e) { erreurs.push(`${f} : ${e.message}`); } }
  ctx.resetContextSilent = () => {};
  return { ctx, erreurs };
}

await describe('Ordre de la page', () => {
  assert(ordre.length === MODULES.length, `les ${MODULES.length} modules du calcul sont dans index.html (${ordre.join(', ')})`);
  assert(ordre.indexOf('dataEngine.js') < ordre.indexOf('documents.js'), 'dataEngine.js est chargé avant documents.js (cas que ce test protège)');
});

await describe('Chargement dans cet ordre : aucune erreur, et le calcul répond', () => {
  const { ctx, erreurs } = makeCtx(ordre);
  assert(!erreurs.length, `aucune erreur au chargement${erreurs.length ? ` (${erreurs.join(' ; ')})` : ''}`);
  const OD = D.openData(1500, 7);
  ctx.__t = D.tableOpenData(OD);
  vm.runInContext("defaultOpenDataTable = __t; defaultOpenDataState = 'ready';", ctx);
  const ask = q => { ctx.__q = q; vm.runInContext('window.__DATA_ENGINE_STATE = { lastPlan: null, lastExecution: null, history: [] }', ctx); const p = vm.runInContext('isDataEngineQuestion(__q) ? detectDataEnginePlan(__q) : null', ctx); return p ? vm.runInContext('runDataEnginePlan', ctx)(p, []) : null; };
  let e = null;
  try { e = ask('combien de BTS en Gironde'); } catch (err) { e = { kind: 'erreur', text: err.message }; }
  assert(e?.kind === 'count' && e.result.count === OD.filter(o => o.fili === 'BTS' && o.dep === 'Gironde').length, `« combien de BTS en Gironde » est calculé (${e?.kind} ${e?.text ? String(e.text).slice(0, 60) : ''})`);
  let f = null;
  try { f = ask('capaciité totale des BTS en Gironde'); } catch (err) { f = { kind: 'erreur', text: err.message }; }
  assert(f?.kind === 'sum', `correcteur de fautes utilisable dans cet ordre (${f?.kind})`);
});

console.log(`\n${'─'.repeat(50)}\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
