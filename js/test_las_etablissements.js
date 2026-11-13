// test_las_etablissements.js — Deux erreurs signalées en usage réel (open data Parcoursup 2025) :
// - « combien de licences LAS en France » : 0, affiché comme calcul exact (catégorie « Licence » + intitulé contenant
//   « las ») ; « combien de licence accès santé » : les licences dont l'intitulé contient « santé » (19), pas les LAS.
//   Les LAS sont une catégorie officielle (« Filière de formation très agrégée » = Licence_Las).
// - « donne moi la liste des établissement proposant le BTS MCO » (singulier) : refus « ce calcul compterait des
//   formations », alors que « liste des établissements » (pluriel) donnait la liste.
// - « combien de vœux confirmés par les candidats en licence d'histoire à Bordeaux Montaigne » : arrêt (« confirmés » pris
//   pour un mot d'intitulé, « Bordeaux » pour la commune — l'université est à Pessac —, « par les candidats » pour une
//   répartition). Après correction, « Bordeaux » ne filtre plus la commune quand il ouvre le nom d'un établissement.
// Données FICTIVES (js/fixtures/donnees_simulees.mjs) ; chaque valeur attendue est recalculée sur les lignes.
// node js/test_las_etablissements.js

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

const OD = D.openData(3000, 17);
const co = makeCtx();
co.__t = D.tableOpenData(OD);
run(co, "defaultOpenDataTable = __t; defaultOpenDataState = 'ready';");
const qo = asker(co);
const n = f => OD.filter(f).length;
const LAS = o => o.fili === 'Licence_Las';
const mots = o => normalize([o.form, o.fil_det, o.detail, o.nom].join(' '));
function normalize(s) { return String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' '); }
const cnt = e => e?.kind === 'count' ? e.result.count : e?.kind;
const MCO = o => /\bbts\b/.test(mots(o)) && /\bmanagement\b/.test(mots(o)) && /\bcommercial\b/.test(mots(o)) && /\boperationnel\b/.test(mots(o));

await describe('LAS : la catégorie officielle « Licence_Las »', () => {
  assert(n(LAS) > 0, `jeu de données : ${n(LAS)} LAS`);
  for (const q of ['combien de licences las en france', 'combien de licence accès santé en france', 'combien de LAS', 'combien de licences LAS', 'combien de L.A.S.', 'nombre de licences d\'accès santé']) {
    const e = qo(q);
    assert(cnt(e) === n(LAS), `« ${q} » : ${n(LAS)} (avant : 0 ou les licences « santé » ; obtenu : ${cnt(e)})`);
  }
  assert(cnt(qo('combien de LAS en Gironde')) === n(o => LAS(o) && o.dep === 'Gironde'), 'LAS en Gironde');
  const s = qo('combien de places en LAS');
  assert(s?.kind === 'sum' && s.result.sum === OD.filter(LAS).reduce((t, o) => t + Number(o.capa || 0), 0), 'places en LAS');
  const e = qo('combien de licences las en france');
  assert(!/ont aussi ces mots mais ne sont pas comptées/.test(e?.html || ''), 'plus de note « LAS laissées de côté » quand ce sont les LAS qui sont demandées');
  assert(cnt(qo('combien de PASS et de LAS')) === n(o => LAS(o) || o.fili === 'PASS'), 'PASS et LAS : les deux catégories');
});

await describe('LAS : relance « donne moi la liste »', () => {
  qo('combien de licence accès santé en france');
  const l = qo('donne moi la liste', true);
  const etabs = new Set(OD.filter(LAS).map(o => o.etab));
  const total = (l?.result?.rows || []).reduce((t, r) => t + r.count, 0);
  assert(l?.kind === 'group_by' && total === n(LAS) && (l.result.rows || []).every(r => etabs.has(r.value)), `la liste porte sur les LAS (${n(LAS)} formations ; obtenu : ${total})`);
});

await describe('Faux positifs : les licences hors LAS', () => {
  const lic = n(o => o.fili === 'Licence');
  assert(cnt(qo('combien de licences')) === lic, '« combien de licences » : catégorie Licence, LAS exclues (inchangé)');
  assert(cnt(qo('combien de licences hors LAS')) === lic, `« licences hors LAS » : ${lic} (avant : 0)`);
  assert(cnt(qo('combien de formations hors LAS')) === n(o => !LAS(o)), '« formations hors LAS »');
  assert(cnt(qo('combien de PASS')) === n(o => o.fili === 'PASS'), 'PASS inchangé');
  const d = qo('combien de licences de droit');
  assert(cnt(d) > 0 && !(d.plan.filters || []).some(f => f.value === 'Licence_Las'), 'licences de droit : pas de LAS');
});

await describe('« liste des établissement » (singulier) : la liste, pas un refus', () => {
  const etabs = new Set(OD.filter(MCO).map(o => o.etab));
  assert(etabs.size > 0, `jeu de données : ${n(MCO)} BTS MCO`);
  for (const q of ['donne moi la liste des établissement proposant le bts mco', 'liste des établissement qui ont un bts mco', 'liste des établissements qui proposent un BTS MCO']) {
    const e = qo(q);
    const rows = e?.result?.rows || [];
    assert(e?.kind === 'group_by' && rows.length === etabs.size && rows.every(r => etabs.has(r.value)), `« ${q} » : ${etabs.size} établissements (avant : refus ; obtenu : ${e?.kind} ${rows.length})`);
  }
  const t = qo('quel établissement a le plus de BTS');
  assert(t?.kind === 'top' && (t.result.rows || [])[0]?.count === Math.max(...Object.values(OD.filter(o => o.fili === 'BTS').reduce((m, o) => (m[o.etab] = (m[o.etab] || 0) + 1, m), {}))), 'faux positif : « quel établissement a le plus de BTS » reste un classement');
  const c = qo('combien d\'établissements proposent un BTS MCO');
  assert(c?.kind === 'count' && c.result.count === etabs.size, '« combien d\'établissements » : établissements différents (inchangé)');
});

await describe('« vœux confirmés … à Bordeaux Montaigne » : l\'établissement, pas la commune', () => {
  const OD2 = D.openData(1500, 17);
  const base = OD2.find(o => o.fili === 'Licence');
  const ajout = (etab, commune, fil_det, detail, voe) => OD2.push({ ...base, etab, commune, dep: 'Gironde', aca: 'Bordeaux', region: 'Nouvelle-Aquitaine', fil_det, detail, nom: `${fil_det} - ${detail}`, form: 'Licence - Lettres, langues, arts', voe });
  ajout('Université Bordeaux Montaigne', 'Pessac', 'Licence - Histoire', 'Histoire', 2100);
  ajout('Université Bordeaux Montaigne', 'Pessac', 'Licence - Géographie et aménagement', 'Géographie', 900);
  ajout('Université de Bordeaux', 'Bordeaux', 'Licence - Histoire', 'Histoire', 400);
  ajout('Lycée Montaigne', 'Bordeaux', 'Licence - Histoire', 'Histoire', 50);
  const c2 = makeCtx();
  c2.__t = D.tableOpenData(OD2);
  run(c2, "defaultOpenDataTable = __t; defaultOpenDataState = 'ready';");
  const q2 = asker(c2);
  const HIST = o => o.fili === 'Licence' && o.fil_det === 'Licence - Histoire';
  const somme = f => OD2.filter(f).reduce((t, o) => t + Number(o.voe || 0), 0);
  const attendu = somme(o => HIST(o) && o.etab === 'Université Bordeaux Montaigne');
  for (const q of ['combien de voeux confirmés par les candidats en licence d\'histoire à Bordeaux Montaigne ?', 'combien de vœux en licence d\'histoire à Bordeaux Montaigne', 'combien de vœux confirmés en licence d\'histoire à Bordeaux Montaigne']) {
    const e = q2(q);
    assert(e?.kind === 'sum' && e.result.sum === attendu && !(e.plan.filters || []).some(f => /^Commune/.test(f.col)), `« ${q} » : ${attendu} (avant : arrêt ; obtenu : ${e?.kind} ${e?.result?.sum})`);
  }
  const b = q2('combien de candidats en licence d\'histoire à Bordeaux');
  assert(b?.kind === 'sum' && b.result.sum === somme(o => HIST(o) && o.commune === 'Bordeaux'), 'faux positif : « à Bordeaux » seul reste la commune');
  assert(q2('combien de formations à Bordeaux')?.result?.count === OD2.filter(o => o.commune === 'Bordeaux').length, 'faux positif : « formations à Bordeaux »');
  assert(q2('combien de BTS à Bordeaux en Gironde')?.result?.count === OD2.filter(o => o.fili === 'BTS' && o.commune === 'Bordeaux' && o.dep === 'Gironde').length, 'faux positif : « à Bordeaux en Gironde »');
  const l = q2('combien de licences au lycée Montaigne');
  assert(l?.result?.count === OD2.filter(o => o.fili === 'Licence' && o.etab === 'Lycée Montaigne').length, 'faux positif : « lycée Montaigne » reste le lycée');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
