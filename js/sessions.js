/* sessions.js — Sessions, filtres persistants, infographic composer
   Dépend de : config.js, documents.js, infographic.js */

/* ═══════════════ SESSIONS & FILTRES PERSISTANTS ═══════════════ */
// ── _generateInfographicFromComposer ──
async function _generateInfographicFromComposer(question, composerCtx, theme) {
  const prompt = `Tu es un directeur artistique, data analyst et rédacteur institutionnel Parcoursup.
Produis une SPECIFICATION JSON pour une infographie adaptive. Ne produis PAS de HTML. Réponds UNIQUEMENT par du JSON valide.
Les couleurs DOIVENT être exactement : "accent":"${theme.accent}", "secondary":"${theme.secondary}".
Schéma :
{"title":"...","subtitle":"...","eyebrow":"...","accent":"${theme.accent}","secondary":"${theme.secondary}","metrics":[{"label":"...","value":"...","detail":"..."}],"narrative":["..."],"sections":[{"type":"ranking|bars|comparison|kpi_grid|insights|stacked","title":"...",...}],"footer":"..."}
Règles ABSOLUES :
- Infographie narrative avec fil conducteur clair, max 7 sections non redondantes.
- N'invente aucun chiffre. Utilise SEULEMENT les données fournies ci-dessous.
- INTERDIT ABSOLU : Ne jamais utiliser de label générique comme "Item 1", "Item 2", "Item 3", "Analyse 1", "Catégorie X", "Label", "Valeur", "Périmètre", "Section X". Chaque label doit être extrait LITTÉRALEMENT des données fournies (ex : "Bordeaux", "Toulouse", "CPGE - CPES"). Si tu ne trouves pas de label dans les données, omets l'item entier.
- INTERDIT : champs vides (""), valeurs "...", titres génériques comme "À retenir" sans texte, cards insights sans contenu réel.
- Chaque card insights DOIT avoir un champ "text" non vide (minimum 15 mots) avec une vraie analyse ou interprétation issue des données.
- Si tu n'as pas assez de données pour remplir une section complètement, réduis le nombre d'items plutôt que de laisser des champs vides.
- Toutes les sections doivent avoir uniquement des items avec titre ET texte/valeur réels.

EXEMPLES (à suivre strictement) :

✅ BON — section ranking avec labels issus des données :
{"type":"ranking","title":"Académies d'accueil","items":[{"label":"Bordeaux","value":"1 789","percent":"75,5 %"},{"label":"Toulouse","value":"253","percent":"10,7 %"},{"label":"Paris","value":"68","percent":"2,9 %"}]}

✅ BON — section insights avec vraie analyse (text > 15 mots) :
{"type":"insights","title":"Points saillants","items":[{"title":"Concentration académique","text":"75,5 % des candidats du Pays Basque restent dans l'académie de Bordeaux, contre 10,7 % qui rejoignent Toulouse — un ancrage territorial marqué."}]}

❌ MAUVAIS — ne jamais produire ceci :
{"type":"ranking","title":"Répartition","items":[{"label":"Item 1","value":"..."},{"label":"Catégorie X","value":""},{"label":"Analyse 1","value":"N/A"}]}

DONNÉES :\n${composerCtx}`;
  const resp = await fetch(albertConfig.endpoint, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ model: albertConfig.model, messages:[{role:'system',content:prompt},{role:'user',content:`Génère l'infographie : ${question}`}], temperature:0.2 })
  });
  if (!resp.ok) throw new Error(`Erreur ${resp.status}`);
  const data = await resp.json();
  let spec;
  try { spec = parseJsonLoose(data.choices?.[0]?.message?.content || ''); } catch(e) { spec = buildFallbackInfographicSpec(question); }
  spec.accent = theme.accent; spec.secondary = theme.secondary;
  // Normalisation complète : filtre les sections vides et les labels génériques
  if (typeof normalizeInfographicSpec === 'function') spec = normalizeInfographicSpec(spec, question) || spec;
  return { spec, html: renderAdaptiveInfographicHtml(spec, question) };
}


// ── _icMoveBlock ──
function _icMoveBlock(from, to) {
  if (from === null || from === to) return;
  const [moved] = _icState.blocks.splice(from, 1);
  _icState.blocks.splice(to, 0, moved);
  _icState.dragSrcIdx = null;
  _icState.editingIdx = null;
  _icRenderBlocks();
}


// ── _icRenderBlocks ──
function _icRenderBlocks() {
  const container = document.getElementById('ic-blocks');
  if (!container) return;
  container.innerHTML = '';
  if (!_icState.blocks.length) {
    container.innerHTML = '<div class="ic-empty">Aucun résultat Data Engine disponible dans cette session.</div>';
    return;
  }
  _icState.blocks.forEach((b, i) => {
    const el = document.createElement('div');
    el.className = 'ic-block';
    el.draggable = _icState.editingIdx !== i;
    el.dataset.idx = String(i);
    const isEditing = _icState.editingIdx === i;
    const titleHtml = isEditing
      ? `<div class="ic-block-title ic-block-title-editing">
           <input type="text" class="ic-block-title-input" id="ic-title-input-${i}" value="${escapeHtml(b.title)}"
             onkeydown="_icTitleInputKeydown(event, ${i})" onblur="_icCommitRenameBlock(${i}, this.value)">
         </div>`
      : `<div class="ic-block-title">
           <span class="ic-block-title-text">${escapeHtml(b.title)}</span>
           <button type="button" class="ic-block-title-edit-btn" title="Renommer" onclick="_icStartRenameBlock(${i})">✎</button>
           ${b.title !== b.originalTitle ? `<button type="button" class="ic-block-title-reset-btn" title="Revenir au titre original : « ${escapeHtml(b.originalTitle || '')} »" onclick="_icResetBlockTitle(${i})">↺</button>` : ''}
         </div>`;
    el.innerHTML = `<span class="ic-block-handle" title="Glisser pour réordonner">⠿</span>
      <input class="ic-block-check" type="checkbox" ${b.checked ? 'checked' : ''} onchange="icToggleBlock(${i},this.checked)">
      <div class="ic-block-label">
        ${titleHtml}
        <div class="ic-block-sub">${escapeHtml(b.question || '')}</div>
      </div>`;
    el.addEventListener('dragstart', e => { _icState.dragSrcIdx = i; el.classList.add('ic-dragging'); e.dataTransfer.effectAllowed = 'move'; });
    el.addEventListener('dragend', () => { el.classList.remove('ic-dragging'); container.querySelectorAll('.ic-block').forEach(x => x.classList.remove('ic-drag-over')); });
    el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('ic-drag-over'); });
    el.addEventListener('dragleave', () => el.classList.remove('ic-drag-over'));
    el.addEventListener('drop', e => { e.preventDefault(); el.classList.remove('ic-drag-over'); _icMoveBlock(_icState.dragSrcIdx, i); });
    container.appendChild(el);
  });
  _icUpdateSummary();
  if (_icState.editingIdx !== null && _icState.editingIdx !== undefined) {
    const input = document.getElementById(`ic-title-input-${_icState.editingIdx}`);
    if (input) { input.focus(); input.select(); }
  }
}


// ── _icStartRenameBlock ──
function _icStartRenameBlock(idx) {
  if (!_icState.blocks[idx]) return;
  _icState.editingIdx = idx;
  _icRenderBlocks();
}


// ── _icTitleInputKeydown ──
function _icTitleInputKeydown(e, idx) {
  if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  else if (e.key === 'Escape') { e.preventDefault(); _icCancelRenameBlock(idx); }
}


// ── _icCancelRenameBlock ──
function _icCancelRenameBlock(idx) {
  _icState.editingIdx = null;
  _icRenderBlocks();
}


// ── _icCommitRenameBlock ──
function _icCommitRenameBlock(idx, rawValue) {
  const b = _icState.blocks[idx];
  if (!b) { _icState.editingIdx = null; return; }
  const cleaned = String(rawValue == null ? '' : rawValue).replace(/\s+/g, ' ').trim();
  b.title = cleaned || b.title;
  _icState.editingIdx = null;
  _icPersistBlockTitle(b);
  _icRenderBlocks();
}


// ── _icResetBlockTitle ──
function _icResetBlockTitle(idx) {
  const b = _icState.blocks[idx];
  if (!b) return;
  b.title = b.originalTitle || b.title;
  _icState.editingIdx = null;
  _icPersistBlockTitle(b);
  _icRenderBlocks();
}


// ── _icPersistBlockTitle ──
// Répercute le titre édité sur les sources du bloc (liste globale + session)
// afin que le renommage survive à une réouverture du compositeur.
function _icPersistBlockTitle(block) {
  if (!block || !block.id) return;
  if (Array.isArray(window._copilotDataBlocks)) {
    const gb = window._copilotDataBlocks.find(x => x && x.id === block.id);
    if (gb) gb.title = block.title;
  }
  const session = (typeof getCurrentSession === 'function') ? getCurrentSession() : null;
  if (session && Array.isArray(session.dataBlocks)) {
    const sb = session.dataBlocks.find(x => x && x.id === block.id);
    if (sb) sb.title = block.title;
  }
  if (typeof scheduleSessionsSave === 'function') scheduleSessionsSave();
}


// ── _icRenderThemes ──
function _icRenderThemes() {
  const container = document.getElementById('ic-themes');
  if (!container) return;
  container.innerHTML = INFOGRAPH_THEMES.map(t =>
    `<div class="ic-theme-swatch ${_icState.theme === t.id ? 'ic-active' : ''}" onclick="icSelectTheme('${t.id}')">
      <span class="ic-theme-dot" style="background:${t.accent}"></span>${escapeHtml(t.label)}
    </div>`
  ).join('');
}


// ── _icUpdateSummary ──
function _icUpdateSummary() {
  const n = _icState.blocks.filter(b => b.checked).length;
  const el = document.getElementById('ic-summary');
  if (el) el.textContent = n === 0 ? 'Aucun bloc sélectionné' : `${n} bloc${n > 1 ? 's' : ''} sélectionné${n > 1 ? 's' : ''}`;
  const btn = document.getElementById('ic-submit');
  if (btn) btn.disabled = n === 0;
}


// ── _shortColName ──
function _shortColName(col) {
  return (col || '')
    .replace(/grands?\s+groupes?\s+de\s+formation[^|]*/i, 'Grands groupes')
    .replace(/acad[eé]mie.*accueil.*/i, 'Académies')
    .replace(/s[eé]rie de la classe/i, 'Séries')
    .replace(/sp[eé]cialit[eé]\s*\/\s*mention.*/i, 'Spécialité')
    .replace(/\s+d['']accueil accept[eé]e?/i, '')
    .replace(/\s+de l'[eé]tablissement[^|]*/i, '')
    .trim();
}


// ── _shortFilterValue ──
function _shortFilterValue(f) {
  const col = normalizeText(f.col || '');
  const v = String(f.value || '');
  if (/basque/.test(col) && /oui/i.test(v)) return 'basques';
  if (/boursier/.test(col) && /boursier des lyc/i.test(v)) return 'boursiers';
  if (/boursier/.test(col) && /non/i.test(v)) return 'non-boursiers';
  if (/boursier/.test(col)) return 'boursiers';
  if (/cpge|cpes/i.test(v)) return 'CPGE';
  if (/\bbts\b|\bbtsa\b/i.test(v)) return 'BTS';
  if (/\bdut\b|\bbut\b/i.test(v)) return 'DUT';
  if (/l1|cupge|deust/i.test(v)) return 'L1';
  if (/ing[eé]nieur/i.test(v)) return 'Ingénieurs';
  if (/sanitaire|social/i.test(v)) return 'Sanitaire-social';
  if (/commerce/i.test(v)) return 'Commerce';
  return v.length > 22 ? v.slice(0, 21) + '…' : v;
}


// ── addPersistentFilter ──
function addPersistentFilter(col, value, op = 'eq', label = null) {
  const key = `${col}::${op}::${String(value)}`;
  if (persistentFilters.some(f => `${f.col}::${f.op || 'eq'}::${String(f.value)}` === key)) return;
  persistentFilters.push({ col, value, op: op || 'eq', label: label || value });
  renderPersistentFiltersBar();
  scheduleSessionsSave();
}


// ── buildCopilotActionBar ──
function buildCopilotActionBar(bubble, dataExecution = null, question = '') {
  const bar = document.createElement('div');
  bar.className = 'copilot-actions';
  const mk = (label, title, fn) => {
    const b = document.createElement('button');
    b.className = 'copilot-action';
    b.type = 'button';
    b.textContent = label;
    b.title = title || label;
    b.onclick = (e) => { e.stopPropagation(); fn(b); };
    return b;
  };
  bar.appendChild(mk('📊 Graphique', 'Afficher un graphique sur le résultat courant', () => quickAsk('Graphique')));
  if (dataExecution) {
    bar.appendChild(mk('🖼 Infographie', 'Générer une infographie à partir de ce résultat uniquement', async (btn) => {
    const originalLabel = btn.textContent;
    btn.textContent = '⏳ Génération…';
    btn.disabled = true;
    try {
      const localAnalysis = (typeof executeLocalDataQuery === 'function') ? executeLocalDataQuery(question, question) : {};
      const html = await generateInfographicWithAlbert(question || 'Infographie de ce résultat', localAnalysis, dataExecution);
      addInfographicMessage(html, 'Infographie de ce bloc');
    } catch (e) {
      addMessage('assistant', `<p style="color:var(--rouge)"><strong>Erreur pendant la génération de l'infographie</strong><br>${e.message}</p>`);
    } finally {
      btn.textContent = originalLabel;
      btn.disabled = false;
    }
  }));
  }
  bar.appendChild(mk('📄 Excel', 'Exporter le résultat courant en Excel', () => quickAsk('Exporte en Excel')));
  bar.appendChild(mk('🖨 PDF', 'Imprimer / exporter en PDF', () => window.print()));
  bar.appendChild(mk('📋 Copier', 'Copier le rapport', async () => {
    const text = bubble.innerText || bubble.textContent || '';
    try { await navigator.clipboard.writeText(text); } catch(e) { console.warn(e); }
  }));
  // Bouton épingler les filtres du résultat courant
  bar.appendChild(mk('📌 Filtres', 'Épingler les filtres de ce résultat pour toutes les prochaines questions', () => {
    const state = (typeof getDataEngineState === 'function') ? getDataEngineState() : null;
    const filters = state?.lastExecution?.plan?.filters || state?.lastPlan?.filters || [];
    if (!filters.length) { alert('Aucun filtre à épingler sur ce résultat.'); return; }
    filters.forEach(f => {
      const label = `${f.col.replace(/ d[''].*$/i,'').replace(/Grands groupes.*/i,'Grands groupes').trim()} = ${f.value}`;
      addPersistentFilter(f.col, f.value, f.op || 'eq', label);
    });
  }));
  return bar;
}


// ── captureDataEngineStateForSession ──
function captureDataEngineStateForSession() {
  const state = (typeof getDataEngineState === 'function') ? getDataEngineState() : null;
  if (!state) return { lastPlan: null, lastExecution: null };
  return {
    lastPlan: sanitizePlanForStorage(state.lastPlan),
    lastExecution: sanitizeExecutionForStorage(state.lastExecution)
  };
}


// ── clearAllPersistentFilters ──
function clearAllPersistentFilters() {
  persistentFilters = [];
  renderPersistentFiltersBar();
  scheduleSessionsSave();
}


// ── closeInfographicComposer ──
function closeInfographicComposer() {
  document.getElementById('modal-ic').style.display = 'none';
}


// ── closeSessionsPanel ──
function closeSessionsPanel() {
  document.body.classList.remove('sessions-open');
  // Force-reset : garantit que l'input et le bouton d'envoi sont toujours
  // fonctionnels après fermeture du panneau, quelle qu'en soit la cause.
  const btnSend = document.getElementById('btn-send');
  if (btnSend) btnSend.disabled = false;
  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    chatInput.removeAttribute('disabled');
    setTimeout(() => { try { chatInput.focus(); } catch(e) {} }, 100);
  }
}


// ── closeSourcesPanel ──
function closeSourcesPanel() { document.body.classList.remove('sources-open'); }


// ── columnMentionScore ──
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


// ── createEmptySession ──
function createEmptySession(title) {
  const now = new Date().toISOString();
  return {
    id: newSessionId(),
    title: title || 'Nouvelle session',
    createdAt: now,
    updatedAt: now,
    messages: [],            // {type:'text'|'html'|'infographic', role?, text?, html?, title?, spec?, themeId?}
    chatHistoryData: [],     // copie de chatHistory (contexte texte envoyé à Albert)
    dataEngineState: { lastPlan: null, lastExecution: null },
    dataBlocks: [],          // [{id, title, question, dataContext}] — blocs réutilisables dans le compositeur
    persistentFilters: []    // [{col, value, op, label}] — filtres épinglés de la session
  };
}


// ── createNewSession ──
function createNewSession() {
  persistSessions();
  const s = createEmptySession();
  sessions.unshift(s);
  currentSessionId = s.id;
  try {
    renderActiveSession();
  } catch(e) {
    console.error('createNewSession: erreur pendant renderActiveSession', e);
  } finally {
    closeSessionsPanel();
    persistSessions();
    const input = document.getElementById('chat-input');
    if (input) setTimeout(() => input.focus(), 80);
  }
}


// ── deleteSession ──
function deleteSession(id, evt) {
  if (evt) evt.stopPropagation();
  if (!confirm('Supprimer définitivement cette session ?\n\nCette action est irréversible.')) return;
  const idx = sessions.findIndex(s => s.id === id);
  if (idx === -1) return;
  sessions.splice(idx, 1);
  if (id === currentSessionId) {
    if (!sessions.length) sessions.push(createEmptySession('Session 1'));
    sessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    currentSessionId = sessions[0].id;
    renderActiveSession();
  } else {
    renderSessionList();
  }
  persistSessions();
}


// ── executeLocalDataQueryWithPersistentFilters ──
function executeLocalDataQueryWithPersistentFilters(question, filterContextText) {
  const base = executeLocalDataQuery(question, filterContextText);
  if (!persistentFilters.length) return base;

  // Ré-exécute la requête en forçant les filtres persistants en plus des filtres
  // détectés naturellement par detectFilters.
  const tablesToUse = getActiveQueryTables();
  if (!tablesToUse.length) return base;

  const questionNorm = normalizeText(question);
  const filterContextNorm = normalizeText(filterContextText);

  let best = null;
  tablesToUse.forEach(table => {
    if (!table.objects || !table.objects.length) return;
    const targetCol = detectTargetColumn(table.headers, questionNorm);
    if (!targetCol) return;
    // Filtres naturels (depuis la question) + filtres persistants (épinglés)
    const naturalFilters = detectFilters(table, filterContextNorm, targetCol);
    const naturalKeys = new Set(naturalFilters.map(f => `${f.col}||${f.op||'eq'}||${String(f.value)}`));
    const extraFilters = persistentFilters.filter(f => !naturalKeys.has(`${f.col}||${f.op||'eq'}||${String(f.value)}`));
    const allFilters = [...naturalFilters, ...extraFilters];
    const sourceBoost = table.source === 'Grist' ? 1000 : 0;
    const score = sourceBoost + allFilters.length * 10 + (normalizeText(targetCol).includes('accueil') ? 4 : 0) + table.objects.length / 100000;
    if (!best || score > best.score) best = { table, targetCol, filters: allFilters, score };
  });

  if (!best) return base;

  // Si les filtres persistants n'ajoutent rien (déjà couverts), retourner le résultat de base
  const baseFilterKeys = new Set((base?.filters || []).map(f => `${f.col}||${f.op||'eq'}||${String(f.value)}`));
  const persistentAdded = persistentFilters.some(f => !baseFilterKeys.has(`${f.col}||${f.op||'eq'}||${String(f.value)}`));
  if (!persistentAdded) return base;

  const filteredRows = best.table.objects.filter(row =>
    best.filters.every(f => rowMatchesFilter(row, f))
  );
  if (!filteredRows.length) return {
    title: 'Requête locale Excel exécutée — aucun résultat',
    text: `Aucune ligne ne correspond aux filtres détectés.\nFiltres : ${best.filters.map(f => `${f.col} ${f.op === 'neq' ? '≠' : '='} "${f.value}"`).join(' ; ') || '(aucun)'}`,
    html: `<h4>Calcul local Excel</h4><p>Aucune ligne ne correspond aux filtres détectés.</p>`
  };

  const counts = new Map();
  let filled = 0;
  filteredRows.forEach(row => {
    const raw = row[best.targetCol];
    if (raw === undefined || raw === null || String(raw).trim() === '') return;
    filled++;
    const key = String(raw).trim();
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const rows = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'))
    .map(([value, count]) => ({ value, count, pct: filled ? count / filled * 100 : 0 }));

  const lines = rows.map(r => `- ${r.value}: ${r.count} (${r.pct.toFixed(1).replace('.', ',')} %)`);
  const filterLines = best.filters.map(f => `- ${f.col} ${f.op === 'neq' ? '≠' : '='} "${f.value}"`).join('\n') || '- Aucun filtre détecté';
  const sourceLabel = best.table.source || 'Données';
  const docLabel = best.table.docName ? `\nDocument : ${best.table.docName}` : '';
  const text = `=== RÉSULTAT CALCULÉ LOCALEMENT SUR LES LIGNES ${sourceLabel.toUpperCase()} ===\nSource : ${sourceLabel}${docLabel}\nTable/feuille : ${best.table.name}\nFiltres appliqués :\n${filterLines}\nColonne de répartition : ${best.targetCol}\nLignes retenues : ${filteredRows.length}\nValeurs renseignées dans la colonne de répartition : ${filled}\n\nRépartition :\n${lines.join('\n')}`;
  return { title: `Requête locale ${sourceLabel} exécutée`, text, rows, total: filteredRows.length, filled, filters: best.filters, targetCol: best.targetCol, question };
}


// ── extractBlockTitle ──
function extractBlockTitle(exec, question) {
  if (!exec) return question || 'Résultat';
  const tool = exec.plan?.tool || '';
  const col  = exec.plan?.targetCol || '';
  const col2 = exec.plan?.targetCol2 || '';
  const filters = exec.plan?.filters || [];

  // Résumé court des filtres (valeurs, pas noms de colonnes)
  const fSummary = filters.slice(0, 3).map(_shortFilterValue).join(' · ');
  const fPart = fSummary ? ` — ${fSummary}` : '';

  if (tool === 'count_rows') {
    const count = exec.result?.count ?? '';
    const n = Number(count).toLocaleString('fr-FR');
    return `${n} candidat${count > 1 ? 's' : ''}${fPart}`;
  }
  if (tool === 'compare') {
    const groups = (exec.plan?.compareGroups || []).map(g => g.label || '').filter(Boolean).join(' vs ');
    return groups ? `Comparaison : ${groups}${fPart}` : `Comparaison${fPart}`;
  }
  if (tool === 'pivot') {
    return `${_shortColName(col)} × ${_shortColName(col2)}${fPart}`;
  }
  if (col) {
    const total = exec.result?.total;
    const n = total ? ` (${Number(total).toLocaleString('fr-FR')})` : '';
    return `${_shortColName(col)}${n}${fPart}`;
  }
  return question || 'Résultat Data Engine';
}


// ── findMentionedColumns ──
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


// ── getCurrentSession ──
function getCurrentSession() {
  return sessions.find(s => s.id === currentSessionId) || null;
}


// ── icSelectTheme ──
function icSelectTheme(id) { _icState.theme = id; _icRenderThemes(); }


// ── icToggleBlock ──
function icToggleBlock(idx, checked) { if (_icState.blocks[idx]) { _icState.blocks[idx].checked = checked; _icUpdateSummary(); } }


// ── initSessions ──
async function initSessions() {
  await loadSessionsFromStorage();
  if (!sessions.length) sessions.push(createEmptySession('Session 1'));
  sessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  currentSessionId = sessions[0].id;
  renderActiveSession();
}


// ── injectPersistentFilters ──
function injectPersistentFilters(plan) {
  if (!plan || !persistentFilters.length) return plan;
  if (plan.tool === 'chart_current' || plan.tool === 'export_current_excel' || plan.tool === 'export_current_csv') return plan;
  if (typeof mergeFiltersUnique === 'function') {
    plan.filters = mergeFiltersUnique(persistentFilters, plan.filters || []);
  } else {
    // fallback si mergeFiltersUnique non dispo
    const existing = new Set((plan.filters || []).map(f => `${f.col}::${f.op||'eq'}::${f.value}`));
    persistentFilters.forEach(f => { if (!existing.has(`${f.col}::${f.op||'eq'}::${f.value}`)) plan.filters.push(f); });
  }
  return plan;
}


// ── loadSessionsFromStorage ──
async function loadSessionsFromStorage() {
  try {
    const res = await Storage.get(SESSIONS_STORAGE_KEY);
    const parsed = JSON.parse(res.value);
    if (Array.isArray(parsed)) sessions = parsed;
  } catch (e) {
    sessions = [];
  }
}


// ── newSessionId ──
function newSessionId() {
  return 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}


// ── openInfographicComposer ──
function openInfographicComposer(targetUid = null) {
  _icState.targetUid = targetUid || null;
  const session = getCurrentSession();
  // Fusion des deux sources : blocs globaux (sûrs) + blocs de session
  const globalBlocks = Array.isArray(window._copilotDataBlocks) ? window._copilotDataBlocks : [];
  const sessionBlocks = session?.dataBlocks || [];
  const seen = new Set();
  const allBlocks = [...globalBlocks, ...sessionBlocks]
    .filter(b => b && b.id && !seen.has(b.id) && seen.add(b.id));
  const blocks = allBlocks.map(b => ({ ...b, checked: true, originalTitle: b.title }));
  if (!blocks.length) {
    alert('Aucun résultat Data Engine dans cette session.\nPosez d\'abord des questions d\'analyse (répartitions, comptages, comparaisons...).');
    return;
  }
  _icState.blocks = blocks;
  _icState.dragSrcIdx = null;
  _icState.editingIdx = null;
  _icRenderBlocks();
  _icRenderThemes();
  document.getElementById('modal-ic').style.display = 'flex';
}


// ── openSessionsPanel ──
function openSessionsPanel() { renderSessionList(); document.body.classList.add('sessions-open'); }


// ── openSourcesPanel ──
function openSourcesPanel() { document.body.classList.add('sources-open'); }


// ── persistSessions ──
async function persistSessions() {
  const current = getCurrentSession();
  if (current) current.chatHistoryData = (typeof chatHistory !== 'undefined') ? chatHistory.slice() : current.chatHistoryData;
  if (current) current.dataEngineState = captureDataEngineStateForSession();
  if (current) current.persistentFilters = persistentFilters.slice();

  let payload;
  try {
    payload = JSON.stringify(sessions);
  } catch (e) {
    console.warn('Sérialisation des sessions impossible :', e);
    return;
  }
  // Garde-fou anti-saturation : 3 passes progressives, jamais sur la session active.
  // Chaque passe parcourt les sessions de la plus ancienne à la plus récente et
  // s'arrête dès que le payload repasse sous 4 Mo.
  // On utilise un tableau de fonctions de purge pour éviter la duplication et garantir
  // que la passe suivante ne démarre que si la passe courante n'a pas suffi.
  const LIMIT = 4 * 1024 * 1024;
  const purgePasses = [
    s => { s.dataEngineState = { lastPlan: null, lastExecution: null }; },
    s => { s.dataBlocks = []; },
    s => { s.messages = s.messages.filter(m => m.type !== 'infographic' && m.type !== 'html'); }
  ];
  if (payload.length > LIMIT) {
    const oldestFirst = [...sessions].sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt));
    for (const purge of purgePasses) {
      if (payload.length <= LIMIT) break;
      for (const s of oldestFirst) {
        if (s.id === currentSessionId) continue;
        purge(s);
        payload = JSON.stringify(sessions);
        if (payload.length <= LIMIT) break;
      }
    }
  }
  try {
    await Storage.set(SESSIONS_STORAGE_KEY, payload);
  } catch (e) {
    console.warn('Sauvegarde des sessions impossible (quota navigateur dépassé ?) :', e);
  }
}


// ── reattachTableToExecution ──
function reattachTableToExecution(exec) {
  if (!exec) return null;
  return { ...exec, plan: reattachTableToPlan(exec.plan) };
}


// ── reattachTableToPlan ──
function reattachTableToPlan(plan) {
  if (!plan) return null;
  const tables = (typeof getActiveQueryTables === 'function') ? getActiveQueryTables() : [];
  return { ...plan, table: tables[0] || null };
}


// ── recordSessionMessage ──
function recordSessionMessage(entry) {
  const s = getCurrentSession();
  if (!s) return;
  s.messages.push(entry);
  if ((!s.title || s.title === 'Nouvelle session') && entry.type === 'text' && entry.role === 'user') {
    s.title = entry.text.length > 48 ? entry.text.slice(0, 47) + '…' : entry.text;
  }
  s.updatedAt = new Date().toISOString();
  scheduleSessionsSave();
}


// ── removePersistentFilter ──
function removePersistentFilter(idx) {
  persistentFilters.splice(idx, 1);
  renderPersistentFiltersBar();
  scheduleSessionsSave();
}


// ── renderActiveSession ──
function renderActiveSession() {
  const session = getCurrentSession();
  if (!session) return;

  window.__DATA_ENGINE_STATE = {
    lastPlan: reattachTableToPlan(session.dataEngineState?.lastPlan),
    lastExecution: reattachTableToExecution(session.dataEngineState?.lastExecution),
    history: []
  };

  if (typeof chatHistory !== 'undefined') {
    chatHistory.length = 0;
    (session.chatHistoryData || []).forEach(m => chatHistory.push(m));
  }

  // Restaure les filtres persistants de la session
  persistentFilters = (session.persistentFilters || []).slice();
  renderPersistentFiltersBar();

  const wrap = document.getElementById('chat-messages');
  if (wrap) wrap.innerHTML = '';

  if (!session.messages.length) {
    if (wrap) {
      wrap.innerHTML = `
        <div class="empty-state" id="empty-state">
          <div class="es-icon">💬</div>
          <div class="es-title">Posez une question sur vos documents</div>
          <div class="es-sub">Nouvelle session : le contexte d'analyse est vide. Les sources chargées et la connexion Grist restent disponibles.</div>
          <div class="suggestions" id="suggestions"></div>
        </div>`;
    }
    if (typeof renderSuggestions === 'function') renderSuggestions();
  } else {
    session.messages.forEach(entry => {
      if (typeof addMessage !== 'function' && typeof addInfographicMessage !== 'function') return;
      if (entry.type === 'text' && typeof addMessage === 'function') addMessage(entry.role, entry.text, { record: false });
      else if (entry.type === 'html' && typeof addMessage === 'function') addMessage(entry.role, entry.html, { record: false });
      else if (entry.type === 'infographic' && typeof addInfographicMessage === 'function') addInfographicMessage(entry.html, entry.title, { record: false });
    });
  }

  const input = document.getElementById('chat-input');
  if (input) { input.value = ''; input.style.height = 'auto'; }
  const pills = document.getElementById('context-pills');
  if (pills) pills.innerHTML = '';

  renderSessionList();
  if (typeof updateChatSub === 'function') updateChatSub();
}


// ── renderPersistentFiltersBar ──
function renderPersistentFiltersBar() {
  const bar = document.getElementById('pf-bar');
  const chips = document.getElementById('pf-chips');
  if (!bar || !chips) return;
  if (!persistentFilters.length) { bar.classList.add('empty'); chips.innerHTML = ''; return; }
  bar.classList.remove('empty');
  chips.innerHTML = persistentFilters.map((f, i) =>
    `<span class="pf-chip">🔒 ${escapeHtml(f.label || f.value)}
      <button onclick="removePersistentFilter(${i})" title="Supprimer ce filtre">×</button>
    </span>`
  ).join('');
}


// ── renderSessionList ──
function renderSessionList() {
  const list = document.getElementById('session-list');
  if (!list) return;
  const sorted = [...sessions].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  list.innerHTML = sorted.map(s => {
    const active = s.id === currentSessionId ? ' active' : '';
    const date = new Date(s.updatedAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const n = s.messages.length;
    return `<div class="session-item${active}" onclick="switchToSession('${s.id}')">
      <div class="session-title">${escapeHtml(s.title || 'Session sans titre')}</div>
      <div class="session-meta">${date} · ${n} message${n > 1 ? 's' : ''}</div>
      <button class="session-delete" onclick="deleteSession('${s.id}', event)" title="Supprimer">×</button>
    </div>`;
  }).join('');
}


// ── rethemeInfographic ──
function rethemeInfographic(btn, specJson, themeId) {
  const theme = INFOGRAPH_THEMES.find(t => t.id === themeId);
  if (!theme) return;
  try {
    const spec = JSON.parse(specJson);
    spec.accent = theme.accent; spec.secondary = theme.secondary;
    const html = renderAdaptiveInfographicHtml(spec, spec.title || '');
    const msg = btn.closest('.msg');
    const iframe = msg?.querySelector('iframe');
    if (!iframe) return;
    const url = URL.createObjectURL(new Blob([html], { type:'text/html;charset=utf-8' }));
    iframe.src = url;
    msg.querySelectorAll('a[data-infobtn]').forEach(a => a.href = url);
    // Update stored spec theme in all sibling buttons
    msg.querySelectorAll('.ic-retheme-btn').forEach(b => b.classList.remove('ic-active'));
    btn.classList.add('ic-active');
  } catch(e) { console.warn('Retheme error:', e); }
}


// ── sanitizeExecutionForStorage ──
function sanitizeExecutionForStorage(exec) {
  if (!exec) return null;
  // On retire les champs lourds de result (rows, objects) qui peuvent peser
  // plusieurs Mo et saturer le quota navigateur.
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


// ── sanitizePlanForStorage ──
function sanitizePlanForStorage(plan) {
  if (!plan) return null;
  const { table, sourceExecution, ...rest } = plan;
  // compareGroups peut embarquer des rows brutes (plusieurs Mo) — on les retire.
  if (Array.isArray(rest.compareGroups)) {
    rest.compareGroups = rest.compareGroups.map(g => {
      const { rows, objects, ...gMeta } = g;
      return gMeta;
    });
  }
  return rest;
}


// ── scheduleSessionsSave ──
function scheduleSessionsSave() {
  if (sessionsSaveTimer) clearTimeout(sessionsSaveTimer);
  sessionsSaveTimer = setTimeout(persistSessions, 400);
}


// ── submitInfographicComposer ──
async function submitInfographicComposer() {
  const selected = _icState.blocks.filter(b => b.checked);
  if (!selected.length) return;
  const theme = INFOGRAPH_THEMES.find(t => t.id === _icState.theme) || INFOGRAPH_THEMES[0];
  const targetUid = _icState.targetUid || null;
  closeInfographicComposer();
  const composerCtx = selected.map((b, i) => `[Analyse ${i + 1} — ${b.title}]\n${b.dataContext}`).join('\n\n---\n\n');
  const question = selected.map(b => b.title).join(', ');
  const loadingId = 'loading_' + Date.now();
  addLoadingMessage(loadingId);
  try {
    const { spec, html } = await _generateInfographicFromComposer(question, composerCtx, theme);
    removeLoadingMessage(loadingId);

    if (targetUid) {
      // Mise à jour de l'infographie existante (pas de nouveau message)
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const newUrl = URL.createObjectURL(blob);
      const frame    = document.getElementById(`ic-frame-${targetUid}`);
      const openLink = document.getElementById(`ic-open-${targetUid}`);
      const dlLink   = document.getElementById(`ic-dl-${targetUid}`);
      if (frame)    frame.src    = newUrl;
      if (openLink) openLink.href = newUrl;
      if (dlLink)   dlLink.href   = newUrl;
      // Mise à jour du spec stocké + éditeur de titres
      if (window._infogSpecs) window._infogSpecs[targetUid] = { spec, themeId: theme.id };
      const te = document.getElementById(`ic-te-${targetUid}`);
      if (te && typeof _icBuildTitlesEditorHtml === 'function') {
        te.innerHTML = _icBuildTitlesEditorHtml(spec, targetUid);
      }
    } else {
      addInfographicMessage(html, 'Infographie composée', { spec, themeId: theme.id });
    }
  } catch(e) {
    removeLoadingMessage(loadingId);
    addMessage('assistant', `<p style="color:var(--rouge)"><strong>Erreur pendant la génération</strong><br>${escapeHtml(e.message)}</p>`);
  }
}


// ── switchToSession ──
function switchToSession(id) {
  if (id === currentSessionId) { closeSessionsPanel(); return; }
  persistSessions();
  currentSessionId = id;
  try {
    renderActiveSession();
  } catch(e) {
    console.error('switchToSession: erreur pendant renderActiveSession', e);
  } finally {
    closeSessionsPanel();
    const input = document.getElementById('chat-input');
    if (input) setTimeout(() => input.focus(), 80);
  }
}
