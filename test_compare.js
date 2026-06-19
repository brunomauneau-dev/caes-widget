'use strict';
// Test harness Node — charge le VRAI dataEngine.js (pas une copie), stubbe le
// minimum d'environnement navigateur, puis exécute des assertions sur le
// pipeline de comparaison enrichi (écarts en points, discriminants, résumé).

const fs = require('fs');
const path = require('path');

// ── Stubs environnement navigateur ──────────────────────────────────────
global.window = global;
global.document = {
  getElementById: () => null,
  createElement: () => ({ click() {}, remove() {}, set href(v) {}, set download(v) {} }),
  body: { appendChild() {} }
};
global.confirm = () => true;
global.URL = { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} };
global.Blob = function Blob() {};
global.XLSX = {
  utils: { json_to_sheet: () => ({}), sheet_to_csv: () => '', book_new: () => ({}), book_append_sheet: () => {} },
  writeFile: () => {}
};

function normalizeText(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
global.normalizeText = normalizeText;

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
}
global.escapeHtml = escapeHtml;

function applyLocalActionFilters(rows, filters) {
  return (rows || []).filter(r => (filters || []).every(f => {
    const v = String(r?.[f.col] ?? '').trim();
    const target = String(f.value ?? '').trim();
    return f.op === 'neq' ? v !== target : v === target;
  }));
}
global.applyLocalActionFilters = applyLocalActionFilters;

function topCountsForRows(rows, col, limit = 30) {
  const map = new Map();
  let filled = 0;
  (rows || []).forEach(r => {
    const raw = r?.[col];
    const v = raw === undefined || raw === null || String(raw).trim() === '' ? '' : String(raw).trim();
    if (!v) return;
    filled += 1;
    map.set(v, (map.get(v) || 0) + 1);
  });
  const top = [...map.entries()].map(([value, count]) => ({ value, count, pct: filled ? count / filled * 100 : 0 })).sort((a, b) => b.count - a.count).slice(0, limit);
  return { filled, distinct: map.size, top };
}
global.topCountsForRows = topCountsForRows;

function pctFr(n, total) {
  if (!total) return '—';
  return (n / total * 100).toFixed(1).replace('.', ',') + ' %';
}
global.pctFr = pctFr;

// ── Chargement du VRAI fichier (pas une réécriture) ─────────────────────
const code = fs.readFileSync(path.join(__dirname, 'dataEngine.js'), 'utf8');
(0, eval)(code); // eval global indirect : les `function` du fichier deviennent globales

// ── Jeu de données synthétique : 2000 lignes, 2 populations bien distinctes ──
function makeRows(n, boursier) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    let formation, academie, serie, voeux;
    if (boursier === 'Oui') {
      formation = i % 10 < 6 ? 'BUT' : (i % 10 < 8 ? 'BTS' : 'Licence');
      academie = i % 10 < 7 ? 'Bordeaux' : 'Toulouse';
      serie = i % 10 < 5 ? 'Générale' : 'Technologique';
      voeux = 8 + (i % 3);
    } else {
      formation = i % 10 < 3 ? 'BUT' : (i % 10 < 8 ? 'BTS' : 'Licence');
      academie = i % 10 < 4 ? 'Bordeaux' : 'Toulouse';
      serie = i % 10 < 7 ? 'Générale' : 'Technologique';
      voeux = 5 + (i % 3);
    }
    rows.push({
      'Boursier': boursier,
      'Grand groupe de formation accueil': formation,
      'Académie accueil acceptée': academie,
      'Série de la Classe': serie,
      'Nombre de voeux confirmés': voeux
    });
  }
  return rows;
}

const objects = [...makeRows(600, 'Oui'), ...makeRows(1400, 'Non')];
const table = { name: 'parcoursup_2026', source: 'Grist (test)', headers: Object.keys(objects[0]), objects };

let failures = 0;
function assert(cond, label) {
  if (cond) {
    console.log(`OK   - ${label}`);
  } else {
    failures++;
    console.log(`FAIL - ${label}`);
  }
}

// ── 1. compareCategoryRows : delta vs premier groupe + spread ───────────
const groupRows = [
  { label: 'Boursiers', count: 600, pct: 30, rows: objects.filter(r => r.Boursier === 'Oui') },
  { label: 'Non-boursiers', count: 1400, pct: 70, rows: objects.filter(r => r.Boursier === 'Non') }
];

const catRows = compareCategoryRows(groupRows, 'Grand groupe de formation accueil', 8);
assert(catRows.length > 0, 'compareCategoryRows renvoie des lignes');
const butRow = catRows.find(r => r.value === 'BUT');
assert(!!butRow, 'la modalité BUT est présente');
assert(butRow.groups[0].delta === 0, 'delta du groupe de référence = 0');
assert(typeof butRow.groups[1].delta === 'number' && Number.isFinite(butRow.groups[1].delta), 'delta du second groupe est un nombre fini');
// Boursiers ont 60% de BUT, non-boursiers 30% de BUT (par construction synthétique) → delta ≈ -30 (non-boursiers - boursiers)
assert(Math.abs(butRow.groups[1].delta - (30 - 60)) < 1, `delta BUT cohérent avec les données synthétiques (obtenu ${butRow.groups[1].delta.toFixed(2)})`);
assert(typeof butRow.spread === 'number' && butRow.spread > 0, 'spread calculé et positif pour BUT');

// ── 2. compareNumericStatsRows : delta moyenne/médiane ───────────────────
const statsRows = compareNumericStatsRows(groupRows, 'Nombre de voeux confirmés');
assert(statsRows.length === 2, 'compareNumericStatsRows renvoie un résultat par groupe');
assert(statsRows[0].deltaAvg === 0, 'delta de moyenne du groupe de référence = 0');
assert(Number.isFinite(statsRows[1].deltaAvg), 'delta de moyenne du second groupe est un nombre fini');
assert(statsRows[1].deltaAvg < 0, 'les non-boursiers ont une moyenne de vœux inférieure (delta négatif), cohérent avec les données synthétiques');

// ── 3. Discriminants : agrégation + tri par écart absolu ────────────────
const formationEntries = buildDiscriminantEntries('Grands groupes de formation', catRows);
const statsEntries = buildStatsDiscriminantEntries('Vœux confirmés', statsRows);
assert(formationEntries.length === catRows.length, 'autant d’entrées discriminantes que de modalités de formation');
assert(statsEntries.length === 1, 'une entrée discriminante pour les vœux (1 groupe non-référence)');
const top = topDiscriminants([formationEntries, statsEntries], 5);
assert(top.length > 0 && top.length <= 5, 'topDiscriminants renvoie entre 1 et 5 entrées');
assert(top.every((d, i) => i === 0 || d.metric <= top[i - 1].metric), 'topDiscriminants est trié par écart décroissant');

// ── 4. Résumé automatique : pas de NaN, mentionne les deux groupes ───────
const summaryHtml = buildCompareAutoSummary({ question: 'compare boursiers et non boursiers' }, groupRows, top);
assert(typeof summaryHtml === 'string' && summaryHtml.length > 0, 'buildCompareAutoSummary renvoie du HTML non vide');
assert(!/NaN|undefined|null/.test(summaryHtml), 'aucun NaN/undefined/null dans le résumé généré');
assert(/Boursiers/.test(summaryHtml) && /Non-boursiers/.test(summaryHtml), 'le résumé mentionne les deux groupes');

// ── 5. Edge case : groupe vide (0 ligne) ─────────────────────────────────
const emptyGroupRows = [
  { label: 'Groupe A', count: 0, pct: 0, rows: [] },
  { label: 'Groupe B', count: 1400, pct: 100, rows: objects.filter(r => r.Boursier === 'Non') }
];
const catRowsEmpty = compareCategoryRows(emptyGroupRows, 'Grand groupe de formation accueil', 8);
assert(Array.isArray(catRowsEmpty), 'compareCategoryRows ne plante pas avec un groupe vide');
const statsRowsEmpty = compareNumericStatsRows(emptyGroupRows, 'Nombre de voeux confirmés');
assert(statsRowsEmpty[0].avg === null, 'moyenne nulle (pas NaN) pour un groupe sans lignes');
assert(statsRowsEmpty[1].deltaAvg === null, 'delta nul (pas NaN/Infinity) quand la référence est vide');
const summaryEmpty = buildCompareAutoSummary({}, emptyGroupRows, []);
assert(!/NaN/.test(summaryEmpty), 'résumé sans NaN même avec un groupe vide');

// ── 6. renderCompareHtml de bout en bout : pas d'exception, contient les sections ──
const compareCols = getCompareColumns(table);
assert(!!compareCols.formation && !!compareCols.academie && !!compareCols.serie && !!compareCols.voeux, 'getCompareColumns retrouve les 4 colonnes attendues sur le jeu synthétique');

const plan = { tool: 'compare', table, filters: [], question: 'compare les boursiers et les non-boursiers' };
const fullGroups = compareGroupSummary(table, [
  { label: 'Boursiers', filters: [{ col: 'Boursier', op: 'eq', value: 'Oui' }] },
  { label: 'Non-boursiers', filters: [{ col: 'Boursier', op: 'eq', value: 'Non' }] }
], []);
let html = '';
try {
  html = renderCompareHtml(plan, { rows: fullGroups });
  assert(true, 'renderCompareHtml exécuté sans exception');
} catch (e) {
  failures++;
  console.log('FAIL - renderCompareHtml a levé une exception : ' + e.message);
}
assert(/Indicateurs les plus discriminants/.test(html), 'le HTML final contient la section indicateurs discriminants');
assert(/Sur.*lignes? compar/i.test(html) || /Sur <strong>/.test(html), 'le HTML final contient le résumé automatique');
assert(!/NaN/.test(html), 'le HTML final ne contient aucun NaN');

// ── 7. Non-régression : count_rows / group_by / pivot / stats toujours intacts ──
const countExec = runDataEnginePlan({ tool: 'count_rows', table, filters: [{ col: 'Boursier', op: 'eq', value: 'Oui' }] });
assert(countExec && countExec.result.count === 600, `count_rows toujours correct (obtenu ${countExec?.result?.count})`);

const groupExec = runDataEnginePlan({ tool: 'group_by', table, targetCol: 'Boursier', filters: [] });
assert(groupExec && groupExec.result.total === 2000, 'group_by toujours fonctionnel sur la table complète');

const pivotExec = runDataEnginePlan({ tool: 'pivot', table, targetCol: 'Boursier', targetCol2: 'Série de la Classe', filters: [] });
assert(pivotExec && pivotExec.result.total === 2000, 'pivot toujours fonctionnel');

const statsExec = runDataEnginePlan({ tool: 'stats', table, targetCol: 'Nombre de voeux confirmés', filters: [] });
assert(statsExec && statsExec.result.numericCount === 2000, 'stats toujours fonctionnel');

console.log(`\n${failures === 0 ? 'TOUS LES TESTS PASSENT' : failures + ' ÉCHEC(S)'}`);
process.exit(failures === 0 ? 0 : 1);
