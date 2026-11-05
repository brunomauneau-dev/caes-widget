// test_fiches_metiers.js — Reconnaissance des colonnes et justesse des
// réponses, sur des fichiers FICTIFS représentatifs de 5 métiers
// (tests/fixtures/fiches_metiers.mjs).
//
// Pour chaque fiche :
//   1. le fichier passe par le vrai chemin d'import (CSV réel, ou classeur
//      Excel simulé) et devient la source active ;
//   2. chaque colonne doit être comprise avec le bon sens ;
//   3. chaque question métier doit donner le bon chiffre — recalculé
//      directement sur les lignes, indépendamment du moteur ;
//   4. ce qu'Albert reçoit doit décrire correctement les colonnes ;
//   5. une question sur une information ABSENTE du fichier ne doit pas
//      produire de chiffre (régression : « 80 boursiers » sur un tableau
//      sans colonne boursier, affiché comme calcul exact).
// node js/test_fiches_metiers.js

import fs from 'fs';
import vm from 'vm';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { FICHES } = await import(pathToFileURL(path.join(__dirname, '..', 'tests', 'fixtures', 'fiches_metiers.mjs')).href);

let passed = 0, failed = 0;
function assert(condition, label) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}`); failed++; }
}
async function describe(label, fn) { console.log(`\n${label}`); await fn(); }

function makeCtx() {
  const noopEl = () => null;
  const ctx = {
    console: { ...console, warn() {}, info() {} },
    setTimeout: () => null, clearTimeout() {}, URLSearchParams, TextDecoder,
    document: { getElementById: noopEl, querySelector: noopEl, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => Promise.reject(new Error('offline')),
    escapeHtml: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c])),
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.selectedDocIds = new Set();
  vm.createContext(ctx);
  for (const f of ['config.js', 'knowledge.js', 'documents.js', 'planner.js', 'dataEngine.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
  }
  return ctx;
}
const run = (ctx, code) => vm.runInContext(code, ctx);

// CSV « à la française » : séparateur ; et virgule décimale
const toCsv = rows => rows.map(r => r.map(v => {
  const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? '');
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}).join(';')).join('\n');

async function importFiche(ctx, fiche) {
  const imp = run(ctx, 'importSpreadsheetFile');
  if (/\.csv$/.test(fiche.fichier)) {
    const buf = new TextEncoder().encode(toCsv(fiche.rows));
    return imp({ name: fiche.fichier, size: buf.length, arrayBuffer: async () => buf.buffer });
  }
  // Classeur Excel : SheetJS simulé, qui renvoie les lignes telles qu'Excel les lit
  ctx.XLSX = {
    read: () => ({ SheetNames: [fiche.onglet], Sheets: { [fiche.onglet]: 'ws' } }),
    utils: { sheet_to_json: () => fiche.rows.map(r => r.slice()) },
  };
  return imp({ name: fiche.fichier, size: 1000, arrayBuffer: async () => new ArrayBuffer(8) });
}

function ask(ctx, question) {
  run(ctx, 'resetContextSilent()');
  const plan = run(ctx, `detectDataEnginePlan(${JSON.stringify(question)})`);
  const exec = plan ? run(ctx, 'runDataEnginePlan')(plan) : null;
  return { plan, exec };
}
const sameDistribution = (rows, expected) => {
  const got = Object.fromEntries(rows.map(r => [String(r.value), r.count]));
  const keys = new Set([...Object.keys(got), ...Object.keys(expected)]);
  return [...keys].every(k => got[k] === expected[k]);
};

for (const fiche of FICHES) {
  await describe(`Fiche « ${fiche.metier} » — ${fiche.fichier}`, async () => {
    const ctx = makeCtx();
    const table = await importFiche(ctx, fiche);
    const headerIdx = fiche.rows.findIndex(r => Object.keys(fiche.expected).every(h => r.includes(h)));
    const dataRows = fiche.rows.slice(headerIdx + 1).filter(r => r.some(c => c !== '' && c != null)).length;
    assert(run(ctx, 'getActiveSourceKind()') === 'file', 'fichier importé = source active');
    assert(Object.keys(fiche.expected).every(h => table.headers.includes(h)), 'ligne d\'en-têtes retrouvée (sous les éventuelles lignes de titre)');
    assert(table.objects.length === dataRows, `${dataRows} lignes de données lues`);

    // 2. Reconnaissance des colonnes
    for (const [header, kind] of Object.entries(fiche.expected)) {
      const got = run(ctx, `window.plannerColumnKind(${JSON.stringify(header)})`);
      assert(got === kind, `colonne « ${header} » → ${kind}${got === kind ? '' : ` (obtenu : ${got})`}`);
    }

    // 3. Justesse des réponses
    for (const { q, check } of fiche.questions) {
      const expected = check(table);
      const { plan, exec } = ask(ctx, q);
      if (!exec) { assert(false, `« ${q} » → aucune réponse calculée`); continue; }
      if (expected.tool === 'count_rows') {
        assert(exec.kind === 'count' && exec.result.count === expected.value,
          `« ${q} » → ${expected.value}${exec.result?.count === expected.value ? '' : ` (obtenu : ${exec.kind} ${JSON.stringify(exec.result?.count ?? exec.result)})`}`);
      } else if (expected.tool === 'group_by') {
        const okCol = exec.plan.targetCol === expected.col;
        const okDist = okCol && sameDistribution(exec.result.rows, expected.value);
        assert(okCol && okDist, `« ${q} » → répartition exacte par « ${expected.col} »${okCol ? '' : ` (colonne obtenue : ${exec.plan.targetCol})`}`);
      } else if (expected.tool === 'compare') {
        const counts = (exec.result.rows || []).map(r => r.count).sort((a, b) => a - b);
        const want = Object.values(expected.value).sort((a, b) => a - b);
        assert(exec.kind === 'compare' && JSON.stringify(counts) === JSON.stringify(want),
          `« ${q} » → groupes de ${want.join(' et ')}${exec.kind === 'compare' ? '' : ` (obtenu : ${exec.kind})`}`);
      }
      // Le résultat transmis à Albert reprend le même chiffre
      if (expected.tool === 'count_rows' && exec.kind === 'count') {
        const ctxText = run(ctx, 'dataEngineResultToContext')(exec);
        assert(ctxText.includes(`Résultat : ${expected.value} ligne(s)`), `   … et Albert reçoit le même chiffre (${expected.value})`);
      }
    }

    // 4. Ce qu'Albert reçoit : sens des colonnes reconnues
    const synth = run(ctx, 'buildFullTableSynthesis')(table, '');
    const recognized = Object.entries(fiche.expected).filter(([, k]) => k !== 'generic');
    const described = recognized.filter(([h]) => synth.includes(`- ${h} → `));
    assert(described.length === recognized.length,
      `Albert reçoit le sens des ${recognized.length} colonnes reconnues${described.length === recognized.length ? '' : ` (manquantes : ${recognized.filter(([h]) => !described.some(([d]) => d === h)).map(([h]) => h).join(', ')})`}`);
    const generic = Object.entries(fiche.expected).filter(([, k]) => k === 'generic').map(([h]) => h);
    assert(generic.every(h => !synth.includes(`- ${h} → `) || synth.includes(`- ${h} → variable [`)),
      'aucun sens inventé pour les colonnes sans signification Parcoursup (nom, identifiant, note…)');
  });
}

await describe('Informations absentes : pas de chiffre inventé', async () => {
  const cases = [
    ['cio', 'Combien de candidats boursiers ?', 'statut boursier'],
    ['cio', 'Combien de candidats de la zone Pays Basque ?', 'zone Pays Basque'],
    ['etudes', 'Combien de boursiers ?', 'statut boursier'],
    ['proviseur', 'Répartition par académie', 'académie'],
    ['formation', 'Combien de filles ?', 'sexe / genre'],
    ['formation', 'Combien de candidats apprentis ?', 'apprentissage'],
  ];
  for (const [id, q, label] of cases) {
    const fiche = FICHES.find(f => f.id === id);
    const ctx = makeCtx();
    await importFiche(ctx, fiche);
    const { exec } = ask(ctx, q);
    assert(exec && exec.kind === 'missing' && exec.result.missing.includes(label),
      `${fiche.metier} · « ${q} » → « information absente : ${label} »${exec && exec.kind !== 'missing' ? ` (obtenu : ${exec.kind} ${JSON.stringify(exec.result).slice(0, 60)})` : ''}`);
    if (exec && exec.kind === 'missing') {
      assert(/Information absente/.test(exec.html) && /sélecteur/.test(exec.html), '   … avec un message clair et la marche à suivre');
      assert(run(ctx, 'shouldAnswerLocallyWithoutAlbert')(exec) === true, '   … affiché directement (Albert ne doit pas improviser un chiffre)');
    }
  }
});

await describe('Pas de faux « absent » quand l\'information existe', async () => {
  const cases = [
    ['saio', 'Combien de candidats boursiers ?'],
    ['proviseur', "Combien d'élèves boursiers ?"],
    ['cio', 'Combien de filles ?'],
    ['formation', 'Combien de candidats admis ?'],
    ['etudes', 'Répartition par département'],
  ];
  for (const [id, q] of cases) {
    const fiche = FICHES.find(f => f.id === id);
    const ctx = makeCtx();
    await importFiche(ctx, fiche);
    const { exec } = ask(ctx, q);
    assert(exec && exec.kind !== 'missing', `${fiche.metier} · « ${q} » → calculé normalement`);
  }
});

console.log('\n' + '─'.repeat(50));
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
