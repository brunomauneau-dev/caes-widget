/* albert.js — Configuration Albert, Grist, envoi de messages, viewer
   Dépend de : config.js, knowledge.js, documents.js, infographic.js, sessions.js */

/* ═══════════════════════ CONFIG ALBERT ═══════════════════════ */
function openConfig() {
  document.getElementById('cfg-key').value = albertConfig.key;
  document.getElementById('cfg-endpoint').value = albertConfig.endpoint;
  document.getElementById('cfg-model').value = albertConfig.model;
  document.getElementById('btn-clear-config').style.display = albertConfig.key ? 'block' : 'none';
  document.getElementById('modal-config').classList.add('show');
}
function closeConfig() {
  document.getElementById('modal-config').classList.remove('show');
}
async function clearConfig() {
  if (!confirm('Effacer la clé API sauvegardée ?')) return;
  albertConfig = { key: '', endpoint: 'https://app-6fb1a617-d3e3-4989-9dcb-b396964f246e.cleverapps.io/v1/chat/completions', model: 'openweight-large' };
  try {
    await Storage.delete('albert-config');
  } catch(e) {}
  updateConfigStatusBadge();
  closeConfig();
}
async function saveConfig() {
  albertConfig.key = document.getElementById('cfg-key').value.trim();
  albertConfig.endpoint = document.getElementById('cfg-endpoint').value.trim();
  albertConfig.model = document.getElementById('cfg-model').value.trim() || 'openweight-large';

  const saveBtn = document.querySelector('.btn-confirm');
  const originalText = saveBtn.textContent;
  saveBtn.textContent = 'Enregistrement…';
  saveBtn.disabled = true;

  try {
    await Storage.set('albert-config', JSON.stringify(albertConfig));
    updateConfigStatusBadge();
    closeConfig();
  } catch(e) {
    alert('Erreur lors de la sauvegarde : ' + e.message + '\n\nLa configuration reste active pour cette session mais ne sera pas mémorisée.');
    closeConfig();
  } finally {
    saveBtn.textContent = originalText;
    saveBtn.disabled = false;
  }
}

/* ═══════════════════════ GRIST ═══════════════════════ */
grist.ready({ requiredAccess: 'read table' });

/* Charger la config Albert sauvegardée (stockage personnel, non partagé) */
async function loadAlbertConfig() {
  try {
    const saved = await Storage.get('albert-config');
    if (saved && saved.value) {
      const parsed = JSON.parse(saved.value);
      albertConfig = { ...albertConfig, ...parsed };
      updateConfigStatusBadge();
    }
  } catch(e) {
    // Pas encore de config sauvegardée — comportement normal au premier lancement
    console.log('Aucune config Albert sauvegardée encore.');
  }
}
loadAlbertConfig();

function updateConfigStatusBadge() {
  const badge = document.querySelector('.albert-badge');
  if (albertConfig.key) {
    badge.innerHTML = '<div class="dot" style="background:var(--vert)"></div>Albert API · connecté';
  } else {
    badge.innerHTML = '<div class="dot"></div>Albert API · non configuré';
  }
}

function quickAsk(text) {
  const input = document.getElementById('chat-input');
  input.value = text;
  sendMessage();
}



function getBriefCascadeColumnOptions() {
  const src = (typeof getActiveDataSource === 'function') ? getActiveDataSource() : null;
  if (!src || !Array.isArray(src.headers)) return [];
  return src.headers
    .filter(h => h && !/^(id|manualSort)$/i.test(String(h)))
    .map(h => String(h).trim())
    .filter(Boolean);
}

function makeCascadeSelectOptions(cols, current = '') {
  const opts = `<option value="">— choisir une colonne —</option>` + cols.map(c => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('');
  return opts.replace(`value="${escapeAttr(current)}"`, `value="${escapeAttr(current)}" selected`);
}

function renumberBriefCascadeLevels() {
  const wrap = document.getElementById('brief-cascade-levels');
  if (!wrap) return;
  [...wrap.querySelectorAll('.cascade-level-row')].forEach((row, i) => {
    const lab = row.querySelector('.cascade-level-index');
    if (lab) lab.textContent = `Niveau ${i + 1}`;
    const up = row.querySelector('[data-action="up"]');
    const down = row.querySelector('[data-action="down"]');
    if (up) up.disabled = i === 0;
    if (down) down.disabled = i === wrap.children.length - 1;
  });
}

function createBriefCascadeLevel(value = '') {
  const cols = getBriefCascadeColumnOptions();
  const row = document.createElement('div');
  row.className = 'cascade-level-row';
  row.innerHTML = `
    <label class="cascade-level-index">Niveau</label>
    <select class="brief-cascade-level-select">${makeCascadeSelectOptions(cols, value)}</select>
    <div style="display:flex;gap:4px">
      <button type="button" class="cascade-mini-btn" data-action="up" title="Monter">↑</button>
      <button type="button" class="cascade-mini-btn" data-action="down" title="Descendre">↓</button>
    </div>
    <button type="button" class="cascade-mini-btn danger" data-action="remove">Retirer</button>`;
  row.querySelector('[data-action="remove"]').onclick = () => { row.remove(); renumberBriefCascadeLevels(); };
  row.querySelector('[data-action="up"]').onclick = () => {
    const prev = row.previousElementSibling;
    if (prev) row.parentNode.insertBefore(row, prev);
    renumberBriefCascadeLevels();
  };
  row.querySelector('[data-action="down"]').onclick = () => {
    const next = row.nextElementSibling;
    if (next) row.parentNode.insertBefore(next, row);
    renumberBriefCascadeLevels();
  };
  return row;
}

function addBriefCascadeLevel(value = '') {
  const wrap = document.getElementById('brief-cascade-levels');
  if (!wrap) return;
  wrap.appendChild(createBriefCascadeLevel(value));
  renumberBriefCascadeLevels();
}

function getBriefCascadeLevels() {
  const wrap = document.getElementById('brief-cascade-levels');
  if (!wrap) return [];
  const seen = new Set();
  return [...wrap.querySelectorAll('.brief-cascade-level-select')]
    .map(sel => sel.value || '')
    .filter(Boolean)
    .filter(v => {
      if (seen.has(v)) return false;
      seen.add(v);
      return true;
    });
}

function setBriefCascadeLevels(levels) {
  const wrap = document.getElementById('brief-cascade-levels');
  if (!wrap) return;
  wrap.innerHTML = '';
  (levels && levels.length ? levels : ['']).forEach(v => addBriefCascadeLevel(v));
  renumberBriefCascadeLevels();
}

function suggestBriefCascadeLevels() {
  const cols = getBriefCascadeColumnOptions();
  const pick = (patterns, excludes = []) => findBestColumn(cols, patterns, excludes);
  const suggestions = [
    pick([/acad[eé]mie.*accueil|acad[eé]mie.*[eé]tablissement.*accept/i]),
    pick([/[eé]tablissement.*accueil.*accept|[eé]tablissement.*accept/i]),
    pick([/grands? groupes?.*formation.*accept|groupe.*formation/i]),
    pick([/sp[eé]cialit[eé].*mention.*formation.*accept|mention.*formation.*accept|formation.*accueil.*accept/i]),
    pick([/s[eé]rie.*classe|s[eé]rie/i]),
    pick([/boursier/i])
  ].filter(Boolean);
  const unique = [];
  suggestions.forEach(x => { if (!unique.includes(x)) unique.push(x); });
  return unique.slice(0, 6);
}

function autoFillBriefCascadeLevels() {
  const suggested = suggestBriefCascadeLevels();
  setBriefCascadeLevels(suggested.length ? suggested : ['']);
}

function populateBriefCascadeSelectors() {
  const cols = getBriefCascadeColumnOptions();
  const current = getBriefCascadeLevels();
  const wrap = document.getElementById('brief-cascade-levels');
  if (!wrap) return;
  if (!wrap.children.length) {
    const suggested = suggestBriefCascadeLevels().slice(0, 3);
    setBriefCascadeLevels(suggested.length ? suggested : ['']);
    return;
  }
  [...wrap.querySelectorAll('.brief-cascade-level-select')].forEach(sel => {
    const value = sel.value;
    sel.innerHTML = makeCascadeSelectOptions(cols, value);
    if (cols.includes(value)) sel.value = value;
  });
  renumberBriefCascadeLevels();
}

function filterRowsFromBriefScope(rows, scope) {
  if (!rows || !rows.length) return [];
  const src = (typeof getActiveDataSource === 'function') ? getActiveDataSource() : null;
  const headers = src ? src.headers : Object.keys(rows[0] || {});
  const findCol = (patterns, excludes=[]) => findBestColumn(headers, patterns, excludes);
  const eqNorm = (v, target) => normalizeText(v) === normalizeText(target);
  if (scope === 'Zone du Pays Basque = oui') {
    const col = findCol([/zone.*pays.*basque|pays.*basque/i]);
    return col ? rows.filter(r => /^(oui|yes|true|1)$/i.test(String(r[col] ?? '').trim())) : rows;
  }
  if (scope === 'boursiers' || scope === 'non-boursiers') {
    const col = findCol([/boursier/i], [/lyc[eé]e/i]);
    if (!col) return rows;
    return rows.filter(r => {
      const yes = /^(oui|yes|true|1)$/i.test(String(r[col] ?? '').trim());
      return scope === 'boursiers' ? yes : !yes;
    });
  }
  if (scope === 'apprentis') {
    const col = findCol([/apprenti|apprentissage/i]);
    return col ? rows.filter(r => /^(oui|yes|true|1)$/i.test(String(r[col] ?? '').trim())) : rows;
  }
  if (scope === 'admis') {
    const col = findCol([/r[eé]pondu favorablement|proposition.*accept|accept[eé]e/i]);
    return col ? rows.filter(r => /^(oui|yes|true|1)$/i.test(String(r[col] ?? '').trim())) : rows;
  }
  return rows;
}

function buildCascadeNodes(rows, levels, topN, depth = 0) {
  const col = levels[depth];
  if (!col) return [];
  const counts = new Map();
  rows.forEach(r => {
    const v = r[col];
    if (isEmptyCell(v)) return;
    const key = String(v).trim();
    if (!counts.has(key)) counts.set(key, []);
    counts.get(key).push(r);
  });
  return [...counts.entries()]
    .map(([label, childRows]) => ({
      label,
      count: childRows.length,
      percent: rows.length ? childRows.length / rows.length * 100 : 0,
      children: buildCascadeNodes(childRows, levels, topN, depth + 1)
    }))
    .sort((a,b) => b.count - a.count || a.label.localeCompare(b.label, 'fr'))
    .slice(0, topN);
}

function flattenCascadeForPrompt(nodes, total, depth = 0, maxLines = 80, acc = []) {
  if (acc.length >= maxLines) return acc;
  nodes.forEach(n => {
    if (acc.length >= maxLines) return;
    const indent = '  '.repeat(depth);
    acc.push(`${indent}- ${n.label} : ${n.count} (${pctFr(n.count, total)})`);
    if (n.children && n.children.length) flattenCascadeForPrompt(n.children, n.count, depth + 1, maxLines, acc);
  });
  return acc;
}

function getBriefCascadeAnalysis() {
  const enabled = document.getElementById('brief-cascade-enabled')?.checked;
  if (!enabled) return null;
  const src = (typeof getActiveDataSource === 'function') ? getActiveDataSource() : null;
  if (!src || !src.rows || !src.rows.length) return null;
  const scope = document.getElementById('brief-scope')?.value || 'auto';
  const levels = getBriefCascadeLevels();
  if (!levels.length) return null;
  const topN = Number(document.getElementById('brief-cascade-top')?.value || 8);
  const scopedRows = filterRowsFromBriefScope(src.rows, scope);
  const nodes = buildCascadeNodes(scopedRows, levels, topN);
  const lines = flattenCascadeForPrompt(nodes, scopedRows.length);
  return {
    source: src.source,
    scope,
    levels,
    topN,
    total: scopedRows.length,
    nodes,
    text: `TABLEAU EN CASCADE CALCULÉ LOCALEMENT\nPérimètre appliqué : ${scope}\nLignes retenues : ${scopedRows.length}\nNiveaux : ${levels.join(' → ')}\nTop par niveau : ${topN}\n${lines.join('\n')}`
  };
}


function openInfographicBrief(prefill = '') {
  const modal = document.getElementById('modal-infographic-brief');
  if (!modal) return quickAsk(prefill || 'Fais-moi une infographie adaptive sur ce jeu de données');
  const free = document.getElementById('brief-free');
  if (free && prefill) free.value = prefill;
  populateBriefCascadeSelectors();
  const summary = document.getElementById('brief-source-summary');
  if (summary) {
    const src = getActiveDataSource ? getActiveDataSource() : null;
    summary.textContent = src ? `Source : ${src.source} · ${src.rows.length.toLocaleString('fr-FR')} lignes · ${src.headers.length} colonnes` : 'Source : aucun jeu de données actif détecté.';
  }
  modal.classList.add('show');
}

function closeInfographicBrief() {
  const modal = document.getElementById('modal-infographic-brief');
  if (modal) modal.classList.remove('show');
}

function getActiveBriefBlocks() {
  return [...document.querySelectorAll('#brief-blocks .brief-chip.active')].map(x => x.dataset.block || x.textContent.trim());
}

function buildInfographicBriefPrompt() {
  const scope = document.getElementById('brief-scope')?.value || 'auto';
  const angle = document.getElementById('brief-angle')?.value || 'synthese';
  const compare = document.getElementById('brief-compare')?.value.trim() || '';
  const depth = document.getElementById('brief-depth')?.value || 'standard';
  const include = document.getElementById('brief-include')?.value.trim() || '';
  const exclude = document.getElementById('brief-exclude')?.value.trim() || '';
  const free = document.getElementById('brief-free')?.value.trim() || '';
  const blocks = getActiveBriefBlocks();

  const scopeText = {
    auto: "Déduire le périmètre de la demande libre, sans imposer le Pays Basque par défaut.",
    ensemble: "Périmètre : ensemble des candidats.",
    boursiers: "Périmètre : candidats boursiers uniquement ; comparer aux non-boursiers seulement si demandé.",
    'non-boursiers': "Périmètre : candidats non boursiers uniquement.",
    apprentis: "Périmètre : candidats apprentis uniquement.",
    admis: "Périmètre : candidats ayant répondu favorablement / ayant accepté une proposition.",
    personnalise: "Périmètre personnalisé : il est défini dans la demande libre et les priorités ci-dessous."
  }[scope] || `Périmètre obligatoire : ${scope}.`;

  let prompt = `Fais-moi une infographie Parcoursup en respectant strictement ce brief.\n\n`;
  prompt += `PÉRIMÈTRE\n- ${scopeText}\n`;
  prompt += `- Ne mélange pas ce périmètre avec l'ensemble des candidats, sauf dans une section explicitement comparative.\n`;
  prompt += `- Chaque section doit afficher son périmètre.\n\n`;
  prompt += `ANGLE\n- ${angle}\n`;
  if (compare) prompt += `- Comparaison demandée : ${compare}\n`;
  prompt += `\nBLOCS À UTILISER\n- ${blocks.length ? blocks.join('\n- ') : 'choisir les blocs utiles'}\n`;
  prompt += `\nFORMAT\n- ${depth}\n`;
  if (include) prompt += `\nÀ AFFICHER EN PRIORITÉ\n${include}\n`;
  if (exclude) prompt += `\nÀ ÉVITER / EXCLURE\n${exclude}\n`;
  if (free) prompt += `\nDEMANDE LIBRE\n${free}\n`;
  prompt += `\nRÈGLE DE LISIBILITÉ\n- N'utilise pas de ratios ambigus du type \"1789 / 579 +209 %\" pour une relation partie/tout. Utilise des libellés explicites : Bordeaux 75,5 % / autres académies 24,5 %.\n`;
  prompt += `- Si le brief dit \"Basques seulement\", ne fais pas de section globale sauf comparaison explicitement demandée.\n`;
  return prompt;
}

function submitInfographicBrief() {
  const prompt = buildInfographicBriefPrompt();
  closeInfographicBrief();
  quickAsk(prompt);
}

document.addEventListener('click', function(e) {
  const chip = e.target.closest && e.target.closest('#brief-blocks .brief-chip');
  if (chip) chip.classList.toggle('active');
});

function getUploadedRowsCount() {
  return documents.reduce((sum, d) => {
    if (!d.tables || !d.tables.length) return sum;
    return sum + d.tables.reduce((s, t) => s + (t.objects ? t.objects.length : 0), 0);
  }, 0);
}

function updateSourceHub() {
  const gristCard = document.getElementById('grist-source-card');
  const gristDetail = document.getElementById('grist-source-detail');
  const gristActions = document.getElementById('grist-source-actions');
  const uploadCard = document.getElementById('upload-source-card');
  const uploadDetail = document.getElementById('upload-source-detail');
  const drop = document.getElementById('dropzone');
  if (!gristCard || !uploadCard || !drop) return;

  const gristActive = gristRecords && gristRecords.length > 0;
  const uploadedRows = getUploadedRowsCount();
  const uploadedDocs = documents.filter(d => d.status === 'ok').length;

  if (gristActive) {
    const fields = Object.keys(gristRecords[0] || {}).filter(f => f !== 'id' && f !== 'manualSort');
    gristCard.className = 'source-card active';
    gristCard.querySelector('.sc-badge').textContent = 'prioritaire';
    gristDetail.innerHTML = `<strong>${gristRecords.length.toLocaleString('fr-FR')}</strong> lignes · <strong>${fields.length}</strong> colonnes. Le moteur utilise cette table en priorité pour les synthèses, calculs et infographies.`;
    gristActions.style.display = 'flex';
    drop.classList.add('compact');
    drop.querySelector('.txt').innerHTML = '<strong>Ajouter un petit fichier complémentaire</strong><br>ou utiliser en secours hors Grist';
  } else {
    gristCard.className = 'source-card';
    gristCard.querySelector('.sc-badge').textContent = 'inactive';
    gristDetail.textContent = 'Aucune table connectée. Idéal pour les gros fichiers et les analyses récurrentes.';
    gristActions.style.display = 'none';
    drop.classList.remove('compact');
    drop.querySelector('.txt').innerHTML = '<strong>Glissez vos fichiers</strong><br>ou cliquez pour parcourir';
  }

  const largeUploaded = uploadedRows >= 5000;
  if (largeUploaded && !gristActive) {
    uploadCard.className = 'source-card warn';
    uploadCard.querySelector('.sc-badge').textContent = 'volumineux';
    uploadDetail.innerHTML = `<strong>${uploadedRows.toLocaleString('fr-FR')}</strong> lignes chargées par drag & drop. Ça fonctionne, mais pour ce volume Grist est recommandé : importer le fichier dans une table Grist puis connecter le widget.`;
  } else if (uploadedDocs) {
    uploadCard.className = 'source-card' + (largeUploaded ? ' warn' : '');
    uploadCard.querySelector('.sc-badge').textContent = largeUploaded ? 'volumineux' : 'actif';
    uploadDetail.innerHTML = `<strong>${uploadedDocs}</strong> document${uploadedDocs>1?'s':''} prêt${uploadedDocs>1?'s':''}` + (uploadedRows ? ` · <strong>${uploadedRows.toLocaleString('fr-FR')}</strong> lignes tabulaires` : '') + (gristActive ? '. Ces fichiers sont secondaires car Grist est prioritaire.' : '. Mode analyse rapide actif.');
  } else {
    uploadCard.className = 'source-card';
    uploadCard.querySelector('.sc-badge').textContent = 'analyse rapide';
    uploadDetail.textContent = gristActive ? 'Optionnel : ajoutez un petit fichier complémentaire si besoin.' : 'Utile pour petits Excel, CSV, PDF ou Word ponctuels. Pour les gros volumes, préférez Grist.';
  }
  if (typeof updateKnowledgeStatusBadge === 'function') updateKnowledgeStatusBadge();
}

grist.onRecords(function(records) {
  if (!records || !records.length) return;
  gristRecords = records;
  const fields = Object.keys(records[0]);
  document.getElementById('grist-info').innerHTML = `
    <div style="font-size:11px;color:var(--texte)">
      <strong>${records.length}</strong> lignes · <strong>${fields.length}</strong> colonnes
    </div>
    <div style="font-size:10px;color:var(--gris3);margin-top:4px;line-height:1.5">
      ${fields.slice(0,6).map(f=>f.replace(/_/g,' ')).join(', ')}${fields.length>6?'…':''}
    </div>`;
  document.getElementById('grist-info').className = '';
  updateSourceHub();
  updateChatSub();
});


/* ═══════════════════════ RENDU DOCUMENTS ═══════════════════════ */
let selectedDocIds = new Set();

function renderDocs() {
  const list = document.getElementById('doc-list');
  list.innerHTML = '';
  documents.forEach(doc => {
    const item = document.createElement('div');
    item.className = 'doc-item' + (selectedDocIds.has(doc.id) ? ' selected' : '');
    const sizeKb = doc.content ? Math.round(doc.content.length / 1024) : 0;

    let statusHtml = '';
    if (doc.status === 'loading') {
      const ocrBadge = document.getElementById('ocr-progress-badge');
      statusHtml = `<div class="doc-status loading">⏳ ${ocrBadge ? 'OCR en cours (peut prendre 1-2 min)…' : 'Extraction…'}</div>`;
    }
    if (doc.status === 'ok') {
      const rowInfo = doc.rowCount ? ` · ${doc.rowCount.toLocaleString('fr-FR')} lignes` : '';
      statusHtml = `<div class="doc-status ok">✓ ${sizeKb} Ko extraits${rowInfo}</div>`;
    }
    if (doc.status === 'error') statusHtml = `<div class="doc-status error" title="${(doc.error||'').replace(/"/g,'&quot;')}" style="cursor:help">✕ Erreur — survolez pour le détail</div>`;
    const adviceHtml = (doc.largeDataWarning && !gristRecords.length)
      ? `<div class="doc-advice">Fichier volumineux : l'analyse directe reste possible, mais Grist sera plus robuste pour les requêtes répétées et les infographies.</div>`
      : '';

    item.innerHTML = `
      <button class="doc-remove" onclick="removeDoc('${doc.id}', event)">✕</button>
      <div class="doc-name doc-name-clickable" onclick="openViewer('${doc.id}', event)">${doc.name}</div>
      <div class="doc-meta"><span class="doc-badge ${doc.type}">${doc.type}</span>${gristRecords.length ? '<span class="mode-pill">source secondaire</span>' : ''}</div>
      ${statusHtml}
      ${adviceHtml}
    `;
    item.onclick = (e) => {
      if (e.target.classList.contains('doc-remove') || e.target.classList.contains('doc-name-clickable')) return;
      toggleDocSelection(doc.id);
    };
    list.appendChild(item);
  });
  renderContextPills();
  updateSourceHub();
}

function toggleDocSelection(id) {
  if (selectedDocIds.has(id)) selectedDocIds.delete(id);
  else selectedDocIds.add(id);
  renderDocs();
}

function removeDoc(id, e) {
  e.stopPropagation();
  documents = documents.filter(d => d.id !== id);
  selectedDocIds.delete(id);
  renderDocs();
  updateSourceHub();
  updateChatSub();
}

function renderContextPills() {
  const wrap = document.getElementById('context-pills');
  if (gristRecords && gristRecords.length) {
    const uploaded = documents.filter(d => d.status === 'ok').length;
    wrap.innerHTML = `<span class="context-pill">Source prioritaire : Grist (${gristRecords.length.toLocaleString('fr-FR')} lignes)</span>` + (uploaded ? `<span class="context-pill none">${uploaded} fichier${uploaded>1?'s':''} en complément</span>` : '');
    return;
  }
  const selected = documents.filter(d => selectedDocIds.has(d.id) && d.status === 'ok');
  if (!selected.length) {
    const allOk = documents.filter(d => d.status === 'ok');
    if (allOk.length) {
      wrap.innerHTML = `<span class="context-pill">Contexte : tous les documents (${allOk.length})</span>`;
    } else {
      wrap.innerHTML = `<span class="context-pill none">Aucun document chargé</span>`;
    }
    return;
  }
  wrap.innerHTML = selected.map(d => `<span class="context-pill">${d.name}</span>`).join('');
}

function updateChatSub() {
  const ok = documents.filter(d => d.status === 'ok').length;
  const total = documents.length;
  let txt = '';
  if (gristRecords.length) {
    txt = `${gristRecords.length.toLocaleString('fr-FR')} lignes Grist · source prioritaire`;
    if (ok) txt += ` · ${ok} fichier${ok>1?'s':''} complémentaire${ok>1?'s':''}`;
  } else if (total === 0) txt = 'Aucun document chargé';
  else if (ok < total) txt = `${ok}/${total} documents prêts`;
  else txt = `${ok} document${ok>1?'s':''} prêt${ok>1?'s':''}`;
  const chatSubEl = document.getElementById('chat-sub');
  if (!chatSubEl) return;
  chatSubEl.textContent = txt;
}

/* ═══════════════════════ SUGGESTIONS ═══════════════════════ */
function renderSuggestions() {
  const wrap = document.getElementById('suggestions');
  if (!wrap) return;
  wrap.innerHTML = '';
  SUGGESTIONS.forEach(s => {
    const chip = document.createElement('div');
    chip.className = 'sugg-chip';
    chip.textContent = s;
    chip.onclick = () => {
      const input = document.getElementById('chat-input');
      if (!input) return;
      input.value = s;
      sendMessage();
    };
    wrap.appendChild(chip);
  });
}
grist.onOptions(function() {
  renderSuggestions();
  updateSourceHub();
});

/* ═══════════════════════ CHAT ═══════════════════════ */
function handleKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function buildContext(localAnalysis = null) {
  const selected = documents.filter(d => selectedDocIds.has(d.id) && d.status === 'ok');
  // Si Grist est actif, il est prioritaire : les fichiers déposés ne sont inclus
  // dans le contexte que s'ils ont été explicitement sélectionnés à gauche.
  const docsToUse = gristRecords.length ? selected : (selected.length ? selected : documents.filter(d => d.status === 'ok'));

  let context = '';
  docsToUse.forEach(doc => {
    let content = doc.content;
    // Limiter chaque doc à ~150000 caractères (~37000 tokens) : le modèle openweight-large
    // dispose d'une fenêtre de contexte de 128000 tokens, ce qui laisse de la marge pour
    // plusieurs gros fichiers tabulaires (Excel/CSV) tout en gardant de la place pour
    // le prompt système, l'historique et la question.
    if (content.length > 150000) content = content.slice(0, 150000) + '\n[...contenu tronqué...]';
    context += `\n\n=== DOCUMENT: ${doc.name} ===\n${content}`;
  });

  if (localAnalysis && localAnalysis.text) {
    context += `

${localAnalysis.text}
`;
  }

  if (gristRecords.length) {
    const gristTable = buildGristQueryTable();
    const fullSynthesis = buildFullTableSynthesis(gristTable, localAnalysis?.question || '');
    context += `\n\n${fullSynthesis}`;

    const fields = Object.keys(gristRecords[0]);
    const preview = gristRecords.slice(0, 12).map(r => fields.map(f => r[f]).join(' | ')).join('\n');
    context += `\n\n=== APERÇU GRIST (12 premières lignes, seulement illustratif) ===\nColonnes brutes: ${fields.join(' | ')}\n${preview}`;
  }

  return context.trim();
}




async function sendMessage() {
  const input = document.getElementById('chat-input');
  const question = input.value.trim();
  if (!question) return;

  document.getElementById('empty-state').style.display = 'none';
  input.value = '';

  addMessage('user', question);

  const loadingId = 'loading_' + Date.now();
  addLoadingMessage(loadingId);

  const filterContextText = [...chatHistory.slice(-4).map(m => m.content), question].join('\n');
  let dataPlan = detectDataEnginePlan(question, filterContextText);
  const dataExecution = dataPlan ? runDataEnginePlan(dataPlan) : null;
  const localAnalysis = executeLocalDataQuery(question, filterContextText);

  if (dataExecution && shouldAnswerLocallyWithoutAlbert(dataExecution) && !isInfographicRequest(question)) {
    removeLoadingMessage(loadingId);
    addMessage('assistant', dataExecution.html);
    chatHistory.push({ role: 'user', content: question });
    const deCtx = dataEngineResultToContext(dataExecution);
    chatHistory.push({ role: 'assistant', content: deCtx });
    // Enregistre le bloc pour le compositeur d'infographie
    const _skipTools = ['chart_current', 'export_excel', 'export_csv'];
    const sDE = getCurrentSession();
    if (sDE && deCtx && deCtx.length > 20 && !_skipTools.includes(dataExecution.plan?.tool)) {
      try {
        sDE.dataBlocks = sDE.dataBlocks || [];
        const blkTitle = (typeof extractBlockTitle === 'function')
          ? extractBlockTitle(dataExecution, question)
          : (question.length > 64 ? question.slice(0, 63) + '…' : question);
        sDE.dataBlocks.push({ id: 'blk_' + Date.now(), title: blkTitle, question, dataContext: deCtx });
        scheduleSessionsSave();
      } catch(e) {
        console.warn('[dataBlocks] Erreur lors de l\'enregistrement du bloc:', e);
      }
    }
    return;
  }

  if (isInfographicRequest(question)) {
    try {
      const html = await generateInfographicWithAlbert(question, localAnalysis, dataExecution);
      removeLoadingMessage(loadingId);
      addInfographicMessage(html, 'Infographie Albert');
      chatHistory.push({ role: 'user', content: question });
      return;
    } catch (e) {
      removeLoadingMessage(loadingId);
      addMessage('assistant', `<p style="color:var(--rouge)"><strong>Erreur pendant la génération de l'infographie</strong><br>${e.message}</p>`);
      return;
    }
  }

  const context = buildContext(localAnalysis);
  const knowledgeContext = buildParcoursupKnowledgeContext(question, context);
  const openDataContext = buildOpenDataReferenceContext(question);
  const systemPrompt = `Tu es un assistant d'analyse documentaire pour un agent du ministère de l'Éducation nationale (SAIO Bordeaux). Tu réponds en français, de manière factuelle, précise et structurée.

${PARCOURSUP_GLOSSAIRE}

Consignes pour la qualité de l'analyse :
- Va au fond du sujet : ne te limite pas à une reformulation superficielle, identifie les informations concrètes, chiffres, dates, noms, conditions ou exceptions pertinentes pour la question posée.
- Quand plusieurs documents sont fournis, indique de quel document provient chaque information (ex: "Selon [nom du document]...").
- Si une information est ambiguë, incomplète ou contradictoire entre documents, signale-le explicitement plutôt que de trancher arbitrairement.
- Si le contexte contient une section "Statistiques par colonne" précédée de la mention "calculées sur L'INTÉGRALITÉ", considère ces chiffres comme exacts et définitifs : ne les recalcule pas et ne les remets pas en doute à partir de l'échantillon de lignes fourni juste après, qui n'est là qu'à titre illustratif.
- Si le contexte contient une section "Tableaux croisés", c'est là qu'il faut chercher la réponse à toute question portant sur un sous-groupe (ex: "parmi les candidats X", "pour les boursiers", "dans la zone Y") — ne réponds JAMAIS "cette information n'est pas disponible" sur ce type de question sans avoir d'abord vérifié si le sous-groupe demandé y figure. Si le sous-groupe exact n'y figure pas (ex: croisement non calculé pour cette colonne précise), dis-le explicitement et indique quels croisements sont disponibles à la place.
- Si le contexte contient une section "RÉSULTAT CALCULÉ LOCALEMENT", ce résultat prime sur tous les autres éléments : il a été calculé par le widget directement sur les lignes brutes Grist ou Excel. Utilise-le tel quel pour répondre, avec les effectifs et pourcentages fournis.
- Si la question demande un résumé, une synthèse ou une description générale du fichier, utilise en priorité la section "SYNTHÈSE AUTOMATIQUE SUR TABLE COMPLÈTE" : elle est calculée sur toutes les lignes Grist/Excel, contrairement à l'aperçu qui est seulement illustratif.
- Quand un filtre local indique "≠ Bordeaux", il signifie bien que les lignes de l'académie de Bordeaux ont été exclues ; ne transforme pas cette requête en taux de sortie ni en analyse de mobilité si l'utilisateur demande seulement une répartition.
- Base-toi UNIQUEMENT sur le contexte fourni ci-dessous — si l'information n'y est pas, dis-le clairement plutôt que d'inventer.
- Utilise des balises HTML simples dans ta réponse (h4, p, ul, li, strong) pour structurer le contenu.
- Si des RÉFÉRENCES MÉTIER PARCOURSUP sont fournies ci-dessous, utilise-les comme règles d'interprétation. Ne cite pas une règle Parcoursup absente des références ; si la règle manque, dis-le.

${knowledgeContext ? knowledgeContext + "\n\n" : ""}${openDataContext ? openDataContext + "\n\n" : ""}CONTEXTE DOCUMENTAIRE :
${context || "(Aucun document chargé)"}`;

  try {
    const response = await fetch(albertConfig.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: albertConfig.model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...chatHistory.slice(-6),
          { role: 'user', content: question }
        ],
        temperature: 0.3
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Erreur ${response.status} : ${errText.slice(0,200)}`);
    }

    const data = await response.json();
    const answer = data.choices?.[0]?.message?.content || 'Aucune réponse reçue.';

    removeLoadingMessage(loadingId);
    addMessage('assistant', answer);

    chatHistory.push({ role: 'user', content: question });
    chatHistory.push({ role: 'assistant', content: answer });

    // Enregistre la réponse Albert comme bloc composable
    const sAlbert = getCurrentSession();
    if (sAlbert && answer && answer.length > 80) {
      try {
        sAlbert.dataBlocks = sAlbert.dataBlocks || [];
        const plainCtx = answer.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const blkTitle = question.length > 64 ? question.slice(0, 63) + '…' : question;
        sAlbert.dataBlocks.push({ id: 'blk_' + Date.now(), title: blkTitle, question, dataContext: plainCtx });
        scheduleSessionsSave();
      } catch(e) {
        console.warn('[dataBlocks] Erreur lors de l\'enregistrement du bloc Albert:', e);
      }
    }

  } catch (e) {
    removeLoadingMessage(loadingId);
    const isNetworkError = /NetworkError|Failed to fetch|TypeError/i.test(e.message);
    const hint = isNetworkError
      ? "La requête n'a pas atteint le serveur (blocage CORS, réseau, ou pare-feu probable — pas un souci de clé API). Ouvrez la console du navigateur (F12 → Console/Réseau) pour voir le détail exact."
      : "Vérifiez votre clé API et l'endpoint dans les paramètres (⚙️).";
    addMessage('assistant', `<p style="color:var(--rouge)"><strong>Erreur de connexion à Albert API</strong><br>${e.message}</p><p style="font-size:11px;color:var(--gris3)">${hint}</p>`);
  }
}

function addMessage(role, content, opts = {}) {
  const wrap = document.getElementById('chat-messages');
  const msg = document.createElement('div');
  msg.className = 'msg ' + role;
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  if (role === 'user') {
    bubble.textContent = content;
  } else {
    bubble.innerHTML = content;
  }
  msg.appendChild(bubble);
  if (role === 'assistant') msg.appendChild(buildCopilotActionBar(bubble));
  wrap.appendChild(msg);
  wrap.scrollTop = wrap.scrollHeight;
  if (opts.record !== false) {
    recordSessionMessage(role === 'user'
      ? { type: 'text', role, text: content }
      : { type: 'html', role, html: content });
  }
}

function addLoadingMessage(id) {
  const wrap = document.getElementById('chat-messages');
  const msg = document.createElement('div');
  msg.className = 'msg assistant';
  msg.id = id;
  msg.innerHTML = `<div class="msg-bubble"><div class="loading-msg"><div class="spinner"></div>Albert analyse les documents…</div></div>`;
  wrap.appendChild(msg);
  wrap.scrollTop = wrap.scrollHeight;
}

function removeLoadingMessage(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

/* ═══════════════════════ AUTO-RESIZE TEXTAREA ═══════════════════════ */
const textarea = document.getElementById('chat-input');
if (textarea) {
  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  });
}

/* ═══════════════════════ VIEWER DE DOCUMENT ═══════════════════════ */
let viewerCurrentDocId = null;

function openViewer(docId, e) {
  if (e) e.stopPropagation();
  const doc = documents.find(d => d.id === docId);
  if (!doc) return;

  viewerCurrentDocId = docId;
  document.getElementById('viewer-title').textContent = doc.name;

  const sizeKb = doc.content ? Math.round(doc.content.length / 1024) : 0;
  const charCount = doc.content ? doc.content.length.toLocaleString('fr-FR') : 0;

  if (doc.status === 'loading') {
    document.getElementById('viewer-sub').textContent = 'Extraction en cours…';
    document.getElementById('viewer-body').innerHTML = `<div style="text-align:center;padding:40px;color:var(--gris3)"><div class="spinner" style="margin:0 auto 12px"></div>Extraction du contenu en cours…</div>`;
    document.getElementById('viewer-meta-info').textContent = '';
  } else if (doc.status === 'error') {
    document.getElementById('viewer-sub').textContent = 'Erreur d\'extraction';
    document.getElementById('viewer-body').innerHTML = `<div style="color:var(--rouge);padding:20px;text-align:center">⚠️ ${doc.error || 'Extraction impossible'}</div>`;
    document.getElementById('viewer-meta-info').textContent = '';
  } else {
    document.getElementById('viewer-sub').textContent = `${doc.type.toUpperCase()} · ${sizeKb} Ko extraits · contenu envoyé à Albert lors des questions`;
    document.getElementById('viewer-body').textContent = doc.content || '(contenu vide)';
    document.getElementById('viewer-meta-info').textContent = `${charCount} caractères`;
  }

  document.getElementById('viewer-search-input').value = '';
  document.getElementById('viewer-overlay').classList.add('show');
}

function closeViewer() {
  document.getElementById('viewer-overlay').classList.remove('show');
  viewerCurrentDocId = null;
}

function searchInViewer(query) {
  const doc = documents.find(d => d.id === viewerCurrentDocId);
  if (!doc || doc.status !== 'ok') return;
  const body = document.getElementById('viewer-body');

  if (!query.trim()) {
    body.textContent = doc.content;
    return;
  }

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped, 'gi');
  const escapedContent = doc.content
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const highlighted = escapedContent.replace(regex, m => `<mark class="viewer-highlight">${m}</mark>`);
  body.innerHTML = highlighted;

  const firstMark = body.querySelector('mark');
  if (firstMark) firstMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function copyViewerContent() {
  const doc = documents.find(d => d.id === viewerCurrentDocId);
  if (!doc || !doc.content) return;
  navigator.clipboard.writeText(doc.content).then(() => {
    const btn = document.querySelector('.btn-copy-content');
    const original = btn.textContent;
    btn.textContent = '✓ Copié';
    setTimeout(() => btn.textContent = original, 1500);
  });
}


// PR 4.1 — normalizeInfographicSpec : filtre les placeholders résiduels après génération Albert.
// Appelée par sessions.js après parsing du JSON infographie.
function normalizeInfographicSpec(spec, question) {
  if (!spec || typeof spec !== 'object') return spec;

  // Patterns de placeholders à détecter (insensible à la casse)
  const PLACEHOLDER_PATTERNS = [
    /^item\s*\d+$/i,
    /^analyse\s*\d*$/i,
    /^catégorie\s*[xn°\d]*$/i,
    /^section\s*\d*$/i,
    /^donnée\s*[xn°\d]*$/i,
    /^label$/i,
    /^valeur$/i,
    /^périmètre$/i,
    /^titre$/i,
    /^texte$/i,
    /^\.\.\.*$/,
    /^xxx+$/i,
    /^n\/a$/i,
    /^à\s+compléter$/i,
    /^à\s+définir$/i,
  ];

  function isPlaceholder(str) {
    if (!str || typeof str !== 'string') return true;
    const s = str.trim();
    if (!s) return true;
    return PLACEHOLDER_PATTERNS.some(p => p.test(s));
  }

  function cleanItems(items) {
    if (!Array.isArray(items)) return items;
    return items.filter(item => {
      if (!item || typeof item !== 'object') return false;
      // Rejeter si le label/titre est un placeholder
      if (isPlaceholder(item.label) || isPlaceholder(item.title)) return false;
      // Rejeter si la valeur principale est vide ou placeholder
      const mainVal = item.value ?? item.text ?? '';
      if (isPlaceholder(mainVal)) return false;
      // Rejeter les insights avec texte trop court (< 10 mots)
      if (item.text !== undefined && typeof item.text === 'string') {
        const wordCount = item.text.trim().split(/\s+/).length;
        if (wordCount < 10) return false;
      }
      return true;
    });
  }

  // Nettoyer le titre et subtitle globaux
  if (isPlaceholder(spec.title)) spec.title = (question || 'Analyse Parcoursup').slice(0, 60);
  if (isPlaceholder(spec.subtitle)) delete spec.subtitle;

  // Nettoyer les métriques
  if (Array.isArray(spec.metrics)) {
    spec.metrics = cleanItems(spec.metrics);
  }

  // Nettoyer les sections
  if (Array.isArray(spec.sections)) {
    spec.sections = spec.sections
      .map(section => {
        if (!section || typeof section !== 'object') return null;
        if (isPlaceholder(section.title)) return null;
        if (Array.isArray(section.items)) {
          section.items = cleanItems(section.items);
          // Supprimer la section entière si plus aucun item valide
          if (!section.items.length) return null;
        }
        return section;
      })
      .filter(Boolean);
  }

  // Nettoyer le footer
  if (isPlaceholder(spec.footer)) delete spec.footer;

  return spec;
}

// Met à jour le viewer en direct si le document affiché finit son extraction
if (typeof renderDocs === 'function') {
  const originalRenderDocs = renderDocs;
  renderDocs = function() {
    originalRenderDocs();
    const overlay = document.getElementById('viewer-overlay');
    if (viewerCurrentDocId && overlay && overlay.classList.contains('show')) {
      const doc = documents.find(d => d.id === viewerCurrentDocId);
      if (doc && doc.status !== 'loading') openViewer(viewerCurrentDocId);
    }
  };
}


