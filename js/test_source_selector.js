// test_source_selector.js — Sélecteur de source et import Excel/CSV.
// Règles : open data au lancement ; table Grist et fichier sur choix
// explicite ; un fichier importé devient la source active ; le retirer
// ramène à l'open data. Le contexte d'analyse est remis à zéro à chaque
// changement de source.
// node js/test_source_selector.js

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
async function describe(label, fn) { console.log(`\n${label}`); await fn(); }

function makeCtx() {
  const noopEl = () => null;
  const ctx = {
    console: { ...console, warn() {}, info() {} },
    setTimeout: () => null, clearTimeout() {}, URLSearchParams, TextDecoder,
    document: { getElementById: noopEl, querySelector: noopEl, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => Promise.reject(new Error('offline')),
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.selectedDocIds = new Set();
  vm.createContext(ctx);
  for (const f of ['config.js', 'knowledge.js', 'documents.js', 'planner.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
  }
  // Open data simulé (déjà chargé)
  vm.runInContext(`defaultOpenDataTable = { source: 'Open data', name: 'Parcoursup 2025 — France entière (open data)', session: 2025, rowUnit: 'formation', isDefault: true,
    headers: ['Session', "Académie de l'établissement"], objects: [{ Session: 2025, "Académie de l'établissement": 'Bordeaux' }] };
    defaultOpenDataState = 'ready';`, ctx);
  // Compteur de remises à zéro du contexte
  ctx.resets = 0;
  ctx.resetContextSilent = () => { ctx.resets++; };
  return ctx;
}
const run = (ctx, code) => vm.runInContext(code, ctx);
const fakeFile = (name, content, size) => {
  const buf = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  return { name, size: size ?? buf.length, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};

await describe('Source au lancement et choix explicite', async () => {
  const ctx = makeCtx();
  run(ctx, 'gristRecords = [{ id: 1, Nom: "Dupont" }, { id: 2, Nom: "Martin" }]');
  assert(run(ctx, 'getActiveSourceKind()') === 'opendata', 'au lancement : open data, même si une table Grist est liée');
  assert(run(ctx, 'getActiveQueryTables()[0].isDefault') === true, 'la table active est bien l\'open data');
  run(ctx, 'setActiveSource("grist")');
  assert(run(ctx, 'getActiveQueryTables()[0].source') === 'Grist', 'Grist choisi → table Grist active');
  assert(ctx.resets === 1, 'changement de source → contexte d\'analyse remis à zéro');
  run(ctx, 'setActiveSource("grist")');
  assert(ctx.resets === 1, 'même source re-choisie → pas de remise à zéro inutile');
  run(ctx, 'gristRecords = []');
  assert(run(ctx, 'getActiveSourceKind()') === 'opendata', 'Grist choisi mais table vide → repli sur l\'open data');
});

await describe('Import CSV', async () => {
  const ctx = makeCtx();
  // Export avec ligne de titre, séparateur « ; », encodage Windows-1252, nombres à la française
  const csv = 'Extraction BO du 02/11/2026;;\n\nNom;Département;Code postal;Moyenne\nDupont;Gironde;03100;12,5\nMartin;Landes;40000;14\nBernard;Gironde;33000;1 234,5\n';
  const win1252 = Uint8Array.from(Buffer.from(csv.replace('é', 'é'), 'latin1'));
  const t = await run(ctx, 'importSpreadsheetFile')(fakeFile('extraction.csv', win1252));
  assert(run(ctx, 'getActiveSourceKind()') === 'file', 'fichier importé → source active');
  assert(t.headers.join('|') === 'Nom|Département|Code postal|Moyenne', 'ligne d\'en-têtes trouvée sous le titre, accents décodés (Windows-1252)');
  assert(t.objects.length === 3, '3 lignes de données');
  assert(t.objects[0].Moyenne === 12.5 && t.objects[2].Moyenne === 1234.5, 'nombres français convertis (12,5 · 1 234,5)');
  assert(t.objects[0]['Code postal'] === '03100', 'zéro initial des codes conservé');
  assert(run(ctx, "window.plannerColumnKind('Département')") === 'departement', 'colonnes reconnues par le moteur');
  assert(run(ctx, 'getActiveQueryTables()[0].name') === 'extraction.csv', 'la table active est le fichier');

  run(ctx, 'clearImportedFile()');
  assert(run(ctx, 'getActiveSourceKind()') === 'opendata', 'fichier retiré → retour à l\'open data');
});

await describe('Import Excel (classeur simulé, plusieurs onglets)', async () => {
  const ctx = makeCtx();
  ctx.XLSX = {
    read: () => ({ SheetNames: ['Notice', 'Données', 'Bilan'], Sheets: { Notice: 'n', Données: 'd', Bilan: 'b' } }),
    utils: { sheet_to_json: ws => ({
      n: [],
      d: [['Rapport académique'], [], ['Nom', 'Série', 'Date'], ['Dupont', 'Générale', new Date(2026, 5, 30)], ['Martin', 'STMG', new Date(2026, 6, 1)]],
      b: [['Série', 'Total'], ['Générale', 1], ['STMG', 1]],
    })[ws] }
  };
  const t = await run(ctx, 'importSpreadsheetFile')(fakeFile('suivi.xlsx', 'x'));
  assert(t.sheetName === 'Données', 'onglet vide ignoré : premier onglet avec des données retenu');
  assert(t.headers.join('|') === 'Nom|Série|Date', 'en-têtes trouvés sous le titre');
  assert(t.objects[0].Date === '2026-06-30', 'dates converties en texte AAAA-MM-JJ');
  run(ctx, 'selectImportedSheet("Bilan")');
  assert(run(ctx, 'getActiveQueryTables()[0].sheetName') === 'Bilan', 'changement d\'onglet → nouvelle table active');
  let err = '';
  try { run(ctx, 'selectImportedSheet("Notice")'); } catch (e) { err = e.message; }
  assert(/ne contient pas de données/.test(err), 'onglet vide choisi → message clair');
});

await describe('Fichiers refusés', async () => {
  const ctx = makeCtx();
  const imp = run(ctx, 'importSpreadsheetFile');
  let err = '';
  try { await imp(fakeFile('rapport.pdf', 'x')); } catch (e) { err = e.message; }
  assert(/Format non pris en charge/.test(err), 'PDF refusé avec explication');
  err = '';
  try { await imp(fakeFile('gros.csv', 'a;b\n1;2', 60 * 1024 * 1024)); } catch (e) { err = e.message; }
  assert(/trop volumineux/.test(err) && /Grist/.test(err), 'fichier > 50 Mo → conseil d\'import dans Grist');
  err = '';
  try { await imp(fakeFile('vide.csv', '\n\n')); } catch (e) { err = e.message; }
  assert(/Aucune donnée/.test(err), 'fichier vide → message clair');
  assert(run(ctx, 'getActiveSourceKind()') === 'opendata', 'après un échec : la source ne change pas');
});

console.log('\n' + '─'.repeat(50));
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
