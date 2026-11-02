// test_albert_column_context.js — Le contexte envoyé à Albert (synthèse de
// table, documents.js) utilise la détection de colonnes de planner.js :
// une table aux colonnes abrégées ou neutres est décrite avec le sens
// détecté de chaque colonne, et les colonnes reconnues sont bien profilées.
// node js/test_albert_column_context.js

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

// Contexte navigateur minimal : window = contexte global, comme dans le widget
const noopEl = () => null;
const ctx = {
  console: { ...console, warn() {}, info() {} }, setTimeout, clearTimeout, URLSearchParams,
  document: { getElementById: noopEl, querySelector: noopEl, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  fetch: () => Promise.reject(new Error('offline')),
};
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['config.js', 'knowledge.js', 'documents.js', 'planner.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
}
const synth = (table, q = '') => vm.runInContext('buildFullTableSynthesis', ctx)(table, q);

// Table « inconnue » : noms abrégés + une colonne au nom neutre
const rows = [];
const acad = ['Bordeaux', 'Bordeaux', 'Toulouse', 'Poitiers', 'Paris'];
const dep = ['Gironde', 'Landes', 'Dordogne', 'Gironde', 'Pyrénées-Atlantiques'];
const serie = ['Générale', 'Technologique', 'Professionnelle', 'Générale', 'STMG'];
for (let i = 0; i < 50; i++) {
  rows.push({
    LIB_ACA_ACC: acad[i % 5],
    DEP_SCO: dep[i % 5],
    'Champ 7': serie[i % 5],
    UAI_SCO: '0330021W',
    'Remarque': `note ${i}`,
  });
}
const table = { source: 'Grist', name: 'Table test', headers: Object.keys(rows[0]), objects: rows };

describe('Synthèse envoyée à Albert — table aux colonnes abrégées', () => {
  const out = synth(table);
  assert(/### Sens des colonnes/.test(out), 'section « Sens des colonnes » présente');
  assert(/LIB_ACA_ACC → académie d'accueil/.test(out), 'LIB_ACA_ACC décrite comme académie d\'accueil');
  assert(/DEP_SCO → département d'origine/.test(out), 'DEP_SCO décrite comme département d\'origine (scolarité)');
  assert(/Champ 7 → série \/ type de bac/.test(out), 'Champ 7 reconnue par son contenu comme série de bac');
  assert(!/UAI_SCO →/.test(out), 'UAI_SCO (technique) absente de la carte des colonnes');
  assert(!/Remarque →/.test(out), 'colonne libre non reconnue absente de la carte');
  const principales = (out.match(/Colonnes principales repérées : (.*)/) || [])[1] || '';
  const order = principales.split(' | ');
  assert(order.indexOf('LIB_ACA_ACC') !== -1 && order.indexOf('LIB_ACA_ACC') < order.indexOf('Remarque'),
    'colonne reconnue placée avant la colonne libre dans les colonnes principales');
  assert(order.indexOf('UAI_SCO') === -1 || order.indexOf('UAI_SCO') > order.indexOf('Champ 7'),
    'colonne technique reléguée après les colonnes reconnues');
});

describe('Widget complet (documents.js + planner.js chargés ensemble)', () => {
  const kind = ctx.window.plannerColumnKind;
  // Bug corrigé : normalizeText (documents.js) remplace la normalisation de
  // planner.js et perdait la ligature « œ » → « vœux » n'était pas reconnu.
  assert(kind('Nb total de vœux confirmés en phase principale') === 'nb_voeux',
    '« Nb total de vœux confirmés… » → nb_voeux dans le widget réel');
  assert(kind('Vœux confirmés') === 'voeu', '« Vœux confirmés » → voeu dans le widget réel');
  const n = vm.runInContext('normalizeText', ctx);
  assert(n('Vœux') === 'voeux', 'normalizeText("Vœux") → "voeux"');
  const out = synth({ source: 'Grist', name: 't', headers: ['Enseignement(s) de spécialité suivi(s)', 'Spécialité'], objects: [{ 'Enseignement(s) de spécialité suivi(s)': 'Maths', 'Spécialité': 'x' }] });
  assert(/Enseignement\(s\) de spécialité suivi\(s\) → enseignements de spécialité suivis au lycée/.test(out),
    'spécialités suivies au lycée ≠ formation du supérieur');
});

describe('Synthèse — table aux intitulés habituels (non-régression)', () => {
  const r = [
    { 'Zone du Pays Basque': 'Oui', "Académie de l'établissement d'accueil acceptée": 'Bordeaux', 'Boursier': 'Oui' },
    { 'Zone du Pays Basque': 'Non', "Académie de l'établissement d'accueil acceptée": 'Toulouse', 'Boursier': 'Non' },
  ];
  const out = synth({ source: 'Grist', name: 't', headers: Object.keys(r[0]), objects: r });
  assert(/Zone du Pays Basque → Zone Pays Basque/.test(out), 'Zone du Pays Basque reconnue');
  assert(/Boursier → statut boursier \[= bénéficiaire d'une bourse/.test(out), 'définition métier (alias) ajoutée pour Boursier');
  assert(/Focus automatique : Zone du Pays Basque = "Oui"/.test(out), 'focus Zone Pays Basque toujours calculé');
  assert(/Nombre total de lignes analysées : 2/.test(out), 'volumétrie inchangée');
});

console.log('\n' + '─'.repeat(50));
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
