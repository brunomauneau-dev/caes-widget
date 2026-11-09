// test_parts.js — Taux et parts calculés par le widget (Albert ne calcule jamais) :
// « part des boursiers parmi les admis en BTS », « pourcentage de filles parmi les boursiers », « taux de remplissage ».
// Open data : somme ÷ somme, définitions du ministère (boursiers parmi les admis néo-bacheliers) ; fichiers : lignes ÷ lignes.
// Bonne réponse recalculée sur les lignes ; arrêt si une colonne manque ; faux positifs (taux d'accès moyen, répartition en %).
// node js/test_parts.js

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

const pct = (a, b) => a / b * 100;
const proche = (a, b) => Math.abs(a - b) < 1e-9;

// ─── Open data simulé : parts calculées sur les effectifs ─────────────────────
const OD = D.openData(3000, 8);
const od = ctxOpenData(OD);
const S = (pred, f) => OD.filter(pred).reduce((t, o) => t + f(o), 0);

await describe('Parts sur les effectifs (open data) : somme ÷ somme, définitions du ministère', () => {
  const cas = [
    ['part des boursiers parmi les admis en BTS', o => o.fili === 'BTS', o => o.acc_bours, o => o.acc_neobac, 'admis boursiers', 'admis néo-bacheliers'],
    ['% de boursiers en BTS à Bordeaux', o => o.fili === 'BTS' && o.commune === 'Bordeaux', o => o.acc_bours, o => o.acc_neobac, 'admis boursiers', 'admis néo-bacheliers'],
    ['part des filles parmi les admis', () => true, o => o.acc_f, o => o.acc, 'admises', 'admis'],
    ['part des filles parmi les candidats en CPGE', o => o.fili === 'CPGE', o => o.voe_f, o => o.voe, 'candidates', 'candidats'],
    ['part des néo-bacheliers parmi les admis', () => true, o => o.acc_neobac, o => o.acc, 'admis néo-bacheliers', 'admis'],
    ['part des bacheliers généraux parmi les admis en CPGE', o => o.fili === 'CPGE', o => o.acc_bg, o => o.acc_neobac, 'généraux', 'néo-bacheliers'],
    ['taux de remplissage des BTS', o => o.fili === 'BTS', o => o.acc, o => o.capa, 'admis', 'places'],
    ["taux d'admission en BTS", o => o.fili === 'BTS', o => o.acc, o => o.voe, 'admis', 'candidats'],
    ['taux de proposition en PASS', o => o.fili === 'PASS', o => o.prop, o => o.voe, 'proposition', 'candidats'],
  ];
  for (const [q, base, num, den, quoi, sur] of cas) {
    const e = ask(od, q);
    const n = S(base, num), d = S(base, den);
    assert(e && e.kind === 'part' && e.result.mode === 'effectifs' && e.result.num === n && e.result.den === d && proche(e.result.pct, pct(n, d)),
      `« ${q} » → ${n} / ${d} = ${(Math.round(pct(n, d) * 10) / 10).toLocaleString('fr-FR')} % (obtenu : ${e?.kind} ${e?.result?.num ?? e?.text ?? ''} / ${e?.result?.den ?? ''})`);
    if (e?.kind === 'part') assert(e.html.includes(quoi) && e.html.includes(sur), `   … écrit en clair : « ${quoi} » sur « ${sur} »`);
  }
  // somme ÷ somme ≠ moyenne des pourcentages
  const e = ask(od, 'part des boursiers parmi les admis en BTS');
  const moyennePct = OD.filter(o => o.fili === 'BTS').reduce((t, o) => t + o.acc_bours / o.acc_neobac * 100, 0) / OD.filter(o => o.fili === 'BTS').length;
  assert(!proche(e.result.pct, moyennePct) && /et non la moyenne des pourcentages de chaque formation/.test(e.html), 'somme ÷ somme, et non la moyenne des pourcentages (la méthode est écrite)');
  assert(/même définition que la colonne officielle/.test(e.html), 'boursiers : définition officielle rappelée (parmi les admis néo-bacheliers)');
});

await describe('Parts de lignes : formations (open data) et candidats (fichier)', async () => {
  const n = pred => OD.filter(pred).length;
  let e = ask(od, 'quelle part des formations sont sélectives');
  assert(e.kind === 'part' && e.result.mode === 'lignes' && e.result.num === n(o => o.selectivite === 'formation sélective') && e.result.den === OD.length, `« part des formations sélectives » → ${n(o => o.selectivite === 'formation sélective')} / ${OD.length} (avant correction : 100 %)`);
  e = ask(od, 'proportion de formations privées en Gironde');
  assert(e.result.num === n(o => o.dep === 'Gironde' && o.statut !== 'Public') && e.result.den === n(o => o.dep === 'Gironde'), '« privées en Gironde » : condition privées, périmètre Gironde');
  e = ask(od, 'pourcentage de BTS publics');
  assert(e.result.num === n(o => o.fili === 'BTS' && o.statut === 'Public') && e.result.den === OD.length, '« % de BTS publics » : BTS publics sur toutes les formations (périmètre écrit)');
  const C = D.candidats(1200, 6);
  const c = pred => C.filter(pred).length;
  const ctx = await ctxCSV(D.versTableau(C, D.enTetes.complets));
  const cas = [
    ['part des boursiers', c(o => o.boursier === 'Oui'), C.length],
    ['taux de boursiers', c(o => o.boursier === 'Oui'), C.length],
    ['pourcentage de filles parmi les boursiers', c(o => o.boursier === 'Oui' && o.sexe === 'Féminin'), c(o => o.boursier === 'Oui')],
    ['part des boursiers parmi les filles en BTS', c(o => o.boursier === 'Oui' && o.sexe === 'Féminin' && o.groupe === 'BTS'), c(o => o.sexe === 'Féminin' && o.groupe === 'BTS')],
    ['proportion de candidats en BTS', c(o => o.groupe === 'BTS'), C.length],
    ["% d'apprentis", c(o => o.apprenti === 'Oui'), C.length],
  ];
  for (const [q, num, den] of cas) {
    const r = ask(ctx, q);
    assert(r && r.kind === 'part' && r.result.num === num && r.result.den === den, `fichier · « ${q} » → ${num} / ${den} (obtenu : ${r?.kind} ${r?.result?.num ?? r?.text ?? ''} / ${r?.result?.den ?? ''})`);
  }
  // avant : « pourcentage de filles parmi les boursiers » donnait une répartition par série de bac
  assert(ask(ctx, 'pourcentage de filles parmi les boursiers').plan.targetCol === null, 'plus de répartition parasite par série');
});

await describe('Arrêts : jamais un pourcentage inventé', async () => {
  const r = ask(od, 'part des formations en apprentissage');
  assert(r.kind === 'unresolved', 'open data sans colonne apprentissage → arrêt');
  const C = D.candidats(300, 2);
  const ctx = await ctxCSV(D.versTableau(C, D.enTetes.complets));
  const t = ask(ctx, 'taux de remplissage');
  assert(!t || t.kind !== 'part', 'fichier de candidats sans capacité : pas de « taux de remplissage » inventé');
  const vide = ctxOpenData(OD.map(o => ({ ...o, acc_neobac: '', acc_bours: '' })));
  const v = ask(vide, 'part des boursiers parmi les admis');
  assert(v.kind === 'unresolved', `colonnes vides : arrêt (aucun total), pas 0 % (obtenu : ${v.kind})`);
});

await describe('Ce qui ne devient pas une part (faux positifs)', () => {
  assert(ask(od, "taux d'accès moyen des CPGE").kind === 'stats', "« taux d'accès moyen » : statistique de la colonne, inchangé");
  assert(ask(od, 'répartition des formations par filière en pourcentage').kind === 'group_by', '« répartition … en pourcentage » : répartition, inchangé');
  const m = ask(od, 'pourcentage moyen de boursiers');
  assert(m.kind === 'stats' && m.plan.targetCol === "% d'admis néo bacheliers boursiers", `« pourcentage moyen de boursiers » : moyenne de la colonne des %, pas des effectifs (obtenu : ${m.plan?.targetCol})`);
  assert(ask(od, 'combien de BTS').kind === 'count' && ask(od, 'les formations les plus demandées').kind === 'classement', 'comptage et classement inchangés');
  assert(!run(od, 'isDataEngineQuestion')("quelle est la part de l'oral dans l'admission"), "« la part de l'oral dans l'admission » : question de connaissances → Albert");
});

await describe('Affichage, relance, export, Albert', () => {
  const ctx = ctxOpenData(OD);
  const e = ask(ctx, 'part des boursiers parmi les admis en BTS');
  assert(/Part — \d+,\d % \(admis boursiers\)/.test(e.html) && /Calcul exact/.test(e.html) && /Sur quoi porte ce calcul/.test(e.html), 'titre avec le %, badge « calcul exact », périmètre');
  const contexte = run(ctx, 'dataEngineResultToContext')(e);
  assert(new RegExp(`Part calculée par le widget : [\\d,]+ % \\(${e.result.num} admis boursiers sur ${e.result.den} admis néo-bacheliers\\)`).test(contexte), 'contexte Albert : pourcentage, numérateur et dénominateur');
  assert(run(ctx, 'verifierChiffresAlbert')(`<p>${(Math.round(e.result.pct * 10) / 10).toLocaleString('fr-FR')} % de boursiers.</p>`, [contexte]).inconnus.length === 0, 'Albert qui recopie le % : aucun chiffre signalé');
  const r = suite(ctx, 'et à Bordeaux ?');
  assert(r && r.kind === 'part' && r.result.num === S(o => o.fili === 'BTS' && o.commune === 'Bordeaux', o => o.acc_bours), `relance « et à Bordeaux ? » : même part, limitée à Bordeaux (obtenu : ${r?.kind})`);
  const x = run(ctx, 'currentExecutionToRows')(r);
  assert(x.length === 1 && x[0]['Part (%)'] === Math.round(r.result.pct * 10) / 10, 'export Excel : part, effectif, total');
  const g = run(ctx, 'renderCurrentChartExecution')({ sourceExecution: r, question: 'graphique' });
  assert(g && g.kind === 'part' && /<svg/.test(g.html), 'graphique : camembert part / reste');
  assert(run(ctx, 'shouldAnswerLocallyWithoutAlbert')(e), 'réponse donnée par le widget, sans Albert');
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
