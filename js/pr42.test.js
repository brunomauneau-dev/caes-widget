// pr42.test.js — Tests PR 4.2 (suggestions de questions guidées, générées
// dynamiquement depuis le schéma réel de la table Grist connectée)
// node js/pr42.test.js

import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let passed = 0, failed = 0;
function assert(condition, label) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}`); failed++; }
}
function describe(label, fn) { console.log(`\n${label}`); fn(); }

// ─── Extraction de buildDynamicSuggestions + ses dépendances depuis albert.js ─
const src = fs.readFileSync(path.join(__dirname, 'albert.js'), 'utf8');

const templatesMatch = src.match(/const SUGGESTION_TEMPLATES = \{[\s\S]*?\n\};\n/);
const priorityMatch = src.match(/const SUGGESTION_KIND_PRIORITY = \[[\s\S]*?\];\n/);
const fnMatch = src.match(/function buildDynamicSuggestions\([\s\S]*?\n}\n/);
assert(!!templatesMatch, 'SUGGESTION_TEMPLATES trouvé dans albert.js');
assert(!!priorityMatch, 'SUGGESTION_KIND_PRIORITY trouvé dans albert.js');
assert(!!fnMatch, 'buildDynamicSuggestions trouvé dans albert.js');
if (!templatesMatch || !priorityMatch || !fnMatch) {
  console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
  process.exit(1);
}

// columnKind minimal fidèle au vrai planner.js, pour ce test isolé
// (reproduit les règles essentielles testées ici — pas une réimplémentation complète).
const columnKindStub = `
function _testColumnKind(col) {
  const c = String(col || '').toLowerCase();
  if (/zone.*pays.*basque|pays.*basque/.test(c)) return 'zone_basque';
  if (/boursier|bourse/.test(c)) return 'boursier';
  if (/serie.*classe|série.*classe/.test(c)) return 'bac_series';
  if (/academie|académie/.test(c)) return 'academie';
  if (/formation|specialite|spécialité/.test(c)) return 'formation';
  if (/apprenti/.test(c)) return 'apprentissage';
  if (/sexe/.test(c)) return 'sexe';
  if (/voeu|vœu/.test(c)) return 'voeu';
  return 'generic';
}
`;

function makeBuildDynamicSuggestions(gristRecords, columnKindFn) {
  const fn = new Function(
    'gristRecords', 'window',
    `${columnKindStub}${templatesMatch[0]}${priorityMatch[0]}${fnMatch[0]}return buildDynamicSuggestions();`
  );
  return fn(gristRecords, { plannerColumnKind: columnKindFn });
}

// ─── Cas 1 : pas de données Grist → pas de suggestions dynamiques (fallback attendu) ─
describe('buildDynamicSuggestions — sans données Grist', () => {
  assert(makeBuildDynamicSuggestions([], () => 'generic') === null, 'gristRecords vide → null (le fallback statique doit prendre le relais)');
  assert(makeBuildDynamicSuggestions(null, () => 'generic') === null, 'gristRecords null → null, pas de crash');
});

// ─── Cas 2 : table avec colonnes boursier + zone_basque + académie ──────────
describe('buildDynamicSuggestions — table réelle SAIO (boursier, zone basque, académie)', () => {
  const records = [{
    id: 1,
    'Boursier des lycées': 'Oui',
    'Zone du Pays Basque': 'Oui',
    'Académie de l\'établissement d\'accueil acceptée': 'Bordeaux',
    manualSort: 1
  }];
  const suggestions = makeBuildDynamicSuggestions(records, _testColumnKind);
  assert(Array.isArray(suggestions) && suggestions.length > 0, 'retourne une liste non vide');
  assert(suggestions.some(s => /boursier/i.test(s)), 'une suggestion porte sur les boursiers (colonne présente dans le schéma)');
  assert(suggestions.some(s => /pays basque/i.test(s)), 'une suggestion porte sur le Pays Basque (colonne présente)');
  assert(suggestions.some(s => /académie/i.test(s)), 'une suggestion porte sur l\'académie (colonne présente)');

  function _testColumnKind(col) {
    const c = String(col || '').toLowerCase();
    if (/zone.*pays.*basque|pays.*basque/.test(c)) return 'zone_basque';
    if (/boursier|bourse/.test(c)) return 'boursier';
    if (/academie|académie/.test(c)) return 'academie';
    return 'generic';
  }
});

// ─── Cas 3 : table SANS colonnes Pays Basque/boursier → pas de suggestions mortes ─
describe('buildDynamicSuggestions — table différente, sans colonnes métier connues (changement de données)', () => {
  const records = [{ id: 1, 'Région': 'Nouvelle-Aquitaine', 'Score': 14, manualSort: 1 }];
  const suggestions = makeBuildDynamicSuggestions(records, () => 'generic');
  assert(suggestions === null, 'aucune colonne reconnue → null (pas de suggestion "Pays Basque" hors-sujet sur une table sans cette donnée)');
});

// ─── Cas 4 : déduplication — une seule suggestion par kind même si plusieurs colonnes matchent ─
describe('buildDynamicSuggestions — déduplication par kind', () => {
  const records = [{ id: 1, 'Boursier des lycées': 'Oui', 'Statut boursier secondaire': 'Non', manualSort: 1 }];
  const kindFn = (col) => /boursier/i.test(col) ? 'boursier' : 'generic';
  const suggestions = makeBuildDynamicSuggestions(records, kindFn);
  const boursierCount = suggestions.filter(s => /boursier/i.test(s)).length;
  assert(boursierCount === 1, `une seule suggestion "boursier" malgré 2 colonnes du même kind (obtenu : ${boursierCount})`);
});

// ─── Cas 5 : la limite max est respectée ────────────────────────────────────
describe('buildDynamicSuggestions — respecte la limite max (lisibilité de l\'UI)', () => {
  const records = [{
    id: 1,
    boursier: 'x', basque: 'x', serie: 'x', academie: 'x', formation: 'x',
    apprenti: 'x', sexe: 'x', voeu: 'x', manualSort: 1
  }];
  const kindFn = (col) => {
    const map = { boursier: 'boursier', basque: 'zone_basque', serie: 'bac_series', academie: 'academie', formation: 'formation', apprenti: 'apprentissage', sexe: 'sexe', voeu: 'voeu' };
    return map[col] || 'generic';
  };
  const suggestions = makeBuildDynamicSuggestions(records, kindFn);
  assert(suggestions.length <= 6, `pas plus de 6 suggestions affichées même avec 8 kinds détectés (obtenu : ${suggestions.length})`);
});

console.log(`\n──────────────────────────────────────────────────`);
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed > 0) process.exit(1);
