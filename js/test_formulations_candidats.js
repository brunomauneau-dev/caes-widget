// test_formulations_candidats.js — Banc de formulations sur un fichier académique (une ligne = un élève de terminale) :
// sujet (candidats, boursiers, bacs pro, bacheliers généraux, STMG…) × origine (département, commune, public / privé, Pays
// Basque) × situation (admis, admis en BTS / prépa / licence / BUT, hors académie, à Bordeaux, avec ou sans proposition) ×
// objet (nombre, taux de proposition, taux d'admission, répartition par grand groupe), écrits comme on les tape (cmb, nb,
// sans accents). Vérité recalculée sur les lignes, avec la définition SAIO des candidats (au moins un vœu) quand la
// question dit « candidats », et pour les taux (sauf « élèves »). Règle : réponse juste ou arrêt — jamais un autre chiffre.
// Le même banc a tourné sur le vrai fichier académique (hors dépôt) : erreurs trouvées et corrigées (v27.5.87) :
// - « candidats de STMG de Pau admis à Bordeaux » : Pau perdu (552 au lieu de 4) ;
// - « bacheliers généraux de Pau admis en école d'ingénieurs » : Pau lu comme commune d'accueil (84 au lieu de 105) ;
// - « bacs pro » (pluriel) : « bacs » cherché dans les intitulés de formation (405 au lieu de 1 399).
// Données FICTIVES (js/fixtures/donnees_simulees.mjs). node js/test_formulations_candidats.js

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

const ROWS = D.exportAcademique(3000, 21);
const H = D.EXPORT_ACADEMIQUE_ENTETES;
const cf = makeCtx();
cf.XLSX.read = () => ({ SheetNames: ['BDD'], Sheets: { BDD: 'ws' } });
cf.XLSX.utils.sheet_to_json = () => ROWS.map(r => r.slice());
await run(cf, 'importSpreadsheetFile')({ name: 'BDD.xlsx', size: 1000, arrayBuffer: async () => new ArrayBuffer(8) });
const _ask = asker(cf);
const ask = q => { try { return _ask(q); } catch (e) { return { kind: 'ERR', text: e.message }; } };
const R = ROWS.slice(1);
const [DEP, , COM, BAS, ETAB, , PROP, ACC, APP, BOUR, , CONTRAT, TYPE, SERIE, , ENS, NBV, GRP, ACA, , ETABA, COMA] = H.map((_, i) => i);
const V = r => String(r[NBV] ?? '').trim() !== '' && Number(r[NBV]) >= 1;
// sujets : [texte avec « candidats », texte sans, prédicat]
const SUJETS = [
  ['candidats', null, () => true],
  ['candidats boursiers', 'boursiers', r => r[BOUR] === 'Boursier des lycées'],
  ['candidats non boursiers', 'non boursiers', r => r[BOUR] === 'Non boursier du secondaire'],
  ['candidats apprentis', 'apprentis', r => r[APP] === 'Oui'],
  ['candidats de bac général', 'bacheliers généraux', r => r[TYPE] === 'Générale'],
  ['candidats de bac techno', 'bacheliers technologiques', r => r[TYPE] === 'Technologique'],
  ['candidats de bac pro', 'bacs pro', r => r[TYPE] === 'Professionnelle'],
  ['candidats de STMG', 'élèves de STMG', r => /Management/.test(r[SERIE])],
  ['candidats de STI2D', 'élèves de STI2D', r => /Industrie/.test(r[SERIE])],
];
const ORIGINES = [
  ['', () => true], [' de Gironde', r => r[DEP] === 'Gironde'], [' des Landes', r => r[DEP] === 'Landes'], [' de Dordogne', r => r[DEP] === 'Dordogne'],
  [' de Pau', r => r[COM] === 'Pau'], [' scolarisés à Bordeaux', r => r[COM] === 'Bordeaux'], [' du privé', r => r[CONTRAT] !== 'Public'], [' du public', r => r[CONTRAT] === 'Public'], [' du Pays Basque', r => r[BAS] === 'oui'],
];
const A = r => r[ACC] === 'Oui';
const SITUATIONS = [
  ['', () => true], [' admis', A], [' ayant eu une proposition', r => r[PROP] === 'Oui'], [' sans proposition', r => r[PROP] === 'Non'],
  [' admis en BTS', r => A(r) && r[GRP].startsWith('BTS')], [' admis en prépa', r => A(r) && r[GRP] === 'CPGE - CPES'], [' admis en CPGE', r => A(r) && r[GRP] === 'CPGE - CPES'],
  [' admis en licence', r => A(r) && r[GRP].startsWith('L1')], [' admis en BUT', r => A(r) && r[GRP] === 'DUT'], [' admis hors académie', r => A(r) && r[ACA] !== '' && r[ACA] !== 'Bordeaux'],
  [' admis à Bordeaux', r => A(r) && r[COMA] === 'Bordeaux'], [" admis en école d'ingénieurs", r => A(r) && r[GRP] === "Formations d'ingénieurs"],
];
const COMPTE = ['combien de {X}', 'nombre de {X}', 'cmb de {X}', 'nb de {X}', 'il y a combien de {X}', 'combien y a-t-il de {X} ?'];
function graine(n) { let x = n; return () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648; }
const rnd = graine(Number(process.env.GRAINE || 5)); const pick = a => a[Math.floor(rnd() * a.length)];
const res = [];
const N = Number(process.env.N || 300);
for (let i = 0; i < N; i++) {
  const [avec, sans, ps] = pick(SUJETS), [org, po] = pick(ORIGINES);
  const objet = pick(['compter', 'compter', 'compter', 'taux_prop', 'taux_adm', 'repartition']);
  const useSans = sans && rnd() < 0.5;
  const sujet = useSans ? sans : avec;
  const univ = !useSans; // « candidats » dans la question → définition SAIO
  let q, att;
  if (objet === 'compter') {
    const [sit, pt] = pick(SITUATIONS);
    q = pick(COMPTE).replace('{X}', sujet + org + sit);
    att = { kind: 'count', v: R.filter(r => ps(r) && po(r) && pt(r) && (!univ || V(r))).length };
  } else if (objet === 'taux_prop' || objet === 'taux_adm') {
    q = `${objet === 'taux_prop' ? 'taux de proposition' : "taux d'admission"} des ${sujet}${org}`;
    const tauxSAIO = !/élèves/.test(sujet); // taux : définition SAIO, sauf « élèves » (tout le fichier, règle annoncée)
    const den = R.filter(r => ps(r) && po(r) && (!tauxSAIO || V(r)));
    const num = den.filter(objet === 'taux_prop' ? (r => r[PROP] === 'Oui') : A);
    att = { kind: 'part', v: `${num.length}/${den.length}` };
  } else {
    q = `répartition des ${sujet}${org} admis par grand groupe de formation`;
    const m = {}; R.filter(r => ps(r) && po(r) && A(r) && (!univ || V(r)) && r[GRP] !== '').forEach(r => { m[r[GRP]] = (m[r[GRP]] || 0) + 1; });
    att = { kind: 'group', v: m };
  }
  if (rnd() < 0.2) q = q.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const e = ask(q);
  let ob;
  if (!e || e.kind === 'unresolved') ob = { kind: 'arret', t: String(e?.text || '').slice(0, 120) };
  else if (e.kind === 'count') ob = { kind: 'count', v: e.result.count };
  else if (e.kind === 'part') ob = { kind: 'part', v: `${e.result.num}/${e.result.den}` };
  else if (e.kind === 'group_by') ob = { kind: 'group', v: Object.fromEntries((e.result.rows || []).map(x => [x.value, x.count])) };
  else ob = { kind: e.kind, t: String(e.text || '').slice(0, 100) };
  const egal = (a, b) => a.kind === b.kind && (a.kind === 'group' ? Object.keys(b.v).length === Object.keys(a.v).length && Object.entries(b.v).every(([k, x]) => a.v[k] === x) : a.v === b.v);
  res.push({ q, objet, att, ob, verdict: ob.kind === 'arret' ? 'arret' : egal(ob, att) ? 'ok' : 'faux' });
}

await describe(`Banc de ${res.length} formulations sur un fichier de candidats : jamais un chiffre faux`, () => {
  const faux = res.filter(x => x.verdict === 'faux');
  assert(!faux.length, `aucun chiffre faux${faux.length ? ` — ${faux.slice(0, 5).map(x => `« ${x.q} » : attendu ${JSON.stringify(x.att.v).slice(0, 40)}, obtenu ${x.ob.kind} ${JSON.stringify(x.ob.v ?? x.ob.t ?? '').slice(0, 50)}`).join(' ; ')}` : ''}`);
  const arrets = res.filter(x => x.verdict === 'arret');
  assert(arrets.length <= res.length * 0.05, `arrêts limités (${arrets.length} / ${res.length}, au plus 5 %) — ${arrets.slice(0, 3).map(x => x.q).join(' | ')}`);
});

await describe('Corrections ciblées (vues sur le vrai fichier)', () => {
  const n = f => R.filter(f).length;
  const c = q => { const e = ask(q); return e?.kind === 'count' ? e.result.count : e?.kind; };
  const A = r => r[ACC] === 'Oui';
  const stmg = r => /Management/.test(r[SERIE]);
  const pau = R.some(r => r[COM] === 'Pau') ? 'Pau' : R.find(r => r[COM])[COM];
  const coma = R.some(r => r[COMA] === 'Bordeaux') ? 'Bordeaux' : R.find(r => r[COMA])[COMA];
  assert(c(`combien de candidats de STMG de ${pau} admis à ${coma}`) === n(r => stmg(r) && r[COM] === pau && A(r) && r[COMA] === coma && V(r)), `« candidats de STMG de ${pau} admis à ${coma} » : les deux lieux (avant : ${pau} perdu)`);
  assert(c(`combien de bacheliers généraux de ${pau} admis en BTS`) === n(r => r[TYPE] === 'Générale' && r[COM] === pau && A(r) && String(r[GRP]).startsWith('BTS')), `« bacheliers généraux de ${pau} admis en BTS » : ${pau} = lycée d'origine (avant : commune d'accueil)`);
  assert(c('combien de bacs pro') === n(r => r[TYPE] === 'Professionnelle') && c('nombre de bacs techno') === n(r => r[TYPE] === 'Technologique'), '« bacs pro », « bacs techno » : le type de bac (avant : « bacs » cherché dans les intitulés)');
  assert(c(`combien de candidats admis en BTS de ${pau}`) === n(r => A(r) && String(r[GRP]).startsWith('BTS') && r[COMA] === pau && V(r)), `faux positif : « admis en BTS de ${pau} » = commune d'accueil (lieu APRÈS le verbe)`);
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
