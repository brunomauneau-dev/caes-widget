// test_definition_candidats.js — Définition SAIO des « candidats » dans un fichier académique (v27.5.82).
// Le fichier académique contient tout le vivier des terminales, y compris les élèves qui n'ont confirmé aucun vœu.
// Pour le SAIO, un candidat a confirmé au moins un vœu (bilan 2025 : 29 543 candidats, pas les 35 286 lignes du fichier).
// Règle : « candidats » (et les taux de proposition / d'admission) = au moins un vœu, annoncé sous la réponse ;
// « élèves », « lignes », « y compris sans vœu » = tout le fichier ; « combien de boursiers » = tout le fichier, avec une note
// qui dit combien n'ont pas de vœu. Open data (une ligne = une formation) : inchangé.
// Données FICTIVES (js/fixtures/donnees_simulees.mjs) ; chaque valeur attendue est recalculée sur les lignes.
// node js/test_definition_candidats.js

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
  for (const f of ['config.js', 'knowledge.js', 'documents.js', 'planner.js', 'dataEngine.js', 'sessions.js', 'retours.js', 'verification.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
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

// vivier : élèves sans vœu (case vide), comme dans le vrai fichier
const H = D.EXPORT_ACADEMIQUE_ENTETES;
const ROWS = D.exportAcademique(3000, 21);
const L = ROWS.slice(1);
const PROP = 6, ADM = 7, BOURS = 9, TYPE = 12, VX = 16, DEP = 0, ACA = 18, GRP = 17;
const V = r => String(r[VX] ?? '').trim() !== '' && Number(r[VX]) >= 1;
const B = r => r[BOURS] === 'Boursier des lycées';
const nf = f => L.filter(f).length;               // tout le fichier
const nc = f => L.filter(r => V(r) && f(r)).length; // candidats au sens du SAIO
async function fichier(rows) {
  const c = makeCtx();
  c.XLSX.read = () => ({ SheetNames: ['BDD'], Sheets: { BDD: 'ws' } });
  c.XLSX.utils.sheet_to_json = () => rows.map(r => r.slice());
  await run(c, 'importSpreadsheetFile')({ name: 'BDD.xlsx', size: 1000, arrayBuffer: async () => new ArrayBuffer(8) });
  return c;
}
const cf = await fichier(ROWS);
const qf = asker(cf);
const texte = e => String(e?.html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const titre = e => (String(e?.html || '').match(/<h\d[^>]*>([\s\S]*?)<\/h\d>/) || [, ''])[1].replace(/<[^>]+>/g, '').trim() || texte(e).slice(0, 40);
const univ = e => (e?.plan?.filters || []).some(f => f.univers);
const sans = nf(r => !V(r));

await describe('« candidats » = élèves ayant confirmé au moins un vœu', () => {
  assert(sans > 0 && sans < L.length, `jeu de données : ${sans} élèves sans vœu sur ${L.length}`);
  const e = qf('combien de candidats');
  assert(e?.kind === 'count' && e.result.count === nf(V), `« combien de candidats » : ${nf(V)} (avant : ${L.length}, tout le fichier ; obtenu : ${e?.result?.count})`);
  assert(/définition SAIO/.test(texte(e)) && new RegExp(`${sans.toLocaleString('fr-FR')} élèves sans vœu confirmé ne sont pas comptés`).test(texte(e)), 'la réponse dit la définition et combien d\'élèves sont laissés de côté');
  assert(!/— 1\b/.test(titre(e)) && /candidats/.test(titre(e)), `titre sans « — 1 » (obtenu : ${titre(e)})`);
  assert(qf('combien de candidats boursiers')?.result?.count === nc(B), 'candidats boursiers');
  assert(qf('combien de candidats admis')?.result?.count === nc(r => r[ADM] === 'Oui'), 'candidats admis');
  assert(qf('combien de candidats de Gironde')?.result?.count === nc(r => r[DEP] === 'Gironde'), 'candidats de Gironde');
  const g = qf('combien de candidats par type de classe');
  const attendu = {}; L.filter(V).forEach(r => { attendu[r[TYPE]] = (attendu[r[TYPE]] || 0) + 1; });
  assert(g?.kind === 'group_by' && (g.result.rows || []).every(x => attendu[x.value] === x.count), 'répartition des candidats par type de classe');
});

await describe('« élèves », « lignes », « y compris sans vœu » : tout le fichier', () => {
  for (const q of ['combien d\'élèves', 'combien de lignes', 'combien de candidats y compris sans vœu']) {
    const e = qf(q);
    assert(e?.kind === 'count' && e.result.count === L.length && !univ(e), `« ${q} » : ${L.length}`);
  }
  const e = qf('combien d\'élèves');
  assert(/élèves/.test(titre(e)) && !/candidats/.test(titre(e)), `« combien d'élèves » : le titre dit « élèves » (obtenu : ${titre(e)})`);
  assert(new RegExp(`dont ${sans.toLocaleString('fr-FR')} élèves sans vœu confirmé`).test(texte(e)), 'la note dit combien n\'ont pas de vœu');
});

await describe('Sans le mot « candidats » : tout le fichier, avec une note', () => {
  const e = qf('combien de boursiers');
  assert(e?.result?.count === nf(B) && !univ(e), `« combien de boursiers » : ${nf(B)}, tous les boursiers`);
  assert(new RegExp(`dont ${nf(r => B(r) && !V(r)).toLocaleString('fr-FR')} élèves? sans vœu confirmé`).test(texte(e)) && /ajoutez « candidats »/.test(texte(e)), 'la note dit combien de boursiers n\'ont pas de vœu');
  assert(qf('combien de bacheliers généraux')?.result?.count === nf(r => r[TYPE] === 'Générale'), '« combien de bacheliers généraux » : inchangé');
});

await describe('Taux : la définition du SAIO au numérateur ET au dénominateur', () => {
  const t = qf('taux de proposition des bacheliers généraux');
  assert(t?.kind === 'part' && t.result.num === nc(r => r[TYPE] === 'Générale' && r[PROP] === 'Oui') && t.result.den === nc(r => r[TYPE] === 'Générale'), `taux de proposition des généraux : parmi les candidats (obtenu : ${t?.result?.num}/${t?.result?.den})`);
  const a = qf('taux d\'admission des boursiers');
  assert(a?.kind === 'part' && a.result.den === nc(B), 'taux d\'admission des boursiers : parmi les boursiers candidats');
  const h = qf('part des candidats de Gironde admis hors académie');
  assert(h?.kind === 'part' && h.result.den === nc(r => r[DEP] === 'Gironde') && h.result.num === nc(r => r[DEP] === 'Gironde' && r[ACA] !== '' && r[ACA] !== 'Bordeaux'), `hors académie : dénominateur = candidats de Gironde (obtenu : ${h?.result?.num}/${h?.result?.den})`);
  const p = qf('part des élèves ayant reçu une proposition');
  assert(p?.kind === 'part' && p.result.den === L.length, 'faux positif : « part des élèves » = tout le fichier');
});

await describe('Comparaisons', () => {
  const c = qf('comparer les candidats boursiers et non boursiers');
  assert(c?.kind === 'compare' && c.result.rows[0].count === nc(B), `candidats boursiers contre non boursiers : ${nc(B)} (obtenu : ${c?.result?.rows?.[0]?.count})`);
  const d = qf('comparer boursiers et non boursiers');
  assert(d?.kind === 'compare' && d.result.rows[0].count === nf(B), 'faux positif : sans « candidats », tous les boursiers');
});

await describe('Questions qui s\'enchaînent', () => {
  qf('combien de candidats');
  const b = qf('et parmi eux combien de boursiers ?', true);
  assert(b?.result?.count === nc(B), `« combien de candidats » >> « parmi eux combien de boursiers » : ${nc(B)} (obtenu : ${b?.result?.count})`);
  qf('combien de candidats');
  const e = qf('combien d\'élèves', true);
  assert(e?.result?.count === L.length && !univ(e), '« combien de candidats » >> « combien d\'élèves » : tout le fichier');
});

await describe('Faux positifs : conditions sur les vœux, autres fichiers', async () => {
  const c5 = qf('combien de candidats avec plus de 10 vœux');
  assert(c5?.result?.count === nf(r => V(r) && Number(r[VX]) > 10) && (c5.plan.filters || []).filter(f => f.col === H[VX]).length === 1, '« plus de 10 vœux » : une seule condition sur les vœux');
  assert(qf('combien de candidats ont confirmé au moins un vœu')?.result?.count === nf(V), '« au moins un vœu » explicite : même chiffre');
  const s = qf('combien de candidats sans vœu');
  assert(s?.kind === 'unresolved', `« candidats sans vœu » : pas de chiffre (cases vides, le fichier ne dit pas « 0 ») ; obtenu : ${s?.kind}`);
  assert(qf('combien de vœux au total')?.result?.sum === L.reduce((t, r) => t + (V(r) ? Number(r[VX]) : 0), 0), 'total des vœux inchangé');
  // fichier où tous les élèves ont au moins un vœu : aucun filtre ajouté
  const plein = await fichier(ROWS.map((r, i) => i === 0 ? r : r.map((x, k) => k === VX && !V(r) ? 3 : x)));
  const ep = asker(plein)('combien de candidats');
  assert(ep?.result?.count === L.length && !univ(ep), 'fichier sans élève sans vœu : rien ne change');
  // fichier sans colonne de vœux : rien ne change
  const sansCol = await fichier(ROWS.map(r => r.filter((x, k) => k !== VX)));
  const es = asker(sansCol)('combien de candidats');
  assert(es?.result?.count === L.length && !univ(es), 'fichier sans colonne de vœux : tout le fichier');
  // open data (une ligne = une formation) : inchangé
  const co = makeCtx();
  co.__t = D.tableOpenData(D.openData(1500, 17));
  run(co, "defaultOpenDataTable = __t; defaultOpenDataState = 'ready';");
  const eo = asker(co)('combien de candidats en BTS');
  assert(eo && !univ(eo) && !eo.plan?.universCandidats, `open data : pas de définition SAIO (obtenu : ${eo?.kind})`);
});

await describe('Double lecture : la définition n\'est pas un critère lu dans la question', () => {
  const e = qf('combien de candidats de Pau');
  const l = run(cf, 'lectureMoteurVerif')(e);
  assert(univ(e) && !Object.keys(l.filtres).some(k => /voeu/.test(k)) && Object.keys(l.filtres).length === 1, `lecture du moteur : seulement « Pau » (obtenu : ${JSON.stringify(l.filtres)})`);
  const c = qf('combien de candidats avec plus de 10 vœux');
  assert(Object.keys(run(cf, 'lectureMoteurVerif')(c).filtres).length === 1, 'faux positif : « plus de 10 vœux » reste un critère lu');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
