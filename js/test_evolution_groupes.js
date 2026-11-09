// test_evolution_groupes.js — Répartitions : somme par groupe, et comparaison entre deux sessions.
// 1. « nombre de places en BTS par académie » affichait le nombre de formations par académie (« Paris : 315 »),
//    présenté comme des places. Désormais : somme de la colonne (places, candidats, admis) par groupe.
// 2. « évolution du nombre de BTS / des places par académie depuis 2024 », « les académies avec le plus de
//    places : évolution » : même calcul sur chaque session, groupe par groupe (écart, %, rangs, total).
//    Formations suivies une à une, tableaux croisés, listes : arrêt expliqué.
// node js/test_evolution_groupes.js

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


// Deux sessions simulées : 2025 (courante) et 2024 (chargée à la demande). En 2024, une académie « Corse »
// qui n'existe plus en 2025 (groupe disparu) ; noms de colonnes 2024 rapprochés par le nom technique.
const OD25 = D.openData(3000, 3);
const OD24 = D.openData(2700, 44).map((o, i) => ({ ...o, session: 2024, ...(i % 50 === 0 ? { aca: 'Corse', region: 'Corse' } : {}) }));
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
const bts = o => o.fili === 'BTS';
// vérité recalculée sur les lignes : valeur par groupe
const parGroupe = (L, pred, cle, f = () => 1) => { const m = new Map(); L.filter(pred).forEach(o => m.set(o[cle], (m.get(o[cle]) || 0) + f(o))); return m; };
const ligne = (e, v) => e.result.lignes.find(l => l.valeur === v);
const rows = e => Object.fromEntries((e.result.rows || []).map(r => [r.value, r.count]));
const texte = e => String(e?.html || '').replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

await describe('Répartition d\'une mesure : somme par groupe, plus le nombre de formations', () => {
  const ctx = ctxDeuxSessions();
  const places = parGroupe(OD25, bts, 'aca', o => o.capa);
  const nbBts = parGroupe(OD25, bts, 'aca');
  for (const q of ['nombre de places en BTS par académie', 'combien de places en BTS par académie', 'places en BTS par académie', 'répartition des places en BTS par académie']) {
    const e = ask(ctx, q);
    const r = rows(e);
    assert(e?.kind === 'group_by' && e.result.somme && [...places].every(([a, v]) => r[a] === v),
      `« ${q} » : somme des places par académie (Paris = ${places.get('Paris')}, et non ${nbBts.get('Paris')} formations ; obtenu ${r.Paris})`);
  }
  const e = ask(ctx, 'nombre de places en BTS par académie');
  assert(e.result.somme.total === [...places.values()].reduce((a, b) => a + b, 0), 'total des places exact');
  assert(/places au total/.test(texte(e)) && / places \(/.test(texte(e)), 'chaque ligne dit « places »');
  assert(/pas un nombre de formations/.test(texte(e)), 'périmètre : « somme … par groupe, pas un nombre de formations »');
  assert(/ce ne sont pas des nombres de formations/.test(run(ctx, 'dataEngineResultToContext')(e)), 'Albert est prévenu');
  assert(Object.keys(run(ctx, 'currentExecutionToRows')(e)[0]).includes('Places (somme)'), 'export : colonne « Places (somme) »');
  assert(/^Places par Académie/.test(run(ctx, 'extractBlockTitle')(e, '')), `titre du bloc : ${run(ctx, 'extractBlockTitle')(e, '')}`);
  const c = ask(ctx, 'nombre de candidats par académie');
  const cand = parGroupe(OD25, () => true, 'aca', o => o.voe);
  assert(c?.kind === 'group_by' && rows(c).Bordeaux === cand.get('Bordeaux'), 'candidats par académie : somme des candidats');
  const a = ask(ctx, "combien d'admis par filière");
  assert(a?.kind === 'group_by' && rows(a).BTS === parGroupe(OD25, () => true, 'fili', o => o.acc).get('BTS'), 'admis par filière : somme des admis');
});

await describe('Faux positifs : nombre de formations quand c\'est ce qui est demandé', () => {
  const ctx = ctxDeuxSessions();
  const nb = parGroupe(OD25, () => true, 'aca');
  for (const q of ['répartition des formations par académie', 'nombre de formations par académie', 'combien de formations par académie', 'répartition par académie']) {
    const e = ask(ctx, q);
    assert(e?.kind === 'group_by' && !e.result.somme && rows(e).Paris === nb.get('Paris'), `« ${q} » : nombre de formations (${nb.get('Paris')})`);
  }
  const cap = ask(ctx, 'répartition par capacité');
  assert(cap?.kind === 'group_by' && !cap.result.somme, '« répartition par capacité » : la capacité est la dimension, pas la mesure');
  const piv = ask(ctx, 'places par académie et par statut');
  assert(piv?.kind === 'unresolved' && /tableau croisé compte des formations/.test(piv.text), 'tableau croisé de places : arrêt (il compterait des formations)');
});

await describe('Évolution d\'une répartition entre deux sessions', () => {
  const ctx = ctxDeuxSessions();
  const n24 = parGroupe(OD24, bts, 'aca'), n25 = parGroupe(OD25, bts, 'aca');
  for (const q of ['évolution du nombre de BTS par académie depuis 2024', 'évolution du nombre de BTS par académie', 'nombre de BTS par académie : comparaison entre 2024 et 2025', "nombre de BTS par académie par rapport à l'an dernier"]) {
    const e = ask(ctx, q);
    assert(e?.kind === 'evolution_groupes' && e.result.sessions.join() === '2024,2025', `« ${q} » : évolution 2024 → 2025 (obtenu : ${e?.kind})`);
    if (e?.kind !== 'evolution_groupes') continue;
    const l = ligne(e, 'Bordeaux');
    assert(l.v1 === n24.get('Bordeaux') && l.v2 === n25.get('Bordeaux') && l.ecart === n25.get('Bordeaux') - n24.get('Bordeaux'), `Bordeaux : ${n24.get('Bordeaux')} → ${n25.get('Bordeaux')}, écart exact`);
  }
  const e = ask(ctx, 'évolution du nombre de BTS par académie depuis 2024');
  assert(e.result.totaux[0] === OD24.filter(bts).length && e.result.totaux[1] === OD25.filter(bts).length, 'totaux = nombre de BTS de chaque session');
  const corse = ligne(e, 'Corse');
  assert(corse && corse.v1 === n24.get('Corse') && corse.v2 === null && e.result.disparus.includes('Corse'), 'groupe absent en 2025 (Corse) : « — » et signalé');
  assert(/seulement en 2024 : Corse/.test(texte(e)), 'note « seulement en 2024 : Corse »');
  assert(e.result.lignes.findIndex(l => l.valeur === 'Corse') === e.result.lignes.length - 1, 'groupe disparu en fin de tableau');
  const v2 = e.result.lignes.filter(l => l.v2 !== null).map(l => l.v2);
  assert(v2.every((v, i) => i === 0 || v2[i - 1] >= v), 'tri : plus grands groupes en 2025 d\'abord');
  assert(/proche|% /.test(texte(e)) || e.result.lignes.every(l => l.ecartPct === null || isFinite(l.ecartPct)), 'évolution en % calculée');
  const p = ask(ctx, 'évolution des places en BTS par académie depuis 2024');
  const p24 = parGroupe(OD24, bts, 'aca', o => o.capa), p25 = parGroupe(OD25, bts, 'aca', o => o.capa);
  assert(p?.kind === 'evolution_groupes' && ligne(p, 'Lyon').v1 === p24.get('Lyon') && ligne(p, 'Lyon').v2 === p25.get('Lyon'), `places par académie : Lyon ${p24.get('Lyon')} → ${p25.get('Lyon')}`);
  assert(p.result.unite === 'places' && /somme de/.test(texte(p)), 'unité « places », somme précisée');
  const s = ask(ctx, 'comparaison du nombre de formations par statut entre 2024 et 2025');
  assert(s?.kind === 'evolution_groupes' && ligne(s, 'Public').v2 === OD25.filter(o => o.statut === 'Public').length, 'formations par statut : comparaison');
});

await describe('Colonnes renommées d\'une session à l\'autre', () => {
  const ctx = ctxDeuxSessions({ renommer: { aca: 'Académie (établissement)', capa: 'Capacité 2024' } });
  const e = ask(ctx, 'évolution des places en BTS par académie depuis 2024');
  const p24 = parGroupe(OD24, bts, 'aca', o => o.capa);
  assert(e?.kind === 'evolution_groupes' && ligne(e, 'Paris').v1 === p24.get('Paris'), 'colonnes 2024 retrouvées par leur nom technique (académie et capacité)');
  assert(e.result.lignes.every(l => l.v1 !== null || l.valeur === 'Corse'), 'aucune académie à « — » à cause d\'un nom de colonne');
});

await describe('Colonne introuvable dans une session : arrêt, pas un tableau de « — »', () => {
  const ctx = ctxDeuxSessions({ renommer: { aca: 'Académie (ancien nom)' } });
  run(ctx, "delete __t24.libelles.acad_mies");
  const e = ask(ctx, 'évolution du nombre de BTS par académie depuis 2024');
  assert(e?.kind === 'unresolved' && /n'a pas été retrouvée/.test(e.text) && /2024/.test(e.text), `arrêt expliqué (obtenu : ${e?.kind} ${String(e?.text || '').slice(0, 80)})`);
});

await describe('Classement de groupes : évolution avec les rangs', () => {
  const ctx = ctxDeuxSessions();
  const p24 = parGroupe(OD24, bts, 'aca', o => o.capa), p25 = parGroupe(OD25, bts, 'aca', o => o.capa);
  const rang = (m, v, asc = false) => [...m.entries()].sort((a, b) => asc ? a[1] - b[1] : b[1] - a[1]).findIndex(([k]) => k === v) + 1;
  const e = ask(ctx, 'les académies avec le plus de places en BTS : évolution depuis 2024');
  assert(e?.kind === 'evolution_groupes' && e.result.type === 'classement', `classement des académies : évolution (obtenu : ${e?.kind})`);
  if (e?.kind === 'evolution_groupes') {
    const premier = [...p25.entries()].sort((a, b) => b[1] - a[1])[0][0];
    assert(e.result.lignes[0].valeur === premier && e.result.lignes[0].rang2 === 1, `1er en 2025 : ${premier}`);
    assert(e.result.lignes.every(l => l.rang1 === null || l.rang1 === rang(p24, l.valeur)), 'rang 2024 de chaque académie exact');
    assert(/Rang 2024/.test(e.html) && /Rang 2025/.test(e.html), 'colonnes « Rang 2024 » et « Rang 2025 »');
    assert(/rang 2024 =/.test(run(ctx, 'dataEngineResultToContext')(e)), 'Albert reçoit les rangs');
    const ex = run(ctx, 'currentExecutionToRows')(e);
    assert(ex.length === e.result.lignes.length && 'Rang 2025' in ex[0] && '2024 (places)' in ex[0], 'export : rangs et valeurs de chaque session');
  }
  const asc = ask(ctx, 'les académies avec le moins de places en BTS : évolution depuis 2024');
  const dernier = [...p25.entries()].sort((a, b) => a[1] - b[1])[0][0];
  assert(asc?.kind === 'evolution_groupes' && asc.result.lignes[0].valeur === dernier, `« le moins de places » : ${dernier} en tête`);
});

await describe('Ce qui n\'est pas comparable : arrêt expliqué', () => {
  const ctx = ctxDeuxSessions();
  const f = ask(ctx, 'évolution des formations les plus demandées depuis 2024');
  assert(f?.kind === 'unresolved' && /suivies une à une/.test(f.text) && /par académie/.test(f.text), 'formations les plus demandées : pas suivies une à une, piste proposée');
  const pv = ask(ctx, 'évolution des formations par académie et par statut depuis 2024');
  assert(pv?.kind === 'unresolved' && /tableau croisé/.test(pv.text), 'tableau croisé : arrêt expliqué');
  const t = ask(ctx, "les académies avec le taux d'accès le plus élevé : évolution depuis 2024");
  assert(!t || t.kind === 'unresolved', 'taux par académie : pas additionné (arrêt)');
});

await describe('Session seule et autres sources', async () => {
  const ctx = ctxDeuxSessions();
  const e = ask(ctx, 'places en BTS par académie en 2024');
  assert(e?.kind === 'group_by' && rows(e).Paris === parGroupe(OD24, bts, 'aca', o => o.capa).get('Paris') && /session 2024/.test(e.html), 'places par académie en 2024 : somme sur la session 2024');
  // fichier de candidats (une ligne = un candidat) : rien ne change
  const c = await ctxCSV(D.versTableau(D.candidats(400, 3), D.enTetes.complets));
  const r = ask(c, 'répartition des candidats par académie');
  assert(r?.kind === 'group_by' && !r.result.somme, 'fichier de candidats : on compte des lignes (pas de somme)');
});

await describe('Graphique de l\'évolution par groupe', () => {
  const ctx = ctxDeuxSessions();
  const ev = ask(ctx, 'évolution du nombre de BTS par académie depuis 2024');
  const g = run(ctx, 'renderCurrentChartExecution')({ question: 'fais un graphique', tool: 'chart_current', sourceExecution: ev });
  assert(g?.kind === 'evolution_groupes' && /— 2024/.test(g.html) && /— 2025/.test(g.html), 'deux barres par groupe (2024 et 2025)');
  assert(run(ctx, 'shouldAnswerLocallyWithoutAlbert')({ kind: 'evolution_groupes' }) === true, 'réponse locale (pas de chiffre inventé par Albert)');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
