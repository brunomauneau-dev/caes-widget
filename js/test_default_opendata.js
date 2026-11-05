// test_default_opendata.js — Table par défaut : open data Parcoursup.
// Sans table Grist ni fichier, le widget analyse l'open data Parcoursup
// (France entière) de la session la plus récente publiée. L'API est simulée.
// node js/test_default_opendata.js

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

// ─── API open data simulée ────────────────────────────────────────────────
const SCHEMA = {
  dataset_id: 'fr-esr-parcoursup',
  fields: [
    { name: 'session', label: 'Session', type: 'date' },
    { name: 'g_ea_lib_vx', label: 'Établissement', type: 'text' },
    { name: 'acad_mies', label: 'Académie de l’établissement', type: 'text' },
    { name: 'dep_lib', label: 'Département de l’établissement', type: 'text' },
    { name: 'fili', label: 'Filière de formation', type: 'text' },
    { name: 'capa_fin', label: 'Capacité de l’établissement par formation', type: 'int' },
    { name: 'voe_tot', label: 'Effectif total des candidats pour une formation', type: 'int' },
    { name: 'acc_tot', label: 'Effectif total des candidats ayant accepté la proposition de l’établissement (admis)', type: 'int' },
    { name: 'pct_bours', label: '% d’admis néo bacheliers boursiers', type: 'double' },
    { name: 'champ_hors_liste', label: 'Champ non demandé', type: 'text' },
  ]
};
const CSV = [
  'session;g_ea_lib_vx;acad_mies;dep_lib;fili;capa_fin;voe_tot;acc_tot;pct_bours',
  '2026;Lycée Montaigne;Bordeaux;Gironde;BTS;30;412;29;21.5',
  '2026;Université de Bordeaux;Bordeaux;Gironde;Licence;300;5120;310;18',
  '2026;IUT de Toulouse;Toulouse;Haute-Garonne;BUT;84;2045;80;24.1',
].join('\n');

let calls = [];
let mode = 'ok';
function fakeFetch(url) {
  calls.push(String(url));
  const u = String(url);
  const json = body => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
  const fail = status => Promise.resolve({ ok: false, status, json: () => Promise.resolve({}), text: () => Promise.resolve('') });
  if (!u.includes('fr-esr-parcoursup')) return fail(404); // KB, référentiel…
  if (u.includes('/facets')) {
    if (mode === 'no-facets') return fail(500);
    return json({ facets: [{ name: 'session', facets: [{ name: '2024', value: '2024' }, { name: '2026', value: '2026' }, { name: '2025', value: '2025' }] }] });
  }
  if (u.includes('/exports/csv')) {
    if (mode === 'export-error') return fail(503);
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(CSV) });
  }
  if (/fr-esr-parcoursup$/.test(u)) return json(SCHEMA);
  return fail(404);
}

function makeCtx() {
  const noopEl = () => null;
  const ctx = {
    console: { ...console, warn() {}, info() {} },
    setTimeout: () => null, clearTimeout() {}, URLSearchParams,
    document: { getElementById: noopEl, querySelector: noopEl, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: fakeFetch,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  ctx.selectedDocIds = new Set(); // défini dans albert.js (non chargé ici)
  for (const f of ['config.js', 'knowledge.js', 'documents.js', 'planner.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
  }
  return ctx;
}
const run = (ctx, code) => vm.runInContext(code, ctx);

await describe('Chargement de la table par défaut', async () => {
  calls = []; mode = 'ok';
  const ctx = makeCtx();
  const t = await run(ctx, 'loadDefaultOpenDataTable()');
  assert(!!t, 'table chargée');
  assert(t.session === 2026, 'session la plus récente publiée détectée automatiquement (2026 parmi 2024/2025/2026)');
  // (l'ancien chargeur « national Bordeaux » appelle aussi l'export : on cible le nôtre)
  const exportUrl = calls.find(u => u.includes('/exports/csv') && u.includes('refine=')) || '';
  assert(/refine=session%3A2026/.test(exportUrl), 'export filtré sur cette session');
  assert(!/acad_mies%3D|where=/.test(exportUrl), 'pas de filtre académie : France entière');
  assert(!/champ_hors_liste/.test(exportUrl), 'seuls les champs utiles sont demandés');
  assert(/capa_fin/.test(exportUrl) && !/form_lib_voe_acc/.test(exportUrl),
    'les champs absents du jeu de données ne sont pas demandés (pas d\'erreur API si un champ disparaît)');
  assert(t.objects.length === 3, '3 formations chargées');
  assert(t.headers.includes("Académie de l'établissement"), 'en-têtes = libellés officiels lisibles');
  assert(t.objects[0]["Capacité de l'établissement par formation"] === 30, 'colonnes chiffrées converties en nombres');
  assert(t.objects[2]["% d'admis néo bacheliers boursiers"] === 24.1, 'décimales conservées');
  assert(t.rowUnit === 'formation', 'unité de ligne = formation');
  assert(/France entière/.test(t.name) && /2026/.test(t.name), 'nom explicite (session + France entière)');

  const active = run(ctx, 'getActiveQueryTables()');
  assert(active.length === 1 && active[0].isDefault, 'sans Grist ni fichier : la table active est l\'open data');
  assert(run(ctx, "window.plannerColumnKind(\"Académie de l'établissement\")") === 'academie', 'colonnes reconnues par le moteur');

  const synth = run(ctx, 'buildFullTableSynthesis(getDefaultOpenDataTable(), "")');
  assert(/UNE LIGNE = UNE FORMATION/.test(synth), 'Albert est prévenu : une ligne = une formation, pas un candidat');
  assert(/session 2026/.test(synth), 'Albert connaît la session');

  // Nouvelle règle : l'open data reste la source tant qu'on n'en choisit pas une autre
  run(ctx, 'gristRecords = [{ id: 1, Nom: "a" }, { id: 2, Nom: "b" }]');
  const withGrist = run(ctx, 'getActiveQueryTables()');
  assert(withGrist.length === 1 && withGrist[0].isDefault, 'table Grist liée mais non choisie → l\'open data reste la source active');
  run(ctx, 'setActiveSource("grist")');
  const chosen = run(ctx, 'getActiveQueryTables()');
  assert(chosen.length === 1 && chosen[0].source === 'Grist', 'table Grist choisie dans le sélecteur → source active');
  run(ctx, 'setActiveSource("opendata"); gristRecords = []');
});

await describe('Repli et erreurs', async () => {
  calls = []; mode = 'no-facets';
  let ctx = makeCtx();
  let t = await run(ctx, 'loadDefaultOpenDataTable()');
  assert(t && t.session === 2025, 'liste des sessions indisponible → repli sur 2025');

  calls = []; mode = 'export-error';
  ctx = makeCtx();
  t = await run(ctx, 'loadDefaultOpenDataTable()');
  assert(t === null, 'API indisponible → pas de table, sans planter');
  assert(run(ctx, 'defaultOpenDataState') === 'error', 'état « erreur » mémorisé (affiché dans le panneau Sources)');
  assert(run(ctx, 'getActiveQueryTables()').length === 0, 'aucune table active fantôme');
});

await describe('Démarrage automatique', async () => {
  calls = []; mode = 'ok';
  const ctx = makeCtx();
  run(ctx, 'gristRecords = [{ id: 1, Nom: "a" }]');
  run(ctx, 'maybeLoadDefaultOpenData()');
  await new Promise(r => setTimeout(r, 20));
  assert(calls.some(u => u.includes('/exports/csv') && u.includes('refine=')), 'open data téléchargé au lancement, même si une table Grist est liée');
  assert(run(ctx, 'getActiveSourceKind()') === 'opendata', 'source active au lancement : open data');
});

console.log('\n' + '─'.repeat(50));
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
