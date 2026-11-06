// test_reformulations.js — Une même question posée de plusieurs façons donne le même chiffre (le bon).
// Chaque groupe : une question type, sa bonne réponse calculée directement sur les données simulées
// (js/fixtures/donnees_simulees.mjs), et des reformulations comme les écriraient des agents :
// tournures (« combien », « nombre de », « il y a combien »), fautes de frappe courantes, majuscules,
// abréviations, ordre des mots. Règle : chaque reformulation donne le bon chiffre, ou le widget
// s'arrête (« critère non reconnu ») — jamais un autre chiffre en silence.
// node js/test_reformulations.js          (résumé)
// node js/test_reformulations.js --detail (chaque reformulation)

import fs from 'fs';
import vm from 'vm';
import { fileURLToPath } from 'url';
import path from 'path';
import * as D from './fixtures/donnees_simulees.mjs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DETAIL = process.argv.includes('--detail');

let passed = 0, failed = 0;
function assert(condition, label) {
  if (condition) { if (DETAIL) console.log(`  ✓ ${label}`); passed++; }
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
function ctxOpenData(lignes) {
  const ctx = makeCtx();
  ctx.__t = D.tableOpenData(lignes);
  run(ctx, "defaultOpenDataTable = __t; defaultOpenDataState = 'ready';");
  return ctx;
}
async function ctxCSV(rows, name = 'extraction.csv') {
  const ctx = makeCtx();
  const buf = new TextEncoder().encode(D.versCSV(rows));
  await run(ctx, 'importSpreadsheetFile')({ name, size: buf.length, arrayBuffer: async () => buf.buffer });
  return ctx;
}
// Question posée « à froid », comme une nouvelle conversation
function ask(ctx, q) {
  run(ctx, 'window.__DATA_ENGINE_STATE = { lastPlan: null, lastExecution: null, history: [] }');
  ctx.__q = q;
  const plan = run(ctx, 'isDataEngineQuestion(__q)') ? run(ctx, 'detectDataEnginePlan(__q)') : null;
  return plan ? run(ctx, 'runDataEnginePlan')(plan, []) : null;
}
// Valeur obtenue selon le type de question
function obtenu(exec, g) {
  if (!exec) return 'Albert (non calculé)';
  if (exec.kind === 'unresolved') return 'arrêt';
  if (g.type === 'count') return exec.kind === 'count' ? exec.result.count : `${exec.kind}`;
  if (g.type === 'sum') return exec.kind === 'sum' ? exec.result.sum : `${exec.kind}`;
  if (g.type === 'avg') return exec.kind === 'stats' ? Math.round(exec.result.avg * 100) / 100 : `${exec.kind}`;
  if (g.type === 'group') {
    if (!['group_by', 'top'].includes(exec.kind)) return `${exec.kind}`;
    if (g.col && !g.col.test(exec.plan?.targetCol || '')) return `colonne ${exec.plan?.targetCol}`;
    const l = (exec.result.rows || []).find(r => r.value === g.cle);
    return l ? l.count : `pas de ligne ${g.cle}`;
  }
  return exec.kind;
}

// Pose chaque groupe ; renvoie le bilan par groupe
function poser(ctx, groupes, titre) {
  const bilan = [];
  groupes.forEach(g => {
    const res = g.variantes.map(q => ({ q, v: obtenu(ask(ctx, q), g) }));
    const justes = res.filter(r => r.v === g.v).length;
    const faux = res.filter(r => r.v !== g.v && r.v !== 'arrêt');
    bilan.push({ g, justes, total: res.length, faux, arrets: res.filter(r => r.v === 'arrêt') });
    res.forEach(r => assert(r.v === g.v, `[${titre}] « ${r.q} » → ${g.v} (obtenu : ${r.v})`));
  });
  bilan.forEach(b => console.log(`  ${b.justes === b.total ? '✓' : '·'} ${b.g.nom} : ${b.justes} / ${b.total}`));
  return bilan;
}

// ─── Open data simulé (une ligne = une formation) ───────────────────────────
// Comme dans les vraies données : quelques intitulés contiennent « non » (« … non spécialisé ») — le mot « non »
// de « formations non sélectives » ne doit pas devenir un critère d'intitulé (bug vu sur l'open data réel : 17 au lieu de 3 196)
const OD = D.openData(4000, 21).map((o, i) => i % 97 === 0 ? { ...o, detail: `${o.detail} - parcours non spécialisé` } : o);
const m = pred => D.compter(OD, pred);
const somme = (pred, f) => OD.filter(pred).reduce((s, o) => s + f(o), 0);
const moyenne = (pred, f) => Math.round(somme(pred, f) / m(pred) * 100) / 100;
const GROUPES_OD = [
  { nom: 'nombre de BTS', type: 'count', v: m(o => o.fili === 'BTS'), variantes: [
    'combien de BTS', 'combien de BTS ?', 'nombre de BTS', 'Combien y a-t-il de BTS ?', 'il y a combien de BTS', 'combien de formations BTS',
    'combien de formations en BTS', 'quel est le nombre de BTS', 'donne moi le nombre de BTS', 'nb de BTS', 'combien de bts', 'COMBIEN DE BTS',
    'combien il y a de BTS', 'combien de BTS en France', 'peux-tu me dire combien il y a de BTS ?', 'le nombre de formations de BTS'] },
  { nom: 'BTS de l\'académie de Bordeaux', type: 'count', v: m(o => o.fili === 'BTS' && o.aca === 'Bordeaux'), variantes: [
    "combien de BTS dans l'académie de Bordeaux", "nombre de BTS dans l'académie de Bordeaux", "combien de BTS sur l'académie de Bordeaux",
    "combien de BTS en académie de Bordeaux", "combien de BTS pour l'académie de Bordeaux", "BTS de l'académie de Bordeaux : combien ?",
    "dans l'académie de Bordeaux, combien de BTS ?", "combien de BTS académie de Bordeaux", "combien de BTS dans l'academie de bordeaux"] },
  { nom: 'formations privées', type: 'count', v: m(o => o.statut !== 'Public'), variantes: [
    'combien de formations privées', 'nombre de formations privées', 'combien de formations dans le privé', 'combien de formations du privé',
    'combien de formations privees', 'combien y a-t-il de formations privées ?'] },
  { nom: 'BTS publics', type: 'count', v: m(o => o.fili === 'BTS' && o.statut === 'Public'), variantes: [
    'combien de BTS publics', 'nombre de BTS publics', 'combien de BTS dans le public', 'combien de BTS du public', 'combien de BTS en établissement public'] },
  { nom: 'formations sélectives', type: 'count', v: m(o => o.selectivite === 'formation sélective'), variantes: [
    'combien de formations sélectives', 'nombre de formations sélectives', 'combien de formations selectives', 'combien y a-t-il de formations sélectives ?'] },
  { nom: 'formations à Bordeaux (ville)', type: 'count', v: m(o => o.commune === 'Bordeaux'), variantes: [
    'combien de formations à Bordeaux', 'nombre de formations à Bordeaux', 'combien de formations a Bordeaux', 'combien de formations sur la commune de Bordeaux',
    'combien de formations dans la ville de Bordeaux'] },
  { nom: 'formations en Gironde', type: 'count', v: m(o => o.dep === 'Gironde'), variantes: [
    'combien de formations en Gironde', 'nombre de formations en Gironde', 'combien de formations dans la Gironde', 'combien de formations dans le département de la Gironde',
    'combien de formations en gironde'] },
  { nom: 'formations en Nouvelle-Aquitaine', type: 'count', v: m(o => o.region === 'Nouvelle-Aquitaine'), variantes: [
    'combien de formations en Nouvelle-Aquitaine', 'nombre de formations en Nouvelle Aquitaine', 'combien de formations dans la région Nouvelle-Aquitaine',
    'combien de formations en nouvelle-aquitaine'] },
  { nom: 'licences de droit', type: 'count', v: m(o => o.fil_det === 'Licence - Droit'), variantes: [
    'combien de licences de droit', 'nombre de licences de droit', 'combien de licences en droit', 'combien de licence droit', 'combien de formations de licence de droit'] },
  { nom: 'places en BTS', type: 'sum', v: somme(o => o.fili === 'BTS', o => o.capa), variantes: [
    'combien de places en BTS', 'nombre de places en BTS', 'combien de places dans les BTS', 'capacité totale des BTS', 'total des places en BTS',
    "combien de places d'accueil en BTS", 'combien de places sont proposées en BTS'] },
  { nom: 'candidats en PASS', type: 'sum', v: somme(o => o.fili === 'PASS', o => o.voe), variantes: [
    'combien de candidats en PASS', 'nombre de candidats en PASS', 'combien de candidats pour les PASS', 'nombre total de candidats en PASS'] },
  { nom: 'capacité moyenne des BTS', type: 'avg', v: moyenne(o => o.fili === 'BTS', o => o.capa), variantes: [
    'capacité moyenne des BTS', 'quelle est la capacité moyenne des BTS', 'capacité moyenne en BTS', 'moyenne de la capacité des BTS',
    "capacité d'accueil moyenne des BTS", 'en moyenne, quelle est la capacité des BTS ?'] },
  { nom: 'formations par académie (Bordeaux)', type: 'group', col: /^Académie/, cle: 'Bordeaux', v: m(o => o.aca === 'Bordeaux'), variantes: [
    'répartition par académie', 'nombre de formations par académie', 'combien de formations par académie', 'répartition des formations par académie',
    'ventilation par académie', 'formations par académie', 'repartition par academie'] },
  { nom: 'BTS par académie (Bordeaux)', type: 'group', col: /^Académie/, cle: 'Bordeaux', v: m(o => o.fili === 'BTS' && o.aca === 'Bordeaux'), variantes: [
    'répartition des BTS par académie', 'nombre de BTS par académie', 'BTS par académie', 'combien de BTS par académie', 'combien de BTS dans chaque académie',
    'répartition par académie des BTS'] },
  { nom: 'formations par statut (Public)', type: 'group', col: /^Statut/, cle: 'Public', v: m(o => o.statut === 'Public'), variantes: [
    'répartition par statut', 'répartition public / privé', 'nombre de formations par statut', 'répartition par statut de l\'établissement'] },
  // Série 2 : tournures plus libres, exclusions, combinaisons
  { nom: 'BTS hors académie de Bordeaux', type: 'count', v: m(o => o.fili === 'BTS' && o.aca !== 'Bordeaux'), variantes: [
    "combien de BTS hors académie de Bordeaux", "combien de BTS en dehors de l'académie de Bordeaux", "combien de BTS sauf l'académie de Bordeaux",
    "nombre de BTS hors de l'académie de Bordeaux", "combien de BTS qui ne sont pas dans l'académie de Bordeaux"] },
  { nom: 'formations non sélectives', type: 'count', v: m(o => o.selectivite === 'formation non sélective'), variantes: [
    'combien de formations non sélectives', 'nombre de formations non sélectives', 'combien de formations qui ne sont pas sélectives', 'combien de formations sans sélection'] },
  { nom: 'BTS privés de l\'académie de Toulouse', type: 'count', v: m(o => o.fili === 'BTS' && o.statut !== 'Public' && o.aca === 'Toulouse'), variantes: [
    "combien de BTS privés dans l'académie de Toulouse", "nombre de BTS privés de l'académie de Toulouse", "dans l'académie de Toulouse, combien de BTS privés ?",
    "combien de BTS du privé dans l'académie de Toulouse"] },
  { nom: 'CPGE', type: 'count', v: m(o => o.fili === 'CPGE'), variantes: [
    'combien de CPGE', 'combien de prépas', 'combien de classes prépa', 'nombre de classes préparatoires', 'combien de classes préparatoires aux grandes écoles'] },
  { nom: 'places en BTS (2)', type: 'sum', v: somme(o => o.fili === 'BTS', o => o.capa), variantes: [
    'quel est le nombre total de places en BTS', 'en BTS, combien de places ?', 'nombre de places disponibles en BTS', 'combien de places offertes en BTS au total'] },
  { nom: 'admis en BTS', type: 'sum', v: somme(o => o.fili === 'BTS', o => o.acc), variantes: [
    "combien d'admis en BTS", "nombre d'admis en BTS", "combien de candidats admis en BTS", "combien de candidats ont accepté une proposition en BTS"] },
  { nom: 'taux d\'accès moyen des CPGE', type: 'avg', v: moyenne(o => o.fili === 'CPGE', o => o.taux), variantes: [
    "taux d'accès moyen des CPGE", "quel est le taux d'accès moyen en CPGE", "moyenne du taux d'accès des CPGE", "taux d'accès moyen des prépas"] },
];

// ─── Extraction de candidats (une ligne = un candidat) ──────────────────────
const C = D.candidats(1500, 9);
const c = pred => D.compter(C, pred);
const GROUPES_CAND = [
  { nom: 'boursiers', type: 'count', v: c(o => o.boursier === 'Oui'), variantes: [
    'combien de boursiers', 'combien de boursiers ?', 'nombre de boursiers', 'combien de candidats boursiers', "combien d'élèves boursiers",
    'combien y a-t-il de boursiers', 'nb de boursiers', 'combien de candidats sont boursiers'] },
  { nom: 'non boursiers', type: 'count', v: c(o => o.boursier === 'Non'), variantes: [
    'combien de non boursiers', 'combien de non-boursiers', 'nombre de non boursiers', 'combien de candidats non boursiers', 'combien de candidats qui ne sont pas boursiers'] },
  { nom: 'filles', type: 'count', v: c(o => o.sexe === 'Féminin'), variantes: [
    'combien de filles', 'nombre de filles', 'combien de candidates', 'combien de femmes', 'combien de candidats de sexe féminin'] },
  { nom: 'apprentis', type: 'count', v: c(o => o.apprenti === 'Oui'), variantes: [
    "combien d'apprentis", "nombre d'apprentis", 'combien de candidats en apprentissage', "combien d'élèves en apprentissage"] },
  { nom: 'bac général', type: 'count', v: c(o => o.serie === 'Générale'), variantes: [
    'combien de bacheliers généraux', 'combien de candidats en série générale', 'combien de bac général', 'nombre de candidats du bac général', 'combien de candidats de la voie générale'] },
  { nom: 'boursiers en BTS', type: 'count', v: c(o => o.boursier === 'Oui' && o.groupe === 'BTS'), variantes: [
    'combien de boursiers en BTS', 'nombre de boursiers en BTS', 'combien de candidats boursiers admis en BTS', 'combien de boursiers sont en BTS'] },
  { nom: 'Pays basque', type: 'count', v: c(o => o.basque === 'Oui'), variantes: [
    'combien de candidats du Pays basque', 'combien de basques', 'nombre de candidats de la zone Pays Basque', 'combien de candidats venant du Pays basque'] },
  { nom: 'vœux moyens', type: 'avg', v: Math.round(C.reduce((s, o) => s + o.nb_voeux, 0) / C.length * 100) / 100, variantes: [
    'nombre moyen de vœux confirmés', 'moyenne des vœux confirmés', 'combien de vœux en moyenne', 'nombre moyen de voeux', 'moyenne du nombre de vœux'] },
  { nom: 'candidats par série (Générale)', type: 'group', cle: 'Générale', v: c(o => o.serie === 'Générale'), variantes: [
    'répartition par série', 'répartition par série de bac', 'nombre de candidats par série', 'par série', 'combien de candidats par série de bac'] },
  // Série 2
  { nom: 'garçons', type: 'count', v: c(o => o.sexe === 'Masculin'), variantes: [
    'combien de garçons', "combien d'hommes", 'nombre de garçons', 'combien de candidats de sexe masculin', 'combien de garcons'] },
  { nom: 'filles boursières', type: 'count', v: c(o => o.sexe === 'Féminin' && o.boursier === 'Oui'), variantes: [
    'combien de filles boursières', 'combien de boursières', 'nombre de filles boursières', 'combien de candidates boursières'] },
  { nom: 'bac pro', type: 'count', v: c(o => o.serie === 'Professionnelle'), variantes: [
    'combien de bac pro', 'combien de candidats en bac professionnel', 'combien de bacheliers professionnels', 'nombre de candidats de la voie professionnelle'] },
  { nom: 'bac techno', type: 'count', v: c(o => o.serie === 'Technologique'), variantes: [
    'combien de bac techno', 'combien de candidats en bac technologique', 'combien de bacheliers technologiques', 'nombre de candidats en série technologique'] },
  { nom: 'non apprentis', type: 'count', v: c(o => o.apprenti === 'Non'), variantes: [
    'combien de non apprentis', 'combien de candidats qui ne sont pas apprentis', 'combien de candidats hors apprentissage'] },
  { nom: 'hors Pays basque', type: 'count', v: c(o => o.basque === 'Non'), variantes: [
    'combien de candidats hors Pays basque', 'combien de candidats qui ne sont pas du Pays basque', 'combien de candidats en dehors du Pays basque'] },
  { nom: 'boursiers par série (Générale)', type: 'group', cle: 'Générale', v: c(o => o.serie === 'Générale' && o.boursier === 'Oui'), variantes: [
    'répartition des boursiers par série', 'nombre de boursiers par série', 'boursiers par série de bac', 'combien de boursiers dans chaque série'] },
];

await describe('Couche de reformulation : ce qu\'elle change… et ce qu\'elle ne touche pas', () => {
  const ctx = makeCtx();
  const R = q => ctx.reformulerQuestion(q);
  const cas = [
    ['nb de BTS', 'nombre de BTS'], ['nbre de boursiers', 'nombre de boursiers'],
    ['combien de candidats qui ne sont pas boursiers', 'combien de candidats non boursiers'],
    ["combien de BTS qui ne sont pas dans l'académie de Bordeaux", "combien de BTS hors l'académie de Bordeaux"],
    ["combien de BTS en dehors de l'académie de Bordeaux", "combien de BTS hors académie de Bordeaux"],
    ['combien de BTS dans chaque académie', 'combien de BTS par académie'],
    ['combien de bacheliers généraux', 'combien de bac général'], ['combien de candidats de la voie professionnelle', 'combien de candidats de la bac professionnel'],
    ['combien de formations sur la commune de Bordeaux', 'combien de formations à Bordeaux'], ['combien de prépas', 'combien de CPGE'],
    ['combien de boursières', 'combien de filles boursières'], ['combien de formations sans sélection', 'combien de formations non sélectives'],
  ];
  cas.forEach(([q, attendu]) => assert(R(q) === attendu, `« ${q} » → « ${attendu} » (obtenu : « ${R(q)} »)`));
  const intacts = ['combien de BTS', 'combien de filles boursières', 'combien de non boursières', 'répartition par commune de l\'établissement',
    'combien de formations dans la commune de l\'établissement', 'quel est le nombre de vœux', 'combien de formations publiques', 'préparation aux concours',
    'les candidats ont-ils des notes ?', 'compare boursiers et non boursiers'];
  intacts.forEach(q => assert(R(q) === q, `inchangée : « ${q} » (obtenu : « ${R(q)} »)`));
  assert(R('') === '' && R(null) === '' && R(undefined) === '', 'question vide : pas d\'erreur');
});

const bilanOD = [], bilanC = [];
await describe(`Open data simulé (${OD.length} formations) : ${GROUPES_OD.length} questions, ${GROUPES_OD.reduce((s, g) => s + g.variantes.length, 0)} reformulations`, () => {
  bilanOD.push(...poser(ctxOpenData(OD), GROUPES_OD, 'open data'));
});
for (const [nomEnTetes, noms] of Object.entries({ complets: D.enTetes.complets, abreges: D.enTetes.abreges })) {
  await describe(`Extraction de candidats, en-têtes ${nomEnTetes} (${C.length} lignes) : ${GROUPES_CAND.length} questions`, async () => {
    bilanC.push(...poser(await ctxCSV(D.versTableau(C, noms)), GROUPES_CAND, `candidats ${nomEnTetes}`));
  });
}

await describe('Aucune reformulation ne donne un autre chiffre en silence', () => {
  const faux = [...bilanOD, ...bilanC].flatMap(b => b.faux.map(f => `${b.g.nom} : « ${f.q} » → ${f.v}`));
  assert(faux.length === 0, `chiffres faux : ${faux.length}${faux.length ? '\n      ' + faux.join('\n      ') : ''}`);
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
