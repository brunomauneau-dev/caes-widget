// test_verification_lecture.js — Double lecture par Albert dans le widget (js/verification.js), mode prudent.
// Le moteur répond tout de suite ; Albert (modèle rapide) relit la question en arrière-plan. Désaccord IMPORTANT :
// avertissement sous la réponse + note dans « À revoir ». Accord, Albert indisponible, lent ou illisible : rien.
// Albert est simulé (aucun appel réseau).
// node js/test_verification_lecture.js

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

// DOM minimal : une bulle avec son bloc « Sur quoi porte ce calcul »
function bulle() {
  const enfants = [];
  const perim = { className: 'de-perimetre', parentNode: null };
  const b = {
    enfants,
    querySelector(sel) { if (sel === '.de-perimetre') return perim; if (sel === '.de-verif' || sel === '.de-verif-etat') return enfants.find(e => e.className === sel.slice(1)) || null; return null; },
    appendChild(e) { enfants.push(e); e.parentNode = b; },
    insertBefore(e) { enfants.push(e); e.parentNode = b; },
    removeChild(e) { const i = enfants.indexOf(e); if (i >= 0) enfants.splice(i, 1); },
  };
  perim.parentNode = b;
  return b;
}
function makeCtx(stockage = {}) {
  const noopEl = () => null;
  const ctx = {
    console: { ...console, log() {}, warn() {}, info() {} }, setTimeout, clearTimeout, AbortController, URLSearchParams, TextDecoder, TextEncoder,
    document: { getElementById: noopEl, querySelector: noopEl, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, className: '', innerHTML: '', setAttribute(k, v) { this[k] = v; }, appendChild() {} }) },
    localStorage: { getItem: k => stockage[k] ?? null, setItem: (k, v) => { stockage[k] = String(v); }, removeItem: k => { delete stockage[k]; } },
    escapeHtml: s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  };
  ctx.XLSX = { utils: { json_to_sheet: () => ({}), book_new: () => ({}), book_append_sheet() {}, sheet_to_csv: () => '', sheet_to_json: () => [], aoa_to_sheet: () => ({}) }, writeFile() {} };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.selectedDocIds = new Set();
  vm.createContext(ctx);
  for (const f of ['config.js', 'knowledge.js', 'documents.js', 'planner.js', 'dataEngine.js', 'sessions.js', 'retours.js', 'verification.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
  ctx.resetContextSilent = () => {};
  ctx.mettreAJourCompteurRetours = () => {};
  ctx.__t = D.tableOpenData(D.openData(2000, 17));
  vm.runInContext("defaultOpenDataTable = __t; defaultOpenDataState = 'ready';", ctx);
  return ctx;
}
const run = (ctx, code) => vm.runInContext(code, ctx);
const ask = (ctx, q) => { run(ctx, 'window.__DATA_ENGINE_STATE = { lastPlan: null, lastExecution: null, history: [] }'); ctx.__q = q; return run(ctx, 'runDataEnginePlan')(run(ctx, 'detectDataEnginePlan(__q)'), []); };
const albertRepond = (obj, opts = {}) => async (url, req) => {
  if (opts.verifier) opts.verifier(url, JSON.parse(req.body));
  if (opts.lent) await new Promise(r => setTimeout(r, opts.lent));
  return { ok: true, json: async () => ({ choices: [{ message: { content: typeof obj === 'string' ? obj : JSON.stringify(obj) } }] }) };
};

await describe('Désaccord important : avertissement sous la réponse, noté dans « À revoir »', async () => {
  const st = {};
  const ctx = makeCtx(st);
  const e = ask(ctx, "combien d'académies proposent des PASS");
  // le moteur compte bien les académies ; on simule un moteur qui aurait compté des formations
  const faux = { ...e, plan: { ...e.plan, compterValeurs: null } };
  const b = bulle();
  let appel = null;
  const d = await run(ctx, 'verifierLecture')({ exec: faux, questions: ["combien d'académies proposent des PASS"], bubble: b,
    fetchImpl: albertRepond({ operation: 'compter_distinct', objet: 'academies', filtres: [{ colonne: 'formation', valeurs: ['PASS'] }], exclusions: [], regroupement: null }, { verifier: (u, body) => { appel = body; } }) });
  assert(/opération : Albert compter_distinct, moteur compter/.test(d || ''), `désaccord détecté (${d})`);
  // règle changée (v27.6.4) : Mistral Small refuse tout (HTTP 429) ; la relecture passe par le modèle principal d'Albert
  assert(appel && appel.model === 'openweight-large' && appel.temperature === 0, 'modèle principal d\'Albert (openweight-large), température 0');
  assert(!b.enfants.some(x => x.className === 'de-verif-etat'), 'désaccord : la ligne « en cours » est remplacée par l\'avertissement');
  const alerte = b.enfants.find(x => x.className === 'de-verif');
  assert(alerte && /⚠️ <strong>Vérification<\/strong> : la question peut demander un nombre d'éléments différents/.test(alerte.innerHTML) && /J'ai compris/.test(alerte.innerHTML), 'avertissement en clair, renvoie à « J\'ai compris »');
  const retours = JSON.parse(st[run(ctx, 'RETOURS_CLE')] || '[]');
  assert(retours.length === 1 && retours[0].type === 'alerte_lecture' && /Vérification automatique/.test(retours[0].commentaire), 'noté dans « À revoir » (type alerte_lecture)');
  await run(ctx, 'verifierLecture')({ exec: faux, questions: ["combien d'académies proposent des PASS"], bubble: b, fetchImpl: albertRepond({ operation: 'compter_distinct', objet: 'academies', filtres: [] }) });
  assert(b.enfants.filter(x => x.className === 'de-verif').length === 1, 'jamais deux avertissements sur la même réponse');
});

// règle changée (v27.6.4) : avant, rien ne s'affichait en cas d'accord ou d'échec — on ne savait pas si la relecture avait
// eu lieu. Désormais une ligne discrète le dit (« même lecture », « indisponible ») ; jamais d'avertissement dans ces cas.
await describe('Accord, ou Albert absent : une ligne d\'état, jamais d\'avertissement', async () => {
  const ctx = makeCtx();
  const e = ask(ctx, 'combien de BTS en Gironde');
  const b = bulle();
  const ok = await run(ctx, 'verifierLecture')({ exec: e, questions: ['combien de BTS en Gironde'], bubble: b,
    fetchImpl: albertRepond({ operation: 'compter', filtres: [{ colonne: 'formation', valeurs: ['BTS'] }, { colonne: "Département de l'établissement", valeurs: ['Gironde'] }], exclusions: [], regroupement: null }) });
  const etat = b2 => b2.enfants.find(x => x.className === 'de-verif-etat');
  assert(ok === null && !b.enfants.some(x => x.className === 'de-verif') && etat(b)?.['data-etat'] === 'accord' && /comprend la question comme le calcul/.test(etat(b).innerHTML), 'même lecture : « ✓ Relecture par Albert… », aucun avertissement');
  for (const [nom, f] of [['indisponible (HTTP 503)', async () => ({ ok: false, status: 503 })], ['réponse sans JSON', albertRepond('Je ne sais pas')], ['erreur réseau', async () => { throw new Error('réseau'); }]]) {
    const b2 = bulle();
    const r = await run(ctx, 'verifierLecture')({ exec: e, questions: ['combien de BTS en Gironde'], bubble: b2, fetchImpl: f });
    assert(r === null && !b2.enfants.some(x => x.className === 'de-verif') && etat(b2)?.['data-etat'] === 'indisponible' && /pas pu relire/.test(etat(b2).innerHTML) && b2.enfants.length === 1, `Albert ${nom} : une ligne d'état (${etat(b2)?.['data-etat']}), aucun avertissement, aucune erreur`);
  }
  const lent = await run(ctx, 'demanderLectureAlbert')(['combien de BTS'], e.plan.table, { fetchImpl: (u, req) => new Promise((res, rej) => { req.signal.addEventListener('abort', () => rej(new Error('abandon'))); }), delaiMaxMs: 50 }).then(() => 'fini', er => er.message);
  assert(lent === 'abandon', 'Albert trop lent : abandon au bout du délai maximal');
});

await describe('Cas sans objet, et désactivation', async () => {
  const ctx = makeCtx();
  let appels = 0;
  const compte = async () => { appels++; return { ok: true, json: async () => ({ choices: [{ message: { content: '{"operation":"compter"}' } }] }) }; };
  for (const q of ['comparer boursiers et non boursiers', 'combien de zzzzformation']) {
    const e = ask(ctx, q);
    await run(ctx, 'verifierLecture')({ exec: e, questions: [q], bubble: bulle(), fetchImpl: compte });
  }
  assert(appels === 0, 'arrêt (« critère non reconnu ») et comparaison : pas de vérification');
  const st = { caes_verif_lecture: 'non' };
  const c2 = makeCtx(st);
  const e = ask(c2, 'combien de BTS');
  await run(c2, 'verifierLecture')({ exec: e, questions: ['combien de BTS'], bubble: bulle(), fetchImpl: compte });
  assert(appels === 0, 'désactivable (localStorage caes_verif_lecture = non)');
});

await describe('v27.5.65 — Fausses alertes de l\'essai : comptage ≈ somme d\'effectifs, liste ≈ comptage pour « je cherche »', () => {
  const ctx = makeCtx();
  const d = run(ctx, 'desaccordVerif'), lm = run(ctx, 'lectureMoteurVerif');
  const A = op => ({ op, filtres: {}, exclus: {} });
  const somme = (question, sumCol) => lm({ kind: 'sum', plan: { question, sumCol, filters: [] }, result: {} });
  assert(d(A('compter'), somme("combien d'admis en CPGE", "Effectif total des candidats ayant accepté la proposition de l'établissement (admis)")) === null, '« combien d\'admis » : somme des admis, pas d\'alerte (avant : fausse alerte)');
  assert(d(A('compter'), somme('et en BUT ?', "Capacité de l'établissement par formation")) === null, '« nombre de places » puis « et en BUT ? » : pas d\'alerte');
  assert(/opération/.test(d(A('compter'), somme('combien de formations en BTS', "Capacité de l'établissement par formation"))), 'faux positif : « combien de formations » additionné en places : alerte gardée');
  const liste = q => lm({ kind: 'group_by', plan: { question: q, lesquelles: true, targetCol: 'Établissement', filters: [] }, result: {} });
  assert(d(A('compter'), liste('je cherche les IFSI de Nouvelle-Aquitaine')) === null, '« je cherche les IFSI » : liste, pas d\'alerte');
  assert(/opération/.test(d(A('compter'), liste('combien d\'IFSI en Nouvelle-Aquitaine'))), 'faux positif : « combien… » répondu par une liste : alerte gardée');
});

await describe('Câblage dans le widget', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const albert = fs.readFileSync(path.join(__dirname, 'albert.js'), 'utf8');
  assert(/<script src="js\/verification\.js\?v=[\d.]+" defer><\/script>/.test(html), 'verification.js chargé (defer, versionné)');
  assert(/verifierLecture\(\{ exec: dataExecution/.test(albert) && !/await verifierLecture/.test(albert), 'appelée après l\'affichage de la réponse, sans l\'attendre');
  assert(/_relance \?/.test(albert), 'questions précédentes transmises seulement pour une relance');
  const essai = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'essai_double_lecture.mjs'), 'utf8');
  assert(/js', 'verification\.js'/.test(essai), 'l\'essai mesure la même logique (verification.js)');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
