// pr31.test.js — Tests PR 3.1 (métadonnées export pivot Excel/CSV)
// node js/pr31.test.js
// Lit buildExportMeta() directement depuis dataEngine.js (vrai code, pas un stub).

import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Framework minimal (identique aux autres suites du projet) ─────────────
let passed = 0, failed = 0;
function assert(condition, label) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}`); failed++; }
}
function assertEqual(actual, expected, label) {
  assert(actual === expected, `${label} (attendu: ${JSON.stringify(expected)}, obtenu: ${JSON.stringify(actual)})`);
}
function describe(label, fn) { console.log(`\n${label}`); fn(); }

// ─── Extraction de buildExportMeta depuis le fichier source réel ───────────
const dataEngineContent = fs.readFileSync(path.join(__dirname, 'dataEngine.js'), 'utf8');
const match = dataEngineContent.match(/function buildExportMeta\([\s\S]*?\n}\n/);
assert(!!match, 'buildExportMeta trouvée dans dataEngine.js (sinon : régression de refacto PR3.1)');
if (!match) {
  console.log('\n──────────────────────────────────────────────────');
  console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
  process.exit(1);
}
const buildExportMeta = new Function(`${match[0]}\nreturn buildExportMeta;`)();

// ─── PR 3.1 — présence et contenu de la ligne de métadonnées ───────────────
describe('buildExportMeta — structure générale', () => {
  const meta = buildExportMeta([{ a: 1 }, { a: 2 }], { filters: [], perimetre: null });
  assertEqual(meta.length, 4, 'metaRow contient 4 entrées (date, filtres, périmètre, lignes)');
  assert(meta[0].startsWith('Exporté le : '), 'entrée 0 = date export');
  assert(meta[1].startsWith('Filtres : '), 'entrée 1 = filtres');
  assert(meta[2].startsWith('Périmètre : '), 'entrée 2 = périmètre');
  assert(meta[3].startsWith('Lignes : '), 'entrée 3 = nombre de lignes');
});

describe('buildExportMeta — date présente et plausible', () => {
  const meta = buildExportMeta([{ a: 1 }], {});
  const year = new Date().getFullYear();
  assert(meta[0].includes(String(year)), `date contient l'année courante (${year})`);
});

describe('buildExportMeta — sans filtre', () => {
  const meta = buildExportMeta([{ a: 1 }], { filters: [] });
  assert(meta[1].includes('Aucun filtre'), '"Aucun filtre" affiché quand filters est vide');
});

describe('buildExportMeta — un seul filtre (op "=")', () => {
  const meta = buildExportMeta([{ a: 1 }], { filters: [{ col: 'Boursier', op: 'eq', value: 'Oui' }] });
  assert(meta[1].includes('Boursier = "Oui"'), 'filtre eq affiché avec signe =');
});

describe('buildExportMeta — un seul filtre (op "neq")', () => {
  const meta = buildExportMeta([{ a: 1 }], { filters: [{ col: 'Académie', op: 'neq', value: 'Bordeaux' }] });
  assert(meta[1].includes('Académie ≠ "Bordeaux"'), 'filtre neq affiché avec signe ≠');
});

describe('buildExportMeta — plusieurs filtres combinés', () => {
  const meta = buildExportMeta([{ a: 1 }], {
    filters: [
      { col: 'Boursier', op: 'eq', value: 'Oui' },
      { col: 'Académie', op: 'neq', value: 'Bordeaux' }
    ]
  });
  assert(meta[1].includes('Boursier = "Oui"') && meta[1].includes('Académie ≠ "Bordeaux"'), 'les deux filtres apparaissent');
  assert(meta[1].includes(' ; '), 'filtres séparés par " ; "');
});

describe('buildExportMeta — périmètre explicite vs fallback', () => {
  const withPerimetre = buildExportMeta([{ a: 1 }], { perimetre: 'Boursier = "Oui"' });
  assert(withPerimetre[2].includes('Boursier = "Oui"'), 'périmètre explicite repris tel quel');

  const withoutPerimetre = buildExportMeta([{ a: 1 }], {});
  assert(withoutPerimetre[2].includes('Ensemble'), 'fallback "Ensemble" si pas de périmètre fourni');
});

describe('buildExportMeta — comptage des lignes', () => {
  const rows = Array.from({ length: 1234 }, (_, i) => ({ id: i }));
  const meta = buildExportMeta(rows, {});
  assert(meta[3].includes('234') && meta[3].includes('1'), 'nombre de lignes présent (formaté fr-FR)');
});

describe('buildExportMeta — rows vide ou absent ne plante pas', () => {
  let threw = false;
  let meta;
  try { meta = buildExportMeta([], {}); } catch (e) { threw = true; }
  assert(!threw, 'rows=[] ne lève pas d\'exception');
  if (meta) assert(meta[3].includes('0'), 'rows=[] → "Lignes : 0"');

  threw = false;
  try { buildExportMeta(undefined, {}); } catch (e) { threw = true; }
  assert(!threw, 'rows=undefined ne lève pas d\'exception (guard rows?.length)');
});

// ─── Rapport ──────────────────────────────────────────────────────────────
console.log('\n──────────────────────────────────────────────────');
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed > 0) process.exit(1);
