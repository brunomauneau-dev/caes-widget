// test_serie9.js — Série 9 : la table Grist comme source, et le passage d'une source à l'autre.
// Une table Grist arrive avec les IDENTIFIANTS de colonnes (« Boursier_des_lycees »,
// « A_actuellement_repondu_favorablement_a_une_proposition_Oui_Non_ ») et parfois des cases à cocher (true / false).
// Règle : les mêmes questions donnent les mêmes chiffres qu'avec le fichier Excel ; un changement de source remet le
// contexte à zéro (aucun filtre d'une source appliqué à une autre).
// Données FICTIVES (js/fixtures/donnees_simulees.mjs) ; chaque valeur attendue est recalculée sur les lignes.
// node js/test_serie9.js

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
  ctx.resetContextSilent = () => { vm.runInContext('window.__DATA_ENGINE_STATE = { lastPlan: null, lastExecution: null, history: [] }', ctx); };
  return ctx;
}
const run = (ctx, code) => vm.runInContext(code, ctx);
const asker = ctx => (q, suite = false) => {
  if (!suite) run(ctx, 'window.__DATA_ENGINE_STATE = { lastPlan: null, lastExecution: null, history: [] }');
  ctx.__q = q;
  const plan = run(ctx, 'isDataEngineQuestion(__q)') ? run(ctx, 'detectDataEnginePlan(__q)') : null;
  return plan ? run(ctx, 'runDataEnginePlan')(plan, []) : null;
};


function valeur(e) {
  if (!e) return 'pas de calcul';
  if (e.kind === 'unresolved') return 'arrêt';
  if (e.kind === 'count') return e.result.count;
  if (e.kind === 'sum') return e.result.sum;
  if (e.kind === 'part') return `${e.result.num}/${e.result.den}`;
  if (e.kind === 'stats') return Math.round(e.result.avg * 1000) / 1000;
  if (['group_by', 'top'].includes(e.kind)) return Object.fromEntries((e.result.rows || []).map(r => [r.value, r.count]));
  if (e.kind === 'part_groupes') return (e.result.groupes || e.result.lignes || []).map(g => `${g.valeur ?? g.value}:${g.num}/${g.den}`).sort().join(' ');
  if (e.kind === 'stats_groupes') return e.result.groupes.map(g => `${g.valeur}:${Math.round(g.avg * 1000)}`).sort().join(' ');
  return e.kind;
}
const egal = (a, b) => JSON.stringify(a) === JSON.stringify(b) || (a && b && typeof a === 'object' && typeof b === 'object' && Object.keys(a).length === Object.keys(b).length && Object.entries(b).every(([k, v]) => a[k] === v));

const ROWS = D.exportAcademique(3000, 21);
const H = D.EXPORT_ACADEMIQUE_ENTETES;
const L = ROWS.slice(1);
// v27.5.82 — définition SAIO : un « candidat » a confirmé au moins un vœu (colonne 16 non vide et ≥ 1). Les questions qui
// disent « candidats », et les taux de proposition / d'admission, portent sur LC ; les autres sur tout le fichier (L).
const CAND = r => String(r[16] ?? '').trim() !== '' && Number(r[16]) >= 1;
const LC = L.filter(CAND);
const nfc = f => LC.filter(f).length;
// identifiant de colonne Grist : sans accents (« œ » → « oe »), caractères non alphanumériques → « _ »
const colId = h => h.replace(/œ/g, 'oe').replace(/Œ/g, 'OE').replace(/æ/g, 'ae').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+/, '') || 'A';
const IDS = H.map(colId);
function enregistrements({ booleens = false, choixMultiples = false, colonnesAB = false } = {}) {
  const lettre = k => String.fromCharCode(65 + k);
  const recs = L.map((r, i) => {
    const o = { id: i + 1, manualSort: i + 1 };
    H.forEach((h, k) => {
      if (!h) return;
      let v = r[k];
      if (booleens && /^(Oui|Non)$/.test(v) && /proposition|favorablement|Apprenti/.test(h)) v = v === 'Oui';
      // colonne « liste de choix » de Grist : ['L', 'choix 1', 'choix 2'] (ou null si vide)
      if (choixMultiples && /Enseignement/.test(h)) v = v ? ['L', ...String(v).split(' | ')] : null;
      o[colonnesAB ? lettre(k) : IDS[k]] = v;
    });
    return o;
  });
  // import d'un Excel dans Grist sans en-têtes reconnus : colonnes A, B, C… et intitulés dans la première ligne
  if (colonnesAB) recs.unshift(Object.fromEntries([['id', 0], ['manualSort', 0], ...H.map((h, k) => h ? [lettre(k), h] : null).filter(Boolean)]));
  return recs;
}
async function ctxFichier() {
  const ctx = makeCtx();
  ctx.XLSX.read = () => ({ SheetNames: ['BDD'], Sheets: { BDD: 'ws' } });
  ctx.XLSX.utils.sheet_to_json = () => ROWS.map(r => r.slice());
  await run(ctx, 'importSpreadsheetFile')({ name: 'BDD.xlsx', size: 1000, arrayBuffer: async () => new ArrayBuffer(8) });
  return ctx;
}
function ctxGrist(opts) {
  const ctx = makeCtx();
  ctx.__recs = enregistrements(opts);
  run(ctx, 'gristRecords = __recs; setActiveSource("grist");');
  return ctx;
}

const QUESTIONS = [
  'combien de candidats de Pau',
  'combien de boursiers admis en CPGE',
  'combien de candidats ont eu une proposition',
  'combien de candidats sans proposition',
  'combien d\'apprentis admis en BTS',
  'combien de candidats admis hors académie',
  'combien de candidats de Gironde admis à Bordeaux',
  'combien de candidats du lycée Montaigne',
  'combien de bacheliers technologiques boursiers',
  'combien de candidats du privé',
  'combien de candidats ayant suivi SVT admis en PASS',
  'combien de candidats avec plus de 10 vœux',
  'taux de proposition des boursiers',
  'taux d\'admission des boursiers et des non boursiers',
  'répartition des admis par grand groupe de formation',
  'quels lycées ont le plus d\'admis en CPGE',
  'nombre moyen de vœux par série',
  'combien de candidats de Pau, Talence et Bayonne',
];

const cf = await ctxFichier();
const af = asker(cf);
const reference = Object.fromEntries(QUESTIONS.map(q => [q, valeur(af(q))]));

await describe('Contrôle : réponses du fichier Excel (déjà vérifiées par les séries précédentes)', () => {
  assert(reference['combien de candidats de Pau'] === LC.filter(r => r[2] === 'Pau').length, 'candidats de Pau : valeur recalculée sur les lignes');
  assert(reference['combien de boursiers admis en CPGE'] === L.filter(r => r[9] === 'Boursier des lycées' && r[7] === 'Oui' && r[17] === 'CPGE - CPES').length, 'boursiers admis en CPGE : valeur recalculée sur les lignes');
  assert(Object.values(reference).every(v => v !== 'arrêt' && v !== 'pas de calcul'), 'toutes les questions sont calculées sur le fichier');
});

for (const [nom, opts] of [['identifiants de colonnes Grist', {}], ['identifiants + cases à cocher (true / false)', { booleens: true }],
  ['spécialités en liste de choix (ChoiceList)', { choixMultiples: true }], ['colonnes A, B, C… (intitulés dans la 1re ligne)', { colonnesAB: true }]]) {
  await describe(`Table Grist : ${nom}`, () => {
    const cg = ctxGrist(opts);
    assert(run(cg, 'getActiveSourceKind()') === 'grist' && run(cg, 'getActiveQueryTables()[0].source') === 'Grist', 'la table Grist est la source active');
    const ag = asker(cg);
    for (const q of QUESTIONS) {
      const v = valeur(ag(q));
      assert(egal(v, reference[q]), `« ${q} » : même chiffre qu'avec le fichier Excel ${JSON.stringify(reference[q]).slice(0, 50)} (obtenu : ${JSON.stringify(v).slice(0, 50)})`);
    }
  });
}

// ── Open data Parcoursup importé dans une table Grist (une ligne = une formation) ──
const ODL = D.openData(3000, 17);
const tOD = D.tableOpenData(ODL);
const QUESTIONS_OD = [
  'combien de BTS en Gironde', 'nombre de places en CPGE à Bordeaux', 'taux d\'accès moyen des BTS', 'combien de formations sélectives en Gironde',
  'combien de formations en Gironde sauf les BTS', 'quelle académie a le plus de BTS', 'combien de BTS avec un taux d\'accès > 80 %',
  'part des boursiers parmi les admis en BTS', 'combien de BUT dans les académies de Bordeaux, Toulouse et Poitiers', 'nombre de candidats par place en BTS',
  'les 5 académies avec le plus de places en BTS', 'taux d\'accès moyen des BTS par académie',
];
const vOD = e => e?.kind === 'ratio' ? Math.round(e.result.valeur * 1e6) : e?.kind === 'classement' ? (e.result.lignes || []).map(l => `${l.libelle ?? l.nom ?? ''}:${l.valeur}`).join(' ') : valeur(e);
const co = makeCtx();
co.__t = tOD;
run(co, "defaultOpenDataTable = __t; defaultOpenDataState = 'ready';");
const refOD = Object.fromEntries(QUESTIONS_OD.map(q => [q, vOD(asker(co)(q))]));
await describe('Table Grist contenant l\'open data (identifiants de colonnes)', () => {
  const cg = makeCtx();
  cg.__recs = tOD.objects.map((o, i) => Object.fromEntries([['id', i + 1], ...tOD.headers.map(h => [colId(h), o[h]])]));
  run(cg, 'gristRecords = __recs; setActiveSource("grist");');
  const ag = asker(cg);
  for (const q of QUESTIONS_OD) {
    const v = vOD(ag(q));
    assert(egal(v, refOD[q]), `« ${q} » : même chiffre que l'open data ${JSON.stringify(refOD[q]).slice(0, 50)} (obtenu : ${JSON.stringify(v).slice(0, 50)})`);
  }
});

await describe('Fichier Excel contenant l\'open data', async () => {
  const cx = makeCtx();
  const aoa = [tOD.headers, ...tOD.objects.map(o => tOD.headers.map(h => o[h]))];
  cx.XLSX.read = () => ({ SheetNames: ['fr-esr-parcoursup'], Sheets: { 'fr-esr-parcoursup': 'ws' } });
  cx.XLSX.utils.sheet_to_json = () => aoa.map(r => r.slice());
  await run(cx, 'importSpreadsheetFile')({ name: 'fr-esr-parcoursup.xlsx', size: 1000, arrayBuffer: async () => new ArrayBuffer(8) });
  assert(run(cx, 'getActiveQueryTables()[0].rowUnit') === 'formation', 'reconnu : une ligne = une formation');
  const ax = asker(cx);
  for (const q of ['nombre de places en CPGE à Bordeaux', 'combien d\'admis en BTS en Gironde']) {
    const v = vOD(ax(q)), r = vOD(asker(co)(q));
    assert(egal(v, r), `« ${q} » : ${r} comme l'open data (obtenu : ${v} ; avant : le nombre de formations)`);
  }
  const cand = await ctxFichier();
  assert(run(cand, 'getActiveQueryTables()[0].rowUnit') === undefined, 'faux positif : un fichier de candidats n\'est pas « une ligne = une formation »');
});

await describe('Changer de source en cours de conversation', async () => {
  const ctx = await ctxFichier();
  ctx.__recs = enregistrements();
  run(ctx, 'gristRecords = __recs;');
  ctx.__t = D.tableOpenData(D.openData(2000, 17));
  run(ctx, "defaultOpenDataTable = __t; defaultOpenDataState = 'ready';");
  const ask = asker(ctx);
  // fichier : « candidats de Pau »
  const a = ask('combien de candidats de Pau');
  assert(a?.result?.count === reference['combien de candidats de Pau'], 'fichier : candidats de Pau');
  // passage à l'open data : la relance ne reprend pas le filtre du fichier
  run(ctx, 'setActiveSource("opendata")');
  const b = ask('et en Gironde ?', true);
  const OD = ctx.__t.objects;
  assert(!b || b.kind === 'unresolved' || (b.plan.table.source === 'Open data' && !(b.plan.filters || []).some(f => /scolarit/.test(f.col))), `open data : aucun filtre du fichier repris (obtenu : ${b?.kind} ${JSON.stringify((b?.plan?.filters || []).map(f => f.col))})`);
  const c = ask('combien de BTS en Gironde', true);
  assert(c?.kind === 'count' && c.result.count === OD.filter(o => o["Filière de formation très agrégée"] === 'BTS' && o["Département de l'établissement"] === 'Gironde').length, 'open data : nouvelle question calculée sur l\'open data');
  // passage à Grist : « combien de places ? » ne reprend pas les BTS de l'open data
  run(ctx, 'setActiveSource("grist")');
  const d = ask('combien de candidats admis ?', true);
  assert(d?.plan?.table?.source === 'Grist' && !(d.plan.filters || []).some(f => /Fili|BTS/.test(String(f.col) + String(f.value))), `Grist : rien de l'open data (obtenu : ${JSON.stringify((d?.plan?.filters || []).map(f => [f.col, f.value]))})`);
  // retour au fichier puis retrait : open data
  run(ctx, 'setActiveSource("file")');
  assert(ask('combien de candidats de Pau')?.result?.count === reference['combien de candidats de Pau'], 'retour au fichier : même chiffre');
  run(ctx, 'clearImportedFile()');
  assert(run(ctx, 'getActiveSourceKind()') === 'opendata', 'fichier retiré : retour à l\'open data');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
