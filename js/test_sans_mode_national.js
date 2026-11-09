// test_sans_mode_national.js — Retrait du bouton « National 2025 ».
// Le bouton ne faisait que changer le sous-titre (« Données nationales 2025 —
// académie Bordeaux ») : aucun calcul ni Albert ne lisait ce mode. Un agent
// pouvait croire interroger la France entière 2025 alors que le calcul portait
// sur la source active. La source se choisit désormais uniquement dans le
// sélecteur (open data de la session la plus récente au lancement).
// node js/test_sans_mode_national.js

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

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const knowledge = fs.readFileSync(path.join(__dirname, 'knowledge.js'), 'utf8');

// ─── Chargement des modules avec réseau et Grist simulés ────────────────────
const calls = [];
const tablesGrist = [];
function fakeFetch(url) {
  calls.push(String(url));
  return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}), text: () => Promise.resolve('') });
}
function makeCtx() {
  const noopEl = () => null;
  const ctx = {
    console: { ...console, warn() {}, info() {} },
    setTimeout: () => null, clearTimeout() {}, URLSearchParams,
    document: { getElementById: noopEl, querySelector: noopEl, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: fakeFetch,
    grist: { docApi: { fetchTable: (t) => { tablesGrist.push(t); return Promise.resolve({ id: [] }); } } },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  ctx.selectedDocIds = new Set();
  for (const f of ['config.js', 'knowledge.js', 'documents.js', 'planner.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
  }
  return ctx;
}

await describe('Interface : plus de bouton « National 2025 »', async () => {
  assert(!html.includes('btn-national-mode'), 'le bouton a disparu de l\'en-tête');
  assert(!html.includes('toggleNationalMode'), 'plus de fonction qui change le sous-titre');
  assert(!/National 2025|nationales 2025/.test(html), 'plus de libellé « 2025 » écrit en dur dans l\'interface');
  assert(html.includes('ouvrirPanneauRetours()'), 'faux positif : les autres boutons de l\'en-tête restent (« À revoir »)');
});

await describe('Démarrage : plus de chargement inutile', async () => {
  const ctx = makeCtx();
  await new Promise(r => setImmediate(r));
  assert(!tablesGrist.includes('Parcoursup_National'), 'la table Grist Parcoursup_National n\'est plus lue au démarrage');
  assert(!calls.some(u => /acad_mies/.test(decodeURIComponent(u)) && /Bordeaux/.test(decodeURIComponent(u))),
    'plus d\'export « académie de Bordeaux, session 2025 » demandé au ministère');
  assert(!/NATIONAL_SESSION\s*=\s*2025/.test(knowledge), 'plus de session 2025 écrite en dur dans knowledge.js');
  assert(typeof vm.runInContext('typeof setNationalMode', ctx) === 'string'
    && vm.runInContext('typeof setNationalMode', ctx) === 'undefined', 'le mode national (jamais lu) est supprimé');
  assert(vm.runInContext('typeof loadDefaultOpenDataTable', ctx) === 'function',
    'faux positif : le chargement de l\'open data par défaut est toujours là');
  assert(vm.runInContext('typeof PARCOURSUP_GOVAPI', ctx) === 'string', 'faux positif : l\'adresse de l\'API du ministère est conservée');
});

await describe('Lecteur CSV conservé (utilisé par l\'open data par défaut)', async () => {
  const ctx = makeCtx();
  const rows = vm.runInContext(`parseCSVSimple('a;b\\r\\n"x;1";"dit ""oui"""\\r\\n\\r\\n2;3', ';')`, ctx);
  assert(rows.length === 2, 'deux lignes lues, ligne vide ignorée');
  assert(rows[0].a === 'x;1', 'point-virgule entre guillemets conservé dans la cellule');
  assert(rows[0].b === 'dit "oui"', 'guillemets doublés lus comme un guillemet');
  assert(rows[1].a === '2' && rows[1].b === '3', 'ligne simple lue');
  assert(vm.runInContext(`parseCSVSimple('a;b', ';').length`, ctx) === 0, 'en-tête seul : aucune ligne');
});

await describe('Sous-titre mis à jour avant le chargement des sources', async () => {
  // Bug vu dans Chromium : « getActiveDataSource is not defined » au démarrage,
  // knowledge.js met à jour le sous-titre avant que documents.js soit chargé.
  const sub = { textContent: '' };
  const ctx = {
    console: { ...console, warn() {}, info() {} }, setTimeout: () => null, clearTimeout() {}, URLSearchParams,
    document: { getElementById: id => id === 'chat-sub' ? sub : null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: fakeFetch,
  };
  ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
  for (const f of ['config.js', 'knowledge.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
  let erreur = null;
  try { vm.runInContext('updateKnowledgeStatusBadge()', ctx); } catch (e) { erreur = e.message; }
  assert(erreur === null, 'pas d\'erreur quand le module des sources n\'est pas encore chargé');
  assert(sub.textContent === 'Aucun document chargé', 'sous-titre écrit quand même');
  vm.runInContext("getActiveDataSource = () => ({ source: 'Open data Parcoursup' })", ctx);
  vm.runInContext('updateKnowledgeStatusBadge()', ctx);
  assert(sub.textContent.startsWith('Open data Parcoursup actif'), 'faux positif : une fois chargé, la source active est affichée');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
