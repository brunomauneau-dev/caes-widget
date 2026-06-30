// pr42.test.js — Tests PR 4.2 (suggestions de questions guidées, générées
// dynamiquement depuis le schéma réel de la table Grist connectée)
//
// Historique : la première version de buildDynamicSuggestions lisait
// gristRecords brut (Object.keys(gristRecords[0])). En usage réel (30/06),
// une table Grist alimentée par import Excel exposait des colonnes nommées
// "A", "B", "C"... (les vrais intitulés vivant dans la première ligne de
// données) — buildDynamicSuggestions ne reconnaissait alors aucune colonne
// et tombait systématiquement en fallback statique. Corrigé en passant par
// buildGristQueryTable() (documents.js), qui sait déjà reconstruire les bons
// en-têtes dans ce cas — c'est ce que le Data Engine utilise pour ses propres
// réponses, donc les suggestions doivent emprunter le même chemin.
//
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
assert(/buildGristQueryTable\(\)/.test(fnMatch[0]), 'RÉGRESSION GARDÉE : buildDynamicSuggestions passe bien par buildGristQueryTable() (pas par gristRecords brut)');
if (!templatesMatch || !priorityMatch || !fnMatch) {
  console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
  process.exit(1);
}

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

// Reproduit fidèlement la logique réelle de buildGristQueryTable (documents.js) :
// si toutes les colonnes ont un nom générique (A, B, C...), reconstruit les
// en-têtes depuis la première ligne de données.
function makeBuildGristQueryTable(gristRecords) {
  if (!gristRecords || !gristRecords.length) return null;
  const allFields = Object.keys(gristRecords[0]).filter(f => f !== 'id' && f !== 'manualSort');
  if (!allFields.length) return null;
  const isGeneric = (f) => /^[A-Z]{1,2}$/.test(f);
  const genericColumns = allFields.every(isGeneric);
  if (genericColumns && gristRecords.length > 1) {
    const first = gristRecords[0];
    const headers = allFields.map(f => {
      const v = first[f];
      return (v === undefined || v === null || String(v).trim() === '') ? f : String(v).trim();
    });
    const usable = headers.filter(Boolean);
    const objects = gristRecords.slice(1).map(rec => {
      const obj = {};
      allFields.forEach((f, i) => { if (headers[i]) obj[headers[i]] = rec[f]; });
      return obj;
    });
    return { source: 'Grist', name: 'Table Grist connectée', headers: usable, objects };
  }
  return { source: 'Grist', name: 'Table Grist connectée', headers: allFields, objects: gristRecords };
}

function makeBuildDynamicSuggestions(gristRecords, columnKindFn) {
  const fn = new Function(
    'window', 'buildGristQueryTable',
    `${columnKindStub}${templatesMatch[0]}${priorityMatch[0]}${fnMatch[0]}return buildDynamicSuggestions();`
  );
  return fn({ plannerColumnKind: columnKindFn }, () => makeBuildGristQueryTable(gristRecords));
}

// ─── Cas 1 : pas de données Grist → pas de suggestions dynamiques (fallback attendu) ─
describe('buildDynamicSuggestions — sans données Grist', () => {
  assert(makeBuildDynamicSuggestions([], () => 'generic') === null, 'gristRecords vide → null (le fallback statique doit prendre le relais)');
  assert(makeBuildDynamicSuggestions(null, () => 'generic') === null, 'gristRecords null → null, pas de crash');
});

// ─── Cas 2 : table avec colonnes nommées normalement ────────────────────────
describe('buildDynamicSuggestions — table avec vrais noms de colonnes (boursier, zone basque, académie)', () => {
  const records = [{
    id: 1,
    'Boursier des lycées': 'Oui',
    'Zone du Pays Basque': 'Oui',
    'Académie de l\'établissement d\'accueil acceptée': 'Bordeaux',
    manualSort: 1
  }];
  const _testColumnKind = (col) => {
    const c = String(col || '').toLowerCase();
    if (/zone.*pays.*basque|pays.*basque/.test(c)) return 'zone_basque';
    if (/boursier|bourse/.test(c)) return 'boursier';
    if (/academie|académie/.test(c)) return 'academie';
    return 'generic';
  };
  const suggestions = makeBuildDynamicSuggestions(records, _testColumnKind);
  assert(Array.isArray(suggestions) && suggestions.length > 0, 'retourne une liste non vide');
  assert(suggestions.some(s => /boursier/i.test(s)), 'une suggestion porte sur les boursiers (colonne présente dans le schéma)');
  assert(suggestions.some(s => /pays basque/i.test(s)), 'une suggestion porte sur le Pays Basque (colonne présente)');
  assert(suggestions.some(s => /académie/i.test(s)), 'une suggestion porte sur l\'académie (colonne présente)');
});

// ─── Cas 3 (RÉGRESSION RÉELLE 30/06) : colonnes A/B/C, vrais noms en 1ère ligne ─
describe('buildDynamicSuggestions — table importée d\'Excel : colonnes A/B/C avec vrais intitulés en première ligne', () => {
  const records = [
    { A: 'Boursier des lycées', B: 'Zone du Pays Basque', C: 'Académie d\'accueil', manualSort: 0 },
    { A: 'Oui', B: 'Oui', C: 'Bordeaux', manualSort: 1 },
    { A: 'Non', B: 'Non', C: 'Toulouse', manualSort: 2 },
  ];
  const _testColumnKind = (col) => {
    const c = String(col || '').toLowerCase();
    if (/zone.*pays.*basque|pays.*basque/.test(c)) return 'zone_basque';
    if (/boursier/.test(c)) return 'boursier';
    if (/academie|académie/.test(c)) return 'academie';
    return 'generic';
  };
  const suggestions = makeBuildDynamicSuggestions(records, _testColumnKind);
  assert(Array.isArray(suggestions) && suggestions.length > 0, 'AVANT LE FIX : retournait null (fallback statique systématique) — maintenant retourne des suggestions');
  assert(suggestions.some(s => /boursier/i.test(s)), 'reconnaît "Boursier des lycées" malgré la clé brute générique "A"');
  assert(suggestions.some(s => /pays basque/i.test(s)), 'reconnaît "Zone du Pays Basque" malgré la clé brute générique "B"');
});

// ─── Cas 4 : table SANS colonnes métier connues → pas de suggestions mortes ─
describe('buildDynamicSuggestions — table différente, sans colonnes métier reconnues (changement de données)', () => {
  const records = [{ id: 1, 'Région': 'Nouvelle-Aquitaine', 'Score': 14, manualSort: 1 }];
  const suggestions = makeBuildDynamicSuggestions(records, () => 'generic');
  assert(suggestions === null, 'aucune colonne reconnue → null (pas de suggestion "Pays Basque" hors-sujet sur une table sans cette donnée)');
});

// ─── Cas 5 : déduplication — une seule suggestion par kind même si plusieurs colonnes matchent ─
describe('buildDynamicSuggestions — déduplication par kind', () => {
  const records = [
    { id: 1, 'Boursier des lycées': 'x', 'Statut boursier secondaire': 'x', manualSort: 1 },
    { id: 2, 'Boursier des lycées': 'Oui', 'Statut boursier secondaire': 'Non', manualSort: 2 },
  ];
  const kindFn = (col) => /boursier/i.test(col) ? 'boursier' : 'generic';
  const suggestions = makeBuildDynamicSuggestions(records, kindFn);
  const boursierCount = suggestions.filter(s => /boursier/i.test(s)).length;
  assert(boursierCount === 1, `une seule suggestion "boursier" malgré 2 colonnes du même kind (obtenu : ${boursierCount})`);
});

// ─── Cas 6 : la limite max est respectée ────────────────────────────────────
describe('buildDynamicSuggestions — respecte la limite max (lisibilité de l\'UI)', () => {
  const records = [
    { id: 1, boursier: 'x', basque: 'x', serie: 'x', academie: 'x', formation: 'x', apprenti: 'x', sexe: 'x', voeu: 'x', manualSort: 1 },
    { id: 2, boursier: 'a', basque: 'b', serie: 'c', academie: 'd', formation: 'e', apprenti: 'f', sexe: 'g', voeu: 'h', manualSort: 2 },
  ];
  const kindFn = (col) => {
    const map = { boursier: 'boursier', basque: 'zone_basque', serie: 'bac_series', academie: 'academie', formation: 'formation', apprenti: 'apprentissage', sexe: 'sexe', voeu: 'voeu' };
    return map[col] || 'generic';
  };
  const suggestions = makeBuildDynamicSuggestions(records, kindFn);
  assert(suggestions.length <= 6, `pas plus de 6 suggestions affichées même avec 8 kinds détectés (obtenu : ${suggestions.length})`);
});

// ─── Cas 7 (RÉGRESSION RÉELLE 30/06) : renderSuggestions ne doit pas planter ─
// quand #suggestions est absent du DOM (cas réel : session avec historique,
// l'empty-state — et donc #suggestions — n'est pas dans le DOM à ce moment).
describe('renderSuggestions — ne plante pas si #suggestions est absent du DOM', () => {
  const renderMatch = src.match(/function renderSuggestions\(\)[\s\S]*?\n}\n/);
  assert(!!renderMatch, 'renderSuggestions trouvée dans albert.js');
  if (renderMatch) {
    assert(/if \(!wrap\) return/.test(renderMatch[0]), 'garde-fou "if (!wrap) return" présent (corrige le crash "wrap is null" observé en usage réel)');
    const fn = new Function(
      'document', 'gristRecords', 'window', 'SUGGESTIONS', 'buildGristQueryTable',
      `${templatesMatch[0]}${priorityMatch[0]}${fnMatch[0]}${renderMatch[0]}renderSuggestions();`
    );
    let threw = false;
    try {
      fn({ getElementById: () => null }, [], { plannerColumnKind: () => 'generic' }, ['fallback'], () => null);
    } catch (e) { threw = true; }
    assert(!threw, 'aucune exception levée quand getElementById("suggestions") renvoie null');
  }
});

console.log(`\n──────────────────────────────────────────────────`);
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed > 0) process.exit(1);
