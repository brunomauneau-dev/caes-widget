// test_dom_guards.js — Garde-fous DOM contre les crashs avant confirmation
// d'accès Grist (l'utilisateur doit cliquer "Accepter" sur la demande d'accès
// en lecture ; pendant ce temps le script s'exécute déjà mais le DOM
// applicatif n'est pas forcément prêt). Régression réelle observée le 30/06 :
// trois TypeError "is null" sur des éléments DOM accédés sans garde-fou
// (textarea#chat-input, #chat-sub, #chat-messages).
// node js/test_dom_guards.js

import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let passed = 0, failed = 0;
function assert(condition, label) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}`); failed++; }
}
function describe(label, fn) { console.log(`\n${label}`); fn(); }

const albertSrc = fs.readFileSync(path.join(__dirname, 'albert.js'), 'utf8');
const infographicSrc = fs.readFileSync(path.join(__dirname, 'infographic.js'), 'utf8');

// ─── Vérification statique : les garde-fous sont bien présents dans le code source ─
describe('Garde-fous présents dans le code source (vérification statique)', () => {
  const textareaBlock = albertSrc.match(/const textarea = document\.getElementById\('chat-input'\);[\s\S]{0,40}/);
  assert(!!textareaBlock && /if \(textarea\)/.test(textareaBlock[0]), 'textarea (auto-resize) protégée par "if (textarea)"');

  const updateChatSubBlock = albertSrc.match(/function updateChatSub\(\)[\s\S]*?\n}\n/);
  assert(!!updateChatSubBlock && /if \(chatSub\) chatSub\.textContent/.test(updateChatSubBlock[0]), 'updateChatSub protégée par "if (chatSub)"');

  const addMessageBlock = albertSrc.match(/function addMessage\([\s\S]{0,150}/);
  assert(!!addMessageBlock && /if \(!wrap\) return/.test(addMessageBlock[0]), 'addMessage protégée par "if (!wrap) return"');

  const addInfographicBlock = infographicSrc.match(/const wrap = document\.getElementById\('chat-messages'\);[\s\S]{0,40}/);
  assert(!!addInfographicBlock && /if \(!wrap\) return/.test(addInfographicBlock[0]), 'addInfographicMessage protégée par "if (!wrap) return"');
});

// ─── Vérification comportementale : exécution sans crash quand le DOM est absent ─
describe('updateChatSub — ne plante pas quand #chat-sub est absent (régression réelle)', () => {
  const fnMatch = albertSrc.match(/function updateChatSub\(\)[\s\S]*?\n}\n/);
  const fn = new Function(
    'document', 'gristRecords', 'documents',
    `${fnMatch[0]}return updateChatSub();`
  );
  let threw = false;
  try {
    fn({ getElementById: () => null }, [], []);
  } catch (e) { threw = true; }
  assert(!threw, 'aucune exception levée quand getElementById("chat-sub") renvoie null');
});

describe('addMessage — ne plante pas quand #chat-messages est absent (régression réelle)', () => {
  const fnMatch = albertSrc.match(/function addMessage\([\s\S]*?\n}\n/);
  // addMessage a plusieurs dépendances (escapeHtml, chatHistory, etc.) ; on vérifie
  // seulement que le early-return empêche d'atteindre le code qui suppose wrap non-null.
  assert(!!fnMatch, 'addMessage trouvée dans albert.js');
  if (fnMatch) {
    const beforeFirstWrapUse = fnMatch[0].split('wrap.appendChild')[0];
    assert(/if \(!wrap\) return;/.test(beforeFirstWrapUse), 'le early-return est bien placé avant tout usage de wrap.appendChild');
  }
});

describe('addInfographicMessage — early-return avant tout usage de wrap (régression réelle)', () => {
  const fnMatch = infographicSrc.match(/function addInfographicMessage\([\s\S]*?\n}\n/);
  assert(!!fnMatch, 'addInfographicMessage trouvée dans infographic.js');
  if (fnMatch) {
    const beforeFirstWrapUse = fnMatch[0].split('wrap.appendChild')[0];
    assert(/if \(!wrap\) return;/.test(beforeFirstWrapUse), 'le early-return est bien placé avant tout usage de wrap.appendChild');
  }
});

// ─── RÉGRESSION RÉELLE (30/06) : envoi de message impossible sur une session
// qui a déjà des messages, car #empty-state n'existe alors pas dans le DOM
// (il n'est recréé par renderActiveSession que pour une session vide) — voir
// sessions.js. sendMessage() accédait à .style.display sans vérifier que
// l'élément existe, plantant silencieusement AVANT addMessage('user', question).
describe('sendMessage — ne plante pas quand #empty-state est absent du DOM (session avec historique)', () => {
  const fnMatch = albertSrc.match(/async function sendMessage\(\)[\s\S]{0,400}/);
  assert(!!fnMatch, 'sendMessage trouvée dans albert.js');
  if (fnMatch) {
    assert(/const emptyState = document\.getElementById\('empty-state'\);\s*\n\s*if \(emptyState\)/.test(fnMatch[0]),
      'garde-fou "if (emptyState)" présent avant .style.display (corrige le blocage d\'envoi observé en usage réel)');
    assert(!/document\.getElementById\('empty-state'\)\.style\.display/.test(fnMatch[0]),
      'plus aucun accès direct .style.display sans garde-fou sur empty-state');
  }
});

console.log(`\n──────────────────────────────────────────────────`);
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed > 0) process.exit(1);
