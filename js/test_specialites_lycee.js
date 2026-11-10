// test_specialites_lycee.js — Spécialité suivie au lycée ≠ spécialité / mention de la formation d'accueil.
// Dans l'export académique, presque toutes les spécialités de terminale partagent des mots avec des formations
// d'accueil : « Droit et Economie » / « Droit », « Mathématiques » / « Mathématiques », « Histoire-Géographie… » /
// « Histoire », « Physique-Chimie » / « Physique, chimie », « Gestion et finance » / « Gestion des entreprises… ».
// Règle (sur le modèle du droit) :
//   - « candidats en X », « admis en X » : la formation d'accueil ; le périmètre dit combien de candidats ont suivi
//     au lycée une spécialité dont le nom contient X ;
//   - « spécialité X », « X en terminale », sigles (SES, SVT, NSI…), noms propres au lycée (« droit et économie ») :
//     la spécialité du lycée (enseignements de spécialité ET spécialité de la classe de bac pro / STMG) ; le périmètre
//     dit combien de candidats ont une formation d'accueil dont l'intitulé contient X ;
//   - nom exact d'une spécialité d'abord (« mathématiques » ≠ « Physique-Chimie et Mathématiques »), puis les noms qui
//     commencent par les mots cités (« physique » = Physique-Chimie…), puis ceux qui les contiennent.
// Données FICTIVES (js/fixtures/donnees_simulees.mjs) ; chaque valeur attendue est recalculée sur les lignes.
// node js/test_specialites_lycee.js

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

const ROWS = D.exportAcademique(4000, 21);
const ctx = makeCtx();
ctx.XLSX = { read: () => ({ SheetNames: ['BDD'], Sheets: { BDD: 'ws' } }), utils: { sheet_to_json: () => ROWS.map(r => r.slice()) } };
await run(ctx, 'importSpreadsheetFile')({ name: 'BDD.xlsx', size: 1000, arrayBuffer: async () => new ArrayBuffer(8) });

const H = D.EXPORT_ACADEMIQUE_ENTETES;
const [, , , , , , , ACC, , , , , , , SPE, ENS, , GRP, , MENT] = H;
const L = ROWS.slice(1).map(r => Object.fromEntries(H.map((h, i) => [h, r[i]])));
const nb = pred => L.filter(pred).length;
const mots = v => new Set(String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/));
const sujets = r => [...String(r[ENS]).split('|'), String(r[SPE])].map(x => x.trim().replace(/^Msgn\/\s*/, '')).filter(Boolean);
const a = (r, nom) => sujets(r).includes(nom);
const commence = (r, debut) => sujets(r).some(x => x.startsWith(debut));

function ask(q) {
  run(ctx, 'window.__DATA_ENGINE_STATE = { lastPlan: null, lastExecution: null, history: [] }');
  ctx.__q = q;
  const plan = run(ctx, 'isDataEngineQuestion(__q)') ? run(ctx, 'detectDataEnginePlan(__q)') : null;
  return plan ? run(ctx, 'runDataEnginePlan')(plan, []) : null;
}
const perim = e => run(ctx, 'perimetreResultat')(e.kind, e.plan, e.result).texte;
const compte = (q, attendu, label) => {
  const e = ask(q);
  assert(e?.kind === 'count' && e.result.count === attendu, `« ${q} » → ${attendu}${label ? ` (${label})` : ''}${e?.kind === 'count' && e.result.count === attendu ? '' : ` (obtenu : ${e?.kind} ${e?.result?.count ?? String(e?.text || '').slice(0, 90)})`}`);
  return e || {};
};
const lycee = e => (e.plan?.filters || []).some(f => f.source === 'specialite_lycee');
const accueil = e => (e.plan?.filters || []).some(f => f.source === 'termes_formation' || f.col === MENT);

await describe('Sans repère : la formation d\'accueil, avec la spécialité du lycée signalée', () => {
  const d = compte('combien de candidats en droit', nb(r => mots(r[MENT]).has('droit')));
  assert(accueil(d) && !lycee(d) && new RegExp(`${nb(r => a(r, 'Droit et Economie'))} candidats du fichier ont suivi au lycée une spécialité dont le nom contient ce mot`).test(perim(d)), 'droit : formation d\'accueil, et le nombre de « Droit et Economie » au lycée');
  const m = compte('combien de candidats en mathématiques', nb(r => mots(r[MENT]).has('mathematiques')));
  assert(accueil(m) && /spécialité dont le nom contient ce mot \(« Mathématiques »/.test(perim(m)), 'mathématiques : formation d\'accueil ; la spécialité du lycée est signalée');
  const h = compte("combien de candidats admis en licence d'histoire", nb(r => r[ACC] === 'Oui' && r[GRP].startsWith('L1') && mots(r[MENT]).has('histoire')));
  assert(/Histoire-Géographie, Géopolitique et Sciences politiques/.test(perim(h)), 'histoire : la spécialité HGGSP est signalée');
});

await describe('« spécialité X », « en terminale », sigles : la spécialité du lycée, avec la formation d\'accueil signalée', () => {
  const m = compte('combien de candidats de la spécialité mathématiques', nb(r => a(r, 'Mathématiques')), 'le nom exact : pas « Physique-Chimie et Mathématiques »');
  assert(lycee(m) && !accueil(m), 'la spécialité du lycée, pas la mention « Mathématiques » de la formation d\'accueil');
  assert(new RegExp(`${nb(r => mots(r[MENT]).has('mathematiques'))} candidats ont été admis dans une formation d'accueil dont l'intitulé contient « Mathématiques »`).test(perim(m)), 'le périmètre dit combien ont la formation d\'accueil du même nom');
  compte('combien de candidats ayant suivi les spécialités maths et physique', nb(r => a(r, 'Mathématiques') && commence(r, 'Physique')), 'deux spécialités, pas « Physique-Chimie et Mathématiques »');
  compte('combien de candidats ayant la spécialité physique', nb(r => commence(r, 'Physique')), 'les spécialités dont le nom commence par Physique');
  compte('combien de candidats ayant fait histoire en terminale', nb(r => commence(r, 'Histoire')));
  compte('combien de candidats de la spécialité droit et économie', nb(r => a(r, 'Droit et Economie')));
  compte('combien de candidats en droit et économie', nb(r => a(r, 'Droit et Economie')), 'nom propre à la spécialité du lycée');
  compte('combien de candidats SES', nb(r => a(r, 'Sciences Economiques et Sociales')));
  compte('combien de candidats de la spécialité mercatique', nb(r => a(r, 'Mercatique')));
  compte('combien de candidats de la spécialité accompagnement soins et services à la personne', nb(r => r[SPE] === 'Accompagnement soins et services à la personne'), 'spécialité de bac pro (colonne « Spécialité »)');
});

await describe('Les deux à la fois, et repère de formation d\'accueil', () => {
  const b = compte('combien de candidats de la spécialité droit et économie admis en droit', nb(r => a(r, 'Droit et Economie') && r[ACC] === 'Oui' && mots(r[MENT]).has('droit')));
  assert(lycee(b) && accueil(b) && !/autre chose/.test(perim(b)), 'deux filtres ; aucune note « autre chose » (les deux sont demandés)');
  // la mention d'accueil n'est pas lue dans la spécialité du lycée (« spécialité physique-chimie admis en chimie » donnait
  // la mention « Physique, chimie » ; ici : « spécialité mathématiques admis en mathématiques » = Maths ET mention Maths)
  const mm = compte('combien de candidats de la spécialité mathématiques admis en mathématiques', nb(r => a(r, 'Mathématiques') && r[ACC] === 'Oui' && mots(r[MENT]).has('mathematiques')));
  assert(lycee(mm) && accueil(mm), 'spécialité du lycée ET formation d\'accueil');
  compte('combien de candidats SVT admis en PASS', nb(r => a(r, 'Sciences de la vie et de la Terre') && r[ACC] === 'Oui' && /PASS/.test(r[MENT])));
  compte('combien de candidats de la spécialité HGGSP admis en licence d\'histoire', nb(r => commence(r, 'Histoire') && r[ACC] === 'Oui' && r[GRP].startsWith('L1') && mots(r[MENT]).has('histoire')));
  const l = compte('combien de candidats admis en licence spécialité droit', nb(r => r[ACC] === 'Oui' && r[GRP].startsWith('L1') && mots(r[MENT]).has('droit')), '« licence spécialité droit » : la formation d\'accueil');
  assert(!lycee(l), 'faux positif : « spécialité » après « licence » ne vise pas le lycée');
});

await describe('Faux positifs : rien ne change sans mot commun', () => {
  const b = compte('combien de candidats en BTS', nb(r => r[GRP].startsWith('BTS')));
  assert(!/autre chose/.test(perim(b)), 'BTS : aucune note');
  const s = compte('combien de boursiers', nb(r => r['Boursier des lycées'] === 'Boursier des lycées'));
  assert(!lycee(s) && !/autre chose/.test(perim(s)), 'boursiers : aucune spécialité');
  const c = ask("combien de candidats ont eu une proposition mais ne l'ont pas acceptée");
  assert(c?.kind === 'count' && !lycee(c), 'question sans spécialité : aucune spécialité ajoutée');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
