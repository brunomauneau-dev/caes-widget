// test_script_timing.js — Régression réelle (30/06) : au F5, les scripts
// js/*.js (sans defer) s'exécutaient pendant le parsing du <head>, AVANT que
// le <body> (et donc #chat-messages, #empty-state, etc.) ne soit construit.
// Diagnostiqué via logs : initSessions() s'exécutait bien, loadSessionsFromStorage
// restaurait bien la session (messages.length correct), mais
// document.getElementById('chat-messages') renvoyait null à ce moment précis
// → renderActiveSession() ne pouvait afficher aucun message, silencieusement.
// Corrigé en ajoutant l'attribut "defer" à tous les <script src="..."> du
// <head>, ce qui retarde leur exécution jusqu'à ce que le DOM soit parsé,
// tout en conservant l'ordre d'exécution relatif entre les scripts.
// node js/test_script_timing.js

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

const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

describe('Tous les scripts du <head> ont l\'attribut defer (régression timing DOM)', () => {
  const scriptTags = indexSrc.match(/<script src="[^"]+"[^>]*><\/script>/g) || [];
  assert(scriptTags.length > 0, 'au moins un tag <script src="..."> trouvé dans index.html');
  scriptTags.forEach(tag => {
    const srcMatch = tag.match(/src="([^"]+)"/);
    const src = srcMatch ? srcMatch[1] : tag;
    assert(/\sdefer(\s|>)/.test(tag) || /\bdefer\b/.test(tag), `defer présent sur : ${src}`);
  });
});

describe('Les scripts locaux js/*.js apparaissent bien avant le </head> et le <body> après', () => {
  const headEnd = indexSrc.indexOf('</head>');
  const bodyStart = indexSrc.indexOf('<body>');
  const lastScriptIdx = indexSrc.lastIndexOf('<script src="js/albert.js');
  assert(headEnd > 0 && bodyStart > headEnd, 'structure HTML attendue : <script> avant </head>, puis <body>');
  assert(lastScriptIdx > 0 && lastScriptIdx < headEnd, 'le dernier script (albert.js) est bien chargé dans le <head> (avec defer, c\'est sans risque)');
});

describe('Aucun script inline synchrone entre les balises <script src> (qui casserait l\'ordre defer)', () => {
  const headContent = indexSrc.slice(indexSrc.indexOf('<head>'), indexSrc.indexOf('</head>'));
  const inlineScripts = (headContent.match(/<script(?![^>]*\ssrc=)[^>]*>/g) || []);
  assert(inlineScripts.length === 0, `aucun <script> inline sans src dans le <head> (obtenu : ${inlineScripts.length})`);
});

console.log(`\n──────────────────────────────────────────────────`);
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed > 0) process.exit(1);
