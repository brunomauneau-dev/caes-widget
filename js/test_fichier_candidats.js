// test_fichier_candidats.js — Export académique de suivi des candidats (une ligne = un candidat, 22 colonnes).
// Essai sur un vrai export anonymisé (35 286 candidats, 10/11/2026) : une vingtaine de chiffres faux affichés comme
// exacts, dont « combien de candidats ont eu une proposition » = tout le fichier, « en droit » comptant la spécialité
// « Droit et Economie » du lycée, « bac technologique » = STMG seule, « scolarisés à Bordeaux » = 0, « candidats de
// Pau » = tout le fichier, « taux de proposition des boursiers » = part des boursiers, « apprentis admis en BTS »
// perdant le filtre apprenti, « lycée Gustave Eiffel » lu comme la série STAV (« Gu-stav-e »).
// Les données ci-dessous sont FICTIVES (mêmes en-têtes que l'export, js/fixtures/donnees_simulees.mjs) ;
// chaque valeur attendue est recalculée directement sur les lignes.
// node js/test_fichier_candidats.js

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

// Le fichier passe par le vrai chemin d'import (classeur Excel : SheetJS simulé)
const ROWS = D.exportAcademique(4000, 21);
const ctx = makeCtx();
ctx.XLSX = { read: () => ({ SheetNames: ['BDD'], Sheets: { BDD: 'ws' } }), utils: { sheet_to_json: () => ROWS.map(r => r.slice()) } };
const table = await run(ctx, 'importSpreadsheetFile')({ name: 'BDD_Academique_2025.xlsx', size: 1000, arrayBuffer: async () => new ArrayBuffer(8) });

const H = D.EXPORT_ACADEMIQUE_ENTETES;
const [DEP, UAI, COM, BASQUE, ETAB, , PROP, ACC, APP, BOURS, MIN, CONTRAT, TYPE, SERIE, , ENS, NBV, GRP, ACA, MENT, ETABA, COMA] = H;
const L = ROWS.slice(1).map(r => Object.fromEntries(H.map((h, i) => [h, r[i]])));
const nb = pred => L.filter(pred).length;
const mots = v => new Set(String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/));
const B = r => r[BOURS] === 'Boursier des lycées';
const oui = c => r => r[c] === 'Oui';

function ask(q, suite = false) {
  if (!suite) run(ctx, 'window.__DATA_ENGINE_STATE = { lastPlan: null, lastExecution: null, history: [] }');
  ctx.__q = q;
  const plan = run(ctx, 'isDataEngineQuestion(__q)') ? run(ctx, 'detectDataEnginePlan(__q)') : null;
  return plan ? run(ctx, 'runDataEnginePlan')(plan, []) : null;
}
const perim = e => run(ctx, 'perimetreResultat')(e.kind, e.plan, e.result).texte;
const compte = (q, attendu, label) => {
  const e = ask(q);
  assert(e?.kind === 'count' && e.result.count === attendu, `« ${q} » → ${attendu}${label ? ` (${label})` : ''}${e?.kind === 'count' && e.result.count === attendu ? '' : ` (obtenu : ${e?.kind} ${e?.result?.count ?? String(e?.text || '').slice(0, 90)})`}`);
  return e;
};
const arret = (q, label) => {
  const e = ask(q);
  assert(e?.kind === 'unresolved', `« ${q} » : arrêt, pas de chiffre (${label})${e?.kind === 'unresolved' ? '' : ` (obtenu : ${e?.kind} ${e?.result?.count ?? ''})`}`);
  return e;
};

await describe('Import : 22 colonnes, une colonne sans titre, chaque colonne comprise', () => {
  assert(run(ctx, 'getActiveSourceKind()') === 'file' && table.objects.length === 4000, '4 000 candidats lus, fichier = source active');
  const kind = h => run(ctx, `window.plannerColumnKind(${JSON.stringify(h)})`);
  assert(kind(ETAB) === 'etablissement_origine_nom' && kind(ETABA) === 'etablissement_accueil', 'établissement de scolarité ≠ établissement d\'accueil');
  assert(kind(PROP) === 'admission' && kind(ACC) === 'admission', 'deux colonnes Oui/Non de suivi (proposition, réponse favorable)');
});

await describe('Proposition reçue ≠ proposition acceptée', () => {
  compte('combien de candidats ont eu une proposition', nb(oui(PROP)), 'avant : tout le fichier');
  compte('combien de candidats sans proposition', nb(r => r[PROP] === 'Non'));
  compte("combien de candidats n'ont pas eu de proposition", nb(r => r[PROP] === 'Non'));
  compte('combien de boursiers sans aucune proposition', nb(r => r[PROP] === 'Non' && B(r)));
  compte("combien de candidats ont eu une proposition mais ne l'ont pas acceptée", nb(r => r[PROP] === 'Oui' && r[ACC] === 'Non'));
  const a = compte('combien de candidats ont accepté une proposition', nb(oui(ACC)));
  assert(!(a?.plan?.filters || []).some(f => f.col === PROP), 'faux positif : « accepté une proposition » ne filtre pas aussi « A eu une proposition »');
  const t = ask('taux de proposition des boursiers');
  const nbB = nb(B);
  assert(t?.kind === 'part' && t.result.num === nb(r => B(r) && r[PROP] === 'Oui') && t.result.den === nbB, `taux de proposition des boursiers = boursiers avec proposition / boursiers (avant : part des boursiers dans le fichier ; obtenu : ${t?.result?.num} / ${t?.result?.den})`);
  const p = ask('part des boursiers parmi les candidats admis');
  assert(p?.kind === 'part' && p.result.num === nb(r => B(r) && r[ACC] === 'Oui') && p.result.den === nb(oui(ACC)), 'part des boursiers parmi les admis');
});

await describe('Formation d\'accueil, pas les spécialités du lycée', () => {
  compte('combien de candidats en droit', nb(r => mots(r[MENT]).has('droit')), 'avant : + spécialité « Droit et Economie » du lycée');
  compte('combien de candidats admis en licence de droit', nb(r => r[ACC] === 'Oui' && r[GRP].startsWith('L1') && mots(r[MENT]).has('droit')), 'avant : « licence » cherché dans les intitulés → arrêt');
  compte("combien de candidats en école d'ingénieurs", nb(r => r[GRP] === "Formations d'ingénieurs"), 'avant : + licences « Sciences pour l\'ingénieur », BTS « Assistance technique d\'ingénieur »');
  compte('combien de candidats en BTS', nb(r => r[GRP].startsWith('BTS')));
  compte('combien en prépa', nb(r => r[GRP] === 'CPGE - CPES'));
  compte('combien de candidats en BUT GEA', nb(r => r[GRP] === 'DUT' && /Gestion des entreprises/.test(r[MENT])));
});

await describe('Séries de bac : la bonne colonne', () => {
  compte('combien de candidats de bac technologique', nb(r => r[TYPE] === 'Technologique'), 'avant : STMG seule');
  compte('combien de bac pro', nb(r => r[TYPE] === 'Professionnelle'), 'bacs pro agricoles compris');
  compte('combien de bac pro agricole', nb(r => r[SERIE] === 'Professionnelle Agricole'));
  compte('combien de candidats de la voie professionnelle agricole', nb(r => r[SERIE] === 'Professionnelle Agricole'));
  compte('combien de candidats STMG', nb(r => /Management/.test(r[SERIE])), 'avant : filtre perdu, tout le fichier');
  compte('combien de ST2S', nb(r => /santé et du social/.test(r[SERIE])));
  compte('combien de bacheliers généraux', nb(r => r[TYPE] === 'Générale'));
  compte('combien de boursiers du lycée Gustave Eiffel', nb(r => r[ETAB] === 'Lycée Gustave Eiffel' && B(r)), 'faux positif : « Gustave » n\'est pas la série STAV');
});

await describe('Lieux : scolarité ou accueil', () => {
  compte('combien de candidats scolarisés à Bordeaux', nb(r => r[COM] === 'Bordeaux'), 'avant : 0 (« Lycée agricole de Bordeaux Blanquefort »)');
  compte('combien de candidats des lycées de Bordeaux', nb(r => r[COM] === 'Bordeaux'));
  compte('combien de candidats de Pau', nb(r => r[COM] === 'Pau'), 'avant : tout le fichier');
  compte('combien de candidats admis à Bordeaux', nb(r => r[COMA] === 'Bordeaux' && r[ACC] === 'Oui'));
  compte('combien de boursiers de Pau admis à Bordeaux', nb(r => r[COM] === 'Pau' && r[COMA] === 'Bordeaux' && B(r) && r[ACC] === 'Oui'));
  const pa = compte('combien de candidats admis à Paris', nb(r => /^Paris /.test(r[COMA]) && r[ACC] === 'Oui'), 'tous les arrondissements');
  assert(/arrondissements/.test(perim(pa)), 'le périmètre le dit');
  compte('combien de candidats de Dordogne admis à Toulouse', nb(r => r[DEP] === 'Dordogne' && r[COMA] === 'Toulouse' && r[ACC] === 'Oui'), 'avant : département perdu');
  compte('combien de candidats du Lot-et-Garonne', nb(r => r[DEP] === 'Lot-et-Garonne'));
  compte('combien de candidats du Pays Basque', nb(r => r[BASQUE] === 'oui'));
});

await describe('Académie : « hors académie », « restent dans l\'académie »', () => {
  compte('combien de candidats partent hors académie', nb(r => r[ACA] && r[ACA] !== 'Bordeaux'), 'avant : tout le fichier');
  compte("combien de candidats restent dans l'académie", nb(r => r[ACA] === 'Bordeaux'));
  compte("combien de boursiers quittent l'académie", nb(r => r[ACA] && r[ACA] !== 'Bordeaux' && B(r)));
  compte("combien de candidats admis dans l'académie de Toulouse", nb(r => r[ACA] === 'Toulouse' && r[ACC] === 'Oui'), 'faux positif : académie nommée');
  compte("combien de candidats admis hors de l'académie de Bordeaux", nb(r => r[ACA] && r[ACA] !== 'Bordeaux' && r[ACC] === 'Oui'));
});

await describe('Établissement de scolarité ou d\'accueil', () => {
  compte('combien de candidats du lycée Montaigne', nb(r => r[ETAB] === 'Lycée Montaigne'), 'lycée d\'origine');
  compte('combien de candidats admis au lycée Montaigne', nb(r => r[ACC] === 'Oui' && /Lycée Montaigne/.test(r[ETABA])), 'lycée d\'accueil');
  compte('combien de candidats issus du lycée Victor Louis admis en CPGE', nb(r => r[ETAB] === 'Lycée Victor Louis' && r[GRP] === 'CPGE - CPES' && r[ACC] === 'Oui'));
  compte('combien de candidats du privé', nb(r => r[CONTRAT] !== 'Public'));
  compte('combien de candidats issus du public', nb(r => r[CONTRAT] === 'Public'), 'faux positif : pas le lycée « … travaux publics »');
  compte('combien de candidats de lycées agricoles', nb(r => r[MIN] === 'Agriculture'), 'ministère de l\'Agriculture');
  const ly = compte('combien de lycées', new Set(L.map(r => r[UAI])).size, 'établissements de scolarité différents');
  assert(/établissements différents/.test(ly.html) && /candidats?/.test(ly.html) && !/formations?/.test(ly.text), 'dit « candidats », pas « formations »');
  const pl = ask('nombre de candidats par lycée');
  assert(pl?.kind === 'group_by' && pl.plan.targetCol === ETAB && !(pl.plan.filters || []).length, '« par lycée » : une répartition par lycée de scolarité, sans filtre (avant : « nom contenant lycée » réparti par boursier)');
  const mx = ask('répartition par formation des candidats du lycée Max Linder');
  assert(mx?.kind === 'group_by' && mx.result.total === nb(r => r[ETAB] === 'Lycée Max Linder'), 'faux positif : « Max Linder » n\'est pas un maximum');
});

await describe('Spécialités suivies au lycée', () => {
  compte('combien de candidats suivant la spécialité SES', nb(r => mots(r[ENS]).has('economiques') && mots(r[ENS]).has('sociales')), 'avant : filtre perdu');
  // v27.5.55 — « maths et physique » = la spécialité Mathématiques ET une spécialité dont le nom commence par Physique
  // (Physique-Chimie), pas n'importe quelle case contenant les deux mots (« Physique-Chimie et Mathématiques » de STI2D)
  const sujets = r => String(r[ENS]).split('|').map(x => x.trim());
  compte('combien de candidats ayant suivi les spécialités maths et physique', nb(r => sujets(r).includes('Mathématiques') && sujets(r).some(x => x.startsWith('Physique'))));
  compte('combien de candidats avec la spécialité NSI admis en BUT', nb(r => mots(r[ENS]).has('numerique') && r[ACC] === 'Oui' && r[GRP] === 'DUT'));
});

await describe('« Droit » : formation d\'accueil ou enseignement de spécialité « Droit et Economie » du lycée', () => {
  const DE = r => /Droit et Economie/.test(r[ENS]);
  const d = compte('combien de candidats en droit', nb(r => mots(r[MENT]).has('droit')), 'formation d\'accueil');
  assert(new RegExp(`${nb(DE)} candidats du fichier ont suivi au lycée une spécialité dont le nom contient ce mot \\(« Droit et Economie »\\)`).test(perim(d)), `le périmètre dit qu'il s'agit de la formation d'accueil et combien ont la spécialité du lycée (${nb(DE)})`);
  compte('combien de candidats ayant la spécialité droit et économie', nb(DE), 'spécialité du lycée');
  compte('combien de candidats en droit et économie', nb(DE), '« Droit et Économie » est le nom de la spécialité du lycée');
  compte('combien de candidats ayant suivi la spécialité droit en terminale', nb(DE));
  compte('combien de candidats de la spécialité droit et économie admis en droit', nb(r => DE(r) && r[ACC] === 'Oui' && mots(r[MENT]).has('droit')), 'les deux à la fois');
  const b = compte('combien de candidats en BTS', nb(r => r[GRP].startsWith('BTS')));
  assert(!/enseignement de spécialité/.test(perim(b)), 'faux positif : pas de note quand aucun enseignement du lycée ne porte le mot');
  const s = ask('combien de candidats suivant la spécialité SES');
  assert(!/porte sur la formation d'accueil/.test(perim(s)), 'faux positif : pas de note quand la question vise la spécialité du lycée');
});

await describe('Cumul de critères Oui/Non : aucun n\'est perdu', () => {
  compte('combien de candidats en apprentissage admis en BTS', nb(r => r[APP] === 'Oui' && r[ACC] === 'Oui' && r[GRP].startsWith('BTS')), 'avant : apprenti retiré comme « doublon » de Oui');
  compte("combien d'apprentis boursiers", nb(r => r[APP] === 'Oui' && B(r)));
  compte('combien de candidats ont plus de 10 vœux', nb(r => typeof r[NBV] === 'number' && r[NBV] > 10));
});

await describe('Ce que le fichier ne permet pas : arrêt', () => {
  arret('combien de candidats en mercatique', 'mot reconnu nulle part comme formation d\'accueil');
  arret("combien de candidats n'ont confirmé aucun vœu", 'la colonne est vide, pas à 0');
  arret('combien de candidates', 'pas de colonne sexe');
  arret('combien de candidats en attente', 'pas de statut liste d\'attente');
});

await describe('Répartitions et classements', () => {
  const f = ask('quelles sont les formations les plus demandées par les bac pro');
  assert(f?.kind === 'top' && f.plan.targetCol === GRP, `« les plus demandées par les bac pro » : par formation, « par les bac pro » est le filtre (obtenu : ${f?.plan?.targetCol})`);
  const a = ask("répartition par académie d'accueil");
  assert(a?.kind === 'group_by' && a.plan.targetCol === ACA && !(a.plan.filters || []).length, '« par académie d\'accueil » : aucun mot « accueil » cherché dans les intitulés');
  const c = ask('répartition par type de contrat');
  assert(c?.kind === 'group_by' && c.plan.targetCol === CONTRAT, '« par type de contrat » : la colonne Type de contrat, pas Type de la classe');
  // règle changée (v27.5.54) : « pourcentage … par département » donne maintenant le taux DANS chaque département
  // (avant : répartition du total, avec une note) — voir test_part_groupes.js
  const p = ask('pourcentage de candidats sans proposition par département');
  const gi = p?.result?.groupes?.find(g => g.valeur === 'Gironde');
  assert(p?.kind === 'part_groupes' && gi && gi.num === nb(r => r[DEP] === 'Gironde' && r[PROP] === 'Non') && gi.den === nb(r => r[DEP] === 'Gironde'), 'pourcentage … par département : le taux dans chaque département');
  const t = ask('pourcentage de candidats sans proposition en Gironde');
  assert(t?.kind === 'part' && t.result.num === nb(r => r[DEP] === 'Gironde' && r[PROP] === 'Non') && t.result.den === nb(r => r[DEP] === 'Gironde'), 'le taux pour un département se calcule');
  const s = ask('nombre moyen de vœux des boursiers');
  const v = L.filter(r => B(r) && typeof r[NBV] === 'number').map(r => r[NBV]);
  assert(s?.kind === 'stats' && Math.abs(s.result.avg - v.reduce((x, y) => x + y, 0) / v.length) < 1e-9, 'nombre moyen de vœux des boursiers (cases vides écartées)');
});

await describe('Relances', () => {
  ask('combien de candidats en BTS');
  const r = ask('par département', true);
  const g = r?.result?.rows?.find(x => x.value === 'Gironde');
  assert(r?.kind === 'group_by' && g?.count === nb(x => x[GRP].startsWith('BTS') && x[DEP] === 'Gironde'), 'combien en BTS >> par département : BTS gardé');
  ask('combien de boursiers');
  const n = ask('et les non boursiers', true);
  assert(n?.kind === 'count' && n.result.count === nb(x => x[BOURS] === 'Non boursier du secondaire'), 'combien de boursiers >> et les non boursiers');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
