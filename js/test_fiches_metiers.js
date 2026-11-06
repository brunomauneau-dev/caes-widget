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
  // Adapté au moteur actuel (v27.8+) : une information absente arrête le calcul avec « Critère non reconnu »
  // (exec.kind === 'unresolved'), qui nomme le critère manquant et ne donne aucun chiffre.
  // (La branche d'origine attendait un type « missing » au message « Information absente » : même règle, autre libellé.)
  const cases = [
    ['cio', 'Combien de candidats boursiers ?', 'boursiers'],
    ['cio', 'Combien de candidats de la zone Pays Basque ?', 'Pays Basque'],
    ['etudes', 'Combien de boursiers ?', 'boursiers'],
    ['proviseur', 'Répartition par académie', 'académie'],
    ['formation', 'Combien de filles ?', 'filles / garçons'],
    ['formation', 'Combien de candidats apprentis ?', 'apprentis'],
  ];
  for (const [id, q, label] of cases) {
    const fiche = FICHES.find(f => f.id === id);
    const ctx = makeCtx();
    await importFiche(ctx, fiche);
    const { exec } = ask(ctx, q);
    const nomme = exec && ((exec.result?.missing || []).includes(label) || String(exec.text || '').includes(`« ${label} »`));
    assert(exec && exec.kind === 'unresolved' && nomme,
      `${fiche.metier} · « ${q} » → arrêt « critère non reconnu : ${label} »${exec && !(exec.kind === 'unresolved' && nomme) ? ` (obtenu : ${exec.kind} ${String(exec.text || JSON.stringify(exec.result)).slice(0, 80)})` : ''}`);
    if (exec && exec.kind === 'unresolved') {
      assert(/Critère non reconnu/.test(exec.html) && /pas de chiffre/.test(exec.html), '   … avec un message clair : aucun chiffre donné');
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
    assert(exec && exec.kind !== 'unresolved', `${fiche.metier} · « ${q} » → calculé normalement${exec?.kind === 'unresolved' ? ` (obtenu : arrêt ${exec.text})` : ''}`);
  }
});

// v27.13 — Statut de candidature en clair (Admis / Refusé / En liste d'attente) : chaque statut, et leur négation.
// Avant : « combien de refusés » → 150 (tout le fichier), « en liste d'attente » → export Excel, « non admis » → les admis.
await describe('Statut de candidature en clair : admis, refusés, liste d\'attente, non admis', async () => {
  const fiche = FICHES.find(f => f.id === 'formation');
  const ctx = makeCtx();
  await importFiche(ctx, fiche);
  const i = fiche.rows.findIndex(r => r.includes('Statut de la candidature'));
  const h = fiche.rows[i], k = h.indexOf('Statut de la candidature'), kb = h.indexOf('Boursier');
  const lignes = fiche.rows.slice(i + 1).filter(r => r.length > 1);
  const n = pred => lignes.filter(pred).length;
  const cas = [
    ['Combien de candidats admis ?', n(r => r[k] === 'Admis')],
    ['combien de candidats refusés', n(r => r[k] === 'Refusé')],
    ['combien de refusés', n(r => r[k] === 'Refusé')],
    ["combien de candidats en liste d'attente", n(r => r[k] === "En liste d'attente")],
    ["combien en liste d'attente ?", n(r => r[k] === "En liste d'attente")],
    ['combien de candidats non admis', n(r => r[k] !== 'Admis')],
    ['combien de candidats qui ne sont pas admis', n(r => r[k] !== 'Admis')],
    ['combien de refusés boursiers', n(r => r[k] === 'Refusé' && /^(oui|o)$/i.test(String(r[kb])))],
  ];
  for (const [q, attendu] of cas) {
    const { exec } = ask(ctx, q);
    assert(exec && exec.kind === 'count' && exec.result.count === attendu, `« ${q} » → ${attendu} (obtenu : ${exec?.kind} ${exec?.result?.count ?? exec?.text ?? ''})`);
  }
  assert(n(r => r[k] === 'Refusé') + n(r => r[k] === "En liste d'attente") === n(r => r[k] !== 'Admis'), 'cohérence des données de test : refusés + liste d\'attente = non admis');
  // Faux positifs : le statut n'est pas inventé là où il n'existe pas
  const cio = makeCtx();
  await importFiche(cio, FICHES.find(f => f.id === 'cio'));
  const r = ask(cio, 'combien de candidats refusés').exec;
  assert(r && r.kind === 'unresolved' && /statut de candidature/.test(r.text), `fichier sans statut : « refusés » → arrêt, pas tout le fichier (obtenu : ${r?.kind} ${r?.result?.count ?? ''})`);
  const l = ask(cio, "combien de candidats en liste d'attente").exec;
  assert(l && l.kind === 'unresolved', `« liste d'attente » sans statut : arrêt, pas un export Excel (obtenu : ${l?.kind})`);
  assert(run(ctx, 'inferMeasureIntent')('exporte la liste des admis') === 'export_excel', 'faux positif : « exporte la liste des admis » reste un export (seul « liste d\'attente » est un statut)');
  const rep = ask(ctx, 'répartition par statut de la candidature').exec;
  assert(rep && rep.kind === 'group_by' && rep.plan.targetCol === 'Statut de la candidature' && rep.result.rows.length === 3, `répartition par statut : 3 valeurs (obtenu : ${rep?.plan?.targetCol} ${rep?.result?.rows?.length})`);
});

console.log('\n' + '─'.repeat(50));
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
