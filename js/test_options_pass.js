// test_options_pass.js — Options précisées pour une partie des formations seulement.
// Open data réel 2025 : l'option d'un PASS n'est écrite que dans « Filière de formation très
// détaillée », remplie pour 70 PASS sur 287 (options et lieux mêlés). « Combien de PASS option
// Biologie à Bordeaux » répondait 0 « calcul exact » alors que les PASS de Bordeaux ne disent pas
// leur option, et « liste des PASS » donnait 57 précisions sans dire qu'elles ne couvrent que 70 PASS.
// Désormais : arrêt « Option non précisée » avec ce que disent les données, et liste signalée
// incomplète avec les formations sans précision par établissement (nombre, capacité de chacune).
// node js/test_options_pass.js

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
function ask(ctx, q) {
  run(ctx, 'window.__DATA_ENGINE_STATE = { lastPlan: null, lastExecution: null, history: [] }');
  ctx.__q = q;
  const plan = run(ctx, 'isDataEngineQuestion(__q)') ? run(ctx, 'detectDataEnginePlan(__q)') : null;
  return plan ? run(ctx, 'runDataEnginePlan')(plan, []) : null;
}
const texte = exec => String(exec?.html || '').replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

// ─── PASS comme dans l'open data réel ──────────────────────────────────────────
// Un PASS sur quatre a une précision (option ou lieu) ; intitulés complets identiques.
// À Lille, tous les PASS précisent « Biologie » (périmètre entièrement renseigné).
const NOM_PASS = "Licence - Parcours d'Accès Spécifique Santé (PASS)";
const PRECISIONS = ['Biologie', "Dispensée à l'Université Paris 8", 'Sciences et techniques'];
const REEL = D.openData(4000).map((o, i) => {
  if (o.fili !== 'PASS') return o;
  const detail = o.commune === 'Lille' ? 'Biologie' : (i % 4 === 0 ? PRECISIONS[(i / 4) % 3] : '');
  return { ...o, detail, nom: NOM_PASS };
});
const PASS = REEL.filter(o => o.fili === 'PASS');
const compte = pred => PASS.filter(pred).length;
const nPass = PASS.length;
const nBio = compte(o => o.detail === 'Biologie');
const nSans = compte(o => o.detail === '');
const enBdx = o => o.commune === 'Bordeaux';

await describe('Données de test : situation réelle reproduite', () => {
  assert(nPass >= 40 && nSans / nPass > 0.4 && nSans / nPass < 0.9, `PASS sans précision majoritaires (${nSans} sur ${nPass})`);
  assert(compte(enBdx) > 0 && compte(o => enBdx(o) && o.detail === '') > 0, 'des PASS à Bordeaux sans précision');
  assert(compte(o => o.commune === 'Lille') > 0, 'des PASS à Lille, tous précisés');
});

await describe('« combien de PASS option Biologie à Bordeaux » : plus de 0 « calcul exact »', () => {
  const ctx = ctxOpenData(REEL);
  const e = ask(ctx, 'combien de PASS option biologie à Bordeaux');
  assert(e?.kind === 'unresolved', `arrêt au lieu d'un chiffre (obtenu : ${e?.kind} ${e?.result?.count ?? ''})`);
  assert(/Option non précisée/.test(e?.html), 'titre « Option non précisée dans les données »');
  const p = e?.result?.precision || {};
  assert(p.nFamille === nPass && p.nRenseignees === nPass - nSans, `la colonne n'est renseignée que pour ${nPass - nSans} PASS sur ${nPass}, et c'est écrit`);
  assert(texte(e).includes(`${(nPass - nSans).toLocaleString('fr-FR')} formations « PASS » sur ${nPass.toLocaleString('fr-FR')}`), 'le message donne les deux nombres');
  assert(p.perimetre === compte(enBdx), `périmètre : les PASS de Bordeaux (${compte(enBdx)})`);
  assert(p.precisees === compte(o => enBdx(o) && o.detail === 'Biologie'), 'formations de Bordeaux qui précisent « Biologie » comptées à part');
  assert(p.sansPrecision === compte(o => enBdx(o) && o.detail === ''), 'formations de Bordeaux sans précision comptées à part');
  assert(/sans précision, par établissement/.test(texte(e)) && /Capacité de chacune/.test(e.html), 'tableau des formations sans précision, par établissement, avec la capacité');
  assert(/NON CALCULÉ/.test(e.text) && /sans précision/.test(e.text), 'texte transmis à Albert : pas de chiffre, et pourquoi');
  assert(/NON CALCULÉ/.test(run(ctx, 'dataEngineResultToContext')(e)), 'contexte d\'Albert : « aucun calcul »');
});

await describe('Autres options et mesures', () => {
  const ctx = ctxOpenData(REEL);
  const b = ask(ctx, 'combien de PASS option biologie');
  assert(b?.kind === 'unresolved' && b.result.precision.precisees === nBio && b.result.precision.sansPrecision === nSans,
    `France entière : ${nBio} précisent Biologie, ${nSans} sans précision, pas de chiffre « exact »`);
  const d = ask(ctx, 'combien de PASS option droit');
  assert(d?.kind === 'unresolved' && /Option non précisée/.test(d.html) && d.result.precision.precisees === 0,
    'option jamais écrite (Droit) : expliqué par l\'absence de précision, pas seulement « non trouvée »');
  const z = ask(ctx, 'combien de PASS option zoologie');
  assert(z?.kind === 'unresolved' && /Option non précisée/.test(z.html), 'mot absent de tout le fichier (Zoologie) : même explication');
  const s = ask(ctx, 'combien de places en PASS option biologie');
  assert(s?.kind === 'unresolved', 'somme de places : arrêt aussi');
  const l = ask(ctx, 'liste des PASS option biologie');
  assert(l?.kind === 'unresolved', 'liste des PASS option Biologie : arrêt aussi');
});

await describe('Faux positifs : le chiffre reste donné quand il est sûr', () => {
  const ctx = ctxOpenData(REEL);
  const p = ask(ctx, 'combien de PASS');
  assert(p?.kind === 'count' && p.result.count === nPass, `« combien de PASS » : ${nPass}`);
  const lille = ask(ctx, 'combien de PASS option biologie à Lille');
  const nLille = compte(o => o.commune === 'Lille');
  assert(lille?.kind === 'count' && lille.result.count === nLille, `à Lille, tous les PASS sont précisés : chiffre exact (${nLille})`);
  const droit = ask(ctx, 'combien de licences de droit');
  assert(droit?.kind === 'count' && droit.result.count === D.compter(REEL, o => o.fil_det === 'Licence - Droit'), '« licences de droit » : compté normalement');
  const mco = ask(ctx, 'combien de BTS management commercial opérationnel');
  assert(mco?.kind === 'count' && mco.result.count === D.compter(REEL, o => o.detail === 'Management Commercial Opérationnel'), 'BTS MCO : compté normalement');
  const mpsi = ask(ctx, 'combien de CPGE MPSI');
  assert(mpsi?.kind === 'count' && mpsi.result.count === D.compter(REEL, o => o.detail === 'MPSI'), 'CPGE MPSI : compté normalement');
  // fichier où l'option est toujours écrite : rien ne change
  const plein = ctxOpenData(D.openData(4000));
  const pb = ask(plein, 'combien de PASS option biologie');
  assert(pb?.kind === 'count' && pb.result.count === D.compter(D.openData(4000), o => o.detail === 'PASS option Biologie'), 'option toujours renseignée : chiffre exact');
});

await describe('« liste des PASS » : liste signalée incomplète', () => {
  const ctx = ctxOpenData(REEL);
  for (const q of ['liste des PASS', 'quelles sont les options de PASS']) {
    const e = ask(ctx, q);
    assert(e?.kind === 'group_by' && e.plan.listMode, `« ${q} » : une liste`);
    assert(/Liste incomplète/.test(e.html) && texte(e).includes(`${nSans} autres n'en ont aucune`), `« ${q} » : avertissement avec le nombre de PASS sans précision (${nSans})`);
    const g = e.result.sansPrecision;
    assert(g && g.formations === nSans && g.groupes.reduce((t, x) => t + x.n, 0) <= nSans && g.total >= g.groupes.length, 'tableau par établissement : il porte sur tous les PASS sans précision');
    assert(/sans précision/.test(e.text) && /sans précision/.test(run(ctx, 'dataEngineResultToContext')(e)), 'Albert est prévenu que la liste est incomplète');
    assert(/À noter/.test(e.html) && /la liste ne couvre que/.test(e.html), 'périmètre : « la liste ne couvre que … »');
  }
  const bts = ask(ctx, 'quelles sont les options de BTS');
  assert(bts?.kind === 'group_by' && bts.plan.listMode && !/Liste incomplète/.test(bts.html) && !bts.result.sansPrecision, 'faux positif : options de BTS, colonne remplie, pas d\'avertissement');
});

await describe('Tableau par établissement : capacité de chaque formation', () => {
  const ctx = ctxOpenData(REEL);
  const t = D.tableOpenData([
    { ...REEL[0], etab: 'Université de Bordeaux', commune: 'Talence', capa: 270 },
    { ...REEL[0], etab: 'Université de Bordeaux', commune: 'Talence', capa: 165 },
    { ...REEL[0], etab: 'Université de Pau', commune: 'Pau', capa: 80 },
  ]);
  ctx.__t2 = t;
  const pe = run(ctx, 'formationsParEtablissement(__t2, __t2.objects)');
  assert(pe.groupes[0].etablissement === 'Université de Bordeaux' && pe.groupes[0].n === 2, 'deux formations au même intitulé regroupées');
  assert(run(ctx, '_placesEnClair')(pe.groupes[0].places) === '165 et 270 places', 'capacités distinctes : « 165 et 270 places »');
  assert(run(ctx, '_placesEnClair')([1]) === '1 place' && run(ctx, '_placesEnClair')([1200]) === '1 200 places', 'singulier et milliers');
});

await describe('« PASS option droit » : c\'est « droit » qui manque, pas « PASS »', () => {
  // Bug vu sur les données réelles : « « PASS » : 0 la précisent, 231 sans précision sur 691 »
  // (le moteur cherchait « PASS » parmi les formations de droit)
  const ctx = ctxOpenData(REEL);
  const d = ask(ctx, 'combien de PASS option droit');
  const p = d?.result?.precision || {};
  assert(/droit/i.test(p.terme) && p.famille === 'PASS', `mot cherché « droit », famille « PASS » (obtenu : ${p.terme} / ${p.famille})`);
  assert(p.nFamille === nPass && p.perimetre === nPass, `sur les ${nPass} PASS, pas sur les formations de droit`);
  const m = ask(ctx, 'combien de PASS mention biologie');
  assert(m?.kind === 'unresolved' && /biologie/i.test(m.result.precision.terme), '« mention » traité comme « option »');
});

await describe('0 dans la commune, mais des formations dans l\'académie du même nom', () => {
  // Données réelles : aucun PASS dans la commune de Bordeaux (ceux de l'Université de Bordeaux sont à Talence)
  const lignes = REEL.map(o => o.fili === 'PASS' && o.commune === 'Bordeaux' ? { ...o, commune: 'Talence', dep: 'Gironde' } : o);
  const ctx = ctxOpenData(lignes);
  const nAca = lignes.filter(o => o.fili === 'PASS' && o.aca === 'Bordeaux').length;
  const e = ask(ctx, 'combien de PASS à Bordeaux');
  assert(e?.kind === 'count' && e.result.count === 0, '0 PASS dans la commune de Bordeaux : chiffre exact');
  assert(texte(e).includes(`mais ${nAca} dans l'académie de Bordeaux`), `note : « mais ${nAca} dans l'académie de Bordeaux »`);
  assert(/dans l'académie de Bordeaux/.test(run(ctx, 'dataEngineResultToContext')(e)), 'Albert reçoit la note');
  const b = ask(ctx, 'combien de PASS option biologie à Bordeaux');
  const nAcaSans = lignes.filter(o => o.fili === 'PASS' && o.aca === 'Bordeaux' && o.detail === '').length;
  assert(b?.kind === 'count' && b.result.count === 0 && texte(b).includes(`« biologie » et ${nAcaSans} ne précisent pas leur option`) && !/mais \d+ dans l'académie/.test(texte(b)),
    `option à Bordeaux : 0 exact (aucun PASS dans la commune), avec la note « ${nAcaSans} PASS de l'académie ne précisent pas leur option »`);
  const ba = ask(ctx, "combien de PASS option biologie dans l'académie de Bordeaux");
  assert(ba?.kind === 'unresolved' && ba.result.precision.perimetre === nAca, `dans l'académie : arrêt « option non précisée » sur les ${nAca} PASS de l'académie`);
  const bts = ask(ctx, 'combien de BTS à Bordeaux');
  assert(bts?.kind === 'count' && bts.result.count > 0 && !/dans l'académie de/.test(texte(bts)), 'faux positif : des BTS dans la commune, pas de note');
  const pau = ask(ctx, 'combien de PASS à Pau');
  assert(pau?.kind === 'count' && !/dans l'académie de Pau/.test(texte(pau)), 'faux positif : pas d\'académie « Pau », pas de note');
});

await describe('Formations au même intitulé : listées par établissement', () => {
  // Données réelles : les 8 PASS de l'académie de Bordeaux n'ont aucune précision → la liste disait seulement « PASS : 8 »
  const lignes = REEL.map(o => o.fili === 'PASS' && o.aca === 'Bordeaux' ? { ...o, detail: '' } : o);
  const ctx = ctxOpenData(lignes);
  const nAca = lignes.filter(o => o.fili === 'PASS' && o.aca === 'Bordeaux').length;
  const e = ask(ctx, "liste des PASS dans l'académie de Bordeaux");
  assert(e?.kind === 'group_by' && e.result.total === nAca, `${nAca} PASS dans l'académie`);
  const g = e.result.memeIntitule;
  assert(g && g.formations === nAca && /même intitulé/.test(e.html), 'même intitulé pour tous : tableau par établissement pour tous ces PASS');
  assert(/Capacité de chacune/.test(e.html), 'avec la capacité de chacun');
  assert(/par établissement/.test(e.text), 'Albert reçoit le détail');
  const bts = ask(ctx, 'quelles sont les options de BTS');
  assert(!bts.result.memeIntitule, 'faux positif : intitulés différents, pas de tableau en plus');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
