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
}
window.resetCopilotDialogue = resetCopilotDialogue;

function isFollowUpQuestion(question) {
  const q = normalizeText(question || '');
  return !!getDataEngineState().lastPlan && /^(par|selon|uniquement|seulement|sauf|hors|avec|sans|graphique|camembert|histogramme|barres?|excel|csv|export|exporte|trie|tri|les boursiers|les non boursiers)/.test(q);
}

function isChartRequest(question) {
  const q = normalizeText(question || '');
  return /graphique|graphe|diagramme|histogramme|barres?|camembert|chart/.test(q);
}

function isExportCurrentRequest(question) {
  const q = normalizeText(question || '');
  return /export|exporte|excel|xlsx|csv|telecharg|t[eé]l[eé]charg/.test(q);
}


function isBareChartRequest(question) {
  const q = normalizeText(question || '');
  return /^(graphique|graphe|diagramme|histogramme|camembert|barres?|chart|fais un graphique|affiche un graphique)$/.test(q);
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
  if (/^(combien|nombre|effectif|total|quelle est|quel est|moyenne|nombre moyen|top|classement|repartition|r[eé]partition|tableau crois[eé]|croise|pivot)/.test(q)) return true;
  return false;
}

function isFilterOnlyFollowUp(question) {
  const q = normalizeText(question || '').trim();
  return /^(seulement|uniquement|avec|sans|sauf|hors|excluant|en excluant|les boursiers|les non boursiers|non boursiers|boursiers|et pour)/.test(q);
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
  return vals[0];
}

function strictFiltersFromQuestion(table, question) {
  const q = normalizeText(question || '');
  const out = [];
  const add = (col, value, op='eq') => { if (col && value !== undefined && value !== null) out.push({ col, value, op }); };

  if (/pays basque|basque/.test(q)) {
    const col = findColumnByConceptStrict(table, 'basque');
    if (col) add(col, pickColumnValue(table, col, 'oui'), 'eq');
  }

  if (/non[ -]?boursier|sans boursier|hors boursier|exclu.*boursier|en excluant.*boursier/.test(q)) {
    const col = findColumnByConceptStrict(table, 'boursier');
    if (col) add(col, pickColumnValue(table, col, 'boursier_non'), 'eq');
  } else if (/boursier|bourse/.test(q)) {
    const col = findColumnByConceptStrict(table, 'boursier');
    if (col) add(col, pickColumnValue(table, col, 'boursier_oui'), 'eq');
  }

  if (/hors.*bordeaux|sauf.*bordeaux|exclu.*bordeaux|diff[eé]rent.*bordeaux/.test(q)) {
    const col = findColumnByConceptStrict(table, 'academie_accueil');
    if (col) add(col, 'Bordeaux', 'neq');
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
    if (isChartRequest(question)) plan.renderChart = true;
    return plan;
  }

  const explicitFresh = isExplicitFreshDataQuestion(question) && !/^(et pour|et les|idem|m[eê]me|meme)/.test(q);
  const dimensionFollowUp = isDimensionOnlyFollowUp(question);
  const filterFollowUp = isFilterOnlyFollowUp(question);
  const bareAction = isBareChartRequest(question) || isBareExportRequest(question);

  if (explicitFresh && !dimensionFollowUp && !filterFollowUp && !bareAction) {
    if (isChartRequest(question)) plan.renderChart = true;
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
      if (prev.targetCol) plan.targetCol = prev.targetCol;
      if (prev.targetCol2) plan.targetCol2 = prev.targetCol2;
      if (prev.limit) plan.limit = prev.limit;
      if (prev.mentionedCols && (!plan.mentionedCols || !plan.mentionedCols.length)) plan.mentionedCols = prev.mentionedCols;
    }

    if (isChartRequest(question)) plan.renderChart = true;
  } else if (isChartRequest(question)) {
    plan.renderChart = true;
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
}

function renderMiniBarChart(rows, total) {
  if (!rows || !rows.length) return '';
  const max = Math.max(...rows.map(r => r.count || 0), 1);
  return `<div style="margin:10px 0;display:grid;gap:6px;max-width:560px">${rows.slice(0,12).map(r => {
    const w = Math.max(2, Math.round((r.count || 0) / max * 100));
    return `<div style="display:grid;grid-template-columns:minmax(120px,220px) 1fr auto;gap:8px;align-items:center"><div style="font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(r.value)}">${escapeHtml(r.value)}</div><div style="height:12px;background:var(--gris1);border-radius:6px;overflow:hidden"><div style="height:12px;width:${w}%;background:var(--albert);border-radius:6px"></div></div><div style="font-size:11px;font-weight:700">${(r.count || 0).toLocaleString('fr-FR')}</div></div>`;
  }).join('')}</div>`;
}

function isDataEngineQuestion(question) {
  const q = normalizeText(question || '');
  if (!q) return false;
  return /compare|comparaison|comparer|versus| vs |combien|nombre|effectif|compte|compter|repartition|r[eé]partition|ventilation|par |groupe|group[eé]|top|classement|principa|plus frequen|plus fréquent|croise|crois[eé]|tableau crois[eé]|pivot|moyen|moyenne|median|m[eé]diane|minimum|maximum|min|max|export|excel|csv|liste|filtre|graphique|graphe|diagramme|histogramme|camembert|barres?|boursier|basque|hors|sauf|seulement|uniquement/.test(q) || isFollowUpQuestion(question);
}

function inferMeasureIntent(question) {
  const q = normalizeText(question || '');
  if (/compare|comparaison|comparer|versus| vs /.test(q)) return 'compare';
  if (/graphique|graphe|diagramme|histogramme|camembert|barres?|chart/.test(q)) return 'group_by';
  if (/export|excel|xlsx|csv|telecharg|t[eé]l[eé]charg|sors moi|sort moi|extraire|extrait|liste/.test(q)) {
    return /\bcsv\b/.test(q) ? 'export_csv' : 'export_excel';
  }
  if (/croise|crois[eé]|tableau crois[eé]|pivot|par .* par /.test(q)) return 'pivot';
  if (/moyen|moyenne|median|m[eé]diane|minimum|maximum|\bmin\b|\bmax\b/.test(q)) return 'stats';
  if (/top|classement|principales?|plus frequentes?|plus fréquentes?|les plus/.test(q)) return 'top';
  if (/repartition|r[eé]partition|ventilation|par |groupe|group[eé]|pourcentage|proportion/.test(q)) return 'group_by';
  if (/combien|nombre|effectif|compte|compter|total/.test(q)) return 'count_rows';
  if (isFollowUpQuestion(question)) return getDataEngineState().lastPlan?.tool || 'count_rows';
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
    const plannerPlan = buildPlannerPlan(question, filterContextText, table, tool);
    if (plannerPlan) return inheritConversationContext(plannerPlan, question);
  }

  // Fallback V16 si planner indisponible.
  const q = normalizeText(question || '');
  const mentionedCols = findMentionedColumns(headers, question, 4);
  const targetCol = tool === 'group_by' ? (detectTargetColumn(headers, q) || mentionedCols[0] || null) : null;
  const filters = detectFilters(table, normalizeText(filterContextText || question), targetCol);
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
  return [];
}

function downloadRowsAsFile(rows, filename, format) {
  if (!rows || !rows.length) return { ok: false, html: '<h4>Export impossible</h4><p>Aucune donnée à exporter.</p>' };
  const ws = XLSX.utils.json_to_sheet(rows);
  if (format === 'csv') {
    const csv = XLSX.utils.sheet_to_csv(ws);
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
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Resultat');
    XLSX.writeFile(wb, filename);
  }
  return { ok: true, html: `<h4>Export généré</h4><p>J'ai créé <strong>${escapeHtml(filename)}</strong> avec <strong>${rows.length.toLocaleString('fr-FR')}</strong> ligne${rows.length>1?'s':''}.</p>` };
}

function renderCurrentChartExecution(plan) {
  const prev = plan.sourceExecution;
  if (!prev) return null;
  if (prev.kind === 'group_by' || prev.kind === 'top') {
    const rows = prev.result?.rows || [];
    const clonedPlan = { ...(prev.plan || {}), renderChart: true };
    const html = renderDataEngineResultHtml(prev.plan?.tool || prev.kind, clonedPlan, prev.result);
    return { kind: prev.kind, plan: clonedPlan, result: prev.result, text: prev.text, html };
  }
  // Si le dernier résultat n'est pas graphiquable, produire une répartition par la dernière dimension connue.
  const fallbackCol = prev.plan?.targetCol || 'Série de la Classe';
  const rows = applyLocalActionFilters(prev.plan?.table?.objects || [], prev.plan?.filters || []);
  const counts = topCountsForRows(rows, fallbackCol, 30);
  const result = { total: rows.length, filled: counts.filled, distinct: counts.distinct, rows: counts.top.slice(0, 12) };
  const clonedPlan = { ...(prev.plan || {}), tool: 'group_by', targetCol: fallbackCol, renderChart: true };
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
      // Conserver les filtres stricts et les filtres explicitement portés par la question.
      if (strictCols.has(f.col)) return false; // remplacés par strict ci-dessous
      const cn = normalizeText(f.col);
      if (/voeu|vœu/.test(cn) && !/voeu|vœu/.test(q)) return false;
      if (/commune/.test(cn) && !/commune/.test(q)) return false;
      if (/etablissement|établissement/.test(cn) && !/etablissement|établissement|iut|universit|lyc[eé]e|bts|but|dut|cpge|formation/.test(q)) return false;
      if (/acad[eé]mie/.test(cn) && !/acad[eé]mie|bordeaux|toulouse|poitiers|limoges|paris|hors|sauf/.test(q)) return false;
      return true;
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
      plan.tool = prev.tool || plan.tool;
      if (prev.targetCol) plan.targetCol = prev.targetCol;
      if (prev.targetCol2) plan.targetCol2 = prev.targetCol2;
      if (prev.limit) plan.limit = prev.limit;
      if (prev.mentionedCols) plan.mentionedCols = prev.mentionedCols;
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

  // Basques vs non-Basques
  if (/basque/.test(q) && /(non[- ]?basque|autres?|reste|hors)/.test(q)) {
    const col = findColumnByConceptStrict(table, 'basque');
    if (col) {
      addGroup('Pays Basque', [{ col, op: 'eq', value: yesNoValue(col, true) }]);
      addGroup('Hors Pays Basque', [{ col, op: 'neq', value: yesNoValue(col, true) }]);
      return groups;
    }
  }
  if (/compare.*basque|basque.*compare/.test(q)) {
    const col = findColumnByConceptStrict(table, 'basque');
    if (col) {
      addGroup('Pays Basque', [{ col, op: 'eq', value: yesNoValue(col, true) }]);
      addGroup('Hors Pays Basque', [{ col, op: 'neq', value: yesNoValue(col, true) }]);
      return groups;
    }
  }

  // Boursiers vs non-boursiers
  if (/boursier/.test(q)) {
    const col = findColumnByConceptStrict(table, 'boursier');
    if (col && (/non[- ]?boursier|compare|comparaison|versus| vs /.test(q))) {
      addGroup('Boursiers', [{ col, op: 'eq', value: pickColumnValue(table, col, 'boursier_oui') }]);
      addGroup('Non-boursiers', [{ col, op: 'eq', value: pickColumnValue(table, col, 'boursier_non') }]);
      return groups;
    }
  }

  // BUT/DUT vs BTS
  if (/(but|dut)/.test(q) && /bts/.test(q)) {
    const col = findColumnByConceptStrict(table, 'formation_groupe') || (table.headers || []).find(h => /formation/i.test(h));
    if (col) {
      const vals = Array.from(new Set((table.objects || []).map(r => String(r[col] ?? '').trim()).filter(Boolean)));
      const dut = vals.find(v => /\bDUT\b/i.test(v)) || 'DUT';
      const bts = vals.find(v => /\bBTS\b|BTSA|DTS/i.test(v)) || 'BTS - BTSA - DTS - DMA';
      addGroup('BUT / DUT', [{ col, op: 'eq', value: dut }]);
      addGroup('BTS', [{ col, op: 'eq', value: bts }]);
      return groups;
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
  const first = groupRows?.[0]?.label || 'Population 1';
  const second = groupRows?.[1]?.label || 'Population 2';

  (sections || []).forEach(sec => {
    strongestCompareDifferences(sec.rows, groupRows, sec.title, 2).forEach(d => {
      const leader = d.delta >= 0 ? d.a : d.b;
      const other = d.delta >= 0 ? d.b : d.a;
      const leaderPct = d.delta >= 0 ? d.aPct : d.bPct;
      const otherPct = d.delta >= 0 ? d.bPct : d.aPct;
      insights.push(`${escapeHtml(leader)} sont davantage représentés dans « ${escapeHtml(d.value)} » (${fmtComparePct(leaderPct)} contre ${fmtComparePct(otherPct)} pour ${escapeHtml(other)}).`);
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
  return `<h5 style="margin:14px 0 6px">Points clés</h5><ul>${insights.slice(0, 5).map(x => `<li>${x}</li>`).join('')}</ul>`;
}

function renderCompareCategoryTable(title, col, catRows, groupRows) {
  if (!col || !catRows?.length) return '';
  const head = groupRows.map(g => `<th colspan="2" style="text-align:center">${escapeHtml(g.label)}</th>`).join('');
  const sub = groupRows.map(() => '<th style="text-align:right">n</th><th style="text-align:right">%</th>').join('');
  const body = catRows.map(r => `<tr><td>${escapeHtml(r.value)}</td>${r.groups.map(g => `<td style="text-align:right">${g.count.toLocaleString('fr-FR')}</td><td style="text-align:right">${fmtComparePct(g.pct)}</td>`).join('')}</tr>`).join('');
  return `<h5 style="margin:14px 0 6px">${escapeHtml(title)}</h5><div style="overflow:auto"><table style="border-collapse:collapse;font-size:12px"><tbody><tr><th>${escapeHtml(title)}</th>${head}</tr><tr><th></th>${sub}</tr>${body}</tbody></table></div>`;
}

function renderCompareStatsTable(col, statsRows) {
  if (!col || !statsRows?.length) return '';
  const rows = statsRows.map(r => `<tr><td>${escapeHtml(r.label)}</td><td style="text-align:right">${(r.numericCount || 0).toLocaleString('fr-FR')}</td><td style="text-align:right">${fmtCompareNumber(r.avg, 2)}</td><td style="text-align:right">${fmtCompareNumber(r.median, 2)}</td><td style="text-align:right">${fmtCompareNumber(r.min, 2)}</td><td style="text-align:right">${fmtCompareNumber(r.max, 2)}</td></tr>`).join('');
  return `<h5 style="margin:14px 0 6px">Vœux confirmés</h5><p style="font-size:12px;margin:0 0 6px">Colonne : ${escapeHtml(col)}</p><div style="overflow:auto"><table style="border-collapse:collapse;font-size:12px"><tbody><tr><th>Population</th><th style="text-align:right">Valeurs num.</th><th style="text-align:right">Moyenne</th><th style="text-align:right">Médiane</th><th style="text-align:right">Min</th><th style="text-align:right">Max</th></tr>${rows}</tbody></table></div>`;
}

function renderCompareHtml(plan, result) {
  const filtersHtml = (plan.filters || []).length
    ? `<p><strong>Filtres communs</strong></p><ul>${plan.filters.map(f => `<li>${escapeHtml(f.col)} ${f.op === 'neq' ? '≠' : '='} <strong>${escapeHtml(f.value)}</strong></li>`).join('')}</ul>`
    : '<p><strong>Filtres communs</strong> : aucun.</p>';
  const rows = result.rows || [];
  const baseTotal = result.baseTotal || rows.reduce((s, r) => s + (r.count || 0), 0);
  const groupedTotal = rows.reduce((s, r) => s + (r.count || 0), 0);
  const missing = Math.max(0, baseTotal - groupedTotal);
  const tableRows = rows.map(r => `<tr><td>${escapeHtml(r.label)}</td><td style="text-align:right"><strong>${r.count.toLocaleString('fr-FR')}</strong></td><td style="text-align:right">${fmtComparePct(r.pct)}</td></tr>`).join('')
    + (missing ? `<tr><td>Non renseigné / autre</td><td style="text-align:right"><strong>${missing.toLocaleString('fr-FR')}</strong></td><td style="text-align:right">${fmtComparePct(baseTotal ? missing / baseTotal * 100 : 0)}</td></tr>` : '');
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
  const debug = `<details class="msg-sources" open><summary>Plan Data Engine</summary><div style="font-size:10px;line-height:1.5;margin-top:5px"><strong>Outil</strong> : compare<br><strong>Version</strong> : v24.7-compare-format-insights<br><strong>Source</strong> : ${escapeHtml(plan.table?.source || 'Données')} · ${escapeHtml(plan.table?.name || 'table')}<br><strong>Groupes</strong> : ${escapeHtml(rows.map(r => r.label).join(' / ') || '—')}</div></details>`;
  return `<h4>Comparaison calculée localement</h4><p>Base comparée : <strong>${baseTotal.toLocaleString('fr-FR')}</strong> lignes.</p><div style="overflow:auto"><table style="border-collapse:collapse;font-size:12px"><tbody><tr><th>Population</th><th>Nombre</th><th>Part</th></tr>${tableRows}</tbody></table></div>${filtersHtml}${insights}${formationTable}${academieTable}${serieTable}${statsTable}${debug}`;
}

function runDataEnginePlan(plan) {
  plan = finalSanitizeAnalysisPlan(plan);
  if (!plan || !plan.table) return null;
  if (plan.tool === 'compare') {
    const groups = plan.compareGroups || detectCompareGroups(plan.table, plan.question);
    if (!groups || groups.length < 2) return null;
    const commonFilters = sanitizeCompareCommonFilters(plan, groups);
    const comparePlan = { ...plan, filters: commonFilters, compareGroups: groups };
    const rows = compareGroupSummary(plan.table, groups, commonFilters);
    const baseTotal = applyLocalActionFilters(plan.table.objects || [], commonFilters).length;
    const exec = { kind: 'compare', plan: comparePlan, result: { rows, baseTotal }, text: rows.map(r => `${r.label}: ${r.count}`).join('\n'), html: renderCompareHtml(comparePlan, { rows, baseTotal }) };
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
    const res = downloadRowsAsFile(rows, filename, format);
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
    out += `Tableau croisé : ${p.targetCol} × ${p.targetCol2}\nLignes retenues : ${exec.result.total}\n`;
  }
  if (exec.kind === 'stats') {
    out += `Colonne statistique : ${p.targetCol}\nValeurs numériques : ${exec.result.numericCount}/${exec.result.total}\nMoyenne : ${exec.result.avg} · Médiane : ${exec.result.median} · Min : ${exec.result.min} · Max : ${exec.result.max}\n`;
  }
  return out;
}

function renderDataEngineResultHtml(tool, plan, result) {
  const filtersHtml = (plan.filters || []).length
    ? `<ul>${plan.filters.map(f => `<li>${escapeHtml(f.col)} ${f.op === 'neq' ? '≠' : '='} <strong>${escapeHtml(f.value)}</strong></li>`).join('')}</ul>`
    : '<p>Aucun filtre appliqué.</p>';
  const plannerDebug = typeof plannerPlanToDebugHtml === 'function' ? plannerPlanToDebugHtml(plan) : '';
  const debug = `<details class="msg-sources" open><summary>Plan Data Engine</summary><div style="font-size:10px;line-height:1.5;margin-top:5px"><strong>Outil</strong> : ${escapeHtml(tool)}<br><strong>Source</strong> : ${escapeHtml(plan.table?.source || 'Données')} · ${escapeHtml(plan.table?.name || 'table')}<br><strong>Colonnes détectées</strong> : ${escapeHtml((plan.mentionedCols || []).join(' | ') || '—')}</div>${plannerDebug}</details>`;
  if (tool === 'count_rows') {
    const pct = result.total ? pctFr(result.count, result.total) : '—';
    return `<h4>Résultat calculé localement</h4><p>Il y a <strong>${result.count.toLocaleString('fr-FR')}</strong> ligne${result.count>1?'s':''} correspondant à la demande (${pct} du jeu de données).</p><p><strong>Filtres appliqués</strong></p>${filtersHtml}${debug}`;
  }
  if (tool === 'group_by' || tool === 'top') {
    const rows = result.rows || [];
    const title = tool === 'top' ? 'Top calculé localement' : 'Répartition calculée localement';
    return `<h4>${title}</h4><p><strong>${result.total.toLocaleString('fr-FR')}</strong> ligne${result.total>1?'s':''} retenue${result.total>1?'s':''}. Analyse par <strong>${escapeHtml(plan.targetCol)}</strong>.</p><ul>${rows.slice(0,20).map(r => `<li>${escapeHtml(r.value)} : <strong>${r.count.toLocaleString('fr-FR')}</strong> (${r.pct.toFixed(1).replace('.', ',')} %)</li>`).join('')}</ul>${plan.renderChart ? renderMiniBarChart(rows, result.total) : ''}${filtersHtml}${debug}`;
  }
  if (tool === 'pivot') {
    const cols = result.colValues || [];
    const header = `<tr><th>${escapeHtml(plan.targetCol)}</th>${cols.map(c => `<th>${escapeHtml(c)}</th>`).join('')}<th>Total</th></tr>`;
    const body = (result.matrix || []).map(r => `<tr><td>${escapeHtml(r.value)}</td>${r.cells.map(c => `<td style="text-align:right">${c.toLocaleString('fr-FR')}</td>`).join('')}<td style="text-align:right"><strong>${r.total.toLocaleString('fr-FR')}</strong></td></tr>`).join('');
    return `<h4>Tableau croisé calculé localement</h4><p><strong>${result.total.toLocaleString('fr-FR')}</strong> lignes retenues. Croisement <strong>${escapeHtml(plan.targetCol)}</strong> × <strong>${escapeHtml(plan.targetCol2)}</strong>.</p><div style="overflow:auto"><table style="border-collapse:collapse;font-size:12px"><tbody>${header}${body}</tbody></table></div>${filtersHtml}${debug}`;
  }
  if (tool === 'stats') {
    const fmt = v => v === null || v === undefined ? '—' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
    return `<h4>Statistiques calculées localement</h4><p>Colonne : <strong>${escapeHtml(plan.targetCol)}</strong></p><ul><li>Valeurs numériques : <strong>${result.numericCount.toLocaleString('fr-FR')}</strong> / ${result.total.toLocaleString('fr-FR')}</li><li>Moyenne : <strong>${fmt(result.avg)}</strong></li><li>Médiane : <strong>${fmt(result.median)}</strong></li><li>Min : <strong>${fmt(result.min)}</strong></li><li>Max : <strong>${fmt(result.max)}</strong></li></ul>${filtersHtml}${debug}`;
  }
  return `<h4>Résultat calculé localement</h4>${debug}`;
}

function shouldAnswerLocallyWithoutAlbert(exec) {
  if (!exec) return false;
  // Les requêtes de comptage/répartition simples doivent être résolues par le moteur,
  // sinon Albert risque de répondre à partir d'un résumé incomplet.
  return ['count','group_by','top','pivot','stats','export','compare'].includes(exec.kind);
}