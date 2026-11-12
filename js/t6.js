// test_serie6.js — Série 6 : graphiques, exports Excel / CSV, comparaisons entre sessions (années).
// Un graphique montre les mêmes chiffres que le tableau ; un export contient exactement les lignes du calcul (filtres
// gardés, y compris en relance) ; une comparaison entre années rejoue le même calcul sur chaque session.
// Données FICTIVES (js/fixtures/donnees_simulees.mjs) ; chaque valeur attendue est recalculée sur les lignes.
// node js/test_serie6.js

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
    document: { getElementById: noopEl, querySelector: noopEl, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, click() {}, remove() {} }), body: { appendChild() {}, removeChild() {} } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, fetch: () => Promise.reject(new Error('hors ligne')),
    escapeHtml: s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  };
  ctx.__exporte = null;
  ctx.XLSX = { utils: { json_to_sheet: rows => { ctx.__exporte = rows; return { rows }; }, book_new: () => ({}), book_append_sheet() {}, sheet_to_csv: ws => { ctx.__exporte = ws.rows || ctx.__exporte; return ''; }, sheet_to_json: () => [], aoa_to_sheet: aoa => ({ aoa }), sheet_add_aoa() {} }, writeFile() {} };
  ctx.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} }; ctx.Blob = class { constructor(p) { this.p = p; } };
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


const OD25 = D.openData(3000, 3);
const OD24 = D.openData(2700, 44).map(o => ({ ...o, session: 2024 }));
const avecChamps = t => {
  const cles = Object.keys(D.OD);
  const headers = cles.map(k => D.OD[k]);
  return { ...t, headers, objects: t.objects.map(o => Object.fromEntries(cles.map((k, i) => [headers[i], o[D.OD[k]]]))),
    champs: Object.fromEntries(cles.map((k, i) => [headers[i], D.OD_API[k]])), libelles: Object.fromEntries(cles.map((k, i) => [D.OD_API[k], headers[i]])) };
};
const co = makeCtx();
co.__t25 = { ...avecChamps(D.tableOpenData(OD25)), session: 2025 };
co.__t24 = { ...avecChamps(D.tableOpenData(OD24, 'Parcoursup 2024 — France entière (open data)')), session: 2024, isDefault: false };
run(co, "defaultOpenDataTable = __t25; defaultOpenDataState = 'ready'; openDataSessions.set(2024, __t24);");
const qo = asker(co);
const n = (L, f) => L.filter(f).length;
const S = (L, f, k) => L.filter(f).reduce((t, o) => t + Number(o[k]), 0);
const grouper = (rows, cle) => { const m = {}; rows.forEach(r => { m[cle(r)] = (m[cle(r)] || 0) + 1; }); return m; };
const lignesGroupes = e => Object.fromEntries((e?.result?.rows || []).map(r => [r.value, r.count]));
const memeObjet = (a, b) => Object.keys(a).length === Object.keys(b).length && Object.entries(b).every(([k, v]) => a[k] === v);
const bts = o => o.fili === 'BTS', btsG = o => o.fili === 'BTS' && o.dep === 'Gironde';
const conv = qs => qs.map((q, i) => qo(q, i > 0));

await describe('Graphiques : mêmes chiffres que le calcul', () => {
  const g = qo('graphique des BTS par département');
  assert(g?.kind === 'group_by' && g.plan.renderChart && memeObjet(lignesGroupes(g), grouper(OD25.filter(bts), o => o.dep)), 'graphique des BTS par département : un graphique, les effectifs de chaque département');
  const c = qo('camembert de la répartition des formations par filière');
  assert(c?.plan?.renderChart && c.plan.chartType === 'pie' && memeObjet(lignesGroupes(c), grouper(OD25, o => o.fili)), 'camembert : type « pie », effectifs par filière');
  const [a, b] = conv(['nombre de BTS par académie en Gironde', 'en graphique']);
  assert(b?.plan?.renderChart && memeObjet(lignesGroupes(b), lignesGroupes(a)) && (b.plan.filters || []).length === 2, `« en graphique » après un tableau : le même tableau en graphique (avant : toutes les formations de France ; obtenu : ${b?.kind} ${JSON.stringify(lignesGroupes(b)).slice(0, 50)})`);
  const [, h] = conv(['combien de BTS en Gironde', 'fais un graphique par académie']);
  assert(h?.plan?.renderChart && (h.plan.filters || []).length === 2 && memeObjet(lignesGroupes(h), grouper(OD25.filter(btsG), o => o.aca)), `« fais un graphique par académie » après un comptage : BTS de Gironde gardés (obtenu : ${JSON.stringify(lignesGroupes(h)).slice(0, 60)})`);
});

await describe('Exports : exactement les lignes du calcul', () => {
  co.__exporte = null;
  const e = qo('exporte les BTS de Gironde en Excel');
  assert(e?.kind === 'export' && co.__exporte?.length === n(OD25, btsG), `export direct : ${n(OD25, btsG)} lignes (obtenu : ${co.__exporte?.length})`);
  co.__exporte = null;
  const [, r] = conv(['combien de BTS en Gironde', 'exporte en excel']);
  assert(r?.kind === 'export' && co.__exporte?.length === n(OD25, btsG), `« exporte en excel » après un comptage : les mêmes ${n(OD25, btsG)} lignes (obtenu : ${co.__exporte?.length})`);
  co.__exporte = null;
  const [, , r3] = conv(['combien de BTS en Gironde', 'et dans les Landes ?', 'exporte ces formations en Excel']);
  assert(r3?.kind === 'export' && co.__exporte?.length === n(OD25, o => o.fili === 'BTS' && o.dep === 'Landes'), `après une relance : les BTS des Landes (obtenu : ${co.__exporte?.length})`);
  co.__exporte = null;
  const x = qo('export csv des CPGE à Bordeaux');
  assert(x?.kind === 'export' && co.__exporte?.length === n(OD25, o => o.fili === 'CPGE' && o.commune === 'Bordeaux'), `export CSV : CPGE de Bordeaux (obtenu : ${co.__exporte?.length})`);
  co.__exporte = null;
  const [, t] = conv(['répartition des BTS par département', 'exporte ce tableau']);
  const att = grouper(OD25.filter(bts), o => o.dep);
  assert(t?.kind === 'export' && co.__exporte?.length === Object.keys(att).length, `« exporte ce tableau » : une ligne par département (${Object.keys(att).length} ; obtenu : ${co.__exporte?.length})`);
  co.__exporte = null;
  const s = qo('exporte les BTS avec un taux d\'accès > 80 %');
  assert(s?.kind === 'export' && co.__exporte?.length === n(OD25, o => o.fili === 'BTS' && o.taux > 80), `export avec condition chiffrée : ${n(OD25, o => o.fili === 'BTS' && o.taux > 80)} lignes (obtenu : ${co.__exporte?.length})`);
});

await describe('Comparaisons entre sessions', () => {
  const v = e => (e?.result?.lignes || []).map(l => [l.session, l.valeur]);
  let e = qo('évolution du nombre de BTS en Gironde depuis 2024');
  assert(e?.kind === 'evolution' && JSON.stringify(v(e)) === JSON.stringify([[2024, n(OD24, btsG)], [2025, n(OD25, btsG)]]), `BTS en Gironde : ${n(OD24, btsG)} → ${n(OD25, btsG)} (obtenu : ${JSON.stringify(v(e))})`);
  e = qo('combien de places en CPGE en 2024 et en 2025');
  assert(e?.kind === 'evolution' && JSON.stringify(v(e)) === JSON.stringify([[2024, S(OD24, o => o.fili === 'CPGE', 'capa')], [2025, S(OD25, o => o.fili === 'CPGE', 'capa')]]), `places en CPGE 2024 et 2025 (obtenu : ${e?.kind} ${JSON.stringify(v(e))})`);
  const [, l] = conv(['combien de BTS en Gironde', 'et l\'an dernier ?']);
  assert(l?.kind === 'count' && l.result.count === n(OD24, btsG), `« et l'an dernier ? » : BTS de Gironde en 2024, ${n(OD24, btsG)} (obtenu : ${l?.kind} ${l?.result?.count})`);
  const [, g2] = conv(['combien de BTS en 2024', 'et en Gironde ?']);
  assert(g2?.kind === 'count' && g2.result.count === n(OD24, btsG), `« combien de BTS en 2024 » puis « et en Gironde ? » : toujours 2024, ${n(OD24, btsG)} (obtenu : ${g2?.result?.count})`);
  const [, ev2] = conv(['évolution du nombre de BTS depuis 2024', 'et pour les BUT ?']);
  const but = o => o.fili === 'BUT';
  assert(ev2?.kind === 'evolution' && JSON.stringify(v(ev2)) === JSON.stringify([[2024, n(OD24, but)], [2025, n(OD25, but)]]), `évolution puis « et pour les BUT ? » : l'évolution des BUT (obtenu : ${ev2?.kind} ${JSON.stringify(v(ev2))})`);
  const [, ev3] = conv(['évolution du nombre de BTS depuis 2024', 'et en Gironde ?']);
  assert(ev3?.kind === 'evolution' && JSON.stringify(v(ev3)) === JSON.stringify([[2024, n(OD24, btsG)], [2025, n(OD25, btsG)]]), `évolution puis « et en Gironde ? » (obtenu : ${ev3?.kind} ${JSON.stringify(v(ev3))})`);
  e = qo('le nombre de BTS a-t-il baissé en Gironde par rapport à 2024 ?');
  assert(e?.kind === 'evolution' && JSON.stringify(v(e)) === JSON.stringify([[2024, n(OD24, btsG)], [2025, n(OD25, btsG)]]), `« a-t-il baissé … par rapport à 2024 » (obtenu : ${e?.kind} ${JSON.stringify(v(e))})`);
  e = qo('taux d\'accès moyen des BTS en 2024 et 2025');
  const m = L => { const x = L.filter(bts).map(o => Number(o.taux)).filter(t => t > 0); return x.reduce((a, b) => a + b, 0) / x.length; };
  assert(e?.kind === 'evolution' && Math.abs(e.result.lignes[0].valeur - m(OD24)) < 1e-9 && Math.abs(e.result.lignes[1].valeur - m(OD25)) < 1e-9, `taux d'accès moyen 2024 et 2025 (obtenu : ${e?.kind} ${JSON.stringify(v(e))})`);
});

await describe('Tournures « graphique » et « export » reconnues, et faux positifs', () => {
  const b = run(co, 'isBareChartRequest'), x = run(co, 'isBareExportRequest');
  for (const q of ['en graphique', 'sous forme de camembert', 'montre-le en graphique', 'mets ça en barres', 'fais-moi un graphique', 'en camembert stp']) assert(b(q), `« ${q} » : le résultat affiché, en graphique`);
  for (const q of ['graphique des BTS par département', 'combien de BTS en graphique de barres']) assert(!b(q), `faux positif : « ${q} » reste une nouvelle question`);
  for (const q of ['exporte ce tableau', 'télécharge ce résultat en CSV']) assert(x(q), `« ${q} » : le tableau affiché`);
  for (const q of ['exporte la liste des BTS', 'exporte ces formations en Excel', 'le tableau']) assert(!x(q), `faux positif : « ${q} » n'exporte pas le tableau affiché`);
  const [, p] = conv(['répartition des BTS par département', 'en camembert']);
  assert(p?.kind === 'group_by' && p.plan.renderChart && p.plan.chartType === 'pie' && (p.plan.filters || []).length === 1 && memeObjet(lignesGroupes(p), grouper(OD25.filter(bts), o => o.dep)), '« en camembert » après une répartition : la même répartition (BTS gardé), en camembert');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
