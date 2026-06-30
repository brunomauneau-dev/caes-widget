// test_clear_titles.js — Titres clairs des blocs (type + colonne + périmètre)
// Corrige un bug réel : extractBlockTitle('compare', ...) perdait le périmètre actif
// (ex: filtre "Pays Basque" hérité disparaissait du titre "Comparaison : Boursiers vs Non-boursiers")
// node js/test_clear_titles.js

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
function describe(label, fn) { console.log(`\n${label}`); fn(); }

// ─── Charger le vrai extractBlockTitle depuis sessions.js ──────────────────
const sessionsSrc = fs.readFileSync(path.join(__dirname, 'sessions.js'), 'utf8');
const ctx = { console };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext('function normalizeText(s){return String(s||"").toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").trim();}', ctx);
vm.runInContext(sessionsSrc, ctx, { filename: 'sessions.js' });
const extractBlockTitle = ctx.extractBlockTitle;

// ─── Cas réels rapportés (audit du 30/06) ──────────────────────────────────
describe('extractBlockTitle — group_by avec filtre actif (cas Académie/Pays Basque)', () => {
  const exec = {
    plan: { tool: 'group_by', targetCol: 'Académie de l\'établissement d\'accueil acceptée', filters: [{ col: 'Zone du Pays Basque', value: 'Pays Basque' }] },
    result: { total: 3499 }
  };
  const title = extractBlockTitle(exec, 'répartition par académie des candidats du Pays Basque');
  assert(title.includes('Académies'), 'le titre mentionne la colonne (Académies)');
  assert(title.includes((3499).toLocaleString('fr-FR')), 'le titre mentionne le total de lignes');
  assert(title.includes('Pays Basque') || title.toLowerCase().includes('basque'), 'le titre mentionne le périmètre actif');
});

describe('extractBlockTitle — compare AVEC filtre hérité (régression corrigée)', () => {
  const exec = {
    plan: { tool: 'compare', compareGroups: [{ label: 'Boursiers' }, { label: 'Non-boursiers' }], filters: [{ col: 'Zone du Pays Basque', value: 'Pays Basque' }] }
  };
  const title = extractBlockTitle(exec, 'compare les boursiers et les non-boursiers');
  assert(title.includes('Boursiers') && title.includes('Non-boursiers'), 'le titre mentionne les deux groupes comparés');
  assert(title.toLowerCase().includes('basque'), 'RÉGRESSION CORRIGÉE : le titre mentionne maintenant le périmètre hérité (avant : disparaissait silencieusement)');
});

describe('extractBlockTitle — compare SANS filtre actif : pas de périmètre fantôme', () => {
  const exec = {
    plan: { tool: 'compare', compareGroups: [{ label: 'Boursiers' }, { label: 'Non-boursiers' }], filters: [] }
  };
  const title = extractBlockTitle(exec, 'compare les boursiers et les non-boursiers');
  assert(title === 'Comparaison : Boursiers vs Non-boursiers', 'pas de tiret ni de périmètre ajouté quand filters est vide');
});

describe('extractBlockTitle — deux blocs différents restent distinguables (cas compositeur)', () => {
  const execA = { plan: { tool: 'group_by', targetCol: 'Série de la Classe', filters: [] }, result: { total: 1200 } };
  const execB = { plan: { tool: 'group_by', targetCol: 'Académie de l\'établissement d\'accueil acceptée', filters: [{ col: 'Boursier des lycées', value: 'Boursier des lycées' }] }, result: { total: 592 } };
  const titleA = extractBlockTitle(execA, '');
  const titleB = extractBlockTitle(execB, '');
  assert(titleA !== titleB, 'les deux blocs ont des titres distincts (utilisable dans une liste à cocher)');
  assert(titleB.toLowerCase().includes('boursier'), 'le bloc filtré boursiers le montre dans son titre');
});

console.log(`\n──────────────────────────────────────────────────`);
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed > 0) process.exit(1);
