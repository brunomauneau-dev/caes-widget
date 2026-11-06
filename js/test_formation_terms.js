// test_formation_terms.js — Intitulés de formation cités dans la question.
// Reproduit le test réel du 05/11/2026 sur l'open data Parcoursup :
//  1. « donne moi la liste complète des filières de PASS » → un export Excel au lieu de la liste des options ;
//  2. « donne moi toutes les filières de PASS avec toutes les options » → partait vers Albert sans données ;
//  3. « combien de PASS option Droit » → 14 252 (tout le fichier, aucun filtre).
// Règles : un intitulé de formation présent dans les données (PASS, Droit…) devient un filtre, même sans
// le mot « filière » ; « liste des filières/options » affiche les valeurs distinctes ; une option introuvable
// arrête le calcul au lieu de compter tout le fichier.
// node js/test_formation_terms.js

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
function describe(label, fn) {
  console.log(`\n${label}`);
  try { fn(); } catch (e) { console.error(`  ✗ erreur : ${e.message}`); failed++; }
}

// ─── Jeu de données simulé (en-têtes lisibles de l'open data) ───────────────
const H = ['Session', "Statut de l'établissement de la filière de formation (public, privé…)", 'Établissement',
  "Commune de l'établissement", "Académie de l'établissement", 'Filière de formation très agrégée', 'Filière de formation',
  'Filière de formation détaillée bis', 'Filière de formation très détaillée', "Capacité de l'établissement par formation"];
function opendataRows() {
  const out = [];
  const add = (n, statut, etab, ville, aca, tresAgr, fil, detBis, tresDet, capa) => {
    for (let i = 0; i < n; i++) out.push(Object.fromEntries(H.map((h, j) => [h, [2025, statut, etab, ville, aca, tresAgr, fil, detBis, tresDet, capa][j]])));
  };
  add(30, 'Public', 'Université de Bordeaux', 'Bordeaux', 'Bordeaux', 'PASS', 'PASS', "Parcours d'Accès Spécifique Santé (PASS)", 'PASS option Droit', 50);
  add(10, 'Public', 'Université de Pau', 'Pau', 'Bordeaux', 'PASS', 'PASS', "Parcours d'Accès Spécifique Santé (PASS)", 'PASS option Droit', 40);
  add(60, 'Public', 'Université de Bordeaux', 'Bordeaux', 'Bordeaux', 'PASS', 'PASS', "Parcours d'Accès Spécifique Santé (PASS)", 'PASS option Biologie', 60);
  add(300, 'Public', 'Lycée Gustave Eiffel', 'Bordeaux', 'Bordeaux', 'BTS', 'BTS - Services', 'BTS - Management Commercial Opérationnel', 'Management Commercial Opérationnel', 30);
  add(200, 'Public', 'Faculté de Droit et Science politique', 'Bordeaux', 'Bordeaux', 'Licence', 'Licence - Droit, économie, gestion', 'Licence - Droit', 'Droit', 200);
  add(100, "Privé sous contrat d'association", 'Lycée Saint-Joseph', 'Toulouse', 'Toulouse', 'BTS', 'BTS - Services', 'BTS - Négociation et Digitalisation de la Relation Client', 'NDRC', 24);
  return out;
}

function makeCtx(table) {
  const noopEl = () => null;
  const ctx = {
    console: { ...console, log() {}, warn() {}, info() {} },
    setTimeout: () => null, clearTimeout() {}, URLSearchParams, TextDecoder,
    document: { getElementById: noopEl, querySelector: noopEl, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => Promise.reject(new Error('offline')),
    escapeHtml: s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    exports: [],
  };
  // Export Excel simulé : on enregistre seulement la demande
  ctx.XLSX = { utils: { json_to_sheet: () => ({}), book_new: () => ({}), book_append_sheet() {}, sheet_to_csv: () => '' }, writeFile(wb, name) { ctx.exports.push(name); } };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.selectedDocIds = new Set();
  vm.createContext(ctx);
  for (const f of ['config.js', 'knowledge.js', 'documents.js', 'planner.js', 'dataEngine.js', 'sessions.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
  }
  ctx.__table = table;
  vm.runInContext(`defaultOpenDataTable = __table; defaultOpenDataState = 'ready';`, ctx);
  return ctx;
}
const opendata = () => ({ source: 'Open data', name: 'Parcoursup 2025 — France entière (open data)', session: 2025, rowUnit: 'formation', isDefault: true, headers: H, objects: opendataRows() });

// Pose une question comme le widget : plan, puis exécution
function ask(ctx, question) {
  ctx.__q = question;
  const plan = vm.runInContext('detectDataEnginePlan(__q)', ctx);
  const exec = plan ? vm.runInContext('runDataEnginePlan', ctx)(plan, []) : null;
  return { plan, exec };
}
const run = (ctx, code) => vm.runInContext(code, ctx);
const values = exec => (Array.isArray(exec?.result?.rows) ? exec.result.rows : []).map(r => `${r.value}:${r.count}`).sort().join(' | ');

// ─── Les trois questions du test réel ───────────────────────────────────────
describe('1. « donne moi la liste complète des filières de PASS » → liste des options, pas un export', () => {
  const ctx = makeCtx(opendata());
  const { plan, exec } = ask(ctx, 'donne moi la liste complète des filières de PASS');
  assert(plan && plan.tool === 'group_by' && plan.listMode === true, `outil « liste » (obtenu : ${plan?.tool})`);
  assert(ctx.exports.length === 0, 'aucun fichier Excel téléchargé');
  assert(exec && exec.kind === 'group_by', 'résultat calculé localement');
  assert(exec.result.total === 100, `100 formations PASS retenues (obtenu : ${exec?.result?.total})`);
  assert(values(exec) === 'PASS option Biologie:60 | PASS option Droit:40', `options listées avec leur nombre (obtenu : ${values(exec)})`);
  assert(/PASS option Droit/.test(exec.html) && /PASS option Biologie/.test(exec.html), 'les options apparaissent dans la réponse');
  assert(run(ctx, 'shouldAnswerLocallyWithoutAlbert')(exec) === true, 'réponse donnée sans passer par Albert');
});

describe('2. « donne moi toutes les filières de PASS avec toutes les options » → calcul local, pas Albert sans données', () => {
  const ctx = makeCtx(opendata());
  const q = 'donne moi toutes les filières de PASS avec toutes les options';
  assert(run(ctx, 'isDataEngineQuestion')(q) === true, 'question confiée au moteur de calcul');
  const { plan, exec } = ask(ctx, q);
  assert(plan && plan.listMode === true, 'mode liste');
  assert(values(exec) === 'PASS option Biologie:60 | PASS option Droit:40', `options listées (obtenu : ${values(exec)})`);
  assert(run(ctx, 'shouldAnswerLocallyWithoutAlbert')(exec) === true, 'réponse donnée sans passer par Albert');
});

describe('3. « combien de PASS option Droit » → 40, pas tout le fichier', () => {
  const ctx = makeCtx(opendata());
  const { plan, exec } = ask(ctx, 'combien de PASS option Droit');
  assert(plan && plan.tool === 'count_rows', 'outil comptage');
  assert(exec && exec.kind === 'count', 'résultat calculé');
  assert(exec.result.count === 40, `40 formations (obtenu : ${exec?.result?.count})`);
  assert(exec.result.count !== exec.result.total, 'le résultat n\'est pas le total du fichier');
  assert((plan.filters || []).some(f => f.op === 'contains_all'), 'filtre sur les intitulés de formation');
  assert(!/Aucun filtre appliqué/.test(exec.html), '« Aucun filtre appliqué » n\'est plus affiché');
  assert(/PASS/.test(exec.html) && /Droit/.test(exec.html), 'le filtre affiché cite PASS et Droit');
  assert(/formations? correspondant/.test(exec.html), 'unité affichée : formations (une ligne = une formation)');
  const title = run(ctx, 'extractBlockTitle')(exec, 'combien de PASS option Droit');
  assert(/^40 formations/.test(title) && !/candidat/.test(title), `titre du bloc en formations, pas en candidats (obtenu : ${title})`);
});

// ─── Variantes ──────────────────────────────────────────────────────────────
describe('Variantes reconnues', () => {
  const ctx = makeCtx(opendata());
  assert(ask(ctx, 'combien de PASS').exec.result.count === 100, '« combien de PASS » → 100');
  assert(ask(ctx, 'combien de PASS ?').exec.result.count === 100, 'ponctuation ignorée');
  assert(ask(ctx, 'Combien de formations PASS option droit ?').exec.result.count === 40, 'majuscules / minuscules indifférentes');
  assert(ask(ctx, 'combien de licences de droit').exec.result.count === 200, '« licences de droit » → Licence Droit (200), pas PASS option Droit');
  // Cas réel : la famille « Licence - Droit, économie, gestion » contient aussi « licence » et « droit »
  const fam = makeCtx({ ...opendata(), objects: [...opendataRows(), ...Array.from({ length: 50 }, () => Object.fromEntries(H.map((h, j) => [h, [2025, 'Public', 'Université', 'Pau', 'Bordeaux', 'Licence', 'Licence - Droit, économie, gestion', 'Licence - Économie', 'Économie', 100][j]])))] });
  assert(ask(fam, 'combien de licences de droit').exec.result.count === 200, '« licences de droit » → la colonne la plus précise (200), pas toute la famille droit-économie-gestion (250)');
  assert(ask(fam, 'combien de licences économie').exec.result.count === 50, '« licences économie » → 50');
  // Cas réel : une colonne presque vide contient aussi les deux mots pour quelques lignes : elle ne doit pas l'emporter
  const rare = makeCtx({ ...opendata(), objects: opendataRows().map((r, i) => i === 450 ? { ...r, 'Filière de formation très détaillée': 'Licence Droit - parcours international' } : (i > 400 && i < 600 ? { ...r, 'Filière de formation très détaillée': '' } : r)) });
  assert(ask(rare, 'combien de licences de droit').exec.result.count === 200, '« licences de droit » : une colonne presque vide ne réduit pas le compte à 1');
  const r = ask(ctx, 'quelles sont les options du PASS');
  assert(r.plan?.listMode === true && values(r.exec) === 'PASS option Biologie:60 | PASS option Droit:40', '« quelles sont les options du PASS » → liste');
});

describe('Option introuvable → arrêt plutôt qu\'un chiffre faux', () => {
  const ctx = makeCtx(opendata());
  const { exec } = ask(ctx, 'combien de PASS option Zoologie');
  assert(exec && exec.kind === 'unresolved', `résultat « non trouvé » (obtenu : ${exec?.kind} ${exec?.result?.count ?? ''})`);
  assert(/Zoologie/.test(exec.html), 'le terme introuvable est cité');
  assert(/PASS option Droit/.test(exec.html) && /PASS option Biologie/.test(exec.html), 'les options existantes sont proposées');
  assert(!/Calcul exact/.test(exec.html), 'pas de badge « Calcul exact »');
  assert(run(ctx, 'shouldAnswerLocallyWithoutAlbert')(exec) === true, 'pas de réponse inventée par Albert');
  const ctx2 = makeCtx(opendata());
  const r2 = ask(ctx2, 'combien de BTS option Droit');
  assert(r2.exec?.kind === 'unresolved', 'termes présents séparément mais jamais ensemble (BTS + Droit) → non trouvé');
});

describe('Suite de conversation', () => {
  const ctx = makeCtx(opendata());
  ask(ctx, 'combien de PASS');
  const { exec } = ask(ctx, 'et pour les publics ?');
  assert(exec && exec.result && exec.result.count === 100, `le filtre PASS est conservé dans la suite (obtenu : ${exec?.result?.count})`);
});

// ─── Faux positifs : ce qui ne doit PAS se passer ───────────────────────────
describe('Faux positifs', () => {
  const ctx = makeCtx(opendata());
  let r = ask(ctx, 'combien de formations');
  assert(r.exec.result.count === 700 && !(r.plan.filters || []).some(f => f.op === 'contains_all'), '« combien de formations » : aucun filtre d\'intitulé');
  r = ask(ctx, 'combien de formations à Bordeaux');
  assert(!(r.plan.filters || []).some(f => f.op === 'contains_all'), '« Bordeaux » (une ville) ne devient pas un intitulé de formation');
  r = ask(ctx, 'combien de BTS');
  assert(r.exec.result.count === 400, `« combien de BTS » → 400 (obtenu : ${r.exec?.result?.count})`);
  r = ask(ctx, 'quelles sont les formations les plus demandées');
  assert(!r.plan?.listMode, '« les plus demandées » reste un classement, pas une liste');
  r = ask(ctx, 'exporte la liste des PASS en Excel');
  assert(r.plan?.tool === 'export_excel' && ctx.exports.length === 1, 'export Excel explicitement demandé → toujours un export');
  assert(/100<\/strong> lignes/.test(r.exec?.html || ''), 'après « combien de BTS », l\'export porte sur les PASS seuls (100), sans cumuler BTS + PASS');
  assert(run(ctx, 'isDataEngineQuestion')("qu'est-ce que le PASS ?") === false, '« qu\'est-ce que le PASS ? » reste une question de connaissances (Albert)');
  r = ask(ctx, 'combien de formations avec un taux d\'accès supérieur à 50');
  assert(!(r.plan?.filters || []).some(f => f.op === 'contains_all'), '« accès » (taux d\'accès) ne filtre pas sur « Parcours d\'Accès Spécifique Santé »');
});

describe('Table de candidats (Grist) : comportement inchangé', () => {
  const cand = {
    source: 'Grist', name: 'Candidats',
    headers: ['Nom', 'Boursier', "Spécialité / mention formation d'accueil acceptée"],
    objects: [
      { Nom: 'A', Boursier: 'Oui', "Spécialité / mention formation d'accueil acceptée": 'BTS - Services - Management Commercial Opérationnel' },
      { Nom: 'B', Boursier: 'Non', "Spécialité / mention formation d'accueil acceptée": 'Licence - Droit' },
      { Nom: 'C', Boursier: 'Non', "Spécialité / mention formation d'accueil acceptée": 'Licence - Droit' },
    ]
  };
  const ctx = makeCtx(cand);
  const r = ask(ctx, 'liste des candidats boursiers');
  assert(r.plan?.tool === 'export_excel', '« liste des candidats » reste un export des lignes');
  const t = ask(ctx, 'combien de candidats en licence de droit');
  assert(t.exec?.result?.count === 2, `« candidats en licence de droit » → 2 (obtenu : ${t.exec?.result?.count})`);
  const title = run(ctx, 'extractBlockTitle')(t.exec, '');
  assert(/candidats/.test(title), 'table de candidats : le titre parle toujours de candidats');
});

describe('Widget : « Formation non trouvée » sans barre d\'actions ni bloc d\'infographie', () => {
  const albert = fs.readFileSync(path.join(__dirname, 'albert.js'), 'utf8');
  assert(/_introuvable = dataExecution\.kind === 'unresolved'/.test(albert), 'albert.js reconnaît le résultat « non trouvé »');
  assert(/noActions: _introuvable/.test(albert), 'pas de barre Graphique / Excel / PDF sous « Formation non trouvée »');
  assert(/!_introuvable && !_skipTools/.test(albert), 'pas de bloc ajouté au compositeur d\'infographies');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert(!/dataEngine\.js\?v=27\.5\.20/.test(html) && !/albert\.js\?v=27\.6\.17/.test(html), 'versions des scripts modifiés incrémentées dans index.html (cache)');
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
