// test_formats_fichiers.js — Banc de formats : le même fichier académique (fictif), présenté de 16 façons (colonnes dans
// un autre ordre, titre avant les en-têtes, onglet de notice, ligne « Total », CSV ; ou , UTF-8 ou Windows-1252, « O/N »,
// colonnes renommées, MAJUSCULES, « 0 » au lieu de case vide…), plus un tableau déjà calculé (une ligne = un département,
// comme le classeur régional du SAIO). Règle : chaque réponse est juste, ou le moteur s'arrête et le dit — jamais un
// autre chiffre. Erreurs trouvées et corrigées (v27.5.84) :
// - tableau déjà calculé : « combien de candidats » comptait les lignes (6) au lieu d'additionner « Nombre de candidats » ;
//   la ligne « Total académie » (entièrement remplie) était gardée ; « taux de proposition en Gironde » = 1/6 ;
// - colonnes renommées : « par type de classe » répondait sur le « Type de contrat » de l'établissement ;
// - « O/N » : « ont eu une proposition » perdait son filtre (tout le fichier) ; sans colonne de proposition, même erreur.
// Données FICTIVES (js/fixtures/donnees_simulees.mjs) ; chaque valeur attendue est recalculée sur les lignes.
// node js/test_formats_fichiers.js

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

// ── Fichier de référence (fictif) et vérité, calculée une fois sur les lignes d'origine ──
const H = D.EXPORT_ACADEMIQUE_ENTETES;
const ROWS = D.exportAcademique(2500, 31);
const L = ROWS.slice(1);
const PROP = 6, ADM = 7, APP = 8, BOURS = 9, TYPE = 12, VX = 16, GRP = 17, COM = 2;
const V = r => String(r[VX] ?? '').trim() !== '' && Number(r[VX]) >= 1;
const nf = f => L.filter(f).length;
const grp = (f, k) => { const m = {}; L.filter(f).forEach(r => { if (r[k] !== '') m[r[k]] = (m[r[k]] || 0) + 1; }); return m; };
const vx = L.filter(r => String(r[VX] ?? '').trim() !== '').map(r => Number(r[VX]));
const QUESTIONS = [
  ['combien de candidats', nf(V)],
  ['combien d\'élèves', L.length],
  ['combien de boursiers', nf(r => r[BOURS] === 'Boursier des lycées')],
  ['combien d\'apprentis', nf(r => r[APP] === 'Oui')],
  ['combien de candidats admis en BTS', nf(r => V(r) && r[ADM] === 'Oui' && String(r[GRP]).startsWith('BTS'))],
  ['combien de candidats de Pau', nf(r => V(r) && r[COM] === 'Pau')],
  ['taux de proposition des bacheliers généraux', `${nf(r => V(r) && r[TYPE] === 'Générale' && r[PROP] === 'Oui')}/${nf(r => V(r) && r[TYPE] === 'Générale')}`],
  ['nombre moyen de vœux', Math.round(vx.reduce((a, b) => a + b, 0) / vx.length * 100) / 100],
  ['combien de vœux au total', vx.reduce((a, b) => a + b, 0)],
  ['combien de candidats par type de classe', grp(V, TYPE)],
];

// ── Import par le vrai chemin du widget (Excel : SheetJS simulé ; CSV : octets) ──
async function importer({ nom = 'BDD.xlsx', onglets = null, lignes = null, octets = null, latin1 = false }) {
  const c = makeCtx();
  // moteur qui décode « windows-1252 » comme du Latin-1 (cas de Node 20) : œ, ’, € deviennent des caractères de contrôle
  if (latin1) c.TextDecoder = class { constructor(enc) { this.enc = enc; } decode(b) { if (!/1252/.test(this.enc)) return new TextDecoder(this.enc).decode(b); let t = ''; for (const x of new Uint8Array(b)) t += String.fromCharCode(x); return t; } };
  const feuilles = onglets || { BDD: lignes };
  c.XLSX.read = () => ({ SheetNames: Object.keys(feuilles), Sheets: Object.fromEntries(Object.keys(feuilles).map(k => [k, k])) });
  c.XLSX.utils.sheet_to_json = ws => (feuilles[ws] || []).map(r => r.slice());
  const buf = octets || new ArrayBuffer(8);
  await run(c, 'importSpreadsheetFile')({ name: nom, size: 1000, arrayBuffer: async () => buf });
  return c;
}
const egal = (a, b) => JSON.stringify(a) === JSON.stringify(b) || (typeof a === 'object' && typeof b === 'object' && a && b && Object.keys(b).length === Object.keys(a).length && Object.entries(b).every(([k, v]) => a[k] === v));
const ARRET = new Set(['arrêt', 'pas de calcul', 'clarification']);
async function banc(titre, opts, { tout = false } = {}) {
  const c = await importer(opts);
  const ask = asker(c);
  const res = QUESTIONS.map(([q, att]) => { const e = ask(q); const v = e?.plan?.clarification && e.kind !== 'count' ? 'clarification' : valeur(e); return { q, att, v, ok: egal(v, att), arret: ARRET.has(v) || e?.kind === 'unresolved' }; });
  return { titre, res, c };
}
// ── Variantes ──
const perm = H.map((_, i) => i).reverse();
const permuter = r => perm.map(i => r[i]);
const ON = r => r.map((v, k) => [PROP, ADM, APP].includes(k) ? (v === 'Oui' ? 'O' : v === 'Non' ? 'N' : v) : v);
const RENOMS = { [H[PROP]]: 'Proposition reçue', [H[ADM]]: 'Proposition acceptée', [H[BOURS]]: 'Statut boursier', [H[TYPE]]: 'Voie', [H[VX]]: 'Nombre de vœux confirmés', [H[GRP]]: "Groupe de formation d'accueil", [H[COM]]: 'Commune du lycée', [H[APP]]: 'En apprentissage' };
const csv = (rows, sep = ';') => rows.map(r => r.map(v => { const t = String(v ?? ''); return /[";\n,]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; }).join(sep)).join('\r\n');
const cp1252 = t => { const m = { 'œ': 0x9c, 'Œ': 0x8c, '’': 0x92, '€': 0x80 }; return Uint8Array.from([...t].map(ch => m[ch] ?? (ch.charCodeAt(0) < 256 ? ch.charCodeAt(0) : 0x3f))).buffer; };
const utf8 = t => new TextEncoder().encode(t).buffer;
const VARIANTES = [
  ['référence', { lignes: ROWS }, true],
  ['colonnes dans un autre ordre', { lignes: ROWS.map(permuter) }, true],
  ['titre et lignes vides avant les en-têtes', { lignes: [['Export Parcoursup 2025 — académie (données au 26/09)'], [], ['Extraction automatique'], [], ...ROWS] }, true],
  ['onglet « Lisez-moi » avant les données', { onglets: { 'Lisez-moi': [['Notice'], ['Une ligne = un élève de terminale.'], ['Source : Parcoursup']], BDD: ROWS } }, true],
  ['ligne « Total » en bas', { lignes: [...ROWS, ['Total', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', vx.reduce((a, b) => a + b, 0)]] }, true],
  ['nombres écrits comme du texte', { lignes: ROWS.map((r, i) => i ? r.map((v, k) => k === VX && v !== '' ? ` ${v} ` : v) : r) }, true],
  ['CSV point-virgule UTF-8 (avec BOM)', { nom: 'BDD.csv', octets: utf8('﻿' + csv(ROWS)) }, true],
  ['CSV point-virgule Windows-1252', { nom: 'BDD.csv', octets: cp1252(csv(ROWS)) }, true],
  ['CSV virgule', { nom: 'BDD.csv', octets: utf8(csv(ROWS, ',')) }, true],
  ['« O/N » au lieu de « Oui/Non »', { lignes: ROWS.map((r, i) => i ? ON(r) : r) }, false],
  ['colonnes renommées (autre export)', { lignes: [H.map(h => RENOMS[h] || h), ...L] }, false],
  ['valeurs en MAJUSCULES et espaces en trop', { lignes: ROWS.map((r, i) => i ? r.map((v, k) => typeof v === 'string' && v && k !== VX ? ` ${v.toUpperCase()} ` : v) : r) }, false],
  ['boursier en « Oui/Non »', { lignes: ROWS.map((r, i) => i ? r.map((v, k) => k === BOURS ? (v === 'Boursier des lycées' ? 'Oui' : 'Non') : v) : r.map((v, k) => k === BOURS ? 'Boursier' : v)) }, false],
  ['« 0 » au lieu de case vide pour les vœux', { lignes: ROWS.map((r, i) => i ? r.map((v, k) => k === VX && v === '' ? 0 : v) : r) }, false],
  ['en-têtes en double', { lignes: [H.map((h, k) => k === 5 ? H[BOURS] : h), ...L] }, false],
  ['colonne vide en plus et colonne « Remarques »', { lignes: [[...H, '', 'Remarques'], ...L.map((r, i) => [...r, '', i % 50 ? '' : 'à vérifier'])] }, false],
];

const cle = v => (v && typeof v === 'object') ? Object.fromEntries(Object.entries(v).map(([k, x]) => [String(k).trim().toLowerCase(), x])) : v;
const juste = (v, att) => egal(cle(v), cle(att));
// variantes où une valeur attendue change avec la présentation (« 0 » au lieu de case vide : la moyenne compte les 0)
const vx0 = L.map(r => String(r[VX] ?? '').trim() === '' ? 0 : Number(r[VX]));
const ATTENDU_VARIANTE = { '« 0 » au lieu de case vide pour les vœux': { 'nombre moyen de vœux': Math.round(vx0.reduce((a, b) => a + b, 0) / vx0.length * 100) / 100 } };

for (const [titre, opts, complet] of VARIANTES) {
  await describe(`Format : ${titre}`, async () => {
    const b = await banc(titre, opts);
    const att = ATTENDU_VARIANTE[titre] || {};
    const res = b.res.map(x => ({ ...x, att: x.q in att ? att[x.q] : x.att })).map(x => ({ ...x, ok: juste(x.v, x.att) }));
    const faux = res.filter(x => !x.ok && !x.arret);
    assert(!faux.length, `aucun chiffre faux${faux.length ? ` (obtenu : ${faux.map(x => `« ${x.q} » = ${JSON.stringify(x.v).slice(0, 60)} au lieu de ${JSON.stringify(x.att).slice(0, 60)}`).join(' ; ')})` : ''}`);
    if (complet) assert(res.every(x => x.ok), `les ${res.length} questions répondues comme sur le fichier de référence (arrêts : ${res.filter(x => x.arret).map(x => x.q).join(', ') || 'aucun'})`);
    else assert(res.filter(x => x.ok).length >= res.length - 1, `au plus une question sans réponse (${res.filter(x => !x.ok).map(x => x.q).join(', ') || 'aucune'})`);
  });
}

await describe('CSV Windows-1252 décodé comme du Latin-1 (Node 20) : « vœux » réparé', async () => {
  const c = await importer({ nom: 'BDD.csv', octets: cp1252(csv(ROWS)), latin1: true });
  const t = run(c, 'getActiveQueryTables()[0]');
  assert(t.headers.includes(H[VX]), `en-tête « ${H[VX]} » lu correctement (obtenu : ${JSON.stringify(t.headers.find(h => /^Nb total/.test(h)))})`);
  assert(valeur(asker(c)('combien de candidats')) === nf(V), `« combien de candidats » : ${nf(V)} (avant, sous Node 20 : ${L.length})`);
});

await describe('« O/N » : le critère « proposition » gardé', async () => {
  const c = await importer({ lignes: ROWS.map((r, i) => i ? ON(r) : r) });
  const e = asker(c)('combien de candidats ont eu une proposition');
  assert(valeur(e) === nf(r => V(r) && r[PROP] === 'Oui'), `« ont eu une proposition » avec « O/N » : ${nf(r => V(r) && r[PROP] === 'Oui')} (avant : tous les candidats ; obtenu : ${valeur(e)})`);
  assert(valeur(asker(c)('combien d\'apprentis')) === nf(r => r[APP] === 'Oui'), '« combien d\'apprentis » avec « O/N » (avant : arrêt)');
});

await describe('Colonnes renommées : « par type de classe » ne prend pas le type de contrat', async () => {
  const c = await importer({ lignes: [H.map(h => RENOMS[h] || h), ...L] });
  const e = asker(c)('combien de candidats par type de classe');
  assert(valeur(e) === 'arrêt' || e?.plan?.targetCol === 'Voie', `arrêt (ou la colonne « Voie »), pas « Type de contrat » (obtenu : ${e?.kind} ${e?.plan?.targetCol || ''})`);
  const t = asker(await importer({ lignes: ROWS }))('combien de candidats par type de contrat');
  assert(t?.kind === 'group_by' && t.plan.targetCol === H[11], 'faux positif : « par type de contrat » reste le type de contrat');
});

await describe('Sans colonne de proposition : arrêt, jamais tout le fichier', async () => {
  const c = await importer({ lignes: ROWS.map(r => r.filter((_, k) => k !== PROP)) });
  const ask = asker(c);
  for (const q of ['combien de candidats ont eu une proposition', 'combien de candidats sans proposition', 'taux de proposition des boursiers']) assert(valeur(ask(q)) === 'arrêt', `« ${q} » : arrêt (avant : un chiffre faux)`);
  assert(valeur(ask('combien de candidats admis')) === nf(r => V(r) && r[ADM] === 'Oui'), 'faux positif : « admis » (autre colonne) répond toujours');
});

await describe('Tableau déjà calculé (une ligne = un département) : on additionne, on ne compte pas les lignes', async () => {
  const deps = {};
  L.filter(V).forEach(r => { const d = r[0]; deps[d] = deps[d] || { c: 0, p: 0, a: 0, v: 0 }; deps[d].c++; if (r[PROP] === 'Oui') deps[d].p++; if (r[ADM] === 'Oui') deps[d].a++; deps[d].v += Number(r[VX]); });
  const T = Object.values(deps).reduce((t, x) => ({ c: t.c + x.c, p: t.p + x.p, a: t.a + x.a, v: t.v + x.v }), { c: 0, p: 0, a: 0, v: 0 });
  const lignes = [['Bilan Parcoursup 2025 — phase principale'], [], ['Département', 'Nombre de candidats', 'Candidats ayant reçu une proposition', 'Admis', 'Nombre de vœux', 'Taux de proposition (%)'],
    ...Object.entries(deps).map(([d, x]) => [d, x.c, x.p, x.a, x.v, Math.round(x.p / x.c * 1000) / 10]),
    ['Total académie', T.c, T.p, T.a, T.v, Math.round(T.p / T.c * 1000) / 10]];
  const c = await importer({ lignes });
  const ask = asker(c);
  const t = run(c, 'getActiveQueryTables()[0]');
  assert(t.rowUnit === 'agregat' && t.objects.length === Object.keys(deps).length, `tableau reconnu, ligne « Total académie » retirée (${t.objects.length} lignes, unité ${t.rowUnit})`);
  assert(valeur(ask('combien de candidats')) === T.c, `« combien de candidats » : ${T.c} (avant : ${Object.keys(deps).length + 1}, les lignes)`);
  assert(valeur(ask('nombre de candidats')) === T.c, '« nombre de candidats »');
  assert(valeur(ask('combien de candidats en Gironde')) === deps.Gironde.c, `candidats en Gironde : ${deps.Gironde.c} (avant : 1)`);
  assert(valeur(ask('combien d\'admis')) === T.a, 'admis : la colonne « Admis »');
  assert(valeur(ask('combien de vœux')) === T.v, 'vœux : la colonne « Nombre de vœux » (pas de filtre « au moins un vœu »)');
  assert(valeur(ask('taux de proposition')) === `${T.p}/${T.c}`, `taux de proposition : ${T.p}/${T.c}, somme ÷ somme`);
  assert(valeur(ask('taux de proposition en Gironde')) === `${deps.Gironde.p}/${deps.Gironde.c}`, 'taux de proposition en Gironde (avant : 1/6)');
  const g = ask('nombre de candidats par département');
  assert(egal(valeur(g), Object.fromEntries(Object.entries(deps).map(([d, x]) => [d, x.c]))), 'nombre de candidats par département : la colonne, pas 1 par ligne');
  assert(valeur(ask('combien de départements')) === Object.keys(deps).length, 'faux positif : « combien de départements » compte les départements');
  const m = ask('taux de proposition moyen');
  assert(m?.kind === 'stats' && /moyenne simple des pourcentages/.test(m.html || ''), 'moyenne d\'une colonne de taux : la note dit que ce n\'est pas le taux d\'ensemble');
  assert(valeur(ask('combien de boursiers')) === 'arrêt', 'mot sans colonne (« boursiers ») : arrêt, pas le nombre de lignes');
});

await describe('Faux positifs : fichiers ligne à ligne et vrais établissements', async () => {
  const c = await importer({ lignes: ROWS });
  assert(run(c, 'getActiveQueryTables()[0]').rowUnit === undefined, 'fichier académique : une ligne = un élève (pas un tableau calculé)');
  assert(valeur(asker(c)('combien de candidats')) === nf(V), 'fichier académique : définition SAIO inchangée');
  // un établissement « Ensemble scolaire … » en dernière ligne n'est pas une ligne de total
  const etabs = [['Établissement', 'Commune', 'Nombre de candidats'], ['Lycée A', 'Pau', 120], ['Lycée B', 'Dax', 80], ['Ensemble scolaire Saint-Joseph', 'Pau', 60]];
  const ce = await importer({ lignes: etabs });
  assert(run(ce, 'getActiveQueryTables()[0]').objects.length === 3 && valeur(asker(ce)('combien de candidats')) === 260, '« Ensemble scolaire Saint-Joseph » gardé (ce n\'est pas une ligne « Ensemble »)');
  // colonne d'état codée 1 / 0 : pas un effectif
  const etat = [['Commune', 'Boursier', 'Admis'], ...Array.from({ length: 30 }, (_, i) => ['Pau', i % 3 ? 0 : 1, i % 2])];
  const c01 = await importer({ lignes: etat });
  assert(run(c01, 'getActiveQueryTables()[0]').rowUnit === undefined && valeur(asker(c01)('combien de boursiers')) === 10, 'colonnes 1/0 : une ligne = une personne (10 boursiers)');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
