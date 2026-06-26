// pr21.test.js — Tests PR 2.1 (résolution d'intention filtre vs nouvelle paire)
// node pr21.test.js

// ─── Framework minimal ────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function assert(condition, label) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}`); failed++; }
}
function describe(label, fn) { console.log(`\n${label}`); fn(); }

// ─── Stub normalizeText ───────────────────────────────────────────────────────
function normalizeText(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[''´`]/g, "'").trim();
}

// ─── Code patché extrait ──────────────────────────────────────────────────────
function isPopulationFilterFollowUp(question) {
  const q = normalizeText(question || '');
  const hasCompareMarker = /\bversus\b| vs | comparer?\b|comparaison/.test(q);
  if (hasCompareMarker) return false;
  return /^(et pour|pour les|chez les|parmi les|et chez|et parmi|et les|uniquement les?|seulement les?)\s+(les?\s+)?(non[- ]?boursiers?|boursiers?|non[- ]?basques?|basques?|non[- ]?admis|admis|non[- ]?apprentis?|apprentis?)/.test(q)
    || /^(non[- ]?boursiers?|boursiers?|non[- ]?basques?|basques?|non[- ]?admis|admis|non[- ]?apprentis?|apprentis?)\s*\??$/.test(q);
}

// Simulation du branchement dans inheritConversationContext
function resolveCompareFollowUp(question, prevGroups, prevTargetCol = null) {
  const newGroups = []; // on ne teste pas detectCompareGroups ici
  const groupsDiffer = newGroups.length >= 2 &&
    !newGroups.every(ng => prevGroups.some(pg => pg.label === ng.label));

  if (isPopulationFilterFollowUp(question)) {
    return { resolution: 'filter', tool: prevTargetCol ? 'group_by' : 'count_rows' };
  } else if (groupsDiffer) {
    return { resolution: 'new_pair', tool: 'compare', compareGroups: newGroups };
  } else if (prevGroups.length >= 2) {
    return { resolution: 'inherit_pair', tool: 'compare', compareGroups: prevGroups };
  } else {
    return { resolution: 'fallback', tool: prevTargetCol ? 'group_by' : 'count_rows' };
  }
}

const PREV_GROUPS_ADMIS = [
  { label: 'Admis',     filters: [{ col: 'Répondu favorablement', op: 'eq', value: 'Oui' }] },
  { label: 'Non admis', filters: [{ col: 'Répondu favorablement', op: 'eq', value: 'Non' }] }
];
const PREV_GROUPS_BASQUE = [
  { label: 'Pays Basque',      filters: [{ col: 'Zone du Pays Basque', op: 'eq',  value: 'Oui' }] },
  { label: 'Hors Pays Basque', filters: [{ col: 'Zone du Pays Basque', op: 'neq', value: 'Oui' }] }
];

// ─── Tests isPopulationFilterFollowUp ─────────────────────────────────────────

describe('PR 2.1 — isPopulationFilterFollowUp : détection filtre pur', () => {
  // Formulations qui SONT des filtres de population
  const filterCases = [
    'Et pour les non-boursiers ?',
    'et pour les boursiers',
    'Pour les non-boursiers ?',
    'Chez les boursiers',
    'Parmi les admis',
    'Et les non-admis ?',
    'Uniquement les boursiers',
    'Seulement les non-boursiers',
    'non-boursiers',
    'boursiers ?',
    'Et pour les apprentis ?',
    'non-admis',
  ];
  filterCases.forEach(q => {
    assert(
      isPopulationFilterFollowUp(q) === true,
      `"${q}" → filtre pur (true)`
    );
  });

  // Formulations qui NE SONT PAS des filtres (nouvelles comparaisons)
  const pairCases = [
    'Compare boursiers vs non-boursiers',
    'Comparaison boursiers versus non-boursiers',
    'Comparer admis et non-admis',
    'boursiers vs non-boursiers',
    'Combien de boursiers ?',
    'Répartition par académie',
    'Et pour les CPGE ?',
  ];
  pairCases.forEach(q => {
    assert(
      isPopulationFilterFollowUp(q) === false,
      `"${q}" → pas un filtre pur (false)`
    );
  });
});

// ─── Tests résolution d'intention dans le branchement compare ─────────────────

describe('PR 2.1 — résolution dans inheritConversationContext (compare)', () => {
  assert(
    resolveCompareFollowUp('Et pour les non-boursiers ?', PREV_GROUPS_ADMIS).resolution === 'filter',
    '"Et pour les non-boursiers ?" après admis/non-admis → filtre, pas héritage de paire'
  );

  assert(
    resolveCompareFollowUp('Et pour les non-boursiers ?', PREV_GROUPS_ADMIS).tool === 'count_rows',
    '"Et pour les non-boursiers ?" sans targetCol préc → tool count_rows'
  );

  assert(
    resolveCompareFollowUp('Et pour les non-boursiers ?', PREV_GROUPS_ADMIS, 'Série de la Classe').tool === 'group_by',
    '"Et pour les non-boursiers ?" avec targetCol préc → tool group_by'
  );

  assert(
    resolveCompareFollowUp('Et pour les boursiers ?', PREV_GROUPS_ADMIS).resolution === 'filter',
    '"Et pour les boursiers ?" après admis/non-admis → filtre'
  );

  assert(
    resolveCompareFollowUp('Et pour les non-boursiers ?', PREV_GROUPS_BASQUE).resolution === 'filter',
    '"Et pour les non-boursiers ?" après basque/hors-basque → filtre'
  );

  assert(
    resolveCompareFollowUp('Parmi les admis', PREV_GROUPS_BASQUE).resolution === 'filter',
    '"Parmi les admis" après basque/hors-basque → filtre'
  );

  // Cas sans contexte préalable → pas d'héritage parasite
  assert(
    resolveCompareFollowUp('Et pour les non-boursiers ?', []).resolution === 'filter',
    "Pas de groupes precedents : filtre applique, pas d'heritage parasite"
  );

  // Une vraie nouvelle paire ne doit pas déclencher le filtre
  assert(
    isPopulationFilterFollowUp('Compare boursiers vs non-boursiers') === false,
    '"Compare boursiers vs non-boursiers" → n\'est pas un filtre pur'
  );

  // Régression : "seulement les boursiers" ne doit pas hériter les groupes admis/non-admis
  assert(
    resolveCompareFollowUp('Seulement les boursiers', PREV_GROUPS_ADMIS).resolution === 'filter',
    '"Seulement les boursiers" après admis/non-admis → filtre, pas héritage'
  );
});

// ─── Résumé ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed > 0) process.exit(1);
