// test_t4.js — Tests T4 (compatibilité lastExecution / question courante)
// Recréé à partir du code réel de _isExecCompatibleWithQuestion dans albert.js
// (le fichier original de la session T4 n'a pas été inclus dans l'upload — voir audit du 30/06).
// node js/test_t4.js

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

// ─── Extraction de la vraie fonction depuis albert.js ──────────────────────
const albertContent = fs.readFileSync(path.join(__dirname, 'albert.js'), 'utf8');
const match = albertContent.match(/function _isExecCompatibleWithQuestion\([\s\S]*?\n}\n/);
if (!match) {
  console.error('✗ _isExecCompatibleWithQuestion introuvable dans albert.js — régression du patch T4');
  process.exit(1);
}
const _isExecCompatibleWithQuestion = new Function(`${match[0]}\nreturn _isExecCompatibleWithQuestion;`)();

// ─── Fixtures ────────────────────────────────────────────────────────────
const execBasques = { plan: { filters: [{ col: 'Zone du Pays Basque', op: 'eq', value: 'Oui', label: 'Pays Basque' }], compareGroups: [] } };
const execBoursiers = { plan: { filters: [], compareGroups: [{ label: 'Boursiers' }, { label: 'Non-boursiers' }] } };
const execApprentis = { plan: { filters: [{ col: 'Statut', op: 'eq', value: 'Apprenti', label: 'Apprentis' }], compareGroups: [] } };

// ─── Groupe 1 — Basques vs Boursiers ────────────────────────────────────
describe('Groupe 1 — Basques vs Boursiers (cœur T4)', () => {
  assert(_isExecCompatibleWithQuestion(execBasques, 'compare les boursiers et les non-boursiers') === false,
    'Basques + question boursiers → INCOMPATIBLE');
  assert(_isExecCompatibleWithQuestion(execBasques, 'répartition par académie des candidats du Pays Basque') === true,
    'Basques + question basques → COMPATIBLE');
  assert(_isExecCompatibleWithQuestion(execBasques, 'combien de candidats au total ?') === true,
    'Basques + question générique → COMPATIBLE');
});

// ─── Groupe 2 — Boursiers vs Basques ────────────────────────────────────
describe('Groupe 2 — Boursiers vs Basques', () => {
  assert(_isExecCompatibleWithQuestion(execBoursiers, 'et pour le Pays Basque ?') === false,
    'Boursiers + question basques → INCOMPATIBLE');
  assert(_isExecCompatibleWithQuestion(execBoursiers, 'compare les boursiers et les non-boursiers') === true,
    'Boursiers + question boursiers → COMPATIBLE');
});

// ─── Groupe 3 — Autres périmètres ───────────────────────────────────────
describe('Groupe 3 — Autres périmètres', () => {
  assert(_isExecCompatibleWithQuestion(execApprentis, 'compare les boursiers et les non-boursiers') === false,
    'Apprentis + question boursiers → INCOMPATIBLE');
  assert(_isExecCompatibleWithQuestion(execApprentis, 'répartition des apprentis par académie') === true,
    'Apprentis + question apprentis → COMPATIBLE');
  assert(_isExecCompatibleWithQuestion(execApprentis, 'combien de candidats au total ?') === true,
    'Apprentis + question générique → COMPATIBLE');
});

// ─── Groupe 4 — Cas limites ──────────────────────────────────────────────
describe('Groupe 4 — Cas limites', () => {
  assert(_isExecCompatibleWithQuestion(null, 'compare les boursiers') === false,
    'exec null → false (pas de crash)');
  assert(_isExecCompatibleWithQuestion({}, 'compare les boursiers') === false,
    'exec sans plan → false');
  assert(_isExecCompatibleWithQuestion({ plan: { filters: [], compareGroups: [] } }, 'compare les boursiers') === true,
    'exec plan vide → COMPATIBLE (pas de labels, on accepte)');
});

console.log(`\n══════════ RÉSULTAT T4 : ${passed + failed} tests · ✅ ${passed} PASS · ${failed > 0 ? '❌' : '✅'} ${failed} FAIL ══════════`);
if (failed === 0) console.log('🎉 T4 toujours valide — pas de régression sur _isExecCompatibleWithQuestion.');
if (failed > 0) process.exit(1);
