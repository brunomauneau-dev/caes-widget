// test_retours.js — « 👎 Réponse incorrecte » et questions à revoir (js/retours.js).
// Les signalements des agents, les questions non comprises et les chiffres d'Albert non vérifiés sont notés
// dans le navigateur (localStorage), jamais dans Grist ni envoyés ailleurs ; export CSV / texte pour enrichir les tests.
// node js/test_retours.js

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

function stockage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m };
}
function makeCtx(localStorage = stockage()) {
  const noopEl = () => null;
  const ctx = {
    console: { ...console, log() {}, warn() {}, info() {} },
    setTimeout: () => null, clearTimeout() {}, URLSearchParams, TextDecoder, TextEncoder,
    document: { getElementById: noopEl, querySelector: noopEl, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) },
    localStorage, fetch: () => Promise.reject(new Error('hors ligne')),
    escapeHtml: s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.selectedDocIds = new Set();
  vm.createContext(ctx);
  for (const f of ['config.js', 'knowledge.js', 'documents.js', 'planner.js', 'dataEngine.js', 'sessions.js', 'retours.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
  }
  ctx.resetContextSilent = () => {};
  return ctx;
}
const run = (ctx, code) => vm.runInContext(code, ctx);

await describe('Enregistrer et relire un retour', () => {
  const ctx = makeCtx();
  const r = ctx.enregistrerRetour({ type: 'signalement', question: '  combien de BTS  ', outil: 'count', chiffre: 1224, perimetre: 'Périmètre : 1 224 formations…', commentaire: 'attendu 1 230' });
  const l = ctx.lireRetours();
  assert(l.length === 1 && l[0].question === 'combien de BTS' && l[0].chiffre === '1224' && l[0].commentaire === 'attendu 1 230' && /^\d{4}-\d\d-\d\dT/.test(l[0].date), 'question, chiffre, commentaire et date enregistrés');
  assert(ctx.localStorage._m.has('caes_retours_v1'), 'stocké dans le navigateur (localStorage), clé dédiée');
  assert(ctx.enregistrerRetour({ question: '   ' }) === null && ctx.enregistrerRetour(null) === null && ctx.compterRetours() === 1, 'question vide : rien n\'est noté');
  ctx.enregistrerRetour({ type: 'inconnu', question: 'autre question' });
  assert(ctx.lireRetours()[1].type === 'signalement', 'type inconnu → « signalement »');
  ctx.enregistrerRetour({ question: 'x'.repeat(2000), commentaire: 'y'.repeat(5000) });
  const long = ctx.lireRetours()[2];
  assert(long.question.length === 500 && long.commentaire.length === 1000, 'textes très longs tronqués (500 / 1 000 caractères)');
});

await describe('Doublons et limite', () => {
  const ctx = makeCtx();
  ctx.enregistrerRetour({ type: 'non_compris', question: 'par couleur' });
  ctx.enregistrerRetour({ type: 'non_compris', question: 'par couleur' });
  assert(ctx.compterRetours() === 1, 'même question non comprise posée deux fois de suite : notée une fois');
  ctx.enregistrerRetour({ type: 'signalement', question: 'par couleur' });
  ctx.enregistrerRetour({ type: 'signalement', question: 'par couleur', commentaire: 'devrait répondre' });
  assert(ctx.compterRetours() === 3, 'type différent, ou commentaire ajouté : nouvelle entrée');
  for (let i = 0; i < 320; i++) ctx.enregistrerRetour({ question: `question ${i}` });
  const l = ctx.lireRetours();
  assert(l.length === 300 && l[l.length - 1].question === 'question 319' && !l.some(x => x.question === 'par couleur'), 'au plus 300 retours : les plus anciens sont retirés');
  ctx.effacerRetours();
  assert(ctx.compterRetours() === 0, '« Tout effacer » vide la liste');
});

await describe('Stockage indisponible ou abîmé : le widget continue', () => {
  const bloque = { getItem() { throw new Error('bloqué'); }, setItem() { throw new Error('plein'); }, removeItem() {} };
  const ctx = makeCtx(bloque);
  let ok = true;
  try { ctx.enregistrerRetour({ question: 'combien de BTS' }); ctx.lireRetours(); ctx.compterRetours(); ctx.effacerRetours(); } catch (e) { ok = false; }
  assert(ok && ctx.lireRetours().length === 0, 'localStorage bloqué ou plein : aucune erreur');
  const abime = stockage(); abime.setItem('caes_retours_v1', '{pas du json');
  assert(makeCtx(abime).lireRetours().length === 0, 'contenu illisible : liste vide, pas d\'erreur');
  const pasTableau = stockage(); pasTableau.setItem('caes_retours_v1', '{"a":1}');
  assert(makeCtx(pasTableau).lireRetours().length === 0, 'contenu inattendu : liste vide');
});

await describe('Export CSV (Excel) et texte', () => {
  const ctx = makeCtx();
  ctx.enregistrerRetour({ type: 'signalement', question: 'part des "boursiers"; en BTS', commentaire: '=SOMME(A1)', outil: 'part', chiffre: 29.5 });
  ctx.enregistrerRetour({ type: 'non_compris', question: 'répartition par couleur', perimetre: 'NON RECONNU : aucune colonne' });
  const csv = ctx.exporterRetoursCSV();
  const lignes = csv.split('\r\n');
  assert(csv.startsWith('﻿') && lignes[0] === '﻿Date;Type;Question;Commentaire;Outil;Chiffre donné;Périmètre;Source', 'CSV : en-têtes, séparateur « ; », encodage lisible par Excel (BOM)');
  assert(lignes[1].includes('"part des ""boursiers""; en BTS"'), 'guillemets et « ; » protégés');
  assert(lignes[1].includes("'=SOMME(A1)") && !/;=SOMME/.test(lignes[1]), 'formule neutralisée (pas exécutée à l\'ouverture dans Excel)');
  assert(/Signalée par un agent/.test(lignes[1]) && /Non comprise par le widget/.test(lignes[2]), 'type écrit en clair');
  const c2 = makeCtx(); c2.enregistrerRetour({ question: 'combien de BTS', outil: 'count', chiffre: 12 });
  assert(c2.exporterRetoursCSV().split('\r\n')[1].includes(';comptage;12;') && /Réponse : comptage 12/.test(c2.exporterRetoursTexte()), 'outil écrit en français (« comptage », pas « count »)');
  const texte = ctx.exporterRetoursTexte();
  assert(/^1\. \[Signalée par un agent\] « part des "boursiers"; en BTS »\n   Commentaire : =SOMME\(A1\)\n   Réponse : part 29.5/.test(texte) && /2\. \[Non comprise par le widget\] « répartition par couleur »/.test(texte), 'texte à coller : numéroté, lisible');
  assert(makeCtx().exporterRetoursTexte() === 'Aucune question à revoir.', 'liste vide : message clair');
});

await describe('Résumé d\'un résultat (jamais la réponse complète)', () => {
  const ctx = makeCtx();
  ctx.__t = D.tableOpenData(D.openData(800, 3));
  run(ctx, "defaultOpenDataTable = __t; defaultOpenDataState = 'ready';");
  const ask = q => { ctx.__q = q; const p = run(ctx, 'detectDataEnginePlan(__q)'); return run(ctx, 'runDataEnginePlan')(p, []); };
  const e = ask('combien de BTS');
  const r = ctx.resumeExecution(e);
  assert(r.outil === 'count' && r.chiffre === e.result.count && /^Périmètre : .*formations retenues sur 800/.test(r.perimetre), 'comptage : outil, chiffre, périmètre');
  const p = ctx.resumeExecution(ask('taux de remplissage des BTS'));
  assert(p.outil === 'part' && typeof p.chiffre === 'number', 'part : pourcentage arrondi');
  const c = ctx.resumeExecution(ask('les formations les plus demandées'));
  assert(c.outil === 'classement' && c.chiffre.split(' · ').length === 3, 'classement : les 3 premières valeurs');
  assert(JSON.stringify(ctx.resumeExecution(null)) === '{}', 'sans résultat : résumé vide');
});

await describe('Branchements : bouton, enregistrement automatique, en-tête', () => {
  const sessions = fs.readFileSync(path.join(__dirname, 'sessions.js'), 'utf8');
  const albert = fs.readFileSync(path.join(__dirname, 'albert.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert(/mk\('👎 Réponse incorrecte'/.test(sessions) && /ouvrirFormulaireRetour\(btn/.test(sessions), 'bouton « 👎 Réponse incorrecte » dans la barre d\'actions de chaque réponse');
  assert(/previousElementSibling/.test(sessions) && /classList\.contains\('user'\)/.test(sessions), 'question retrouvée même si elle n\'est pas transmise (message précédent de l\'agent)');
  assert(/enregistrerRetour\(\{ type: 'non_compris', question/.test(albert), 'question non comprise (« Critère non reconnu ») notée automatiquement');
  assert(/enregistrerRetour\(\{ type: 'chiffres_douteux', question/.test(albert), 'chiffres d\'Albert non vérifiés notés automatiquement');
  assert(/onclick="ouvrirPanneauRetours\(\)"/.test(html) && /id="retours-compteur"/.test(html), 'bouton « 📝 À revoir » et compteur dans l\'en-tête');
  assert(/<script src="js\/retours\.js\?v=[\d.]+" defer><\/script>/.test(html) && html.indexOf('js/retours.js') < html.indexOf('js/albert.js'), 'script chargé en defer, avant albert.js');
  const src = fs.readFileSync(path.join(__dirname, 'retours.js'), 'utf8');
  assert(!/fetch\(|XMLHttpRequest|grist\.|applyUserActions|sendBeacon/.test(src), 'aucun envoi réseau, aucune écriture dans Grist');
  const el = { textContent: '', style: {} };
  const ctx = makeCtx();
  ctx.document.getElementById = id => (id === 'retours-compteur' ? el : null);
  ctx.enregistrerRetour({ question: 'a' }); ctx.enregistrerRetour({ question: 'b' });
  assert(el.textContent === '2' && el.style.display === '', 'compteur mis à jour à chaque retour');
  ctx.effacerRetours();
  assert(el.textContent === '' && el.style.display === 'none', 'compteur masqué quand la liste est vide');
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
