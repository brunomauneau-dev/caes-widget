// test_code_mort.js — Code jamais appelé retiré de documents.js.
// Anciennes versions remplacées depuis : tableaux croisés envoyés à Albert (buildCrossTabs),
// classement des colonnes en « familles » (PARCOURSUP_ONTOLOGY_RULES, classifyParcoursupColumn,
// summarizeColumnForOntology, detectParcoursupAnalysisIntent), ancienne détection des exports
// (LOCAL_TOOLS, isLocalExportRequest). Le test vérifie qu'ils ne reviennent pas, que rien ne les
// appelle, et que les fonctions encore utilisées sont toujours là.
// node js/test_code_mort.js

import fs from 'fs';
import vm from 'vm';
import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let passed = 0, failed = 0;
function assert(condition, label) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}`); failed++; }
}
async function describe(label, fn) { console.log(`\n${label}`); await fn(); }

const RETIRES = ['buildCrossTabs', 'CROSSTAB_FILTER_HINTS', 'CROSSTAB_RESULT_HINTS', 'MAX_FILTER_COLS', 'MAX_RESULT_COLS_PER_FILTER',
  'MAX_VALUES_PER_FILTER', 'MAX_BREAKDOWN_ITEMS', 'PARCOURSUP_ONTOLOGY_RULES', 'classifyParcoursupColumn', 'summarizeColumnForOntology',
  'detectParcoursupAnalysisIntent', 'LOCAL_TOOLS', 'isLocalExportRequest'];
const CONSERVES = ['normalizeText', 'getActiveDataSource', 'getActiveQueryTables', 'topCountsForRows', 'numericStatsForRows',
  'applyLocalActionFilters', 'rowMatchesFilter', 'sanitizeFilenamePart', 'importSpreadsheetFile', 'isEmptyCell'];

// Tous les fichiers du widget (hors tests) : un nom retiré ne doit être appelé nulle part
const racine = path.join(__dirname, '..');
const sources = [...fs.readdirSync(__dirname).filter(f => f.endsWith('.js') && !/^test_|\.test\.js$/.test(f)).map(f => path.join(__dirname, f)), path.join(racine, 'index.html')];
const textes = sources.map(f => [path.basename(f), fs.readFileSync(f, 'utf8')]);

await describe('Code retiré : absent de tous les fichiers du widget', async () => {
  RETIRES.forEach(n => {
    const ou = textes.filter(([, t]) => new RegExp(`\\b${n}\\b`).test(t)).map(([f]) => f);
    assert(!ou.length, `${n} : plus défini ni appelé${ou.length ? ` (encore dans ${ou.join(', ')})` : ''}`);
  });
});

await describe('Widget chargé : modules sans erreur, fonctions utiles présentes', async () => {
  const noopEl = () => null;
  const ctx = {
    console: { ...console, log() {}, warn() {}, info() {} }, setTimeout: () => null, clearTimeout() {}, URLSearchParams, TextDecoder, TextEncoder,
    document: { getElementById: noopEl, querySelector: noopEl, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, fetch: () => Promise.reject(new Error('hors ligne')),
  };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.selectedDocIds = new Set();
  vm.createContext(ctx);
  let erreur = null;
  try { for (const f of ['config.js', 'knowledge.js', 'documents.js', 'planner.js', 'dataEngine.js', 'sessions.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f }); }
  catch (e) { erreur = e.message; }
  assert(erreur === null, `les modules se chargent ensemble sans erreur${erreur ? ` (${erreur})` : ''}`);
  CONSERVES.forEach(n => assert(vm.runInContext(`typeof ${n}`, ctx) === 'function', `faux positif : ${n} toujours présent`));
  RETIRES.forEach(n => assert(vm.runInContext(`typeof ${n}`, ctx) === 'undefined', `${n} n'existe plus une fois le widget chargé`));
});

await describe('Aucune fonction de documents.js laissée sans appel', async () => {
  const doc = fs.readFileSync(path.join(__dirname, 'documents.js'), 'utf8');
  const noms = [...doc.matchAll(/^(?:async\s+)?function\s+(\w+)|^(?:const|let|var)\s+(\w+)\s*=/gm)].map(m => m[1] || m[2]);
  const tests = fs.readdirSync(__dirname).filter(f => /^test_|\.test\.js$/.test(f) && f !== 'test_code_mort.js').map(f => fs.readFileSync(path.join(__dirname, f), 'utf8'));
  const orphelins = noms.filter(n => {
    const re = new RegExp(`\\b${n}\\b`, 'g');
    const usages = textes.reduce((t, [, x]) => t + (x.match(re) || []).length, 0) - 1; // moins la définition
    return usages === 0 && !tests.some(t => re.test(t));
  });
  assert(!orphelins.length, `chaque fonction ou constante est utilisée${orphelins.length ? ` (orphelins : ${orphelins.join(', ')})` : ''}`);
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
