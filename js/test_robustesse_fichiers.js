// test_robustesse_fichiers.js — Le widget ne doit pas « se perdre » dans un fichier Excel ou un gros jeu de données.
// Faux fichiers réalistes (js/fixtures/donnees_simulees.mjs) dont on connaît les bonnes réponses :
//  - extraction de candidats avec en-têtes complets, abrégés (BOURS, GRP_FORM_ACC…), vagues (Colonne A…),
//    et mise en page d'export désordonnée (titres, ligne vide, colonne vide, ligne « Total », valeurs BO) ;
//  - classeur Excel dont le premier onglet est une notice ;
//  - open data Parcoursup simulé de 14 000 formations.
// Règle centrale : une réponse chiffrée est EXACTE, ou le widget dit qu'il n'a pas reconnu le critère.
// Jamais un chiffre faux en silence (ex. le total du fichier parce qu'un filtre a été perdu).
// node js/test_robustesse_fichiers.js

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
    __exports: [],
  };
  ctx.XLSX = { utils: { json_to_sheet: rows => { ctx.__exports.push(rows.length); return {}; }, book_new: () => ({}), book_append_sheet() {}, sheet_to_csv: () => '' }, writeFile() {} };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.selectedDocIds = new Set();
  vm.createContext(ctx);
  for (const f of ['config.js', 'knowledge.js', 'documents.js', 'planner.js', 'dataEngine.js', 'sessions.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
  }
  ctx.resetContextSilent = () => {};
  return ctx;
}
const run = (ctx, code) => vm.runInContext(code, ctx);

// Import CSV par le vrai code d'import
async function ctxCSV(rows, name = 'extraction.csv') {
  const ctx = makeCtx();
  const buf = new TextEncoder().encode(D.versCSV(rows));
  const table = await run(ctx, 'importSpreadsheetFile')({ name, size: buf.length, arrayBuffer: async () => buf.buffer });
  return { ctx, table };
}
// Import Excel par le vrai code d'import ; classeur simulé (SheetJS n'est pas chargé dans les tests)
async function ctxExcel(onglets, name = 'extraction.xlsx') {
  const ctx = makeCtx();
  ctx.XLSX.read = () => ({ SheetNames: Object.keys(onglets), Sheets: Object.fromEntries(Object.keys(onglets).map(k => [k, { k }])) });
  ctx.XLSX.utils.sheet_to_json = ws => onglets[ws.k];
  const table = await run(ctx, 'importSpreadsheetFile')({ name, size: 1000, arrayBuffer: async () => new ArrayBuffer(8) });
  return { ctx, table };
}
function ctxOpenData(lignes) {
  const ctx = makeCtx();
  ctx.__t = D.tableOpenData(lignes);
  run(ctx, "defaultOpenDataTable = __t; defaultOpenDataState = 'ready';");
  return ctx;
}
// Une question posée « à froid » (sans conversation précédente), comme dans le widget
function ask(ctx, q) {
  run(ctx, 'window.__DATA_ENGINE_STATE = { lastPlan: null, lastExecution: null, history: [] }');
  ctx.__q = q;
  const plan = run(ctx, 'isDataEngineQuestion(__q)') ? run(ctx, 'detectDataEnginePlan(__q)') : null;
  const exec = plan ? run(ctx, 'runDataEnginePlan')(plan, []) : null;
  return { plan, exec };
}
// Valeur obtenue, selon le type de réponse attendu
function obtenu(exec, type, cle) {
  if (!exec) return undefined;
  if (type === 'count') return exec.kind === 'count' ? exec.result.count : undefined;
  if (type === 'sum') return exec.kind === 'sum' ? exec.result.sum : undefined;
  if (type === 'avg') return exec.kind === 'stats' ? Math.round(exec.result.avg * 100) / 100 : undefined;
  if (type === 'group') return (exec.kind === 'group_by' || exec.kind === 'top') ? (exec.result.rows.find(r => r.value === cle) || {}).count : undefined;
  return undefined;
}
const moyenne = (xs, f) => Math.round(xs.reduce((s, x) => s + f(x), 0) / xs.length * 100) / 100;
const resume = e => !e ? 'aucun calcul' : e.kind === 'unresolved' ? 'non reconnu' : `${e.kind} ${e.result?.count ?? e.result?.sum ?? e.result?.avg ?? ''}`;

// ─── Questions sur les candidats, avec la vérité calculée sur les lignes ─────
const C = D.candidats(3000);
const n = p => D.compter(C, p);
const QUESTIONS_CANDIDATS = [
  { q: 'combien de candidats', type: 'count', v: C.length },
  { q: 'combien de boursiers', type: 'count', v: n(c => c.boursier === 'Oui') },
  { q: 'combien de non boursiers', type: 'count', v: n(c => c.boursier === 'Non') },
  { q: 'combien de candidats admis en BTS', type: 'count', v: n(c => c.groupe === 'BTS') },
  { q: 'combien de boursiers en CPGE', type: 'count', v: n(c => c.boursier === 'Oui' && c.groupe === 'CPGE') },
  { q: 'combien de candidats du Pays Basque', type: 'count', v: n(c => c.basque === 'Oui') },
  { q: 'combien de filles', type: 'count', v: n(c => c.sexe === 'Féminin') },
  { q: 'combien de bacheliers technologiques', type: 'count', v: n(c => c.serie === 'Technologique') },
  { q: 'combien de candidats venant du lycée Montaigne', type: 'count', v: n(c => c.lycee_origine === 'Lycée Montaigne') },
  { q: 'combien de candidats des Landes', type: 'count', v: n(c => c.dep_origine === 'Landes') },
  { q: 'combien de candidats partis hors académie de Bordeaux', type: 'count', v: n(c => c.aca_accueil !== 'Bordeaux') },
  { q: 'combien de candidats admis en licence de droit', type: 'count', v: n(c => c.specialite === 'Licence - Droit') },
  { q: 'combien de candidats en PASS', type: 'count', v: n(c => c.groupe === 'PASS') },
  { q: "combien d'apprentis", type: 'count', v: n(c => c.apprenti === 'Oui') },
  { q: 'répartition par série de bac', type: 'group', cle: 'Générale', v: n(c => c.serie === 'Générale') },
  { q: "répartition des candidats par département d'origine", type: 'group', cle: 'Gironde', v: n(c => c.dep_origine === 'Gironde') },
  { q: 'répartition des boursiers par grand groupe de formation', type: 'group', cle: 'BTS', v: n(c => c.boursier === 'Oui' && c.groupe === 'BTS') },
  { q: 'nombre moyen de vœux confirmés', type: 'avg', v: moyenne(C, c => c.nb_voeux) },
  { q: 'moyenne des vœux des boursiers', type: 'avg', v: moyenne(C.filter(c => c.boursier === 'Oui'), c => c.nb_voeux) },
];

function verifierToutExact(ctx, nomVariante) {
  QUESTIONS_CANDIDATS.forEach(t => {
    const { exec } = ask(ctx, t.q);
    const v = obtenu(exec, t.type, t.cle);
    assert(v === t.v, `${nomVariante} — « ${t.q} » → ${t.v} (obtenu : ${v ?? resume(exec)})`);
  });
}

await describe('Extraction aux en-têtes complets : toutes les réponses exactes', async () => {
  const { ctx, table } = await ctxCSV(D.versTableau(C, D.enTetes.complets));
  assert(table.objects.length === 3000, '3 000 candidats importés');
  verifierToutExact(ctx, 'complets');
});

await describe('Extraction aux en-têtes abrégés (BOURS, GRP_FORM_ACC, LIB_ACA_ACC…) : toutes les réponses exactes', async () => {
  const { ctx } = await ctxCSV(D.versTableau(C, D.enTetes.abreges));
  verifierToutExact(ctx, 'abrégés');
});

await describe('Export désordonné (titres, ligne vide, colonne vide, ligne « Total », valeurs BO) : toutes les réponses exactes', async () => {
  const rows = D.versTableau(C, D.enTetes.complets, { titres: true, total: true, colonneVide: true, valeursBO: true });
  const { ctx, table } = await ctxCSV(rows);
  assert(table.objects.length === 3000, `la ligne « Total » n'est pas comptée comme un candidat (obtenu : ${table.objects.length})`);
  assert(table.headers[0] === 'Numéro du candidat', 'en-têtes trouvés sous les lignes de titre');
  verifierToutExact(ctx, 'désordonné');
});

await describe('Colonnes d\'état en 1 / 0 (boursier, apprenti, Pays Basque) : filtrées, jamais additionnées ni moyennées', async () => {
  const { ctx } = await ctxCSV(D.versTableau(C, D.enTetes.complets, { etats: 'chiffres' }));
  verifierToutExact(ctx, 'états 1/0');
  const r = ask(ctx, 'combien de boursiers');
  assert(r.exec?.kind === 'count' && r.plan.filters.some(f => /Boursier/.test(f.col) && String(f.value) === '1'), 'boursiers = lignes où Boursier vaut 1 (comptage, pas une somme)');
  const s = ask(ctx, 'nombre moyen de vœux confirmés');
  assert(/vœux/.test(s.exec?.plan?.targetCol || ''), 'la moyenne des vœux ne prend pas une colonne d\'état 1/0');
});

await describe('Colonnes d\'état en VRAI / FAUX : toutes les réponses exactes', async () => {
  const { ctx } = await ctxCSV(D.versTableau(C, D.enTetes.abreges, { etats: 'vraifaux' }));
  verifierToutExact(ctx, 'états VRAI/FAUX (abrégés)');
});

await describe('Classeur Excel : onglet « Notice » sauté, données lues dans le 2e onglet', async () => {
  const { ctx, table } = await ctxExcel({
    Notice: [['Notice'], ['Ce fichier contient les candidats ayant accepté une proposition.'], ['Source : Parcoursup, académie de Bordeaux.']],
    'Données': D.versTableau(C, D.enTetes.complets, { titres: true, total: true }),
  });
  assert(table.sheetName === 'Données' && table.objects.length === 3000, `onglet de données choisi (obtenu : ${table.sheetName}, ${table.objects.length} lignes)`);
  const { exec } = ask(ctx, 'combien de boursiers en CPGE');
  assert(obtenu(exec, 'count') === n(c => c.boursier === 'Oui' && c.groupe === 'CPGE'), 'réponse exacte sur le classeur');
});

await describe('En-têtes vagues (« Colonne A »…) : réponse exacte OU « critère non reconnu », jamais un chiffre faux', async () => {
  const { ctx } = await ctxCSV(D.versTableau(C, D.enTetes.vagues));
  let exactes = 0, refus = 0;
  QUESTIONS_CANDIDATS.forEach(t => {
    const { exec } = ask(ctx, t.q);
    const v = obtenu(exec, t.type, t.cle);
    const ok = v === t.v || exec?.kind === 'unresolved';
    if (v === t.v) exactes++; else if (exec?.kind === 'unresolved') refus++;
    assert(ok, `vagues — « ${t.q} » : exact ou non reconnu (obtenu : ${v ?? resume(exec)}, vérité ${t.v})`);
  });
  assert(exactes >= 4, `les colonnes reconnues par leur contenu (série, département, formation…) donnent des réponses exactes (${exactes})`);
  const r = ask(ctx, 'combien de boursiers');
  assert(r.exec?.kind === 'unresolved' && /boursiers/.test(r.exec.html) && /Colonne C/.test(r.exec.html), 'refus explicite : cite « boursiers » et liste les colonnes');
  assert(!/Calcul exact/.test(r.exec.html), 'pas de badge « Calcul exact » sur un refus');
});

// ─── Open data : 14 000 formations ───────────────────────────────────────────
const O = D.openData(14000);
const m = p => D.compter(O, p);
const somme = (p, f) => O.filter(p).reduce((s, o) => s + f(o), 0);
const QUESTIONS_OD = [
  { q: 'combien de formations', type: 'count', v: O.length },
  { q: 'combien de BTS', type: 'count', v: m(o => o.fili === 'BTS') },
  { q: 'combien de PASS option Droit', type: 'count', v: m(o => o.detail === 'PASS option Droit') },
  { q: 'combien de formations publiques', type: 'count', v: m(o => o.statut === 'Public') },
  { q: 'combien de formations privées', type: 'count', v: m(o => o.statut !== 'Public') },
  { q: "combien de formations dans l'académie de Bordeaux", type: 'count', v: m(o => o.aca === 'Bordeaux') },
  { q: 'combien de formations en Gironde', type: 'count', v: m(o => o.dep === 'Gironde') },
  { q: 'combien de formations à Bordeaux', type: 'count', v: m(o => o.commune === 'Bordeaux') },
  { q: "combien de BTS dans l'académie de Toulouse", type: 'count', v: m(o => o.fili === 'BTS' && o.aca === 'Toulouse') },
  { q: 'combien de formations sélectives', type: 'count', v: m(o => o.selectivite === 'formation sélective') },
  { q: 'combien de formations non sélectives', type: 'count', v: m(o => o.selectivite === 'formation non sélective') },
  { q: 'combien de formations en Nouvelle-Aquitaine', type: 'count', v: m(o => o.region === 'Nouvelle-Aquitaine') },
  { q: 'combien de CPGE MPSI', type: 'count', v: m(o => o.detail === 'MPSI') },
  { q: "combien d'écoles de commerce", type: 'count', v: m(o => o.fili === 'Ecole de Commerce') },
  { q: 'combien de licences de droit', type: 'count', v: m(o => o.fil_det === 'Licence - Droit') },
  { q: 'combien de BTS publics en Gironde', type: 'count', v: m(o => o.fili === 'BTS' && o.statut === 'Public' && o.dep === 'Gironde') },
  { q: 'répartition par filière de formation très agrégée', type: 'group', cle: 'BTS', v: m(o => o.fili === 'BTS') },
  { q: 'répartition des BTS par académie', type: 'group', cle: 'Paris', v: m(o => o.fili === 'BTS' && o.aca === 'Paris') },
  { q: 'capacité moyenne des BTS', type: 'avg', v: Math.round(somme(o => o.fili === 'BTS', o => o.capa) / m(o => o.fili === 'BTS') * 100) / 100 },
  { q: "taux d'accès moyen des CPGE", type: 'avg', v: Math.round(somme(o => o.fili === 'CPGE', o => o.taux) / m(o => o.fili === 'CPGE') * 100) / 100 },
  { q: 'combien de places en BTS', type: 'sum', v: somme(o => o.fili === 'BTS', o => o.capa) },
  { q: 'combien de candidats en PASS', type: 'sum', v: somme(o => o.fili === 'PASS', o => o.voe) },
  { q: "combien d'admis dans l'académie de Bordeaux", type: 'sum', v: somme(o => o.aca === 'Bordeaux', o => o.acc) },
];

await describe('Open data (14 000 formations) : réponses exactes et en moins de 3 secondes', async () => {
  const ctx = ctxOpenData(O);
  QUESTIONS_OD.forEach(t => {
    const t0 = Date.now();
    const { exec } = ask(ctx, t.q);
    const ms = Date.now() - t0;
    const v = obtenu(exec, t.type, t.cle);
    assert(v === t.v, `« ${t.q} » → ${t.v} (obtenu : ${v ?? resume(exec)})`);
    assert(ms < 3000, `« ${t.q} » répond en moins de 3 s (${ms} ms)`);
  });
});

await describe('Open data : détails des réponses', async () => {
  const ctx = ctxOpenData(O);
  let r = ask(ctx, 'combien de places en BTS');
  assert(/places au total/.test(r.exec.html) && /Capacité/.test(r.exec.html), 'la somme dit ce qu\'elle additionne (places, colonne Capacité)');
  assert(/^[\d\s  ]+ places/.test(run(ctx, 'extractBlockTitle')(r.exec, '')), 'titre du bloc : « N places »');
  assert(run(ctx, 'shouldAnswerLocallyWithoutAlbert')(r.exec), 'somme donnée par le widget, sans Albert');
  r = ask(ctx, 'combien de formations à Bordeaux');
  assert(r.plan.filters.length === 1 && /Commune/.test(r.plan.filters[0].col), '« à Bordeaux » = la ville, pas l\'académie');
  r = ask(ctx, "combien de formations dans l'académie de Bordeaux");
  assert(r.plan.filters.length === 1 && /Académie/.test(r.plan.filters[0].col), '« académie de Bordeaux » = l\'académie');
  r = ask(ctx, 'répartition des BTS par académie');
  assert(r.exec.kind === 'group_by' && /Académie/.test(r.exec.plan.targetCol), '« répartition des BTS par académie » : BTS est un filtre, l\'académie la dimension');
  r = ask(ctx, 'capacité moyenne des BTS');
  assert(/Capacité/.test(r.exec.plan.targetCol), 'la moyenne porte sur la capacité, pas sur la session');
  r = ask(ctx, 'combien de formations');
  assert(r.exec.kind === 'count' && !r.plan.filters.length, '« combien de formations » : un comptage, pas une somme');
});

await describe('Open data : une colonne chiffrée n\'est jamais prise pour une colonne d\'état', async () => {
  const ctx = ctxOpenData(O);
  const r = ask(ctx, 'combien de candidats boursiers en BTS');
  const filtreChiffre = (r.plan?.filters || []).some(f => /boursiers/.test(f.col) && /^\d/.test(String(f.value)));
  assert(!filtreChiffre, `pas de filtre « % d'admis boursiers = 12,5 » (filtres : ${(r.plan?.filters || []).map(f => f.col + '=' + f.value).join(' ; ')})`);
  assert(r.exec?.kind === 'unresolved' && /boursiers/.test(r.exec.html), 'pas de colonne « candidats boursiers » dans l\'open data → le widget le dit');
  assert(/Colonnes chiffrées liées/.test(r.exec.html) && /admis boursiers/.test(r.exec.html), 'le refus explique que « % d\'admis boursiers » est une colonne chiffrée et propose une question');
  const a = ask(ctx, 'combien d\'admis boursiers en BTS');
  assert(obtenu(a.exec, 'sum') === somme(o => o.fili === 'BTS', o => o.acc_bours), '« admis boursiers » : somme de la colonne prévue pour cela');
});

await describe('Titre des blocs : un état codé est nommé, pas affiché « 1 »', async () => {
  const { ctx } = await ctxCSV(D.versTableau(C, D.enTetes.complets, { etats: 'chiffres' }));
  const r = ask(ctx, "combien d'apprentis");
  const titre = run(ctx, 'extractBlockTitle')(r.exec, '');
  assert(/apprentis/.test(titre) && !/— 1$/.test(titre), `titre lisible (obtenu : ${titre})`);
});

await describe('Liste : colonne presque vide (cas réel des PASS : 70 lignes remplies sur 287)', async () => {
  // Comme dans l'open data réel : « très détaillée » rarement remplie, et mélangeant options et lieux
  const lignes = D.openData(4000).map((o, i) => o.fili === 'PASS' ? { ...o, detail: i % 4 === 0 ? (i % 8 === 0 ? 'Antenne à LENS (62)' : 'option Sciences Infirmières') : '' } : o);
  const ctx = ctxOpenData(lignes);
  const nPass = lignes.filter(o => o.fili === 'PASS').length;
  const { exec } = ask(ctx, 'donne moi la liste complète des filières de PASS');
  assert(exec?.kind === 'group_by' && !/très détaillée/.test(exec.plan.targetCol), `colonne listée bien remplie, pas « très détaillée » (obtenu : ${exec?.plan?.targetCol})`);
  const somme = exec.result.rows.reduce((t, r) => t + r.count, 0);
  assert(somme + (exec.result.total - exec.result.filled) === nPass, `les lignes + « sans valeur » = tous les PASS (${nPass})`);
  const vide = lignes.map(o => ({ ...o, nom: o.fili === 'PASS' ? '' : o.nom, fil_det: o.fili === 'PASS' ? '' : o.fil_det, form: o.form }));
  const ctx2 = ctxOpenData(vide);
  const r2 = ask(ctx2, 'donne moi la liste complète des filières de PASS');
  // v27.17 — colonne remplie pour moins de 80 % des formations : la petite phrase grise
  // « N sans valeur » est remplacée par l'avertissement « Liste incomplète » (avec le nombre)
  if (r2.exec?.result && r2.exec.result.filled < r2.exec.result.total) {
    const sans = (r2.exec.result.total - r2.exec.result.filled).toLocaleString('fr-FR');
    const visible = r2.exec.result.filled < r2.exec.result.total * 0.8
      ? /Liste incomplète/.test(r2.exec.html) && r2.exec.html.includes(`<strong>${sans}</strong> autres`)
      : /sans valeur dans cette colonne/.test(r2.exec.html);
    assert(visible, 'le nombre de formations sans valeur est affiché');
  }
  else assert(true, 'colonne entièrement remplie : pas de mention « sans valeur »');
});

// ─── Faux positifs : le garde-fou ne bloque pas les questions normales ───────
await describe('Faux positifs du garde-fou', async () => {
  const { ctx } = await ctxCSV(D.versTableau(C, D.enTetes.complets));
  let r = ask(ctx, 'répartition par sexe');
  assert(r.exec?.kind === 'group_by', '« répartition par sexe » : répartition, pas de refus');
  r = ask(ctx, 'répartition des candidats par grand groupe de formation');
  assert(r.exec?.kind === 'group_by', 'répartition simple : pas de refus');
  r = ask(ctx, 'combien de candidats en lycée général');
  assert(r.exec?.kind !== 'unresolved' || !/lycée general/.test(r.exec.html), '« lycée général » n\'est pas pris pour le nom d\'un lycée');
  r = ask(ctx, 'compare boursiers et non boursiers');
  assert(r.exec?.kind === 'compare', 'comparaison boursiers / non boursiers : pas de refus');
  const od = ctxOpenData(D.openData(2000));
  r = ask(od, 'combien de formations dans la Somme');
  assert(r.exec?.kind !== 'unresolved' || !/somme/.test(r.exec.html.toLowerCase().split('colonnes disponibles')[0]), '« Somme » (mot courant) ne déclenche pas le garde-fou des lieux');
});

await describe('Conversation : « hors académie » puis suite', async () => {
  const { ctx } = await ctxCSV(D.versTableau(C, D.enTetes.abreges));
  const r = ask(ctx, 'combien de candidats partis hors académie de Bordeaux');
  assert(r.plan.filters.length === 1 && r.plan.filters[0].col === 'LIB_ACA_ACC', 'un seul filtre, sur l\'académie d\'accueil (pas aussi sur l\'académie d\'origine)');
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
