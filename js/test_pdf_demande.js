// test_pdf_demande.js — « exporte cette liste en PDF », « imprime ce résultat ».
// Signalé par l'utilisateur (open data réel, 11/11/2026) : après « liste des établissements proposant un BTS MCO en
// Gironde », « exporte cette liste en pdf » produisait un fichier Excel (export_donnees.xlsx, 7 lignes).
// Maintenant : la dernière réponse calculée est imprimée, comme avec le bouton « 🖨 PDF » sous la réponse
// (« Enregistrer au format PDF » dans la fenêtre d'impression). Les demandes Excel restent des exports Excel.
// node js/test_pdf_demande.js

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
    document: { getElementById: noopEl, querySelector: noopEl, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, click() {} }) },
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
const ctx = makeCtx();
ctx.__t = D.tableOpenData(D.openData(3000, 17));
run(ctx, "defaultOpenDataTable = __t; defaultOpenDataState = 'ready';");
const ask = (q, suite = false) => {
  if (!suite) run(ctx, 'window.__DATA_ENGINE_STATE = { lastPlan: null, lastExecution: null, history: [] }');
  ctx.__q = q;
  const plan = run(ctx, 'isDataEngineQuestion(__q)') ? run(ctx, 'detectDataEnginePlan(__q)') : null;
  return plan ? run(ctx, 'runDataEnginePlan')(plan, []) : null;
};

// conversation affichée : simulée (rapport.js lit le DOM du widget)
let imprime = null;
ctx.blocsDeLaConversation = () => [
  { html: '<h4>Établissements (6)</h4><p class="de-perimetre">…</p>', titre: 'Établissements (6) — Gironde · BTS', calcule: true },
  { html: '<p>Réponse d\'Albert</p>', titre: 'Réponse', calcule: false },
];
ctx.imprimerRapport = (blocs, opts) => { imprime = { blocs, opts }; return true; };

await describe('« exporte cette liste en pdf » : la dernière réponse calculée, imprimée', () => {
  ask('donne moi la liste des établissements proposant un BTS MCO en gironde');
  const e = ask('exporte cette liste en pdf', true);
  assert(e?.kind === 'pdf', `réponse « PDF », pas un export Excel (obtenu : ${e?.kind})`);
  assert(imprime && imprime.blocs.length === 1 && /Établissements \(6\)/.test(imprime.blocs[0].titre), 'la dernière réponse CALCULÉE est imprimée (pas celle d\'Albert)');
  assert(/Enregistrer au format PDF/.test(e.html) && /Établissements \(6\)/.test(e.html), 'le message dit quoi faire dans la fenêtre d\'impression');
  assert(!/de-perimetre|de-exact-badge/.test(e.html), 'le message « PDF » n\'est pas lui-même une réponse calculée (une 2e demande réimprime la liste)');
  assert(run(ctx, 'shouldAnswerLocallyWithoutAlbert')(e) === true, 'réponse locale, sans Albert');
  for (const q of ['imprime ce résultat', 'je veux ce tableau en PDF', 'enregistre ça en pdf']) {
    imprime = null;
    const x = ask(q, true);
    assert(x?.kind === 'pdf' && imprime, `« ${q} » : impression`);
  }
});

await describe('Rien à imprimer, et faux positifs', () => {
  const saved = ctx.blocsDeLaConversation;
  ctx.blocsDeLaConversation = () => [];
  const v = ask('exporte en pdf');
  assert(v?.kind === 'pdf' && /pas encore de réponse calculée/.test(v.html), 'aucune réponse calculée : le widget le dit');
  ctx.blocsDeLaConversation = saved;
  ask('combien de BTS MCO en gironde ?');
  const x = ask('exporte en excel', true);
  assert(x?.kind === 'export', 'faux positif : « exporte en excel » reste un export Excel');
  const l = ask('donne moi la liste des établissements proposant un BTS MCO en gironde');
  assert(/<strong>Filtres appliqués<\/strong>/.test(l.html), 'liste d\'établissements : titre « Filtres appliqués » (manquait)');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
