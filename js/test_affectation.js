// test_affectation.js — Base d'affectation en 1re dans Grist (tables liées Voeux, Eleves, Offre ; une ligne = un vœu).
// Le widget posé sur Voeux lit aussi Eleves et Offre (colonne commune, ou colonne Référence) ; « combien d'élèves »
// compte des élèves DIFFÉRENTS (un élève a plusieurs vœux), « combien de vœux » des lignes ; vocabulaire : « obtenu leur
// vœu 1 », « affectés », « non affectés », « en attente », « refusés » (codes du tour 1), « venant de 2nde pro », origine
// (département, ville de l'établissement, CEDEX compris) ; les calculs non adaptés s'arrêtent. Données fictives.
// Banc v27.5.98 : 91 chiffres faux sur 300 avant les corrections de la série, 0 sur 600 après. Corrigé aussi sur le
// fichier académique : « ont obtenu leur vœu 1 », « sont affectés » comptaient tous les candidats (arrêt désormais).
// node js/test_affectation.js

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

// ─── Base d'affectation fictive ──────────────────────────────────────────────
const A = D.affectation(800, 31);
function ctxAff({ liees = true, refs = false } = {}) {
  const ctx = makeCtx();
  let voeux = A.voeux, eleves = A.eleves.map((e, i) => ({ id: i + 1, ...e })), offre = A.offre.map((o, i) => ({ id: i + 1, ...o }));
  if (refs) { // colonnes « Référence » de Grist : le numéro de ligne de la table liée
    const idE = new Map(eleves.map(e => [e.Identifiant_eleve, e.id])), idO = new Map(offre.map(o => [o.Code_voeu_eleve, o.id]));
    voeux = voeux.map(v => ({ ...v, Identifiant_eleve: idE.get(v.Identifiant_eleve), Code_voeu_eleve: idO.get(v.Code_voeu_eleve) }));
  }
  ctx.__v = voeux; ctx.__l = liees ? [{ nom: 'Eleves', objets: eleves }, { nom: 'Offre', objets: offre }] : [];
  run(ctx, 'gristRecords = __v; gristTablesLiees = __l; setActiveSource("grist");');
  return ctx;
}
const c = ctxAff();
const E = new Map(A.eleves.map(e => [e.Identifiant_eleve, e]));
const parEleve = new Map(); A.voeux.forEach(v => { if (!parEleve.has(v.Identifiant_eleve)) parEleve.set(v.Identifiant_eleve, []); parEleve.get(v.Identifiant_eleve).push(v); });
const nb = (pe, pv = () => true) => [...parEleve.keys()].filter(id => pe(E.get(id)) && pv(parEleve.get(id))).length;
const V1 = vs => vs.some(v => v.Nombre_d_admis_voeu1_oui_non === 'Oui'), AFF = vs => vs.some(v => v.Nombre_d_admis_tous_voeux_oui_non === 'Oui');
const compte = (ctx, q) => { const e = ask(ctx, q); return e && e.kind === 'count' ? e.result.count : e?.kind; };

await describe('Tables liées : le widget posé sur Voeux lit aussi Eleves et Offre', () => {
  const t = run(c, 'getActiveQueryTables()[0]');
  assert(t.rowUnit === 'voeu' && t.cleEleve === 'Identifiant_eleve', 'table de vœux reconnue (l’identifiant élève se répète)');
  assert(t.objects.length === A.voeux.length && t.headers.includes('Departement_origine_eleve') && t.headers.includes('Libelle_formation_voeu'), 'colonnes des élèves et de l’offre ajoutées à chaque vœu');
  assert(/\+ Eleves, Offre/.test(t.name), 'tables liées annoncées dans le nom de la source');
  const cr = ctxAff({ refs: true });
  assert(compte(cr, "combien d'élèves issus des Landes") === nb(e => e.Departement_origine_eleve === 'Landes'), 'colonnes « Référence » (numéro de ligne) : liaison faite aussi');
  const sans = ctxAff({ liees: false });
  const r = ask(sans, "combien d'élèves issus des Landes");
  assert(r?.kind === 'unresolved', 'sans les tables liées : arrêt (la colonne d’origine manque), jamais tous les élèves');
  run(sans, 'gristLiaisonEtat = "refusee"');
  assert(/Accès complet au document/.test(ask(sans, "combien d'élèves issus des Landes")?.text || ''), 'accès refusé : le message dit comment donner l’accès au widget');
});

await describe('Compter des élèves, pas des lignes', () => {
  assert(compte(c, "combien d'élèves") === A.eleves.length, `« combien d'élèves » : ${A.eleves.length} élèves (et non ${A.voeux.length} lignes)`);
  assert(compte(c, 'combien de candidats') === A.eleves.length, '« candidats » : élèves différents');
  assert(compte(c, 'combien de vœux') === A.voeux.length, '« combien de vœux » : les lignes');
  assert(compte(c, "combien d'élèves issus des Landes") === nb(e => e.Departement_origine_eleve === 'Landes'), 'issus des Landes');
  const g = ask(c, "nombre d'élèves par département d'origine");
  const att = {}; A.eleves.forEach(e => { att[e.Departement_origine_eleve] = (att[e.Departement_origine_eleve] || 0) + 1; });
  assert(g && g.kind === 'group_by' && g.result.rows.every(x => att[x.value] === x.count), 'répartition par département : chaque élève compté une fois');
  assert(/élèves différents par groupe/.test(g.html), 'la répartition dit qu’elle compte des élèves différents');
});

await describe('Vocabulaire de l’affectation', () => {
  assert(compte(c, "combien d'élèves ont obtenu leur vœu 1") === nb(() => true, V1), 'obtenu leur vœu 1');
  assert(compte(c, "combien d'élèves ont eu leur premier vœu") === nb(() => true, V1), 'eu leur premier vœu');
  assert(compte(c, "combien d'élèves sont affectés") === nb(() => true, AFF), 'affectés');
  assert(compte(c, "combien d'élèves ne sont pas affectés") === nb(() => true, vs => !AFF(vs)), 'non affectés : aucun vœu admis (pas « un vœu refusé »)');
  assert(compte(c, "combien d'élèves n'ont pas obtenu leur premier vœu") === nb(() => true, vs => !V1(vs)), 'n’ont pas obtenu leur premier vœu');
  assert(compte(c, "combien d'élèves sont en attente") === nb(() => true, vs => vs.some(v => v.Code_decision_finale_resultat_eleve_par_tour === 2)), 'en attente : code 2 (tour 1)');
  assert(compte(c, "combien d'élèves sont refusés") === nb(() => true, vs => vs.some(v => v.Code_decision_finale_resultat_eleve_par_tour === 3)), 'refusés : code 3 (tour 1)');
  assert(ask(c, "combien d'élèves affectés au 2e tour")?.kind === 'unresolved', 'tour 2 : codes non établis → arrêt');
  assert(compte(c, "combien d'élèves venant de 2nde pro ont obtenu leur vœu 1") === nb(e => e.Classe_origine === '2nde PRO', V1), 'venant de 2nde pro (classe exacte, pas « 2nde » seul)');
  assert(compte(c, "combien d'élèves venant de 2nde GT") === nb(e => e.Classe_origine === '2nde GT'), 'venant de 2nde GT');
  assert(compte(c, "combien d'élèves d'un établissement de Bordeaux") === nb(e => /^BORDEAUX/.test(e.Localite_achemin_etab_nat_eleve)), 'établissement de Bordeaux : BORDEAUX et BORDEAUX CEDEX');
  assert(compte(c, 'combien de vœux à Bordeaux') === A.voeux.filter(v => A.offre.find(o => o.Code_voeu_eleve === v.Code_voeu_eleve).Ville_etab_voeu === 'BORDEAUX').length, '« vœux à Bordeaux » : la ville de l’établissement demandé');
});

await describe('Calculs pas encore adaptés : arrêt, jamais un élève compté plusieurs fois', () => {
  for (const q of ['part des élèves des Landes', "comparer les élèves de Gironde et des Landes", "nombre moyen de vœux par élève"]) {
    const e = ask(c, q);
    assert(!e || e.kind === 'unresolved', `« ${q} » : arrêt expliqué`);
  }
});

await describe('Formation et établissement DEMANDÉS (table Offre) : pas la classe d’origine', () => {
  const O = new Map(A.offre.map(o => [o.Code_voeu_eleve, o]));
  const el = pred => new Set(A.voeux.filter(v => pred(v, O.get(v.Code_voeu_eleve), E.get(v.Identifiant_eleve))).map(v => v.Identifiant_eleve)).size;
  const mn = m => (v, o) => o.Mnemonique_formation_voeu === m;
  // avant : « 1re pro » lu comme la classe d'origine (« 1re PRO », quelques élèves) au lieu de la formation demandée
  assert(compte(c, "combien d'élèves ont demandé une 1re pro") === el(mn('1PRO')), 'ont demandé une 1re pro : toutes les 1re pro demandées');
  assert(compte(c, "combien d'élèves ont demandé une première professionnelle") === el(mn('1PRO')), '« première professionnelle » = 1re pro');
  assert(compte(c, "combien d'élèves ont demandé une 1re générale") === el(mn('1GEN')), 'ont demandé une 1re générale (avant : venant de 1re GT)');
  assert(compte(c, "combien d'élèves ont demandé une 1re technologique") === el((v, o) => /^1ST/.test(o.Mnemonique_formation_voeu)), '1re technologique : toutes les séries');
  assert(compte(c, 'combien de vœux en 1re STMG') === A.voeux.filter(v => O.get(v.Code_voeu_eleve).Mnemonique_formation_voeu === '1STMG').length, 'vœux en 1re STMG : des lignes');
  assert(compte(c, "combien d'élèves ont demandé métiers de l'électricité") === el((v, o) => /ELECTRICITE/.test(o.Libelle_formation_voeu)), 'intitulé précis (avant : arrêt)');
  assert(compte(c, "combien d'élèves ont demandé MELEC") === el((v, o) => o.Specialite_formation_voeu === 'MELEC'), 'spécialité « MELEC »');
  assert(compte(c, "combien d'élèves sont affectés en 1re pro") === el((v, o) => o.Mnemonique_formation_voeu === '1PRO' && v.Nombre_d_admis_tous_voeux_oui_non === 'Oui'), 'affectés en 1re pro : admis sur un vœu de 1re pro');
  assert(compte(c, "combien d'élèves ont demandé une 1re pro en vœu 1") === el((v, o) => o.Mnemonique_formation_voeu === '1PRO' && v.Rang_voeu_eleve === 1), '« en vœu 1 » : rang du vœu (une demande, pas une admission)');
  assert(compte(c, "combien d'élèves venant de 2nde pro ont demandé une 1re générale") === el((v, o, e) => o.Mnemonique_formation_voeu === '1GEN' && e.Classe_origine === '2nde PRO'), 'origine 2nde pro + formation demandée 1re générale');
  assert(compte(c, "combien d'élèves des Landes ont demandé une 1re pro") === el((v, o, e) => o.Mnemonique_formation_voeu === '1PRO' && e.Departement_origine_eleve === 'Landes'), 'origine Landes + 1re pro demandée');
  assert(compte(c, "combien d'élèves ont demandé le lycée Montaigne") === el((v, o) => o.Denomination_etab_voeu === 'LYCEE MONTAIGNE'), 'établissement demandé (avant : arrêt « établissement non trouvé »)');
  // faux positifs et arrêts
  assert(compte(c, "combien d'élèves venant de 1re pro") === nb(e => e.Classe_origine === '1re PRO'), 'faux positif : « venant de 1re pro » reste la classe d’origine');
  assert(ask(c, "combien d'élèves en 1re pro")?.kind === 'unresolved', '« élèves en 1re pro » : demandée ou obtenue ? arrêt (avant : classe d’origine)');
  assert(ask(c, "combien d'élèves ont demandé une 1re bidule")?.kind === 'unresolved', 'formation introuvable : arrêt, pas tout le fichier');
  assert(ask(c, "combien d'élèves ont demandé une 1re STHR")?.kind === 'unresolved', 'série absente des données : arrêt');
  const sans = ctxAff({ liees: false });
  assert(ask(sans, "combien d'élèves ont demandé une 1re pro")?.kind === 'unresolved', 'sans la table Offre : arrêt (pas la classe d’origine à la place)');
  const f = ask(c, "combien d'élèves ont demandé une 1re pro")?.plan?.filters?.find(x => x.source === 'affectation');
  assert(f && /formation demandée 1re professionnelle : .*METIERS/.test(f.label), 'le filtre nomme les formations retenues');
});

await describe('Libellés : une ligne = un vœu (titre, phrase, « J’ai compris », relecture)', () => {
  const c2 = ctxAff();
  const titre = e => run(c2, 'extractBlockTitle')(e, '');
  const texte = e => String(run(c2, 'renderDataEngineResultHtml')(e.plan.tool, e.plan, e.result)).replace(/<details[\s\S]*/, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const suite = q => { c2.__q = q; const p = run(c2, 'detectDataEnginePlan(__q)'); return run(c2, 'runDataEnginePlan')(p, []); };
  const bx = A.eleves.filter(e => /^BORDEAUX/.test(e.Localite_achemin_etab_nat_eleve)).map(e => e.Identifiant_eleve);
  const vBx = A.voeux.filter(v => bx.includes(v.Identifiant_eleve)).length;
  const e1 = ask(c2, "Combien d'élèves de Bordeaux ?");
  // avant : « (sur 800 dans les données) » sans unité, à côté d'un nombre de vœux
  assert(texte(e1).includes(`(sur ${A.eleves.length.toLocaleString('fr-FR')} élèves dans les données)`), 'phrase : le total est un nombre d’élèves');
  assert(/pas un nombre de vœux/.test(texte(e1)), '« J’ai compris » : pas un nombre de vœux (avant : « de lignes »)');
  // relance « combien de vœux au total ? » : mêmes élèves (filtre repris et affiché), en vœux
  const e2 = suite('Combien de vœux au total ?');
  assert(e2?.result?.count === vBx, 'relance : les vœux des élèves de Bordeaux');
  // avant : « 15 576 candidats — BORDEAUX » sur la base réelle
  assert(/^[\d\s ]+ vœux — BORDEAUX$/.test(titre(e2)), `titre en vœux, pas en candidats (${titre(e2)})`);
  assert(/repris de la question précédente/.test(texte(e2)), 'le filtre repris est signalé');
  assert(/J'ai compris : nombre de vœux/.test(texte(e2)), '« J’ai compris : nombre de vœux » (avant : « de lignes »)');
  const e3 = suite('Combien de vœux dans toute la base ?');
  assert(e3?.result?.count === A.voeux.length && /^[\d\s ]+ vœux$/.test(titre(e3)), '« dans toute la base » : tous les vœux');
  // relecture par Albert : « combien d'élèves » = un comptage de personnes, pas « un nombre d'éléments différents »
  for (const f of ['retours.js', 'verification.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), c2, { filename: f });
  assert(run(c2, 'lectureMoteurVerif')(e1).op === 'compter', 'relecture : élèves différents = compter (avant : fausse alerte « nombre d’éléments différents »)');
  // faux positif : ailleurs, des valeurs différentes restent « compter_distinct » (open data : académies différentes)
  const co = ctxOpenData(D.openData(1500, 7));
  for (const f of ['retours.js', 'verification.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), co, { filename: f });
  const eo = ask(co, 'combien d’académies différentes proposent des BTS');
  assert(eo?.plan?.compterValeurs && run(co, 'lectureMoteurVerif')(eo).op === 'compter_distinct', 'open data : académies différentes = compter_distinct (inchangé)');
  assert(run(co, 'extractBlockTitle')(ask(co, 'combien de BTS en Gironde'), '').includes('formation'), 'open data : titre en formations (inchangé)');
});

await describe('Faux positifs : les autres sources ne changent pas', () => {
  const ca = makeCtx();
  const ROWS = D.exportAcademique(1500, 21);
  ca.XLSX.read = () => ({ SheetNames: ['BDD'], Sheets: { BDD: 'ws' } });
  ca.XLSX.utils.sheet_to_json = () => ROWS.map(r => r.slice());
  return run(ca, 'importSpreadsheetFile')({ name: 'BDD.xlsx', size: 1000, arrayBuffer: async () => new ArrayBuffer(8) }).then(() => {
    const t = run(ca, 'getActiveQueryTables()[0]');
    assert(t.rowUnit !== 'voeu', 'fichier académique (une ligne = un élève) : pas une table de vœux');
    // avant : « combien de candidats ont obtenu leur vœu 1 » comptait TOUS les candidats (mots ignorés)
    assert(ask(ca, 'combien de candidats ont obtenu leur vœu 1')?.kind === 'unresolved', 'fichier sans résultat d’affectation : « obtenu leur vœu 1 » → arrêt, pas tous les candidats');
    assert(ask(ca, 'combien de candidats sont affectés')?.kind === 'unresolved', '« sont affectés » → arrêt');
    assert(ask(ca, 'combien de candidats de Pau affectés à Bordeaux')?.kind === 'count', 'faux positif : « affectés à Bordeaux » (lieu d’accueil) reste calculé');
    const od = ctxOpenData(D.openData(500, 5));
    assert(run(od, 'getActiveQueryTables()[0]').rowUnit === 'formation', 'open data : une ligne = une formation (inchangé)');
  });
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
