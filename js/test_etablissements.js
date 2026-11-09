// test_etablissements.js — Questions sur les établissements.
// Essai sur l'open data réel (09/11/2026) : « formations à l'université de Bordeaux » → 8 (le mot « université »
// cherché dans les intitulés de formation), « combien d'établissements dans l'académie de Bordeaux » → 631 (des
// formations), « formations dans les lycées de Bordeaux » → 0, « lycée Montaigne », « IUT », « Saint-Genès » → arrêt.
// Désormais : filtre sur le nom de l'établissement (expression exacte, puis tous les mots ; homonymes listés),
// type d'établissement (« les lycées »), et comptage d'établissements différents (« combien de lycées proposent… »).
// node js/test_etablissements.js

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
const valeur = e => e?.kind === 'count' ? e.result.count : e?.kind === 'sum' ? e.result.sum : e?.kind === 'stats' ? e.result.avg : e?.kind === 'unresolved' ? 'arrêt' : `${e?.kind}`;
const perim = (ctx, e) => run(ctx, 'perimetreResultat')(e.kind, e.plan, e.result).texte;

// ─── Open data simulé, établissements nommés comme dans les vraies données ────────────────────────────────
const OD = D.openData(4000, 9).map((o, i) => {
  const r = { ...o };
  if (o.fili === 'BTS' && o.commune === 'Bordeaux') r.etab = i % 3 === 0 ? 'Lycée Gustave Eiffel' : i % 3 === 1 ? 'Lycée Montaigne' : 'Lycée Saint-Genès';
  else if (o.fili === 'BTS' && o.commune === 'Lille') r.etab = 'Lycée Gustave Eiffel'; // homonyme dans une autre ville
  else if (o.fili === 'BTS' && o.commune === 'Mont-de-Marsan') r.etab = 'Lycée Michel De Montaigne';
  else if (o.fili === 'CPGE' && o.aca === 'Bordeaux') r.etab = 'Lycée Camille Jullian';
  else if ((o.fili === 'Licence' || o.fili === 'PASS') && o.aca === 'Bordeaux') r.etab = i % 2 ? 'Université de Bordeaux - Bordeaux Métropole' : 'Université Bordeaux Montaigne';
  else if (o.fili === 'BUT' && o.aca === 'Bordeaux') r.etab = i % 2 ? 'IUT Bordeaux Montaigne' : 'I.U.T de Bordeaux - Site de Gradignan'; // sigle avec des points, comme dans les vraies données
  return r;
});
const n = pred => OD.filter(pred).length;
// un établissement = un nom dans une commune (homonymes de villes différentes comptés à part)
const distinct = pred => new Set(OD.filter(pred).map(o => `${o.etab}|${o.commune}`)).size;

await describe('Un établissement nommé', () => {
  const ctx = ctxOpenData(OD);
  const cas = [
    ['combien de formations au lycée Montaigne', n(o => o.etab === 'Lycée Montaigne'), 'expression exacte : « Lycée Montaigne » (pas « Lycée Michel De Montaigne »)'],
    ['combien de formations au lycée Michel Montaigne', n(o => o.etab === 'Lycée Michel De Montaigne'), 'tous les mots : « Lycée Michel De Montaigne »'],
    ['combien de formations à l\'université de Bordeaux', n(o => o.etab.startsWith('Université de Bordeaux')), 'université de Bordeaux (avant : le mot « université » dans les intitulés)'],
    ['combien de candidats à l\'université Bordeaux Montaigne', OD.filter(o => o.etab === 'Université Bordeaux Montaigne').reduce((t, o) => t + o.voe, 0), 'université Bordeaux Montaigne, somme des candidats'],
    ['combien de BUT à l\'IUT Bordeaux Montaigne', n(o => o.etab === 'IUT Bordeaux Montaigne' && o.fili === 'BUT'), 'IUT Bordeaux Montaigne'],
    ['combien de BUT à l\'IUT de Bordeaux', n(o => o.etab === 'I.U.T de Bordeaux - Site de Gradignan'), '« IUT de Bordeaux » trouve « I.U.T de Bordeaux - Site de Gradignan » (sigle avec des points)'],
    ['combien de BTS au lycée Saint-Genès', n(o => o.etab === 'Lycée Saint-Genès' && o.fili === 'BTS'), 'lycée Saint-Genès (trait d\'union)'],
    ['combien de places à l\'université de Bordeaux', OD.filter(o => o.etab.startsWith('Université de Bordeaux')).reduce((t, o) => t + o.capa, 0), 'places à l\'université de Bordeaux'],
  ];
  cas.forEach(([q, attendu, libelle]) => { const e = ask(ctx, q); assert(attendu > 0 && valeur(e) === attendu, `${libelle} : ${attendu} (obtenu : ${valeur(e)})`); });
  const cj = ask(ctx, 'combien de formations au lycée Camille Jullian de Bordeaux');
  assert(valeur(cj) === n(o => o.etab === 'Lycée Camille Jullian' && o.aca === 'Bordeaux') && cj.plan.filters.some(f => /Académie/.test(f.col)), '« lycée Camille Jullian de Bordeaux » : « Bordeaux » est le lieu (le nom ne le contient pas), filtre de lieu gardé');
  const lm = ask(ctx, 'combien de formations au lycée Michel De Montaigne dans l\'académie de Toulouse');
  assert(valeur(lm) === 0 && /l'établissement existe ailleurs : Lycée Michel De Montaigne \(Mont-de-Marsan\)/.test(perim(ctx, lm)), '0 avec un autre lieu : le périmètre dit où se trouve l\'établissement');
  const u = ask(ctx, 'combien de formations à l\'université de Bordeaux');
  assert(!u.plan.filters.some(f => /Académie|Commune/.test(f.col) && /Bordeaux/.test(f.value)), '« Bordeaux » fait partie du nom : pas un filtre de lieu en plus');
  assert(/« Établissement » : « Université de Bordeaux - Bordeaux Métropole »/.test(perim(ctx, u)), 'le périmètre nomme l\'établissement retenu');
  const t = ask(ctx, "taux d'accès moyen à l'université de Bordeaux");
  assert(t?.kind === 'stats', 'moyenne sur un établissement');
});

await describe('Homonymes : listés, et la commune les départage', () => {
  const ctx = ctxOpenData(OD);
  const e = ask(ctx, 'combien de BTS au lycée Gustave Eiffel');
  assert(valeur(e) === n(o => o.etab === 'Lycée Gustave Eiffel' && o.fili === 'BTS'), 'les deux « Lycée Gustave Eiffel » (Bordeaux et Lille) comptés');
  assert(/2 établissements correspondent : Lycée Gustave Eiffel \(Bordeaux\) ; Lycée Gustave Eiffel \(Lille\)|2 établissements correspondent : Lycée Gustave Eiffel \(Lille\) ; Lycée Gustave Eiffel \(Bordeaux\)/.test(perim(ctx, e)), 'le périmètre liste chaque homonyme avec sa commune');
  const b = ask(ctx, 'combien de BTS au lycée Gustave Eiffel à Bordeaux');
  assert(valeur(b) === n(o => o.etab === 'Lycée Gustave Eiffel' && o.fili === 'BTS' && o.commune === 'Bordeaux'), '« à Bordeaux » : le lycée de Bordeaux seulement');
});

await describe('Type d\'établissement : « les lycées », « les universités »', () => {
  const ctx = ctxOpenData(OD);
  const l = ask(ctx, 'combien de formations dans les lycées de Bordeaux');
  // « de Bordeaux » = l'académie, comme ailleurs dans le widget (le périmètre le dit) ; « à Bordeaux » = la commune
  assert(valeur(l) === n(o => /^Lycée/.test(o.etab) && o.aca === 'Bordeaux'), `lycées de Bordeaux (avant : 0) : ${n(o => /^Lycée/.test(o.etab) && o.aca === 'Bordeaux')} (obtenu : ${valeur(l)})`);
  assert(/Académie de l'établissement » = Bordeaux/.test(perim(ctx, l)) && /nom contenant « lycée »/.test(perim(ctx, l)), 'le périmètre dit « académie de Bordeaux » et « nom contenant lycée »');
  const la = ask(ctx, 'combien de formations dans les lycées à Bordeaux');
  assert(valeur(la) === n(o => /^Lycée/.test(o.etab) && o.commune === 'Bordeaux'), '« à Bordeaux » : la commune');
  const lp = ask(ctx, 'combien de BTS dans les lycées publics');
  assert(valeur(lp) === n(o => /Lycée/.test(o.etab) && o.fili === 'BTS' && o.statut === 'Public'), 'lycées publics : « publics » est un qualificatif, pas un nom');
});

await describe('Compter des établissements, pas des formations', () => {
  const ctx = ctxOpenData(OD);
  const a = ask(ctx, "combien d'établissements dans l'académie de Bordeaux");
  assert(a?.kind === 'count' && a.result.etablissements && valeur(a) === distinct(o => o.aca === 'Bordeaux'), `établissements de l'académie de Bordeaux : ${distinct(o => o.aca === 'Bordeaux')} (avant : ${n(o => o.aca === 'Bordeaux')} formations ; obtenu : ${valeur(a)})`);
  assert(a.result.formations === n(o => o.aca === 'Bordeaux'), 'le nombre de formations est donné à côté');
  assert(/établissements différents/.test(a.html) && /pas des formations/.test(perim(ctx, a)), 'le texte et le périmètre disent « établissements, pas formations »');
  assert(/établissement\(s\) différent\(s\)/.test(run(ctx, 'dataEngineResultToContext')(a)), 'Albert est prévenu');
  assert(/établissements/.test(run(ctx, 'extractBlockTitle')(a, '')), 'titre du bloc en établissements');
  const p = ask(ctx, "combien d'établissements privés dans l'académie de Bordeaux");
  assert(valeur(p) === distinct(o => o.aca === 'Bordeaux' && o.statut !== 'Public'), 'établissements privés de l\'académie');
  const m = ask(ctx, "combien d'établissements proposent un BTS MCO dans l'académie de Bordeaux");
  assert(valeur(m) === distinct(o => o.aca === 'Bordeaux' && o.detail === 'Management Commercial Opérationnel'), 'établissements proposant un BTS MCO (avant : nombre de BTS MCO)');
  const ly = ask(ctx, 'combien de lycées proposent des BTS en Gironde');
  assert(valeur(ly) === distinct(o => /Lycée/.test(o.etab) && o.fili === 'BTS' && o.dep === 'Gironde'), 'lycées proposant des BTS en Gironde (avant : arrêt)');
  const h = ask(ctx, 'combien de lycées Gustave Eiffel');
  assert(valeur(h) === 2, `homonymes : « Lycée Gustave Eiffel » de Bordeaux et de Lille = 2 établissements (obtenu : ${valeur(h)})`);
  const g = ask(ctx, "nombre d'établissements par académie");
  const bdx = (g?.result?.rows || []).find(r => r.value === 'Bordeaux');
  assert(g?.kind === 'group_by' && g.result.etablissements && bdx?.count === distinct(o => o.aca === 'Bordeaux'), 'par académie : établissements différents de chaque académie');
  assert(/établissement/.test(g.html) && /nombre d'établissements différents par groupe/.test(perim(ctx, g)), 'répartition en établissements, dit clairement');
});

await describe('Établissement introuvable : arrêt avec des noms proches', () => {
  const ctx = ctxOpenData(OD);
  const e = ask(ctx, 'combien de formations au lycée Montesquieu');
  assert(e?.kind === 'unresolved' && /Établissement non trouvé/.test(e.html), 'arrêt « établissement non trouvé »');
  const p = ask(ctx, 'combien de formations au lycée Michel Eyquem de Montaigne');
  assert(p?.kind === 'unresolved' && /Lycée Michel De Montaigne|Lycée Montaigne/.test(p.html), 'noms proches proposés');
});

await describe('Faux positifs : rien ne change sans établissement', () => {
  const ctx = ctxOpenData(OD);
  const cas = [
    ['combien de BTS', n(o => o.fili === 'BTS')],
    ['combien de BTS en établissement public', n(o => o.fili === 'BTS' && o.statut === 'Public')],
    ['combien de formations à Bordeaux', n(o => o.commune === 'Bordeaux')],
    ["combien de formations dans l'académie de Bordeaux", n(o => o.aca === 'Bordeaux')],
    ['combien de licences', n(o => o.fili === 'Licence')],
  ];
  cas.forEach(([q, attendu]) => { const e = ask(ctx, q); assert(valeur(e) === attendu && !e.plan.etablissement && !e.result.etablissements, `« ${q} » : ${attendu} formations (obtenu : ${valeur(e)})`); });
  const top = ask(ctx, 'les établissements avec le plus de formations');
  assert(top && top.kind !== 'unresolved', '« les établissements avec le plus de formations » : toujours calculé');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
