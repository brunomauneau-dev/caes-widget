// test_tables_grist.js — Tables Grist telles que Grist les donne au widget : cases à cocher (true / false), listes de
// choix (tableaux de valeurs), cellules vides, colonne Référence vers une autre table (numéro de ligne).
// Avant : « spécialité SES » ignoré (« ses ») ; « sans note », « sans apprentissage » ignorés ou inversés ; filtre sur la
// combinaison « SVT,SES » au lieu de « contient SVT » ; répartition par combinaison ; référence non suivie.
// Banc v27.5.107 (1 à 3 critères combinés, vérité recalculée) : 204 chiffres faux sur 1 200 avant, 0 sur 2 400 après.
// Données fictives. node js/test_tables_grist.js

import fs from 'fs';
import vm from 'vm';
import { fileURLToPath } from 'url';
import path from 'path';
import * as D from './fixtures/donnees_simulees.mjs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let passed = 0, failed = 0;
function assert(condition, label) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}`); failed++; }
}
async function describe(label, fn) {
  console.log(`\n${label}`);
  try { await fn(); } catch (e) { console.error(`  ✗ erreur : ${e.stack || e.message}`); failed++; }
}

// ─── Widget chargé comme dans le navigateur (modules ensemble) ───────────────
function makeCtx() {
  const noopEl = () => null;
  const ctx = {
    console: { ...console, log() {}, warn() {}, info() {} },
    setTimeout: () => null, clearTimeout() {}, URLSearchParams, TextDecoder, TextEncoder,
    document: { getElementById: noopEl, querySelector: noopEl, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => Promise.reject(new Error('hors ligne')),
    escapeHtml: s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  };
  ctx.XLSX = { utils: { json_to_sheet: () => ({}), book_new: () => ({}), book_append_sheet() {}, sheet_to_csv: () => '' }, writeFile() {} };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.selectedDocIds = new Set();
  vm.createContext(ctx);
  for (const f of ['config.js', 'knowledge.js', 'documents.js', 'planner.js', 'dataEngine.js', 'sessions.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
  }
  ctx.resetContextSilent = () => {};
  return ctx;
}
const run = (ctx, code) => vm.runInContext(code, ctx);
function ask(ctx, q) {
  run(ctx, 'window.__DATA_ENGINE_STATE = { lastPlan: null, lastExecution: null, history: [] }');
  ctx.__q = q;
  const plan = run(ctx, 'isDataEngineQuestion(__q)') ? run(ctx, 'detectDataEnginePlan(__q)') : null;
  return plan ? run(ctx, 'runDataEnginePlan')(plan, []) : null;
}

// ─── Table Grist fictive : une ligne par candidat ; « Etablissement » = numéro de ligne de la table Etablissements ──
let x = 5; const r = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648; const pick = a => a[Math.floor(r() * a.length)];
const ETABS = [['Lycée Montaigne', 'Bordeaux', 'Gironde'], ['Lycée Borda', 'Dax', 'Landes'], ['Lycée Barthou', 'Pau', 'Pyrénées-Atlantiques'], ['Lycée Eiffel', 'Bordeaux', 'Gironde']].map(([Nom, Ville, Departement], i) => ({ id: i + 1, Nom, Ville, Departement }));
const SPE = ['Maths', 'SES', 'Physique', 'SVT', 'HGGSP', 'NSI'];
const recs = Array.from({ length: 600 }, (_, i) => ({ id: i + 1, Nom_eleve: `E${i}`, Boursier: r() < 0.25,
  Specialites: (() => { const a = pick(SPE), b = pick(SPE.filter(s => s !== a)); return [a, b]; })(), Note: r() < 0.1 ? null : Math.round(r() * 200) / 10,
  Statut: pick(['Admis', 'En attente', 'Refusé']), Etablissement: 1 + Math.floor(r() * 4), Apprentissage: r() < 0.1 }));
function ctxGrist(liees = true) {
  const ctx = makeCtx(); ctx.__v = recs; ctx.__l = liees ? [{ nom: 'Etablissements', objets: ETABS }] : [];
  run(ctx, 'gristRecords = __v; gristTablesLiees = __l; setActiveSource("grist");');
  return ctx;
}
const c = ctxGrist();
const n = p => recs.filter(p).length, E = id => ETABS[id - 1];
const valeur = e => !e ? null : e.kind === 'unresolved' ? 'arrêt' : e.kind === 'count' ? e.result.count : e.kind;

await describe('Cases à cocher et cellules vides', () => {
  assert(valeur(ask(c, 'combien de candidats boursiers')) === n(o => o.Boursier), 'boursiers (case cochée)');
  assert(valeur(ask(c, 'combien de candidats non boursiers')) === n(o => !o.Boursier), 'non boursiers');
  // avant : 53 (les apprentis) — le « sans » était perdu
  assert(valeur(ask(c, 'combien de candidats sans apprentissage')) === n(o => !o.Apprentissage), 'sans apprentissage : case non cochée (avant : les apprentis)');
  // avant : 600 (toutes les lignes)
  assert(valeur(ask(c, 'combien de candidats sans note')) === n(o => o.Note === null), 'sans note : cellule vide (avant : toutes les lignes)');
  assert(valeur(ask(c, 'combien de candidats sans apprentissage sans note')) === n(o => !o.Apprentissage && o.Note === null), 'deux « sans » dans la même question');
  const m = ask(c, 'note moyenne');
  assert(m?.kind === 'stats' && Math.abs(m.result.avg - recs.filter(o => o.Note !== null).reduce((t, o) => t + o.Note, 0) / n(o => o.Note !== null)) < 1e-9, 'moyenne : cellules vides écartées');
});

await describe('Listes de choix (plusieurs valeurs dans une case)', () => {
  // avant : « ses » pris pour le possessif → 600
  assert(valeur(ask(c, 'combien de candidats ayant la spécialité SES')) === n(o => o.Specialites.includes('SES')), '« spécialité SES » (avant : toutes les lignes)');
  assert(valeur(ask(c, 'combien de candidats avec Maths en spécialité')) === n(o => o.Specialites.includes('Maths')), 'avec Maths en spécialité');
  // avant : filtre sur la combinaison exacte « SVT,SES »
  assert(valeur(ask(c, 'combien de candidats refusés ayant la spécialité SVT')) === n(o => o.Statut === 'Refusé' && o.Specialites.includes('SVT')), 'refusés + SVT : la liste contient SVT (avant : la combinaison « SVT,SES »)');
  const g = ask(c, 'répartition des candidats par spécialité');
  const att = Object.fromEntries(SPE.map(s => [s, n(o => o.Specialites.includes(s))]));
  assert(g && (g.result.rows || []).length === SPE.length && g.result.rows.every(x => att[x.value] === x.count), 'répartition par spécialité : chaque spécialité (avant : par combinaison « SES,NSI »)');
  c.__d = run(c, 'getActiveQueryTables()[0]');
  assert(run(c, '_distinctValues(__d, "Specialites")').every(v => SPE.includes(v)), 'valeurs distinctes : les spécialités, pas les combinaisons');
});

await describe('Colonne Référence vers une autre table', () => {
  // avant : arrêt (« Bordeaux » introuvable) — la table Etablissements n'était pas reliée (pas de colonne commune)
  assert(valeur(ask(c, 'combien de candidats de Bordeaux')) === n(o => E(o.Etablissement).Ville === 'Bordeaux'), 'ville de l’établissement, par la référence');
  assert(valeur(ask(c, 'combien de candidats des Landes')) === n(o => E(o.Etablissement).Departement === 'Landes'), 'département de l’établissement');
  assert(valeur(ask(c, 'combien de candidats du lycée Borda')) === n(o => E(o.Etablissement).Nom === 'Lycée Borda'), 'nom du lycée (le numéro est remplacé par le nom)');
  const t = run(c, 'getActiveQueryTables()[0]');
  assert(/Etablissements/.test(t.name) && t.objects[0].Etablissement === E(recs[0].Etablissement).Nom, 'table nommée « + Etablissements », numéro remplacé par le nom');
  assert(run(c, 'colonneVersTable(new Set(["Etablissement", "Note"]), "Etablissements")') === 'Etablissement', 'colonne nommée d’après la table');
  assert(run(c, 'colonneVersTable(new Set(["Note"]), "Etablissements")') === null, 'faux positif : aucune colonne de ce nom');
  // sans accès aux autres tables : arrêt, jamais toutes les lignes
  assert(valeur(ask(ctxGrist(false), 'combien de candidats de Bordeaux')) === 'arrêt', 'sans la table Etablissements : arrêt');
  const src = fs.readFileSync(path.join(__dirname, 'albert.js'), 'utf8');
  assert(/colonneVersTable\(champs, id\)/.test(src), 'albert.js charge aussi la table visée par une colonne Référence');
});

await describe('Faux positifs : open data inchangé', () => {
  const od = makeCtx(); od.__t = D.tableOpenData(D.openData(1500, 7));
  run(od, "defaultOpenDataTable = __t; defaultOpenDataState = 'ready';");
  const a = ask(od, 'combien de formations sans sélection'), b = ask(od, 'combien de formations non sélectives');
  assert(a && valeur(a) === valeur(b) && valeur(a) !== 'arrêt', '« sans sélection » = « non sélectives »');
});

console.log(`\n${'─'.repeat(50)}\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
