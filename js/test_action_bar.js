// test_action_bar.js — Tests barre d'action copilot (bouton local vs global)
// Recréé à partir du code réel de sessions.js (le fichier original de la session T4
// n'a pas été inclus dans l'upload — voir audit du 30/06). Charge le vrai code via vm,
// pas un stub, pour tester le comportement réel de buildCopilotActionBar.
// node js/test_action_bar.js

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
function describe(label, fn) { console.log(`\n${label}`); fn(); }

// ─── Mini-DOM suffisant pour buildCopilotActionBar + _icRenderBlocks ───────
function makeFakeElement(tag = 'div') {
  const el = {
    tagName: tag,
    className: '',
    type: '',
    textContent: '',
    title: '',
    disabled: false,
    style: {},
    dataset: {},
    children: [],
    _innerHTML: '',
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); }
    },
    appendChild(child) { this.children.push(child); return child; },
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) { this._innerHTML = v; },
  };
  return el;
}

function makeDocument(registry) {
  return {
    createElement: (tag) => makeFakeElement(tag),
    getElementById: (id) => registry[id] || null,
    body: { classList: { add() {}, remove() {} } },
  };
}

// ─── Charger les vrais sessions.js + infographic.js dans un contexte sandbox ─
// (dans le navigateur, tous les fichiers js/ partagent le même scope global ;
// on reproduit ça ici plutôt que de stubber escapeHtml/addInfographicMessage à la main)
const sessionsSrc = fs.readFileSync(path.join(__dirname, 'sessions.js'), 'utf8');
const infographicSrc = fs.readFileSync(path.join(__dirname, 'infographic.js'), 'utf8');
const configSrc = fs.readFileSync(path.join(__dirname, 'config.js'), 'utf8');

function makeSandbox({ dataBlocks = [], globalBlocks = [] } = {}) {
  const registry = {
    'modal-ic': makeFakeElement('div'),
    'ic-blocks': makeFakeElement('div'),
    'ic-themes': makeFakeElement('div'),
  };
  const calls = { alert: [], addMessage: [], addInfographicMessage: [], generateInfographicWithAlbert: [] };

  const ctx = {
    document: makeDocument(registry),
    window: {},
    console,
    navigator: { clipboard: { writeText: async () => {} } },
    alert: (msg) => calls.alert.push(msg),
    addMessage: (...args) => calls.addMessage.push(args),
    quickAsk: () => {},
    addPersistentFilter: () => {},
    executeLocalDataQuery: () => ({}),
    getDataEngineState: () => ({ lastExecution: null, lastPlan: null }),
  };
  ctx.window._copilotDataBlocks = globalBlocks;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(configSrc, ctx, { filename: 'config.js' });
  vm.runInContext(
    `sessions = ${JSON.stringify([{ id: 'sess1', dataBlocks, persistentFilters: [] }])}; currentSessionId = 'sess1';`,
    ctx, { filename: 'inject-state.js' }
  );
  vm.runInContext(infographicSrc, ctx, { filename: 'infographic.js' });
  // Intercepte les vraies fonctions définies par infographic.js : on compte les appels
  // sans déclencher le vrai réseau (generateInfographicWithAlbert fait un fetch réel).
  ctx.generateInfographicWithAlbert = async (...args) => { calls.generateInfographicWithAlbert.push(args); return '<html>fake</html>'; };
  const realAddInfographicMessage = ctx.addInfographicMessage;
  ctx.addInfographicMessage = (...args) => { calls.addInfographicMessage.push(args); };
  vm.runInContext(sessionsSrc, ctx, { filename: 'sessions.js' });
  return { ctx, registry, calls };
}

// ─── Scénario 1 : dataExecution fourni → génération directe, pas de modale ─
async function scenario1() {
  console.log('\nScénario 1 — bouton local avec dataExecution : génération directe');
  const { ctx, calls, registry } = makeSandbox();
  const bubble = makeFakeElement('div');
  const fakeExec = { plan: { filters: [{ col: 'Boursier', op: 'eq', value: 'Oui' }] } };
  const bar = ctx.buildCopilotActionBar(bubble, fakeExec, 'compare les boursiers et les non-boursiers');
  const infoBtn = bar.children.find(b => b.textContent && b.textContent.toLowerCase().includes('infographie'));
  assert(!!infoBtn, 'le bouton Infographie existe dans la barre');
  infoBtn.onclick({ stopPropagation() {} });
  await new Promise(r => setTimeout(r, 10)); // mk() ne propage pas la Promise (fire-and-forget)
  assert(calls.generateInfographicWithAlbert.length === 1, 'generateInfographicWithAlbert appelé une fois');
  assert(calls.generateInfographicWithAlbert[0][2] === fakeExec, 'appelé avec le bon dataExecution (pas un autre bloc)');
  assert(calls.addInfographicMessage.length === 1, 'addInfographicMessage appelé (résultat affiché)');
  assert(registry['modal-ic'].style.display !== 'flex', 'le compositeur global n\'a pas été ouvert (pas de fallback)');
}

// ─── Scénario 2a : pas de dataExecution, pas d'historique → alert ──────────
async function scenario2a() {
  console.log('\nScénario 2a — bouton local sans dataExecution, sans historique : alerte');
  const { ctx, calls } = makeSandbox({ dataBlocks: [], globalBlocks: [] });
  const bubble = makeFakeElement('div');
  const bar = ctx.buildCopilotActionBar(bubble, null, '');
  const infoBtn = bar.children.find(b => b.textContent && b.textContent.toLowerCase().includes('infographie'));
  infoBtn.onclick({ stopPropagation() {} });
  await new Promise(r => setTimeout(r, 10)); // mk() ne propage pas la Promise (fire-and-forget)
  assert(calls.alert.length === 1, 'alert() appelée (fallback sans historique)');
  assert(calls.generateInfographicWithAlbert.length === 0, 'generateInfographicWithAlbert PAS appelé');
}

// ─── Scénario 2b : pas de dataExecution, mais historique en session → modale ─
async function scenario2b() {
  console.log('\nScénario 2b — bouton local sans dataExecution, avec historique : ouvre la modale');
  const blocks = [{ id: 'b1', title: 'Boursiers vs non-boursiers', dataContext: 'résumé...' }];
  const { ctx, calls, registry } = makeSandbox({ dataBlocks: blocks });
  const bubble = makeFakeElement('div');
  const bar = ctx.buildCopilotActionBar(bubble, null, '');
  const infoBtn = bar.children.find(b => b.textContent && b.textContent.toLowerCase().includes('infographie'));
  infoBtn.onclick({ stopPropagation() {} });
  await new Promise(r => setTimeout(r, 10)); // mk() ne propage pas la Promise (fire-and-forget)
  assert(calls.alert.length === 0, 'pas d\'alerte (des blocs existent)');
  const icBlocksContainer = registry['ic-blocks'];
  const renderedTitles = icBlocksContainer.children.map(c => c.innerHTML).join(' ');
  assert(icBlocksContainer.children.length === 1 && renderedTitles.includes('Boursiers vs non-boursiers'), 'le compositeur est peuplé avec le bloc de la session (rendu DOM réel)');
  assert(registry['modal-ic'].style.display === 'flex', 'la modale modal-ic est bien affichée');
}

async function main() {
  await scenario1();
  await scenario2a();
  await scenario2b();

  console.log(`\n──────────────────────────────────────────────────`);
  console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
  if (failed > 0) process.exit(1);
}
main();
