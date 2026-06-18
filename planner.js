/* planner.js — Planner V1 pour Parcoursup Data Copilot.
   Rôle : transformer une question en plan d'exécution exploitable par le Data Engine.
   Le planner ne calcule rien. Il détecte : outil, filtres, colonne cible et traces debug.
*/

function plannerNorm(s) {
  return normalizeText(String(s ?? ''));
}

function plannerTokens(s) {
  return plannerNorm(s).split(/[^a-z0-9]+/).filter(t => t.length >= 2);
}

function plannerColumnKind(col) {
  const n = plannerNorm(col);
  if (/zone.*pays.*basque|pays.*basque/.test(n)) return 'basque_zone';
  if (/serie.*classe|s[eé]rie.*classe|type.*bac|serie/.test(n)) return 'bac_series';
  if (/boursier/.test(n) && !/lycee|lyc[eé]e/.test(n)) return 'boursier';
  if (/academie|acad[eé]mie/.test(n)) return 'academie';
  if (/departement|d[eé]partement/.test(n)) return 'departement';
  if (/formation|specialite|sp[eé]cialit[eé]|mention|groupe/.test(n)) return 'formation';
  if (/proposition|favorable|accept|admission/.test(n)) return 'admission';
  if (/sexe/.test(n)) return 'sexe';
  return 'generic';
}

function plannerValues(table, col, max = 400) {
  if (typeof uniqueValues === 'function') return uniqueValues(table, col, max);
  const counts = new Map();
  (table.objects || []).forEach(r => {
    const v = r[col];
    if (v === undefined || v === null || String(v).trim() === '') return;
    const k = String(v).trim();
    counts.set(k, (counts.get(k) || 0) + 1);
  });
  return [...counts.entries()].sort((a,b) => b[1] - a[1]).slice(0, max).map(([value, count]) => ({ value, count }));
}

function buildPlannerCatalog(table) {
  const headers = (table?.headers || Object.keys(table?.objects?.[0] || {})).filter(h => h && !/^(id|manualSort)$/i.test(String(h)));
  return headers.map(col => {
    const values = plannerValues(table, col, 80);
    const filled = values.reduce((s, x) => s + (x.count || 0), 0);
    return { column: col, kind: plannerColumnKind(col), values, filled, distinctShown: values.length };
  });
}

function plannerValueAliases(col, value) {
  const kind = plannerColumnKind(col);
  const raw = String(value ?? '').trim();
  const n = plannerNorm(raw);
  const aliases = new Set([n]);

  // Aliases métier mais génériques autour de la valeur, pas du fichier.
  if (kind === 'bac_series') {
    if (/^g[eé]n[eé]rale?$|general|generale/.test(n)) {
      ['general','generale','bac general','bac generale','serie generale','voie generale','filiere generale'].forEach(a => aliases.add(plannerNorm(a)));
    }
    if (/professionnel|professionnelle|pro\b/.test(n)) {
      ['professionnel','professionnelle','bac pro','bac professionnel','bac professionnelle','serie professionnelle','voie professionnelle'].forEach(a => aliases.add(plannerNorm(a)));
    }
    if (/technologique|techno/.test(n)) {
      ['technologique','bac techno','bac technologique','serie technologique','voie technologique'].forEach(a => aliases.add(plannerNorm(a)));
    }
    ['stmg','sti2d','std2a','stl','st2s','stav','s2tmd'].forEach(x => { if (n.includes(x)) aliases.add(x); });
  }

  if (kind === 'sexe') {
    if (/f[eé]minin|femme|fille/.test(n)) ['feminin','femme','femmes','fille','filles'].forEach(a => aliases.add(plannerNorm(a)));
    if (/masculin|homme|garcon/.test(n)) ['masculin','homme','hommes','garcon','garcons'].forEach(a => aliases.add(plannerNorm(a)));
  }

  if (kind === 'admission') {
    if (/oui|true|1|vrai/.test(n)) ['admis','admission','accepté','accepte','acceptée','acceptee','réponse favorable','reponse favorable','proposition acceptee'].forEach(a => aliases.add(plannerNorm(a)));
    if (/non|false|0|faux/.test(n)) ['non admis','sans admission','pas accepte','pas acceptée','pas de proposition acceptee'].forEach(a => aliases.add(plannerNorm(a)));
  }

  if (kind === 'boursier') {
    if (/oui|true|1|vrai/.test(n)) ['boursier','boursiers','bourse','avec bourse'].forEach(a => aliases.add(plannerNorm(a)));
    if (/non|false|0|faux/.test(n)) ['non boursier','non boursiers','sans bourse'].forEach(a => aliases.add(plannerNorm(a)));
  }

  if (kind === 'basque_zone') {
    if (/oui|true|1|vrai/.test(n)) ['basque','pays basque','zone basque','zone du pays basque','candidats basques'].forEach(a => aliases.add(plannerNorm(a)));
    if (/non|false|0|faux/.test(n)) ['hors pays basque','non basque','hors zone basque'].forEach(a => aliases.add(plannerNorm(a)));
  }

  // Alias réduit : mots significatifs de valeurs longues.
  const toks = plannerTokens(raw).filter(t => !/^(les|des|du|de|la|le|et|en|avec|sans|pour|dans|sur|aux|une|un|par)$/.test(t));
  if (toks.length >= 2 && toks.length <= 8) aliases.add(toks.join(' '));
  return [...aliases].filter(Boolean);
}

function plannerQuestionContainsAlias(qNorm, alias) {
  const a = plannerNorm(alias);
  if (!a || a.length < 2) return false;
  if (qNorm.includes(a)) return true;
  const toks = a.split(/\s+/).filter(t => t.length >= 3);
  return toks.length >= 2 && toks.every(t => qNorm.includes(t));
}

function addPlannerFilter(filters, col, value, reason, confidence = 0.8, op = 'eq') {
  if (!col || value === undefined || value === null || String(value).trim() === '') return;
  if (filters.some(f => f.col === col && f.op === op)) return;
  filters.push({ col, value: String(value).trim(), op, reason, confidence });
}

function detectPlannerTool(question) {
  const q = plannerNorm(question);
  if (/export|excel|xlsx|csv|telecharg|t[eé]l[eé]charg|extraire|extrait|liste|sors|sortir/.test(q)) {
    return /\bcsv\b/.test(q) ? 'export_csv' : 'export_excel';
  }
  if (/croise|crois[eé]|tableau croise|pivot|croisement/.test(q)) return 'pivot';
  if (/repartition|r[eé]partition|ventilation|par\s+[a-z]|groupe|group[eé]|top|classement|pourcentage|proportion/.test(q)) return 'group_by';
  if (/combien|nombre|effectif|compte|compter|total/.test(q)) return 'count_rows';
  return null;
}

function detectPlannerTargetColumn(table, question, tool, filters) {
  const headers = (table?.headers || Object.keys(table?.objects?.[0] || {})).filter(Boolean);
  const q = plannerNorm(question);
  if (tool !== 'group_by' && tool !== 'pivot') return null;

  // Expressions explicites : "par académie", "par série", etc.
  const mentioned = typeof findMentionedColumns === 'function' ? findMentionedColumns(headers, question, 5) : [];
  const filteredCols = new Set((filters || []).map(f => f.col));
  const candidate = mentioned.find(c => !filteredCols.has(c));
  if (candidate) return candidate;

  if (typeof detectTargetColumn === 'function') return detectTargetColumn(headers, q);
  return null;
}

function buildPlannerPlan(question, filterContextText, table, forcedTool = null) {
  if (!table || !table.objects || !table.objects.length) return null;
  const qNorm = plannerNorm(filterContextText || question);
  const headers = (table.headers || Object.keys(table.objects[0] || {})).filter(h => h && !/^(id|manualSort)$/i.test(String(h)));
  const tool = forcedTool || detectPlannerTool(question);
  if (!tool) return null;

  const catalog = buildPlannerCatalog(table);
  const filters = [];
  const reasons = [];

  // 1) Détection par alias structurés colonne/valeur.
  catalog.forEach(entry => {
    if (filters.some(f => f.col === entry.column)) return;
    const values = entry.values || [];
    for (const item of values) {
      const aliases = plannerValueAliases(entry.column, item.value);
      const hit = aliases.find(a => plannerQuestionContainsAlias(qNorm, a));
      if (hit) {
        addPlannerFilter(filters, entry.column, item.value, `alias détecté : « ${hit} »`, 0.92);
        reasons.push(`« ${hit} » ⇒ ${entry.column} = ${item.value}`);
        break;
      }
    }
  });

  // 2) Filet de sécurité : ancienne détection de filtres, en complément.
  if (typeof detectFilters === 'function') {
    const legacy = detectFilters(table, qNorm, null) || [];
    legacy.forEach(f => {
      if (!filters.some(x => x.col === f.col && x.op === f.op)) {
        addPlannerFilter(filters, f.col, f.value, f.reason || 'détection historique', 0.72, f.op || 'eq');
        reasons.push(`${f.reason || 'détection historique'} ⇒ ${f.col} = ${f.value}`);
      }
    });
  }

  const targetCol = detectPlannerTargetColumn(table, question, tool, filters);
  const mentionedCols = typeof findMentionedColumns === 'function' ? findMentionedColumns(headers, question, 6) : [];
  const confidence = Math.min(0.98, 0.55 + Math.min(filters.length, 4) * 0.12 + (targetCol ? 0.08 : 0));

  return {
    tool,
    table,
    filters,
    targetCol,
    mentionedCols,
    question,
    planner: {
      version: 'v17-planner-v1',
      confidence,
      reasons,
      catalogColumns: catalog.length
    },
    createdAt: new Date().toISOString()
  };
}

function plannerPlanToDebugHtml(plan) {
  const p = plan?.planner;
  if (!p) return '';
  const reasons = (p.reasons || []).length
    ? `<ul>${p.reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`
    : '<p>—</p>';
  return `<div style="font-size:10px;line-height:1.5;margin-top:6px"><strong>Planner</strong> : ${escapeHtml(p.version)} · confiance ${(p.confidence*100).toFixed(0)} %<br><strong>Raisons</strong>${reasons}</div>`;
}
