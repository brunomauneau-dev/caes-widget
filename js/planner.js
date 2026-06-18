/* planner.js — Planner V1.1 pour Parcoursup Data Copilot.
   Rôle : transformer une question en plan d'exécution exploitable par le Data Engine.
   Correctifs V1.1 :
   - évite les filtres parasites issus de valeurs génériques (Bordeaux, Oui, etc.) ;
   - comprend "hors académie de Bordeaux" comme Académie d'accueil acceptée ≠ Bordeaux ;
   - évite de transformer "hors académie ... Pays Basque" en Zone du Pays Basque = non ;
   - ajoute une étape de validation/pertinence des colonnes avant d'ajouter un filtre.
*/

function plannerNorm(s) {
  return normalizeText(String(s ?? ''));
}

function plannerTokens(s) {
  return plannerNorm(s).split(/[^a-z0-9]+/).filter(t => t.length >= 2);
}

const PLANNER_STOPWORDS = new Set('les des du de la le et en avec sans pour dans sur aux une un par au a qui que quoi dont est sont ayant avoir d un d une l'.split(/\s+/));

function plannerColumnKind(col) {
  const n = plannerNorm(col);
  if (/zone.*pays.*basque|pays.*basque/.test(n)) return 'basque_zone';
  if (/s[eé]rie.*classe|serie.*classe|type.*classe|type.*bac|serie/.test(n)) return 'bac_series';
  if (/boursier/.test(n) && !/lycee|lyc[eé]e/.test(n)) return 'boursier';
  if (/acad[eé]mie|academie/.test(n)) return 'academie';
  if (/commune/.test(n)) return 'commune';
  if (/departement|d[eé]partement/.test(n)) return 'departement';
  if (/formation|specialite|sp[eé]cialit[eé]|mention|groupe/.test(n)) return 'formation';
  if (/proposition|favorable|accept|admission/.test(n)) return 'admission';
  if (/apprenti|apprentissage/.test(n)) return 'apprentissage';
  if (/voeu|vœu|voeux|vœux/.test(n)) return 'voeu';
  if (/sexe/.test(n)) return 'sexe';
  return 'generic';
}

function plannerColumnRole(col) {
  const n = plannerNorm(col);
  return {
    accueil: /accueil|acceptee|accept[eé]e|affectation/.test(n),
    scolarite: /scolarite|origine|lycee|établissement d'origine|etablissement d origine/.test(n),
    etablissement: /etablissement|[eé]tablissement/.test(n)
  };
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
    const values = plannerValues(table, col, 100);
    const filled = values.reduce((s, x) => s + (x.count || 0), 0);
    return { column: col, kind: plannerColumnKind(col), role: plannerColumnRole(col), values, filled, distinctShown: values.length };
  });
}

function plannerValueAliases(col, value) {
  const kind = plannerColumnKind(col);
  const raw = String(value ?? '').trim();
  const n = plannerNorm(raw);
  const aliases = new Set([n]);

  if (kind === 'bac_series') {
    if (/^s[eé]rie\s+g[eé]n[eé]rale$|^g[eé]n[eé]rale?$|general|generale/.test(n)) {
      ['general','generale','bac general','bac generale','serie generale','voie generale','filiere generale','bac g','serie g'].forEach(a => aliases.add(plannerNorm(a)));
    }
    if (/professionnel|professionnelle|\bpro\b/.test(n)) {
      ['professionnel','professionnelle','bac pro','bac professionnel','bac professionnelle','serie professionnelle','voie professionnelle'].forEach(a => aliases.add(plannerNorm(a)));
    }
    if (/technologique|techno|stmg|sti2d|std2a|stl|st2s|stav|s2tmd/.test(n)) {
      ['technologique','techno','bac techno','bac technologique','serie technologique','voie technologique'].forEach(a => aliases.add(plannerNorm(a)));
    }
    ['stmg','sti2d','std2a','stl','st2s','stav','s2tmd'].forEach(x => { if (n.includes(x)) aliases.add(x); });
  }

  if (kind === 'sexe') {
    if (/f[eé]minin|femme|fille/.test(n)) ['feminin','femme','femmes','fille','filles'].forEach(a => aliases.add(plannerNorm(a)));
    if (/masculin|homme|garcon/.test(n)) ['masculin','homme','hommes','garcon','garcons'].forEach(a => aliases.add(plannerNorm(a)));
  }

  if (kind === 'admission') {
    if (/oui|true|1|vrai/.test(n)) ['admis','admission','accepté','accepte','acceptée','acceptee','réponse favorable','reponse favorable','proposition acceptee','ayant accepté','ayant accepte'].forEach(a => aliases.add(plannerNorm(a)));
    if (/non|false|0|faux/.test(n)) ['non admis','sans admission','pas accepte','pas acceptée','pas de proposition acceptee'].forEach(a => aliases.add(plannerNorm(a)));
  }

  if (kind === 'boursier') {
    if (/oui|true|1|vrai/.test(n)) ['boursier','boursiers','bourse','avec bourse'].forEach(a => aliases.add(plannerNorm(a)));
    if (/non|false|0|faux/.test(n)) ['non boursier','non boursiers','sans bourse'].forEach(a => aliases.add(plannerNorm(a)));
  }

  if (kind === 'apprentissage') {
    if (/oui|true|1|vrai/.test(n)) ['apprenti','apprentis','apprentissage','en apprentissage'].forEach(a => aliases.add(plannerNorm(a)));
    if (/non|false|0|faux/.test(n)) ['non apprenti','hors apprentissage','pas apprenti'].forEach(a => aliases.add(plannerNorm(a)));
  }

  if (kind === 'basque_zone') {
    if (/oui|true|1|vrai/.test(n)) ['basque','pays basque','zone basque','zone du pays basque','candidats basques'].forEach(a => aliases.add(plannerNorm(a)));
    if (/non|false|0|faux/.test(n)) ['hors pays basque','non basque','hors zone basque'].forEach(a => aliases.add(plannerNorm(a)));
  }

  // Alias réduit uniquement pour valeurs longues et spécifiques.
  const toks = plannerTokens(raw).filter(t => !PLANNER_STOPWORDS.has(t));
  if (toks.length >= 2 && toks.length <= 8) aliases.add(toks.join(' '));
  return [...aliases].filter(Boolean);
}

function plannerQuestionContainsAlias(qNorm, alias) {
  const a = plannerNorm(alias);
  if (!a || a.length < 2) return false;

  // Pour les alias négatifs (hors/non/sans/pas), ne pas utiliser le matching par tokens,
  // sinon "hors académie de Bordeaux" + "Pays Basque" déclenche à tort "hors pays basque".
  if (/^(hors|non|sans|pas)\b/.test(a)) return qNorm.includes(a);

  if (qNorm.includes(a)) return true;
  const toks = a.split(/\s+/).filter(t => t.length >= 3 && !PLANNER_STOPWORDS.has(t));
  // Matching approximatif réservé aux alias longs non ambigus.
  return toks.length >= 3 && toks.every(t => qNorm.includes(t));
}

function plannerColumnContextScore(entry, qNorm) {
  const colNorm = plannerNorm(entry.column);
  const kind = entry.kind;
  let score = 0;
  if (qNorm.includes(colNorm)) score += 100;
  const colToks = colNorm.split(/\s+/).filter(t => t.length >= 4 && !PLANNER_STOPWORDS.has(t));
  colToks.forEach(t => { if (qNorm.includes(t)) score += 6; });

  if (kind === 'basque_zone' && /basque|pays basque/.test(qNorm)) score += 80;
  if (kind === 'bac_series' && /(bac|s[eé]rie|serie|voie|g[eé]n[eé]ral|general|technologique|professionnel|stmg|sti2d|std2a)/.test(qNorm)) score += 70;
  if (kind === 'boursier' && /boursier|bourse/.test(qNorm)) score += 70;
  if (kind === 'apprentissage' && /apprenti|apprentissage/.test(qNorm)) score += 70;
  if (kind === 'admission' && /admis|admission|accept|favorable|proposition/.test(qNorm)) score += 60;
  if (kind === 'academie' && /acad[eé]mie|academie/.test(qNorm)) score += 70;
  if (kind === 'departement' && /d[eé]partement|departement/.test(qNorm)) score += 60;
  if (kind === 'commune' && /commune|ville/.test(qNorm)) score += 50;
  if (kind === 'formation' && /formation|fili[eè]re|sp[eé]cialit[eé]|mention|bts|but|licence|cpge|l1/.test(qNorm)) score += 45;

  // Lorsqu'on parle de "formation choisie/acceptée", préférer les colonnes d'accueil acceptées.
  if (entry.role.accueil && /(formation|choisi|choisie|accept[eé]|acceptee|admis|admission|accueil|affectation)/.test(qNorm)) score += 20;
  if (entry.role.scolarite && /(formation|choisi|choisie|accept[eé]|acceptee|accueil|affectation)/.test(qNorm)) score -= 30;
  return score;
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

function findPlannerValue(entry, wantedNorm) {
  const vals = entry.values || [];
  return vals.find(x => plannerNorm(x.value) === wantedNorm) ||
         vals.find(x => plannerNorm(x.value).includes(wantedNorm) || wantedNorm.includes(plannerNorm(x.value))) ||
         null;
}

function bestCatalogEntry(catalog, predicate, qNorm, extraScore = () => 0) {
  const scored = catalog.filter(predicate).map(e => ({ e, score: plannerColumnContextScore(e, qNorm) + extraScore(e) }));
  scored.sort((a,b) => b.score - a.score);
  return scored[0]?.e || null;
}

function addSpecialPlannerFilters(catalog, qNorm, filters, reasons) {
  // Zone Pays Basque : positif sauf si l'expression négative exacte apparaît.
  if (/basque|pays basque/.test(qNorm)) {
    const entry = catalog.find(e => e.kind === 'basque_zone');
    if (entry) {
      const isNegative = /hors pays basque|hors zone basque|non basque/.test(qNorm);
      const wanted = isNegative ? 'non' : 'oui';
      const hit = findPlannerValue(entry, wanted) || entry.values.find(x => /^(oui|non|yes|no|true|false|1|0)$/i.test(String(x.value)));
      if (hit) {
        addPlannerFilter(filters, entry.column, hit.value, isNegative ? 'zone basque explicitement négative' : 'zone Pays Basque demandée', 0.97);
        reasons.push(`${isNegative ? '« hors/non basque »' : '« Pays Basque »'} ⇒ ${entry.column} = ${hit.value}`);
      }
    }
  }

  // Bac général / techno / pro.
  const bacEntry = catalog.find(e => e.kind === 'bac_series');
  if (bacEntry && /(bac|s[eé]rie|serie|voie|g[eé]n[eé]ral|general|technologique|professionnel|\bpro\b|stmg|sti2d|std2a)/.test(qNorm)) {
    let wanted = null;
    if (/bac\s+g[eé]n[eé]ral|bac\s+general|voie\s+g[eé]n[eé]rale|s[eé]rie\s+g[eé]n[eé]rale|\bg[eé]n[eé]ral(e)?\b/.test(qNorm)) wanted = 'generale';
    else if (/bac\s+pro|bac\s+professionnel|voie\s+professionnelle|s[eé]rie\s+professionnelle|\bprofessionnel(le)?\b/.test(qNorm)) wanted = 'professionnelle';
    else if (/bac\s+techno|bac\s+technologique|voie\s+technologique|s[eé]rie\s+technologique|\btechnologique\b/.test(qNorm)) wanted = 'technologique';
    else {
      const short = ['stmg','sti2d','std2a','stl','st2s','stav','s2tmd'].find(x => qNorm.includes(x));
      if (short) wanted = short;
    }
    if (wanted) {
      const hit = findPlannerValue(bacEntry, wanted);
      if (hit) {
        addPlannerFilter(filters, bacEntry.column, hit.value, `série/type de bac détecté : ${wanted}`, 0.97);
        reasons.push(`« ${wanted} » ⇒ ${bacEntry.column} = ${hit.value}`);
      }
    }
  }

  // Hors académie de Bordeaux : choisir une colonne Académie d'accueil/acceptée, pas commune ni scolarité.
  if (/(hors|autre|sauf|different|differente|diff[eé]rente|pas).*acad[eé]mie.*bordeaux|acad[eé]mie.*(hors|autre|sauf|different|differente).*bordeaux|hors\s+bordeaux/.test(qNorm)) {
    const entry = bestCatalogEntry(
      catalog,
      e => e.kind === 'academie',
      qNorm,
      e => (e.role.accueil ? 80 : 0) + (/accept|acceptee|accueil/.test(plannerNorm(e.column)) ? 30 : 0) - (e.role.scolarite ? 80 : 0)
    );
    if (entry) {
      const bdx = findPlannerValue(entry, 'bordeaux');
      if (bdx) {
        addPlannerFilter(filters, entry.column, bdx.value, 'hors académie de Bordeaux', 0.98, 'neq');
        reasons.push(`« hors académie de Bordeaux » ⇒ ${entry.column} ≠ ${bdx.value}`);
      }
    }
  }
}

function detectPlannerTargetColumn(table, question, tool, filters) {
  const headers = (table?.headers || Object.keys(table?.objects?.[0] || {})).filter(Boolean);
  const q = plannerNorm(question);
  if (tool !== 'group_by' && tool !== 'pivot') return null;

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

  // 1) Filtres métier/grammaticaux prioritaires.
  addSpecialPlannerFilters(catalog, qNorm, filters, reasons);

  // 2) Détection par alias structurés, uniquement si la colonne est pertinente dans la question.
  catalog.forEach(entry => {
    if (filters.some(f => f.col === entry.column)) return;
    const contextScore = plannerColumnContextScore(entry, qNorm);
    // Les colonnes génériques ne sont jamais filtrées par simple valeur mentionnée.
    if (entry.kind === 'generic' && contextScore < 80) return;
    // Pour académie/commune/département, exiger que le type de colonne soit mentionné.
    if (['academie','commune','departement'].includes(entry.kind) && contextScore < 55) return;

    const values = entry.values || [];
    for (const item of values) {
      const aliases = plannerValueAliases(entry.column, item.value);
      const hit = aliases.find(a => plannerQuestionContainsAlias(qNorm, a));
      if (hit) {
        // Ne pas ajouter Bordeaux comme filtre positif si la demande dit "hors académie de Bordeaux".
        if (plannerNorm(item.value) === 'bordeaux' && /(hors|autre|sauf|different|differente|pas).*bordeaux/.test(qNorm)) continue;
        addPlannerFilter(filters, entry.column, item.value, `alias détecté : « ${hit} »`, Math.min(0.94, 0.65 + contextScore / 300));
        reasons.push(`« ${hit} » ⇒ ${entry.column} = ${item.value}`);
        break;
      }
    }
  });

  // 3) Fallback historique uniquement si le nouveau planner n'a rien trouvé.
  if (!filters.length && typeof detectFilters === 'function') {
    const legacy = detectFilters(table, qNorm, null) || [];
    legacy.forEach(f => {
      addPlannerFilter(filters, f.col, f.value, f.reason || 'détection historique', 0.68, f.op || 'eq');
      reasons.push(`${f.reason || 'détection historique'} ⇒ ${f.col} ${f.op === 'neq' ? '≠' : '='} ${f.value}`);
    });
  }

  const targetCol = detectPlannerTargetColumn(table, question, tool, filters);
  const mentionedCols = typeof findMentionedColumns === 'function' ? findMentionedColumns(headers, question, 6) : [];
  const avgConf = filters.length ? filters.reduce((s, f) => s + (f.confidence || 0.75), 0) / filters.length : 0.55;
  const confidence = Math.min(0.99, avgConf + (targetCol ? 0.03 : 0));

  return {
    tool,
    table,
    filters,
    targetCol,
    mentionedCols,
    question,
    planner: {
      version: 'v17-planner-v1.1',
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
