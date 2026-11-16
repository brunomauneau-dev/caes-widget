// test_formulations_banc.js — Banc de formulations : des questions écrites « comme on les écrit » (cmb, nb, « ont été
// confirmés », « où peut-on faire », « donne moi les établissements avec », sans accents, singulier / pluriel, sigles
// BTS MCO, BUT info, DNMADE, prépas éco…), croisant filière × lieu × statut × objet (nombre, places, vœux, admis,
// liste d'établissements). Vérité recalculée sur les lignes. Règle : réponse juste ou arrêt — jamais un autre chiffre.
// Erreurs trouvées et corrigées (v27.5.86) :
// (essai retiré : écarter les libellés de regroupement « partagés » — cas STAPS des données fictives — cassait
//  « licences de droit » sur l'open data réel ; test de non-régression ci-dessous)
// - « prépas éco sélectifs » : un classement (« classe » de « classe préparatoire » lu comme « classer ») ;
// - « où peut-on faire un… », « donne moi les établissements avec… », « dans quels établissements trouve-t-on… » : arrêt ;
// - « BUT info », « DN MADE », « ont ete confirmes » (sans accents) : arrêt.
// Données FICTIVES (js/fixtures/donnees_simulees.mjs). node js/test_formulations_banc.js

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
  ctx.XLSX = { utils: { json_to_sheet: () => ({}), book_new: () => ({}), book_append_sheet() {}, sheet_to_csv: () => '', sheet_to_json: () => [], aoa_to_sheet: () => ({}) }, writeFile() {} };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.selectedDocIds = new Set();
  vm.createContext(ctx);
  for (const f of ['config.js', 'knowledge.js', 'documents.js', 'planner.js', 'dataEngine.js', 'sessions.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
  ctx.resetContextSilent = () => {};
  return ctx;
}
const run = (ctx, code) => vm.runInContext(code, ctx);
const asker = ctx => (q, suite = false) => {
  if (!suite) run(ctx, 'window.__DATA_ENGINE_STATE = { lastPlan: null, lastExecution: null, history: [] }');
  ctx.__q = q;
  const plan = run(ctx, 'isDataEngineQuestion(__q)') ? run(ctx, 'detectDataEnginePlan(__q)') : null;
  return plan ? run(ctx, 'runDataEnginePlan')(plan, []) : null;
};

// valeur rendue par le moteur, sous une forme comparable à la vérité calculée
function valeur(e) {
  if (!e) return 'pas de calcul';
  if (e.kind === 'unresolved') return 'arrêt';
  if (e.kind === 'count') return e.result.count;
  if (e.kind === 'sum') return e.result.sum;
  if (e.kind === 'stats') return Math.round(e.result.avg * 100) / 100;
  if (e.kind === 'part') return `${e.result.num}/${e.result.den}`;
  if (e.kind === 'group_by' || e.kind === 'top') return Object.fromEntries((e.result.rows || []).map(r => [r.value, r.count]));
  return e.kind;
}

// ── Générateur de questions « comme on les écrit » et vérité calculée sur les lignes ──
const OD = D.openData(4000, 23);
const co = makeCtx(); co.__t = D.tableOpenData(OD);
run(co, "defaultOpenDataTable = __t; defaultOpenDataState = 'ready';");
const ask = asker(co);
const ALT = { 'STAPS': o => o.fil_det === 'Licence - Sciences pour la santé', 'licence psycho': o => o.fili === 'Licence' && o.fil_det === 'Licence - Psychologie', 'BUT info': o => o.fili === 'BUT' && o.detail === 'Informatique' };
const FORMATIONS = [
  ['BTS', o => o.fili === 'BTS', ['BTS', 'bts']],
  ['BTS MCO', o => o.fili === 'BTS' && o.detail === 'Management Commercial Opérationnel', ['BTS MCO', 'bts mco', 'BTS management commercial opérationnel', 'BTS management commercial']],
  ['BTS NDRC', o => o.fili === 'BTS' && o.detail === 'Négociation et Digitalisation de la Relation Client', ['BTS NDRC', 'bts ndrc']],
  ['BTS tourisme', o => o.fili === 'BTS' && o.detail === 'Tourisme', ['BTS tourisme', 'BTS Tourisme']],
  ['BUT info', o => o.fili === 'BUT' && o.fil_det === 'BUT - Informatique', ['BUT informatique', 'BUT info']],
  ['prépa ECG', o => o.fili === 'CPGE' && /^ECG/.test(o.detail), ['prépas ECG', 'CPGE ECG', 'prépas éco']],
  ['MPSI', o => o.fili === 'CPGE' && o.detail === 'MPSI', ['MPSI', 'prépas MPSI']],
  ['licence psycho', o => o.fili === 'Licence' && o.detail === 'Psychologie', ['licences de psychologie', 'licence psycho', 'licences psycho']],
  ['STAPS', o => o.fili === 'Licence' && o.detail === 'STAPS', ['STAPS', 'licences STAPS']],
  ['DN MADE', o => o.fili === 'Autre formation' && o.fil_det === 'DN MADE', ['DN MADE', 'DNMADE']],
  ['BUT', o => o.fili === 'BUT', ['BUT']],
  ['CPGE', o => o.fili === 'CPGE', ['CPGE', 'prépas', 'classes prépa', 'classes préparatoires']],
  ['PASS', o => o.fili === 'PASS', ['PASS']],
  ['LAS', o => o.fili === 'Licence_Las', ['LAS', 'licences accès santé', 'licences LAS']],
  ['licences', o => o.fili === 'Licence', ['licences', 'licence']],
  ['licence de droit', o => o.fili === 'Licence' && o.fil_det === 'Licence - Droit', ['licences de droit', 'licence droit', 'licences en droit']],
  ['IFSI', o => o.fili === 'IFSI', ['IFSI', "écoles d'infirmiers", 'formations en soins infirmiers']],
  ['ingénieur', o => o.fili === "Ecole d'Ingénieur", ["écoles d'ingénieurs", "formations d'ingénieur"]],
  ['commerce', o => o.fili === 'Ecole de Commerce', ['écoles de commerce']],
];
const LIEUX = [
  ['', () => true], [' en Gironde', o => o.dep === 'Gironde'], [' à Bordeaux', o => o.commune === 'Bordeaux'],
  [" dans l'académie de Bordeaux", o => o.aca === 'Bordeaux'], [' en Nouvelle-Aquitaine', o => o.region === 'Nouvelle-Aquitaine'], [' à Pau', o => o.commune === 'Pau'],
  [' dans les Landes', o => o.dep === 'Landes'], [' en France', () => true],
];
const STATUTS = [['', () => true, ''], [' publics', o => o.statut === 'Public', 'publics'], [' privés', o => o.statut !== 'Public', 'privés'], [' du public', o => o.statut === 'Public'], [' du privé', o => o.statut !== 'Public'], [' sélectifs', o => o.selectivite === 'formation sélective']];
const OBJETS = [
  ['compter', ['combien de {X}{S}{L}', 'nombre de {X}{S}{L}', 'cmb de {X}{S}{L}', 'combien y a-t-il de {X}{S}{L} ?', 'il y a combien de {X}{S}{L}', 'combien de {X}{S} sont proposés{L}', 'combien de formations {X}{S}{L}', 'nb de {X}{S}{L}', 'combien de {X}{S} existent{L}', 'je voudrais le nombre de {X}{S}{L}', 'peux-tu me dire combien il y a de {X}{S}{L}']],
  ['places', ['combien de places en {X}{S}{L}', 'nombre de places en {X}{S}{L}', 'capacité totale des {X}{S}{L}']],
  ['voeux', ['combien de vœux en {X}{S}{L}', 'combien de vœux ont été confirmés en {X}{S}{L}', 'nombre de candidats en {X}{S}{L}', 'combien de candidatures pour les {X}{S}{L}']],
  ['admis', ["combien d'admis en {X}{S}{L}", "nombre d'admis en {X}{S}{L}", 'combien de candidats admis en {X}{S}{L}']],
  ['liste', ['liste des établissements proposant des {X}{S}{L}', 'quels établissements proposent un {X}{S}{L}', 'liste des établissement qui ont un {X}{S}{L}', 'où peut-on faire un {X}{S}{L} ?', 'donne moi les établissements avec un {X}{S}{L}', 'dans quels établissements trouve-t-on des {X}{S}{L}']],
];
function graine(n) { let x = n; return () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648; }
const r = graine(Number(process.env.GRAINE || 7));
const pick = a => a[Math.floor(r() * a.length)];
const sansAccents = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
function attendu(obj, rows) {
  if (obj === 'compter') return { kind: 'count', v: rows.length };
  if (obj === 'places') return { kind: 'sum', v: rows.reduce((t, o) => t + o.capa, 0) };
  if (obj === 'voeux') return { kind: 'sum', v: rows.reduce((t, o) => t + o.voe, 0) };
  if (obj === 'admis') return { kind: 'sum', v: rows.reduce((t, o) => t + o.acc, 0) };
  return { kind: 'liste', v: [...new Set(rows.map(o => o.etab))].sort() };
}
function obtenu(e) {
  if (!e) return { kind: 'arret' };
  if (e.kind === 'unresolved' || e.kind === 'clarification') return { kind: 'arret' };
  if (e.kind === 'count') return { kind: e.result.etablissements ? 'count_etab' : 'count', v: e.result.count };
  if (e.kind === 'sum') return { kind: 'sum', v: e.result.sum };
  if (e.kind === 'group_by' || e.kind === 'top') return { kind: 'liste', v: (e.result.rows || []).map(x => x.value).sort(), col: e.plan?.targetCol };
  return { kind: e.kind };
}
const N = Number(process.env.N || 400);
const res = [];
for (let i = 0; i < N; i++) {
  const [nomF, pf, mots] = pick(FORMATIONS), [lieu, pl] = pick(LIEUX), [stat, ps] = pick(STATUTS), [obj, modeles] = pick(OBJETS);
  let q = pick(modeles).replace('{X}', pick(mots)).replace('{S}', stat).replace('{L}', lieu);
  if (r() < 0.2) q = sansAccents(q);
  const rows = OD.filter(o => pf(o) && pl(o) && ps(o));
  const att = attendu(obj, rows), ob = obtenu(ask(q));
  let verdict;
  const juste = a => a.kind === 'liste' ? ob.kind === 'liste' && JSON.stringify(ob.v) === JSON.stringify(a.v) : ob.kind === a.kind && ob.v === a.v;
  // données fictives ambiguës (« Lettres modernes » rangées sous « Licence - Psychologie ») : les deux lectures acceptées
  const att2 = ALT[nomF] ? attendu(obj, OD.filter(o => ALT[nomF](o) && pl(o) && ps(o))) : null;
  if (ob.kind === 'arret') verdict = 'arret';
  else verdict = juste(att) || (att2 && juste(att2)) ? 'ok' : 'faux';
  res.push({ q, obj, nomF, lieu, stat, att, ob, verdict });
}

await describe(`Banc de ${res.length} formulations : jamais un chiffre faux`, () => {
  const faux = res.filter(x => x.verdict === 'faux');
  assert(!faux.length, `aucun chiffre faux${faux.length ? ` — ${faux.slice(0, 5).map(x => `« ${x.q} » : attendu ${JSON.stringify(x.att.v).slice(0, 40)}, obtenu ${x.ob.kind} ${JSON.stringify(x.ob.v ?? '').slice(0, 40)}`).join(' ; ')}` : ''}`);
  const arrets = res.filter(x => x.verdict === 'arret');
  assert(arrets.length <= res.length * 0.08, `arrêts limités (${arrets.length} / ${res.length}, au plus 8 %) — exemples : ${arrets.slice(0, 4).map(x => x.q).join(' | ')}`);
  const listes = res.filter(x => x.obj === 'liste');
  assert(listes.filter(x => x.verdict === 'ok').length >= listes.length * 0.85, `listes d'établissements répondues (${listes.filter(x => x.verdict === 'ok').length} / ${listes.length})`);
});

await describe('Non-régression open data réel : un parcours qui ne répète pas le nom de sa licence reste compté', () => {
  // vu sur l'open data réel : « licences de droit » = 7 au lieu de 273 quand un libellé de regroupement (« Droit ») ne
  // suffisait plus pour les parcours dont l'intitulé fin ne répète pas le mot. Le mot du regroupement doit suffire.
  const c2 = makeCtx();
  const t = { name: 'od', source: 'Open data', rowUnit: 'formation', headers: ['Filière de formation très agrégée', 'Filière de formation détaillée bis', 'Filière de formation très détaillée'],
    objects: [['Licence', 'Droit', 'Droit'], ['Licence', 'Droit', 'Droit privé'], ['Licence', 'Droit', 'Parcours administration publique'], ['Licence', 'Droit', 'Carrières judiciaires'], ['Licence', 'Économie', 'Économie']]
      .map(([a, b, d]) => ({ 'Filière de formation très agrégée': a, 'Filière de formation détaillée bis': b, 'Filière de formation très détaillée': d })) };
  c2.__t = t;
  const f = run(c2, 'makeFormationTermsFilter(__t, [["droit"]], ["droit"])');
  const n = run(c2, 'applyLocalActionFilters')(t.objects, [f]).length;
  assert(n === 4, `les 4 licences du regroupement « Droit », parcours compris (obtenu : ${n})`);
});

await describe('Corrections ciblées', () => {
  const c = q => { const e = ask(q); return e?.kind === 'count' ? e.result.count : e?.kind === 'sum' ? e.result.sum : e?.kind; };
  const n = f => OD.filter(f).length;
  assert(c('combien de PASS') === n(o => o.fili === 'PASS'), 'faux positif : PASS inchangé');
  assert(c('combien de prépas éco sélectifs') === n(o => o.fili === 'CPGE' && /^ECG/.test(o.detail)), '« prépas éco sélectifs » : un nombre, pas un classement');
  assert(ask('classement des BTS les plus sélectifs')?.kind === 'classement', 'faux positif : « classement des… les plus sélectifs » reste un classement');
  const etabs = new Set(OD.filter(o => o.fili === 'BTS' && o.detail === 'Management Commercial Opérationnel' && o.dep === 'Gironde').map(o => o.etab));
  for (const q of ['où peut-on faire un BTS MCO en Gironde ?', 'donne moi les établissements avec un BTS MCO en Gironde', 'dans quels établissements trouve-t-on des BTS MCO en Gironde']) {
    const e = ask(q); const v = new Set((e?.result?.rows || []).map(r => r.value));
    assert(e?.kind === 'group_by' && v.size === etabs.size && [...etabs].every(x => v.has(x)), `« ${q} » : la liste des ${etabs.size} établissements (avant : arrêt)`);
  }
  assert(c('combien de BUT info') === n(o => o.fil_det === 'BUT - Informatique'), '« BUT info » = BUT informatique (avant : arrêt)');
  assert(c('combien de DN MADE') === n(o => o.fil_det === 'DN MADE') && c('combien de DNMADE') === n(o => o.fil_det === 'DN MADE'), '« DN MADE », « DNMADE » (avant : arrêt)');
  assert(c('combien de vœux ont ete confirmes en BTS') === OD.filter(o => o.fili === 'BTS').reduce((t, o) => t + o.voe, 0), '« ont ete confirmes » sans accents (avant : arrêt)');
  assert(c('combien de Sciences Po') === 'unresolved', 'faux positif : « Sciences Po » absent des données : arrêt');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
