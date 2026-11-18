// test_parts_formations.js — Banc de taux et de parts sur l'open data (une ligne = une formation) : taux d'accès moyen,
// part des formations privées, part des boursiers parmi les admis, répartitions, formations sélectives, taux de
// remplissage, places par département, formation la plus sélective — croisés avec filière et lieu, formulés librement.
// Vérité recalculée sur les lignes avec les définitions officielles. Règle : réponse juste ou arrêt, jamais un autre chiffre.
// Erreur trouvée et corrigée (v27.5.90) : « part des BTS privés », « pourcentage de CPGE privées en Gironde » : la
// formation était mise dans la condition (BTS privés parmi TOUTES les formations : 590 / 4 000 au lieu de 590 / 1 696).
// Données FICTIVES (js/fixtures/donnees_simulees.mjs). node js/test_parts_formations.js

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

const OD = D.openData(4000, 23);
const co = makeCtx(); co.__t = D.tableOpenData(OD);
run(co, "defaultOpenDataTable = __t; defaultOpenDataState = 'ready';");
const ask = asker(co);
const F = [['BTS', o => o.fili === 'BTS'], ['BUT', o => o.fili === 'BUT'], ['CPGE', o => o.fili === 'CPGE'], ['licences', o => o.fili === 'Licence'], ['PASS', o => o.fili === 'PASS'], ['IFSI', o => o.fili === 'IFSI'], ['formations', () => true]];
const L = [['', () => true], [' en Gironde', o => o.dep === 'Gironde'], [" dans l'académie de Bordeaux", o => o.aca === 'Bordeaux'], [' en Nouvelle-Aquitaine', o => o.region === 'Nouvelle-Aquitaine'], [' à Paris', o => o.commune === 'Paris']];
function graine(n) { let x = n; return () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648; }
const rnd = graine(Number(process.env.GRAINE || 4)); const pick = a => a[Math.floor(rnd() * a.length)];
const r2 = x => Math.round(x * 100) / 100;
const res = [];
for (let i = 0; i < Number(process.env.N || 200); i++) {
  const [f, pf] = pick(F), [l, pl] = pick(L); const rows = OD.filter(o => pf(o) && pl(o));
  const t = pick(['taux_moyen', 'part_privees', 'part_boursiers', 'repartition', 'selectives', 'remplissage', 'places_dep', 'plus_selective']);
  let q, att;
  if (t === 'taux_moyen') { q = pick([`taux d'accès moyen des ${f}${l}`, `quel est le taux d'acces moyen des ${f}${l}`]); const v = rows.map(o => o.taux).filter(x => x > 0); att = { k: 'stats', v: v.length ? r2(v.reduce((a, b) => a + b, 0) / v.length) : null }; }
  else if (t === 'part_privees') { q = pick([`part des ${f} privées${l}`, `quelle part des ${f}${l} sont privées`, `pourcentage de ${f} privés${l}`]); att = { k: 'part', v: `${rows.filter(o => o.statut !== 'Public').length}/${rows.length}` }; }
  else if (t === 'part_boursiers') { q = pick([`part des boursiers parmi les admis en ${f}${l}`, `pourcentage de boursiers admis en ${f}${l}`]); att = { k: 'part', v: `${rows.reduce((a, o) => a + o.acc_bours, 0)}/${rows.reduce((a, o) => a + o.acc_neobac, 0)}` }; }
  else if (t === 'repartition') { q = pick([`répartition des ${f}${l} par académie`, `nombre de ${f}${l} par académie`]); const m = {}; rows.forEach(o => { m[o.aca] = (m[o.aca] || 0) + 1; }); att = { k: 'group', v: m }; }
  else if (t === 'selectives') { q = pick([`combien de ${f} sélectives${l}`, `nombre de ${f} selectives${l}`]); att = { k: 'count', v: rows.filter(o => o.selectivite === 'formation sélective').length }; }
  else if (t === 'remplissage') { q = `taux de remplissage des ${f}${l}`; att = { k: 'part', v: `${rows.reduce((a, o) => a + o.acc, 0)}/${rows.reduce((a, o) => a + o.capa, 0)}` }; }
  else if (t === 'places_dep') { q = `nombre de places en ${f}${l} par département`; const m = {}; rows.forEach(o => { m[o.dep] = (m[o.dep] || 0) + o.capa; }); att = { k: 'group', v: m }; }
  else { q = `quelle est la formation la plus sélective parmi les ${f}${l}`; const v = rows.filter(o => o.taux > 0).map(o => o.taux); att = { k: 'min', v: v.length ? Math.min(...v) : null }; }
  if (!rows.length) continue;
  const e = ask(q);
  let ob;
  if (!e || e.kind === 'unresolved') ob = { k: 'arret', t: String(e?.text || '').slice(0, 120) };
  else if (e.kind === 'stats') ob = { k: 'stats', v: r2(e.result.avg) };
  else if (e.kind === 'part') ob = { k: 'part', v: `${e.result.num}/${e.result.den}` };
  else if (e.kind === 'count') ob = { k: 'count', v: e.result.count };
  else if (e.kind === 'group_by') ob = { k: 'group', v: Object.fromEntries((e.result.rows || []).map(x => [x.value, x.count ?? x.sum])) };
  else if (e.kind === 'classement') ob = { k: 'min', v: e.result.lignes?.[0]?.valeur ?? e.result.lignes?.[0]?.v };
  else ob = { k: e.kind, t: String(e.text || '').slice(0, 100) };
  let ok = ob.k === att.k;
  if (ok) ok = att.k === 'group' ? Object.keys(att.v).every(k => ob.v[k] === att.v[k] || !(k in ob.v)) && Object.entries(ob.v).every(([k, x]) => att.v[k] === x) : ob.v === att.v;
  res.push({ q, t, att, ob, verdict: ob.k === 'arret' ? 'arret' : ok ? 'ok' : 'faux' });
}

await describe(`Banc de ${res.length} questions de taux et de parts : jamais un chiffre faux`, () => {
  const faux = res.filter(x => x.verdict === 'faux');
  assert(!faux.length, `aucun chiffre faux${faux.length ? ` — ${faux.slice(0, 5).map(x => `« ${x.q} » : attendu ${JSON.stringify(x.att.v).slice(0, 40)}, obtenu ${x.ob.k} ${JSON.stringify(x.ob.v ?? x.ob.t ?? '').slice(0, 50)}`).join(' ; ')}` : ''}`);
  // les arrêts admis : questions sans objet (« BTS en Gironde par département », « … de l'académie de Bordeaux par académie »)
  const arrets = res.filter(x => x.verdict === 'arret' && !/(en gironde|a paris|en nouvelle-aquitaine).* par departement|academie de bordeaux.* par academie|a paris.* par academie|en gironde.* par academie/.test(x.q.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()));
  assert(arrets.length <= res.length * 0.03, `arrêts hors questions sans objet : ${arrets.length} — ${arrets.slice(0, 3).map(x => x.q).join(' | ')}`);
});

await describe('« part des BTS privés » : parmi les BTS (vu au banc)', () => {
  const p = q => { const e = ask(q); return e?.kind === 'part' ? `${e.result.num}/${e.result.den}` : e?.kind; };
  const n = f => OD.filter(f).length;
  const bts = o => o.fili === 'BTS', priv = o => o.statut !== 'Public';
  for (const q of ['part des BTS privées', 'pourcentage de BTS privés', 'quelle part des BTS sont privés']) assert(p(q) === `${n(o => bts(o) && priv(o))}/${n(bts)}`, `« ${q} » : ${n(o => bts(o) && priv(o))}/${n(bts)} (avant : / ${OD.length})`);
  assert(p('part des CPGE privées en Gironde') === `${n(o => o.fili === 'CPGE' && priv(o) && o.dep === 'Gironde')}/${n(o => o.fili === 'CPGE' && o.dep === 'Gironde')}`, 'avec un lieu : CPGE de Gironde');
  assert(p('part des formations privées en Gironde') === `${n(o => priv(o) && o.dep === 'Gironde')}/${n(o => o.dep === 'Gironde')}`, 'faux positif : « formations privées en Gironde » inchangé');
  assert(p('part des boursiers parmi les admis en BTS') === `${OD.filter(bts).reduce((a, o) => a + o.acc_bours, 0)}/${OD.filter(bts).reduce((a, o) => a + o.acc_neobac, 0)}`, 'faux positif : part des boursiers parmi les admis (définition officielle) inchangée');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
