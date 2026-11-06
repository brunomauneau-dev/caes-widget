// test_chiffres_albert.js — Les chiffres écrits par Albert sont vérifiés contre les données fournies.
// Origine : test réel du 05/11/2026, où Albert a répondu à une question non calculée par le moteur en
// inventant des intitulés et des chiffres. Règle : Albert ne doit produire aucun chiffre ; tout nombre de sa
// réponse absent des sources (contexte, résultats calculés, question) est signalé à l'agent (bandeau + surlignage),
// et la réponse n'alimente pas les infographies.
// node js/test_chiffres_albert.js

import fs from 'fs';
import vm from 'vm';
import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let passed = 0, failed = 0;
function assert(condition, label) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}`); failed++; }
}
function describe(label, fn) {
  console.log(`\n${label}`);
  try { fn(); } catch (e) { console.error(`  ✗ erreur : ${e.message}`); failed++; }
}

// Modules chargés ensemble, comme dans le widget
const noopEl = () => null;
const ctx = {
  console: { ...console, log() {}, warn() {}, info() {} }, setTimeout: () => null, clearTimeout() {}, URLSearchParams, TextDecoder,
  document: { getElementById: noopEl, querySelector: noopEl, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, fetch: () => Promise.reject(new Error('hors ligne')),
  escapeHtml: s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
};
ctx.window = ctx; ctx.globalThis = ctx; ctx.selectedDocIds = new Set();
vm.createContext(ctx);
for (const f of ['config.js', 'knowledge.js', 'documents.js', 'planner.js', 'dataEngine.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
}
const verifier = (rep, sources, q = '') => ctx.verifierChiffresAlbert(rep, sources, q);
const inconnus = (rep, sources, q) => verifier(rep, sources, q).inconnus.map(x => x.affiche);

const CONTEXTE = `=== DATA ENGINE V22 — RÉSULTAT CALCULÉ SUR LIGNES BRUTES ===
Résultat : 287 ligne(s) sur 14252.
Capacité moyenne : 31.59 · taux d'accès 12,5 % · 1 234 candidats · 169 033 places
Agrégats : BTS 5 351 ; Licence 3052.`;

describe('Chiffres présents dans les données : acceptés', () => {
  assert(inconnus('<p>Il y a <strong>287</strong> PASS sur 14 252 formations.</p>', [CONTEXTE]).length === 0, '287 et « 14 252 » (écrit 14252 dans les données) acceptés');
  assert(inconnus('Capacité moyenne : 31,59 ; taux 12.5 %.', [CONTEXTE]).length === 0, 'décimales à la virgule ou au point : « 31,59 » = 31.59, « 12.5 » = 12,5');
  assert(inconnus('Il y a 1234 candidats et 169033 places.', [CONTEXTE]).length === 0, 'séparateurs de milliers ignorés (« 1 234 » = 1234)');
  assert(inconnus('5351 BTS et 3 052 licences.', [CONTEXTE]).length === 0, 'chiffres des agrégats acceptés, avec ou sans espace');
  assert(inconnus('Vous demandez les 42 formations du lycée.', [CONTEXTE], 'quelles sont les 42 formations du lycée ?').length === 0, 'chiffre cité dans la question de l\'agent : accepté');
});

describe('Chiffres inventés : signalés', () => {
  assert(JSON.stringify(inconnus('Il y a 312 PASS en France.', [CONTEXTE])) === '["312"]', '312 absent des données → signalé');
  assert(JSON.stringify(inconnus('Soit 38,7 % des formations.', [CONTEXTE])) === '["38,7"]', 'pourcentage calculé par Albert (38,7 %) → signalé');
  assert(JSON.stringify(inconnus('Environ 14 000 formations.', [CONTEXTE])) === '["14 000"]', 'arrondi « environ 14 000 » → signalé (pas dans les données)');
  assert(inconnus('287 PASS, dont 120 en option Droit et 45 en Biologie.', [CONTEXTE]).join('|') === '120|45', 'seuls les chiffres inventés sont signalés, pas les vrais');
  assert(inconnus('287 + 287 = 574', [CONTEXTE]).join('|') === '574', 'calcul fait par Albert (574) → signalé');
});

describe('Faux positifs évités', () => {
  assert(inconnus('Pour la session 2025 et la rentrée 2026.', [CONTEXTE]).length === 0, 'années non signalées');
  assert(inconnus('Le 1er vœu, la 2e phase, en L1, bac STI2D, BUT GEII, N+1.', [CONTEXTE]).length === 0, 'ordinaux et sigles (1er, 2e, L1, STI2D, N+1) non signalés');
  assert(inconnus('Il existe 2 phases et 3 étapes.', [CONTEXTE]).length === 0, 'petits entiers (0 à 3) non signalés');
  assert(inconnus('<h4 style="margin:12px 0;color:#003189">Résultat</h4><p>287 PASS</p>', [CONTEXTE]).length === 0, 'chiffres dans les balises HTML (styles, couleurs) ignorés');
  assert(inconnus('Aucune information chiffrée.', [CONTEXTE]).length === 0, 'texte sans chiffre : rien à signaler');
  const r = verifier('Les candidats peuvent formuler 10 vœux.', ['Glossaire : un candidat peut formuler jusqu\'à 10 vœux en phase principale.']);
  assert(r.inconnus.length === 0, 'chiffre issu des références métier (10 vœux) accepté');
});

describe('Affichage : bandeau et surlignage', () => {
  const rep = '<h4 style="margin:12px 0">PASS</h4><p>Il y a 287 PASS, dont 120 en option Droit.</p>';
  const v = verifier(rep, [CONTEXTE]);
  const html = ctx.annoterReponseAlbert(rep, v);
  assert(/class="alerte-chiffres-albert"/.test(html) && /Chiffres non calculés par le widget/.test(html) && /120/.test(html.split('</div>')[0]), 'bandeau d\'avertissement qui cite le chiffre');
  assert(/<mark class="chiffre-non-verifie"[^>]*>120<\/mark>/.test(html), 'le chiffre inventé est surligné');
  assert(!/<mark[^>]*>287<\/mark>/.test(html), 'le chiffre vérifié n\'est pas surligné');
  assert(/<h4 style="margin:12px 0">PASS<\/h4>/.test(html), 'les balises et leurs attributs restent intacts');
  assert(ctx.annoterReponseAlbert('<p>Il y a 287 PASS.</p>', verifier('<p>Il y a 287 PASS.</p>', [CONTEXTE])) === '<p>Il y a 287 PASS.</p>', 'réponse sans chiffre douteux : affichée telle quelle');
});

describe('Branchement dans albert.js', () => {
  const albert = fs.readFileSync(path.join(__dirname, 'albert.js'), 'utf8');
  assert(/CHIFFRES \(règle absolue\)/.test(albert) && /Ne fais aucun calcul toi-même/.test(albert), 'consigne à Albert : aucun chiffre hors contexte, aucun calcul');
  assert(/verifierChiffresAlbert\(answer, sourcesChiffres, question\)/.test(albert) && /addMessage\('assistant', answerAffiche\)/.test(albert), 'la réponse affichée est la réponse vérifiée et annotée');
  assert(/startsWith\('=== DATA ENGINE'\)/.test(albert) && /m\.role === 'user'/.test(albert), 'sources : résultats du widget et questions de l\'agent, jamais les anciennes réponses d\'Albert');
  assert(/!chiffresDouteux/.test(albert), 'une réponse avec chiffres douteux n\'alimente pas les infographies');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert(!/albert\.js\?v=27\.6\.18/.test(html) && !/dataEngine\.js\?v=27\.5\.25/.test(html), 'versions des scripts incrémentées (cache)');
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
