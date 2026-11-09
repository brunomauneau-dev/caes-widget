// test_sigles_formations.js — Sigles et surnoms de formations ; mot non reconnu = arrêt.
// Essai sur l'open data réel (09/11/2026) : les sigles « MCO », « NDRC », « SIO », « GEA », « TC », les surnoms
// « khâgne », « Sciences Po » n'apparaissent dans aucun intitulé du ministère. Le mot était ignoré sans le dire :
// « BTS MCO » → 5 351 (tous les BTS), « BUT GEA » → 820 (tous les BUT), « khâgnes » → 14 252 (tout le fichier),
// « Sciences Po » → 2 525 (« Po » trop court, ignoré), « écoles de commerce » → 447 (BTS Commerce international
// compris), « licences STAPS » → 28 (le nom complet n'était pas cherché), « orthophonie » → 1.
// Désormais : les sigles sont traduits vers les mots des intitulés officiels (seulement s'ils sont absents des
// données), et un mot de la question qui ne correspond à rien arrête le calcul au lieu de l'élargir.
// node js/test_sigles_formations.js

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
async function ctxCSV(rows, name = 'formations.csv') {
  const ctx = makeCtx();
  const buf = new TextEncoder().encode(D.versCSV(rows));
  await run(ctx, 'importSpreadsheetFile')({ name, size: buf.length, arrayBuffer: async () => buf.buffer });
  return ctx;
}
function ask(ctx, q) {
  run(ctx, 'window.__DATA_ENGINE_STATE = { lastPlan: null, lastExecution: null, history: [] }');
  ctx.__q = q;
  const plan = run(ctx, 'isDataEngineQuestion(__q)') ? run(ctx, 'detectDataEnginePlan(__q)') : null;
  return plan ? run(ctx, 'runDataEnginePlan')(plan, []) : null;
}
const valeur = e => e?.kind === 'count' ? e.result.count : e?.kind === 'sum' ? e.result.sum : e?.kind === 'unresolved' ? 'arrêt' : `${e?.kind}`;

// ─── Open data simulé, nommé comme les vraies données (diagnostic de l'essai du 09/11/2026) ─────────────────
const BASE = D.openData(4000, 5);
const OD = BASE.map((o, i) => {
  const r = { ...o, region: o.region.replace('-', ' ') }; // « Nouvelle Aquitaine », comme dans les vraies données
  if (o.fili === 'CPGE' && i % 3 === 0) return { ...r, fil_det: 'Lettres', nom: 'CPGE - Lettres', detail: '' };
  if (o.fili === 'CPGE' && i % 3 === 1 && i % 2 === 0) return { ...r, fil_det: 'B/L - Lettres et sciences sociales', nom: 'CPGE - B/L - Lettres et sciences sociales', detail: '' };
  if (o.fili === 'Ecole de Commerce') return { ...r, form: 'Formation des écoles de commerce et de management', fil_det: 'Formation des écoles de commerce et de management Bac + 3', nom: 'Formation des écoles de commerce et de management Bac + 3', detail: '' };
  if (o.fili === "Ecole d'Ingénieur") return { ...r, form: "Formations des écoles d'ingénieurs", fil_det: "Formation d'ingénieur Bac + 5", nom: "Formation d'ingénieur Bac + 5 - Bac général", detail: '' };
  if (o.fili === 'BTS' && i % 23 === 0) return { ...r, form: 'BTS - Services', fil_det: 'Commerce International', nom: 'BTS - Services - Commerce International', detail: 'Commerce International' };
  if (o.fili === 'BTS' && i % 23 === 1) return { ...r, form: 'BTS - Services', fil_det: 'Services informatiques aux organisations', nom: 'BTS - Services - Services informatiques aux organisations', detail: 'Services informatiques aux organisations' };
  if (o.fili === 'Licence' && i % 29 === 0) return { ...r, form: 'Sciences politiques', fil_det: "Sciences Po / Instituts d'études politiques - Sciences Humaines et Sociales - Grade Licence", nom: "Sciences Po / Instituts d'études politiques - Grade Licence - Bachelor", detail: '' };
  if (o.fili === 'Licence' && i % 29 === 1) return { ...r, form: 'Licence - STAPS', fil_det: 'Sciences et Techniques des Activités Physiques et Sportives', nom: 'Licence - Portail Sciences et Techniques des Activités Physiques et Sportives', detail: '' };
  if (o.fili === 'Licence' && i % 29 === 2) return { ...r, form: 'Licence - Sciences - santé - STAPS', fil_det: 'Sciences et Techniques des Activités Physiques et Sportives', nom: 'Licence - Sciences et Techniques des Activités Physiques et Sportives - STAPS', detail: 'STAPS' };
  if (o.fili === 'Licence' && i % 29 === 3) return { ...r, form: 'Licence - Lettres', fil_det: 'Lettres', nom: "Licence - Humanités - Parcours préparation à l'entrée aux écoles d'orthophonie", detail: "préparation à l'entrée aux écoles d'orthophonie" };
  if (o.fili === 'Autre formation' && i % 5 === 0) return { ...r, form: 'Autre formation', fil_det: "Certificat de capacité d'Orthophoniste", nom: "Certificat de capacité d'Orthophoniste", detail: '' };
  if (o.fili === 'BUT' && i % 7 === 0) return { ...r, detail: 'Nouvelles technologies', nom: `${o.fil_det} - Nouvelles technologies` };
  return r;
});
const n = pred => OD.filter(pred).length;

await describe('Sigles et surnoms → intitulés officiels (chiffres recalculés sur les lignes)', () => {
  const ctx = ctxOpenData(OD);
  const cas = [
    ['combien de BTS MCO', n(o => o.detail === 'Management Commercial Opérationnel'), 'BTS MCO = Management Commercial Opérationnel (avant : tous les BTS)'],
    ['combien de BTS NDRC', n(o => o.detail === 'Négociation et Digitalisation de la Relation Client'), 'BTS NDRC'],
    ['combien de BTS SIO', n(o => o.detail === 'Services informatiques aux organisations'), 'BTS SIO'],
    ['combien de BTS CG', n(o => o.detail === 'Comptabilité et Gestion'), 'BTS CG'],
    ['combien de BTS CI', n(o => o.fili === 'BTS' && o.detail === 'Commerce International'), 'BTS CI'],
    ['combien de BUT GEA', n(o => o.fili === 'BUT' && /Gestion des entreprises et des administrations/.test(o.nom)), 'BUT GEA (avant : tous les BUT)'],
    ['combien de BUT TC', n(o => o.fil_det === 'BUT - Techniques de commercialisation'), 'BUT TC'],
    ['combien de khâgnes', n(o => o.nom === 'CPGE - Lettres'), 'khâgnes = CPGE - Lettres, valeur officielle (avant : tout le fichier)'],
    ['combien d\'hypokhâgnes', n(o => o.nom === 'CPGE - Lettres'), 'hypokhâgnes'],
    ['combien de khâgnes B/L', n(o => o.nom === 'CPGE - B/L - Lettres et sciences sociales'), 'khâgnes B/L = Lettres et sciences sociales'],
    ['combien de Sciences Po', n(o => /Instituts d'études politiques/.test(o.fil_det)), 'Sciences Po = Instituts d\'études politiques (avant : tout intitulé contenant « Sciences »)'],
    ['combien d\'IEP', n(o => /Instituts d'études politiques/.test(o.fil_det)), 'IEP'],
    ['combien d\'écoles de commerce', n(o => o.fili === 'Ecole de Commerce'), 'écoles de commerce (sans les BTS Commerce International)'],
    ['combien d\'écoles d\'ingénieurs', n(o => o.fili === "Ecole d'Ingénieur"), 'écoles d\'ingénieurs'],
    ['combien de licences STAPS', n(o => /Activités Physiques et Sportives/.test(o.fil_det) && o.fili === 'Licence'), 'licences STAPS (nom complet cherché)'],
    ['combien de formations d\'orthophonie', n(o => /Orthophoniste/.test(o.fil_det)), 'orthophonie = certificat d\'orthophoniste (pas la licence préparatoire)'],
    ['combien de L1 de droit', n(o => o.fili === 'Licence' && /Droit/.test(o.nom) && !/accès santé/.test(o.nom)), 'L1 de droit = licences de droit'],
  ];
  cas.forEach(([q, attendu, libelle]) => {
    const e = ask(ctx, q);
    assert(attendu > 0 && valeur(e) === attendu, `${libelle} : ${attendu} (obtenu : ${valeur(e)})`);
  });
  const p = ask(ctx, 'combien de places en BTS MCO dans l\'académie de Bordeaux');
  const attendu = OD.filter(o => o.detail === 'Management Commercial Opérationnel' && o.aca === 'Bordeaux').reduce((t, o) => t + o.capa, 0);
  assert(p?.kind === 'sum' && p.result.sum === attendu, `combiné avec une mesure et un lieu : places en BTS MCO dans l'académie de Bordeaux = ${attendu}`);
  assert(/management/.test(run(ctx, 'perimetreResultat')(p.kind, p.plan, p.result).texte), 'le périmètre montre les mots réellement cherchés');
});

await describe('« licences de … » : la catégorie Licence, sans les LAS (comme « combien de licences »)', () => {
  // essai réel : « licences STAPS » → 134, dont 41 LAS (Licence_Las) ; le ministère, comme « combien de licences », en compte 93
  const ctx = ctxOpenData(OD);
  const e = ask(ctx, 'combien de licences de droit');
  const attendu = n(o => o.fili === 'Licence' && /Droit/.test(o.nom));
  const las = n(o => o.fili === 'Licence_Las' && /Droit/.test(o.nom));
  assert(las > 0 && valeur(e) === attendu, `licences de droit : ${attendu}, sans les ${las} LAS de droit (obtenu : ${valeur(e)})`);
  // intitulés tous différents (« Parcours 1, 2… ») : le moteur passe par les mots, la note dit ce qui est laissé de côté
  const VAR = OD.map((o, i) => (o.fili === 'Licence' || o.fili === 'Licence_Las') && /Droit/.test(o.nom) ? { ...o, nom: `${o.nom} - Parcours ${i}` } : o);
  const cv = ctxOpenData(VAR);
  const ev = ask(cv, 'combien de licences de droit');
  assert(valeur(ev) === attendu && ev.plan.categorieExclue?.valeur === 'Licence', `par les mots : catégorie « Licence » + « droit » = ${attendu} (obtenu : ${valeur(ev)})`);
  const p = run(cv, 'perimetreResultat')(ev.kind, ev.plan, ev.result).texte;
  assert(p.includes(`${las} formations « Licence_Las » (LAS, licences accès santé) ont aussi ces mots mais ne sont pas comptées`), 'le périmètre dit combien de LAS sont laissées de côté');
  assert(valeur(ask(ctx, 'combien de licences')) === n(o => o.fili === 'Licence'), '« combien de licences » : même définition');
  const s2 = ask(ctx, 'combien de licences STAPS');
  assert(valeur(s2) === n(o => o.fili === 'Licence' && /Activités Physiques et Sportives/.test(o.fil_det)), 'licences STAPS : catégorie Licence');
  // faux positif : un mot porté par une seule catégorie (BTS, PASS) reste un mot d'intitulé (options des PASS inchangées)
  const pb = ask(ctx, 'combien de PASS option biologie');
  assert(pb?.kind === 'count' && !pb.plan.categorieExclue, 'faux positif : « PASS » n\'est pas transformé (une seule catégorie le porte)');
});

await describe('Sigle écrit tel quel dans les données : gardé', async () => {
  // fichier d'un établissement qui écrit « BTS MCO » : on ne traduit pas
  const rows = [['Formation', 'Capacité'], ['BTS MCO', 30], ['BTS MCO', 24], ['BTS NDRC', 28], ['BTS Comptabilité et Gestion', 20]];
  const ctx = await ctxCSV(rows);
  ctx.__q = 'combien de BTS MCO';
  const tf = run(ctx, '(getActiveQueryTables() || [])[0]');
  ctx.__tf = tf;
  assert(run(ctx, 'appliquerSiglesFormations(__q, __tf)') === 'combien de BTS MCO', 'question inchangée');
  const e = ask(ctx, 'combien de BTS MCO');
  assert(e?.kind === 'count' && e.result.count === 2, `2 lignes « BTS MCO » (obtenu : ${valeur(e)})`);
});

await describe('Mot non reconnu : arrêt au lieu de compter plus large', () => {
  const ctx = ctxOpenData(D.openData(3000, 5)); // sans CPGE lettres, sans IEP : les traductions sont impossibles
  for (const [q, mot] of [['combien de BTS XYZQ', 'xyzq'], ['combien de formations de pilote de ligne', 'pilote'], ['combien de Sciences Po', 'po'], ['combien de BUT ZZ', 'zz']]) {
    const e = ask(ctx, q);
    assert(e?.kind === 'unresolved' && e.result.missing.includes(mot), `« ${q} » : arrêt, « ${mot} » nommé (obtenu : ${valeur(e)} ${String(e?.text || '').slice(0, 60)})`);
  }
  const x = ask(ctx, 'combien de BTS XYZQ');
  assert(/ensemble plus large/.test(x.text) && /intitulé tel qu'il figure/.test(x.html), 'le message explique pourquoi et comment reformuler');
  // pas de prépa littéraire dans ces données : « khâgnes » → « CPGE lettres » introuvable → arrêt (jamais tout le fichier)
  const k = ask(ctx, 'combien de khâgnes');
  assert(k?.kind === 'unresolved', `« combien de khâgnes » sans prépa littéraire : arrêt (obtenu : ${valeur(k)})`);
});

await describe('Faux positifs : les questions habituelles donnent toujours leur chiffre', () => {
  const ctx = ctxOpenData(OD);
  const cas = [
    ['combien de formations', OD.length],
    ['combien de BTS', n(o => o.fili === 'BTS')],
    ['combien de BTS publics dans l\'académie de Bordeaux', n(o => o.fili === 'BTS' && o.statut === 'Public' && o.aca === 'Bordeaux')],
    ['combien de BUT en Nouvelle-Aquitaine', n(o => o.fili === 'BUT' && o.region === 'Nouvelle Aquitaine')],
    ['combien de licences sélectives', n(o => o.fili === 'Licence' && o.selectivite === 'formation sélective')],
    ['combien de formations à Bordeaux', n(o => o.commune === 'Bordeaux')],
    ['combien de formations non sélectives', n(o => o.selectivite === 'formation non sélective')],
    ['combien de formations privées', n(o => o.statut !== 'Public')],
    ['combien de CPGE', n(o => o.fili === 'CPGE')],
    ['combien de prépas', n(o => o.fili === 'CPGE')],
  ];
  cas.forEach(([q, attendu]) => { const e = ask(ctx, q); assert(valeur(e) === attendu, `« ${q} » : ${attendu} (obtenu : ${valeur(e)})`); });
  const t = ask(ctx, "taux d'accès moyen des BUT informatique");
  const bi = OD.filter(o => o.fil_det === 'BUT - Informatique');
  assert(t?.kind === 'stats' && Math.abs(t.result.avg - bi.reduce((s, o) => s + o.taux, 0) / bi.length) < 1e-9, '« taux d\'accès moyen des BUT informatique » : « moyen » n\'est pas un mot d\'intitulé');
  const pl = ask(ctx, 'combien de places en BTS');
  assert(pl?.kind === 'sum', 'places en BTS : somme');
  const cl = ask(ctx, 'les 5 formations avec le plus de places à Bordeaux');
  assert(cl?.kind === 'classement', 'classement inchangé');
  const pa = ask(ctx, 'part des boursiers parmi les admis en BTS');
  assert(pa?.kind === 'part', 'part inchangée');
});

await describe('Mot d\'intitulé déjà couvert par un filtre de lieu : retiré', () => {
  const ctx = makeCtx();
  ctx.__p = { filters: [
    { col: 'Intitulé', op: 'contains_all', terms: [['but'], ['nouvelles']], label: 'BUT + Nouvelles', value: 'BUT + Nouvelles', source: 'termes_formation' },
    { col: "Région de l'établissement", op: 'eq', value: 'Nouvelle Aquitaine' },
  ] };
  run(ctx, 'elaguerTermesCouverts(__p)');
  const tf = ctx.__p.filters.find(f => f.op === 'contains_all');
  assert(tf && tf.terms.length === 1 && tf.terms[0][0] === 'but' && tf.label === 'BUT', '« Nouvelles » retiré (couvert par « Nouvelle Aquitaine »), « BUT » gardé');
  ctx.__p2 = { filters: [{ col: 'Intitulé', op: 'contains_all', terms: [['droit']], label: 'droit', value: 'droit' }, { col: 'Statut', op: 'neq', value: 'droit privé' }] };
  run(ctx, 'elaguerTermesCouverts(__p2)');
  assert(ctx.__p2.filters.find(f => f.op === 'contains_all')?.terms.length === 1, 'faux positif : une exclusion (≠) ne couvre pas un mot d\'intitulé');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
