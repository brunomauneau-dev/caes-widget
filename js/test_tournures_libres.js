// test_tournures_libres.js — Tournures libres : politesse, fautes, numéros de département, négations, relances.
// Essai sur l'open data réel (09/11/2026), chiffres faux en silence :
// - « j'aimerais savoir le nombre de formations en licence à Bordeaux » → 0 (« savoir » pris pour un intitulé) ;
// - « combien de formations ne sont pas sélectives dans l'académie de Bordeaux » → 3 088 HORS Bordeaux
//   (le « non » de « non sélectives » appliqué à l'académie) ;
// - « combien de BTS dans le 33 » → 5 351 (tous les BTS) ;
// - « taux d'accès moyen des BTS » puis « et par académie ? » → nombre de BTS par académie.
// Et des questions laissées à Albert ou arrêtées : politesse, « conbien », « y a-t-il des … », « et l'an dernier ? »,
// « lesquelles sont à Bordeaux ? », « et pour les CPGE ? » après une moyenne.
// node js/test_tournures_libres.js

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
// Deux sessions (2025 courante, 2024 pour « l'an dernier »), colonnes rapprochées par leur nom technique
const OD25 = D.openData(3000, 17);
const OD24 = D.openData(2700, 18).map(o => ({ ...o, session: 2024 }));
const avecChamps = t => { const cles = Object.keys(D.OD); return { ...t, champs: Object.fromEntries(cles.map(k => [D.OD[k], D.OD_API[k]])), libelles: Object.fromEntries(cles.map(k => [D.OD_API[k], D.OD[k]])) }; };
function ctxOD() {
  const ctx = makeCtx();
  ctx.__t25 = { ...avecChamps(D.tableOpenData(OD25)), session: 2025 };
  ctx.__t24 = { ...avecChamps(D.tableOpenData(OD24, 'Parcoursup 2024')), session: 2024, isDefault: false };
  run(ctx, "defaultOpenDataTable = __t25; defaultOpenDataState = 'ready'; openDataSessions.set(2024, __t24);");
  return ctx;
}
const neuf = ctx => run(ctx, 'window.__DATA_ENGINE_STATE = { lastPlan: null, lastExecution: null, history: [] }');
// question posée dans la conversation en cours (la précédente est gardée)
function suite(ctx, q) {
  ctx.__q = q;
  const plan = run(ctx, 'isDataEngineQuestion(__q)') ? run(ctx, 'detectDataEnginePlan(__q)') : null;
  return plan ? run(ctx, 'runDataEnginePlan')(plan, []) : null;
}
const ask = (ctx, q) => { neuf(ctx); return suite(ctx, q); };
const valeur = e => e?.kind === 'count' ? e.result.count : e?.kind === 'sum' ? e.result.sum : e?.kind === 'stats' ? e.result.avg : e?.kind === 'part' ? Math.round(e.result.pct * 10) / 10 : e?.kind === 'unresolved' ? 'arrêt' : e ? e.kind : 'Albert';
const n = pred => OD25.filter(pred).length;
const moy = (L, pred) => { const v = L.filter(pred).map(o => o.taux).filter(x => x !== 0); return v.reduce((a, b) => a + b, 0) / v.length; };
const proche = (a, b) => typeof a === 'number' && Math.abs(a - b) < 1e-9;

await describe('Politesse et verbes d\'intention : jamais des mots d\'intitulé', () => {
  const ctx = ctxOD();
  const cas = [
    ["Bonjour, pourriez-vous me dire combien il y a de BTS dans l'académie de Bordeaux s'il vous plaît ?", n(o => o.fili === 'BTS' && o.aca === 'Bordeaux')],
    ["j'aimerais savoir le nombre de formations en licence à Bordeaux", n(o => o.fili === 'Licence' && o.commune === 'Bordeaux')],
    ['dis moi combien de PASS il y a en France', n(o => o.fili === 'PASS')],
    ['je souhaiterais connaître le nombre de CPGE', n(o => o.fili === 'CPGE')],
    ['merci de m\'indiquer combien de BUT il y a', n(o => o.fili === 'BUT')],
  ];
  cas.forEach(([q, attendu]) => assert(valeur(ask(ctx, q)) === attendu, `« ${q} » : ${attendu} (obtenu : ${valeur(ask(ctx, q))})`));
  const p = ask(ctx, 'Je voudrais connaître la part de boursiers parmi les admis en licence');
  assert(p?.kind === 'part', `« je voudrais connaître la part … » : une part (obtenu : ${valeur(p)})`);
});

await describe('Fautes de frappe et « y a-t-il »', () => {
  const ctx = ctxOD();
  assert(valeur(ask(ctx, 'conbien de BTS')) === n(o => o.fili === 'BTS'), '« conbien de BTS »');
  assert(valeur(ask(ctx, 'combein de licences')) === n(o => o.fili === 'Licence'), '« combein de licences »');
  const y = ask(ctx, 'y a-t-il des BTS dans l\'académie de Limoges ?');
  assert(y?.kind === 'count' && y.result.count === n(o => o.fili === 'BTS' && o.aca === 'Limoges'), '« y a-t-il des BTS dans l\'académie de Limoges ? » : un comptage');
  assert(valeur(ask(ctx, 'existe-t-il des PASS dans l\'académie de Poitiers ?')) === n(o => o.fili === 'PASS' && o.aca === 'Poitiers'), '« existe-t-il des … »');
});

await describe('Négation : sur le bon mot', () => {
  const ctx = ctxOD();
  const ns = o => o.selectivite === 'formation non sélective';
  const e = ask(ctx, "combien de formations ne sont pas sélectives dans l'académie de Bordeaux");
  assert(valeur(e) === n(o => ns(o) && o.aca === 'Bordeaux'), `« ne sont pas sélectives dans l'académie de Bordeaux » : dans l'académie (avant : hors) — ${n(o => ns(o) && o.aca === 'Bordeaux')} (obtenu : ${valeur(e)})`);
  assert(valeur(ask(ctx, "combien de formations non sélectives dans l'académie de Bordeaux")) === n(o => ns(o) && o.aca === 'Bordeaux'), '« non sélectives dans l\'académie de Bordeaux »');
  // les vraies exclusions restent des exclusions
  for (const q of ["combien de formations hors académie de Bordeaux", "combien de formations qui ne sont pas dans l'académie de Bordeaux", "combien de formations non situées dans l'académie de Bordeaux", "combien de formations pas dans l'académie de Bordeaux"]) {
    assert(valeur(ask(ctx, q)) === n(o => o.aca !== 'Bordeaux'), `faux positif : « ${q} » reste une exclusion`);
  }
});

await describe('Numéros de département', () => {
  const ctx = ctxOD();
  assert(valeur(ask(ctx, 'combien de BTS dans le 33')) === n(o => o.fili === 'BTS' && o.dep === 'Gironde'), '« dans le 33 » = Gironde (avant : tous les BTS)');
  assert(valeur(ask(ctx, 'combien de formations du 64')) === n(o => o.dep === 'Pyrénées-Atlantiques'), '« du 64 » = Pyrénées-Atlantiques');
  assert(valeur(ask(ctx, 'combien de BTS dans le département 40')) === n(o => o.fili === 'BTS' && o.dep === 'Landes'), '« département 40 » = Landes');
  const R = run(ctx, 'reformulerQuestion');
  for (const q of ['les 10 formations les plus demandées', 'combien de formations de plus de 33 places', 'combien de BTS en 2024', 'les 33 premières formations', 'combien de formations dans le 33e arrondissement']) {
    assert(!/Gironde/.test(R(q)), `faux positif : « ${q} » inchangé (${R(q)})`);
  }
});

await describe('Relances après une moyenne : la mesure est gardée', () => {
  const ctx = ctxOD();
  neuf(ctx);
  const a = suite(ctx, "taux d'accès moyen des BTS");
  assert(a?.kind === 'stats' && proche(a.result.avg, moy(OD25, o => o.fili === 'BTS')), 'taux d\'accès moyen des BTS');
  const b = suite(ctx, 'et par académie ?');
  const bdx = b?.result?.groupes?.find(g => g.valeur === 'Bordeaux');
  assert(b?.kind === 'stats_groupes' && bdx && proche(bdx.avg, moy(OD25, o => o.fili === 'BTS' && o.aca === 'Bordeaux')), `« et par académie ? » : taux moyen des BTS par académie (avant : nombre de BTS par académie ; obtenu : ${b?.kind})`);
  const c = suite(ctx, 'et pour les CPGE ?');
  const cl = c?.result?.groupes?.find(g => g.valeur === 'Lyon');
  assert(c?.kind === 'stats_groupes' && cl && proche(cl.avg, moy(OD25, o => o.fili === 'CPGE' && o.aca === 'Lyon')), `« et pour les CPGE ? » : CPGE, par académie, même mesure (obtenu : ${c?.kind})`);
  neuf(ctx);
  suite(ctx, "taux d'accès médian des licences");
  const d = suite(ctx, 'et pour les BUT ?');
  assert(d?.kind === 'stats' && d.result.demandee === 'median', '« et pour les BUT ? » après une médiane : la médiane');
  neuf(ctx);
  suite(ctx, 'combien de places en BTS');
  const e = suite(ctx, 'et par académie ?');
  const pb = e?.result?.rows?.find(r => r.value === 'Bordeaux');
  assert(e?.kind === 'group_by' && e.result.somme && pb?.count === OD25.filter(o => o.fili === 'BTS' && o.aca === 'Bordeaux').reduce((t, o) => t + o.capa, 0), '« combien de places en BTS » puis « et par académie ? » : places par académie (pas des formations)');
});

await describe('« lesquelles sont à Bordeaux ? »', () => {
  const ctx = ctxOD();
  neuf(ctx);
  suite(ctx, 'combien de BTS dans l\'académie de Bordeaux');
  const l = suite(ctx, 'lesquelles sont à Bordeaux ?');
  const attendu = new Set(OD25.filter(o => o.fili === 'BTS' && o.commune === 'Bordeaux').map(o => o.etab));
  assert(l?.kind === 'group_by' && /Établissement/.test(l.plan.targetCol) && l.result.total === n(o => o.fili === 'BTS' && o.commune === 'Bordeaux'), `les BTS à Bordeaux, détaillés par établissement (obtenu : ${l?.kind} ${l?.plan?.targetCol})`);
  assert(l.result.rows.every(r => attendu.has(r.value)), 'uniquement les établissements de ces BTS');
  // aucune formation dans la commune : la liste est vide, et le périmètre dit combien il y en a dans l'académie
  neuf(ctx);
  const lignes0 = OD25.map(o => o.fili === 'PASS' && o.commune === 'Bordeaux' ? { ...o, commune: 'Talence' } : o);
  const c0 = makeCtx(); c0.__t = D.tableOpenData(lignes0); run(c0, "defaultOpenDataTable = __t; defaultOpenDataState = 'ready';");
  neuf(c0); suite(c0, 'combien de PASS'); const v = suite(c0, 'lesquels sont à Bordeaux ?');
  const nAca = lignes0.filter(o => o.fili === 'PASS' && o.aca === 'Bordeaux').length;
  assert(v?.kind === 'group_by' && v.result.total === 0 && run(c0, 'perimetreResultat')(v.kind, v.plan, v.result).texte.includes(`mais ${nAca} dans l'académie de Bordeaux`), 'liste vide à Bordeaux : « mais N dans l\'académie de Bordeaux »');
});

await describe('« et l\'an dernier ? » : la même question sur la session précédente', () => {
  const ctx = ctxOD();
  neuf(ctx);
  const a = suite(ctx, 'combien de places en BTS');
  const b = suite(ctx, "et l'an dernier ?");
  const p24 = OD24.filter(o => o.fili === 'BTS').reduce((t, o) => t + o.capa, 0);
  assert(a?.kind === 'sum' && b?.kind === 'sum' && b.result.sum === p24 && /session 2024/.test(b.html), `« et l'an dernier ? » : places en BTS en 2024 = ${p24} (avant : envoyé à Albert ; obtenu : ${valeur(b)})`);
  neuf(ctx);
  suite(ctx, "taux d'accès moyen des CPGE");
  const c = suite(ctx, 'et en 2024 ?');
  assert(c?.kind === 'stats' && proche(c.result.avg, moy(OD24, o => o.fili === 'CPGE')), '« et en 2024 ? » après une moyenne');
  neuf(ctx);
  assert(suite(ctx, "et l'an dernier ?") === null || !run(ctx, 'isDataEngineQuestion("et l\'an dernier ?")'), 'faux positif : sans question précédente, rien n\'est inventé');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
