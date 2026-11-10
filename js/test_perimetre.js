// test_perimetre.js — Chaque résultat calculé dit en clair sur quoi il porte.
// Sous le titre : « 📌 Sur quoi porte ce calcul : N lignes retenues sur M · source · filtres ».
// Si des lignes n'entrent pas dans le chiffre (cases vides, valeurs non affichées), c'est écrit
// (« ⚠️ Non compté : … »). Les filtres repris de la question précédente sont signalés.
// Le même périmètre est transmis à Albert, qui doit le recopier avec le chiffre.
// node js/test_perimetre.js

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
const neuf = ctx => run(ctx, 'window.__DATA_ENGINE_STATE = { lastPlan: null, lastExecution: null, history: [] }');
// Question posée dans la conversation en cours (le contexte précédent est gardé)
function ask(ctx, q) {
  ctx.__q = q;
  const plan = run(ctx, 'isDataEngineQuestion(__q)') ? run(ctx, 'detectDataEnginePlan(__q)') : null;
  const exec = plan ? run(ctx, 'runDataEnginePlan')(plan, []) : null;
  return { plan, exec };
}
const perimetre = exec => {
  const m = String(exec?.html || '').match(/<p class="de-perimetre"[^>]*>([\s\S]*?)<\/p>/);
  return m ? m[1].replace(/<br>/g, ' | ').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&') : '';
};
const nf = n => n.toLocaleString('fr-FR');
const OD = D.openData(3000);

const BTS = D.compter(OD, o => o.fili === 'BTS');
const filtre = (exec, col) => (exec?.plan?.filters || []).filter(f => f.col === col).map(f => f.value);

await describe('Périmètre affiché sous le titre de chaque résultat calculé', () => {
  const ctx = ctxOpenData(OD);
  neuf(ctx); const c = ask(ctx, 'combien de BTS').exec;
  const p = perimetre(c);
  // règle changée (v27.5.61) : le bloc commence par « 🧭 J'ai compris : … » (l'opération calculée), puis le périmètre
  assert(c.kind === 'count' && /^🧭 J'ai compris : nombre de formations\. \| 📌 Sur quoi porte ce calcul/.test(p), 'comptage : « J\'ai compris », puis bloc « Sur quoi porte ce calcul »');
  assert(p.includes(`${nf(BTS)} formations retenues sur ${nf(OD.length)}`), `nombre retenu sur le total (${nf(BTS)} sur ${nf(OD.length)})`);
  assert(p.includes('open data Parcoursup 2025, France entière') && p.includes('une ligne = une formation, pas un candidat'), 'source, session et unité dites en clair');
  assert(p.includes('filtre : « Filière de formation très agrégée » = BTS'), 'filtre en clair : colonne et valeur');
  assert(c.html.indexOf('de-perimetre') > c.html.indexOf('</h4>') && c.html.indexOf('de-perimetre') < c.html.indexOf('Il y a'), 'placé entre le titre et le résultat');
  neuf(ctx); assert(perimetre(ask(ctx, 'combien de formations').exec).includes('aucun filtre (toutes les formations)'), 'sans filtre : « aucun filtre » écrit');
  const kinds = {};
  for (const q of ['combien de places en BTS', 'répartition des BTS par académie', 'liste des filières de PASS', 'top 5 des communes', 'croise filière et académie', 'capacité moyenne des BTS']) {
    neuf(ctx); const e = ask(ctx, q).exec; kinds[e?.kind] = perimetre(e) !== '';
  }
  assert(['sum', 'group_by', 'top', 'pivot', 'stats'].every(k => kinds[k]), `somme, répartition, liste, top, croisement, statistiques : périmètre présent (${JSON.stringify(kinds)})`);
});

await describe('Ce qui n\'entre pas dans le chiffre est écrit (« À noter »)', () => {
  // 40 formations BTS sans capacité, 25 sans académie
  const lignes = OD.map((o, i) => o.fili === 'BTS' && i % 7 === 0 ? { ...o, capa: '' } : (i % 11 === 0 ? { ...o, aca: '' } : o));
  const sansCapa = D.compter(lignes, o => o.fili === 'BTS' && o.capa === '');
  const avecCapa = D.compter(lignes, o => o.fili === 'BTS' && o.capa !== '');
  const sansAca = D.compter(lignes, o => o.aca === '');
  const ctx = ctxOpenData(lignes);
  neuf(ctx); const st = ask(ctx, 'capacité moyenne des BTS').exec;
  assert(st.kind === 'stats' && perimetre(st).includes(`calcul sur ${nf(avecCapa)} valeurs chiffrées ; ${nf(sansCapa)} formations sans valeur chiffrée ignorées`), `moyenne : ${sansCapa} formations sans capacité signalées`);
  neuf(ctx); const so = ask(ctx, 'combien de places en BTS').exec;
  assert(so.kind === 'sum' && perimetre(so).includes(`${nf(sansCapa)} formations sans valeur dans « Capacité de l'établissement par formation », non comptées`), 'somme : formations sans valeur signalées');
  neuf(ctx); const g = ask(ctx, 'répartition par académie').exec;
  assert(perimetre(g).includes(`${nf(sansAca)} formations sans valeur dans « Académie de l'établissement »`), 'répartition : cases vides signalées');
  neuf(ctx); const t = ask(ctx, 'top 5 des communes').exec;
  const nbCommunes = new Set(lignes.map(o => o.commune)).size;
  assert(perimetre(t).includes(`seules les 5 valeurs les plus fréquentes sont affichées, sur ${nbCommunes}`), 'top 5 : valeurs non affichées signalées');
  // Faux positif : rien à signaler → pas de « À noter »
  const plein = ctxOpenData(OD);
  neuf(plein); assert(!/À noter/.test(perimetre(ask(plein, 'capacité moyenne des BTS').exec)), 'données complètes : aucun « À noter »');
  neuf(plein); assert(!/À noter/.test(perimetre(ask(plein, 'combien de BTS').exec)), 'comptage simple : aucun « À noter »');
});

await describe('Bug corrigé : une case vide ne compte plus comme 0 dans les moyennes', () => {
  const ctx = makeCtx();
  const st = ctx.numericStats([{ c: 10 }, { c: 20 }, { c: '' }, { c: null }, { c: 'NC' }, { c: '1 234' }, { c: '3,5' }], 'c');
  assert(st.numericCount === 4, `4 valeurs chiffrées sur 7 (obtenu : ${st.numericCount})`);
  assert(st.min === 3.5 && st.max === 1234, `minimum 3,5 et pas 0 (obtenu : ${st.min}) ; « 1 234 » lu 1234`);
  assert(Math.abs(st.avg - (10 + 20 + 1234 + 3.5) / 4) < 1e-9, 'moyenne sur les seules valeurs renseignées');
  const lignes = OD.map((o, i) => o.fili === 'BTS' && i % 7 === 0 ? { ...o, capa: '' } : o);
  const vraies = lignes.filter(o => o.fili === 'BTS' && o.capa !== '').map(o => o.capa);
  const o = ctxOpenData(lignes); neuf(o);
  const e = ask(o, 'capacité moyenne des BTS').exec;
  assert(Math.abs(e.result.avg - vraies.reduce((a, b) => a + b, 0) / vraies.length) < 1e-9, 'capacité moyenne des BTS exacte malgré les cases vides');
  assert(ctx._nombreCellule(0) === 0 && ctx._nombreCellule('0') === 0 && ctx._nombreCellule('') === null && ctx._nombreCellule('  ') === null, 'faux positif : un vrai 0 reste un 0');
});

await describe('Relances : filtres repris de la question précédente signalés et justes', () => {
  const ctx = ctxOpenData(OD);
  neuf(ctx); ask(ctx, 'combien de BTS');
  const bx = ask(ctx, "et pour l'académie de Bordeaux ?").exec;
  const attendu = D.compter(OD, o => o.fili === 'BTS' && o.aca === 'Bordeaux');
  // Bug corrigé : Bordeaux était perdu (« critère non reconnu »)
  assert(bx.kind === 'count' && bx.result.count === attendu, `« et pour l'académie de Bordeaux ? » → ${attendu} BTS (obtenu : ${bx.kind} ${bx.result?.count})`);
  assert(perimetre(bx).includes("« Académie de l'établissement » = Bordeaux ; « Filière de formation très agrégée » = BTS (repris de la question précédente)"), 'le filtre BTS est signalé comme repris');
  const tl = ask(ctx, "et pour l'académie de Toulouse ?").exec;
  assert(tl.result.count === D.compter(OD, o => o.fili === 'BTS' && o.aca === 'Toulouse'), 'Toulouse remplace Bordeaux (pas de cumul impossible)');
  assert(JSON.stringify(filtre(tl, "Académie de l'établissement")) === '["Toulouse"]', 'une seule académie dans les filtres');
  neuf(ctx); ask(ctx, 'combien de PASS');
  const bts = ask(ctx, 'et pour les BTS ?').exec;
  // Bug corrigé : recomptait les PASS
  assert(bts.result.count === BTS, `« et pour les BTS ? » après « combien de PASS » → ${BTS} BTS (obtenu : ${bts.result?.count})`);
  assert(!/PASS/.test(perimetre(bts)), 'le filtre PASS n\'est plus là');
  neuf(ctx); ask(ctx, 'combien de BTS');
  const aca = ask(ctx, 'et par académie ?').exec;
  assert(aca.kind === 'group_by' && aca.result.total === BTS && aca.plan.targetCol === "Académie de l'établissement", '« et par académie ? » : répartition des BTS, pas de toutes les formations');
  neuf(ctx); const frais = ask(ctx, 'combien de BTS').exec;
  assert(!/repris/.test(perimetre(frais)), 'première question : rien n\'est « repris »');
});

await describe('« par … » : la bonne colonne, ou un arrêt explicite', () => {
  const ctx = ctxOpenData(OD);
  const col = q => { neuf(ctx); const e = ask(ctx, q).exec; return e?.kind === 'unresolved' ? 'ARRÊT' : e?.plan?.targetCol; };
  assert(col('par région') === "Région de l'établissement", '« par région » → Région (avant : effectif d\'admis boursiers)');
  assert(col('nombre de formations par région') === "Région de l'établissement", '« nombre de formations par région » → Région');
  assert(col('par sélectivité') === 'Sélectivité', '« par sélectivité » → Sélectivité');
  assert(col('répartition par sélectivité des BTS') === 'Sélectivité', '« par sélectivité des BTS » → Sélectivité');
  assert(col('par filière') === 'Filière de formation très agrégée', '« par filière » → Filière (avant : Statut de l\'établissement)');
  assert(col('par statut') === "Statut de l'établissement de la filière de formation (public, privé…)", '« par statut » → Statut');
  assert(col('par académie des BTS') === "Académie de l'établissement", '« par académie des BTS » → Académie');
  assert(col('par département') === "Département de l'établissement" && col('top 10 des communes') === "Commune de l'établissement", 'département et communes inchangés');
  assert(col('répartition par capacité') === "Capacité de l'établissement par formation", 'colonne chiffrée nommée dans la question : acceptée');
  assert(col('par série') === 'ARRÊT', '« par série » (pas de colonne série dans l\'open data) → arrêt, pas « % d\'admis boursiers »');
  assert(col('par couleur') === 'ARRÊT', '« par couleur » → arrêt, pas l\'académie par défaut');
  neuf(ctx); assert(/aucune colonne ne correspond à « couleur »/.test(ask(ctx, 'par couleur').exec.text), 'le message dit quel mot n\'a pas été trouvé');
  neuf(ctx); ask(ctx, 'répartition par académie'); const r = ask(ctx, 'et par couleur ?').exec;
  assert(r.kind === 'unresolved', 'relance « et par couleur ? » : arrêt, pas la répartition précédente');
  neuf(ctx); const s = ask(ctx, 'par sélectivité').exec;
  assert(!(s.plan.filters || []).length, '« par sélectivité » ne filtre pas sur « formation sélective »');
  neuf(ctx); assert(ask(ctx, 'combien de formations sélectives').exec.result.count === D.compter(OD, o => o.selectivite === 'formation sélective'), '« formations sélectives » filtre toujours');
});

await describe('Autres sources et colonnes d\'état', async () => {
  const C = D.candidats(800);
  const csv = await ctxCSV(D.versTableau(C, D.enTetes.complets, { etats: 'chiffres' }), 'extraction.csv');
  neuf(csv); const a = ask(csv, "combien d'apprentis").exec;
  assert(perimetre(a).includes('fichier « extraction.csv »') && perimetre(a).includes('lignes retenues sur 800'), 'fichier : nom du fichier et « lignes » (pas « formations »)');
  assert(perimetre(a).includes('« Apprenti » = oui') && !/= 1\b/.test(perimetre(a)), 'état codé 1 / 0 : écrit « = oui », pas « = 1 »');
  neuf(csv); const cmp = ask(csv, 'compare boursiers et non boursiers').exec;
  assert(cmp.kind === 'compare' && perimetre(cmp).includes('800 lignes retenues sur 800'), 'comparaison : périmètre présent');
  const ctx = makeCtx();
  const fil = ctx.perimetreResultat;
  const grist = fil('count', { table: { source: 'Grist', name: 'Table Grist connectée', objects: [{}, {}, {}] }, filters: [{ col: 'Statut', op: 'neq', value: 'Public' }] }, { count: 2 });
  assert(grist.texte === 'Périmètre : 2 lignes retenues sur 3 · table Grist connectée · filtre : « Statut » différent de Public.', `Grist et filtre « différent de » (obtenu : ${grist.texte})`);
  const xss = fil('count', { table: { source: 'Fichier', name: '<img src=x onerror=alert(1)>.xlsx', objects: [{}] }, filters: [] }, { count: 1 });
  assert(!/<img/.test(xss.html) && /&lt;img/.test(xss.html), 'nom de fichier échappé (pas d\'injection HTML)');
  const mots = fil('count', { table: { source: 'Open data', session: 2025, rowUnit: 'formation', objects: [{}, {}] }, filters: [{ col: 'Intitulé de formation contenant', op: 'contains_all', value: 'licences + droit', label: 'licences + droit' }] }, { count: 1 });
  assert(mots.texte.includes('1 formation retenue sur 2') && mots.texte.includes('intitulé de formation contenant « licences » et « droit »'), 'singulier (1 formation retenue) et mots de l\'intitulé en clair');
  assert(fil('count', null, null).texte === '' && fil('count', {}, null).html === '', 'sans plan ou sans résultat : rien (pas d\'erreur)');
});

await describe('Transmis à Albert avec le chiffre', () => {
  const ctx = ctxOpenData(OD);
  neuf(ctx); const e = ask(ctx, 'combien de BTS').exec;
  const contexte = ctx.dataEngineResultToContext(e);
  assert(/\nPérimètre : .*formations retenues sur .* · open data Parcoursup 2025/.test(contexte), 'contexte Albert : ligne « Périmètre : … »');
  const rep = `<p>Il y a ${nf(BTS)} BTS (${nf(BTS)} formations retenues sur ${nf(OD.length)}, open data Parcoursup 2025).</p>`;
  assert(ctx.verifierChiffresAlbert(rep, [contexte]).inconnus.length === 0, 'Albert qui recopie le périmètre : aucun chiffre signalé');
  const albert = fs.readFileSync(path.join(__dirname, 'albert.js'), 'utf8');
  assert(/PÉRIMÈTRE : quand tu reprends un chiffre calculé par le widget, recopie aussi la ligne « Périmètre : … »/.test(albert), 'consigne à Albert : recopier le périmètre, ne pas l\'attribuer à autre chose');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert(!/dataEngine\.js\?v=27\.5\.26/.test(html) && !/albert\.js\?v=27\.6\.19/.test(html) && !/planner\.js\?v=27\.5\.12"/.test(html), 'versions des scripts incrémentées (cache)');
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
