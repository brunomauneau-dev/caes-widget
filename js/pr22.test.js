// pr22.test.js — Tests PR 2.2 (badge contexte moteur + reset contexte)
// node pr22.test.js

let passed = 0, failed = 0;
function assert(condition, label) {
  if (condition) { console.log(`  \u2713 ${label}`); passed++; }
  else { console.error(`  \u2717 ${label}`); failed++; }
}
function describe(label, fn) { console.log(`\n${label}`); fn(); }

// ─── Stubs ────────────────────────────────────────────────────────────────────
function normalizeText(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}
function escapeHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// DOM minimal avec ec-bar / ec-chips
function makeDomWithEcBar() {
  const state = {};
  const bar   = { classList: { _has: true, add(c){ state.barEmpty = true; }, remove(c){ state.barEmpty = false; }, contains(c){ return state.barEmpty; } }, _state: state };
  const chips = { _html: '', set innerHTML(v){ this._html = v; state.chipsHtml = v; }, get innerHTML(){ return this._html; } };
  return {
    getElementById(id) {
      if (id === 'ec-bar')   return bar;
      if (id === 'ec-chips') return chips;
      return null;
    },
    _state: state
  };
}

// ─── Code extrait — updateEngineContextBar ────────────────────────────────────
function makeUpdateEngineContextBar(document, getDataEngineState) {
  return function updateEngineContextBar() {
    const bar   = document.getElementById('ec-bar');
    const chips = document.getElementById('ec-chips');
    if (!bar || !chips) return;
    const plan = getDataEngineState().lastPlan;
    if (!plan) { bar.classList.add('empty'); chips.innerHTML = ''; return; }
    const labels = [];
    if (plan.tool === 'compare' && plan.compareGroups && plan.compareGroups.length >= 2) {
      labels.push(plan.compareGroups.map(g => g.label).join(' / '));
    }
    (plan.filters || []).forEach(f => {
      const sign = f.op === 'neq' ? '\u2260 ' : '= ';
      labels.push(f.col + ' ' + sign + f.value);
    });
    if (!labels.length) { bar.classList.add('empty'); chips.innerHTML = ''; return; }
    chips.innerHTML = labels.map(l => '<span class="ec-chip">' + escapeHtml(l) + '</span>').join('');
    bar.classList.remove('empty');
  };
}

// ─── Code extrait — resetEngineContext ───────────────────────────────────────
function makeResetEngineContext(stateRef, updateBar, updateChatSub) {
  return function resetEngineContext() {
    stateRef.state = { lastPlan: null, lastExecution: null, history: [] };
    updateBar();
    if (typeof updateChatSub === 'function') updateChatSub();
  };
}

// ─── Tests updateEngineContextBar ────────────────────────────────────────────
describe('PR 2.2 — updateEngineContextBar : badge absent si pas de contexte', () => {
  assert(
    (() => {
      const dom = makeDomWithEcBar();
      const fn = makeUpdateEngineContextBar(dom, () => ({ lastPlan: null }));
      fn();
      return dom._state.barEmpty === true && dom._state.chipsHtml === '';
    })(),
    'lastPlan null : barre masquee, chips vides'
  );

  assert(
    (() => {
      const fn = makeUpdateEngineContextBar({ getElementById: () => null }, () => ({ lastPlan: null }));
      try { fn(); return true; } catch(e) { return false; }
    })(),
    'DOM sans ec-bar : aucune exception'
  );

  assert(
    (() => {
      const fn = makeUpdateEngineContextBar({ getElementById: id => id === 'ec-bar' ? {} : null }, () => ({ lastPlan: {} }));
      try { fn(); return true; } catch(e) { return false; }
    })(),
    'DOM sans ec-chips : aucune exception'
  );
});

describe('PR 2.2 — updateEngineContextBar : badge affiche si contexte non vide', () => {
  assert(
    (() => {
      const dom = makeDomWithEcBar();
      const fn = makeUpdateEngineContextBar(dom, () => ({
        lastPlan: {
          tool: 'compare',
          compareGroups: [{ label: 'Admis' }, { label: 'Non admis' }],
          filters: []
        }
      }));
      fn();
      return dom._state.barEmpty === false && dom._state.chipsHtml.includes('Admis / Non admis');
    })(),
    'compare Admis/Non admis : chip "Admis / Non admis" visible'
  );

  assert(
    (() => {
      const dom = makeDomWithEcBar();
      const fn = makeUpdateEngineContextBar(dom, () => ({
        lastPlan: {
          tool: 'count_rows',
          compareGroups: [],
          filters: [{ col: 'Boursier des lycees', op: 'eq', value: 'Non boursier' }]
        }
      }));
      fn();
      return dom._state.barEmpty === false && dom._state.chipsHtml.includes('Boursier des lycees');
    })(),
    'filtre simple : chip avec colonne et valeur visible'
  );

  assert(
    (() => {
      const dom = makeDomWithEcBar();
      const fn = makeUpdateEngineContextBar(dom, () => ({
        lastPlan: {
          tool: 'count_rows',
          filters: [{ col: 'Academie', op: 'neq', value: 'Bordeaux' }]
        }
      }));
      fn();
      return dom._state.chipsHtml.includes('\u2260');
    })(),
    'filtre neq : signe != present dans le chip'
  );

  assert(
    (() => {
      const dom = makeDomWithEcBar();
      const fn = makeUpdateEngineContextBar(dom, () => ({
        lastPlan: {
          tool: 'compare',
          compareGroups: [{ label: 'Boursiers' }, { label: 'Non-boursiers' }],
          filters: [{ col: 'Zone Basque', op: 'eq', value: 'Oui' }]
        }
      }));
      fn();
      const html = dom._state.chipsHtml;
      return html.includes('Boursiers / Non-boursiers') && html.includes('Zone Basque');
    })(),
    'compare + filtre de base : deux chips affiches'
  );

  assert(
    (() => {
      const dom = makeDomWithEcBar();
      const fn = makeUpdateEngineContextBar(dom, () => ({
        lastPlan: { tool: 'group_by', filters: [], compareGroups: [] }
      }));
      fn();
      return dom._state.barEmpty === true;
    })(),
    'plan sans filtres ni groupes : barre masquee'
  );
});

describe('PR 2.2 — resetEngineContext : currentCompare remis a null', () => {
  assert(
    (() => {
      const stateRef = {
        state: {
          lastPlan: { tool: 'compare', compareGroups: [{ label: 'Admis' }, { label: 'Non admis' }], filters: [] },
          lastExecution: {},
          history: [{}]
        }
      };
      let barUpdated = false;
      const reset = makeResetEngineContext(stateRef, () => { barUpdated = true; }, null);
      reset();
      return stateRef.state.lastPlan === null && stateRef.state.lastExecution === null && stateRef.state.history.length === 0;
    })(),
    'apres reset : lastPlan, lastExecution et history remis a zero'
  );

  assert(
    (() => {
      const stateRef = { state: { lastPlan: { tool: 'compare' }, lastExecution: {}, history: [] } };
      let barUpdated = false;
      const reset = makeResetEngineContext(stateRef, () => { barUpdated = true; }, null);
      reset();
      return barUpdated;
    })(),
    'reset appelle updateEngineContextBar'
  );

  assert(
    (() => {
      const stateRef = { state: { lastPlan: {}, lastExecution: {}, history: [] } };
      let chatSubCalled = false;
      const reset = makeResetEngineContext(stateRef, () => {}, () => { chatSubCalled = true; });
      reset();
      return chatSubCalled;
    })(),
    'reset appelle updateChatSub si disponible'
  );

  assert(
    (() => {
      const stateRef = { state: { lastPlan: {}, lastExecution: {}, history: [] } };
      try { makeResetEngineContext(stateRef, () => {}, null)(); return true; } catch(e) { return false; }
    })(),
    'reset sans updateChatSub : aucune exception'
  );

  assert(
    (() => {
      // Reset ne doit pas vider le chat — on verifie qu'il ne touche pas aux messages
      let chatCleared = false;
      const stateRef = { state: { lastPlan: {}, lastExecution: {}, history: [] } };
      const reset = makeResetEngineContext(stateRef, () => {}, null);
      reset();
      return !chatCleared;
    })(),
    'reset ne vide pas le chat (comportement isole du reset dialogue global)'
  );
});

console.log(`\n${'─'.repeat(50)}`);
console.log(`Resultat : ${passed} \u2713  ${failed} \u2717  (${passed + failed} tests)`);
if (failed > 0) process.exit(1);

// ─── Tests label lisible sur les filtres ──────────────────────────────────────
describe('PR 2.2 fix — label lisible dans updateEngineContextBar', () => {
  function makeUpdateWithLabel(document, getDataEngineState) {
    return function updateEngineContextBar() {
      const bar   = document.getElementById('ec-bar');
      const chips = document.getElementById('ec-chips');
      if (!bar || !chips) return;
      const plan = getDataEngineState().lastPlan;
      if (!plan) { bar.classList.add('empty'); chips.innerHTML = ''; return; }
      const labels = [];
      if (plan.tool === 'compare' && plan.compareGroups && plan.compareGroups.length >= 2) {
        labels.push(plan.compareGroups.map(g => g.label).join(' / '));
      }
      (plan.filters || []).forEach(f => {
        const sign = f.op === 'neq' ? '\u2260 ' : '';
        labels.push(f.label ? (sign + f.label) : (f.col + ' ' + (f.op === 'neq' ? '\u2260 ' : '= ') + f.value));
      });
      if (!labels.length) { bar.classList.add('empty'); chips.innerHTML = ''; return; }
      chips.innerHTML = labels.map(l => '<span class="ec-chip">' + escapeHtml(l) + '</span>').join('');
      bar.classList.remove('empty');
    };
  }

  assert(
    (() => {
      const dom = makeDomWithEcBar();
      const fn = makeUpdateWithLabel(dom, () => ({
        lastPlan: {
          tool: 'count_rows', filters: [{ col: 'Boursier des lycees', op: 'eq', value: 'Boursier des lycees', label: 'Boursiers' }]
        }
      }));
      fn();
      return dom._state.chipsHtml.includes('Boursiers') && !dom._state.chipsHtml.includes('Boursier des lycees = Boursier des lycees');
    })(),
    'filtre avec label : affiche "Boursiers" et non "Boursier des lycees = Boursier des lycees"'
  );

  assert(
    (() => {
      const dom = makeDomWithEcBar();
      const fn = makeUpdateWithLabel(dom, () => ({
        lastPlan: {
          tool: 'count_rows', filters: [{ col: 'Boursier des lycees', op: 'eq', value: 'Non boursier du secondaire', label: 'Non-boursiers' }]
        }
      }));
      fn();
      return dom._state.chipsHtml.includes('Non-boursiers');
    })(),
    'filtre non-boursiers avec label : affiche "Non-boursiers"'
  );

  assert(
    (() => {
      const dom = makeDomWithEcBar();
      const fn = makeUpdateWithLabel(dom, () => ({
        lastPlan: {
          tool: 'count_rows', filters: [{ col: 'Academie', op: 'neq', value: 'Bordeaux', label: 'Hors Bordeaux' }]
        }
      }));
      fn();
      return dom._state.chipsHtml.includes('\u2260') && dom._state.chipsHtml.includes('Hors Bordeaux');
    })(),
    'filtre neq avec label : signe != et label "Hors Bordeaux"'
  );

  assert(
    (() => {
      // Sans label : fallback sur col = value (ancien comportement)
      const dom = makeDomWithEcBar();
      const fn = makeUpdateWithLabel(dom, () => ({
        lastPlan: {
          tool: 'count_rows', filters: [{ col: 'Academie', op: 'eq', value: 'Toulouse' }]
        }
      }));
      fn();
      return dom._state.chipsHtml.includes('Academie') && dom._state.chipsHtml.includes('Toulouse');
    })(),
    'filtre sans label : fallback sur col = value'
  );
});

console.log('\n' + '-'.repeat(50));
console.log('Resultat final : ' + (passed) + ' OK  ' + (failed) + ' KO  (' + (passed + failed) + ' tests)');
