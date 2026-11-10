// test_listes.js — « Donne-moi la liste », « quels établissements proposent… ».
// Signalé par l'utilisateur (11/11/2026, open data réel) :
// - « combien de BTS MCO en Gironde ? » (7) puis « donne moi la liste » : export de TOUTE la table (14 252 lignes,
//   « aucun filtre ») ; le BTS MCO et la Gironde étaient perdus ;
// - « donne moi la liste des établissements proposant un BTS MCO en Gironde » : liste des INTITULÉS de formation
//   (« BTS - Services - Management Commercial Opérationnel : 6 »), pas des établissements ;
// - « quels établissements proposent le BTS MCO en Gironde ? » : pas de calcul (envoyé à Albert).
// Maintenant : les lignes de la question précédente, détaillées par établissement (avec la commune et le nombre de
// formations), tous les établissements affichés.
// Données FICTIVES (js/fixtures/donnees_simulees.mjs) ; chaque valeur attendue est recalculée sur les lignes.
// node js/test_listes.js

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

const OD = D.openData(3000, 17);
const co = makeCtx();
co.__t = D.tableOpenData(OD);
run(co, "defaultOpenDataTable = __t; defaultOpenDataState = 'ready';");
const qo = asker(co);
const MCO = o => o.fili === 'BTS' && /Management Commercial Opérationnel/i.test(o.nom) && o.dep === 'Gironde';
const etabsMCO = new Map();
OD.filter(MCO).forEach(o => { const k = `${o.etab}|${o.commune}`; etabsMCO.set(k, (etabsMCO.get(k) || 0) + 1); });

await describe('« donne-moi la liste » après un comptage : les mêmes lignes, par établissement', () => {
  const c = qo('combien de BTS MCO en gironde ?');
  assert(c?.kind === 'count' && c.result.count === OD.filter(MCO).length, `combien de BTS MCO en Gironde : ${OD.filter(MCO).length}`);
  const l = qo('donne moi la liste', true);
  assert(l?.kind !== 'export', `pas d'export de toute la table (avant : 14 252 lignes, aucun filtre ; obtenu : ${l?.kind})`);
  assert(l?.kind === 'group_by' && (l.plan.filters || []).length === 2, 'filtres gardés : Gironde et BTS MCO');
  assert(/Établissements \(\d+\)/.test(l.html) && new RegExp(`<strong>${etabsMCO.size}</strong> établissement`).test(l.html), `${etabsMCO.size} établissements listés`);
  const premier = [...etabsMCO.keys()][0].split('|');
  assert(l.html.includes(premier[0]) && l.html.includes(`(${premier[1]})`), 'chaque établissement avec sa commune');
  assert(!/\(\d+,\d %\)/.test(l.html.replace(/<details[\s\S]*?<\/details>/g, '')), 'pas de pourcentages dans une liste');
  const e = qo('donne moi la liste des établissements', true);
  assert(e?.kind === 'group_by' && /Établissements/.test(e.html) && (e.plan.filters || []).length === 2, '« la liste des établissements » : idem');
  const x = qo('exporte la liste des BTS en Gironde');
  assert(x?.kind === 'export', 'faux positif : « exporte … » reste un export Excel');
});

await describe('Question directe : la liste des établissements, pas des intitulés', () => {
  for (const q of ['donne moi la liste des établissements proposant un BTS MCO en gironde', 'quels établissements proposent le BTS MCO en Gironde']) {
    const e = qo(q);
    assert(e?.kind === 'group_by' && /^Établissement/.test(e.plan.targetCol) && new RegExp(`<strong>${etabsMCO.size}</strong> établissement`).test(e.html), `« ${q} » : ${etabsMCO.size} établissements (obtenu : ${e?.kind} ${e?.plan?.targetCol})`);
  }
  const f = qo('liste des formations de BTS MCO en Gironde');
  assert(f?.kind === 'group_by' && !/^Établissement/.test(f.plan.targetCol), 'faux positif : « liste des formations » reste une liste d\'intitulés');
  const t = qo('quels lycées proposent le plus de BTS');
  assert(t?.kind === 'top', 'faux positif : « … le plus de BTS » reste un classement');
});

await describe('Fichier de candidats : liste des lycées', async () => {
  const ROWS = D.exportAcademique(2000, 21);
  const cf = makeCtx();
  cf.XLSX.read = () => ({ SheetNames: ['BDD'], Sheets: { BDD: 'ws' } });
  cf.XLSX.utils.sheet_to_json = () => ROWS.map(r => r.slice());
  await run(cf, 'importSpreadsheetFile')({ name: 'BDD.xlsx', size: 1000, arrayBuffer: async () => new ArrayBuffer(8) });
  const qf = asker(cf);
  qf('combien de candidats admis en CPGE');
  const l = qf('donne moi la liste des établissements', true);
  const H = D.EXPORT_ACADEMIQUE_ENTETES;
  const nbEtab = new Set(ROWS.slice(1).filter(r => r[7] === 'Oui' && r[17] === 'CPGE - CPES').map(r => `${r[4]}|${r[2]}`)).size;
  assert(l?.kind === 'group_by' && l.plan.targetCol === H[4] && new RegExp(`<strong>${nbEtab}</strong> établissement`).test(l.html) && /candidats?/.test(l.html), `admis en CPGE >> liste : ${nbEtab} lycées d'origine, en candidats`);
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
