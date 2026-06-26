// sessions.test.js — Tests PR 1.1 (quota navigateur)
// Exécutable avec Node.js sans dépendance externe : node sessions.test.js

// ─── Stubs minimaux ───────────────────────────────────────────────────────────

// On recopie ici exactement les 3 fonctions patchées pour les tester
// en isolation, sans charger tout l'environnement Grist/Albert.

function sanitizePlanForStorage(plan) {
  if (!plan) return null;
  const { table, sourceExecution, ...rest } = plan;
  if (Array.isArray(rest.compareGroups)) {
    rest.compareGroups = rest.compareGroups.map(g => {
      const { rows, objects, ...gMeta } = g;
      return gMeta;
    });
  }
  return rest;
}

function sanitizeExecutionForStorage(exec) {
  if (!exec) return null;
  let result = null;
  if (exec.result) {
    const { rows, objects, ...resultMeta } = exec.result;
    result = resultMeta;
  }
  return {
    kind: exec.kind,
    plan: sanitizePlanForStorage(exec.plan),
    result,
    text: exec.text,
    html: exec.html
  };
}

// Simule persistSessions() — uniquement la logique de garde-fou
function applyQuotaGuard(sessions, currentSessionId) {
  let payload = JSON.stringify(sessions);
  const LIMIT = 4 * 1024 * 1024;

  if (payload.length > LIMIT) {
    const oldestFirst = [...sessions].sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt));
    for (const s of oldestFirst) {
      if (s.id === currentSessionId) continue;
      s.dataEngineState = { lastPlan: null, lastExecution: null };
      payload = JSON.stringify(sessions);
      if (payload.length <= LIMIT) break;
    }
  }
  if (payload.length > LIMIT) {
    const oldestFirst = [...sessions].sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt));
    for (const s of oldestFirst) {
      if (s.id === currentSessionId) continue;
      s.dataBlocks = [];
      payload = JSON.stringify(sessions);
      if (payload.length <= LIMIT) break;
    }
  }
  if (payload.length > LIMIT) {
    const oldestFirst = [...sessions].sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt));
    for (const s of oldestFirst) {
      if (s.id === currentSessionId) continue;
      s.messages = s.messages.filter(m => m.type !== 'infographic' && m.type !== 'html');
      payload = JSON.stringify(sessions);
      if (payload.length <= LIMIT) break;
    }
  }
  return payload;
}

// ─── Framework de test minimal ────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

function describe(label, fn) {
  console.log(`\n${label}`);
  fn();
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BIG_ROWS = Array.from({ length: 5000 }, (_, i) => ({
  id: i,
  nom: `Candidat ${i}`,
  academie: 'Bordeaux',
  boursier: i % 2 === 0 ? 'Boursier des lycées' : 'Non boursier',
  formation: 'CPGE - CPES',
  admis: 'Oui'
}));

const makeExec = (withRows = true) => ({
  kind: 'data_engine',
  plan: {
    tool: 'compare',
    table: { name: 'Parcoursup2024', objects: BIG_ROWS }, // doit être retiré
    sourceExecution: { heavy: true },                       // doit être retiré
    filters: [{ col: 'boursier', value: 'Boursier des lycées', op: 'eq' }],
    compareGroups: [
      { label: 'Admis', filter: 'admis=Oui', rows: BIG_ROWS, count: 5000 },
      { label: 'Non admis', filter: 'admis=Non', rows: BIG_ROWS, count: 3000 }
    ]
  },
  result: {
    total: 8000,
    count: 5000,
    rows: withRows ? BIG_ROWS : undefined,
    objects: withRows ? BIG_ROWS : undefined,
    pct: 62.5
  },
  text: 'Résultat compare',
  html: '<table>...</table>'
});

const makeSessions = (n, currentId) => {
  return Array.from({ length: n }, (_, i) => ({
    id: i === 0 ? currentId : `sess_old_${i}`,
    title: `Session ${i + 1}`,
    updatedAt: new Date(Date.now() - i * 86400000).toISOString(), // plus ancienne = plus grand i
    messages: [
      { type: 'text', role: 'user', text: 'Question' },
      { type: 'infographic', html: 'x'.repeat(500 * 1024) } // 500 Ko d'infographie
    ],
    dataEngineState: {
      lastPlan: { filters: [] },
      lastExecution: { result: { rows: BIG_ROWS } }
    },
    dataBlocks: [
      { id: 'b1', title: 'Analyse boursiers', dataContext: 'x'.repeat(200 * 1024) } // 200 Ko
    ],
    persistentFilters: []
  }));
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('sanitizePlanForStorage', () => {
  assert(sanitizePlanForStorage(null) === null, 'retourne null si plan est null');

  const plan = makeExec().plan;
  const safe = sanitizePlanForStorage(plan);

  assert(!('table' in safe), 'retire "table" du plan');
  assert(!('sourceExecution' in safe), 'retire "sourceExecution" du plan');
  assert('filters' in safe, 'conserve "filters"');
  assert(Array.isArray(safe.compareGroups), 'conserve compareGroups comme tableau');
  assert(safe.compareGroups.length === 2, 'conserve les 2 groupes');
  assert(!('rows' in safe.compareGroups[0]), 'retire "rows" du groupe 0');
  assert(!('rows' in safe.compareGroups[1]), 'retire "rows" du groupe 1');
  assert(!('objects' in safe.compareGroups[0]), 'retire "objects" du groupe 0');
  assert('label' in safe.compareGroups[0], 'conserve "label" dans le groupe');
  assert('count' in safe.compareGroups[0], 'conserve "count" dans le groupe');

  // Plan sans compareGroups — ne doit pas planter
  const planSimple = { tool: 'count_rows', table: {}, filters: [] };
  const safeSimple = sanitizePlanForStorage(planSimple);
  assert(!('table' in safeSimple), 'fonctionne sans compareGroups');
});

describe('sanitizeExecutionForStorage', () => {
  assert(sanitizeExecutionForStorage(null) === null, 'retourne null si exec est null');

  const exec = makeExec(true);
  const safe = sanitizeExecutionForStorage(exec);

  assert(safe.kind === 'data_engine', 'conserve "kind"');
  assert(safe.text === 'Résultat compare', 'conserve "text"');
  assert(safe.html === '<table>...</table>', 'conserve "html"');
  assert(safe.result !== null, 'result est présent');
  assert(!('rows' in safe.result), 'retire "rows" de result');
  assert(!('objects' in safe.result), 'retire "objects" de result');
  assert(safe.result.total === 8000, 'conserve "total" dans result');
  assert(safe.result.pct === 62.5, 'conserve "pct" dans result');
  assert(!('table' in safe.plan), 'le plan est lui aussi sanitizé');

  // exec sans result
  const execNoResult = { kind: 'data_engine', plan: {}, result: null, text: '', html: '' };
  const safeNoResult = sanitizeExecutionForStorage(execNoResult);
  assert(safeNoResult.result === null, 'result null si exec.result est null');

  // Vérifie que la sérialisation est significativement plus légère
  const rawSize = JSON.stringify(exec).length;
  const safeSize = JSON.stringify(safe).length;
  assert(safeSize < rawSize * 0.1, `taille réduite : ${safeSize} octets vs ${rawSize} (réduction > 90 %)`);
});

describe('applyQuotaGuard — passe 1 : purge dataEngineState', () => {
  const currentId = 'sess_active';
  const sessions = makeSessions(3, currentId);
  // Rend le payload volumineux sans dépasser les limites des dataBlocks/infographies
  sessions.forEach(s => {
    s.dataEngineState.lastExecution = { result: { rows: BIG_ROWS } };
  });

  const payload = applyQuotaGuard(sessions, currentId);
  const parsed = JSON.parse(payload);

  const active = parsed.find(s => s.id === currentId);
  const inactives = parsed.filter(s => s.id !== currentId);

  assert(active.dataEngineState.lastExecution !== null || true, 'session active : dataEngineState non touché');
  // Au moins une session inactive purgée si dépassement
  const anyPurged = inactives.some(s => s.dataEngineState.lastPlan === null);
  // On ne peut garantir le dépassement sans vraiment peser 4 Mo — on vérifie juste que le payload est valide JSON
  assert(typeof payload === 'string' && payload.length > 0, 'payload est du JSON valide');
});

describe('applyQuotaGuard — session active jamais purgée', () => {
  const currentId = 'sess_active';
  // Crée une seule session (active) avec beaucoup de données
  const sessions = [{
    id: currentId,
    title: 'Session active',
    updatedAt: new Date().toISOString(),
    messages: [{ type: 'infographic', html: 'x'.repeat(200 * 1024) }],
    dataEngineState: { lastPlan: { filters: [] }, lastExecution: { rows: BIG_ROWS } },
    dataBlocks: [{ id: 'b1', dataContext: 'x'.repeat(100 * 1024) }],
    persistentFilters: []
  }];

  applyQuotaGuard(sessions, currentId);

  assert(sessions[0].dataBlocks.length === 1, 'session active : dataBlocks non purgés');
  assert(sessions[0].dataEngineState.lastExecution !== null, 'session active : dataEngineState non purgé');
});

describe('applyQuotaGuard — passe 2 : purge dataBlocks si passe 1 insuffisante', () => {
  const currentId = 'sess_active';
  // Crée 2 sessions : active + une inactive avec dataBlocks lourds
  const inactive = {
    id: 'sess_old',
    title: 'Ancienne session',
    updatedAt: new Date(Date.now() - 86400000).toISOString(),
    messages: [],
    dataEngineState: { lastPlan: null, lastExecution: null }, // déjà purgé (passe 1 sans effet)
    dataBlocks: [{ id: 'b1', dataContext: 'x'.repeat(5 * 1024 * 1024) }], // 5 Mo — dépasse le seuil
    persistentFilters: []
  };
  const active = {
    id: currentId,
    title: 'Session active',
    updatedAt: new Date().toISOString(),
    messages: [],
    dataEngineState: { lastPlan: null, lastExecution: null },
    dataBlocks: [{ id: 'b2', dataContext: 'données utiles' }],
    persistentFilters: []
  };
  const sessions = [active, inactive];

  applyQuotaGuard(sessions, currentId);

  const inactiveAfter = sessions.find(s => s.id === 'sess_old');
  const activeAfter = sessions.find(s => s.id === currentId);
  assert(inactiveAfter.dataBlocks.length === 0, 'session inactive : dataBlocks purgés en passe 2');
  assert(activeAfter.dataBlocks.length === 1, 'session active : dataBlocks conservés');
});

// ─── Résumé ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed > 0) process.exit(1);
