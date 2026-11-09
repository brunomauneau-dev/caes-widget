// test_classement.js — Classer selon un chiffre : « les formations les plus demandées », « les 10 BTS les plus
// sélectifs », « les académies avec le plus de places ». Bon ordre et bonnes valeurs, recalculés sur les lignes ;
// lignes sans valeur écartées (et comptées), ex æquo signalés ; un taux n'est jamais additionné par groupe ;
// faux positifs (« les plus adaptées », « les critères les plus importants ») laissés à Albert.
// node js/test_classement.js

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
// Pose une question dans la conversation en cours (sans remise à zéro)
function suite(ctx, q) {
  ctx.__q = q;
  const plan = run(ctx, 'isDataEngineQuestion(__q)') ? run(ctx, 'detectDataEnginePlan(__q)') : null;
  return plan ? run(ctx, 'runDataEnginePlan')(plan, []) : null;
}
const valeurs = e => (e?.result?.lignes || []).map(l => l.valeur);
const meme = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ─── Open data simulé ────────────────────────────────────────────────────────
const OD = D.openData(3000, 5);
const tri = (lignes, f, sens = 'desc', n = 10) => lignes.map(f).filter(v => v !== '' && v !== null && v !== undefined).map(Number).sort((a, b) => sens === 'asc' ? a - b : b - a).slice(0, n);
const od = ctxOpenData(OD);

await describe('Classement des formations selon un chiffre : bon ordre, bonnes valeurs', () => {
  let e = ask(od, 'quelles sont les formations les plus demandées');
  assert(e && e.kind === 'classement' && e.plan.classement.col === 'Effectif total des candidats pour une formation', `« les plus demandées » → classement selon le nombre de candidats (obtenu : ${e?.kind} ${e?.plan?.classement?.col})`);
  assert(meme(valeurs(e), tri(OD, o => o.voe)), 'les 10 premières valeurs = les 10 plus grands effectifs de candidats, dans l\'ordre');
  const top = OD.slice().sort((a, b) => b.voe - a.voe)[0];
  assert(e.result.lignes[0].libelles.includes(top.etab) && e.result.lignes[0].libelles.includes(top.commune), 'la 1re ligne nomme la formation, son établissement et sa commune');
  e = ask(od, 'les 10 BTS les plus sélectifs');
  assert(e.kind === 'classement' && e.plan.classement.ordre === 'asc' && meme(valeurs(e), tri(OD.filter(o => o.fili === 'BTS'), o => o.taux, 'asc')), 'les plus sélectifs = taux d\'accès les plus bas, parmi les BTS');
  assert(!(e.plan.filters || []).some(f => /lectivit/.test(f.col)), '« les plus sélectifs » : critère de classement, pas un filtre « formation sélective »');
  e = ask(od, 'les formations les moins sélectives');
  assert(e.plan.classement.ordre === 'desc' && e.result.total === OD.length && meme(valeurs(e), tri(OD, o => o.taux, 'desc')), 'les moins sélectives : taux d\'accès les plus hauts, sur toutes les formations');
  e = ask(od, 'les formations avec le plus de places à Bordeaux');
  assert(meme(valeurs(e), tri(OD.filter(o => o.commune === 'Bordeaux'), o => o.capa)), 'le plus de places, à Bordeaux (filtre commune gardé)');
  e = ask(od, 'quelle formation a le plus de candidats');
  assert(e.result.lignes.length === 1 && e.result.lignes[0].valeur === Math.max(...OD.map(o => o.voe)), '« quelle formation a le plus … » : une seule ligne, la bonne');
  e = ask(od, 'les 5 CPGE les moins sélectives');
  assert(e.result.lignes.length === 5 && meme(valeurs(e), tri(OD.filter(o => o.fili === 'CPGE'), o => o.taux, 'desc', 5)), '« les 5 … » : 5 lignes');
  e = ask(od, 'les formations sélectives les plus demandées');
  assert(e.plan.classement.col === 'Effectif total des candidats pour une formation' && meme(valeurs(e), tri(OD.filter(o => o.selectivite === 'formation sélective'), o => o.voe)), '« sélectives les plus demandées » : filtre sélectives + classement par candidats (le critère est le mot après « les plus »)');
  e = ask(od, "les formations avec le taux d'accès le plus bas");
  assert(e.plan.classement.ordre === 'asc' && meme(valeurs(e), tri(OD, o => o.taux, 'asc')), '« le taux d\'accès le plus bas » : ordre croissant');
  e = ask(od, 'top 5 des formations par capacité');
  assert(meme(valeurs(e), tri(OD, o => o.capa, 'desc', 5)), '« top 5 des formations par capacité »');
});

await describe('Classement de regroupements (académies…) : somme exacte par groupe', () => {
  const e = ask(od, 'les académies avec le plus de places');
  const sommes = {}; OD.forEach(o => { sommes[o.aca] = (sommes[o.aca] || 0) + o.capa; });
  const attendu = Object.entries(sommes).sort((a, b) => b[1] - a[1]).slice(0, 10);
  assert(e.kind === 'classement' && e.plan.classement.entite?.col === "Académie de l'établissement", 'classement par académie');
  assert(meme(e.result.lignes.map(l => [l.libelles[0], l.valeur]), attendu), `sommes de places par académie, dans l'ordre (${attendu.slice(0, 2).map(x => x.join(' ')).join(', ')}…)`);
  const r = ask(od, 'les académies les plus sélectives');
  assert(r.kind === 'unresolved' && /un taux ne s'additionne pas/.test(r.text), 'académies « les plus sélectives » : arrêt (un taux ne s\'additionne pas), pas un chiffre inventé');
  const f = ask(od, 'les communes avec le plus de formations');
  const freq = {}; OD.forEach(o => { freq[o.commune] = (freq[o.commune] || 0) + 1; });
  const premiere = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
  assert(f.kind === 'top' && f.result.rows[0].value === premiere[0] && f.result.rows[0].count === premiere[1], `« communes avec le plus de formations » : nombre de formations par commune (${premiere.join(' : ')})`);
});

await describe('Cases vides, ex æquo, périmètre', () => {
  const lignes = OD.map((o, i) => i % 9 === 0 ? { ...o, voe: '' } : o);
  const vides = lignes.filter(o => o.voe === '').length;
  const ctx = ctxOpenData(lignes);
  const e = ask(ctx, 'les formations les plus demandées');
  assert(e.result.sansValeur === vides && meme(valeurs(e), tri(lignes, o => o.voe)), `${vides} formations sans nombre de candidats : écartées, pas classées comme 0`);
  assert(/écartées du classement/.test(e.html) && /formations retenues sur/.test(e.html), 'périmètre : lignes retenues et formations écartées');
  const egal = ctxOpenData(OD.map((o, i) => ({ ...o, capa: i < 15 ? 999 : o.capa })));
  const x = ask(egal, 'les formations avec le plus de places');
  assert(x.result.exAequo === 5 && /5 autres formations ont la même valeur que la dernière ligne/.test(x.html), '15 formations à égalité pour 10 places : « 5 autres … ex æquo » signalé');
  assert(/Classement selon la colonne/.test(e.html) && /<table/.test(e.html) && /Calcul exact/.test(e.html), 'affichage : critère écrit, tableau, badge « calcul exact »');
});

await describe('Relance, export, Albert', () => {
  const ctx = ctxOpenData(OD);
  ask(ctx, 'les formations les plus demandées');
  const r = suite(ctx, 'et à Bordeaux ?');
  assert(r && r.kind === 'classement' && meme(valeurs(r), tri(OD.filter(o => o.commune === 'Bordeaux'), o => o.voe)), `« et à Bordeaux ? » : même classement, limité à Bordeaux (obtenu : ${r?.kind})`);
  const lignes = run(ctx, 'currentExecutionToRows')(r);
  assert(lignes.length === r.result.lignes.length && lignes[0].Rang === 1 && lignes[0]['Effectif total des candidats pour une formation'] === r.result.lignes[0].valeur, 'export Excel : rang, description et valeur');
  const contexte = run(ctx, 'dataEngineResultToContext')(r);
  assert(/Classement selon « Effectif total des candidats pour une formation » \(décroissant\)/.test(contexte) && contexte.includes(`1. `) && /Périmètre :/.test(contexte), 'contexte Albert : critère, ordre, lignes et périmètre');
  assert(run(ctx, 'shouldAnswerLocallyWithoutAlbert')(r) === true, 'réponse donnée par le widget, sans Albert');
  const g = run(ctx, 'renderCurrentChartExecution')({ sourceExecution: r, question: 'graphique' });
  assert(g && g.kind === 'classement' && /Graphique — classement selon candidats/.test(g.html) && (g.html.match(/data-bar-label=/g) || []).length === r.result.lignes.length
    && g.html.includes(`data-bar-count="${r.result.lignes[0].valeur.toLocaleString('fr-FR')}"`), 'bouton « Graphique » : barres des valeurs classées (pas une répartition de repli)');
  assert(!/#1212ff|var\(--bleu2/.test(r.html), 'en-têtes du tableau lisibles (fond bleu pâle, pas le bleu vif --bleu2)');
});

await describe('Relances « et à … / et en … / et dans … » (avant : non reconnues)', () => {
  const cas = [
    ['et à Bordeaux ?', o => o.commune === 'Bordeaux'],
    ['et en Gironde ?', o => o.dep === 'Gironde'],
    ["et dans l'académie de Toulouse ?", o => o.aca === 'Toulouse'],
  ];
  for (const [q, pred] of cas) {
    const ctx = ctxOpenData(OD);
    ask(ctx, 'combien de BTS');
    const r = suite(ctx, q);
    const attendu = OD.filter(o => o.fili === 'BTS' && pred(o)).length;
    assert(r && r.kind === 'count' && r.result.count === attendu, `« combien de BTS » puis « ${q} » → ${attendu} BTS (obtenu : ${r?.kind} ${r?.result?.count ?? ''})`);
  }
  const ctx = ctxOpenData(OD);
  ask(ctx, 'répartition par académie');
  const g = suite(ctx, 'et en Gironde ?');
  assert(g && g.kind === 'group_by' && g.result.total === OD.filter(o => o.dep === 'Gironde').length, 'répartition puis « et en Gironde ? » : même répartition, limitée à la Gironde');
  assert(!run(ctx, 'isFilterOnlyFollowUp')('et alors ?') && !run(ctx, 'isFilterOnlyFollowUp')('expliquez la procédure'), 'faux positif : « et alors ? » n\'est pas une relance de filtre');
});

await describe('Faux positifs : ce qui ne devient pas un classement', () => {
  const routee = q => run(od, 'isDataEngineQuestion')(q);
  assert(!routee('quelles formations sont les plus adaptées pour un bac pro'), '« les plus adaptées » : question de conseil → Albert');
  assert(!routee('quels sont les critères les plus importants pour être admis'), '« les critères les plus importants pour être admis » : pas un classement des admis');
  assert(!routee("qu'est-ce qu'une formation sélective"), '« qu\'est-ce qu\'une formation sélective » → Albert');
  assert(ask(od, 'top 5 des communes').kind === 'top', '« top 5 des communes » : inchangé (répartition)');
  assert(ask(od, 'combien de formations sélectives').result.count === OD.filter(o => o.selectivite === 'formation sélective').length, '« combien de formations sélectives » : filtre inchangé');
  assert(ask(od, 'capacité moyenne des BTS').kind === 'stats', '« capacité moyenne » : statistique, pas classement');
});

await describe('Fichier de candidats (une ligne = un candidat)', async () => {
  const C = D.candidats(600, 4);
  const ctx = await ctxCSV(D.versTableau(C, D.enTetes.complets));
  const l = ask(ctx, 'les lycées avec le plus de candidats');
  const freq = {}; C.forEach(o => { freq[o.lycee_origine] = (freq[o.lycee_origine] || 0) + 1; });
  const premier = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
  assert(l.kind === 'top' && l.result.rows[0].value === premier[0] && l.result.rows[0].count === premier[1], `« lycées avec le plus de candidats » : nombre de candidats par lycée, pas une somme de vœux (${premier.join(' : ')})`);
  const v = ask(ctx, 'les candidats avec le plus de vœux');
  assert(v.kind === 'classement' && v.result.lignes[0].valeur === Math.max(...C.map(o => o.nb_voeux)) && v.plan.colonnesDescription[0] === 'Numéro du candidat', 'candidats avec le plus de vœux : numéro du candidat en premier');
  assert(ask(ctx, 'les formations les plus demandées')?.kind !== 'classement', 'pas de colonne « candidats » chiffrée : pas de classement inventé');
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
