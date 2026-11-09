// test_rapport_pdf.js — Rapport PDF : une ou plusieurs réponses, imprimées proprement.
// Avant : « 🖨 PDF » lançait window.print() et toute la page partait à l'impression (panneaux, boutons,
// conversation entière). Désormais : la réponse seule, ou plusieurs réponses choisies (« 📑 Rapport PDF »),
// avec leur question, leur titre, leur périmètre et leurs avertissements ; boutons et détails techniques retirés.
// Les fonctions testées ici travaillent sur le texte HTML ; l'impression elle-même est vérifiée dans Chromium.
// node js/test_rapport_pdf.js

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
  ctx.XLSX = { utils: { json_to_sheet: () => ({}), book_new: () => ({}), book_append_sheet() {}, sheet_to_csv: () => '' }, writeFile() {} };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.selectedDocIds = new Set();
  vm.createContext(ctx);
  for (const f of ['config.js', 'knowledge.js', 'documents.js', 'planner.js', 'dataEngine.js', 'sessions.js', 'rapport.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
  ctx.resetContextSilent = () => {};
  ctx.__t = D.tableOpenData(D.openData(1500));
  vm.runInContext("defaultOpenDataTable = __t; defaultOpenDataState = 'ready';", ctx);
  return ctx;
}
const run = (ctx, code) => vm.runInContext(code, ctx);
function ask(ctx, q) {
  run(ctx, 'window.__DATA_ENGINE_STATE = { lastPlan: null, lastExecution: null, history: [] }');
  ctx.__q = q;
  const plan = run(ctx, 'detectDataEnginePlan(__q)');
  return run(ctx, 'runDataEnginePlan')(plan, []);
}
const texte = h => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

await describe('Nettoyage d\'une réponse pour l\'impression', () => {
  const ctx = makeCtx();
  const net = run(ctx, 'nettoyerPourImpression');
  const html = '<h4 class="de-block-title"><span class="de-block-title-text">Titre</span><span class="de-exact-badge">✓ Calcul exact</span><button class="de-block-title-edit-btn" onclick="x()">✎</button><button>↺</button></h4>'
    + '<p class="de-perimetre">📌 Sur quoi porte ce calcul : 10 formations</p><p>Il y a <strong>10</strong> formations.</p>'
    + '<div class="de-chart-export-wrap"><div>barres</div><div style="display:flex"><span style="font-size:10px">Afficher en :</span><button onclick="switchChartType(this)">▬</button></div><button onclick="exportChartAsPng()">📷 Exporter</button></div>'
    + '<details class="msg-sources"><summary>Plan Data Engine</summary><div>outil<details><summary>Candidats</summary>…</details></div></details>'
    + '<details><summary>Détail utile</summary>gardé</details><div class="copilot-actions"><button>📊</button></div><input type="text" value="x"><p onclick="alert(1)">fin</p>';
  const h = net(html);
  assert(!/<button/i.test(h), 'aucun bouton (renommer, graphique, export…)');
  assert(!/Plan Data Engine|Candidats/.test(h), 'détails techniques retirés, détails imbriqués compris');
  assert(/Détail utile/.test(h) && /gardé/.test(h), 'faux positif : un autre <details> est gardé');
  assert(!/copilot-actions|<input/i.test(h), 'barre d\'actions et champs retirés');
  assert(!/Afficher en/.test(h), '« Afficher en : » retiré avec les boutons de type de graphique');
  assert(!/onclick/i.test(h), 'aucun attribut d\'action (onclick)');
  assert(/Sur quoi porte ce calcul/.test(h) && /Il y a <strong>10<\/strong>/.test(h) && /barres/.test(h) && /✓ Calcul exact/.test(h) && /fin/.test(h), 'faux positif : titre, périmètre, chiffre, graphique, badge et texte gardés');
  assert(net('<div><button>a</div>') === '<div>', 'bouton jamais fermé : retiré jusqu\'au bout, sans boucle infinie');
});

await describe('Titre de chaque bloc', () => {
  const ctx = makeCtx();
  const t = run(ctx, 'titreDuBloc');
  assert(t('<h4 class="de-block-title"><span class="de-block-title-text">287 formations — PASS</span><span class="de-exact-badge">✓ Calcul exact</span><button>✎</button></h4><p>…</p>') === '287 formations — PASS', 'titre du résultat, sans badge ni boutons');
  assert(t('<p>Le PASS est une formation de santé qui permet…</p>').startsWith('Le PASS est une formation'), 'réponse d\'Albert sans titre : début du texte');
  assert(t('<p>' + 'mot '.repeat(60) + '</p>').length <= 90, 'titre raccourci');
});

await describe('Rapport de plusieurs réponses calculées', () => {
  const ctx = makeCtx();
  const a = ask(ctx, 'combien de BTS');
  const b = ask(ctx, 'nombre de places en BTS par académie');
  const c = ask(ctx, 'combien de PASS option zoologie');
  const blocs = [{ html: a.html, question: 'combien de BTS' }, { html: b.html, question: 'nombre de places en BTS par académie' }, { html: '<p>Le PASS est un parcours d\'accès santé.</p>', question: 'qu\'est-ce que le PASS ?' }, { html: '', question: 'vide' }];
  ctx.__b = blocs;
  const r = run(ctx, "construireRapportHtml(__b, { titre: 'Rapport du 9 novembre', date: new Date(2026, 10, 9), source: 'Open data · Parcoursup 2025' })");
  assert(/Parcoursup Data Copilot — Rapport du 9 novembre/.test(r) && /9 novembre 2026/.test(r), 'en-tête : titre et date');
  assert(/Source active : Open data · Parcoursup 2025/.test(r), 'source active');
  assert(/<strong>3 résultats<\/strong> \(dont 2 calculés par le widget\)/.test(r), 'sommaire : 3 résultats (bloc vide ignoré), dont 2 calculés');
  assert((r.match(/<section class="de-print-bloc"/g) || []).length === 3, 'un bloc par réponse');
  const iA = r.indexOf('1. Question : « combien de BTS »'), iB = r.indexOf('2. Question : « nombre de places'), iC = r.indexOf('3. Question : « qu&#39;est') >= 0 ? r.indexOf('3. Question : « qu&#39;est') : r.indexOf('3. Question');
  assert(iA > 0 && iB > iA && iC > iB, 'ordre de la conversation, question avant chaque bloc');
  assert((r.match(/class="de-perimetre"/g) || []).length === 2, 'périmètre de chaque résultat calculé gardé');
  assert(texte(r).includes(String(a.result.count.toLocaleString('fr-FR'))) && /places/.test(texte(r)), 'chiffres des résultats gardés');
  assert(!/<button|Plan Data Engine|onclick/i.test(r), 'ni bouton, ni détail technique, ni onclick');
  assert(/textes rédigés par Albert sont à relire/.test(r), 'pied : chiffres calculés / textes d\'Albert à relire');
  const seul = run(ctx, 'construireRapportHtml')([{ html: c.html, question: 'combien de PASS option zoologie' }], {});
  assert(!/de-print-sommaire/.test(seul) && /Question : « combien de PASS option zoologie »/.test(seul) && !/1\. Question/.test(seul), 'une seule réponse : pas de sommaire ni de numéro');
  assert(/Critère non reconnu|Option non précisée|Formation non trouvée/.test(seul), 'un arrêt du moteur s\'imprime aussi tel quel');
  ctx.__x = [{ html: '<p>ok</p>', question: '<script>alert(1)</script>' }];
  assert(!/<script>/.test(run(ctx, 'construireRapportHtml(__x, { titre: "<b>t</b>" })')), 'question et titre échappés');
});

await describe('Branchements dans le widget', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const sessions = fs.readFileSync(path.join(__dirname, 'sessions.js'), 'utf8');
  assert(/<script src="js\/rapport\.js\?v=[\d.]+" defer><\/script>/.test(html), 'rapport.js chargé avec defer et version');
  assert(/onclick="ouvrirRapportPDF\(\)"[^>]*>📑 <span class="label">Rapport PDF<\/span>/.test(html), 'bouton « 📑 Rapport PDF » dans l\'en-tête');
  assert(/imprimerUneReponse\(bubble, question\)/.test(sessions) && !/\(\) => window\.print\(\)/.test(sessions), '« 🖨 PDF » sous une réponse : cette réponse seule (plus window.print() sur toute la page)');
  assert(/id="de-print-root"/.test(html) && /body\.de-printing > \*:not\(#de-print-root\)/.test(html), 'zone d\'impression et masquage du reste de la page');
  const ctx = makeCtx();
  assert(run(ctx, 'imprimerRapport([{ html: "<p>x</p>" }])') === false, 'sans zone d\'impression : rien ne se passe (pas d\'erreur)');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
