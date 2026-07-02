// test_planner_columkind.js — Vérification de columnKind sur les 22 colonnes
// réelles de la BDD académique 2025 (export SAP BO → Grist).
// Couvre deux corrections apportées le 02/07/2026 :
// 1. nb_voeux avant voeu : "Nb total de vœux..." → nb_voeux (pas voeu)
// 2. nrm() : remplacement œ→oe avant NFD pour que vœux soit reconnu
// 3. Colonnes techniques (Code UAI, Ministère, Numéro) → generic
// node js/test_planner_columnkind.js

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

// Charger planner.js dans un contexte vm
const plannerSrc = fs.readFileSync(path.join(__dirname, 'planner.js'), 'utf8');
const ctx = { console, window: {} };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(plannerSrc, ctx, { filename: 'planner.js' });
const columnKind = ctx.window.plannerColumnKind;

// Les 22 colonnes réelles de la BDD académique 2025 avec le kind attendu
const REAL_COLUMNS = [
  ['Département de l\'établissement de la scolarité', 'departement'],
  ['Code UAI établissement de la scolarité',          'generic'],      // code technique, pas analytique
  ['Commune de l\'établissement de la scolarité',     'commune'],
  ['Zone du Pays Basque',                             'zone_basque'],
  ['Etablissement de la scolarité',                   'etablissement_origine_nom'],
  ['Numéro Parcoursup*',                              'generic'],      // identifiant candidat
  ['A eu une proposition au cours de la procédure Parcoursup (Oui/Non)', 'admission'],
  ['A actuellement répondu favorablement à une proposition (Oui/Non)',    'admission'],
  ['Apprenti',                                        'apprentissage'],
  ['Boursier des lycées',                             'boursier'],
  ['Ministère de rattachement établissement de la scolarité', 'generic'], // technique
  ['Type de contrat établissement de la scolarité',   'generic'],      // technique
  ['Type de la classe',                               'bac_series'],
  ['Série de la Classe',                              'bac_series'],
  ['Spécialité',                                      'formation'],
  ['Enseignement(s) de spécialité suivi(s)',          'formation'],
  ['Nb total de vœux confirmés en phase principale',  'nb_voeux'],     // ← bug corrigé (vœux avec œ)
  ['Grands groupes de formation d\'accueil acceptée', 'formation'],
  ['Académie de l\'établissement d\'accueil acceptée', 'academie'],
  ['Spécialité / mention formation d\'accueil acceptée', 'formation'],
  ['Etablissement d\'accueil accepté',                'etablissement_accueil'],
  ['Commune de l\'établissement d\'accueil accepté',  'commune'],
];

describe('columnKind — 22 vraies colonnes BDD académique 2025', () => {
  REAL_COLUMNS.forEach(([col, expected]) => {
    const got = columnKind(col);
    assert(got === expected, `"${col.slice(0, 50)}" → ${expected} (obtenu: ${got})`);
  });
});

describe('Corrections spécifiques du 02/07/2026', () => {
  // Bug principal : œ non reconnu après normalisation NFD (U+0153 → espace)
  assert(columnKind('Nb total de vœux confirmés en phase principale') === 'nb_voeux',
    'vœux (avec ligature œ) correctement reconnu après normalisation');
  assert(columnKind('Nb de vœux') === 'nb_voeux',
    'variante courte "Nb de vœux" → nb_voeux');
  assert(columnKind('Nombre de vœux') === 'nb_voeux',
    '"Nombre de vœux" → nb_voeux');
  assert(columnKind('Vœux confirmés') === 'voeu',
    '"Vœux confirmés" sans nb/nombre → voeu (pas nb_voeux)');

  // Colonnes techniques → generic
  assert(columnKind('Code UAI établissement') === 'generic',
    'Code UAI → generic (pas etablissement)');
  assert(columnKind('Numéro Parcoursup') === 'generic',
    'Numéro Parcoursup → generic (identifiant, pas analytique)');
  assert(columnKind('Ministère de rattachement') === 'generic',
    'Ministère de rattachement → generic (technique)');
});

describe('Non-régression — colonnes qui doivent rester stables', () => {
  assert(columnKind('Zone du Pays Basque') === 'zone_basque', 'zone_basque stable');
  assert(columnKind('Boursier des lycées') === 'boursier', 'boursier stable');
  assert(columnKind('Académie de l\'établissement d\'accueil acceptée') === 'academie', 'academie stable');
  assert(columnKind('Série de la Classe') === 'bac_series', 'bac_series stable');
  assert(columnKind('Grands groupes de formation d\'accueil acceptée') === 'formation', 'formation stable');
  assert(columnKind('A actuellement répondu favorablement à une proposition (Oui/Non)') === 'admission', 'admission stable');
  assert(columnKind('Apprenti') === 'apprentissage', 'apprentissage stable');
});

console.log(`\n──────────────────────────────────────────────────`);
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed > 0) process.exit(1);
