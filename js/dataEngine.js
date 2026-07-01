/* dataEngine.js — moteur local d'analyse de données.
   Exécute count/group/export sur les lignes brutes Grist/Excel avant appel Albert. */
/* ═══════════════════════ V16 · DATA ENGINE / TOOL CALLING LOCAL ═══════════════════════
   Objectif : Albert ne calcule plus sur un résumé textuel. Le widget exécute
   les opérations analytiques sur les lignes brutes Grist/Excel, puis affiche
   un résultat fiable et traçable. Cette couche est générique : elle manipule
   des lignes, colonnes et filtres, sans dépendre d'un fichier Parcoursup donné. */
const DATA_ENGINE_TOOLS = [
  { name: 'count_rows', description: 'Compter les lignes correspondant à des filtres' },
  { name: 'group_by', description: 'Répartir les lignes filtrées selon une colonne' },
  { name: 'top', description: 'Afficher les principales valeurs d’une colonne' },
  { name: 'pivot', description: 'Croiser deux colonnes sur un sous-ensemble filtré' },
  { name: 'stats', description: 'Calculer moyenne, médiane, min, max sur une colonne numérique' },
  { name: 'export_excel', description: 'Exporter les lignes filtrées en Excel' },
  { name: 'export_csv', description: 'Exporter les lignes filtrées en CSV' },
  { name: 'chart', description: 'Afficher un graphique local à partir du dernier résultat ou d’un group_by' },
  { name: 'compare', description: 'Comparer deux populations ou deux modalités' }
];

// V22 — mémoire d'analyse locale.
// Sert aux demandes de suivi : "par académie", "seulement les boursiers", "graphique", "exporte en Excel".
window.__DATA_ENGINE_STATE = window.__DATA_ENGINE_STATE || { lastPlan: null, lastExecution: null, history: [] };

function getDataEngineState() {
  window.__DATA_ENGINE_STATE = window.__DATA_ENGINE_STATE || { lastPlan: null, lastExecution: null, history: [] };
  return window.__DATA_ENGINE_STATE;
}



// V23.1 — réinitialisation du dialogue et du contexte d'analyse.
// Conserve les documents chargés, la table Grist et la configuration Albert.
function resetCopilotDialogue() {
  const ok = confirm('Réinitialiser le dialogue et le contexte d’analyse ?\n\nLes documents chargés, la table Grist et la configuration Albert seront conservés.');
  if (!ok) return;

  window.__DATA_ENGINE_STATE = { lastPlan: null, lastExecution: null, history: [] };

  try {
    if (typeof chatHistory !== 'undefined') chatHistory.length = 0;
  } catch (e) {
    console.warn('Impossible de vider chatHistory :', e);
  }

  const wrap = document.getElementById('chat-messages');
  if (wrap) {
    wrap.innerHTML = `
      <div class="empty-state" id="empty-state">
        <div class="es-icon">💬</div>
        <div class="es-title">Posez une question sur vos documents</div>
        <div class="es-sub">Dialogue réinitialisé. Les sources chargées restent disponibles ; vous repartez avec un contexte d'analyse vide.</div>
        <div class="suggestions" id="suggestions"></div>
      </div>`;
  }

  const input = document.getElementById('chat-input');
  if (input) {
    input.value = '';
    input.style.height = 'auto';
  }

  const pills = document.getElementById('context-pills');
  if (pills) pills.innerHTML = '';

  if (typeof renderSuggestions === 'function') renderSuggestions();
  if (typeof updateChatSub === 'function') updateChatSub();
  if (typeof updateSourceHub === 'function') updateSourceHub();

  // Reset des filtres persistants
  if (typeof clearAllPersistentFilters === 'function') clearAllPersistentFilters();

  // Vide la session courante en mémoire ET en stockage, pour qu'un
  // changement de session puis retour ne restaure pas les anciens messages.
  const _sess = (typeof getCurrentSession === 'function') ? getCurrentSession() : null;
  if (_sess) {
    _sess.messages = [];
    _sess.chatHistoryData = [];
    _sess.dataEngineState = { lastPlan: null, lastExecution: null };
    _sess.dataBlocks = [];
    _sess.persistentFilters = [];
    _sess.title = 'Nouvelle session';
    if (typeof scheduleSessionsSave === 'function') scheduleSessionsSave();
  }
}
window.resetCopilotDialogue = resetCopilotDialogue;

function isFollowUpQuestion(question) {
  const q = normalizeText(question || '');
  return !!getDataEngineState().lastPlan && (
    /^(par|selon|uniquement|seulement|sauf|hors|avec|sans|graphique|camembert|histogramme|barres?|excel|csv|export|exporte|trie|tri|les boursiers|les non boursiers|visualis|repr[eé]sent|montre|dessine|trace)/.test(q) ||
    isFilterOnlyFollowUp(question)
  );
}

function isChartRequest(question) {
  const q = normalizeText(question || '');
  return /graphique|graphe|diagramme|histogramme|barres?|camembert|chart|visualis|repr[eé]sent|montre-?moi|dessine|trace/.test(q);
}

// v27.5.2 — détecte si la demande de graphique précise explicitement un camembert/pie.
// N'influence aucune regex existante : sert uniquement à choisir le rendu une fois
// que isChartRequest a déjà décidé qu'il fallait un graphique.
function isPieChartRequest(question) {
  const q = normalizeText(question || '');
  return /camembert|pie\b|donut|secteurs?/.test(q);
}

function isExportCurrentRequest(question) {
  const q = normalizeText(question || '');
  return /export|exporte|excel|xlsx|csv|telecharg|t[eé]l[eé]charg/.test(q);
}


function isBareChartRequest(question) {
  const q = normalizeText(question || '');
  return /^(graphique|graphe|diagramme|histogramme|camembert|barres?|chart|fais un graphique|affiche un graphique|visualise|visualise[- ]?moi|montre[- ]?moi [çca]a|dessine|trace un graphique)$/.test(q);
}

function isBareExportRequest(question) {
  const q = normalizeText(question || '');
  return /^(export|exporte|exporte en excel|excel|xlsx|csv|exporte en csv|telecharge|télécharge|telechargement|téléchargement)$/.test(q);
}

function isDimensionOnlyFollowUp(question) {
  const q = normalizeText(question || '');
  return /^(par|selon)\s+/.test(q);
}

function mergeFiltersUnique(base, extra) {
  const out = [];
  [...(base || []), ...(extra || [])].forEach(f => {
    if (!f || !f.col) return;
    const key = `${f.col}::${f.op || 'eq'}::${String(f.value)}`;
    if (!out.some(x => `${x.col}::${x.op || 'eq'}::${String(x.value)}` === key)) out.push(f);
  });
  return out;
}


// V23.3 — contexte strict.
// Principe :
// - une question explicite ("Combien de boursiers ?") repart de zéro ;
// - une commande de suivi ("Par académie", "Seulement les boursiers", "Hors Bordeaux") hérite du contexte ;
// - on ne fusionne jamais les colonnes détectées comme filtres.
function isExplicitFreshDataQuestion(question) {
  const q = normalizeText(question || '');
  if (!q) return false;
  if (!/^(combien|nombre|effectif|total|quelle est|quel est|moyenne|nombre moyen|top|classement|repartition|r[eé]partition|tableau crois[eé]|croise|pivot)/.test(q)) return false;
  // "combien sont-ils ?", "combien y en a-t-il ?" = bare count follow-up → hérite du contexte
  if (/^combien\s+(sont[- ]ils|y\s*(?:en\s+)?a[- ]?t[- ]?il|en tout|au total|maintenant|cela|ca|[cç]a)\s*\??$/.test(q)) return false;
  return true;
}

function isFilterOnlyFollowUp(question) {
  const q = normalizeText(question || '').trim();
  if (/^combien\s+(sont[- ]ils|y\s*(?:en\s+)?a[- ]?t[- ]?il|en tout|au total|maintenant|cela|ca|[cç]a)\s*\??$/.test(q)) return true;
  return /^(seulement|uniquement|avec|sans|sauf|hors|excluant|en excluant|les boursiers|les non boursiers|non boursiers|boursiers|et pour|et les|et chez|parmi les|pour les|chez les|uniquement les|notamment les|en particulier|et parmi)/.test(q);
}

// PR 2.1 — distingue "filtre sur population" vs "nouvelle paire à comparer".
// "Et pour les non-boursiers ?" après un compare admis/non-admis = filtre, pas nouvelle paire.
// "Compare boursiers vs non-boursiers" = nouvelle paire.
// Règle : si la question contient un marqueur de population unique (boursier, basque,
// apprenti, admis) SANS marqueur de comparaison (vs, versus, compare, comparaison),
// c'est un filtre de population pur.
function isPopulationFilterFollowUp(question) {
  const q = normalizeText(question || '');
  const hasCompareMarker = /\bversus\b| vs | comparer?\b|comparaison/.test(q);
  if (hasCompareMarker) return false;
  return /^(et pour|pour les|chez les|parmi les|et chez|et parmi|et les|uniquement les?|seulement les?)\s+(les?\s+)?(non[- ]?boursiers?|boursiers?|non[- ]?basques?|basques?|non[- ]?admis|admis|non[- ]?apprentis?|apprentis?)/.test(q)
    || /^(non[- ]?boursiers?|boursiers?|non[- ]?basques?|basques?|non[- ]?admis|admis|non[- ]?apprentis?|apprentis?)\s*\??$/.test(q);
}

function findColumnByConceptStrict(table, concept) {
  const headers = table?.headers || Object.keys(table?.objects?.[0] || {});
  const scored = headers.map(h => {
    const hn = normalizeText(h);
    let score = 0;
    if (concept === 'boursier' && /boursier/.test(hn)) score += 100;
    if (concept === 'basque' && /pays.*basque|zone.*basque/.test(hn)) score += 100;
    if (concept === 'academie_accueil' && /acad[eé]mie/.test(hn) && /accueil|accept/.test(hn)) score += 100;
    if (concept === 'serie' && /s[eé]rie.*classe|s[eé]rie.*bac/.test(hn)) score += 100;
    if (concept === 'formation_groupe' && /grands?.*groupes?.*formation|groupe.*formation/.test(hn)) score += 100;
    if (concept === 'etablissement_origine' && /[eé]tablissement|lyc[eé]e/.test(hn) && /scolarit[eé]|origine|scolaire/.test(hn)) {
      score += 100;
      if (!/d[eé]partement|commune|code|uai|minist[eè]re|type|contrat|rattachement/.test(hn)) score += 60;
    }
    if (concept === 'etablissement_accueil' && /[eé]tablissement|lyc[eé]e/.test(hn) && /accueil|accept/.test(hn) && !/acad[eé]mie|commune|sp[eé]cialit[eé]|mention|groupe|formation/.test(hn)) score += 100;
    if (concept === 'commune_origine' && /commune/.test(hn) && /scolarit[eé]|origine/.test(hn)) score += 100;
    if (concept === 'commune_accueil' && /commune/.test(hn) && /accueil|accept/.test(hn)) score += 100;
    if (concept === 'departement_origine' && /d[eé]partement/.test(hn) && /scolarit[eé]|origine/.test(hn)) score += 100;
    if (concept === 'apprenti' && /apprenti/.test(hn)) score += 100;
    if (concept === 'nb_voeux' && /nb|nombre|total/.test(hn) && /v[oœ]ux|v[oœ]eu/.test(hn)) score += 100;
    return { h, score };
  }).filter(x => x.score > 0).sort((a,b)=>b.score-a.score);
  return scored[0]?.h || null;
}

function pickColumnValue(table, col, kind) {
  const vals = Array.from(new Set((table?.objects || []).map(r => r?.[col]).filter(v => v !== undefined && v !== null && String(v).trim() !== '').map(v => String(v).trim())));
  const normVals = vals.map(v => ({ raw: v, n: normalizeText(v) }));
  if (kind === 'boursier_oui') {
    return (normVals.find(x => /boursier/.test(x.n) && !/non/.test(x.n)) || normVals.find(x => /^oui$|yes|true|1/.test(x.n)))?.raw || 'Oui';
  }
  if (kind === 'boursier_non') {
    return (normVals.find(x => /non.*boursier|non/.test(x.n)) || normVals.find(x => /^non$|no|false|0/.test(x.n)))?.raw || 'Non';
  }
  if (kind === 'oui') {
    return (normVals.find(x => /^oui$|yes|true|1/.test(x.n)) || normVals.find(x => /oui/.test(x.n)))?.raw || 'oui';
  }
  if (kind === 'non') {
    return (normVals.find(x => /^non$|no|false|0/.test(x.n)) || normVals.find(x => /^non/.test(x.n)))?.raw || 'Non';
  }
  return vals[0];
}

function strictFiltersFromQuestion(table, question) {
  const q = normalizeText(question || '');
  const out = [];
  const add = (col, value, op='eq', label=null) => {
    if (col && value !== undefined && value !== null)
      out.push({ col, value, op, label: label || null });
  };

  if (/pays basque|basque/.test(q) && !/non[- ]?basque|hors.*basque/.test(q)) {
    const col = findColumnByConceptStrict(table, 'basque');
    if (col) add(col, pickColumnValue(table, col, 'oui'), 'eq', 'Pays Basque');
  }
  if (/non[- ]?basque|hors.*basque|hors.*pays.*basque/.test(q)) {
    const col = findColumnByConceptStrict(table, 'basque');
    if (col) add(col, pickColumnValue(table, col, 'oui'), 'neq', 'Hors Pays Basque');
  }
  if (/non[- ]?boursier|sans boursier|hors boursier|exclu.*boursier|en excluant.*boursier/.test(q)) {
    const col = findColumnByConceptStrict(table, 'boursier');
    if (col) add(col, pickColumnValue(table, col, 'boursier_non'), 'eq', 'Non-boursiers');
  } else if (/boursier|bourse/.test(q)) {
    const col = findColumnByConceptStrict(table, 'boursier');
    if (col) add(col, pickColumnValue(table, col, 'boursier_oui'), 'eq', 'Boursiers');
  }
  if (/hors.*bordeaux|sauf.*bordeaux|exclu.*bordeaux|diff[eé]rent.*bordeaux/.test(q)) {
    const col = findColumnByConceptStrict(table, 'academie_accueil');
    if (col) add(col, 'Bordeaux', 'neq', 'Hors Bordeaux');
  }

  // Grands groupes de formation (CPGE, BTS, L1, etc.)
  const formationCol = findColumnByConceptStrict(table, 'formation_groupe');
  if (formationCol) {
    const formVals = [...new Set((table.objects || []).map(r => String(r[formationCol] ?? '')).filter(Boolean))];
    const formMatches = [
      { test: /\bcpge\b|prep[ea]|preparatoire/, pat: /cpge/i },
      { test: /\bbts\b|\bbtsa\b|\bdts\b/, pat: /bts/i },
      { test: /\bbut\b|\bdut\b/, pat: /but|dut/i },
      { test: /\bl1\b|\blicence\b|\bl2\b|\bl3\b/, pat: /^l1|^l2|^l3/i },
      { test: /\bcap\b/, pat: /\bcap\b/i },
    ];
    for (const { test, pat } of formMatches) {
      if (test.test(q) && !out.some(f => f.col === formationCol)) {
        const match = formVals.find(v => pat.test(v));
        if (match) add(formationCol, match, 'eq');
      }
    }
  }

  // Etablissement d\'origine : "venant du/de", "issus du/de", "originaires du/de"
  const _etablPattern = /(?:venant\s+(?:du|de(?:\s+l[ae']?)?)|provenant\s+(?:du|de)|originaires?\s+(?:du|de)|issus?\s+(?:du|de)|qui\s+viennent\s+(?:du|de)|scolaris[eé]e?s?\s+(?:au|[àa]))\s*(?:lyc[eé]e|[eé]tablissement)?\s+([a-zA-ZÀ-ÿ][a-zA-ZÀ-ÿ\s\-']{2,45}?)(?:\s*[?!.]|$)/i;
  const _etablMatch = (question || '').match(_etablPattern);
  if (_etablMatch) {
    const name = _etablMatch[1].trim();
    const origCol = findColumnByConceptStrict(table, 'etablissement_origine');
    if (origCol) {
      const stopWords = new Set(['du','de','des','le','la','les','et','au','aux','en','lycee','etablissement']);
      const nameWords = normalizeText(name).split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
      const vals = [...new Set((table.objects || []).map(r => String(r[origCol] ?? '')).filter(Boolean))];
      const match = nameWords.length ? vals.find(v => nameWords.every(w => normalizeText(v).includes(w))) : null;
      if (match) add(origCol, match, 'eq');
    }
  }

  return out;
}

function replaceConceptFiltersWithStrict(plan, question) {
  if (!plan || !plan.table) return plan;
  const q = normalizeText(question || '');
  const strict = strictFiltersFromQuestion(plan.table, question);
  if (!strict.length) return plan;

  const onlyBoursier = /^(combien|nombre|effectif|total)\s+(de\s+)?(candidats\s+)?(non\s+)?boursiers?\s*\??$/.test(q);
  if (onlyBoursier) {
    plan.filters = strict.filter(f => /boursier/i.test(f.col));
    plan.mentionedCols = Array.from(new Set([...(plan.mentionedCols || []), ...plan.filters.map(f => f.col)]));
    return plan;
  }

  const strictCols = new Set(strict.map(f => f.col));
  const base = (plan.filters || []).filter(f => !strictCols.has(f.col));
  plan.filters = mergeFiltersUnique(base, strict);
  plan.mentionedCols = Array.from(new Set([...(plan.mentionedCols || []), ...strict.map(f => f.col)]));
  return plan;
}

function inheritConversationContext(plan, question) {
  if (!plan) return plan;
  const state = getDataEngineState();
  const prev = state.lastPlan;
  const q = normalizeText(question || '');

  plan = replaceConceptFiltersWithStrict(plan, question);

  if (!prev) {
    if (isChartRequest(question)) {
      plan.renderChart = true;
      plan.chartType = isPieChartRequest(question) ? 'pie' : 'bar';
    }
    return plan;
  }

  const explicitFresh = isExplicitFreshDataQuestion(question) && !/^(et pour|et les|idem|m[eê]me|meme)/.test(q);
  const dimensionFollowUp = isDimensionOnlyFollowUp(question);
  const filterFollowUp = isFilterOnlyFollowUp(question);
  const bareAction = isBareChartRequest(question) || isBareExportRequest(question);

  if (explicitFresh && !dimensionFollowUp && !filterFollowUp && !bareAction) {
    if (isChartRequest(question)) {
      plan.renderChart = true;
      plan.chartType = isPieChartRequest(question) ? 'pie' : 'bar';
    }
    return plan;
  }

  if (dimensionFollowUp || filterFollowUp || bareAction || isFollowUpQuestion(question)) {
    const previousFilters = prev.filters || [];
    const newStrictFilters = strictFiltersFromQuestion(plan.table || prev.table, question);
    const newFilters = (filterFollowUp || dimensionFollowUp || bareAction)
      ? newStrictFilters
      : (plan.filters || []);
    plan.filters = mergeFiltersUnique(previousFilters, newFilters);

    if (dimensionFollowUp) {
      plan.tool = 'group_by';
      if (!plan.targetCol && prev.targetCol) plan.targetCol = prev.targetCol;
    } else if (filterFollowUp) {
      plan.tool = prev.tool || plan.tool;
      if (prev.targetCol)  plan.targetCol  = prev.targetCol;
      if (prev.targetCol2) plan.targetCol2 = prev.targetCol2;
      if (prev.limit)      plan.limit      = prev.limit;
      if (prev.mentionedCols && !plan.mentionedCols?.length) plan.mentionedCols = prev.mentionedCols;
      // Si prev était un compare : vérifier si on a de nouveaux groupes ou hériter les anciens
      if (prev.tool === 'compare') {
        const prevGroups = prev.compareGroups || [];
        const curGroups  = plan.compareGroups || [];
        const groupsDiffer = curGroups.length >= 2 &&
          !curGroups.every(cg => prevGroups.some(pg => pg.label === cg.label));
        if (groupsDiffer) {
          // Nouveaux groupes → les garder, ajouter strict comme filtre de base
          plan.filters = mergeFiltersUnique(prev.filters || [], strictFiltersFromQuestion(plan.table, question));
        } else if (prevGroups.length >= 2) {
          // Même type de comparaison → hériter les groupes + le filtre courant en base
          plan.compareGroups = prevGroups;
          plan.filters = mergeFiltersUnique(prev.filters || [], strictFiltersFromQuestion(plan.table, question));
        }
      } else {
        const _newPlannerFilters = (plan.filters || []).filter(f => !prev.filters?.some(pf => pf.col === f.col));
        plan.filters = mergeFiltersUnique(mergeFiltersUnique(prev.filters || [], strictFiltersFromQuestion(plan.table, question)), _newPlannerFilters);
      }
    }

    if (isChartRequest(question)) {
      plan.renderChart = true;
      plan.chartType = isPieChartRequest(question) ? 'pie' : 'bar';
    }
  } else if (isChartRequest(question)) {
    plan.renderChart = true;
    plan.chartType = isPieChartRequest(question) ? 'pie' : 'bar';
  }
  return plan;
}

function rememberDataEngineExecution(exec) {
  if (!exec || !exec.plan || exec.kind === 'export') return;
  const state = getDataEngineState();
  state.lastPlan = exec.plan;
  state.lastExecution = exec;
  state.history = state.history || [];
  state.history.push({ at: new Date().toISOString(), plan: exec.plan, kind: exec.kind, summary: dataEngineResultToContext(exec).slice(0, 1000) });
  state.history = state.history.slice(-12);
  updateEngineContextBar();
}

// PR 2.2 — badge contexte moteur : affiche les filtres/groupes actifs du lastPlan.
function updateEngineContextBar() {
  const bar   = document.getElementById('ec-bar');
  const chips = document.getElementById('ec-chips');
  if (!bar || !chips) return;

  const plan = getDataEngineState().lastPlan;
  if (!plan) { bar.classList.add('empty'); chips.innerHTML = ''; return; }

  const labels = [];

  // Groupes compare
  if (plan.tool === 'compare' && plan.compareGroups && plan.compareGroups.length >= 2) {
    labels.push(plan.compareGroups.map(g => g.label).join(' / '));
  }

  // Filtres de base
  (plan.filters || []).forEach(f => {
    const sign = f.op === 'neq' ? '\u2260 ' : '';
    labels.push((f.label ? (sign + f.label) : (f.col + ' ' + (f.op === 'neq' ? '\u2260 ' : '= ') + f.value)));
  });

  if (!labels.length) { bar.classList.add('empty'); chips.innerHTML = ''; return; }

  chips.innerHTML = labels.map(l =>
    '<span class="ec-chip">' + escapeHtml(l) + '</span>'
  ).join('');
  bar.classList.remove('empty');
}

// PR 2.2 — reset contexte seul (DATA_ENGINE_STATE) sans vider le chat.
function resetEngineContext() {
  window.__DATA_ENGINE_STATE = { lastPlan: null, lastExecution: null, history: [] };
  updateEngineContextBar();
  if (typeof updateChatSub === 'function') updateChatSub();
}
window.resetEngineContext = resetEngineContext;

// Version silencieuse (sans confirm) utilisée par le bouton Synthèse globale du
// panneau Sources : vide aussi chatHistory pour que le LLM parte de zéro, sans
// l'historique de conversation qui pourrait biaiser la réponse vers un filtre actif.
function resetContextSilent() {
  window.__DATA_ENGINE_STATE = { lastPlan: null, lastExecution: null, history: [] };
  try { if (typeof chatHistory !== 'undefined') chatHistory.length = 0; } catch(e) {}
  // Vider les filtres persistants globaux ET ceux de la session courante
  if (typeof persistentFilters !== 'undefined') persistentFilters.length = 0;
  if (typeof getCurrentSession === 'function') {
    const s = getCurrentSession();
    if (s) s.persistentFilters = [];
  }
  updateEngineContextBar();
  if (typeof updateChatSub === 'function') updateChatSub();
  if (typeof renderPersistentFiltersBar === 'function') renderPersistentFiltersBar();
}
window.resetContextSilent = resetContextSilent;

// PR 3.2 — export image PNG d'un graphique SVG ou d'un bloc HTML de barres.
// Sérialise le nœud DOM ciblé en SVG/Canvas puis déclenche un téléchargement PNG.
function exportChartAsPng(btn, filename) {
  filename = filename || 'graphique.png';
  const card = btn.closest('.de-chart-export-wrap');
  if (!card) return;
  const svgEl = card.querySelector('svg');
  if (svgEl) {
    // Chemin SVG → Canvas → PNG
    const svgStr = new XMLSerializer().serializeToString(svgEl);
    const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = svgEl.viewBox?.baseVal?.width || svgEl.width?.baseVal?.value || 560;
      canvas.height = svgEl.viewBox?.baseVal?.height || svgEl.height?.baseVal?.value || 200;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      const a = document.createElement('a');
      a.download = filename;
      a.href = canvas.toDataURL('image/png');
      a.click();
    };
    img.src = url;
  } else {
    // Chemin barres HTML → Canvas via html2canvas non disponible : fallback SVG généré à la volée
    const bars = card.querySelectorAll('[data-bar-value]');
    if (!bars.length) { alert('Export non disponible pour ce type de graphique.'); return; }
    const W = 600, barH = 24, gap = 8, pad = 12, labelW = 220;
    const H = pad * 2 + bars.length * (barH + gap);
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    bars.forEach((bar, i) => {
      const y = pad + i * (barH + gap);
      const label = bar.dataset.barLabel || '';
      const pct = parseFloat(bar.dataset.barValue) || 0;
      const count = bar.dataset.barCount || '';
      // fond
      ctx.fillStyle = '#f3f4f6';
      ctx.beginPath(); ctx.roundRect(labelW + pad, y, W - labelW - pad * 2, barH, 6); ctx.fill();
      // barre
      ctx.fillStyle = '#6d28d9';
      ctx.beginPath(); ctx.roundRect(labelW + pad, y, Math.max(4, (W - labelW - pad * 2) * pct / 100), barH, 6); ctx.fill();
      // label
      ctx.fillStyle = '#1f2937'; ctx.font = '12px system-ui,sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(label.slice(0, 30), pad, y + barH / 2);
      // count
      ctx.fillStyle = '#374151'; ctx.font = 'bold 11px system-ui,sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(count, W - pad, y + barH / 2);
      ctx.textAlign = 'left';
    });
    const a = document.createElement('a');
    a.download = filename;
    a.href = canvas.toDataURL('image/png');
    a.click();
  }
}

function _chartExportBtn(filename) {
  return `<button onclick="exportChartAsPng(this,'${filename}')" style="margin-top:8px;border:1px solid var(--gris2,#e5e7eb);background:#fff;border-radius:7px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer;color:var(--gris3,#6b7280)" title="Exporter le graphique en PNG">📷 Exporter l'image</button>`;
}

function renderMiniBarChart(rows, total, filename) {
  if (!rows || !rows.length) return '';
  const max = Math.max(...rows.map(r => r.count || 0), 1);
  const bars = rows.slice(0,12).map(r => {
    const w = Math.max(2, Math.round((r.count || 0) / max * 100));
    const pct = total ? ((r.count || 0) / total * 100).toFixed(1) : '0';
    return `<div data-bar-label="${escapeHtml(r.value)}" data-bar-value="${pct}" data-bar-count="${(r.count||0).toLocaleString('fr-FR')}" style="display:grid;grid-template-columns:minmax(120px,220px) 1fr auto;gap:8px;align-items:center"><div style="font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(r.value)}">${escapeHtml(r.value)}</div><div style="height:12px;background:var(--gris1);border-radius:6px;overflow:hidden"><div style="height:12px;width:${w}%;background:var(--albert);border-radius:6px"></div></div><div style="font-size:11px;font-weight:700">${(r.count || 0).toLocaleString('fr-FR')}</div></div>`;
  }).join('');
  return `<div class="de-chart-export-wrap" style="margin:10px 0"><div style="display:grid;gap:6px;max-width:560px">${bars}</div>${_chartExportBtn(filename || 'graphique_barres.png')}</div>`;
}

// v27.5.2 — rendu camembert en SVG inline (aucune dépendance externe).
// N'est appelé qu'à la place de renderMiniBarChart, jamais en plus : zéro impact
// sur les vues qui utilisent déjà les barres.
const DE_PIE_COLORS = ['#2563eb', '#c85b00', '#16a34a', '#7c3aed', '#db2777', '#0891b2', '#ca8a04', '#dc2626', '#4f46e5', '#059669', '#9333ea', '#ea580c'];

function renderMiniPieChart(rows, total) {
  if (!rows || !rows.length) return '';
  const top = rows.slice(0, 12);
  const sum = top.reduce((acc, r) => acc + (r.count || 0), 0);
  if (!sum) return '';

  const cx = 90, cy = 90, r = 80;
  let angleStart = -Math.PI / 2;
  const slices = top.map((row, i) => {
    const value = row.count || 0;
    const fraction = value / sum;
    const angleEnd = angleStart + fraction * Math.PI * 2;
    const x1 = cx + r * Math.cos(angleStart);
    const y1 = cy + r * Math.sin(angleStart);
    const x2 = cx + r * Math.cos(angleEnd);
    const y2 = cy + r * Math.sin(angleEnd);
    const largeArc = (angleEnd - angleStart) > Math.PI ? 1 : 0;
    const color = DE_PIE_COLORS[i % DE_PIE_COLORS.length];
    const path = fraction >= 0.9995
      ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"></circle>`
      : `<path d="M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z" fill="${color}"></path>`;
    angleStart = angleEnd;
    return { path, color, row, fraction };
  });

  const svg = `<svg viewBox="0 0 180 180" width="180" height="180" style="flex:0 0 auto">${slices.map(s => s.path).join('')}</svg>`;
  const legend = `<div style="display:grid;gap:5px;align-content:center">${slices.map(s => {
    const pct = (s.fraction * 100).toFixed(1).replace('.', ',');
    return `<div style="display:flex;align-items:center;gap:7px;font-size:11px"><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${s.color};flex:0 0 auto"></i><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px" title="${escapeHtml(s.row.value)}">${escapeHtml(s.row.value)}</span><strong style="margin-left:auto">${(s.row.count || 0).toLocaleString('fr-FR')} · ${pct} %</strong></div>`;
  }).join('')}</div>`;

  return `<div class="de-chart-export-wrap" style="margin:10px 0"><div style="display:flex;gap:18px;flex-wrap:wrap;align-items:center">${svg}${legend}</div>${_chartExportBtn('graphique_camembert.png')}</div>`;
}


function renderComparePopulationChart(rows, baseTotal) {
  if (!rows || !rows.length) return '';
  const max = Math.max(...rows.map(r => r.count || 0), 1);
  const bars = rows.map(r => {
    const w = Math.max(2, Math.round((r.count || 0) / max * 100));
    const pct = baseTotal ? (r.count || 0) / baseTotal * 100 : (r.pct || 0);
    return `<div data-bar-label="${escapeHtml(r.label)}" data-bar-value="${((r.count||0)/max*100).toFixed(1)}" data-bar-count="${(r.count||0).toLocaleString('fr-FR')}" style="display:grid;grid-template-columns:minmax(120px,220px) 1fr auto;gap:8px;align-items:center"><div style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(r.label)}">${escapeHtml(r.label)}</div><div style="height:14px;background:var(--gris1,#f3f4f6);border-radius:7px;overflow:hidden"><div style="height:14px;width:${w}%;background:var(--albert,#2563eb);border-radius:7px"></div></div><div style="font-size:12px;font-weight:700">${(r.count || 0).toLocaleString('fr-FR')} · ${fmtComparePct(pct)}</div></div>`;
  }).join('');
  return `<div class="de-chart-export-wrap de-chart-card" style="margin:14px 0;padding:12px;border:1px solid var(--gris2,#e5e7eb);border-radius:10px;background:rgba(0,0,0,.02)"><div style="font-weight:700;margin-bottom:8px">Graphique · populations comparées</div><div style="display:grid;gap:7px;max-width:680px">${bars}</div>${_chartExportBtn('comparaison_populations.png')}</div>`;
}

function renderCompareDeltaChart(title, catRows, groupRows, limit = 5) {
  if (!catRows || !catRows.length || !groupRows || groupRows.length < 2) return '';
  const ref = groupRows[0]?.label || 'Groupe 1';
  const other = groupRows[1]?.label || 'Groupe 2';
  const deltas = catRows.map(r => {
    const a = r.groups?.[0]?.pct || 0;
    const b = r.groups?.[1]?.pct || 0;
    return { value: r.value, delta: b - a, a, b };
  }).filter(x => Number.isFinite(x.delta)).sort((a,b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, limit);
  if (!deltas.length) return '';
  const maxAbs = Math.max(...deltas.map(x => Math.abs(x.delta)), 1);
  return `<div class="de-chart-card" style="margin:14px 0;padding:12px;border:1px solid var(--gris2,#e5e7eb);border-radius:10px;background:rgba(0,0,0,.02)"><div style="font-weight:700;margin-bottom:4px">Graphique · écarts ${escapeHtml(title)}</div><div style="font-size:11px;color:var(--gris6,#6b7280);margin-bottom:8px">Écart en points de % : ${escapeHtml(other)} vs ${escapeHtml(ref)}</div><div style="display:grid;gap:7px;max-width:760px">${deltas.map(x => {
    const w = Math.max(2, Math.round(Math.abs(x.delta) / maxAbs * 100));
    const sign = x.delta >= 0 ? '+' : '−';
    const bg = x.delta >= 0 ? 'var(--albert,#2563eb)' : 'var(--orange,#d97706)';
    return `<div style="display:grid;grid-template-columns:minmax(160px,260px) 1fr auto;gap:8px;align-items:center"><div style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(x.value)}">${escapeHtml(x.value)}</div><div style="height:14px;background:var(--gris1,#f3f4f6);border-radius:7px;overflow:hidden"><div style="height:14px;width:${w}%;background:${bg};border-radius:7px"></div></div><div style="font-size:12px;font-weight:700">${sign}${Math.abs(x.delta).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} pt</div></div>`;
  }).join('')}</div></div>`;
}

function renderCompareCharts(plan, result) {
  const rows = result?.rows || [];
  if (!rows.length) return '';
  const cols = getCompareColumns(plan.table);
  const formationRows = compareCategoryRows(rows, cols.formation, 8);
  const academieRows = compareCategoryRows(rows, cols.academie, 8);
  const serieRows = compareCategoryRows(rows, cols.serie, 8);
  const baseTotal = result.baseTotal || rows.reduce((s, r) => s + (r.count || 0), 0);
  const ref = rows[0]?.label || 'Groupe 1';
  const other = rows[1]?.label || 'Groupe 2';
  const legend = `<div class="de-chart-legend" style="display:flex;gap:14px;flex-wrap:wrap;font-size:11px;color:var(--gris6,#6b7280);margin:8px 0 10px"><span><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:var(--albert,#6d28d9);margin-right:5px"></i>avantage ${escapeHtml(other)}</span><span><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:var(--orange,#c85b00);margin-right:5px"></i>avantage ${escapeHtml(ref)}</span></div>`;
  return `${renderComparePopulationChart(rows, baseTotal)}${legend}${renderCompareDeltaChart('formations', formationRows, rows, 5)}${renderCompareDeltaChart('académies', academieRows, rows, 5)}${renderCompareDeltaChart('séries de bac', serieRows, rows, 5)}`;
}

function isDataEngineQuestion(question) {
  const q = normalizeText(question || '');
  if (!q) return false;
  // Exclusion : demandes de synthèse/résumé général → répondre via Albert narratif, pas Data Engine
  if (/^(fais |donne|produis |r[eé]dige )?(une? )?(synth[eè]se|r[eé]sum[eé]|bilan|vue d'ensemble|portrait|analyse globale)/.test(q)) return false;
  return /compare|comparaison|comparer|versus| vs |combien|nombre|effectif|compte|compter|repartition|r[eé]partition|ventilation|par |groupe|group[eé]|top|classement|principa|plus frequen|plus fréquent|croise|crois[eé]|tableau crois[eé]|pivot|moyen|moyenne|median|m[eé]diane|minimum|maximum|min|max|export|excel|csv|liste|filtre|graphique|graphe|diagramme|histogramme|camembert|barres?|boursier|basque|hors|sauf|seulement|uniquement|visualis|repr[eé]sent|montre-?moi|dessine|trace|issus?\s+d[ue]|originaires?|venant\s+d[ue]|provenant|scolaris|scolarit/.test(q) || isFollowUpQuestion(question);
}

function inferMeasureIntent(question) {
  const q = normalizeText(question || '');
  if (/compare|comparaison|comparer|versus| vs /.test(q)) return 'compare';
  if (/graphique|graphe|diagramme|histogramme|camembert|barres?|chart|visualis|repr[eé]sent|montre-?moi|dessine|trace/.test(q)) return 'group_by';
  if (/export|excel|xlsx|csv|telecharg|t[eé]l[eé]charg|sors moi|sort moi|extraire|extrait|liste/.test(q)) {
    return /\bcsv\b/.test(q) ? 'export_csv' : 'export_excel';
  }
  if (/croise|crois[eé]|tableau crois[eé]|pivot|par .* par /.test(q)) return 'pivot';
  // Détection naturelle du croisement : deux dimensions distinctes mentionnées
  // Détection croisement précise : seulement quand les deux dimensions sont explicitement
  // des cibles d'analyse (pas quand l'une est un filtre type "parmi les CPGE").
  // Pattern valide : "répartition des formations par académie", "croise académie et formation"
  const _pivotByPar = q.match(/(?:r[eé]partition|distribution)\s+(?:des?|du|d[''´]|la|le)\s+(.+?)\s+par\s+([a-z\s]{3,40})(?:\s|$)/);
  if (_pivotByPar) {
    const _isF = s => /formation|fili[eè]re|sp[eé]cialit[eé]|bts|but|licence|cpge|pr[eé]pa|dut|l1|grands?\s*groupe/.test(s);
    const _isA = s => /acad[eé]mi/.test(s);
    const _isS = s => /s[eé]rie|bac|type\s+bac/.test(s);
    const d1 = _pivotByPar[1], d2 = _pivotByPar[2];
    if ((_isF(d1) && _isA(d2)) || (_isA(d1) && _isF(d2)) || (_isF(d1) && _isS(d2)) || (_isS(d1) && _isF(d2))) return 'pivot';
  }
  if (/moyen|moyenne|median|m[eé]diane|minimum|maximum|\bmin\b|\bmax\b/.test(q)) return 'stats';
  if (/top|classement|principales?|plus frequentes?|plus fréquentes?|les plus/.test(q)) return 'top';
  if (/repartition|r[eé]partition|ventilation|par |groupe|group[eé]|pourcentage|proportion/.test(q)) return 'group_by';
  if (/combien|nombre|effectif|compte|compter|total/.test(q)) return 'count_rows';
  if (isFollowUpQuestion(question)) return getDataEngineState().lastPlan?.tool || 'count_rows';
  if (isFilterOnlyFollowUp(question) && getDataEngineState().lastPlan) return getDataEngineState().lastPlan.tool || 'count_rows';
  if (/issus?\s+d[ue]|originaires?|venant\s+d[ue]|provenant|scolaris/.test(q)) return 'count_rows';
  return null;
}

function columnMentionScore(col, q) {
  const n = normalizeText(col);
  let score = 0;
  if (q.includes(n)) score += 100;
  const words = n.split(/\s+/).filter(w => w.length >= 4 && !/^(classe|candidat|colonne|valeur|nombre|code)$/.test(w));
  words.forEach(w => { if (q.includes(w)) score += 10; });
  const aliases = [
    [/serie|s[eé]rie|bac general|bac g[eé]n[eé]ral|general|g[eé]n[eé]rale|technologique|professionnel/i, /s[eé]rie|type de bac|classe/i, 45],
    [/basque|pays basque/i, /zone.*pays.*basque|pays.*basque|zone/i, 60],
    [/boursier|bourse/i, /boursier/i, 55],
    [/academie|acad[eé]mie/i, /acad[eé]mie/i, 40],
    [/departement|d[eé]partement/i, /d[eé]partement/i, 40],
    [/formation|fili[eè]re|specialite|sp[eé]cialit[eé]|mention|bts|but|licence|cpge|l1/i, /formation|fili[eè]re|sp[eé]cialit[eé]|mention|groupe/i, 40],
    [/admis|accept|favorable|proposition/i, /favorable|accept|proposition|admission/i, 45],
    [/voeu|vœu|voeux|vœux/i, /voeu|vœu|confirm|class/i, 35],
    [/sexe|femme|homme|feminin|masculin/i, /sexe/i, 40]
  ];
  aliases.forEach(([qre, cre, pts]) => { if (qre.test(q) && cre.test(col)) score += pts; });
  return score;
}

function findMentionedColumns(headers, question, max = 3) {
  const q = normalizeText(question || '');
  return headers
    .filter(h => h && !/^(id|manualSort)$/i.test(String(h)))
    .map(h => ({ col: h, score: columnMentionScore(h, q) }))
    .filter(x => x.score > 0)
    .sort((a,b) => b.score - a.score)
    .slice(0, max)
    .map(x => x.col);
}


function buildCurrentResultPlan(question, table) {
  const state = getDataEngineState();
  const prevExec = state.lastExecution;
  if (!prevExec) return null;
  const q = normalizeText(question || '');
  if (isBareChartRequest(question)) {
    return {
      tool: 'chart_current',
      table: table || prevExec.plan?.table,
      sourceExecution: prevExec,
      question,
      filters: prevExec.plan?.filters || [],
      targetCol: prevExec.plan?.targetCol || null,
      mentionedCols: prevExec.plan?.mentionedCols || [],
      createdAt: new Date().toISOString()
    };
  }
  if (isBareExportRequest(question)) {
    return {
      tool: /\bcsv\b/.test(q) ? 'export_current_csv' : 'export_current_excel',
      table: table || prevExec.plan?.table,
      sourceExecution: prevExec,
      question,
      filters: prevExec.plan?.filters || [],
      targetCol: prevExec.plan?.targetCol || null,
      mentionedCols: prevExec.plan?.mentionedCols || [],
      createdAt: new Date().toISOString()
    };
  }
  return null;
}

function detectDataEnginePlan(question, filterContextText = question) {
  if (!isDataEngineQuestion(question)) return null;
  const tables = getActiveQueryTables();
  if (!tables.length) return null;
  const table = tables[0]; // Grist est déjà prioritaire dans getActiveQueryTables()
  if (!table || !table.objects || !table.objects.length) return null;
  const headers = table.headers || Object.keys(table.objects[0] || {});

  // "Graphique" / "Excel" seuls agissent sur le dernier résultat calculé,
  // pas sur une nouvelle requête replanifiée.
  const currentPlan = buildCurrentResultPlan(question, table);
  if (currentPlan) return currentPlan;

  const tool = inferMeasureIntent(question);
  if (!tool) return null;

  if (tool === 'compare') {
    const groups = detectCompareGroups(table, question);
    if (groups.length >= 2) {
      const baseFilters = strictFiltersFromQuestion(table, question).filter(f => !groups.some(g => (g.filters || []).some(gf => gf.col === f.col)));
      return inheritConversationContext({
        tool: 'compare',
        table,
        filters: baseFilters,
        compareGroups: groups,
        mentionedCols: Array.from(new Set(groups.flatMap(g => (g.filters || []).map(f => f.col)))),
        question,
        createdAt: new Date().toISOString()
      }, question);
    }
  }

  // V17 : le Planner construit d'abord un plan structuré à partir du schéma
  // réel de la table (colonnes + valeurs). Cela évite les oublis du type
  // « bac général » non transformé en Série de la Classe = Générale.
  if (typeof buildPlannerPlan === 'function') {
    // V25.1 — mémoire étanche : le planner ne reçoit plus le contexte textuel
    // précédent pour construire les filtres d'une nouvelle question.
    // Le contexte conversationnel est géré uniquement par inheritConversationContext(),
    // à partir de filtres structurés validés, jamais depuis les résultats calculés
    // (moyenne, médiane, valeur de tableau, etc.).
    const plannerPlan = buildPlannerPlan(question, question, table, tool);
    if (plannerPlan) return inheritConversationContext(plannerPlan, question);
  }

  // Fallback V16 si planner indisponible.
  const q = normalizeText(question || '');
  const mentionedCols = findMentionedColumns(headers, question, 4);
  const targetCol = tool === 'group_by' ? (detectTargetColumn(headers, q) || mentionedCols[0] || null) : null;
  // V25.1 — idem : le fallback ne doit pas analyser le contexte textuel
  // précédent comme s'il s'agissait de la question utilisateur.
  const filters = detectFilters(table, normalizeText(question || ''), targetCol);
  return inheritConversationContext({
    tool,
    table,
    filters,
    targetCol,
    mentionedCols,
    question,
    createdAt: new Date().toISOString()
  }, question);
}


function currentExecutionToRows(exec) {
  if (!exec) return [];
  const p = exec.plan || {};
  if (exec.kind === 'group_by' || exec.kind === 'top') {
    const label = p.targetCol || 'Valeur';
    return (exec.result?.rows || []).map(r => ({
      [label]: r.value,
      Nombre: r.count,
      Pourcentage: Number((r.pct || 0).toFixed(2))
    }));
  }
  if (exec.kind === 'pivot') {
    const rowLabel = exec.result?.rowCol || p.targetCol || 'Ligne';
    const cols = exec.result?.colValues || [];
    return (exec.result?.matrix || []).map(r => {
      const o = { [rowLabel]: r.value };
      cols.forEach((c, i) => { o[c] = r.cells[i] || 0; });
      o.Total = r.total;
      return o;
    });
  }
  if (exec.kind === 'stats') {
    return [{
      Colonne: p.targetCol || '',
      'Valeurs numériques': exec.result?.numericCount ?? '',
      'Total lignes': exec.result?.total ?? '',
      Moyenne: exec.result?.avg ?? '',
      Médiane: exec.result?.median ?? '',
      Min: exec.result?.min ?? '',
      Max: exec.result?.max ?? ''
    }];
  }
  if (exec.kind === 'count') {
    const table = p.table;
    return applyLocalActionFilters(table?.objects || [], p.filters || []);
  }
  if (exec.kind === 'compare') {
    const rows = exec.result?.rows || [];
    const baseTotal = exec.result?.baseTotal || rows.reduce((s, r) => s + (r.count || 0), 0);
    return rows.map(r => ({
      Population: r.label,
      Nombre: r.count,
      'Part de la base (%)': Number((baseTotal ? (r.count || 0) / baseTotal * 100 : (r.pct || 0)).toFixed(2))
    }));
  }
  return [];
}

function buildExportMeta(rows, meta = {}) {
  const dateStr = new Date().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const filtresStr = (meta.filters || []).map(f => `${f.col} ${f.op === 'neq' ? '≠' : '='} "${f.value}"`).join(' ; ') || 'Aucun filtre';
  const perimetreStr = meta.perimetre || 'Ensemble';
  return [`Exporté le : ${dateStr}`, `Filtres : ${filtresStr}`, `Périmètre : ${perimetreStr}`, `Lignes : ${(rows?.length || 0).toLocaleString('fr-FR')}`];
}

function downloadRowsAsFile(rows, filename, format, meta = {}) {
  if (!rows || !rows.length) return { ok: false, html: '<h4>Export impossible</h4><p>Aucune donnée à exporter.</p>' };

  // ── PR 3.1 fix : ligne de métadonnées en tête de fichier ──
  const metaRow = buildExportMeta(rows, meta);

  if (format === 'csv') {
    const ws = XLSX.utils.json_to_sheet(rows);
    const csv = [metaRow.join('\t'), '', XLSX.utils.sheet_to_csv(ws)].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  } else {
    // Construire la feuille avec la ligne de métadonnées au-dessus des données
    const dataSheet = XLSX.utils.json_to_sheet(rows);
    const dataAoa = XLSX.utils.sheet_to_json(dataSheet, { header: 1 });
    const fullAoa = [metaRow, [], ...dataAoa];
    const ws = XLSX.utils.aoa_to_sheet(fullAoa);
    // Style gris clair sur la ligne de métadonnées (compatible Excel)
    ws['!rows'] = [{ hpt: 18 }, { hpt: 6 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Resultat');
    XLSX.writeFile(wb, filename);
  }
  return { ok: true, html: `<h4>Export généré</h4><p>J'ai créé <strong>${escapeHtml(filename)}</strong> avec <strong>${rows.length.toLocaleString('fr-FR')}</strong> ligne${rows.length>1?'s':''}.</p>` };
}

function renderCurrentChartExecution(plan) {
  const prev = plan.sourceExecution;
  if (!prev) return null;
  if (prev.kind === 'compare') {
    const comparePlan = { ...(prev.plan || {}), renderChart: true, chartType: isPieChartRequest(plan.question || '') ? 'pie' : (prev.plan?.chartType || 'bar') };
    const html = `<h4>Graphiques de comparaison</h4>${renderCompareCharts(comparePlan, prev.result || {})}`;
    return { kind: 'compare', plan: comparePlan, result: prev.result, text: prev.text, html };
  }
  if (prev.kind === 'group_by' || prev.kind === 'top') {
    const rows = prev.result?.rows || [];
    const clonedPlan = { ...(prev.plan || {}), renderChart: true, chartType: isPieChartRequest(plan.question || '') ? 'pie' : (prev.plan?.chartType || 'bar') };
    const html = renderDataEngineResultHtml(prev.plan?.tool || prev.kind, clonedPlan, prev.result);
    return { kind: prev.kind, plan: clonedPlan, result: prev.result, text: prev.text, html };
  }
  // Si le dernier résultat n'est pas graphiquable, produire une répartition par la dernière dimension connue.
  const fallbackCol = prev.plan?.targetCol || 'Série de la Classe';
  const rows = applyLocalActionFilters(prev.plan?.table?.objects || [], prev.plan?.filters || []);
  const counts = topCountsForRows(rows, fallbackCol, 30);
  const result = { total: rows.length, filled: counts.filled, distinct: counts.distinct, rows: counts.top.slice(0, 12) };
  const clonedPlan = { ...(prev.plan || {}), tool: 'group_by', targetCol: fallbackCol, renderChart: true, chartType: isPieChartRequest(plan.question || '') ? 'pie' : 'bar' };
  return { kind: 'group_by', plan: clonedPlan, result, text: '', html: renderDataEngineResultHtml('group_by', clonedPlan, result) };
}


// V23.4 — garde-fou final anti-filtres parasites.
// Cette fonction s'exécute juste avant le Data Engine. Elle empêche le planner
// d'entraîner des filtres issus de colonnes détectées ou de valeurs exemples.
function finalSanitizeAnalysisPlan(plan) {
  if (!plan) return plan;
  const q = normalizeText(plan.question || '');
  const state = getDataEngineState();
  const prev = state.lastPlan;
  const table = plan.table || prev?.table;

  const strict = strictFiltersFromQuestion(table, plan.question || '');
  const explicitFresh = isExplicitFreshDataQuestion(plan.question || '') && !/^(et pour|et les|idem|m[eê]me|meme)/.test(q);
  const dimensionFollowUp = isDimensionOnlyFollowUp(plan.question || '');
  const filterFollowUp = isFilterOnlyFollowUp(plan.question || '');
  const bareAction = isBareChartRequest(plan.question || '') || isBareExportRequest(plan.question || '');

  const onlyBoursier = /^(combien|nombre|effectif|total)\s+(de\s+)?(candidats\s+)?(non\s+)?boursiers?\s*\??$/.test(q);

  if (onlyBoursier) {
    plan.filters = strict.filter(f => /boursier/i.test(f.col));
    plan.tool = 'count_rows';
    plan.targetCol = null;
    plan.targetCol2 = null;
    plan.mentionedCols = plan.filters.map(f => f.col);
    return plan;
  }

  // Une question explicite repart de zéro : seuls les filtres explicitement
  // compris dans la question sont conservés. Aucune mémoire n'est fusionnée.
  if (explicitFresh && !dimensionFollowUp && !filterFollowUp && !bareAction) {
    const strictCols = new Set(strict.map(f => f.col));
    const kept = (plan.filters || []).filter(f => {
      if (!f || !f.col) return false;
      if (strictCols.has(f.col)) return false; // remplacés par strict ci-dessous
      const cn = normalizeText(f.col);
      const val = normalizeText(f.value);

      // V25.1 — garde-fou mémoire étanche.
      // Une question explicite ne peut conserver qu'un filtre dont le concept ET
      // la valeur sont réellement présents dans la question utilisateur.
      // Les valeurs calculées précédemment (ex. moyenne/médiane 22) sont exclues.
      if (/voeu|vœu/.test(cn)) {
        if (!/voeu|vœu|voeux|vœux/.test(q)) return false;
        if (/^\d+(?:[,.]\d+)?$/.test(val) && !new RegExp(`(^|\\D)${String(f.value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\D|$)`).test(plan.question || '')) return false;
        return true;
      }
      // Pour chaque type de colonne : retourner true si le concept est dans la question,
      // false sinon (fix v27.5.5 — le return false final supprimait les filtres valides)
      if (/commune/.test(cn)) return /commune|ville/.test(q);
      if (/etablissement|[eé]tablissement/.test(cn)) return /etablissement|[eé]tablissement|iut|universit|lyc[eé]e|cfa/.test(q);
      if (/acad[eé]mie/.test(cn)) return /acad[eé]mie|bordeaux|toulouse|poitiers|limoges|paris|hors|sauf/.test(q);
      if (/boursier/.test(cn)) return /boursier|bourse/.test(q);
      if (/pays.*basque|zone.*basque/.test(cn)) return /basque|pays basque/.test(q);
      if (/s[eé]rie|classe|bac/.test(cn)) return /bac|s[eé]rie|general|professionnel|technologique|stmg|sti2d|st2s|stl|std2a|stav/.test(q);
      if (/formation|groupe|sp[eé]cialit[eé]|mention/.test(cn)) return /formation|but|dut|bts|licence|cpge|prepa|fili[eè]re|sp[eé]cialit[eé]/.test(q);
      return false; // type de colonne non reconnu : exclure par défaut
    });
    plan.filters = mergeFiltersUnique(kept, strict);
    return plan;
  }

  // Les commandes de suivi héritent du contexte précédent, mais uniquement
  // des filtres réellement stockés dans le dernier plan + les nouveaux filtres stricts.
  // On ignore totalement les filtres produits par le planner pour la commande courte.
  if (prev && (dimensionFollowUp || filterFollowUp)) {
    plan.filters = mergeFiltersUnique(prev.filters || [], strict);
    if (dimensionFollowUp) {
      plan.tool = 'group_by';
    }
    if (filterFollowUp) {
      const inheritTool = prev.tool || plan.tool;
      if (inheritTool === 'compare') {
        const newGroups = plan.table ? detectCompareGroups(plan.table, plan.question || '') : [];
        const prevGroups = prev.compareGroups || [];
        // PR 2.1 — filtre de population pur ("Et pour les non-boursiers ?") :
        // pas une nouvelle paire, juste un filtre de base sur la même question.
        // On sort du compare pour répondre sur la population filtrée.
        if (isPopulationFilterFollowUp(plan.question || '')) {
          plan.tool = prev.targetCol ? 'group_by' : 'count_rows';
          if (prev.targetCol)  plan.targetCol  = prev.targetCol;
          if (prev.targetCol2) plan.targetCol2 = prev.targetCol2;
          if (prev.limit)      plan.limit      = prev.limit;
          plan.filters = mergeFiltersUnique([], strict);
        // Si de nouveaux groupes DIFFERENTS sont detectes -> nouvelle comparaison
        } else if (newGroups.length >= 2 &&
          !newGroups.every(ng => prevGroups.some(pg => pg.label === ng.label))) {
          plan.tool = 'compare';
          plan.compareGroups = newGroups;
        } else if (prevGroups.length >= 2) {
          // Heriter les groupes precedents + le filtre courant devient filtre de base commun
          plan.tool = 'compare';
          plan.compareGroups = prevGroups;
          plan.filters = mergeFiltersUnique(prev.filters || [], strict);
        } else {
          plan.tool = prev.targetCol ? 'group_by' : 'count_rows';
          if (prev.targetCol) plan.targetCol = prev.targetCol;
        }
      } else {
        plan.tool = inheritTool;
        if (prev.targetCol)  plan.targetCol  = prev.targetCol;
        if (prev.targetCol2) plan.targetCol2 = prev.targetCol2;
        if (prev.limit)      plan.limit      = prev.limit;
        if (prev.mentionedCols) plan.mentionedCols = prev.mentionedCols;
      }
      // Inclure aussi les filtres détectés par le planner (ex: CPGE)
      const _newPlannerFilters = (plan.filters || []).filter(f =>
        !prev.filters?.some(pf => pf.col === f.col));
      if (_newPlannerFilters.length) {
        plan.filters = mergeFiltersUnique(plan.filters, _newPlannerFilters);
      }
    }
    return plan;
  }

  return plan;
}


// V24 — comparaison de deux populations simples.
function detectCompareGroups(table, question) {
  const q = normalizeText(question || '');
  const groups = [];
  const addGroup = (label, filters) => groups.push({ label, filters: filters.filter(Boolean) });
  const yesNoValue = (col, yes) => pickColumnValue(table, col, yes ? 'oui' : 'non');

  // ── 1. Paires sémantiques hardcodées ──────────────────────────────────────
  if (/basque/.test(q) && /(non[- ]?basque|autres?|reste|hors|compare|versus)/.test(q)) {
    const col = findColumnByConceptStrict(table, 'basque');
    if (col) {
      addGroup('Pays Basque',      [{ col, op: 'eq',  value: yesNoValue(col, true) }]);
      addGroup('Hors Pays Basque', [{ col, op: 'neq', value: yesNoValue(col, true) }]);
      return groups;
    }
  }
  if (/boursier/.test(q) && /(non[- ]?boursier|compare|comparaison|versus| vs )/.test(q)) {
    const col = findColumnByConceptStrict(table, 'boursier');
    if (col) {
      addGroup('Boursiers',    [{ col, op: 'eq', value: pickColumnValue(table, col, 'boursier_oui') }]);
      addGroup('Non-boursiers',[{ col, op: 'eq', value: pickColumnValue(table, col, 'boursier_non') }]);
      return groups;
    }
  }
  if (/admis|r[eé]pondu favorablement|avec proposition/.test(q) &&
      /(non[- ]?admis|sans proposition|refus[eé]|compare|versus)/.test(q)) {
    const col = (table.headers || []).find(h => /r[eé]pondu favorablement|actuellement r[eé]pondu/i.test(h));
    if (col) {
      addGroup('Admis',     [{ col, op: 'eq', value: pickColumnValue(table, col, 'oui') }]);
      addGroup('Non admis', [{ col, op: 'eq', value: pickColumnValue(table, col, 'non') }]);
      return groups;
    }
  }
  if (/apprenti/.test(q) && /(non[- ]?apprenti|compare|versus)/.test(q)) {
    const col = findColumnByConceptStrict(table, 'apprenti');
    if (col) {
      addGroup('Apprentis',    [{ col, op: 'eq', value: yesNoValue(col, true) }]);
      addGroup('Non-apprentis',[{ col, op: 'eq', value: yesNoValue(col, false) }]);
      return groups;
    }
  }

  // ── 2. Formations nommées (CPGE, L1, BTS, BUT, etc.) ─────────────────────
  const formationCol = findColumnByConceptStrict(table, 'formation_groupe');
  if (formationCol) {
    const formVals = [...new Set((table.objects || []).map(r => String(r[formationCol] ?? '')).filter(Boolean))];
    const FORM_KEYS = [
      { re: /\bcpge\b|prep[ea]/, pat: /cpge/i, label: 'CPGE' },
      { re: /\bl1\b|\blicence\b|\bl2\b|\bl3\b/, pat: /^l[123]/i, label: 'L1' },
      { re: /\bbts\b|\bbtsa\b|\bdts\b/, pat: /bts/i, label: 'BTS' },
      { re: /\bbut\b|\bdut\b/, pat: /but|dut/i, label: 'BUT/DUT' },
      { re: /\bcap\b/, pat: /\bcap\b/i, label: 'CAP' },
    ];
    const found = [];
    for (const fk of FORM_KEYS) {
      if (fk.re.test(q)) {
        const match = formVals.find(v => fk.pat.test(v));
        if (match && !found.some(f => f.raw === match)) found.push({ raw: match, label: fk.label });
      }
    }
    if (found.length >= 2) {
      found.slice(0, 2).forEach(f => addGroup(f.raw, [{ col: formationCol, op: 'eq', value: f.raw }]));
      return groups;
    }
  }

  // ── 3. Académies nommées ─────────────────────────────────────────────────
  const acadCol = findColumnByConceptStrict(table, 'academie_accueil');
  if (acadCol) {
    const acadVals = [...new Set((table.objects || []).map(r => String(r[acadCol] ?? '')).filter(Boolean))];
    const mentioned = acadVals.filter(v => {
      const vn = normalizeText(v);
      return vn.length > 2 && q.includes(vn);
    });
    if (mentioned.length >= 2) {
      mentioned.slice(0, 2).forEach(a => addGroup(a, [{ col: acadCol, op: 'eq', value: a }]));
      return groups;
    }
  }

  // ── 4. Deux lycées / établissements nommés ────────────────────────────────────
  const origCol = findColumnByConceptStrict(table, 'etablissement_origine');
  if (origCol) {
    const etabVals = [...new Set((table.objects || []).map(r => String(r[origCol] ?? '')).filter(Boolean))];
    const stopWords = new Set(['du','de','des','le','la','les','et','au','aux','en','lycee','etablissement']);
    const findEtab = frag => {
      const words = normalizeText(frag).split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
      return words.length ? etabVals.find(v => words.every(w => normalizeText(v).includes(w))) : null;
    };

    // Pattern A : "compare le lycée X et le lycée Y" — lycée nommé explicitement
    const lycMatch = question.match(/compare\s+(?:l[ae]s?\s+)?(?:lyc[eé]e|[eé]tablissement)\s+(.+?)\s+(?:et|vs\.?)\s+(?:l[ae]s?\s+)?(?:lyc[eé]e|[eé]tablissement)?\s*(.+?)(?:\s*[?!.]|$)/i);
    if (lycMatch) {
      const mA = findEtab(lycMatch[1]), mB = findEtab(lycMatch[2]);
      if (mA && mB && mA !== mB) {
        addGroup(mA, [{ col: origCol, op: 'eq', value: mA }]);
        addGroup(mB, [{ col: origCol, op: 'eq', value: mB }]);
        return groups;
      }
    }

    // Pattern B : "compare X et Y" — générique (les deux termes matchent des valeurs de la colonne)
    const vsMatch = question.match(/(?:compare[rz]?\s+(?:l[ae]s?\s+)?)(.+?)\s+(?:et|vs\.?|versus)\s+(?:l[ae]s?\s+)?(.+?)(?:\s*[?!.]|$)/i);
    if (vsMatch) {
      const mA = findEtab(vsMatch[1]), mB = findEtab(vsMatch[2]);
      if (mA && mB && mA !== mB) {
        addGroup(mA, [{ col: origCol, op: 'eq', value: mA }]);
        addGroup(mB, [{ col: origCol, op: 'eq', value: mB }]);
        return groups;
      }
    }
  }

  return groups;
}

function compareAxisColumns(groups) {
  const cols = new Set();
  (groups || []).forEach(g => (g.filters || []).forEach(f => {
    if (f && f.col) cols.add(f.col);
  }));
  return cols;
}

function sanitizeCompareCommonFilters(plan, groups) {
  const axisCols = compareAxisColumns(groups);
  const state = getDataEngineState();
  const prev = state.lastPlan;
  const merged = mergeFiltersUnique(prev?.filters || [], plan.filters || []);
  return merged.filter(f => f && f.col && !axisCols.has(f.col));
}

function compareGroupSummary(table, groups, baseFilters) {
  const all = table.objects || [];
  const commonFilters = baseFilters || [];
  const baseRows = applyLocalActionFilters(all, commonFilters);
  const totalBase = baseRows.length;
  return groups.map(g => {
    const filters = mergeFiltersUnique(commonFilters, g.filters || []);
    const rows = applyLocalActionFilters(all, filters);
    const pct = totalBase ? rows.length / totalBase * 100 : 0;
    return { label: g.label, count: rows.length, pct, filters, rows };
  });
}

function firstExistingCompareColumn(table, candidates) {
  const headers = table?.headers || Object.keys(table?.objects?.[0] || {});
  for (const c of candidates) {
    if (c && headers.includes(c)) return c;
  }
  return null;
}

function getCompareColumns(table) {
  const headers = table?.headers || Object.keys(table?.objects?.[0] || {});
  const byRegex = (...patterns) => headers.find(h => {
    const n = normalizeText(h);
    return patterns.every(p => p.test(n));
  });
  return {
    formation: findColumnByConceptStrict(table, 'formation_groupe') || byRegex(/groupes?.*formation/) || byRegex(/formation.*accept/),
    academie: findColumnByConceptStrict(table, 'academie_accueil') || byRegex(/acad[eé]mie/, /accueil|accept/),
    serie: findColumnByConceptStrict(table, 'serie') || byRegex(/s[eé]rie/, /classe|bac/),
    voeux: inferNumericStatsColumn(table, 'nombre moyen de voeux confirmés') || byRegex(/voeux|vœux/, /confirm/)
  };
}

function topCountsForSpecificRows(rows, col, limit = 8) {
  if (!col) return [];
  const map = new Map();
  let filled = 0;
  (rows || []).forEach(r => {
    const raw = r?.[col];
    const v = raw === undefined || raw === null || String(raw).trim() === '' ? '' : String(raw).trim();
    if (!v) return;
    filled += 1;
    map.set(v, (map.get(v) || 0) + 1);
  });
  return [...map.entries()]
    .map(([value, count]) => ({ value, count, pct: filled ? count / filled * 100 : 0 }))
    .sort((a,b) => b.count - a.count)
    .slice(0, limit);
}

function compareCategoryRows(groupRows, col, limit = 8) {
  if (!col || !groupRows?.length) return [];
  const valueOrder = [];
  const perGroup = groupRows.map(g => {
    const top = topCountsForSpecificRows(g.rows || [], col, limit);
    top.forEach(x => { if (!valueOrder.includes(x.value)) valueOrder.push(x.value); });
    return { label: g.label, total: g.rows?.length || 0, top };
  });
  const values = valueOrder.slice(0, limit);
  return values.map(value => {
    const row = { value, groups: [] };
    perGroup.forEach(g => {
      const hit = g.top.find(x => x.value === value);
      const count = hit ? hit.count : 0;
      const pct = hit ? hit.pct : 0;
      row.groups.push({ label: g.label, count, pct });
    });
    return row;
  });
}

function compareNumericStatsRows(groupRows, col) {
  if (!col || !groupRows?.length) return [];
  return groupRows.map(g => {
    const st = numericStats(g.rows || [], col);
    return { label: g.label, ...st };
  });
}


// V24.7 — formatage lisible + points clés calculés localement.
function fmtCompareNumber(v, decimals = 2) {
  if (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) return '—';
  return Number(v).toLocaleString('fr-FR', { maximumFractionDigits: decimals });
}

function fmtComparePct(v, decimals = 1) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
  return `${Number(v).toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} %`;
}

function strongestCompareDifferences(catRows, groupRows, title, limit = 2) {
  if (!catRows?.length || !groupRows?.length || groupRows.length < 2) return [];
  const a = groupRows[0]?.label || 'Population 1';
  const b = groupRows[1]?.label || 'Population 2';
  return catRows.map(r => {
    const g1 = r.groups?.[0] || { pct: 0 };
    const g2 = r.groups?.[1] || { pct: 0 };
    const delta = (g1.pct || 0) - (g2.pct || 0);
    return { title, value: r.value, a, b, aPct: g1.pct || 0, bPct: g2.pct || 0, delta };
  }).filter(x => Math.abs(x.delta) >= 1.0)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
    .slice(0, limit);
}

function renderCompareInsights(groupRows, sections, statsRows) {
  const insights = [];

  function sentenceFor(sectionTitle, d) {
    const leader = d.delta >= 0 ? d.a : d.b;
    const other = d.delta >= 0 ? d.b : d.a;
    const leaderPct = d.delta >= 0 ? d.aPct : d.bPct;
    const otherPct = d.delta >= 0 ? d.bPct : d.aPct;
    const deltaAbs = Math.abs(d.delta);
    const label = escapeHtml(d.value);
    const lead = escapeHtml(leader);
    const oth = escapeHtml(other);
    const lp = fmtComparePct(leaderPct);
    const op = fmtComparePct(otherPct);
    const dp = fmtCompareNumber(deltaAbs, 1);

    if (/formation|groupe/i.test(sectionTitle)) {
      return `${lead} s’orientent davantage vers « ${label} » (${lp} contre ${op} pour ${oth}, soit +${dp} pts).`;
    }
    if (/acad/i.test(sectionTitle)) {
      return `${lead} sont plus souvent accueillis dans « ${label} » (${lp} contre ${op} pour ${oth}, soit +${dp} pts).`;
    }
    if (/série|serie|bac/i.test(sectionTitle)) {
      return `${lead} sont plus représentés en « ${label} » (${lp} contre ${op} pour ${oth}, soit +${dp} pts).`;
    }
    return `${lead} sont davantage représentés dans « ${label} » (${lp} contre ${op} pour ${oth}, soit +${dp} pts).`;
  }

  (sections || []).forEach(sec => {
    strongestCompareDifferences(sec.rows, groupRows, sec.title, 2).forEach(d => {
      insights.push(sentenceFor(sec.title, d));
    });
  });

  if (statsRows?.length >= 2) {
    const a = statsRows[0];
    const b = statsRows[1];
    if (Number.isFinite(Number(a.avg)) && Number.isFinite(Number(b.avg))) {
      const delta = Number(a.avg) - Number(b.avg);
      const leader = delta >= 0 ? a : b;
      const other = delta >= 0 ? b : a;
      insights.push(`${escapeHtml(leader.label)} formulent en moyenne ${fmtCompareNumber(leader.avg, 2)} vœux confirmés, contre ${fmtCompareNumber(other.avg, 2)} pour ${escapeHtml(other.label)}.`);
    }
  }

  if (!insights.length) return '';
  const shown = insights.slice(0, 4);
  const paragraph = shown.join(' ');
  return `<section class="de-section de-insights" style="margin:16px 0;padding:14px 16px;border:1px solid var(--gris2,#e5e7eb);border-radius:12px;background:#fff"><h5 style="margin:0 0 8px;font-size:14px">Synthèse automatique</h5><p style="margin:0;line-height:1.65;font-size:13px">${paragraph}</p></section>`;
}

function renderCompareCategoryTable(title, col, catRows, groupRows) {
  if (!col || !catRows?.length) return '';
  const head = groupRows.map(g => `<th colspan="2" style="text-align:center;padding:8px 10px;border-bottom:1px solid var(--gris2,#e5e7eb)">${escapeHtml(g.label)}</th>`).join('');
  const sub = groupRows.map(() => '<th style="text-align:right;padding:6px 10px;border-bottom:1px solid var(--gris2,#e5e7eb);color:var(--gris6,#6b7280)">n</th><th style="text-align:right;padding:6px 10px;border-bottom:1px solid var(--gris2,#e5e7eb);color:var(--gris6,#6b7280)">%</th>').join('');
  const body = catRows.map(r => `<tr><td style="padding:7px 10px;border-bottom:1px solid var(--gris1,#f3f4f6);max-width:320px">${escapeHtml(r.value)}</td>${r.groups.map(g => `<td style="text-align:right;padding:7px 10px;border-bottom:1px solid var(--gris1,#f3f4f6);white-space:nowrap">${g.count.toLocaleString('fr-FR')}</td><td style="text-align:right;padding:7px 10px;border-bottom:1px solid var(--gris1,#f3f4f6);white-space:nowrap">${fmtComparePct(g.pct)}</td>`).join('')}</tr>`).join('');
  return `<section style="margin:12px 0"><h5 style="margin:0 0 6px;font-size:13px">${escapeHtml(title)}</h5><div style="overflow:auto"><table style="border-collapse:separate;border-spacing:0;width:100%;font-size:12px;min-width:560px;background:#fff"><tbody><tr><th style="text-align:left;padding:8px 10px;border-bottom:1px solid var(--gris2,#e5e7eb)">${escapeHtml(title)}</th>${head}</tr><tr><th style="border-bottom:1px solid var(--gris2,#e5e7eb)"></th>${sub}</tr>${body}</tbody></table></div></section>`;
}

function renderCompareStatsTable(col, statsRows) {
  if (!col || !statsRows?.length) return '';
  const rows = statsRows.map(r => `<tr><td style="padding:8px 10px;border-bottom:1px solid var(--gris1,#f3f4f6)">${escapeHtml(r.label)}</td><td style="text-align:right;padding:8px 10px;border-bottom:1px solid var(--gris1,#f3f4f6)">${(r.numericCount || 0).toLocaleString('fr-FR')}</td><td style="text-align:right;padding:8px 10px;border-bottom:1px solid var(--gris1,#f3f4f6)"><strong>${fmtCompareNumber(r.avg, 2)}</strong></td><td style="text-align:right;padding:8px 10px;border-bottom:1px solid var(--gris1,#f3f4f6)">${fmtCompareNumber(r.median, 2)}</td><td style="text-align:right;padding:8px 10px;border-bottom:1px solid var(--gris1,#f3f4f6)">${fmtCompareNumber(r.min, 2)}</td><td style="text-align:right;padding:8px 10px;border-bottom:1px solid var(--gris1,#f3f4f6)">${fmtCompareNumber(r.max, 2)}</td></tr>`).join('');
  return `<section class="de-section de-stats" style="margin:14px 0;padding:12px;border:1px solid var(--gris2,#e5e7eb);border-radius:10px;background:#fff"><h5 style="margin:0 0 4px;font-size:14px">Vœux confirmés</h5><p style="font-size:12px;margin:0 0 8px;color:var(--gris6,#6b7280)">Colonne : ${escapeHtml(col)}</p><div style="overflow:auto"><table style="border-collapse:separate;border-spacing:0;width:100%;font-size:12px;min-width:520px"><tbody><tr><th style="text-align:left;padding:8px 10px;border-bottom:1px solid var(--gris2,#e5e7eb)">Population</th><th style="text-align:right;padding:8px 10px;border-bottom:1px solid var(--gris2,#e5e7eb)">Valeurs num.</th><th style="text-align:right;padding:8px 10px;border-bottom:1px solid var(--gris2,#e5e7eb)">Moyenne</th><th style="text-align:right;padding:8px 10px;border-bottom:1px solid var(--gris2,#e5e7eb)">Médiane</th><th style="text-align:right;padding:8px 10px;border-bottom:1px solid var(--gris2,#e5e7eb)">Min</th><th style="text-align:right;padding:8px 10px;border-bottom:1px solid var(--gris2,#e5e7eb)">Max</th></tr>${rows}</tbody></table></div></section>`;
}

function renderCompareHtml(plan, result) {
  const filtersHtml = (plan.filters || []).length
    ? `<div style="margin:10px 0"><strong>Filtres communs</strong><ul style="margin:6px 0 0;padding-left:18px">${plan.filters.map(f => `<li>${escapeHtml(f.col)} ${f.op === 'neq' ? '≠' : '='} <strong>${escapeHtml(f.label || f.value)}</strong></li>`).join('')}</ul></div>`
    : '<p style="margin:10px 0"><strong>Filtres communs</strong> : aucun.</p>';
  const rows = result.rows || [];
  const baseTotal = result.baseTotal || rows.reduce((s, r) => s + (r.count || 0), 0);
  const groupedTotal = rows.reduce((s, r) => s + (r.count || 0), 0);
  const missing = Math.max(0, baseTotal - groupedTotal);
  const tableRows = rows.map(r => `<tr><td style="padding:7px 10px;border-bottom:1px solid var(--gris1,#f3f4f6)">${escapeHtml(r.label)}</td><td style="text-align:right;padding:7px 10px;border-bottom:1px solid var(--gris1,#f3f4f6)"><strong>${r.count.toLocaleString('fr-FR')}</strong></td><td style="text-align:right;padding:7px 10px;border-bottom:1px solid var(--gris1,#f3f4f6)">${fmtComparePct(r.pct)}</td></tr>`).join('');
  const missingNote = missing ? `<p style="font-size:12px;color:var(--gris6,#6b7280);margin:8px 0 0">Autres / non renseignés hors groupes comparés : <strong>${missing.toLocaleString('fr-FR')}</strong> ligne${missing>1?'s':''} (${fmtComparePct(baseTotal ? missing / baseTotal * 100 : 0)}).</p>` : '';
  const cols = getCompareColumns(plan.table);
  const formationRows = compareCategoryRows(rows, cols.formation, 8);
  const academieRows = compareCategoryRows(rows, cols.academie, 8);
  const serieRows = compareCategoryRows(rows, cols.serie, 8);
  const statsRows = compareNumericStatsRows(rows, cols.voeux);
  const insights = renderCompareInsights(rows, [
    { title: 'grands groupes de formation', rows: formationRows },
    { title: 'académie d’accueil', rows: academieRows },
    { title: 'série de bac', rows: serieRows }
  ], statsRows);
  const formationTable = renderCompareCategoryTable('Grands groupes de formation', cols.formation, formationRows, rows);
  const academieTable = renderCompareCategoryTable('Académie d’accueil', cols.academie, academieRows, rows);
  const serieTable = renderCompareCategoryTable('Série de bac', cols.serie, serieRows, rows);
  const statsTable = renderCompareStatsTable(cols.voeux, statsRows);
  const charts = plan.renderChart ? `<section class="de-section de-charts" style="margin:14px 0">${renderCompareCharts(plan, result)}</section>` : '';
  const detailsTables = `<details class="de-detail-tables" style="margin:16px 0;border:1px solid var(--gris2,#e5e7eb);border-radius:12px;background:#fff"><summary style="cursor:pointer;font-weight:800;padding:12px 14px">Afficher les tableaux détaillés</summary><div style="padding:0 14px 14px">${formationTable}${academieTable}${serieTable}</div></details>`;
  const debug = `<details class="msg-sources"><summary title="Détail technique du calcul (pour vérification ou support) — sans impact sur le résultat affiché ci-dessus">Plan Data Engine</summary><div style="font-size:10px;line-height:1.5;margin-top:5px"><strong>Outil</strong> : compare<br><strong>Version</strong> : v27.6.0<br><strong>Source</strong> : ${escapeHtml(plan.table?.source || 'Données')} · ${escapeHtml(plan.table?.name || 'table')}<br><strong>Groupes</strong> : ${escapeHtml(rows.map(r => r.label).join(' / ') || '—')}</div></details>`;
  const clearTitle = (typeof extractBlockTitle === 'function') ? extractBlockTitle({ plan, result }, '') : 'Comparaison';
  return `${deTitleHtml(clearTitle)}<p>Base comparée : <strong>${baseTotal.toLocaleString('fr-FR')}</strong> lignes.</p><section class="de-section de-population" style="margin:12px 0;padding:12px;border:1px solid var(--gris2,#e5e7eb);border-radius:10px;background:#fff"><div style="overflow:auto"><table style="border-collapse:separate;border-spacing:0;width:100%;font-size:12px;min-width:360px"><tbody><tr><th style="text-align:left;padding:7px 10px;border-bottom:1px solid var(--gris2,#e5e7eb)">Population</th><th style="text-align:right;padding:7px 10px;border-bottom:1px solid var(--gris2,#e5e7eb)">Nombre</th><th style="text-align:right;padding:7px 10px;border-bottom:1px solid var(--gris2,#e5e7eb)">Part</th></tr>${tableRows}</tbody></table></div>${missingNote}</section>${filtersHtml}${insights}${charts}${statsTable}${detailsTables}${debug}`;
}

function runDataEnginePlan(plan, persistentFiltersOverride) {
  plan = finalSanitizeAnalysisPlan(plan);
  if (!plan || !plan.table) return null;
  // Re-injection des filtres persistants APRES le sanitize.
  // Comparaison par COLONNE uniquement (pas par {col,op,value}) pour éviter
  // d'ajouter "Zone = oui" quand la question a explicitement posé "Zone ≠ oui".
  const _pf = persistentFiltersOverride || (typeof persistentFilters !== 'undefined' ? persistentFilters : []);
  if (_pf && _pf.length &&
      plan.tool !== 'chart_current' &&
      plan.tool !== 'export_current_excel' &&
      plan.tool !== 'export_current_csv') {
    const existingCols = new Set((plan.filters || []).map(f => f.col));
    const toAdd = _pf.filter(f => !existingCols.has(f.col));
    if (toAdd.length) plan.filters = [...(plan.filters || []), ...toAdd];
  }
  if (plan.tool === 'compare') {
    const groups = plan.compareGroups || detectCompareGroups(plan.table, plan.question);
    if (!groups || groups.length < 2) return null;
    const commonFilters = sanitizeCompareCommonFilters(plan, groups);
    const comparePlan = { ...plan, filters: commonFilters, compareGroups: groups };
    const rows = compareGroupSummary(plan.table, groups, commonFilters);
    const baseTotal = applyLocalActionFilters(plan.table.objects || [], commonFilters).length;
    let _compareHtml;
    try { _compareHtml = renderCompareHtml(comparePlan, { rows, baseTotal }); }
    catch(e) { console.error('[RUN compare] renderCompareHtml THREW:', e); return null; }
    const exec = { kind: 'compare', plan: comparePlan, result: { rows, baseTotal }, text: rows.map(r => `${r.label}: ${r.count}`).join('\n'), html: _compareHtml };
    rememberDataEngineExecution(exec);
    return exec;
  }
  if (plan.tool === 'chart_current') {
    const exec = renderCurrentChartExecution(plan);
    if (exec) rememberDataEngineExecution(exec);
    return exec;
  }
  if (plan.tool === 'export_current_excel' || plan.tool === 'export_current_csv') {
    const prev = plan.sourceExecution || getDataEngineState().lastExecution;
    const rows = currentExecutionToRows(prev);
    const format = plan.tool === 'export_current_csv' ? 'csv' : 'xlsx';
    const filename = format === 'csv' ? 'resultat_analyse.csv' : 'resultat_analyse.xlsx';
    // PR 3.1 fix : construire les métadonnées depuis le plan source
    const prevFilters = (prev?.plan?.filters || []);
    const perimetreStr = prevFilters.length
      ? prevFilters.map(f => `${f.col} ${f.op === 'neq' ? '≠' : '='} "${f.value}"`).join(' ; ')
      : 'Ensemble';
    const meta = { filters: prevFilters, perimetre: perimetreStr };
    const res = downloadRowsAsFile(rows, filename, format, meta);
    return { kind: 'export', plan, result: res, html: res.html };
  }
  if (plan.tool === 'export_excel' || plan.tool === 'export_csv') {
    const action = {
      tool: plan.tool,
      table: plan.table,
      filters: plan.filters || [],
      filename: guessExportFilename(plan.question, plan.tool === 'export_csv' ? 'csv' : 'xlsx')
    };
    const res = executeLocalAction(action);
    return { kind: 'export', plan, action, result: res, html: res?.html || '' };
  }
  const rows = applyLocalActionFilters(plan.table.objects || [], plan.filters || []);
  if (plan.tool === 'count_rows') {
    const exec = {
      kind: 'count',
      plan,
      result: { count: rows.length, total: (plan.table.objects || []).length },
      text: `COUNT_ROWS = ${rows.length}`,
      html: renderDataEngineResultHtml('count_rows', plan, { count: rows.length, total: (plan.table.objects || []).length })
    };
    rememberDataEngineExecution(exec);
    return exec;
  }
  if (plan.tool === 'group_by' || plan.tool === 'top') {
    const col = plan.targetCol || plan.mentionedCols?.[0];
    if (!col) return null;
    const limit = plan.limit || detectLimit(plan.question) || (plan.tool === 'top' ? 10 : 30);
    const counts = topCountsForRows(rows, col, Math.max(limit, 30));
    const topRows = counts.top.slice(0, limit);
    const exec = {
      kind: plan.tool,
      plan: { ...plan, targetCol: col, limit },
      result: { total: rows.length, filled: counts.filled, distinct: counts.distinct, rows: topRows },
      text: topRows.map(x => `${x.value}: ${x.count} (${x.pct.toFixed(1)}%)`).join('\n'),
      html: renderDataEngineResultHtml(plan.tool, { ...plan, targetCol: col, limit }, { total: rows.length, filled: counts.filled, distinct: counts.distinct, rows: topRows })
    };
    rememberDataEngineExecution(exec);
    return exec;
  }
  if (plan.tool === 'pivot') {
    const rowCol = plan.targetCol || plan.mentionedCols?.[0];
    const colCol = plan.targetCol2 || plan.mentionedCols?.find(c => c !== rowCol);
    if (!rowCol || !colCol) return null;
    const pivot = pivotRows(rows, rowCol, colCol, 12, 8);
    const exec = {
      kind: 'pivot',
      plan: { ...plan, targetCol: rowCol, targetCol2: colCol },
      result: pivot,
      text: `Pivot ${rowCol} × ${colCol}`,
      html: renderDataEngineResultHtml('pivot', { ...plan, targetCol: rowCol, targetCol2: colCol }, pivot)
    };
    rememberDataEngineExecution(exec);
    return exec;
  }
  if (plan.tool === 'stats') {
    const inferredStatsCol = inferNumericStatsColumn(plan.table, plan.question);
    const col = inferredStatsCol || plan.targetCol || plan.mentionedCols?.[0];
    if (!col) return null;
    const stats = numericStats(rows, col);
    const exec = {
      kind: 'stats',
      plan: { ...plan, targetCol: col },
      result: stats,
      text: `Stats ${col}: moyenne ${stats.avg}`,
      html: renderDataEngineResultHtml('stats', { ...plan, targetCol: col }, stats)
    };
    rememberDataEngineExecution(exec);
    return exec;
  }
  return null;
}

function detectLimit(question) {
  const q = String(question || '').toLowerCase();
  const m = q.match(/(?:top|classement|premiers?|premières?)\s+(\d{1,3})|(?:les|des)\s+(\d{1,3})\s+(?:principaux|principales|premiers|premières|plus)/i);
  const n = Number(m?.[1] || m?.[2] || 0);
  return n > 0 ? Math.min(n, 100) : null;
}

function normalizeEngineCell(v) {
  if (v === undefined || v === null || String(v).trim() === '') return 'Non renseigné';
  return String(v).trim();
}

function pivotRows(rows, rowCol, colCol, maxRows = 12, maxCols = 8) {
  const rowCounts = new Map();
  const colCounts = new Map();
  rows.forEach(r => {
    const rv = normalizeEngineCell(r[rowCol]);
    const cv = normalizeEngineCell(r[colCol]);
    rowCounts.set(rv, (rowCounts.get(rv) || 0) + 1);
    colCounts.set(cv, (colCounts.get(cv) || 0) + 1);
  });
  const rowValues = [...rowCounts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'fr')).slice(0,maxRows).map(x=>x[0]);
  const colValues = [...colCounts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'fr')).slice(0,maxCols).map(x=>x[0]);
  const matrix = rowValues.map(rv => {
    const cells = colValues.map(cv => rows.filter(r => normalizeEngineCell(r[rowCol]) === rv && normalizeEngineCell(r[colCol]) === cv).length);
    return { value: rv, total: cells.reduce((a,b)=>a+b,0), cells };
  });
  return { total: rows.length, rowCol, colCol, rowValues, colValues, matrix };
}

function numericStats(rows, col) {
  const nums = rows.map(r => String(r[col] ?? '').replace(',', '.')).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  const n = nums.length;
  const sum = nums.reduce((a,b)=>a+b,0);
  const avg = n ? sum / n : null;
  const median = n ? (n % 2 ? nums[(n-1)/2] : (nums[n/2-1] + nums[n/2]) / 2) : null;
  return { total: rows.length, numericCount: n, sum, avg, median, min: n ? nums[0] : null, max: n ? nums[n-1] : null };
}


function inferNumericStatsColumn(table, question) {
  const q = normalizeText(question || '');
  const headers = table.headers || Object.keys(table.objects?.[0] || {});
  const candidates = headers.filter(h => h && !/^(id|manualSort)$/i.test(String(h))).map(h => {
    const hn = normalizeText(h);
    let score = 0;
    if (/voeu|vœu|voeux|vœux/.test(q) && /voeu|vœu|voeux|vœux/.test(hn)) score += 120;
    if (/confirm/.test(q) && /confirm/.test(hn)) score += 80;
    if (/class/.test(q) && /class/.test(hn)) score += 50;
    if (/moyen|moyenne/.test(q)) score += 10;
    const stats = numericStats(table.objects || [], h);
    if (stats.numericCount >= Math.max(5, (table.objects || []).length * 0.1)) score += 80;
    return { col: h, score, stats };
  }).filter(x => x.score > 80).sort((a,b)=>b.score-a.score);
  return candidates[0]?.col || null;
}

function dataEngineResultToContext(exec) {
  if (!exec || !exec.plan) return '';
  const p = exec.plan;
  const filters = (p.filters || []).map(f => `${f.col} ${f.op === 'neq' ? '≠' : '='} "${f.value}"`).join(' ; ') || 'aucun';
  let out = `=== DATA ENGINE V22 — RÉSULTAT CALCULÉ SUR LIGNES BRUTES ===\n`;
  out += `Outil : ${p.tool}\nSource : ${p.table?.source || 'Données'} · ${p.table?.name || 'table'}\nFiltres : ${filters}\n`;
  if (exec.kind === 'count') out += `Résultat : ${exec.result.count} ligne(s) sur ${exec.result.total}.\n`;
  if (exec.kind === 'group_by' || exec.kind === 'top') {
    out += `Colonne de répartition : ${p.targetCol}\nLignes retenues : ${exec.result.total}\nValeurs renseignées : ${exec.result.filled}\n`;
    out += `Répartition :\n${exec.result.rows.map(r => `- ${r.value}: ${r.count} (${r.pct.toFixed(1).replace('.', ',')} %)`).join('\n')}\n`;
  }
  if (exec.kind === 'pivot') {
    out += `Tableau croisé : ${p.targetCol} (lignes) × ${p.targetCol2} (colonnes)\nLignes retenues : ${exec.result.total}\n`;
    const r = exec.result;
    if (r && r.colValues && r.matrix) {
      out += `Colonnes : ${r.colValues.join(' | ')}\n`;
      (r.matrix || []).slice(0, 12).forEach(row => {
        const cells = row.cells.map((c, i) => `${r.colValues[i]}: ${c} (${r.total ? (c/r.total*100).toFixed(1) : '?'}%)`).filter((_,i) => row.cells[i] > 0).join(', ');
        out += `- ${row.value} (total: ${row.total}) — ${cells}\n`;
      });
    }
  }
  if (exec.kind === 'stats') {
    out += `Colonne statistique : ${p.targetCol}\nValeurs numériques : ${exec.result.numericCount}/${exec.result.total}\nMoyenne : ${exec.result.avg} · Médiane : ${exec.result.median} · Min : ${exec.result.min} · Max : ${exec.result.max}\n`;
  }
  if (exec.kind === 'compare') {
    const rows = exec.result?.rows || [];
    const baseTotal = exec.result?.baseTotal || rows.reduce((s, r) => s + (r.count || 0), 0);
    out += `Comparaison de groupes — base : ${baseTotal} ligne(s)\n`;
    out += `Effectifs par groupe :\n${rows.map(r => `- ${r.label} : ${r.count} (${r.pct.toFixed(1).replace('.', ',')} %)`).join('\n')}\n`;
    const cols = (typeof getCompareColumns === 'function') ? getCompareColumns(p.table) : {};
    const catBlocks = [
      { label: 'Grands groupes de formation', col: cols.formation },
      { label: 'Académie d’accueil', col: cols.academie },
      { label: 'Série de bac', col: cols.serie }
    ];
    catBlocks.forEach(({ label, col }) => {
      if (!col) return;
      const catRows = (typeof compareCategoryRows === 'function') ? compareCategoryRows(rows, col, 8) : [];
      if (!catRows.length) return;
      out += `\nRépartition par ${label} (colonne ${col}) :\n`;
      catRows.forEach(cr => {
        const perGroup = cr.groups.map(g => `${g.label} : ${g.count} (${g.pct.toFixed(1).replace('.', ',')} %)`).join(' · ');
        out += `- ${cr.value} — ${perGroup}\n`;
      });
    });
    if (cols.voeux && typeof compareNumericStatsRows === 'function') {
      const statsRows = compareNumericStatsRows(rows, cols.voeux);
      if (statsRows.length) {
        out += `\nVœux confirmés (colonne ${cols.voeux}) :\n`;
        statsRows.forEach(sr => {
          out += `- ${sr.label} : moyenne ${sr.avg} · médiane ${sr.median} · min ${sr.min} · max ${sr.max} (${sr.numericCount} valeurs numériques)\n`;
        });
      }
    }
  }
  return out;
}

// Badge "calcul exact" affiché sur tout résultat produit par le Data Engine
// (lignes brutes Grist/Excel), pour le distinguer visuellement d'une réponse
// Albert générique (interprétation IA, moins garantie sur les chiffres).
const DE_EXACT_BADGE = '<span class="de-exact-badge" title="Ce résultat est calculé directement sur les données, pas une interprétation IA" style="display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;color:#15803d;background:#dcfce7;border-radius:999px;padding:2px 8px;margin-left:8px;vertical-align:middle">✓ Calcul exact</span>';

function deTitleHtml(title) {
  return `<h4>${escapeHtml(title)}${DE_EXACT_BADGE}</h4>`;
}

function renderDataEngineResultHtml(tool, plan, result) {
  const filtersHtml = (plan.filters || []).length
    ? `<ul>${plan.filters.map(f => `<li>${escapeHtml(f.col)} ${f.op === 'neq' ? '≠' : '='} <strong>${escapeHtml(f.label || f.value)}</strong></li>`).join('')}</ul>`
    : '<p>Aucun filtre appliqué.</p>';
  const plannerDebug = typeof plannerPlanToDebugHtml === 'function' ? plannerPlanToDebugHtml(plan) : '';
  const debug = `<details class="msg-sources"><summary title="Détail technique du calcul (pour vérification ou support) — sans impact sur le résultat affiché ci-dessus">Plan Data Engine</summary><div style="font-size:10px;line-height:1.5;margin-top:5px"><strong>Outil</strong> : ${escapeHtml(tool)}<br><strong>Source</strong> : ${escapeHtml(plan.table?.source || 'Données')} · ${escapeHtml(plan.table?.name || 'table')}<br><strong>Colonnes détectées</strong> : ${escapeHtml((plan.mentionedCols || []).join(' | ') || '—')}</div>${plannerDebug}</details>`;
  if (tool === 'count_rows') {
    const pct = result.total ? pctFr(result.count, result.total) : '—';
    const clearTitle = (typeof extractBlockTitle === 'function') ? extractBlockTitle({ plan, result }, '') : 'Comptage';
    return `${deTitleHtml(clearTitle)}<p>Il y a <strong>${result.count.toLocaleString('fr-FR')}</strong> ligne${result.count>1?'s':''} correspondant à la demande (${pct} du jeu de données).</p><p><strong>Filtres appliqués</strong></p>${filtersHtml}${debug}`;
  }
  if (tool === 'group_by' || tool === 'top') {
    const rows = result.rows || [];
    const clearTitle = (typeof extractBlockTitle === 'function') ? extractBlockTitle({ plan, result }, '') : (tool === 'top' ? 'Top' : 'Répartition');
    return `${deTitleHtml(clearTitle)}<p><strong>${result.total.toLocaleString('fr-FR')}</strong> ligne${result.total>1?'s':''} retenue${result.total>1?'s':''}. Analyse par <strong>${escapeHtml(plan.targetCol)}</strong>.</p><ul>${rows.slice(0,20).map(r => `<li>${escapeHtml(r.value)} : <strong>${r.count.toLocaleString('fr-FR')}</strong> (${r.pct.toFixed(1).replace('.', ',')} %)</li>`).join('')}</ul>${plan.renderChart ? (plan.chartType === 'pie' ? renderMiniPieChart(rows, result.total) : renderMiniBarChart(rows, result.total)) : ''}${filtersHtml}${debug}`;
  }
  if (tool === 'pivot') {
    const cols = result.colValues || [];
    const total = result.total || 0;
    const header = `<tr><th style="text-align:left">${escapeHtml(plan.targetCol)}</th>${cols.map(c => `<th style="text-align:right">${escapeHtml(c)}</th>`).join('')}<th style="text-align:right">Total</th><th style="text-align:right">% total</th></tr>`;
    const body = (result.matrix || []).map(r => {
      const pct = total ? (r.total / total * 100).toFixed(1).replace('.', ',') : '—';
      return `<tr><td>${escapeHtml(r.value)}</td>${r.cells.map(c => `<td style="text-align:right">${c > 0 ? c.toLocaleString('fr-FR') : '<span style="color:var(--gris2)">—</span>'}</td>`).join('')}<td style="text-align:right"><strong>${r.total.toLocaleString('fr-FR')}</strong></td><td style="text-align:right">${pct} %</td></tr>`;
    }).join('');
    const colTotals = cols.map((_, i) => (result.matrix || []).reduce((s, r) => s + (r.cells[i] || 0), 0));
    const foot = `<tr style="background:var(--gris0,#f8fafc);font-weight:700"><td>Total</td>${colTotals.map(t => `<td style="text-align:right">${t.toLocaleString('fr-FR')}</td>`).join('')}<td style="text-align:right">${total.toLocaleString('fr-FR')}</td><td></td></tr>`;
    const clearTitle = `${_shortColName(plan.targetCol)} × ${_shortColName(plan.targetCol2)}`;
    return `${deTitleHtml(clearTitle)}<p><strong>${total.toLocaleString('fr-FR')}</strong> lignes retenues. Croisement <strong>${escapeHtml(plan.targetCol)}</strong> × <strong>${escapeHtml(plan.targetCol2)}</strong>.</p><div style="overflow:auto"><table style="border-collapse:collapse;font-size:12px;width:100%"><thead>${header}</thead><tbody>${body}${foot}</tbody></table></div>${filtersHtml}${debug}`;
  }
  if (tool === 'stats') {
    const fmt = v => v === null || v === undefined ? '—' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
    const clearTitle = `Statistiques — ${_shortColName(plan.targetCol)}`;
    return `${deTitleHtml(clearTitle)}<p>Colonne : <strong>${escapeHtml(plan.targetCol)}</strong></p><ul><li>Valeurs numériques : <strong>${result.numericCount.toLocaleString('fr-FR')}</strong> / ${result.total.toLocaleString('fr-FR')}</li><li>Moyenne : <strong>${fmt(result.avg)}</strong></li><li>Médiane : <strong>${fmt(result.median)}</strong></li><li>Min : <strong>${fmt(result.min)}</strong></li><li>Max : <strong>${fmt(result.max)}</strong></li></ul>${filtersHtml}${debug}`;
  }
  return `${deTitleHtml('Résultat')}${debug}`;
}

function shouldAnswerLocallyWithoutAlbert(exec) {
  if (!exec) return false;
  // Les requêtes de comptage/répartition simples doivent être résolues par le moteur,
  // sinon Albert risque de répondre à partir d'un résumé incomplet.
  return ['count','group_by','top','pivot','stats','export','compare'].includes(exec.kind);
}