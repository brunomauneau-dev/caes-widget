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
  { name: 'export_csv', description: 'Exporter les lignes filtrées en CSV' }
];

function isDataEngineQuestion(question) {
  const q = normalizeText(question || '');
  if (!q) return false;
  return /combien|nombre|effectif|compte|compter|repartition|r[eé]partition|ventilation|par |groupe|group[eé]|top|classement|principa|plus frequen|plus fréquent|croise|crois[eé]|tableau crois[eé]|pivot|moyenne|median|m[eé]diane|minimum|maximum|min|max|export|excel|csv|liste|filtre/.test(q);
}

function inferMeasureIntent(question) {
  const q = normalizeText(question || '');
  if (/export|excel|xlsx|csv|telecharg|t[eé]l[eé]charg|sors moi|sort moi|extraire|extrait|liste/.test(q)) {
    return /\bcsv\b/.test(q) ? 'export_csv' : 'export_excel';
  }
  if (/croise|crois[eé]|tableau crois[eé]|pivot|par .* par /.test(q)) return 'pivot';
  if (/moyenne|median|m[eé]diane|minimum|maximum|min|max/.test(q)) return 'stats';
  if (/top|classement|principales?|plus frequentes?|plus fréquentes?|les plus/.test(q)) return 'top';
  if (/repartition|r[eé]partition|ventilation|par |groupe|group[eé]|pourcentage|proportion/.test(q)) return 'group_by';
  if (/combien|nombre|effectif|compte|compter|total/.test(q)) return 'count_rows';
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

function detectDataEnginePlan(question, filterContextText = question) {
  if (!isDataEngineQuestion(question)) return null;
  const tables = getActiveQueryTables();
  if (!tables.length) return null;
  const table = tables[0]; // Grist est déjà prioritaire dans getActiveQueryTables()
  if (!table || !table.objects || !table.objects.length) return null;
  const headers = table.headers || Object.keys(table.objects[0] || {});
  const tool = inferMeasureIntent(question);
  if (!tool) return null;

  // V17 : le Planner construit d'abord un plan structuré à partir du schéma
  // réel de la table (colonnes + valeurs). Cela évite les oublis du type
  // « bac général » non transformé en Série de la Classe = Générale.
  if (typeof buildPlannerPlan === 'function') {
    const plannerPlan = buildPlannerPlan(question, filterContextText, table, tool);
    if (plannerPlan) return plannerPlan;
  }

  // Fallback V16 si planner indisponible.
  const q = normalizeText(question || '');
  const mentionedCols = findMentionedColumns(headers, question, 4);
  const targetCol = tool === 'group_by' ? (detectTargetColumn(headers, q) || mentionedCols[0] || null) : null;
  const filters = detectFilters(table, normalizeText(filterContextText || question), targetCol);
  return {
    tool,
    table,
    filters,
    targetCol,
    mentionedCols,
    question,
    createdAt: new Date().toISOString()
  };
}

function runDataEnginePlan(plan) {
  if (!plan || !plan.table) return null;
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
    return {
      kind: 'count',
      plan,
      result: { count: rows.length, total: (plan.table.objects || []).length },
      text: `COUNT_ROWS = ${rows.length}`,
      html: renderDataEngineResultHtml('count_rows', plan, { count: rows.length, total: (plan.table.objects || []).length })
    };
  }
  if (plan.tool === 'group_by' || plan.tool === 'top') {
    const col = plan.targetCol || plan.mentionedCols?.[0];
    if (!col) return null;
    const limit = plan.limit || detectLimit(plan.question) || (plan.tool === 'top' ? 10 : 30);
    const counts = topCountsForRows(rows, col, Math.max(limit, 30));
    const topRows = counts.top.slice(0, limit);
    return {
      kind: plan.tool,
      plan: { ...plan, targetCol: col, limit },
      result: { total: rows.length, filled: counts.filled, distinct: counts.distinct, rows: topRows },
      text: topRows.map(x => `${x.value}: ${x.count} (${x.pct.toFixed(1)}%)`).join('\n'),
      html: renderDataEngineResultHtml(plan.tool, { ...plan, targetCol: col, limit }, { total: rows.length, filled: counts.filled, distinct: counts.distinct, rows: topRows })
    };
  }
  if (plan.tool === 'pivot') {
    const rowCol = plan.targetCol || plan.mentionedCols?.[0];
    const colCol = plan.targetCol2 || plan.mentionedCols?.find(c => c !== rowCol);
    if (!rowCol || !colCol) return null;
    const pivot = pivotRows(rows, rowCol, colCol, 12, 8);
    return {
      kind: 'pivot',
      plan: { ...plan, targetCol: rowCol, targetCol2: colCol },
      result: pivot,
      text: `Pivot ${rowCol} × ${colCol}`,
      html: renderDataEngineResultHtml('pivot', { ...plan, targetCol: rowCol, targetCol2: colCol }, pivot)
    };
  }
  if (plan.tool === 'stats') {
    const col = plan.targetCol || plan.mentionedCols?.[0];
    if (!col) return null;
    const stats = numericStats(rows, col);
    return {
      kind: 'stats',
      plan: { ...plan, targetCol: col },
      result: stats,
      text: `Stats ${col}: moyenne ${stats.avg}`,
      html: renderDataEngineResultHtml('stats', { ...plan, targetCol: col }, stats)
    };
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


function dataEngineResultToContext(exec) {
  if (!exec || !exec.plan) return '';
  const p = exec.plan;
  const filters = (p.filters || []).map(f => `${f.col} ${f.op === 'neq' ? '≠' : '='} "${f.value}"`).join(' ; ') || 'aucun';
  let out = `=== DATA ENGINE V16 — RÉSULTAT CALCULÉ SUR LIGNES BRUTES ===\n`;
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
    return `<h4>${title}</h4><p><strong>${result.total.toLocaleString('fr-FR')}</strong> ligne${result.total>1?'s':''} retenue${result.total>1?'s':''}. Analyse par <strong>${escapeHtml(plan.targetCol)}</strong>.</p><ul>${rows.slice(0,20).map(r => `<li>${escapeHtml(r.value)} : <strong>${r.count.toLocaleString('fr-FR')}</strong> (${r.pct.toFixed(1).replace('.', ',')} %)</li>`).join('')}</ul>${filtersHtml}${debug}`;
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
  return ['count','group_by','top','pivot','stats','export'].includes(exec.kind);
}
