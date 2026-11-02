// test_column_detection.js — Détection de colonnes dans une table inconnue.
// Vérifie les deux filets de sécurité ajoutés à planner.js (v27.5.9) :
//   1. noms abrégés / identifiants Grist (LIB_ACA_ACC, DEP_SCO, Dpt, Bac…)
//   2. détection par le contenu quand le nom ne dit rien (Colonne A, Champ 3…)
// … et surtout qu'ils ne reclassent PAS à tort (colonnes techniques,
// communes, Oui/Non, nombres).
// node js/test_column_detection.js

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

const plannerSrc = fs.readFileSync(path.join(__dirname, 'planner.js'), 'utf8');
const ctx = { console, window: {} };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(plannerSrc, ctx, { filename: 'planner.js' });
const kind = ctx.window.plannerColumnKind;
const fromValues = ctx.window.plannerColumnKindFromValues;

// Fabrique [{value, count}] à partir d'une liste de valeurs
const V = (...xs) => xs.map(x => Array.isArray(x) ? { value: x[0], count: x[1] } : { value: x, count: 10 });

describe('Noms abrégés et identifiants de colonnes Grist', () => {
  const cases = [
    ['LIB_ACA_ACC', 'academie'],
    ['DEP_SCO', 'departement'],
    ['Dpt scolarité', 'departement'],
    ['COM_ETAB', 'commune'],
    ['Bac', 'bac_series'],
    ['SERIE_BAC', 'bac_series'],
    ['NB_VOEUX_PP', 'nb_voeux'],
    ['Academie_de_l_etablissement_d_accueil_acceptee', 'academie'],
    ['Zone_du_Pays_Basque', 'zone_basque'],
    ['Etab acc', 'etablissement_accueil'],
  ];
  for (const [col, expected] of cases) {
    const got = kind(col);
    assert(got === expected, `"${col}" → ${expected} (obtenu : ${got})`);
  }
});

describe('Colonnes techniques : jamais reclassées', () => {
  for (const col of ['UAI_SCO', 'Code postal', 'CP', 'Numero_Parcoursup_', 'ID candidat', 'SIRET']) {
    const got = kind(col, V('Bordeaux', 'Gironde', 'Lycée Montaigne'));
    assert(got === 'generic', `"${col}" reste generic même avec des valeurs parlantes (obtenu : ${got})`);
  }
});

describe('Détection par le contenu (nom de colonne non parlant)', () => {
  const cases = [
    ['académies', V('Bordeaux', 'Toulouse', 'Poitiers', 'Limoges', 'Paris'), 'academie'],
    ['académies avec préfixe', V('Académie de Bordeaux', "Académie d'Aix-Marseille", 'Académie de Créteil'), 'academie'],
    ['départements', V('Gironde', 'Dordogne', 'Landes', 'Lot-et-Garonne', 'Pyrénées-Atlantiques'), 'departement'],
    ['départements avec code', V('33 - Gironde', '24 - Dordogne', '64 - Pyrénées-Atlantiques'), 'departement'],
    ['séries de bac', V('Générale', 'Technologique', 'Professionnelle', 'STMG', 'STI2D'), 'bac_series'],
    ['sexe', V('F', 'M'), 'sexe'],
    ['sexe en toutes lettres', V('Féminin', 'Masculin'), 'sexe'],
    ['formations', V('BTS - Management commercial', 'BUT - GEA', 'Licence - Droit', 'CPGE - MPSI'), 'formation'],
    ['établissements', V('Lycée Montaigne', 'Lycée Camille Jullian', 'Université de Bordeaux', 'IUT de Bayonne'), 'etablissement'],
  ];
  for (const [label, vals, expected] of cases) {
    const got = kind('Colonne G', vals);
    assert(got === expected, `${label} → ${expected} (obtenu : ${got})`);
  }
});

describe('Pas de faux positifs', () => {
  assert(fromValues(V('Bordeaux', 'Mérignac', 'Pessac', 'Talence', 'Bègles', 'Libourne')) === 'generic',
    'communes (dont Bordeaux) ≠ académie');
  assert(fromValues(V('Oui', 'Non')) === 'generic', 'Oui/Non → generic (booléen sans sens propre)');
  assert(fromValues(V('12', '3', '45', '7')) === 'generic', 'nombres → generic');
  assert(fromValues(V('0330021W', '0640011K', '0240005A')) === 'generic', 'codes UAI → generic');
  assert(fromValues(V('Bordeaux')) === 'generic', 'une seule valeur « Bordeaux » → ambigu, generic');
  assert(fromValues(V('Texte libre', 'Autre chose', 'Commentaire')) === 'generic', 'texte libre → generic');
  assert(fromValues([]) === 'generic', 'colonne vide → generic');
  assert(fromValues(V(['Gironde', 20], ['Mérignac', 80])) === 'generic',
    'majorité de valeurs non reconnues (pondéré par le nombre de lignes) → generic');
});

describe('Lecture automatique des valeurs dans la table active (Grist)', () => {
  // Simule une table Grist dont les colonnes ont des noms neutres
  ctx.buildGristQueryTable = () => ({
    headers: ['Champ 1', 'Champ 2', 'Champ 3'],
    objects: [
      { 'Champ 1': 'Gironde',  'Champ 2': 'Générale',      'Champ 3': 'Oui' },
      { 'Champ 1': 'Landes',   'Champ 2': 'Technologique', 'Champ 3': 'Non' },
      { 'Champ 1': 'Dordogne', 'Champ 2': 'Professionnelle', 'Champ 3': 'Oui' },
    ]
  });
  assert(kind('Champ 1') === 'departement', 'Champ 1 (départements) → departement sans passer les valeurs');
  assert(kind('Champ 2') === 'bac_series', 'Champ 2 (séries) → bac_series');
  assert(kind('Champ 3') === 'generic', 'Champ 3 (Oui/Non) → generic');
  assert(kind('Colonne absente') === 'generic', 'colonne absente de la table → generic, sans erreur');
  // Les noms connus ne dépendent pas du contenu
  assert(kind('Zone du Pays Basque') === 'zone_basque', 'nom connu prioritaire sur le contenu');
  delete ctx.buildGristQueryTable;
});

console.log('\n' + '─'.repeat(50));
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
