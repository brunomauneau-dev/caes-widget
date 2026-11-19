// test_evolution_formulations.js — Évolutions entre deux sessions de l'open data, formulées librement : « évolution du
// nombre de BTS depuis 2024 », « comment a évolué… », « … a-t-il augmenté depuis 2024 ? », « … par rapport à l'an
// dernier », « … en 2024 », « … l'an dernier » × filière × lieu × mesure (nombre, places, vœux, admis). Vérité
// recalculée sur chaque session. Règle : réponse juste ou arrêt, jamais un autre chiffre.
// Erreurs trouvées et corrigées (v27.5.91) :
// - « évolution du nombre d'admis en BUT depuis 2024 » : filtre parasite « Dont effectif des candidates admises = 1 »
//   (196 → 276 au lieu de 6 987 → 8 799) : « 1 » / « 0 » ne valent oui / non que dans une colonne d'état ;
// - « comment a évolué… » : arrêt sur « comment ».
// Données FICTIVES (js/fixtures/donnees_simulees.mjs). node js/test_evolution_formulations.js

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

// ─── Widget chargé comme dans le navigateur (modules ensemble) ───────────────
function makeCtx() {
  const noopEl = () => null;
  const ctx = {
    console: { ...console, log() {}, warn() {}, info() {} },
    setTimeout: () => null, clearTimeout() {}, URLSearchParams, TextDecoder, TextEncoder,
    document: { getElementById: noopEl, querySelector: noopEl, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => Promise.reject(new Error('hors ligne')),
    escapeHtml: s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  };
  ctx.XLSX = { utils: { json_to_sheet: () => ({}), book_new: () => ({}), book_append_sheet() {}, sheet_to_csv: () => '' }, writeFile() {} };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.selectedDocIds = new Set();
  vm.createContext(ctx);
  for (const f of ['config.js', 'knowledge.js', 'documents.js', 'planner.js', 'dataEngine.js', 'sessions.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
  }
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
async function ctxCSV(rows, name = 'extraction.csv') {
  const ctx = makeCtx();
  const buf = new TextEncoder().encode(D.versCSV(rows));
  await run(ctx, 'importSpreadsheetFile')({ name, size: buf.length, arrayBuffer: async () => buf.buffer });
  return ctx;
}
// Question posée « à froid », comme une nouvelle conversation
function ask(ctx, q) {
  run(ctx, 'window.__DATA_ENGINE_STATE = { lastPlan: null, lastExecution: null, history: [] }');
  ctx.__q = q;
  const plan = run(ctx, 'isDataEngineQuestion(__q)') ? run(ctx, 'detectDataEnginePlan(__q)') : null;
  return plan ? run(ctx, 'runDataEnginePlan')(plan, []) : null;
}
// Pose une question dans la conversation en cours (sans remise à zéro)
function suite(ctx, q) {
  ctx.__q = q;
  const plan = run(ctx, 'isDataEngineQuestion(__q)') ? run(ctx, 'detectDataEnginePlan(__q)') : null;
  return plan ? run(ctx, 'runDataEnginePlan')(plan, []) : null;
}
const valeurs = e => (e?.result?.lignes || []).map(l => l.valeur);
const meme = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const proche = (a, b) => Math.abs(a - b) < 1e-9;

// Deux sessions simulées : 2025 (session courante, chargée au lancement) et 2024 (chargée à la demande)
const OD25 = D.openData(3000, 3);
const OD24 = D.openData(2700, 44).map(o => ({ ...o, session: 2024 }));
const avecChamps = (t, renommer = {}) => {
  const cles = Object.keys(D.OD);
  const headers = cles.map(k => renommer[k] || D.OD[k]);
  return { ...t, headers, objects: t.objects.map(o => Object.fromEntries(cles.map((k, i) => [headers[i], o[D.OD[k]]]))),
    champs: Object.fromEntries(cles.map((k, i) => [headers[i], D.OD_API[k]])), libelles: Object.fromEntries(cles.map((k, i) => [D.OD_API[k], headers[i]])) };
};
function ctxDeuxSessions({ renommer = {} } = {}) {
  const ctx = makeCtx();
  ctx.__t25 = { ...avecChamps(D.tableOpenData(OD25)), session: 2025 };
  ctx.__t24 = { ...avecChamps(D.tableOpenData(OD24, 'Parcoursup 2024 — France entière (open data)'), renommer), session: 2024, isDefault: false };
  run(ctx, "defaultOpenDataTable = __t25; defaultOpenDataState = 'ready'; openDataSessions.set(2024, __t24);");
  return ctx;
}
const F = [['BTS', o => o.fili === 'BTS'], ['BUT', o => o.fili === 'BUT'], ['CPGE', o => o.fili === 'CPGE'], ['licences', o => o.fili === 'Licence'], ['PASS', o => o.fili === 'PASS'], ['formations', () => true]];
const L = [['', () => true], [' en Gironde', o => o.dep === 'Gironde'], [" dans l'académie de Bordeaux", o => o.aca === 'Bordeaux'], [' à Paris', o => o.commune === 'Paris']];
function graine(n) { let x = n; return () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648; }
const rnd = graine(Number(process.env.GRAINE || 3)); const pick = a => a[Math.floor(rnd() * a.length)];
const ctx = ctxDeuxSessions();
const M = [
  ['nombre', 'nombre de {F}{L}', rows => rows.length],
  ['places', 'nombre de places en {F}{L}', rows => rows.reduce((t, o) => t + o.capa, 0)],
  ['voeux', 'nombre de vœux en {F}{L}', rows => rows.reduce((t, o) => t + o.voe, 0)],
  ['admis', "nombre d'admis en {F}{L}", rows => rows.reduce((t, o) => t + o.acc, 0)],
];
const FORMES = [
  m => `évolution du ${m} entre 2024 et 2025`, m => `évolution du ${m} depuis 2024`, m => `${m} : évolution par rapport à l'an dernier`,
  m => `comment a évolué le ${m} depuis 2024 ?`, m => `le ${m} a-t-il augmenté depuis 2024 ?`, m => `${m} en 2024`, m => `${m} l'an dernier`,
];
const res = [];
for (let i = 0; i < Number(process.env.N || 150); i++) {
  const [f, pf] = pick(F), [l, pl] = pick(L), [nm, modele, calc] = pick(M), forme = pick(FORMES);
  const m = modele.replace('{F}', f).replace('{L}', l);
  let q = forme(m);
  if (rnd() < 0.2) q = q.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const v24 = calc(OD24.filter(o => pf(o) && pl(o))), v25 = calc(OD25.filter(o => pf(o) && pl(o)));
  const seul2024 = /^X (en 2024|l'an dernier)$/.test(forme('X'));
  const e = ask(ctx, q);
  let ob, att;
  if (seul2024) { att = String(v24); ob = !e || e.kind === 'unresolved' ? 'arret' : e.kind === 'count' ? String(e.result.count) : e.kind === 'sum' ? String(e.result.sum) : e.kind; }
  else { att = `${v24}→${v25}`; ob = !e || e.kind === 'unresolved' ? 'arret' : e.kind === 'evolution' ? (e.result.lignes || []).map(x => x.valeur).join('→') : e.kind; }
  res.push({ q, att, ob, verdict: ob === 'arret' ? 'arret' : ob === att ? 'ok' : 'faux', t: e?.text });
}

await describe(`Banc de ${res.length} évolutions : jamais un chiffre faux`, () => {
  const faux = res.filter(x => x.verdict === 'faux');
  assert(!faux.length, `aucun chiffre faux${faux.length ? ` — ${faux.slice(0, 5).map(x => `« ${x.q} » : attendu ${x.att}, obtenu ${x.ob}`).join(' ; ')}` : ''}`);
  const arrets = res.filter(x => x.verdict === 'arret');
  assert(arrets.length <= res.length * 0.03, `arrêts limités (${arrets.length}) — ${arrets.slice(0, 3).map(x => x.q).join(' | ')}`);
});

await describe('Corrections ciblées', () => {
  const S2 = (L, p, f) => L.filter(p).reduce((t, o) => t + f(o), 0);
  const but = o => o.fili === 'BUT';
  const e = ask(ctx, "évolution du nombre d'admis en BUT depuis 2024");
  assert(e?.kind === 'evolution' && e.result.lignes.map(l => l.valeur).join('→') === `${S2(OD24, but, o => o.acc)}→${S2(OD25, but, o => o.acc)}`, `admis en BUT : ${S2(OD24, but, o => o.acc)} → ${S2(OD25, but, o => o.acc)} (avant : filtre « candidates admises = 1 »)`);
  assert(!(e?.plan?.filters || []).some(f => /candidates admises/i.test(f.col)), 'aucun filtre sur la colonne d\'effectif « candidates admises »');
  const c = ask(ctx, 'comment a évolué le nombre de BTS depuis 2024 ?');
  assert(c?.kind === 'evolution' && c.result.lignes.map(l => l.valeur).join('→') === `${OD24.filter(o => o.fili === 'BTS').length}→${OD25.filter(o => o.fili === 'BTS').length}`, '« comment a évolué… » (avant : arrêt sur « comment »)');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
