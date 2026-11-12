// test_serie8.js — Série 8 : classements, tableaux croisés, statistiques par groupe, rapports.
// Réponses fausses données comme exactes (avant) :
// - « nombre moyen de vœux par série » : une seule moyenne (« par série » ignoré) ;
// - « nombre de candidats par série et par département » : série × type de la classe ;
// - « tableau croisé boursier par série » : boursiers seuls, croisés avec une colonne prise au hasard ;
// - « classement des lycées par nombre d'admis en CPGE » : les spécialités de CPGE présentées comme des lycées ;
// - « nombre de candidats par place en BTS » : une répartition par filière.
// Non traitées (avant : arrêt ou Albert) : « quel département a le moins de licences », « classement des régions par
// nombre de PASS », « quels lycées ont le plus d'admis ».
// Données FICTIVES (js/fixtures/donnees_simulees.mjs) ; chaque valeur attendue est recalculée sur les lignes.
// node js/test_serie8.js

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


const grouper = (rows, cle) => { const m = {}; rows.forEach(r => { const k = cle(r); if (k === '' || k == null) return; m[k] = (m[k] || 0) + 1; }); return m; };
const lignes = e => Object.fromEntries((e?.result?.rows || []).map(r => [r.value, r.count]));
const memeObjet = (a, b) => Object.keys(a).length === Object.keys(b).length && Object.entries(b).every(([k, v]) => a[k] === v);
const premiers = (m, k, asc = false) => Object.entries(m).sort((a, b) => (asc ? a[1] - b[1] : b[1] - a[1]) || a[0].localeCompare(b[0], 'fr')).slice(0, k);

// ── Open data ──
const OD = D.openData(3000, 17);
const co = makeCtx();
co.__t = D.tableOpenData(OD);
run(co, "defaultOpenDataTable = __t; defaultOpenDataState = 'ready';");
const qo = asker(co);

await describe('Open data : classements, « le moins de », rapports', () => {
  const t = qo('quelle académie a le plus de BTS');
  const att = premiers(grouper(OD.filter(o => o.fili === 'BTS'), o => o.aca), 1)[0];
  assert(t?.kind === 'top' && t.result.rows[0].value === att[0] && t.result.rows[0].count === att[1], `académie avec le plus de BTS : ${att.join(' ')}`);
  const m = qo('quel département a le moins de licences');
  const tous = Object.fromEntries([...new Set(OD.map(o => o.dep))].map(d => [d, 0]));
  OD.filter(o => o.fili === 'Licence').forEach(o => { tous[o.dep]++; });
  const bas = premiers(tous, 3, true);
  assert(m?.kind === 'top' && m.plan.croissant && JSON.stringify(m.result.rows.slice(0, 3).map(r => [r.value, r.count])) === JSON.stringify(bas), `le moins de licences : ${bas.map(x => x.join(' ')).join(', ')} (obtenu : ${m?.kind} ${JSON.stringify(m?.result?.rows?.slice(0, 3))} ; avant : Albert)`);
  assert(/moins fréquentes/.test(m.html) && !/plus fréquentes/.test(m.html), 'texte : « les moins fréquentes »');
  const z = qo('quelle région a le moins de PASS');
  const tz = Object.fromEntries([...new Set(OD.map(o => o.region))].map(d => [d, 0]));
  OD.filter(o => /PASS/.test(o.nom)).forEach(o => { tz[o.region]++; });
  assert(z?.kind === 'top' && z.result.rows[0].count === Math.min(...Object.values(tz)), `les groupes à 0 comptent (minimum : ${Math.min(...Object.values(tz))} ; obtenu : ${z?.result?.rows?.[0]?.count})`);
  const c = qo('classement des régions par nombre de PASS');
  assert(c?.kind === 'top' && memeObjet(lignes(c), Object.fromEntries(Object.entries(tz).filter(([, v]) => v > 0))), `« classement des régions par nombre de PASS » (avant : arrêt ; obtenu : ${c?.kind})`);
  const r = qo('nombre de candidats par place en BTS');
  const B = OD.filter(o => o.fili === 'BTS');
  const ratio = B.reduce((a, o) => a + o.voe, 0) / B.reduce((a, o) => a + o.capa, 0);
  assert(r?.kind === 'ratio' && Math.abs(r.result.valeur - ratio) < 1e-9 && /1 212 formations retenues/.test(r.html.replace(/ | /g, ' ')), `candidats par place en BTS : ${ratio.toFixed(2)} (obtenu : ${r?.kind} ${r?.result?.valeur} ; avant : une répartition par filière)`);
  const a = qo('combien d\'admis par place en CPGE en Gironde');
  const C = OD.filter(o => o.fili === 'CPGE' && o.dep === 'Gironde');
  assert(a?.kind === 'ratio' && Math.abs(a.result.valeur - C.reduce((s, o) => s + o.acc, 0) / C.reduce((s, o) => s + o.capa, 0)) < 1e-9, 'admis par place, avec filtres');
  const s = qo('nombre moyen de candidats par formation en BTS');
  assert(s?.kind !== 'ratio', 'faux positif : « par formation » n\'est pas un rapport par place');
});

await describe('Open data : tableaux croisés et moyennes par groupe (faux positifs)', () => {
  const p = qo('nombre de BTS par académie et par statut');
  assert(p?.kind === 'pivot' && /^Académie/.test(p.plan.targetCol) && /^Statut/.test(p.plan.targetCol2), 'BTS par académie et par statut : académie × statut');
  const g = qo('taux d\'accès moyen des BTS par académie');
  assert(g?.kind === 'stats_groupes' && /^Académie/.test(g.result.dim), 'taux d\'accès moyen par académie : une moyenne par académie');
});

// ── Fichier de candidats ──
const ROWS = D.exportAcademique(3000, 21);
const L = ROWS.slice(1);
const H = D.EXPORT_ACADEMIQUE_ENTETES;
const cf = makeCtx();
cf.XLSX.read = () => ({ SheetNames: ['BDD'], Sheets: { BDD: 'ws' } });
cf.XLSX.utils.sheet_to_json = () => ROWS.map(r => r.slice());
await run(cf, 'importSpreadsheetFile')({ name: 'BDD.xlsx', size: 1000, arrayBuffer: async () => new ArrayBuffer(8) });
const qf = asker(cf);
const DEP = 0, ETAB = 4, ADM = 7, APP = 8, BOURS = 9, SERIE = 13, VOEUX = 16, GRP = 17;

await describe('Fichier de candidats : moyenne « par X »', () => {
  const e = qf('moyenne des vœux par série');
  const parSerie = {};
  L.forEach(r => { const v = Number(r[VOEUX]); if (!Number.isFinite(v) || r[VOEUX] === '') return; (parSerie[r[SERIE]] = parSerie[r[SERIE]] || []).push(v); });
  const ok = e?.kind === 'stats_groupes' && e.result.dim === H[SERIE] && e.result.groupes.every(g => Math.abs(g.avg - parSerie[g.valeur].reduce((a, b) => a + b, 0) / parSerie[g.valeur].length) < 1e-9);
  assert(ok, `moyenne des vœux par série : une moyenne par série (avant : une seule moyenne ; obtenu : ${e?.kind} ${e?.result?.dim})`);
  const x = qf('nombre moyen de vœux par couleur');
  assert(x?.kind === 'unresolved', '« par couleur » (aucune colonne) : arrêt, pas une moyenne d\'ensemble');
  const u = qf('nombre moyen de vœux par candidat');
  assert(u?.kind === 'stats' && !u.result.groupes, 'faux positif : « par candidat » = la moyenne d\'ensemble');
});

await describe('Fichier de candidats : tableaux croisés', () => {
  const p = qf('nombre de candidats par série et par département');
  assert(p?.kind === 'pivot' && p.plan.targetCol === H[SERIE] && p.plan.targetCol2 === H[DEP], `série × département (avant : série × type de la classe ; obtenu : ${p?.plan?.targetCol} × ${p?.plan?.targetCol2})`);
  const b = qf('tableau croisé boursier par série');
  assert(b?.kind === 'pivot' && b.plan.targetCol === H[BOURS] && b.plan.targetCol2 === H[SERIE] && !(b.plan.filters || []).length, 'boursier × série, sans filtre « boursiers » (les deux états)');
  const g = qf('tableau croisé des boursiers de Gironde par série');
  const att = grouper(L.filter(r => r[BOURS] === 'Boursier des lycées' && r[DEP] === 'Gironde'), r => r[SERIE]);
  assert(g?.kind === 'group_by' && memeObjet(lignes(g), att), `une seule dimension nommée : répartition par série des boursiers de Gironde (avant : croisement avec une colonne prise au hasard ; obtenu : ${g?.kind})`);
});

await describe('Fichier de candidats : classements de lycées', () => {
  const att = premiers(grouper(L.filter(r => r[ADM] === 'Oui' && r[GRP] === 'CPGE - CPES'), r => r[ETAB]), 3);
  for (const q of ['classement des lycées par nombre d\'admis en CPGE', 'quels lycées ont le plus d\'admis en CPGE']) {
    const e = qf(q);
    assert(e?.kind === 'top' && e.plan.targetCol === H[ETAB] && JSON.stringify(e.result.rows.slice(0, 3).map(r => [r.value, r.count])) === JSON.stringify(att), `« ${q} » : ${att.map(x => x.join(' ')).join(', ')} (obtenu : ${e?.kind} ${e?.plan?.targetCol})`);
  }
  const a = qf('quels lycées ont le plus d\'apprentis');
  const aa = premiers(grouper(L.filter(r => r[APP] === 'Oui'), r => r[ETAB]), 1)[0];
  assert(a?.kind === 'top' && a.result.rows[0].count === aa[1], `le plus d'apprentis : ${aa.join(' ')}`);
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
