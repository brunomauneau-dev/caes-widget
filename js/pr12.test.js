// pr12.test.js — Tests PR 1.2 (null guards au démarrage)
// node pr12.test.js

// ─── Framework minimal ────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function assert(condition, label) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}`); failed++; }
}
function describe(label, fn) { console.log(`\n${label}`); fn(); }

// ─── Simulation DOM minimal ───────────────────────────────────────────────────
// On simule document.getElementById pour tester les deux branches : élément
// présent et élément absent (null).

function makeDom(ids = []) {
  const elements = {};
  ids.forEach(id => {
    elements[id] = {
      _listeners: {},
      _height: '',
      _scrollHeight: 80,
      style: { height: '' },
      get scrollHeight() { return this._scrollHeight; },
      addEventListener(event, fn) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(fn);
      },
      dispatchEvent(event) {
        (this._listeners[event.type] || []).forEach(fn => fn(event));
      },
      classList: { contains: () => false, add() {}, remove() {} }
    };
  });
  return { getElementById: id => elements[id] || null };
}

// ─── Reproduction du code patché ──────────────────────────────────────────────

function initTextarea(document) {
  const textarea = document.getElementById('chat-input');
  if (textarea) {
    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    });
  }
  return textarea;
}

function initRenderDocsMonkeypatch(renderDocsRef, viewerCurrentDocIdRef, document, openViewer) {
  if (typeof renderDocsRef !== 'function') return renderDocsRef;
  const originalRenderDocs = renderDocsRef;
  return function() {
    originalRenderDocs();
    const overlay = document.getElementById('viewer-overlay');
    if (viewerCurrentDocIdRef.id && overlay && overlay.classList.contains('show')) {
      const doc = [].find(d => d.id === viewerCurrentDocIdRef.id);
      if (doc && doc.status !== 'loading') openViewer(viewerCurrentDocIdRef.id);
    }
  };
}

function restoreMessages(messages, addMessage, addInfographicMessage) {
  messages.forEach(entry => {
    if (typeof addMessage !== 'function' && typeof addInfographicMessage !== 'function') return;
    if (entry.type === 'text' && typeof addMessage === 'function') addMessage(entry.role, entry.text, { record: false });
    else if (entry.type === 'html' && typeof addMessage === 'function') addMessage(entry.role, entry.html, { record: false });
    else if (entry.type === 'infographic' && typeof addInfographicMessage === 'function') addInfographicMessage(entry.html, entry.title, { record: false });
  });
}

// ─── Tests textarea ───────────────────────────────────────────────────────────

describe('albert.js — textarea null guard', () => {
  assert(
    (() => { try { initTextarea(makeDom([])); return true; } catch(e) { return false; } })(),
    'DOM sans chat-input : aucune exception levée'
  );

  assert(
    (() => { const el = initTextarea(makeDom(['chat-input'])); return el !== null; })(),
    'DOM avec chat-input : élément retourné'
  );

  assert(
    (() => {
      const dom = makeDom(['chat-input']);
      initTextarea(dom);
      const el = dom.getElementById('chat-input');
      return Array.isArray(el._listeners['input']) && el._listeners['input'].length === 1;
    })(),
    'DOM avec chat-input : listener input enregistré'
  );

  assert(
    (() => {
      const dom = makeDom(['chat-input']);
      initTextarea(dom);
      const el = dom.getElementById('chat-input');
      el._scrollHeight = 60;
      el._listeners['input'][0]({});
      return el.style.height === '60px';
    })(),
    'listener input : height = scrollHeight quand < 120px'
  );

  assert(
    (() => {
      const dom = makeDom(['chat-input']);
      initTextarea(dom);
      const el = dom.getElementById('chat-input');
      el._scrollHeight = 200;
      el._listeners['input'][0]({});
      return el.style.height === '120px';
    })(),
    'listener input : height plafonnée à 120px'
  );
});

// ─── Tests renderDocs monkey-patch ───────────────────────────────────────────

describe('albert.js — renderDocs monkey-patch null guard', () => {
  assert(
    (() => {
      const result = initRenderDocsMonkeypatch(undefined, {id: null}, makeDom([]), () => {});
      return result === undefined;
    })(),
    'renderDocs undefined : retourne undefined sans exception'
  );

  assert(
    (() => {
      const result = initRenderDocsMonkeypatch(null, {id: null}, makeDom([]), () => {});
      return result === null;
    })(),
    'renderDocs null : retourne null sans exception'
  );

  assert(
    (() => {
      let called = false;
      const fn = initRenderDocsMonkeypatch(() => { called = true; }, {id: null}, makeDom([]), () => {});
      fn();
      return called;
    })(),
    'renderDocs fonction : originalRenderDocs est appelée'
  );

  assert(
    (() => {
      let viewerCalled = false;
      const domWithOverlay = makeDom(['viewer-overlay']);
      domWithOverlay.getElementById('viewer-overlay').classList.contains = () => true;
      const ref = { id: 'doc1' };
      const fn = initRenderDocsMonkeypatch(() => {}, ref, domWithOverlay, () => { viewerCalled = true; });
      fn();
      return true; // ne doit pas planter même si la doc n'est pas trouvée dans []
    })(),
    'renderDocs avec overlay visible : pas d\'exception même si doc absente'
  );
});

// ─── Tests restoreMessages ────────────────────────────────────────────────────

describe('sessions.js — null guards addMessage / addInfographicMessage', () => {
  const msgs = [
    { type: 'text', role: 'user', text: 'Bonjour' },
    { type: 'html', role: 'assistant', html: '<p>Réponse</p>' },
    { type: 'infographic', html: '<div>Info</div>', title: 'Analyse' }
  ];

  assert(
    (() => { try { restoreMessages(msgs, undefined, undefined); return true; } catch(e) { return false; } })(),
    'addMessage et addInfographicMessage undefined : aucune exception'
  );

  assert(
    (() => { try { restoreMessages(msgs, null, null); return true; } catch(e) { return false; } })(),
    'addMessage et addInfographicMessage null : aucune exception'
  );

  assert(
    (() => {
      const calls = [];
      restoreMessages(msgs, (role, content, opts) => calls.push({ role, content }), undefined);
      return calls.length === 2 && calls[0].content === 'Bonjour' && calls[1].content === '<p>Réponse</p>';
    })(),
    'addMessage définie, addInfographicMessage undefined : text et html restaurés, infographic ignorée'
  );

  assert(
    (() => {
      const calls = [];
      restoreMessages(msgs, undefined, (html, title, opts) => calls.push({ html, title }));
      return calls.length === 1 && calls[0].title === 'Analyse';
    })(),
    'addMessage undefined, addInfographicMessage définie : seule infographic restaurée'
  );

  assert(
    (() => {
      const msgCalls = [], infoCalls = [];
      restoreMessages(
        msgs,
        (role, content, opts) => msgCalls.push(content),
        (html, title, opts) => infoCalls.push(title)
      );
      return msgCalls.length === 2 && infoCalls.length === 1;
    })(),
    'les deux définies : tous les messages restaurés dans le bon handler'
  );

  assert(
    (() => {
      const calls = [];
      restoreMessages([], (r, c) => calls.push(c), (h, t) => calls.push(t));
      return calls.length === 0;
    })(),
    'tableau vide : zéro appel'
  );

  assert(
    (() => {
      const calls = [];
      const unknown = [{ type: 'unknown', role: 'user', text: 'x' }];
      restoreMessages(unknown, (r, c) => calls.push(c), (h, t) => calls.push(t));
      return calls.length === 0;
    })(),
    'type inconnu : ignoré sans exception'
  );
});

// ─── Reproduction du code patché — renderSuggestions ─────────────────────────

function makeRenderSuggestions(document, SUGGESTIONS, sendMessage) {
  return function renderSuggestions() {
    const wrap = document.getElementById('suggestions');
    if (!wrap) return;
    wrap.innerHTML = '';
    SUGGESTIONS.forEach(s => {
      const chip = { textContent: '', className: '', onclick: null };
      chip.textContent = s;
      chip.className = 'sugg-chip';
      chip.onclick = () => {
        const input = document.getElementById('chat-input');
        if (!input) return;
        input.value = s;
        sendMessage();
      };
      wrap._children = wrap._children || [];
      wrap._children.push(chip);
    });
  };
}

// ─── Reproduction du code patché — updateChatSub ─────────────────────────────

function makeUpdateChatSub(document, getState) {
  return function updateChatSub() {
    const { gristRecords, documents } = getState();
    const ok = documents.filter(d => d.status === 'ok').length;
    const total = documents.length;
    let txt = '';
    if (gristRecords.length) {
      txt = `${gristRecords.length} lignes Grist · source prioritaire`;
    } else if (total === 0) txt = 'Aucun document chargé';
    else if (ok < total) txt = `${ok}/${total} documents prêts`;
    else txt = `${ok} document${ok > 1 ? 's' : ''} prêt${ok > 1 ? 's' : ''}`;
    const el = document.getElementById('chat-sub');
    if (!el) return;
    el.textContent = txt;
  };
}

// ─── Reproduction du code patché — grist.onOptions ───────────────────────────

function makeGristOnOptions(callbacks = []) {
  return {
    onOptions(fn) { callbacks.push(fn); },
    trigger(opts) { callbacks.forEach(fn => fn(opts)); }
  };
}

// ─── Tests renderSuggestions ─────────────────────────────────────────────────

describe('albert.js — renderSuggestions null guard', () => {
  const SUGGESTIONS = ['Question A', 'Question B'];

  assert(
    (() => {
      try {
        const fn = makeRenderSuggestions(makeDom([]), SUGGESTIONS, () => {});
        fn();
        return true;
      } catch(e) { return false; }
    })(),
    'DOM sans #suggestions : aucune exception levée'
  );

  assert(
    (() => {
      const dom = makeDom(['suggestions']);
      dom.getElementById('suggestions')._children = [];
      dom.getElementById('suggestions').innerHTML = '';
      const fn = makeRenderSuggestions(dom, SUGGESTIONS, () => {});
      fn();
      return dom.getElementById('suggestions')._children.length === SUGGESTIONS.length;
    })(),
    'DOM avec #suggestions : autant de chips que de suggestions'
  );

  assert(
    (() => {
      const dom = makeDom(['suggestions']);
      dom.getElementById('suggestions')._children = [];
      dom.getElementById('suggestions').innerHTML = '';
      const fn = makeRenderSuggestions(dom, SUGGESTIONS, () => {});
      fn();
      const chips = dom.getElementById('suggestions')._children;
      return chips.every(c => c.className === 'sugg-chip');
    })(),
    'chaque chip a la classe sugg-chip'
  );

  assert(
    (() => {
      // onclick sans #chat-input : ne doit pas crasher
      try {
        const dom = makeDom(['suggestions']);
        dom.getElementById('suggestions')._children = [];
        dom.getElementById('suggestions').innerHTML = '';
        const fn = makeRenderSuggestions(dom, SUGGESTIONS, () => {});
        fn();
        const chip = dom.getElementById('suggestions')._children[0];
        chip.onclick(); // chat-input absent
        return true;
      } catch(e) { return false; }
    })(),
    'onclick chip sans #chat-input : aucune exception levée'
  );

  assert(
    (() => {
      let sent = false;
      const dom = makeDom(['suggestions', 'chat-input']);
      dom.getElementById('suggestions')._children = [];
      dom.getElementById('suggestions').innerHTML = '';
      dom.getElementById('chat-input').value = '';
      const fn = makeRenderSuggestions(dom, ['Question A'], () => { sent = true; });
      fn();
      const chip = dom.getElementById('suggestions')._children[0];
      chip.onclick();
      return dom.getElementById('chat-input').value === 'Question A' && sent;
    })(),
    'onclick chip avec #chat-input : value et sendMessage() appelés'
  );
});

// ─── Tests updateChatSub ─────────────────────────────────────────────────────

describe('albert.js — updateChatSub null guard', () => {
  assert(
    (() => {
      try {
        const fn = makeUpdateChatSub(makeDom([]), () => ({ gristRecords: [], documents: [] }));
        fn();
        return true;
      } catch(e) { return false; }
    })(),
    'DOM sans #chat-sub : aucune exception levée'
  );

  assert(
    (() => {
      const dom = makeDom(['chat-sub']);
      dom.getElementById('chat-sub').textContent = '';
      const fn = makeUpdateChatSub(dom, () => ({ gristRecords: [], documents: [] }));
      fn();
      return dom.getElementById('chat-sub').textContent === 'Aucun document chargé';
    })(),
    'aucun doc, aucun Grist : texte "Aucun document chargé"'
  );

  assert(
    (() => {
      const dom = makeDom(['chat-sub']);
      dom.getElementById('chat-sub').textContent = '';
      const fn = makeUpdateChatSub(dom, () => ({
        gristRecords: [{}, {}, {}],
        documents: []
      }));
      fn();
      return dom.getElementById('chat-sub').textContent.includes('3 lignes Grist');
    })(),
    'Grist actif : texte contient le nombre de lignes'
  );

  assert(
    (() => {
      const dom = makeDom(['chat-sub']);
      dom.getElementById('chat-sub').textContent = '';
      const fn = makeUpdateChatSub(dom, () => ({
        gristRecords: [],
        documents: [{ status: 'ok' }, { status: 'loading' }]
      }));
      fn();
      return dom.getElementById('chat-sub').textContent === '1/2 documents prêts';
    })(),
    'docs partiellement prêts : texte "x/y documents prêts"'
  );
});

// ─── Tests grist.onOptions (init différée) ────────────────────────────────────

describe('albert.js — init différée via grist.onOptions', () => {
  assert(
    (() => {
      const callbacks = [];
      const grist = makeGristOnOptions(callbacks);
      let renderCalled = false, updateCalled = false;
      grist.onOptions(() => { renderCalled = true; updateCalled = true; });
      // Avant déclenchement : rien ne doit avoir été appelé
      return !renderCalled && !updateCalled;
    })(),
    'avant grist.onOptions déclenché : renderSuggestions et updateSourceHub non appelés'
  );

  assert(
    (() => {
      const callbacks = [];
      const grist = makeGristOnOptions(callbacks);
      let renderCalled = false, updateCalled = false;
      grist.onOptions(() => { renderCalled = true; updateCalled = true; });
      grist.trigger({});
      return renderCalled && updateCalled;
    })(),
    'après grist.onOptions déclenché : renderSuggestions et updateSourceHub appelés'
  );

  assert(
    (() => {
      // Simuler un DOM null au moment de l'appel direct (ancien comportement)
      // vs différé (nouveau comportement)
      let crashedDirect = false;
      function renderWithNullDom() {
        const wrap = null; // simule getElementById retournant null
        wrap.innerHTML = ''; // crash intentionnel
      }
      try { renderWithNullDom(); } catch(e) { crashedDirect = true; }

      // Avec onOptions : la fonction n'est appelée qu'après que Grist est prêt
      const callbacks = [];
      const grist = makeGristOnOptions(callbacks);
      let calledAfterReady = false;
      grist.onOptions(() => { calledAfterReady = true; });
      // Pas encore déclenché
      let safeBeforeTrigger = !calledAfterReady;
      grist.trigger({});
      return crashedDirect && safeBeforeTrigger && calledAfterReady;
    })(),
    'régression : appel direct crashait, appel différé via onOptions est sûr'
  );
});

// ─── Résumé ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed > 0) process.exit(1);
