// test_taux_acces.js — Questions sur le taux d'accès.
// Essai sur l'open data réel (09/11/2026) :
// - « taux d'accès moyen par académie / par filière » → une seule moyenne nationale (le « par » était ignoré) ;
// - « taux d'accès médian / minimum / maximum » → réponse résumée par la moyenne ;
// - « taux d'accès des PASS », « … au lycée Montaigne » → non traitées par le moteur (envoyées à Albert) ;
// - taux d'accès de 0 (aucune proposition Parcoursup) écartés des classements mais comptés dans les moyennes.
// node js/test_taux_acces.js

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

function makeCtx() {
  const noopEl = () => null;
  const ctx = {
    console: { ...console, log() {}, warn() {}, info() {} }, setTimeout: () => null, clearTimeout() {}, URLSearchParams, TextDecoder, TextEncoder,
    document: { getElementById: noopEl, querySelector: noopEl, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, fetch: () => Promise.reject(new Error('hors ligne')),
    escapeHtml: s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  };
  ctx.XLSX = { utils: { json_to_sheet: () => ({}), book_new: () => ({}), book_append_sheet() {}, sheet_to_csv: () => '' }, writeFile() {} };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.selectedDocIds = new Set();
  vm.createContext(ctx);
  for (const f of ['config.js', 'knowledge.js', 'documents.js', 'planner.js', 'dataEngine.js', 'sessions.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
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
function ask(ctx, q) {
  run(ctx, 'window.__DATA_ENGINE_STATE = { lastPlan: null, lastExecution: null, history: [] }');
  ctx.__q = q;
  const plan = run(ctx, 'isDataEngineQuestion(__q)') ? run(ctx, 'detectDataEnginePlan(__q)') : null;
  return plan ? run(ctx, 'runDataEnginePlan')(plan, []) : null;
}
const perim = (ctx, e) => run(ctx, 'perimetreResultat')(e.kind, e.plan, e.result).texte;
const proche = (a, b) => a !== null && b !== null && Math.abs(a - b) < 1e-9;

// Open data simulé : quelques formations sans proposition (taux d'accès 0), un lycée à une seule formation
const OD = D.openData(4000, 13).map((o, i) => ({
  ...o,
  taux: i % 61 === 0 ? 0 : o.taux,
  etab: o.fili === 'CPGE' && o.commune === 'Bordeaux' && i % 2 === 0 ? 'Lycée Montaigne' : o.etab,
}));
const stat = (pred, f = o => o.taux) => {
  const v = OD.filter(pred).map(f).filter(x => x !== 0).sort((a, b) => a - b);
  const n = v.length;
  return { n, avg: v.reduce((a, b) => a + b, 0) / n, median: n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2, min: v[0], max: v[n - 1], nuls: OD.filter(pred).filter(o => f(o) === 0).length };
};
const cpge = o => o.fili === 'CPGE';

await describe('Moyenne, médiane, minimum, maximum : la statistique demandée', () => {
  const ctx = ctxOpenData(OD);
  const S = stat(cpge);
  for (const [q, k, nom] of [["taux d'accès moyen des CPGE", 'avg', 'moyenne'], ["taux d'accès médian des CPGE", 'median', 'médiane'], ["taux d'accès minimum des CPGE", 'min', 'minimum'], ["taux d'accès maximum des CPGE", 'max', 'maximum']]) {
    const e = ask(ctx, q);
    assert(e?.kind === 'stats' && e.result.demandee === k && proche(e.result[k], S[k]), `« ${q} » : ${nom} = ${S[k]} (obtenu : ${e?.result?.[k]})`);
    assert(new RegExp(`${nom} : `).test(e.html) && new RegExp(`${nom}`).test(e.text), `le titre et le texte donnent la ${nom}`);
  }
});

await describe('Taux d\'accès de 0 (aucune proposition) écartés des moyennes, comme des classements', () => {
  const ctx = ctxOpenData(OD);
  const S = stat(cpge);
  const e = ask(ctx, "taux d'accès moyen des CPGE");
  assert(S.nuls > 0 && e.result.tauxNuls === S.nuls && e.result.numericCount === S.n, `${S.nuls} CPGE au taux de 0 écartées, moyenne sur ${S.n}`);
  assert(/au taux d'accès de 0 \(aucune proposition d'admission par Parcoursup\) écartée/.test(perim(ctx, e)), 'le périmètre le dit');
  const c = ask(ctx, 'capacité moyenne des CPGE');
  assert(c?.kind === 'stats' && !c.result.tauxNuls && c.result.numericCount === OD.filter(cpge).length, 'faux positif : une autre colonne (capacité) n\'écarte rien');
});

await describe('Par académie, par filière : une statistique par groupe', () => {
  const ctx = ctxOpenData(OD);
  const e = ask(ctx, "taux d'accès moyen par académie");
  assert(e?.kind === 'stats_groupes' && /Académie/.test(e.result.dim), `une moyenne par académie (avant : une seule moyenne nationale ; obtenu : ${e?.kind})`);
  const bdx = e.result.groupes.find(g => g.valeur === 'Bordeaux');
  const Sb = stat(o => o.aca === 'Bordeaux');
  assert(bdx && proche(bdx.avg, Sb.avg) && bdx.numericCount === Sb.n, `Bordeaux : moyenne ${Sb.avg.toFixed(2)} sur ${Sb.n} formations`);
  const moy = e.result.groupes.map(g => g.avg);
  assert(moy.every((v, i) => i === 0 || moy[i - 1] >= v), 'groupes triés par moyenne décroissante');
  assert(proche(e.result.ensemble.avg, stat(() => true).avg), 'ligne « Ensemble » = moyenne de toutes les formations');
  assert(/non pondérée/.test(e.html) && /Moyenne/.test(e.html) && /Médiane/.test(e.html), 'tableau moyenne / médiane / min / max, « moyenne simple, non pondérée »');
  const f = ask(ctx, "taux d'accès moyen par filière");
  const bts = f?.result?.groupes?.find(g => g.valeur === 'BTS');
  assert(f?.kind === 'stats_groupes' && bts && proche(bts.avg, stat(o => o.fili === 'BTS').avg), 'par filière : une moyenne par filière (BTS juste)');
  const m = ask(ctx, "taux d'accès médian des BTS par académie");
  assert(m?.kind === 'stats_groupes' && m.result.demandee === 'median' && proche(m.result.groupes.find(g => g.valeur === 'Lyon').median, stat(o => o.fili === 'BTS' && o.aca === 'Lyon').median), 'médiane des BTS par académie : filtre et statistique demandée');
  assert(/Statistiques de « Taux d'accès » par « Académie/.test(run(ctx, 'dataEngineResultToContext')(e)), 'Albert reçoit le tableau');
  const ex = run(ctx, 'currentExecutionToRows')(e);
  assert(ex.length === e.result.groupes.length && 'Moyenne' in ex[0] && 'Médiane' in ex[0], 'export : une ligne par académie');
  const g = run(ctx, 'renderCurrentChartExecution')({ question: 'graphique', tool: 'chart_current', sourceExecution: e });
  assert(g?.kind === 'stats_groupes' && /Graphique/.test(g.html), 'graphique des moyennes');
  assert(run(ctx, 'shouldAnswerLocallyWithoutAlbert')(e) === true, 'réponse locale');
});

await describe('« taux d\'accès des PASS », « … au lycée Montaigne » : calculés par le moteur', () => {
  const ctx = ctxOpenData(OD);
  const p = ask(ctx, "taux d'accès des PASS");
  assert(p?.kind === 'stats' && proche(p.result.avg, stat(o => o.fili === 'PASS').avg), 'taux d\'accès des PASS : moyenne des PASS (avant : envoyé à Albert)');
  const montaigne = OD.filter(o => o.etab === 'Lycée Montaigne' && o.taux !== 0);
  const l = ask(ctx, "taux d'accès au lycée Montaigne");
  assert(l?.kind === 'stats' && proche(l.result.avg, montaigne.reduce((t, o) => t + o.taux, 0) / montaigne.length), 'taux d\'accès au lycée Montaigne');
  // une seule formation : sa valeur, et laquelle
  const seule = [{ ...OD[0], etab: 'Lycée Unique', fili: 'BTS', taux: 42.5 }, ...OD.slice(1).filter(o => o.etab !== 'Lycée Unique')];
  const c1 = ctxOpenData(seule);
  const u = ask(c1, "taux d'accès au lycée Unique");
  assert(u?.kind === 'stats' && u.result.numericCount === 1 && u.result.avg === 42.5 && /Une seule formation correspond/.test(u.html) && /Lycée Unique/.test(u.html), 'une seule formation : sa valeur et son nom');
});

await describe('Faux positifs : comptages, classements et parts inchangés', () => {
  const ctx = ctxOpenData(OD);
  const c = ask(ctx, "combien de formations ont un taux d'accès inférieur à 20 %");
  assert(c?.kind === 'count' && c.result.count === OD.filter(o => o.taux < 20).length, 'combien … taux d\'accès inférieur à 20 % : comptage (taux 0 compris, c\'est la condition)');
  const s = ask(ctx, 'les formations les plus sélectives');
  assert(s?.kind === 'classement', 'les plus sélectives : classement');
  const r = ask(ctx, 'taux de remplissage des BTS');
  assert(r?.kind === 'part', 'taux de remplissage : part');
  const pa = ask(ctx, 'capacité moyenne des BTS par académie');
  assert(pa?.kind === 'stats_groupes' && proche(pa.result.groupes.find(g => g.valeur === 'Paris').avg, OD.filter(o => o.fili === 'BTS' && o.aca === 'Paris').reduce((t, o) => t + o.capa, 0) / OD.filter(o => o.fili === 'BTS' && o.aca === 'Paris').length), 'capacité moyenne des BTS par académie : aussi par groupe');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
