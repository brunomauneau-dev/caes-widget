// test_plusieurs_valeurs.js — Plusieurs valeurs d'une même information reliées par « et / ou ».
// Avant : « combien de formations à Bordeaux ou à Pau » ne comptait que Bordeaux (chiffre faux, sans avertissement) ;
// « combien de boursiers admis en CPGE ou en école d'ingénieurs » donnait 0 ; « en Gironde et dans les Landes »,
// « BTS et BUT », « hors Bordeaux et hors Toulouse », « bac pro et bac techno » s'arrêtaient (« critère non reconnu »).
// Maintenant : deux valeurs de la même famille (lieux, formations, séries, établissements) = l'une OU l'autre ;
// « hors X et hors Y » = les deux exclusions ; ce qui était déjà compris avec ses deux critères ne change pas
// (« maths et physique » = les deux spécialités ; « boursiers et apprentis » = les deux à la fois ; « Droit et Economie »).
// Données FICTIVES (js/fixtures/donnees_simulees.mjs) ; chaque valeur attendue est recalculée sur les lignes.
// node js/test_plusieurs_valeurs.js

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
  ctx.window = ctx; ctx.globalThis = ctx; ctx.selectedDocIds = new Set();
  vm.createContext(ctx);
  for (const f of ['config.js', 'knowledge.js', 'documents.js', 'planner.js', 'dataEngine.js', 'sessions.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
  ctx.resetContextSilent = () => {};
  return ctx;
}
const run = (ctx, code) => vm.runInContext(code, ctx);
function asker(ctx) {
  return (q, suite = false) => {
    if (!suite) run(ctx, 'window.__DATA_ENGINE_STATE = { lastPlan: null, lastExecution: null, history: [] }');
    ctx.__q = q;
    const plan = run(ctx, 'isDataEngineQuestion(__q)') ? run(ctx, 'detectDataEnginePlan(__q)') : null;
    return plan ? run(ctx, 'runDataEnginePlan')(plan, []) : null;
  };
}
const cnt = e => e?.kind === 'count' ? e.result.count : null;

// ─── Open data ──────────────────────────────────────────────────────────────
const OD = D.openData(3000, 17);
const co = makeCtx();
co.__t = D.tableOpenData(OD);
run(co, "defaultOpenDataTable = __t; defaultOpenDataState = 'ready';");
const qo = asker(co);
const n = p => OD.filter(p).length;

await describe('Open data : l\'une ou l\'autre valeur', () => {
  const c = (q, att, label) => { const e = qo(q); assert(cnt(e) === att, `« ${q} » → ${att}${label ? ` (${label})` : ''} (obtenu : ${e?.kind} ${cnt(e) ?? String(e?.text || '').slice(0, 80)})`); return e; };
  const bp = c('combien de formations à Bordeaux ou à Pau', n(o => o.commune === 'Bordeaux' || o.commune === 'Pau'), 'avant : Bordeaux seul');
  assert(/Bordeaux ou Pau/.test(run(co, 'perimetreResultat')(bp.kind, bp.plan, bp.result).texte), 'le périmètre dit « Bordeaux ou Pau »');
  c('combien de formations en Gironde et dans les Landes', n(o => o.dep === 'Gironde' || o.dep === 'Landes'), 'avant : arrêt');
  c('combien de BTS et de BUT', n(o => o.fili === 'BTS' || o.fili === 'BUT'));
  c('combien de BTS ou de BUT en Gironde', n(o => (o.fili === 'BTS' || o.fili === 'BUT') && o.dep === 'Gironde'), 'avec un critère commun');
  c('combien de BTS dans les académies de Bordeaux et de Toulouse', n(o => o.fili === 'BTS' && (o.aca === 'Bordeaux' || o.aca === 'Toulouse')));
  c('combien de formations hors Bordeaux et hors Toulouse', n(o => o.aca !== 'Bordeaux' && o.aca !== 'Toulouse'), 'deux exclusions');
  const s = qo('nombre de places en BTS et BUT');
  assert(s?.kind === 'sum' && s.result.sum === OD.filter(o => o.fili === 'BTS' || o.fili === 'BUT').reduce((t, o) => t + o.capa, 0), 'somme des places en BTS et BUT');
  const g = qo('combien de CPGE et de PASS par académie');
  const bx = g?.result?.rows?.find(r => r.value === 'Bordeaux');
  assert(g?.kind === 'group_by' && bx?.count === n(o => (o.fili === 'CPGE' || o.fili === 'PASS') && o.aca === 'Bordeaux'), 'répartition par académie des CPGE et PASS');
});

// ─── Fichier de candidats ───────────────────────────────────────────────────
const ROWS = D.exportAcademique(4000, 21);
const cf = makeCtx();
cf.XLSX = { read: () => ({ SheetNames: ['BDD'], Sheets: { BDD: 'ws' } }), utils: { sheet_to_json: () => ROWS.map(r => r.slice()) } };
await run(cf, 'importSpreadsheetFile')({ name: 'BDD.xlsx', size: 1000, arrayBuffer: async () => new ArrayBuffer(8) });
const qf = asker(cf);
const H = D.EXPORT_ACADEMIQUE_ENTETES;
const [DEP, , , , ETAB, , PROP, ACC, APP, BOURS, , , TYPE, , , ENS, , GRP, , , , COMA] = H;
const L = ROWS.slice(1).map(r => Object.fromEntries(H.map((h, i) => [h, r[i]])));
const nb = p => L.filter(p).length;
const B = r => r[BOURS] === 'Boursier des lycées';
const sujets = r => String(r[ENS]).split('|').map(x => x.trim());

await describe('Fichier de candidats : l\'une ou l\'autre valeur', () => {
  const c = (q, att, label) => { const e = qf(q); assert(cnt(e) === att, `« ${q} » → ${att}${label ? ` (${label})` : ''} (obtenu : ${e?.kind} ${cnt(e) ?? String(e?.text || '').slice(0, 80)})`); return e; };
  c('combien de candidats admis à Bordeaux ou à Pau', nb(r => r[ACC] === 'Oui' && (r[COMA] === 'Bordeaux' || r[COMA] === 'Pau')), 'avant : Bordeaux seul');
  c('combien de candidats admis en BTS ou en BUT', nb(r => r[ACC] === 'Oui' && (r[GRP].startsWith('BTS') || r[GRP] === 'DUT')));
  c('combien de candidats de Gironde et des Landes', nb(r => r[DEP] === 'Gironde' || r[DEP] === 'Landes'));
  c('combien de candidats hors Gironde et hors Landes', nb(r => r[DEP] !== 'Gironde' && r[DEP] !== 'Landes'));
  c('combien de candidats de bac pro et de bac techno', nb(r => r[TYPE] === 'Professionnelle' || r[TYPE] === 'Technologique'));
  c("combien de boursiers admis en CPGE ou en école d'ingénieurs", nb(r => B(r) && r[ACC] === 'Oui' && (r[GRP] === 'CPGE - CPES' || r[GRP] === "Formations d'ingénieurs")), 'avant : 0');
  c('combien de candidats du lycée Montaigne ou du lycée Victor Louis', nb(r => r[ETAB] === 'Lycée Montaigne' || r[ETAB] === 'Lycée Victor Louis'));
  c('combien de candidats ayant suivi les spécialités maths et physique et admis en licence ou en BUT',
    nb(r => sujets(r).includes('Mathématiques') && sujets(r).some(x => x.startsWith('Physique')) && r[ACC] === 'Oui' && (r[GRP].startsWith('L1') || r[GRP] === 'DUT')), 'deux coordinations : « et » entre spécialités, « ou » entre formations');
});

await describe('Faux positifs : « les deux à la fois » inchangé', () => {
  const m = qf('combien de candidats ayant suivi les spécialités maths et physique');
  assert(cnt(m) === nb(r => sujets(r).includes('Mathématiques') && sujets(r).some(x => x.startsWith('Physique'))) && !(m.plan.filters || []).some(f => f.op === 'or'), 'maths et physique : les deux spécialités');
  const a = qf('combien de boursiers et apprentis');
  assert(cnt(a) === nb(r => B(r) && r[APP] === 'Oui') && !(a.plan.filters || []).some(f => f.op === 'or'), 'boursiers et apprentis : les deux à la fois');
  const d = qf('combien de candidats ayant la spécialité droit et économie');
  assert(cnt(d) === nb(r => sujets(r).includes('Droit et Economie')), '« Droit et Economie » : un seul nom');
  const t = qf('taux de proposition des boursiers et des non boursiers');
  assert(t?.kind === 'part_groupes', 'taux des boursiers et des non boursiers : toujours un taux par groupe');
  const cp = qf('comparer le lycée Montaigne et le lycée Victor Louis');
  assert(cp?.kind === 'compare', 'comparer X et Y : toujours une comparaison');
  const p = qf("combien de candidats ont eu une proposition et l'ont acceptée");
  assert(cnt(p) === nb(r => r[PROP] === 'Oui' && r[ACC] === 'Oui'), 'proposition et acceptation : les deux');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
