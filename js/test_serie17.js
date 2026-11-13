// test_serie17.js — Série 17 : classements selon un TAUX (« les lycées avec le plus fort taux de boursiers »).
// Réponses fausses données comme exactes (avant) :
// - « quels lycées ont le plus fort taux de boursiers », « quel département a le plus fort taux de boursiers », « quel lycée
//   a le taux de proposition le plus bas » : un seul taux global (18 %, 78,7 %) ;
// - « classement des lycées par taux de proposition » : « Oui / Non » ;
// - open data « quelle académie a le plus fort pourcentage de boursiers » : 10 formations au hasard (« % = 1 »), classées sur
//   un nombre de boursiers.
// Maintenant : le taux est calculé dans chaque groupe, puis classé ; les très petits groupes sont écartés et comptés.
// Aussi : « candidats par place » (ratio) répondu sans Albert.
// Données FICTIVES (js/fixtures/donnees_simulees.mjs) ; chaque valeur attendue est recalculée sur les lignes.
// node js/test_serie17.js

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
const egal = (a, b) => JSON.stringify(a) === JSON.stringify(b) || (typeof a === 'object' && typeof b === 'object' && a && b && Object.keys(b).length === Object.keys(a).length && Object.entries(b).every(([k, v]) => a[k] === v));
function chaine(ask, etapes, titre) {
  let suite = false;
  for (const [q, attendu] of etapes) {
    const e = ask(q, suite);
    suite = true;
    const v = valeur(e);
    assert(egal(v, attendu), `${titre} — « ${q} » : ${JSON.stringify(attendu).slice(0, 90)} (obtenu : ${JSON.stringify(v).slice(0, 90)})`);
  }
}
const grouper = (rows, cle, val = () => 1) => { const m = {}; rows.forEach(r => { const k = cle(r); if (k === '' || k == null) return; m[k] = (m[k] || 0) + val(r); }); return m; };

const ROWS0 = D.exportAcademique(3000, 21);
// un tout petit lycée : 1 candidat, boursier (taux de 100 % sur une ligne : ne doit pas être classé premier)
const ROWS = [...ROWS0, ROWS0[1].map((c, k) => k === 4 ? 'Lycée Minuscule' : k === 9 ? 'Boursier des lycées' : c)];
const L = ROWS.slice(1);
// v27.5.82 — définition SAIO : un « candidat » a confirmé au moins un vœu (colonne 16 non vide et ≥ 1). Les questions qui
// disent « candidats », et les taux de proposition / d'admission, portent sur LC ; les autres sur tout le fichier (L).
const CAND = r => String(r[16] ?? '').trim() !== '' && Number(r[16]) >= 1;
const LC = L.filter(CAND);
const nfc = f => LC.filter(f).length;
const cf = makeCtx();
cf.XLSX.read = () => ({ SheetNames: ['BDD'], Sheets: { BDD: 'ws' } });
cf.XLSX.utils.sheet_to_json = () => ROWS.map(r => r.slice());
await run(cf, 'importSpreadsheetFile')({ name: 'BDD.xlsx', size: 1000, arrayBuffer: async () => new ArrayBuffer(8) });
const qf = asker(cf);
const H = D.EXPORT_ACADEMIQUE_ENTETES;
const DEP = 0, ETAB = 4, PROP = 6, BOURS = 9;
const B = r => r[BOURS] === 'Boursier des lycées';
const tauxPar = (k, cond) => { const m = {}; L.forEach(r => { if (!r[k]) return; const g = m[r[k]] = m[r[k]] || { num: 0, den: 0 }; g.den++; if (cond(r)) g.num++; }); return m; };
const classe = (m, croissant, min = 0) => Object.entries(m).filter(([, g]) => g.den >= min).map(([k, g]) => [k, g.num / g.den]).sort((a, b) => (croissant ? a[1] - b[1] : b[1] - a[1]) || a[0].localeCompare(b[0], 'fr'));

await describe('Fichier de candidats : classement selon un taux', () => {
  const d = qf('quel département a le plus fort taux de boursiers');
  const att = classe(tauxPar(DEP, B), false);
  assert(d?.kind === 'part_groupes' && d.result.groupe === H[DEP] && d.result.groupes[0].valeur === att[0][0] && Math.abs(d.result.groupes[0].pct / 100 - att[0][1]) < 1e-9, `département au plus fort taux de boursiers : ${att[0][0]} (avant : un taux global ; obtenu : ${d?.kind} ${d?.result?.groupes?.[0]?.valeur})`);
  const min = Math.max(10, Math.ceil(L.length * 0.002));
  const l = qf('quels lycées ont le plus fort taux de boursiers');
  const al = classe(tauxPar(ETAB, B), false, min);
  assert(l?.kind === 'part_groupes' && l.result.groupe === H[ETAB] && l.result.groupes[0].valeur === al[0][0], `lycée au plus fort taux de boursiers : ${al[0][0]} (groupes de ${min} lignes ou plus)`);
  assert(l.result.groupes.every(g => g.den >= min) && !l.result.groupes.some(g => g.valeur === 'Lycée Minuscule') && /écarté/.test(l.html), '« Lycée Minuscule » (1 sur 1 = 100 %) écarté, et le texte le dit');
  const b = qf('quel lycée a le taux de proposition le plus bas');
  const ab = classe(tauxPar(ETAB, r => r[PROP] === 'Oui'), true, min);
  assert(b?.kind === 'part_groupes' && b.result.groupes[0].valeur === ab[0][0], `taux de proposition le plus bas : ${ab[0][0]} (classement croissant)`);
  const c = qf('classement des lycées par taux de proposition');
  assert(c?.kind === 'part_groupes' && c.result.groupe === H[ETAB], `« classement des lycées par taux de proposition » : un taux par lycée (avant : Oui / Non ; obtenu : ${c?.kind})`);
  const t = qf('les 5 lycées avec le meilleur taux de proposition');
  assert(t?.kind === 'part_groupes' && t.result.groupes.length === 5, '« les 5 lycées » : 5 lignes');
  const g = qf('taux de proposition des boursiers');
  assert(g?.kind === 'part' && g.result.num === LC.filter(r => B(r) && r[PROP] === 'Oui').length, 'faux positif : « taux de proposition des boursiers » reste un taux simple');
});

const OD = D.openData(3000, 17);
const co = makeCtx();
co.__t = D.tableOpenData(OD);
run(co, "defaultOpenDataTable = __t; defaultOpenDataState = 'ready';");
const qo = asker(co);

await describe('Open data : classement selon un taux (effectifs)', () => {
  const e = qo('quelle académie a le plus fort pourcentage de boursiers');
  const m = {}; OD.forEach(o => { const g = m[o.aca] = m[o.aca] || { num: 0, den: 0 }; g.num += o.acc_bours; g.den += o.acc_neobac; });
  const att = Object.entries(m).map(([k, g]) => [k, g.num / g.den]).sort((a, b) => b[1] - a[1]);
  assert(e?.kind === 'part_groupes' && e.result.groupes[0].valeur === att[0][0] && Math.abs(e.result.groupes[0].pct / 100 - att[0][1]) < 1e-9, `académie au plus fort % de boursiers (admis boursiers ÷ admis néo-bacheliers) : ${att[0][0]} (avant : 10 formations, nombre de boursiers ; obtenu : ${e?.kind} ${e?.result?.groupes?.[0]?.valeur})`);
  const r = qo('nombre de candidats par place en BTS');
  assert(r?.kind === 'ratio' && run(co, 'shouldAnswerLocallyWithoutAlbert')(r) === true, '« candidats par place » : répondu sans Albert');
  const t = qo('quelle académie a le plus de BTS');
  assert(t?.kind === 'top', 'faux positif : « le plus de BTS » reste un classement de nombres');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
