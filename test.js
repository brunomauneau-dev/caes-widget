/**
 * test.js — Harness de test automatisé pour le Parcoursup Data Copilot
 * Usage : node test.js
 * Dépendances : js/planner.js, js/dataEngine.js, js/documents.js, js/infographic.js
 *
 * Couvre :
 *   - Détection d'intention (tool selection)
 *   - Détection et application des filtres (eq / neq)
 *   - Filtres persistants (déduplication par colonne)
 *   - Tableau croisé (pivot)
 *   - Régressions critiques (group_by vs pivot, "parmi" ≠ "par")
 */

'use strict';
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

// ─── Environnement Node → navigateur ──────────────────────────────────────────
global.window = global;
global.document = { getElementById: () => null };

// ─── Chargement des modules (vm.runInThisContext expose tout en global) ────────
const root = path.resolve(__dirname);

function load(file) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  vm.runInThisContext(src, { filename: file });
}

// Helpers extraits des modules dépendants (documents.js, infographic.js)
load('test_helpers.js');

// plannerPlanToDebugHtml stub (utilisé par dataEngine pour debug)
global.plannerPlanToDebugHtml = () => '';

// Stub getActiveQueryTables — sera remplacé avant chaque test suite
let _activeTable = null;
global.getActiveQueryTables = () => _activeTable ? [_activeTable] : [];

// Chargement des vrais modules
load('js/planner.js');
load('js/dataEngine.js');

// ─── Table de test représentative ─────────────────────────────────────────────
function makeTable(rows) {
  const headers = Object.keys(rows[0] || {});
  return { source: 'Grist', name: 'test', headers, objects: rows };
}

// Données minimales : 10 lignes avec des profils variés
const TEST_ROWS = [
  { 'Zone du Pays Basque': 'Oui', 'Grands groupes de formation d\'accueil acceptée': 'CPGE - CPES', 'Académie de l\'établissement d\'accueil acceptée': 'Bordeaux', 'Série de la Classe': 'Série Générale', 'Boursier des lycées': 'Non boursier' },
  { 'Zone du Pays Basque': 'Oui', 'Grands groupes de formation d\'accueil acceptée': 'CPGE - CPES', 'Académie de l\'établissement d\'accueil acceptée': 'Toulouse',  'Série de la Classe': 'Série Générale', 'Boursier des lycées': 'Boursier des lycées' },
  { 'Zone du Pays Basque': 'Oui', 'Grands groupes de formation d\'accueil acceptée': 'L1 - CUPGE - DEUST - DU', 'Académie de l\'établissement d\'accueil acceptée': 'Bordeaux', 'Série de la Classe': 'Professionnelle', 'Boursier des lycées': 'Non boursier' },
  { 'Zone du Pays Basque': 'Oui', 'Grands groupes de formation d\'accueil acceptée': 'BTS - BTSA - DTS - DMA',  'Académie de l\'établissement d\'accueil acceptée': 'Bordeaux', 'Série de la Classe': 'Série Générale', 'Boursier des lycées': 'Boursier des lycées' },
  { 'Zone du Pays Basque': 'Non', 'Grands groupes de formation d\'accueil acceptée': 'CPGE - CPES', 'Académie de l\'établissement d\'accueil acceptée': 'Paris',     'Série de la Classe': 'Série Générale', 'Boursier des lycées': 'Non boursier' },
  { 'Zone du Pays Basque': 'Non', 'Grands groupes de formation d\'accueil acceptée': 'CPGE - CPES', 'Académie de l\'établissement d\'accueil acceptée': 'Lyon',      'Série de la Classe': 'Série Générale', 'Boursier des lycées': 'Boursier des lycées' },
  { 'Zone du Pays Basque': 'Non', 'Grands groupes de formation d\'accueil acceptée': 'L1 - CUPGE - DEUST - DU', 'Académie de l\'établissement d\'accueil acceptée': 'Bordeaux', 'Série de la Classe': 'Professionnelle', 'Boursier des lycées': 'Non boursier' },
  { 'Zone du Pays Basque': 'Non', 'Grands groupes de formation d\'accueil acceptée': 'L1 - CUPGE - DEUST - DU', 'Académie de l\'établissement d\'accueil acceptée': 'Toulouse',  'Série de la Classe': 'Série Générale', 'Boursier des lycées': 'Non boursier' },
  { 'Zone du Pays Basque': 'Non', 'Grands groupes de formation d\'accueil acceptée': 'BTS - BTSA - DTS - DMA',  'Académie de l\'établissement d\'accueil acceptée': 'Paris',     'Série de la Classe': 'Professionnelle','Boursier des lycées': 'Non boursier' },
  { 'Zone du Pays Basque': 'Non', 'Grands groupes de formation d\'accueil acceptée': 'L1 - CUPGE - DEUST - DU', 'Académie de l\'établissement d\'accueil acceptée': 'Lyon',      'Série de la Classe': 'Série Générale', 'Boursier des lycées': 'Boursier des lycées' },
];
// Comptes connus sur ces données :
// Basques total : 4 | Non-basques : 6
// Basques en CPGE : 2 | Non-basques en CPGE : 2
// Boursiers basques : 2 (rows 1 et 3)
// Répartition académies basques : Bordeaux 3, Toulouse 1

const TABLE = makeTable(TEST_ROWS);

function setup() {
  _activeTable = TABLE;
  // Reset état Data Engine
  window.__DATA_ENGINE_STATE = { lastPlan: null, lastExecution: null, history: [] };
  // Pas de filtres persistants (géré par dataEngine en interne)
  global.persistentFilters = [];
}

// ─── Framework de test minimaliste ────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];

function test(name, fn) {
  try {
    setup();
    fn();
    process.stdout.write(`  ✅ ${name}\n`);
    passed++;
  } catch (e) {
    process.stdout.write(`  ❌ ${name}\n     → ${e.message}\n`);
    failures.push({ name, error: e.message });
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion échouée');
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(`${msg || ''} : attendu ${JSON.stringify(b)}, obtenu ${JSON.stringify(a)}`);
}

function ask(question) {
  const plan = detectDataEnginePlan(question);
  if (!plan) throw new Error(`detectDataEnginePlan a retourné null pour : "${question}"`);
  return { plan, exec: runDataEnginePlan(plan) };
}

// ─── SUITE 1 : Détection d'intention (tool) ───────────────────────────────────
console.log('\n📋 Suite 1 — Détection d\'intention\n');

test('count_rows pour "combien de basques"', () => {
  const { plan } = ask('combien de basques');
  assertEqual(plan.tool, 'count_rows', 'tool');
});

test('count_rows pour "combien de basques en CPGE"', () => {
  const { plan } = ask('combien de basques en CPGE');
  assertEqual(plan.tool, 'count_rows', 'tool');
});

test('group_by pour "répartition par académie"', () => {
  const { plan } = ask('répartition par académie');
  assert(plan.tool === 'group_by' || plan.tool === 'top', `outil = ${plan.tool}`);
});

test('group_by pour "répartition par série"', () => {
  const { plan } = ask('répartition par série');
  assert(plan.tool === 'group_by' || plan.tool === 'top', `outil = ${plan.tool}`);
});

test('pivot pour "répartition des formations par académie"', () => {
  const { plan } = ask('répartition des formations par académie');
  assertEqual(plan.tool, 'pivot', 'tool');
});

test('group_by (pas pivot) pour "répartition des académies parmi les CPGE"', () => {
  const { plan } = ask('répartition des académies parmi les CPGE');
  assert(plan.tool !== 'pivot', `Ne doit pas être pivot, outil = ${plan.tool}`);
});

test('pivot pour "croise les formations et les académies"', () => {
  const { plan } = ask('croise les formations et les académies');
  assertEqual(plan.tool, 'pivot', 'tool');
});

test('chart_current pour "camembert" seul', () => {
  // D'abord une question normale pour créer un contexte
  ask('répartition par académie');
  const plan = detectDataEnginePlan('camembert');
  assertEqual(plan.tool, 'chart_current', 'tool');
});

// ─── SUITE 2 : Filtres eq / neq ───────────────────────────────────────────────
console.log('\n📋 Suite 2 — Filtres eq / neq\n');

test('filtre basque = oui pour "combien de basques"', () => {
  const { plan } = ask('combien de basques');
  const f = plan.filters.find(f => /basque/i.test(f.col));
  assert(f, 'Filtre basque non trouvé');
  assertEqual(f.op || 'eq', 'eq', 'op');
  assertEqual(normalizeText(f.value), 'oui', 'value');
});

test('filtre basque ≠ oui pour "combien de non basques"', () => {
  const { plan } = ask('combien de non basques en CPGE');
  const f = plan.filters.find(f => /basque/i.test(f.col));
  assert(f, 'Filtre basque non trouvé');
  assertEqual(f.op, 'neq', 'op doit être neq');
});

test('filtre basque ≠ oui pour "combien hors pays basque"', () => {
  const { plan } = ask('combien hors pays basque');
  const f = plan.filters.find(f => /basque/i.test(f.col));
  assert(f, 'Filtre basque non trouvé');
  assertEqual(f.op, 'neq', 'op doit être neq');
});

test('double filtre basque + CPGE pour "combien de basques en CPGE"', () => {
  const { plan } = ask('combien de basques en CPGE');
  const basque = plan.filters.find(f => /basque/i.test(f.col));
  const cpge   = plan.filters.find(f => /grands groupes|formation/i.test(f.col));
  assert(basque, 'Filtre basque manquant');
  assert(cpge,   'Filtre CPGE manquant');
  assertEqual(basque.op || 'eq', 'eq', 'basque op');
});

// ─── SUITE 3 : Résultats chiffrés ─────────────────────────────────────────────
console.log('\n📋 Suite 3 — Résultats chiffrés (données test)\n');

test('count basques = 4', () => {
  const { exec } = ask('combien de basques');
  assertEqual(exec.result.count, 4, 'count basques');
});

test('count basques en CPGE = 2', () => {
  const { exec } = ask('combien de basques en CPGE');
  assertEqual(exec.result.count, 2, 'count basques CPGE');
});

test('count non-basques en CPGE = 2', () => {
  const { exec } = ask('combien de non basques en CPGE');
  assertEqual(exec.result.count, 2, 'count non-basques CPGE');
});

test('count hors pays basque = 6', () => {
  const { exec } = ask('combien hors pays basque');
  assertEqual(exec.result.count, 6, 'count hors basque');
});

test('group_by académies des basques : Bordeaux en tête', () => {
  const { exec } = ask('répartition des académies des basques');
  assert(exec.result && exec.result.rows, 'Pas de rows dans le résultat');
  const top = exec.result.rows[0];
  assert(/bordeaux/i.test(top.value), `Bordeaux attendu en tête, obtenu : ${top.value}`);
  assertEqual(top.count, 3, 'Bordeaux count');
});

// ─── SUITE 4 : Filtres persistants ────────────────────────────────────────────
console.log('\n📋 Suite 4 — Filtres persistants\n');

test('filtre persistant basque s\'applique à "répartition par série"', () => {
  global.persistentFilters = [{ col: 'Zone du Pays Basque', value: 'Oui', op: 'eq' }];
  const { exec } = ask('répartition par série');
  // Avec filtre basque (4 lignes), total < 10
  assert(exec.result.total < 10, `Total attendu < 10 avec filtre persistant, obtenu ${exec.result.total}`);
  assertEqual(exec.result.total, 4, 'total avec filtre basque persistant');
});

test('filtre persistant basque=oui ne s\'applique PAS quand la question dit "non basques"', () => {
  global.persistentFilters = [{ col: 'Zone du Pays Basque', value: 'Oui', op: 'eq' }];
  const { exec } = ask('combien de non basques en CPGE');
  // Sans conflit, on doit avoir les non-basques en CPGE = 2
  assertEqual(exec.result.count, 2, 'non-basques CPGE malgré persistent basque=oui');
});

test('filtre persistant CPGE s\'ajoute quand la question ne mentionne pas CPGE', () => {
  global.persistentFilters = [{ col: 'Grands groupes de formation d\'accueil acceptée', value: 'CPGE - CPES', op: 'eq' }];
  const { exec } = ask('combien de basques');
  // Avec filtre CPGE persistant et basque de la question : 2 lignes
  assertEqual(exec.result.count, 2, 'basques en CPGE via filtre persistant');
});

// ─── SUITE 5 : Régressions critiques ──────────────────────────────────────────
console.log('\n📋 Suite 5 — Régressions\n');

test('"visualisation des académies" reste group_by (pas pivot)', () => {
  const { plan } = ask('visualisation des académies');
  assert(plan.tool !== 'pivot', `Ne doit pas être pivot`);
  assert(plan.tool === 'group_by' || plan.tool === 'top', `outil = ${plan.tool}`);
});

test('"répartition académique des CPGE" cible la colonne Académie', () => {
  const { plan } = ask('répartition académique des CPGE');
  assert(/acad/i.test(plan.targetCol || ''), `targetCol attendu = académie, obtenu : ${plan.targetCol}`);
});

test('"camembert des académies" déclenche bien le Data Engine (pas Albert)', () => {
  const plan = detectDataEnginePlan('camembert des académies');
  assert(plan !== null, 'Doit être traité par le Data Engine');
  assert(plan.renderChart === true, 'renderChart doit être true');
});

test('"boursiers basques" applique bien deux filtres', () => {
  const { plan } = ask('combien de boursiers basques');
  const basque   = plan.filters.find(f => /basque/i.test(f.col));
  const boursier = plan.filters.find(f => /boursier/i.test(f.col));
  assert(basque,   'Filtre basque manquant');
  assert(boursier, 'Filtre boursier manquant');
});

// ─── Rapport final ────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n${'─'.repeat(50)}`);
console.log(`Résultat : ${passed}/${total} tests réussis`);
if (failed > 0) {
  console.log(`\n⚠️  ${failed} échec${failed > 1 ? 's' : ''} :`);
  failures.forEach(f => console.log(`  • ${f.name}\n    ${f.error}`));
  process.exit(1);
} else {
  console.log('Tous les tests sont vert. ✅');
  process.exit(0);
}
