// test_copilot_feel.js — Tests des 4 améliorations "vrai copilot" (30/06) :
// (1) message de chargement contextuel selon le type de question,
// (2) badge "calcul exact" sur les réponses Data Engine,
// (3) tooltips sur les boutons techniques,
// (4) bandeau d'exemples de questions toujours visible (mini-suggestions).
// node js/test_copilot_feel.js

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
const dataEngineSrc = fs.readFileSync(path.join(__dirname, 'dataEngine.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// ─── (1) Message de chargement contextuel ──────────────────────────────────
describe('buildLoadingLabel — message adapté au type de question', () => {
  const fnMatch = albertSrc.match(/function buildLoadingLabel\([\s\S]*?\n}\n/);
  assert(!!fnMatch, 'buildLoadingLabel trouvée dans albert.js');
  if (fnMatch) {
    const fn = new Function(
      'isInfographicRequest', 'isExportCurrentRequest', 'isDataEngineQuestion', 'gristRecords',
      `${fnMatch[0]}return buildLoadingLabel(arguments[4]);`
    );
    const infographicLabel = fn(() => true, () => false, () => false, [], 'fais une infographie');
    assert(/infographie/i.test(infographicLabel), `question infographie → label adapté (obtenu : "${infographicLabel}")`);

    const exportLabel = fn(() => false, () => true, () => false, [], 'exporte en excel');
    assert(/export/i.test(exportLabel), `question export → label adapté (obtenu : "${exportLabel}")`);

    const gristLabel = fn(() => false, () => false, () => true, [{ a: 1 }], 'combien de boursiers');
    assert(/grist|données/i.test(gristLabel), `question Data Engine avec Grist actif → label adapté (obtenu : "${gristLabel}")`);

    const genericLabel = fn(() => false, () => false, () => false, [], 'résume ce document');
    assert(/documents/i.test(genericLabel), `question générique → fallback documentaire (obtenu : "${genericLabel}")`);
  }
});

describe('addLoadingMessage — passe bien la question à buildLoadingLabel', () => {
  assert(/addLoadingMessage\(id, question = ''\)/.test(albertSrc), 'addLoadingMessage accepte un paramètre question');
  assert(/addLoadingMessage\(loadingId, question\)/.test(albertSrc), 'sendMessage transmet la question lors de l\'appel');
});

// ─── (2) Badge "calcul exact" ───────────────────────────────────────────────
describe('Badge "calcul exact" présent sur toutes les branches de renderDataEngineResultHtml', () => {
  assert(/const DE_EXACT_BADGE/.test(dataEngineSrc), 'DE_EXACT_BADGE défini dans dataEngine.js');
  assert(/function deTitleHtml/.test(dataEngineSrc), 'deTitleHtml (helper de titre + badge) défini');

  const fnMatch = dataEngineSrc.match(/function renderDataEngineResultHtml\([\s\S]*?\n}\n\nfunction shouldAnswerLocallyWithoutAlbert/);
  assert(!!fnMatch, 'renderDataEngineResultHtml trouvée');
  if (fnMatch) {
    const body = fnMatch[0];
    const rawH4Count = (body.match(/<h4>\$\{escapeHtml/g) || []).length;
    assert(rawH4Count === 0, `aucun <h4> brut restant sans passer par deTitleHtml (obtenu : ${rawH4Count} occurrence(s))`);
    const deTitleCount = (body.match(/deTitleHtml\(/g) || []).length;
    assert(deTitleCount === 5, `les 5 branches (count_rows, group_by/top, pivot, stats, fallback) utilisent deTitleHtml (obtenu : ${deTitleCount})`);
  }
});

describe('Titres jargon "calculé localement" retirés (pivot, stats)', () => {
  assert(!/Tableau croisé calculé localement/.test(dataEngineSrc), 'titre jargon pivot retiré');
  assert(!/Statistiques calculées localement/.test(dataEngineSrc), 'titre jargon stats retiré');
});

describe('Tooltip ajouté sur "Plan Data Engine" (section technique repliée)', () => {
  const occurrences = (dataEngineSrc.match(/<summary title="[^"]*">Plan Data Engine<\/summary>/g) || []).length;
  assert(occurrences === 2, `tooltip présent sur les 2 occurrences de "Plan Data Engine" (obtenu : ${occurrences})`);
});

// ─── (3) Tooltips sur les boutons techniques de la barre du haut ───────────
describe('Tooltips sur les boutons de la barre d\'actions (index.html)', () => {
  const buttons = ['openSessionsPanel()', 'openSourcesPanel()', 'openInfographicComposer()', 'resetCopilotDialogue()', 'openConfig()'];
  buttons.forEach(fnCall => {
    const re = new RegExp(`onclick="${fnCall.replace(/[()]/g, '\\$&')}"[^>]*title="[^"]+"`);
    assert(re.test(indexSrc), `bouton ${fnCall} a un attribut title non vide`);
  });
});

// ─── (4) Bandeau d'exemples permanent (mini-suggestions) ───────────────────
describe('Bandeau mini-suggestions — présent dans le HTML et le JS', () => {
  assert(/id="mini-suggestions"/.test(indexSrc), 'élément #mini-suggestions présent dans index.html');
  assert(/\.mini-suggestions/.test(indexSrc), 'styles CSS .mini-suggestions présents');
  assert(/function renderMiniSuggestions/.test(albertSrc), 'renderMiniSuggestions définie dans albert.js');
  assert(/renderMiniSuggestions\(\);/.test(albertSrc), 'renderMiniSuggestions est bien appelée au chargement');
});

describe('renderMiniSuggestions — comportement (ne plante pas, respecte la limite)', () => {
  const fnMatch = albertSrc.match(/function renderMiniSuggestions\(\)[\s\S]*?\n}\n/);
  assert(!!fnMatch, 'renderMiniSuggestions trouvée');
  if (fnMatch) {
    // #mini-suggestions absent → ne doit pas planter (même pattern que renderSuggestions)
    const fnNoWrap = new Function(
      'document', 'buildDynamicSuggestions', 'SUGGESTIONS',
      `${fnMatch[0]}renderMiniSuggestions();`
    );
    let threw = false;
    try { fnNoWrap({ getElementById: () => null }, () => null, ['a', 'b', 'c']); }
    catch (e) { threw = true; }
    assert(!threw, 'aucune exception si #mini-suggestions est absent du DOM');

    // Avec wrap présent, doit demander max=3 à buildDynamicSuggestions
    let calledWithMax = null;
    const chips = [];
    const fakeWrap = {
      _html: '',
      set innerHTML(v) { this._html = v; },
      get innerHTML() { return this._html; },
      appendChild(c) { chips.push(c); }
    };
    const fnWithWrap = new Function(
      'document', 'buildDynamicSuggestions', 'SUGGESTIONS',
      `${fnMatch[0]}renderMiniSuggestions();`
    );
    fnWithWrap(
      {
        getElementById: (id) => id === 'mini-suggestions' ? fakeWrap : null,
        createElement: () => ({ className: '', textContent: '', title: '', onclick: null })
      },
      (max) => { calledWithMax = max; return ['Q1', 'Q2', 'Q3']; },
      ['fallback1', 'fallback2', 'fallback3']
    );
    assert(calledWithMax === 3, `buildDynamicSuggestions appelée avec max=3 pour rester discret (obtenu : ${calledWithMax})`);
    assert(chips.length === 3, `3 chips ajoutées au DOM (obtenu : ${chips.length})`);
  }
});

console.log(`\n──────────────────────────────────────────────────`);
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed > 0) process.exit(1);
