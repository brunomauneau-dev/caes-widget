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

// ─── Résumé ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed > 0) process.exit(1);
