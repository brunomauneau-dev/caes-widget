// test_infographic_block_rename.js — Renommage inline des titres de blocs
// dans le compositeur d'infographies (_icState.blocks[i].title éditable).
// Couvre : entrée/sortie du mode édition, validation (Enter/blur), annulation
// (Escape), garde-fou titre vide, réinitialisation au titre original, et
// persistance du titre édité vers window._copilotDataBlocks + session.dataBlocks.
// node js/test_infographic_block_rename.js

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

// ─── Fausse cible DOM minimale (assez pour _icRenderBlocks / openInfographicComposer) ───
function makeFakeElement() {
  const el = {
    _html: '',
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    children: [],
    appendChild(child) { el.children.push(child); },
    addEventListener() {},
    querySelectorAll() { return []; },
    focus() {}, select() {},
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html; },
    set(v) { el._html = v; if (v === '') el.children = []; }
  });
  return el;
}

const elements = {};
function getElementById(id) {
  if (!elements[id]) elements[id] = makeFakeElement();
  return elements[id];
}

// ─── Charger sessions.js dans un contexte vm avec globals minimaux ─────────
const sessionsSrc = fs.readFileSync(path.join(__dirname, 'sessions.js'), 'utf8');
const ctx = { console };
ctx.globalThis = ctx;
vm.createContext(ctx);

vm.runInContext('function normalizeText(s){return String(s||"").toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").trim();}', ctx);
ctx.escapeHtml = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
ctx.document = { getElementById, createElement: () => makeFakeElement() };
ctx.window = { _copilotDataBlocks: [] };
ctx.alert = (msg) => { throw new Error('alert inattendu : ' + msg); };
ctx.INFOGRAPH_THEMES = [{ id: 'theme1', label: 'Thème 1', accent: '#000', secondary: '#fff' }];
ctx.sessions = [];
ctx.currentSessionId = null;

vm.runInContext(sessionsSrc, ctx, { filename: 'sessions.js' });

// Neutralise la vraie persistSessions (Storage/chatHistory non stubbés) : on
// veut seulement vérifier que la sauvegarde est *déclenchée*, pas l'exécuter.
let saveScheduledCount = 0;
ctx.scheduleSessionsSave = () => { saveScheduledCount++; };

function freshState() {
  ctx._icState = { blocks: [], theme: 'theme1', dragSrcIdx: null, targetUid: null, editingIdx: null };
  saveScheduledCount = 0;
  ctx.window._copilotDataBlocks = [];
  ctx.sessions = [];
  ctx.currentSessionId = null;
}

// ─── openInfographicComposer : originalTitle mémorisé + mode édition vierge ─
describe('openInfographicComposer — mémorise originalTitle et réinitialise editingIdx', () => {
  freshState();
  ctx.window._copilotDataBlocks = [
    { id: 'b1', title: 'Académies (3 499)', question: 'répartition par académie', dataContext: 'ctx1' }
  ];
  ctx.sessions = [{ id: 's1', dataBlocks: [] }];
  ctx.currentSessionId = 's1';

  vm.runInContext('openInfographicComposer()', ctx);

  assert(ctx._icState.blocks.length === 1, 'un bloc chargé dans _icState');
  assert(ctx._icState.blocks[0].originalTitle === 'Académies (3 499)', 'originalTitle capturé à l\'ouverture');
  assert(ctx._icState.blocks[0].title === 'Académies (3 499)', 'title initial inchangé');
  assert(ctx._icState.editingIdx === null, 'aucun bloc en édition à l\'ouverture');
});

// ─── Entrée / sortie du mode édition ────────────────────────────────────────
describe('_icStartRenameBlock / _icCancelRenameBlock — bascule le mode édition', () => {
  freshState();
  ctx._icState.blocks = [{ id: 'b1', title: 'Titre A', originalTitle: 'Titre A', question: '', dataContext: '' }];

  vm.runInContext('_icStartRenameBlock(0)', ctx);
  assert(ctx._icState.editingIdx === 0, 'editingIdx passe à 0 après _icStartRenameBlock');

  vm.runInContext('_icCancelRenameBlock(0)', ctx);
  assert(ctx._icState.editingIdx === null, 'editingIdx revient à null après annulation (Escape)');
  assert(ctx._icState.blocks[0].title === 'Titre A', 'le titre n\'est pas modifié par une annulation');
});

// ─── Validation (Enter / blur) ──────────────────────────────────────────────
describe('_icCommitRenameBlock — valide un nouveau titre et le persiste', () => {
  freshState();
  ctx._icState.blocks = [{ id: 'b1', title: 'Titre original', originalTitle: 'Titre original', question: '', dataContext: '' }];
  ctx.window._copilotDataBlocks = [{ id: 'b1', title: 'Titre original' }];
  ctx.sessions = [{ id: 's1', dataBlocks: [{ id: 'b1', title: 'Titre original' }] }];
  ctx.currentSessionId = 's1';

  vm.runInContext('_icStartRenameBlock(0)', ctx);
  vm.runInContext('_icCommitRenameBlock(0, "  Mon titre   personnalisé  ")', ctx);

  assert(ctx._icState.blocks[0].title === 'Mon titre personnalisé', 'le titre est mis à jour et les espaces internes/en bordure normalisés');
  assert(ctx._icState.editingIdx === null, 'le mode édition se referme après validation');
  assert(ctx.window._copilotDataBlocks[0].title === 'Mon titre personnalisé', 'le titre est répercuté sur window._copilotDataBlocks (même id)');
  assert(ctx.sessions[0].dataBlocks[0].title === 'Mon titre personnalisé', 'le titre est répercuté sur session.dataBlocks (même id)');
  assert(saveScheduledCount === 1, 'scheduleSessionsSave() est déclenché exactement une fois');
});

describe('_icCommitRenameBlock — garde-fou : un titre vide ne remplace pas le titre existant', () => {
  freshState();
  ctx._icState.blocks = [{ id: 'b1', title: 'Titre existant', originalTitle: 'Titre existant', question: '', dataContext: '' }];

  vm.runInContext('_icCommitRenameBlock(0, "     ")', ctx);
  assert(ctx._icState.blocks[0].title === 'Titre existant', 'une valeur vide/blanche ne remplace pas le titre courant');
});

describe('submitInfographicComposer — utilise bien le titre édité (composerCtx / question)', () => {
  freshState();
  ctx._icState.blocks = [
    { id: 'b1', title: 'Titre édité', originalTitle: 'Titre original', question: 'q1', dataContext: 'contexte des données 1', checked: true }
  ];
  vm.runInContext('_icCommitRenameBlock(0, "Titre édité")', ctx);
  const selected = ctx._icState.blocks.filter(b => b.checked);
  const composerCtx = selected.map((b, i) => `[Analyse ${i + 1} — ${b.title}]\n${b.dataContext}`).join('\n\n---\n\n');
  assert(composerCtx.includes('Titre édité'), 'le contexte envoyé au générateur reprend bien le titre édité, pas l\'original');
});

// ─── Réinitialisation au titre original ─────────────────────────────────────
describe('_icResetBlockTitle — revient au titre original et persiste', () => {
  freshState();
  ctx._icState.blocks = [{ id: 'b1', title: 'Titre modifié', originalTitle: 'Titre original', question: '', dataContext: '' }];
  ctx.window._copilotDataBlocks = [{ id: 'b1', title: 'Titre modifié' }];

  vm.runInContext('_icResetBlockTitle(0)', ctx);

  assert(ctx._icState.blocks[0].title === 'Titre original', 'le titre revient à originalTitle');
  assert(ctx.window._copilotDataBlocks[0].title === 'Titre original', 'la réinitialisation est aussi répercutée sur window._copilotDataBlocks');
  assert(saveScheduledCount === 1, 'la réinitialisation déclenche aussi une sauvegarde');
});

// ─── Rendu : bouton "reset" visible seulement si le titre a été modifié ────
describe('_icRenderBlocks — le bouton de réinitialisation n\'apparaît que si le titre diffère de l\'original', () => {
  freshState();
  ctx._icState.blocks = [
    { id: 'b1', title: 'Inchangé', originalTitle: 'Inchangé', question: '', dataContext: '', checked: true },
    { id: 'b2', title: 'Modifié', originalTitle: 'Original', question: '', dataContext: '', checked: true }
  ];
  elements['ic-blocks'] = makeFakeElement();
  vm.runInContext('_icRenderBlocks()', ctx);
  const html0 = elements['ic-blocks'].children[0].innerHTML;
  const html1 = elements['ic-blocks'].children[1].innerHTML;
  assert(!html0.includes('ic-block-title-reset-btn'), 'pas de bouton reset pour un bloc au titre inchangé');
  assert(html1.includes('ic-block-title-reset-btn'), 'bouton reset présent pour un bloc au titre modifié');
});

describe('_icRenderBlocks — un bloc en édition affiche un champ input, pas le texte statique', () => {
  freshState();
  ctx._icState.blocks = [{ id: 'b1', title: 'Titre A', originalTitle: 'Titre A', question: '', dataContext: '', checked: true }];
  elements['ic-blocks'] = makeFakeElement();
  ctx._icState.editingIdx = 0;
  vm.runInContext('_icRenderBlocks()', ctx);
  const html = elements['ic-blocks'].children[0].innerHTML;
  assert(html.includes('ic-block-title-input'), 'un <input> de renommage est rendu pour le bloc en cours d\'édition');
  assert(!html.includes('ic-block-title-edit-btn'), 'le bouton crayon disparaît pendant l\'édition (remplacé par l\'input)');
});

console.log(`\n──────────────────────────────────────────────────`);
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed > 0) process.exit(1);
