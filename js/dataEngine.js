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
  // v27.10 — « et par académie ? », « puis par filière » : même relance que « par académie »
  return /^(?:(?:et|puis|maintenant|ensuite)\s+)?(par|selon)\s+/.test(q);
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

// v27.8 — nom de colonne + sa forme développée (BOURS → boursier, LIB_ACA_ACC → libelle academie accueil)
function _hx(h) {
  const dev = (typeof plannerExpandAbbreviations === 'function') ? plannerExpandAbbreviations(h) : '';
  return normalizeText(`${h} ${dev}`);
}
function _distinctValues(table, col) {
  return [...new Set((table?.objects || []).map(r => String(r?.[col] ?? '').trim()).filter(Boolean))];
}

// v27.8 — colonne d'état (oui/non, VRAI/FAUX, 1/0, « Boursier des lycées / Non boursier ») et non une mesure
// chiffrée (« % d'admis boursiers », « Dont effectif des admis boursiers ») : seule une colonne d'état sert de filtre.
function _isEtatCol(table, h) {
  const vals = _distinctValues(table, h);
  if (!vals.length) return false;
  if (vals.length <= 6) return true;
  return vals.filter(v => /^-?\d+([.,]\d+)?$/.test(v)).length < vals.length * 0.5;
}

function findColumnByConceptStrict(table, concept) {
  const headers = table?.headers || Object.keys(table?.objects?.[0] || {});
  const ETATS = ['boursier', 'basque', 'apprenti'];
  const scored = headers.map(h => {
    const hn = _hx(h);
    let score = 0;
    if (ETATS.includes(concept) && !_isEtatCol(table, h)) return { h, score: 0 };
    if (concept === 'boursier' && /boursier/.test(hn)) score += 100;
    if (concept === 'basque' && /pays.*basque|zone.*basque/.test(hn)) score += 100;
    if (concept === 'academie_accueil' && /acad[eé]mie/.test(hn) && /accueil|accept/.test(hn)) score += 100;
    if (concept === 'serie' && /s[eé]rie.*classe|s[eé]rie.*bac/.test(hn)) score += 100;
    if (concept === 'formation_groupe' && /grands?.*groupes?.*formation|groupe.*formation/.test(hn)) score += 100;
    if (concept === 'etablissement_origine' && /[eé]tablissement|lyc[eé]e/.test(hn) && /scolarit[eé]|origine|scolaire/.test(hn)) {
      score += 100;
      if (!/d[eé]partement|commune|code|uai|minist[eè]re|type|contrat|rattachement|acad[eé]mie|r[eé]gion/.test(hn)) score += 60;
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
  // v27.8 — colonnes d'état écrites Oui/Non, VRAI/FAUX, true/false, 1/0 : la valeur réelle du fichier, jamais une valeur supposée
  const OUI = /^(oui|o|yes|y|vrai|true|1|x)$/, NON = /^(non|n|no|faux|false|0)$/;
  const etatOui = normVals.find(x => OUI.test(x.n)), etatNon = normVals.find(x => NON.test(x.n));
  if (etatOui && etatNon && normVals.length <= 3) {
    if (kind === 'boursier_oui' || kind === 'oui') return etatOui.raw;
    if (kind === 'boursier_non' || kind === 'non') return etatNon.raw;
  }
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

  // v27.8 — statut public / privé, sélectivité, région, « à <ville> » (open data et fichiers de formations)
  const headersS = (table?.headers || Object.keys(table?.objects?.[0] || {})).filter(Boolean);
  const statutCol = headersS.find(h => /statut|secteur/.test(_hx(h)) && _distinctValues(table, h).some(v => /^public/.test(normalizeText(v))));
  if (statutCol) {
    const vals = _distinctValues(table, statutCol);
    const pub = vals.find(v => /^public/.test(normalizeText(v)));
    const priv = vals.filter(v => /^prive/.test(normalizeText(v)));
    if (/\bpubli(c|cs|que|ques)\b/.test(q) && !/\bprive(e|s|es)?\b/.test(q)) add(statutCol, pub, 'eq');
    else if (/\bprive(e|s|es)?\b/.test(q) && !/\bpubli(c|cs|que|ques)\b/.test(q)) {
      const sc = /sous contrat/.test(q) ? priv.find(v => /sous contrat/.test(normalizeText(v))) : null;
      if (sc) add(statutCol, sc, 'eq');
      else if (priv.length === 1) add(statutCol, priv[0], 'eq');
      else if (pub) add(statutCol, pub, 'neq');
    }
  }
  const selCol = headersS.find(h => /selectiv/.test(_hx(h)));
  // v27.10 — « par sélectivité » est une répartition, pas un filtre : seul l'adjectif (sélectif, sélectives…) filtre
  if (selCol && /\bselecti(f|fs|ve|ves)\b/.test(q)) {
    const non = /\bnon selecti/.test(q);
    const v = _distinctValues(table, selCol).find(x => { const n = normalizeText(x); return non ? /non selecti/.test(n) : (/selecti/.test(n) && !/\bnon\b/.test(n)); });
    if (v) add(selCol, v, 'eq');
  }
  const regCol = headersS.find(h => /\bregion\b/.test(_hx(h)) && !/code/.test(_hx(h)));
  if (regCol) {
    const v = _distinctValues(table, regCol).filter(x => normalizeText(x).length >= 4).sort((a, b) => b.length - a.length)
      .find(x => new RegExp(`(^| )${normalizeText(x)}( |$)`).test(q));
    if (v) add(regCol, v, 'eq');
  }
  const comCols = headersS.filter(h => /commune|ville/.test(_hx(h)) && !/code|insee|postal/.test(_hx(h)));
  if (comCols.length) {
    const veutOrigine = /venant|issus?|originaires?|provenant|scolaris|origine/.test(q);
    const ordre = comCols.slice().sort((a, b) => {
      const ra = (typeof plannerColumnRole === 'function') ? plannerColumnRole(a) : {}, rb = (typeof plannerColumnRole === 'function') ? plannerColumnRole(b) : {};
      return veutOrigine ? (rb.origine ? 1 : 0) - (ra.origine ? 1 : 0) : (rb.accueil ? 1 : 0) - (ra.accueil ? 1 : 0);
    });
    for (const col of ordre) {
      const v = _distinctValues(table, col).filter(x => normalizeText(x).length >= 3).sort((a, b) => b.length - a.length)
        .find(x => new RegExp(`(^| )a ${normalizeText(x)}( |$)`).test(q));
      if (v) { out.push({ col, value: v, op: 'eq', label: null, source: 'commune_a' }); break; }
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
    const viaStrict = strict.filter(f => /boursier/.test(_hx(f.col)));
    plan.filters = viaStrict.length ? viaStrict : (plan.filters || []).filter(f => /boursier/.test(_hx(f.col)));
    plan.mentionedCols = Array.from(new Set([...(plan.mentionedCols || []), ...plan.filters.map(f => f.col)]));
    return plan;
  }

  const strictCols = new Set(strict.map(f => f.col));
  const base = (plan.filters || []).filter(f => !strictCols.has(f.col));
  plan.filters = mergeFiltersUnique(base, strict);
  plan.mentionedCols = Array.from(new Set([...(plan.mentionedCols || []), ...strict.map(f => f.col)]));
  return plan;
}

const _cleFiltre = f => `${f && f.col}::${(f && f.op) || 'eq'}::${f && f.value}`;
function inheritConversationContext(plan, question) {
  if (!plan) return plan;
  const state = getDataEngineState();
  const prev = state.lastPlan;
  const q = normalizeText(question || '');

  plan = replaceConceptFiltersWithStrict(plan, question);
  // v27.10 — filtres trouvés par le planner pour CETTE question, gardés avant toute fusion
  const _filtresPlanner = (plan.filters || []).slice();

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
    // v27.7 — une formation citée dans la nouvelle question remplace la formation précédente (pas de cumul BTS + PASS)
    const newTerms = (plan.filters || []).filter(f => f && f.source === 'termes_formation');
    const formCols = new Set(formationTermsInfo(plan.table || prev.table).cols);
    // v27.10 — idem pour une formation reconnue par le planner (« et pour les BTS ? » après « combien de PASS »)
    const _estFormation = f => f && (f.source === 'termes_formation' || f.op === 'contains_all' || (formCols.has(f.col) && f.op !== 'neq'));
    const prevKept = (newTerms.length || _filtresPlanner.some(_estFormation)) ? previousFilters.filter(f => !_estFormation(f)) : previousFilters;
    // v27.10 — filtres posés par cette question (pour distinguer ceux repris de la question précédente)
    const _clesQuestion = new Set([...(plan.filters || []), ...newStrictFilters].map(_cleFiltre));
    plan.filters = mergeFiltersUnique(prevKept, [...newFilters, ...newTerms]);

    if (dimensionFollowUp) {
      plan.tool = 'group_by';
      if (!plan.targetCol && prev.targetCol && !plan.dimensionIntrouvable) plan.targetCol = prev.targetCol;
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
        // v27.10 — « et pour l'académie de Bordeaux ? » : le filtre du planner (académie = Bordeaux) était perdu,
        // car lu après l'écrasement de plan.filters. Une colonne déjà filtrée change de valeur (« et pour Toulouse ? »)
        // au lieu de cumuler deux valeurs incompatibles ; une formation citée remplace la précédente (prevKept).
        const _strict = strictFiltersFromQuestion(plan.table, question);
        const _colsNouvelles = new Set([..._strict, ..._filtresPlanner].filter(f => f && f.op !== 'contains_all').map(f => f.col));
        const _prevGardes = prevKept.filter(f => !(f && f.op !== 'contains_all' && _colsNouvelles.has(f.col)));
        plan.filters = mergeFiltersUnique(mergeFiltersUnique(_prevGardes, _strict), _filtresPlanner);
      }
    }

    const _clesPrecedentes = new Set(previousFilters.map(_cleFiltre));
    plan.filtresRepris = (plan.filters || []).map(_cleFiltre).filter(k => _clesPrecedentes.has(k) && !_clesQuestion.has(k));

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

// Deux graphiques pour un pivot : totaux par ligne + barres stackées par colonne.
// Deux graphiques de décomposition d'un tableau croisé :
// - Graphique 1 : total par ligne (ex. académies)
// - Graphique 2 : total par colonne (ex. spécialités)
function renderPivotCharts(result, plan) {
  const matrix = result?.matrix || [];
  const colValues = result?.colValues || [];
  const total = result?.total || 0;
  if (!matrix.length || !colValues.length) return '';

  const shortLabel1 = _shortColName(plan.targetCol || '');
  const shortLabel2 = _shortColName(plan.targetCol2 || '');

  // Graphique 1 — totaux par ligne (colonne de gauche du pivot)
  const rowTotals = matrix.map(r => ({ value: r.value, count: r.total }));
  const maxRow = Math.max(...rowTotals.map(r => r.count), 1);
  const bars1 = rowTotals.map(r => {
    const w = Math.max(2, Math.round(r.count / maxRow * 100));
    const pct = total ? (r.count / total * 100).toFixed(1).replace('.', ',') : '0';
    return `<div style="display:grid;grid-template-columns:minmax(100px,180px) 1fr auto;gap:8px;align-items:center"><div style="font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(r.value)}">${escapeHtml(r.value)}</div><div style="height:10px;background:var(--gris1);border-radius:6px;overflow:hidden"><div style="height:10px;width:${w}%;background:var(--albert);border-radius:6px"></div></div><div style="font-size:11px;font-weight:700">${r.count.toLocaleString('fr-FR')} <span style="color:var(--gris3);font-weight:400">${pct} %</span></div></div>`;
  }).join('');

  // Graphique 2 — totaux par colonne (en-têtes du pivot), triés par effectif
  const colTotals = colValues.map((col, i) => ({
    value: col,
    count: matrix.reduce((s, r) => s + (r.cells[i] || 0), 0)
  })).sort((a, b) => b.count - a.count);
  const maxCol = Math.max(...colTotals.map(r => r.count), 1);
  const bars2 = colTotals.map(r => {
    const w = Math.max(2, Math.round(r.count / maxCol * 100));
    const pct = total ? (r.count / total * 100).toFixed(1).replace('.', ',') : '0';
    return `<div style="display:grid;grid-template-columns:minmax(100px,220px) 1fr auto;gap:8px;align-items:center"><div style="font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(r.value)}">${escapeHtml(r.value)}</div><div style="height:10px;background:var(--gris1);border-radius:6px;overflow:hidden"><div style="height:10px;width:${w}%;background:var(--vert,#16a34a);border-radius:6px"></div></div><div style="font-size:11px;font-weight:700">${r.count.toLocaleString('fr-FR')} <span style="color:var(--gris3);font-weight:400">${pct} %</span></div></div>`;
  }).join('');

  const chart1 = `<div style="margin-bottom:20px"><div style="font-size:12px;font-weight:700;color:var(--gris4,#374151);margin-bottom:8px">Total par ${escapeHtml(shortLabel1)}</div><div style="display:grid;gap:5px;max-width:560px">${bars1}</div></div>`;
  const chart2 = `<div><div style="font-size:12px;font-weight:700;color:var(--gris4,#374151);margin-bottom:8px">Total par ${escapeHtml(shortLabel2)}</div><div style="display:grid;gap:5px;max-width:560px">${bars2}</div></div>`;

  return `<div class="de-chart-export-wrap" style="margin:10px 0">${chart1}${chart2}${_chartExportBtn('graphique_pivot.png')}</div>`;
}

function renderMiniBarChart(rows, total, filename) {
  if (!rows || !rows.length) return '';
  const max = Math.max(...rows.map(r => r.count || 0), 1);
  const bars = rows.slice(0,12).map(r => {
    const w = Math.max(2, Math.round((r.count || 0) / max * 100));
    const pct = total ? ((r.count || 0) / total * 100).toFixed(1) : '0';
    return `<div data-bar-label="${escapeHtml(r.value)}" data-bar-value="${pct}" data-bar-count="${(r.count||0).toLocaleString('fr-FR')}" style="display:grid;grid-template-columns:minmax(120px,220px) 1fr auto;gap:8px;align-items:center"><div style="font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(r.value)}">${escapeHtml(r.value)}</div><div style="height:12px;background:var(--gris1);border-radius:6px;overflow:hidden"><div style="height:12px;width:${w}%;background:var(--albert);border-radius:6px"></div></div><div style="font-size:11px;font-weight:700">${(r.count || 0).toLocaleString('fr-FR')}</div></div>`;
  }).join('');
  return `<div class="de-chart-export-wrap" style="margin:10px 0"><div style="display:grid;gap:6px;max-width:560px">${bars}</div>${_chartTypeSwitcher('bar')}${_chartExportBtn(filename || 'graphique_barres.png')}</div>`;
}

// Barres verticales (colonnes) — alternative visuelle au bar chart horizontal
function renderMiniColChart(rows, total, filename) {
  if (!rows || !rows.length) return '';
  const max = Math.max(...rows.map(r => r.count || 0), 1);
  const top = rows.slice(0, 10);
  const colW = Math.max(32, Math.min(60, Math.floor(480 / top.length)));
  const cols = top.map(r => {
    const h = Math.max(4, Math.round((r.count || 0) / max * 120));
    const pct = total ? ((r.count || 0) / total * 100).toFixed(1) : '0';
    const label = r.value && r.value.length > 10 ? r.value.slice(0, 9) + '…' : (r.value || '');
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;width:${colW}px" title="${escapeHtml(r.value)} — ${(r.count||0).toLocaleString('fr-FR')} (${pct} %)"><div style="font-size:10px;font-weight:700">${(r.count||0).toLocaleString('fr-FR')}</div><div style="width:${colW-8}px;height:${h}px;background:var(--albert);border-radius:4px 4px 0 0"></div><div style="font-size:10px;text-align:center;color:var(--gris3);word-break:break-all;max-width:${colW}px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${escapeHtml(label)}</div></div>`;
  }).join('');
  return `<div class="de-chart-export-wrap" style="margin:10px 0"><div style="display:flex;align-items:flex-end;gap:4px;height:160px;border-bottom:2px solid var(--gris1);padding-bottom:0;overflow-x:auto">${cols}</div>${_chartTypeSwitcher('col')}${_chartExportBtn(filename || 'graphique_colonnes.png')}</div>`;
}

// Sélecteur de type de graphique — boutons discrets sous le graphique
// Permet de basculer entre barres H / barres V / camembert sans re-poser la question.
// Les données sont déjà dans le DOM (data-bar-* attributes) pour les barres.
function _chartTypeSwitcher(currentType) {
  const types = [
    { id: 'bar', icon: '▬', label: 'Barres H' },
    { id: 'col', icon: '▐', label: 'Barres V' },
    { id: 'pie', icon: '◕', label: 'Camembert' },
  ];
  const btns = types.map(t => {
    const active = t.id === currentType;
    const style = active
      ? 'background:var(--albert);color:white;border-color:var(--albert)'
      : 'background:white;color:var(--gris3);border-color:var(--gris1)';
    return `<button onclick="if(typeof switchChartType==='function')switchChartType(this,'${t.id}')" data-chart-type="${t.id}" style="border:1px solid;border-radius:6px;padding:3px 9px;font-size:10px;font-weight:700;cursor:pointer;${style}" title="${t.label}">${t.icon} ${t.label}</button>`;
  }).join('');
  return `<div style="display:flex;gap:6px;margin-top:8px;align-items:center"><span style="font-size:10px;color:var(--gris3);margin-right:2px">Afficher en :</span>${btns}</div>`;
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

  return `<div class="de-chart-export-wrap" style="margin:10px 0"><div style="display:flex;gap:18px;flex-wrap:wrap;align-items:center">${svg}${legend}</div>${_chartTypeSwitcher('pie')}${_chartExportBtn('graphique_camembert.png')}</div>`;
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

/* ═══════════════ v27.7 — Intitulés de formation cités dans la question ═══════════════
   « combien de PASS option Droit » : PASS et Droit sont des mots des intitulés de formation.
   Avant, aucun filtre n'était créé sans le mot « filière » / « formation » (PASS inconnu),
   et le moteur comptait tout le fichier. Désormais :
   - tout mot de la question présent dans les intitulés de formation de la table active
     devient un filtre « l'intitulé contient » (sur toutes les colonnes de formation à la fois) ;
   - « liste / toutes les filières / options » affiche les valeurs distinctes, pas un export ;
   - un mot après « option / mention / spécialité » introuvable arrête le calcul (pas de chiffre faux). */

const FORMATION_TERMS_COL = 'Intitulé de formation contenant';
const FORMATION_TERM_STOP = new Set(`
  combien nombre nombres total totaux effectif effectifs liste lister listez listes enumere enumerer donne donner donnez moi nous vous
  tout tous toute toutes les des une uns aux avec sans pour par dans sur entre selon chez vers apres avant parmi hors sauf
  quelles quels quelle quel sont est etait ete ont avait sera elle elles ils qui que quoi dont ainsi aussi alors mais car comme
  plus moins tres bien peu beaucoup autre autres meme ceci cela celle celles ceux leur leurs notre votre son ses mon mes ton tes
  formation formations filiere filieres option options mention mentions specialite specialites parcours intitule intitules
  diplome diplomes cursus offre offres type types categorie categories detail details detaille detaillee detailles detaillees
  complete complet completes complets ensemble differentes differents differente different repartition ventilation
  pourcentage proportion part parts taux acces place places capacite capacites candidat candidats candidature candidatures
  admis admise admises admission admissions voeu voeux proposition propositions boursier boursiers bourse bourses
  neo bachelier bacheliers bac general generale technologique professionnel pro serie series filles garcons femmes hommes
  public publics publique publiques prive prives privee privees statut etablissement etablissements session sessions
  annee annees france entiere national nationale nationaux academie academies region regions departement departements
  ville villes commune communes graphique tableau camembert histogramme top classement principales principaux
  moyenne mediane minimum maximum existe existent propose proposes proposee proposees disponible disponibles
  ouvert ouverte ouvertes ouverts parcoursup open data donnees base jeu fichier table colonne colonnes ligne lignes
  svp merci peux pouvez voudrais aimerais veux montre montrer affiche afficher selective selectives selectif selectifs
  demande demandes demandee demandees exporte exporter export excel csv superieur superieure inferieur inferieure egal
`.trim().split(/\s+/));
const FORMATION_COL_RE = /fili[eè]re|formation|sp[eé]cialit[eé]|mention|parcours|dipl[oô]me|intitul[eé]/i;
const NOT_FORMATION_COL_RE = /statut|[eé]tablissement|contrat|session|acad[eé]mi|d[eé]partement|r[eé]gion|commune|ville|s[eé]lectiv|capacit|effectif|nombre|\bnb\b|pourcentage|%|taux|rang|\bdont\b|uai|code|lyc[eé]e|candidat|v[oœ]eux?|boursier|sexe/i;
const GEO_COL_RE = /acad[eé]mi|d[eé]partement|r[eé]gion|commune|ville/i;
const _formationTermsCache = new WeakMap();

// Colonnes de formation (texte) et mots qu'elles contiennent ; mots des colonnes géographiques à part
function formationTermsInfo(table) {
  if (!table || !Array.isArray(table.objects)) return { cols: [], words: new Set(), geo: new Set() };
  const cached = _formationTermsCache.get(table);
  if (cached && cached.n === table.objects.length) return cached;
  const headers = (table.headers || Object.keys(table.objects[0] || {})).filter(h => h && !/^(id|manualSort)$/i.test(String(h)));
  const sample = table.objects.slice(0, 300);
  const textual = h => {
    const vals = sample.map(r => r?.[h]).filter(v => v !== undefined && v !== null && String(v).trim() !== '');
    return vals.length > 0 && vals.filter(v => /[a-zA-ZÀ-ÿ]/.test(String(v))).length >= vals.length * 0.8;
  };
  // v27.8 — noms abrégés développés (GRP_FORM_ACC) et, à défaut, colonnes reconnues par leur contenu (« Colonne J »)
  const parContenu = h => {
    if (typeof plannerColumnKind !== 'function' || typeof uniqueValues !== 'function') return false;
    try { return plannerColumnKind(h, uniqueValues(table, h, 200)) === 'formation'; } catch (e) { return false; }
  };
  const cols = headers.filter(h => textual(h) && !NOT_FORMATION_COL_RE.test(_hx(h)) && (FORMATION_COL_RE.test(_hx(h)) || parContenu(h)));
  const geoCols = headers.filter(h => GEO_COL_RE.test(_hx(h)) && !cols.includes(h));
  const words = new Set(), geo = new Set();
  const seen = new Set();
  table.objects.forEach(r => {
    cols.forEach(c => {
      const v = r?.[c];
      if (v === undefined || v === null || v === '') return;
      const k = c + '\u0001' + v;
      if (seen.has(k)) return;
      seen.add(k);
      normalizeText(v).split(' ').forEach(w => { if (w) words.add(w); });
    });
    geoCols.forEach(c => {
      const v = r?.[c];
      if (v === undefined || v === null || v === '') return;
      const k = c + '\u0001' + v;
      if (seen.has(k)) return;
      seen.add(k);
      normalizeText(v).split(' ').forEach(w => { if (w) geo.add(w); });
    });
  });
  const info = { n: table.objects.length, cols, words, geo };
  _formationTermsCache.set(table, info);
  return info;
}

// Formes du mot présentes dans les intitulés (« écoles » → [écoles, école]), ou null
function formationWordForm(token, info) {
  const sing = token.replace(/(s|x)$/, '');
  const formes = [...new Set([token, sing, token + 's'])].filter(w => w.length >= 3 && info.words.has(w));
  return formes.length ? formes : null;
}

// Mots de la question à chercher dans les intitulés, et mots d'option introuvables
function formationTermsFromQuestion(table, question, otherFilters = []) {
  const info = formationTermsInfo(table);
  const out = { terms: [], labels: [], missing: [] };
  if (!info.cols.length) return out;
  const q = normalizeText(question || '');
  const covered = new Set();
  (otherFilters || []).forEach(f => normalizeText(f.value).split(' ').forEach(w => covered.add(w)));
  // Mots qui suivent « option / mention / spécialité / parcours » : toujours cherchés, signalés s'ils sont introuvables
  const forced = new Set();
  const reOpt = /\b(?:option|options|mention|mentions|specialite|specialites|parcours)\s+(?:(?:de|d|en|du|des|la|le|l)\s+)?([a-z0-9]{3,})/g;
  let m;
  while ((m = reOpt.exec(q))) if (!FORMATION_TERM_STOP.has(m[1])) forced.add(m[1]);
  const originals = String(question || '').split(/[^A-Za-zÀ-ÿ0-9œŒæÆ]+/).filter(Boolean);
  const labelFor = tok => originals.find(w => normalizeText(w) === tok) || tok;
  q.split(' ').forEach(tok => {
    if (tok.length < 3 || /^\d+$/.test(tok) || FORMATION_TERM_STOP.has(tok) || covered.has(tok)) return;
    const form = formationWordForm(tok, info);
    if (!form) { if (forced.has(tok)) out.missing.push(labelFor(tok)); return; }
    if (form.some(w => info.geo.has(w)) && !forced.has(tok)) return; // Bordeaux, Gironde… : des lieux, pas des formations
    if (out.terms.some(t => t.some(w => form.includes(w)))) return;
    out.terms.push(form);
    out.labels.push(labelFor(tok));
  });
  return out;
}

function makeFormationTermsFilter(table, terms, labels) {
  const info = formationTermsInfo(table);
  const label = labels.join(' + ');
  return { col: FORMATION_TERMS_COL, op: 'contains_all', cols: info.cols.slice(), terms: terms.slice(), value: label, label, source: 'termes_formation' };
}

// Ajoute au plan le filtre « intitulé contient » quand la question cite des mots d'intitulés
// que les filtres déjà trouvés ne couvrent pas.
function applyFormationTerms(plan) {
  if (!plan || !plan.table || ['compare', 'chart_current', 'export_current_excel', 'export_current_csv'].includes(plan.tool)) return plan;
  const info = formationTermsInfo(plan.table);
  if (!info.cols.length) return plan;
  const formCols = new Set(info.cols);
  const isFormationFilter = f => f && (f.source === 'termes_formation' || (formCols.has(f.col) && f.op !== 'neq'));
  const others = (plan.filters || []).filter(f => !isFormationFilter(f));
  const found = formationTermsFromQuestion(plan.table, plan.question, others);
  if (found.missing.length) plan.unresolvedTerms = found.missing;
  if (!found.terms.length) return plan;
  const formFilters = (plan.filters || []).filter(f => isFormationFilter(f) && f.source !== 'termes_formation');
  const coveredByPlanner = formFilters.length && found.terms.every(t => formFilters.some(f => normalizeText(f.value).split(' ').some(w => t.includes(w))));
  if (coveredByPlanner) return plan;
  const filtre = makeFormationTermsFilter(plan.table, found.terms, found.labels);
  // v27.8 — si une seule colonne contient tous les mots, on prend la plus précise (le moins de lignes) :
  // « licences de droit » = « Licence - Droit », pas toute la famille « Licence - Droit, économie, gestion ».
  // Sinon (« CPGE » + « MPSI » dans deux colonnes différentes), on cherche sur toutes les colonnes ensemble.
  if (found.terms.length > 1) {
    let meilleure = null;
    const objets = plan.table.objects || [];
    // seulement les colonnes remplies (≥ 80 % des lignes) : une colonne presque vide (« très détaillée »)
    // ne contient les deux mots que pour quelques lignes et donnerait un compte trop petit
    const remplie = c => objets.filter(r => String(r?.[c] ?? '').trim() !== '').length >= objets.length * 0.8;
    info.cols.filter(remplie).forEach(c => {
      const n = applyLocalActionFilters(plan.table.objects || [], [{ ...filtre, cols: [c] }]).length;
      if (n > 0 && (!meilleure || n < meilleure.n)) meilleure = { c, n };
    });
    if (meilleure) filtre.cols = [meilleure.c];
  }
  plan.filters = [...others, filtre];
  plan.mentionedCols = Array.from(new Set([...(plan.mentionedCols || []), ...info.cols]));
  return plan;
}

// « liste / toutes les filières / quelles sont les options… » : valeurs distinctes, pas un export de lignes
function hasExportWords(q) { return /\bexport|\bexcel\b|\bxlsx\b|\bcsv\b|telecharg/.test(q); }
function hasListCue(q) {
  if (/\bplus\b|\bmoins\b|\btop\b|classement|principa/.test(q)) return false;
  return /\b(liste|lister|listez|enumere|enumerer)\b/.test(q)
    || /\b(quelles|quels) sont les\b/.test(q)
    || /\b(toutes|tous) les\b/.test(q)
    || /\bles different(e)?s\b/.test(q)
    || /\bavec (toutes )?(les |ses )?options\b/.test(q);
}
function hasFormationNoun(q) { return /\b(filieres?|formations?|options?|mentions?|specialites?|parcours|diplomes?|intitules?|cursus)\b/.test(q); }
function isListValuesRequest(question) {
  const q = normalizeText(question || '');
  return !hasExportWords(q) && hasListCue(q) && hasFormationNoun(q);
}

// Colonne à lister : la colonne de formation la plus fine parmi les lignes retenues
function pickListColumn(table, filters) {
  const info = formationTermsInfo(table);
  if (!info.cols.length) return null;
  const rows = applyLocalActionFilters(table.objects || [], filters || []);
  const stats = info.cols.map(c => {
    const vals = rows.map(r => String(r?.[c] ?? '').trim()).filter(Boolean);
    return { c, d: new Set(vals).size, rempli: rows.length ? vals.length / rows.length : 0 };
  });
  const lisible = stats.filter(s => s.d >= 2 && s.d <= Math.max(30, rows.length * 0.6));
  // v27.8 — open data réel : la colonne la plus fine peut être presque vide (PASS : 70 lignes remplies sur 287).
  // On préfère une colonne remplie pour au moins 80 % des lignes ; à défaut, la plus remplie.
  const remplie = lisible.filter(s => s.rempli >= 0.8);
  if (remplie.length) return remplie.sort((a, b) => b.d - a.d)[0].c;
  if (lisible.length) return lisible.sort((a, b) => b.rempli - a.rempli || b.d - a.d)[0].c;
  const plusieurs = stats.filter(s => s.d >= 2).sort((a, b) => a.d - b.d);
  return (plusieurs[0] || stats.sort((a, b) => b.d - a.d)[0]).c;
}
function applyListMode(plan) {
  if (!plan || !plan.table || plan.tool === 'compare') return plan;
  const q = normalizeText(plan.question || '');
  if (hasExportWords(q) || !hasListCue(q)) return plan;
  const hasTerms = (plan.filters || []).some(f => f.source === 'termes_formation');
  if (!hasFormationNoun(q) && !hasTerms) return plan;
  const col = pickListColumn(plan.table, plan.filters);
  if (!col) return plan;
  plan.tool = 'group_by';
  plan.listMode = true;
  plan.targetCol = col;
  plan.limit = 300;
  return plan;
}

// v27.8 — open data (une ligne = une formation) : « combien de places / candidats / admis » = somme d'effectifs,
// pas le nombre de formations.
const MESURES_SOMME = [
  { re: /\bplaces?\b|\bcapacites?\b/, col: /capacit/, unite: 'places' },
  { re: /\bcandidates\b/, col: /effectif des candidates/, unite: 'candidates' },
  { re: /\bboursiers?\b.*\badmis\b|\badmis\b.*\bboursiers?\b/, col: /admis boursiers/, unite: 'admis boursiers' },
  { re: /\badmis(es)?\b|\bont accepte\b/, col: /ayant accepte.*admis/, unite: 'admis' },
  { re: /\bpropositions?\b/, col: /recu une proposition/, unite: 'propositions' },
  { re: /\bcandidats?\b|\bcandidatures?\b|\bvoeux\b/, col: /effectif total des candidats pour une formation/, unite: 'candidats' },
];
function applyMeasureSum(plan) {
  if (!plan || !plan.table || plan.tool !== 'count_rows' || plan.table.rowUnit !== 'formation') return plan;
  const q = normalizeText(plan.question || '');
  if (/\b(combien|nombre) d(e|es)? ?(formations?|filieres?|offres?|etablissements?)\b/.test(q)) return plan;
  const headers = plan.table.headers || [];
  for (const m of MESURES_SOMME) {
    if (!m.re.test(q)) continue;
    const col = headers.find(h => m.col.test(normalizeText(h)));
    if (!col) continue;
    plan.tool = 'sum';
    plan.sumCol = col;
    plan.sumUnit = m.unite;
    return plan;
  }
  return plan;
}

// v27.8 — garde-fou : un critère cité dans la question (boursiers, filles, apprentis, Pays Basque, public/privé,
// sélective, lycée X, Gironde…) qui n'a donné aucun filtre → on s'arrête au lieu de répondre sur tout le fichier.
const CONCEPTS_A_FILTRER = [
  { re: /\bboursiers?\b|\bbourse\b/, mot: 'boursiers', ok: t => /bours/.test(t) },
  { re: /\b(filles?|femmes?|feminins?|garcons?|hommes?|masculins?)\b/, mot: 'filles / garçons', ok: (t, f) => /sexe|genre/.test(t) || /^(f|m|h|feminin|masculin|femmes?|hommes?|filles?|garcons?)$/.test(normalizeText(f.value)) || (typeof plannerColumnKind === 'function' && plannerColumnKind(f.col) === 'sexe') },
  { re: /\bapprenti(e|s|es)?\b|\bapprentissage\b|\balternance\b/, mot: 'apprentis', ok: t => /appr|altern/.test(t) },
  { re: /\bbasques?\b/, mot: 'Pays Basque', ok: t => /basque/.test(t) },
  { re: /\bpubli(c|cs|que|ques)\b|\bprive(e|s|es)?\b/, mot: 'public / privé', ok: t => /publi|priv|statut|secteur/.test(t) },
  { re: /\bselecti(f|fs|ve|ves)\b/, mot: 'sélective', ok: t => /selecti/.test(t) },
];
const LIEUX_AMBIGUS = new Set('somme manche nord lot var ain cher orne oise eure gers aube aude gard jura tarn indre doubs loire marne meuse vienne creuse rhone yonne'.split(' '));
function conceptsNonFiltres(plan) {
  if (!plan || !plan.table || ['compare', 'chart_current', 'export_current_excel', 'export_current_csv'].includes(plan.tool)) return [];
  const q = normalizeText(plan.question || '');
  const filtres = (plan.filters || []).filter(Boolean);
  // la colonne analysée ou additionnée compte aussi (« admis boursiers » → colonne « admis boursiers »)
  const cibles = [plan.targetCol, plan.targetCol2, plan.sumCol].filter(Boolean).map(c => ({ col: c, value: '' }));
  const texte = f => `${_hx(f.col)} ${normalizeText(f.value)} ${normalizeText(f.label || '')}`;
  const manque = [];
  CONCEPTS_A_FILTRER.forEach(c => {
    if (!c.re.test(q)) return;
    if (![...filtres, ...cibles].some(f => c.ok(texte(f), f))) manque.push(c.mot);
  });
  const lycee = q.match(/\blycee ([a-z]{3,})/);
  if (lycee && !['general', 'generale', 'professionnel', 'technologique', 'agricole', 'origine', 'accueil'].includes(lycee[1])
    && !filtres.some(f => normalizeText(f.value).split(' ').includes(lycee[1]))) manque.push(`lycée ${lycee[1]}`);
  const lieux = (typeof plannerGeoNames !== 'undefined' && Array.isArray(plannerGeoNames)) ? plannerGeoNames : [];
  lieux.forEach(l => {
    if (l.length < 4 || LIEUX_AMBIGUS.has(l) || !new RegExp(`(^| )${l}( |$)`).test(q)) return;
    if (!filtres.some(f => normalizeText(f.value).includes(l) || (f.terms || []).some(t => (Array.isArray(t) ? t : [t]).includes(l)))) manque.push(l);
  });
  return [...new Set(manque)];
}
function unresolvedConceptExecution(plan, manque, raison) {
  const cols = (plan.table.headers || []).filter(h => !/^(id|manualSort)$/i.test(String(h)));
  const quoi = raison || `je n'ai trouvé dans les données aucune colonne ni valeur pour « ${manque.join(' », « ')} »`;
  const html = `<h4>Critère non reconnu</h4><p>Pour cette question, ${escapeHtml(quoi)} (${escapeHtml(plan.table.name || 'table active')}). `
    + `Je ne donne donc pas de chiffre, plutôt qu'un résultat sur tout le fichier.</p>`
    + (() => {
      // colonnes chiffrées liées au critère (« % d'admis boursiers ») : elles mesurent, elles ne sélectionnent pas de lignes
      const racines = (manque || []).map(m => normalizeText(m).split(' ')[0].slice(0, 5)).filter(r => r.length >= 4);
      const liees = cols.filter(h => racines.some(r => _hx(h).includes(r)) && !_isEtatCol(plan.table, h));
      return liees.length ? `<p>Colonnes chiffrées liées : ${liees.map(h => `« ${escapeHtml(h)} »`).join(', ')}. Elles donnent des effectifs ou des pourcentages par ligne, pas un critère pour choisir des lignes : demandez par exemple « combien d'admis ${escapeHtml(manque[0])} » ou « ${escapeHtml(manque[0])} moyen ».</p>` : '';
    })()
    + `<p><strong>Colonnes disponibles</strong> : ${cols.slice(0, 25).map(escapeHtml).join(' · ')}${cols.length > 25 ? ' …' : ''}</p>`
    + `<p style="font-size:12px;color:var(--gris3)">Reformulez avec le nom d'une colonne ou une valeur présente dans le fichier, ou renommez la colonne concernée (par exemple « Boursier »).</p>`;
  return { kind: 'unresolved', plan, result: { missing: manque, suggestions: [] }, text: `NON RECONNU : ${quoi}`, html };
}

// Calcul arrêté : un terme de la question ne correspond à aucune formation
function unresolvedFormationExecution(plan, missing, termFilter) {
  const info = formationTermsInfo(plan.table);
  let base = plan.table.objects || [];
  const labels = termFilter ? termFilter.label.split(' + ') : [];
  // Pistes : les intitulés qui contiennent au moins le premier terme reconnu
  if (termFilter) base = applyLocalActionFilters(base, [{ ...termFilter, terms: [termFilter.terms[0]] }]);
  const col = pickListColumn({ ...plan.table, objects: base }, []) || info.cols[0];
  const sugg = col ? topCountsForRows(base, col, 15).top : [];
  const quoi = missing.length
    ? `aucune formation dont l'intitulé contient « ${missing.join(' », « ')} »${termFilter ? ` (avec « ${termFilter.label} »)` : ''}`
    : `aucune formation dont l'intitulé contient à la fois « ${labels.join(' » et « ')} »`;
  const html = `<h4>Formation non trouvée</h4><p>Je n'ai trouvé ${escapeHtml(quoi)} dans <strong>${escapeHtml(plan.table.name || 'la table active')}</strong>. `
    + `Je ne donne donc pas de chiffre, plutôt qu'un total faux.</p>`
    + (sugg.length ? `<p><strong>Intitulés disponibles${labels.length ? ` pour « ${escapeHtml(labels[0])} »` : ''}</strong> (${escapeHtml(col)}) :</p><ul>${sugg.map(s => `<li>${escapeHtml(s.value)} : <strong>${s.count.toLocaleString('fr-FR')}</strong></li>`).join('')}</ul>` : '')
    + `<p style="font-size:12px;color:var(--gris3)">Reformulez avec l'un de ces intitulés.</p>`;
  return { kind: 'unresolved', plan, result: { missing, suggestions: sugg }, text: `NON TROUVÉ : ${quoi}`, html };
}

function isDataEngineQuestion(question) {
  const q = normalizeText(question || '');
  if (!q) return false;
  // Exclusion : demandes de synthèse/résumé général → répondre via Albert narratif, pas Data Engine
  if (/^(fais |donne|produis |r[eé]dige )?(une? )?(synth[eè]se|r[eé]sum[eé]|bilan|vue d'ensemble|portrait|analyse globale)/.test(q)) return false;
  return /compare|comparaison|comparer|versus| vs |combien|nombre|effectif|compte|compter|repartition|r[eé]partition|ventilation|par |groupe|group[eé]|top|classement|principa|plus frequen|plus fréquent|croise|crois[eé]|tableau crois[eé]|pivot|moyen|moyenne|median|m[eé]diane|minimum|maximum|min|max|export|excel|csv|liste|filtre|graphique|graphe|diagramme|histogramme|camembert|barres?|boursier|basque|hors|sauf|seulement|uniquement|visualis|repr[eé]sent|montre-?moi|dessine|trace|issus?\s+d[ue]|originaires?|venant\s+d[ue]|provenant|scolaris|scolarit/.test(q) || isListValuesRequest(question) || isFollowUpQuestion(question);
}

function inferMeasureIntent(question) {
  const q = normalizeText(question || '');
  if (/compare|comparaison|comparer|versus| vs /.test(q)) return 'compare';
  if (/graphique|graphe|diagramme|histogramme|camembert|barres?|chart|visualis|repr[eé]sent|montre-?moi|dessine|trace/.test(q)) return 'group_by';
  // v27.7 — « liste des filières / options » = valeurs distinctes ; l'export reste pour « exporte / Excel / CSV »
  if (isListValuesRequest(question)) return 'group_by';
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
    // v27.8 — seulement les noms génériques : « des BTS » est un filtre, pas une dimension du croisement
    const _isF = s => /formation|fili[eè]re|sp[eé]cialit[eé]|grands?\s*groupe/.test(s);
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
    if (plannerPlan) return inheritConversationContext(applyMeasureSum(applyListMode(applyFormationTerms(plannerPlan))), question);
  }

  // Fallback V16 si planner indisponible.
  const q = normalizeText(question || '');
  const mentionedCols = findMentionedColumns(headers, question, 4);
  const targetCol = tool === 'group_by' ? (detectTargetColumn(headers, q) || mentionedCols[0] || null) : null;
  // V25.1 — idem : le fallback ne doit pas analyser le contexte textuel
  // précédent comme s'il s'agissait de la question utilisateur.
  const filters = detectFilters(table, normalizeText(question || ''), targetCol);
  return inheritConversationContext(applyMeasureSum(applyListMode(applyFormationTerms({
    tool,
    table,
    filters,
    targetCol,
    mentionedCols,
    question,
    createdAt: new Date().toISOString()
  }))), question);
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
    const clonedPlan = { ...(prev.plan || {}), renderChart: true, chartType: isPieChartRequest(plan.question || '') ? 'pie' : (prev.plan?.chartType || 'bar') };
    const html = renderDataEngineResultHtml(prev.plan?.tool || prev.kind, clonedPlan, prev.result);
    return { kind: prev.kind, plan: clonedPlan, result: prev.result, text: prev.text, html };
  }
  // Branche pivot : deux graphiques (totaux + stacké) depuis la matrix complète
  if (prev.kind === 'pivot') {
    const html = `${deTitleHtml(`${_shortColName(prev.plan?.targetCol||'')} × ${_shortColName(prev.plan?.targetCol2||'')}`, prev.plan?.blockId, prev.plan?.originalTitle)}${renderPivotCharts(prev.result, prev.plan||{})}`;
    return { kind: 'pivot', plan: prev.plan, result: prev.result, text: prev.text, html };
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
// v27.8 — une même valeur trouvée dans deux colonnes (académie d'origine ET d'accueil, lycée d'origine ET d'accueil) :
// on ne garde que la colonne voulue par la question, sinon le croisement des deux filtres vide le résultat.
// « à Bordeaux » désigne la ville : le filtre d'académie de même nom est retiré (sauf si « académie » est écrit).
function resolveRoleDuplicates(plan) {
  if (!plan || !Array.isArray(plan.filters) || plan.filters.length < 2) return plan;
  const q = normalizeText(plan.question || '');
  const role = c => (typeof plannerColumnRole === 'function') ? plannerColumnRole(c) : { accueil: /accueil|accept/.test(_hx(c)), origine: /origine|scolarit/.test(_hx(c)) };
  const veutOrigine = /venant|issus?|originaires?|provenant|scolaris|\borigine\b|\bd origine\b/.test(q);
  const commune = plan.filters.filter(f => f.source === 'commune_a');
  let filters = plan.filters;
  if (commune.length && !/academi|departement|region/.test(q)) {
    const vals = new Set(commune.map(f => normalizeText(f.value)));
    filters = filters.filter(f => f.source === 'commune_a' || f.op === 'contains_all' || !vals.has(normalizeText(f.value)));
  }
  const groupes = new Map();
  filters.forEach(f => {
    if (!f || f.op === 'contains_all') return;
    const k = `${f.op || 'eq'}|${normalizeText(f.value)}`;
    if (!groupes.has(k)) groupes.set(k, []);
    groupes.get(k).push(f);
  });
  const retirer = new Set();
  groupes.forEach(g => {
    const cols = new Set(g.map(f => f.col));
    if (cols.size < 2) return;
    const voulu = g.find(f => veutOrigine ? role(f.col).origine : role(f.col).accueil) || g[0];
    g.forEach(f => { if (f !== voulu) retirer.add(f); });
  });
  plan.filters = filters.filter(f => !retirer.has(f));
  return plan;
}

function finalSanitizeAnalysisPlan(plan) {
  return resolveRoleDuplicates(_finalSanitizeAnalysisPlanBase(plan));
}

function _finalSanitizeAnalysisPlanBase(plan) {
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
  // v27.7 — filtre « intitulé de formation contenant » : vient de la question elle-même, toujours conservé
  const termFilters = (plan.filters || []).filter(f => f && f.source === 'termes_formation');
  const keepTermFilters = () => {
    if (!termFilters.length) return;
    plan.filters = [...(plan.filters || []).filter(f => f.source !== 'termes_formation'), ...termFilters];
  };

  if (onlyBoursier) {
    // v27.8 — colonne boursier reconnue aussi sous un nom abrégé (BOURS) : filtre du planner gardé
    const viaStrict = strict.filter(f => /boursier/.test(_hx(f.col)));
    plan.filters = viaStrict.length ? viaStrict : (plan.filters || []).filter(f => /boursier/.test(_hx(f.col)));
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
      if (f.source === 'termes_formation') return true; // v27.7 — mots cités dans la question
      if (strictCols.has(f.col)) return false; // remplacés par strict ci-dessous
      const cn = normalizeText(f.col);
      const val = normalizeText(f.value);

      // V25.1 — garde-fou mémoire étanche : une valeur numérique (ex. moyenne 22 calculée avant)
      // n'est conservée que si elle figure dans la question.
      if (/voeu|vœu/.test(cn) && !/voeu|vœu|voeux|vœux/.test(q)) return false;
      // v27.8 — sauf colonne d'état codée 1 / 0 (Apprenti = 1) : c'est un état, pas un chiffre calculé
      const etat01 = table && _distinctValues(table, f.col).every(x => /^(0|1)$/.test(String(x).trim()));
      if (!etat01 && /^\d+(?:[,.]\d+)?$/.test(val) && !new RegExp(`(^|\\D)${String(f.value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\D|$)`).test(plan.question || '')) return false;
      // v27.8 — depuis V25.1 le planner ne lit que la question : ses filtres en viennent.
      // L'ancien tri par nom de colonne (« formation », « boursier »…) écartait à tort les filtres
      // des colonnes abrégées (BOURS, GRP_FORM_ACC) ou nommées autrement (« Département de l'établissement »).
      return true;
    });
    plan.filters = mergeFiltersUnique(kept, strict);
    return plan;
  }

  // Les commandes de suivi héritent du contexte précédent, mais uniquement
  // des filtres réellement stockés dans le dernier plan + les nouveaux filtres stricts.
  // On ignore totalement les filtres produits par le planner pour la commande courte.
  if (prev && (dimensionFollowUp || filterFollowUp)) {
    // v27.10 — filtres reçus d'inheritConversationContext : filtres précédents conservés + filtres posés par
    // cette question. Avant, ils étaient écrasés par « précédents + stricts » : « et pour l'académie de Bordeaux ? »
    // perdait Bordeaux, et « et pour les BTS ? » après « combien de PASS » recomptait les PASS.
    const _entrants = (plan.filters || []).slice();
    const _clesPrev = new Set((prev.filters || []).map(_cleFiltre));
    const _nouveaux = _entrants.filter(f => !_clesPrev.has(_cleFiltre(f)));
    const _colsNouv = new Set([...strict, ..._nouveaux].filter(f => f && f.op !== 'contains_all').map(f => f.col));
    const _clesEntrants = new Set(_entrants.map(_cleFiltre));
    const _prevGardes = (prev.filters || []).filter(pf => pf && _clesEntrants.has(_cleFiltre(pf)) && !(pf.op !== 'contains_all' && _colsNouv.has(pf.col)));
    plan.filters = mergeFiltersUnique(mergeFiltersUnique(_prevGardes, strict), _nouveaux);
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
    }
    keepTermFilters();
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
  const perim = perimetreResultat('compare', plan, result).html;
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
  return `${deTitleHtml(clearTitle, plan.blockId, plan.originalTitle || clearTitle)}${perim}<p>Base comparée : <strong>${baseTotal.toLocaleString('fr-FR')}</strong> lignes.</p><section class="de-section de-population" style="margin:12px 0;padding:12px;border:1px solid var(--gris2,#e5e7eb);border-radius:10px;background:#fff"><div style="overflow:auto"><table style="border-collapse:separate;border-spacing:0;width:100%;font-size:12px;min-width:360px"><tbody><tr><th style="text-align:left;padding:7px 10px;border-bottom:1px solid var(--gris2,#e5e7eb)">Population</th><th style="text-align:right;padding:7px 10px;border-bottom:1px solid var(--gris2,#e5e7eb)">Nombre</th><th style="text-align:right;padding:7px 10px;border-bottom:1px solid var(--gris2,#e5e7eb)">Part</th></tr>${tableRows}</tbody></table></div>${missingNote}</section>${filtersHtml}${insights}${charts}${statsTable}${detailsTables}${debug}`;
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
  // v27.7 — terme de formation introuvable, ou termes jamais réunis : on s'arrête (pas de total faux)
  if (plan.tool !== 'compare' && plan.tool !== 'chart_current' && plan.tool !== 'export_current_excel' && plan.tool !== 'export_current_csv') {
    const manque = conceptsNonFiltres(plan);
    if (manque.length) return unresolvedConceptExecution(plan, manque);
    const termFilter = (plan.filters || []).find(f => f && f.op === 'contains_all');
    if (plan.unresolvedTerms && plan.unresolvedTerms.length) return unresolvedFormationExecution(plan, plan.unresolvedTerms, termFilter);
    if (termFilter && !applyLocalActionFilters(plan.table.objects || [], [termFilter]).length) return unresolvedFormationExecution(plan, [], termFilter);
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
  if (plan.tool === 'sum') {
    const sum = rows.reduce((t, r) => { const x = _nombreCellule(r?.[plan.sumCol]); return x === null ? t : t + x; }, 0);
    const renseignees = rows.filter(r => _nombreCellule(r?.[plan.sumCol]) !== null).length;
    const result = { sum, count: rows.length, total: (plan.table.objects || []).length, col: plan.sumCol, unite: plan.sumUnit, renseignees };
    const exec = { kind: 'sum', plan, result, text: `SOMME ${plan.sumCol} = ${sum}`, html: renderDataEngineResultHtml('sum', plan, result) };
    rememberDataEngineExecution(exec);
    return exec;
  }
  if (plan.tool === 'group_by' || plan.tool === 'top') {
    // v27.10 — « par couleur » : aucune colonne ne correspond, on le dit au lieu de répartir selon une autre colonne
    if (!plan.targetCol && plan.dimensionIntrouvable) return unresolvedConceptExecution(plan, [], `aucune colonne ne correspond à « ${String(plan.dimensionIntrouvable).trim()} »`);
    const col = plan.targetCol || plan.mentionedCols?.[0];
    if (!col) return null;
    const limit = plan.listMode ? 300 : (plan.limit || detectLimit(plan.question) || (plan.tool === 'top' ? 10 : 30));
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
    const pivot = pivotRows(rows, rowCol, colCol, 12, 99);
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
    // v27.8 — plus de repli sur une colonne au hasard (numéro de candidat, session) : on le dit
    // repli seulement si la question ne précise pas la mesure (« quelle est la moyenne ? ») ; « moyenne des vœux »
    // sans colonne vœux reconnue → arrêt, pas la moyenne d'une autre colonne
    const precise = normalizeText(plan.question || '').split(' ').some(w => w.length >= 4 && !STATS_MOTS_VIDES.has(w) && !/^(candidat|candidats|formation|formations|eleves|lignes)$/.test(w));
    const repli = precise ? null : [plan.targetCol, ...(plan.mentionedCols || [])].find(c => c && !_isIdentifiantCol(c, plan.table)
      && numericStats(plan.table.objects || [], c).numericCount >= Math.max(5, (plan.table.objects || []).length * 0.1));
    const col = inferredStatsCol || repli;
    if (!col) return unresolvedConceptExecution(plan, [], 'aucune colonne numérique ne correspond à la question');
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

// v27.10 — valeur chiffrée d'une cellule, ou null (vide, texte) ; « 1 234,5 » = 1234.5
function _nombreCellule(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = String(v ?? '').replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
function numericStats(rows, col) {
  // v27.10 — case vide ≠ 0 : Number('') vaut 0 et faussait moyenne, médiane et minimum
  const nums = rows.map(r => _nombreCellule(r[col])).filter(v => v !== null).sort((a,b)=>a-b);
  const n = nums.length;
  const sum = nums.reduce((a,b)=>a+b,0);
  const avg = n ? sum / n : null;
  const median = n ? (n % 2 ? nums[(n-1)/2] : (nums[n/2-1] + nums[n/2]) / 2) : null;
  return { total: rows.length, numericCount: n, sum, avg, median, min: n ? nums[0] : null, max: n ? nums[n-1] : null };
}


// v27.8 — colonne numérique désignée par la question (« capacité », « taux d'accès », « vœux »).
// Jamais un identifiant, un code ou la session (moyenne « 2025 »). null si la question ne désigne aucune colonne.
const STATS_MOTS_VIDES = new Set('nombre moyen moyenne moyennes median mediane minimum maximum total dont pour avec parmi des les une quel quelle quels quelles est sont combien'.split(' '));
function _isIdentifiantCol(h, table) {
  if (/\b(id|identifiant|numero|session|annee|code|uai|cp|siret|insee)\b/.test(_hx(h))) return true;
  // par le contenu : des entiers tous différents sur toutes les lignes (1, 2, 3…) = un numéro, pas une mesure
  const rows = table?.objects || [];
  if (rows.length < 20) return false;
  const vals = rows.map(r => r?.[h]).filter(v => v !== '' && v !== null && v !== undefined);
  return vals.length === rows.length && vals.every(v => Number.isInteger(Number(v))) && new Set(vals.map(String)).size === vals.length;
}
function inferNumericStatsColumn(table, question) {
  const q = normalizeText(question || '');
  const motsQ = q.split(' ').filter(w => w.length >= 4 && !STATS_MOTS_VIDES.has(w));
  const proche = (a, b) => a === b || a.replace(/(s|x)$/, '') === b.replace(/(s|x)$/, '');
  const headers = table.headers || Object.keys(table.objects?.[0] || {});
  const candidates = headers.filter(h => h && !/^(id|manualSort)$/i.test(String(h)) && !_isIdentifiantCol(h, table)).map(h => {
    const hn = _hx(h);
    const stats = numericStats(table.objects || [], h);
    if (stats.numericCount < Math.max(5, (table.objects || []).length * 0.1)) return null;
    let score = 0;
    if (/voeu|voeux/.test(q) && /voeu|voeux/.test(hn)) score += 120;
    if (/confirm/.test(q) && /confirm/.test(hn)) score += 80;
    if (/class/.test(q) && /class/.test(hn)) score += 50;
    const motsH = hn.split(' ').filter(w => w.length >= 4);
    motsQ.forEach(w => { if (motsH.some(m => proche(m, w))) score += 60; });
    return { col: h, score, stats };
  }).filter(x => x && x.score > 0).sort((a, b) => b.score - a.score);
  return candidates[0]?.col || null;
}

function dataEngineResultToContext(exec) {
  if (!exec || !exec.plan) return '';
  const p = exec.plan;
  const filters = (p.filters || []).map(f => `${f.col} ${f.op === 'neq' ? '≠' : '='} "${f.value}"`).join(' ; ') || 'aucun';
  let out = `=== DATA ENGINE V22 — RÉSULTAT CALCULÉ SUR LIGNES BRUTES ===\n`;
  out += `Outil : ${p.tool}\nSource : ${p.table?.source || 'Données'} · ${p.table?.name || 'table'}\nFiltres : ${filters}\n`;
  // v27.10 — périmètre en clair : Albert doit le reprendre tel quel
  const _perim = perimetreResultat(exec.kind, p, exec.result).texte;
  if (_perim) out += `${_perim}\n`;
  if (exec.kind === 'count') out += `Résultat : ${exec.result.count} ligne(s) sur ${exec.result.total}.\n`;
  if (exec.kind === 'sum') out += `Résultat : ${exec.result.sum} ${exec.result.unite} (somme de « ${exec.result.col} ») sur ${exec.result.count} formation(s).\n`;
  if (exec.kind === 'unresolved') out += `Résultat : aucun calcul. ${exec.text}\nIntitulés proches : ${(exec.result?.suggestions || []).map(s => s.value).join(' ; ')}\n`;
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

/* ═══════════════ v27.10 — Périmètre de chaque résultat, en clair ═══════════════
   Sous le titre de chaque résultat calculé : sur quelles données, combien de lignes retenues sur combien,
   avec quels filtres (et lesquels sont repris de la question précédente), et ce qui a été laissé de côté
   (cases vides, valeurs non affichées). L'agent sait exactement à quoi correspond le chiffre. */
const _nf = n => Number(n || 0).toLocaleString('fr-FR');
const _VALEURS_ETAT = { oui: 'oui', vrai: 'oui', true: 'oui', '1': 'oui', non: 'non', faux: 'non', false: 'non', '0': 'non' };
function _filtreEnClair(f) {
  if (!f) return '';
  if (f.op === 'contains_all') {
    const mots = String(f.label || f.value || '').split(' + ').filter(Boolean).map(t => `« ${t} »`);
    return `intitulé de formation contenant ${mots.join(' et ')}`;
  }
  const v = String((f.label || f.value) ?? '').trim();
  const etat = _VALEURS_ETAT[v.toLowerCase()];
  if (etat) return `« ${f.col} » ${f.op === 'neq' ? (etat === 'oui' ? '= non' : '= oui') : `= ${etat}`}`;
  return `« ${f.col} » ${f.op === 'neq' ? 'différent de' : '='} ${v}`;
}
function _sourceEnClair(table) {
  if (!table) return 'données chargées';
  if (table.source === 'Open data') return `open data Parcoursup${table.session ? ` ${table.session}` : ''}, France entière (une ligne = une formation, pas un candidat)`;
  if (table.source === 'Grist') return 'table Grist connectée';
  if (table.source === 'Fichier') return `fichier « ${table.name || table.fileName || 'importé'} »`;
  return `${table.source || 'données'}${table.name ? ` · ${table.name}` : ''}`;
}
// Retourne { texte, html } ; texte sert aussi au contexte transmis à Albert
function perimetreResultat(kind, plan, result) {
  if (!plan || !result) return { texte: '', html: '' };
  const table = plan.table || {};
  const totalTable = (table.objects || []).length;
  const mot = n => `${table.rowUnit === 'formation' ? 'formation' : 'ligne'}${n > 1 ? 's' : ''}`;
  const retenues = ['count', 'count_rows', 'sum'].includes(kind) ? result.count
    : kind === 'compare' ? result.baseTotal : result.total;
  const parties = [];
  parties.push(retenues !== undefined && totalTable
    ? `${_nf(retenues)} ${mot(retenues)} retenue${retenues > 1 ? 's' : ''} sur ${_nf(totalTable)}`
    : `${_nf(totalTable)} ${mot(totalTable)}`);
  parties.push(_sourceEnClair(table));
  const repris = new Set(plan.filtresRepris || []);
  const filtres = (plan.filters || []).filter(Boolean);
  const nouveaux = filtres.filter(f => !repris.has(_cleFiltre(f))).map(_filtreEnClair);
  const anciens = filtres.filter(f => repris.has(_cleFiltre(f))).map(_filtreEnClair);
  const _s = filtres.length > 1 ? 's' : '';
  let filtresTxt = !filtres.length ? `aucun filtre (toutes les ${mot(2)})`
    : `filtre${_s} : ${[...nouveaux, ...(anciens.length ? [`${anciens.join(' ; ')} (repris de la question précédente)`] : [])].join(' ; ')}`;
  parties.push(filtresTxt);
  // Ce qui n'entre pas dans le chiffre
  const notes = [];
  if ((kind === 'group_by' || kind === 'top') && !plan.listMode) {
    const vides = (result.total || 0) - (result.filled ?? result.total ?? 0);
    if (vides > 0) notes.push(`${_nf(vides)} ${mot(vides)} sans valeur dans « ${plan.targetCol} »`);
    const affichees = Math.min((result.rows || []).length, 20);
    if ((result.distinct || 0) > affichees) notes.push(`seules les ${_nf(affichees)} valeurs les plus fréquentes sont affichées, sur ${_nf(result.distinct)}`);
  }
  if (kind === 'stats' && result.total > result.numericCount) {
    const ign = result.total - result.numericCount;
    notes.push(`calcul sur ${_nf(result.numericCount)} valeur${result.numericCount > 1 ? 's' : ''} chiffrée${result.numericCount > 1 ? 's' : ''} ; ${_nf(ign)} ${mot(ign)} sans valeur chiffrée ignorée${ign > 1 ? 's' : ''}`);
  }
  if (kind === 'sum' && result.renseignees !== undefined && result.renseignees < result.count) {
    const ign = result.count - result.renseignees;
    notes.push(`${_nf(ign)} ${mot(ign)} sans valeur dans « ${result.col} », non comptée${ign > 1 ? 's' : ''}`);
  }
  if (kind === 'pivot') {
    const nonAffiche = (result.total || 0) - (result.matrix || []).reduce((t, r) => t + (r.total || 0), 0);
    if (nonAffiche > 0) notes.push(`${_nf(nonAffiche)} ${mot(nonAffiche)} dans des valeurs moins fréquentes, non affichées dans le tableau`);
  }
  const texte = `Périmètre : ${parties.join(' · ')}${notes.length ? `. À noter : ${notes.join(' ; ')}` : ''}.`;
  const html = `<p class="de-perimetre" style="font-size:12px;line-height:1.5;color:var(--gris6,#4b5563);background:var(--gris0,#f8fafc);border-left:3px solid var(--bleu,#003189);border-radius:4px;padding:6px 10px;margin:6px 0 10px">`
    + `📌 <strong>Sur quoi porte ce calcul</strong> : ${escapeHtml(parties.join(' · '))}.`
    + (notes.length ? `<br>⚠️ <strong>À noter</strong> : ${escapeHtml(notes.join(' ; '))}.` : '')
    + `</p>`;
  return { texte, html };
}

// Badge "calcul exact" affiché sur tout résultat produit par le Data Engine
// (lignes brutes Grist/Excel), pour le distinguer visuellement d'une réponse
// Albert générique (interprétation IA, moins garantie sur les chiffres).
const DE_EXACT_BADGE = '<span class="de-exact-badge" title="Ce résultat est calculé directement sur les données, pas une interprétation IA" style="display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;color:#15803d;background:#dcfce7;border-radius:999px;padding:2px 8px;margin-left:8px;vertical-align:middle">✓ Calcul exact</span>';

function deTitleHtml(title, blockId = null, originalTitle = null) {
  const safeTitle = escapeHtml(title);
  if (!blockId) return `<h4>${safeTitle}${DE_EXACT_BADGE}</h4>`;
  const safeId = escapeHtml(blockId);
  const safeOriginal = escapeHtml(originalTitle || title);
  return `<h4 class="de-block-title" data-block-id="${safeId}" data-original-title="${safeOriginal}"><span class="de-block-title-text">${safeTitle}</span>${DE_EXACT_BADGE}<button type="button" class="de-block-title-edit-btn" onclick="_deStartRenameBlockTitle(this)" title="Renommer ce bloc">✎</button><button type="button" class="de-block-title-reset-btn" onclick="_deResetBlockTitle(this)" title="Revenir au titre original">↺</button></h4>`;
}

function renderDataEngineResultHtml(tool, plan, result) {
  // v27.10 — périmètre en clair sous le titre
  const perim = perimetreResultat(tool === 'count_rows' ? 'count' : tool, plan, result).html;
  const filtersHtml = (plan.filters || []).length
    ? `<ul>${plan.filters.map(f => f.op === 'contains_all'
        ? `<li>${escapeHtml(f.col)} : <strong>${escapeHtml((f.label || f.value).split(' + ').map(t => `« ${t} »`).join(' et '))}</strong></li>`
        : `<li>${escapeHtml(f.col)} ${f.op === 'neq' ? '≠' : '='} <strong>${escapeHtml(f.label || f.value)}</strong></li>`).join('')}</ul>`
    : '<p>Aucun filtre appliqué.</p>';
  // Une ligne de l'open data = une formation
  const unit = (n, mot = 'ligne') => `${plan.table?.rowUnit === 'formation' ? 'formation' : mot}${n > 1 ? 's' : ''}`;
  const plannerDebug = typeof plannerPlanToDebugHtml === 'function' ? plannerPlanToDebugHtml(plan) : '';
  const debug = `<details class="msg-sources"><summary title="Détail technique du calcul (pour vérification ou support) — sans impact sur le résultat affiché ci-dessus">Plan Data Engine</summary><div style="font-size:10px;line-height:1.5;margin-top:5px"><strong>Outil</strong> : ${escapeHtml(tool)}<br><strong>Source</strong> : ${escapeHtml(plan.table?.source || 'Données')} · ${escapeHtml(plan.table?.name || 'table')}<br><strong>Colonnes détectées</strong> : ${escapeHtml((plan.mentionedCols || []).join(' | ') || '—')}</div>${plannerDebug}</details>`;
  if (tool === 'count_rows') {
    const pct = result.total ? pctFr(result.count, result.total) : '—';
    const clearTitle = (typeof extractBlockTitle === 'function') ? extractBlockTitle({ plan, result }, '') : 'Comptage';
    return `${deTitleHtml(clearTitle, plan.blockId, plan.originalTitle || clearTitle)}${perim}<p>Il y a <strong>${result.count.toLocaleString('fr-FR')}</strong> ${unit(result.count)} correspondant à la demande (${pct} du jeu de données).</p><p><strong>Filtres appliqués</strong></p>${filtersHtml}${debug}`;
  }
  if (tool === 'sum') {
    const clearTitle = (typeof extractBlockTitle === 'function') ? extractBlockTitle({ plan, result }, '') : `${result.sum} ${result.unite}`;
    return `${deTitleHtml(clearTitle, plan.blockId, plan.originalTitle || clearTitle)}${perim}<p>Il y a <strong>${result.sum.toLocaleString('fr-FR')}</strong> ${escapeHtml(result.unite)} au total, sur <strong>${result.count.toLocaleString('fr-FR')}</strong> ${unit(result.count)} retenue${result.count > 1 ? 's' : ''} (somme de la colonne « ${escapeHtml(result.col)} »).</p><p><strong>Filtres appliqués</strong></p>${filtersHtml}${debug}`;
  }
  if (tool === 'group_by' && plan.listMode) {
    // v27.7 — liste complète des intitulés distincts
    const rows = result.rows || [];
    const clearTitle = `Liste — ${_shortColName(plan.targetCol)}`;
    const reste = ((result.distinct || rows.length) > rows.length ? `<p style="font-size:12px;color:var(--gris3)">… et ${(result.distinct - rows.length).toLocaleString('fr-FR')} autres intitulés.</p>` : '')
      // v27.8 — lignes sans valeur dans la colonne listée : affichées, pour que le total soit juste
      + (result.filled !== undefined && result.filled < result.total ? `<p style="font-size:12px;color:var(--gris3)">${(result.total - result.filled).toLocaleString('fr-FR')} ${unit(result.total - result.filled)} sans valeur dans cette colonne.</p>` : '');
    return `${deTitleHtml(clearTitle, plan.blockId, plan.originalTitle || clearTitle)}${perim}<p><strong>${(result.distinct ?? rows.length).toLocaleString('fr-FR')}</strong> intitulé${(result.distinct ?? rows.length) > 1 ? 's' : ''} différent${(result.distinct ?? rows.length) > 1 ? 's' : ''} dans <strong>${escapeHtml(plan.targetCol)}</strong>, pour <strong>${result.total.toLocaleString('fr-FR')}</strong> ${unit(result.total)}.</p><ul>${rows.map(r => `<li>${escapeHtml(r.value)} : <strong>${r.count.toLocaleString('fr-FR')}</strong></li>`).join('')}</ul>${reste}<p><strong>Filtres appliqués</strong></p>${filtersHtml}${debug}`;
  }
  if (tool === 'group_by' || tool === 'top') {
    const rows = result.rows || [];
    const clearTitle = (typeof extractBlockTitle === 'function') ? extractBlockTitle({ plan, result }, '') : (tool === 'top' ? 'Top' : 'Répartition');
    return `${deTitleHtml(clearTitle, plan.blockId, plan.originalTitle || clearTitle)}${perim}<p><strong>${result.total.toLocaleString('fr-FR')}</strong> ligne${result.total>1?'s':''} retenue${result.total>1?'s':''}. Analyse par <strong>${escapeHtml(plan.targetCol)}</strong>.</p><ul>${rows.slice(0,20).map(r => `<li>${escapeHtml(r.value)} : <strong>${r.count.toLocaleString('fr-FR')}</strong> (${r.pct.toFixed(1).replace('.', ',')} %)</li>`).join('')}</ul>${plan.renderChart ? (plan.chartType === 'pie' ? renderMiniPieChart(rows, result.total) : renderMiniBarChart(rows, result.total)) : ''}${filtersHtml}${debug}`;
  }
  if (tool === 'pivot') {
    const cols = result.colValues || [];
    const total = result.total || 0;
    // Tronquer les en-têtes de colonnes longs tout en gardant le tooltip
    const truncCol = (s) => s && s.length > 14 ? s.slice(0, 13) + '…' : (s || '—');
    // Styles communs
    const thStyle = `text-align:right;padding:7px 10px;background:var(--bleu2,#e8f0fe);color:var(--bleu,#003189);font-size:10px;letter-spacing:.5px;white-space:nowrap;border-bottom:2px solid var(--bleu-doux,#c8d8f0);max-width:90px;overflow:hidden;text-overflow:ellipsis`;
    const thFirstStyle = `text-align:left;padding:7px 10px;background:var(--bleu2,#e8f0fe);color:var(--bleu,#003189);font-size:10px;letter-spacing:.5px;border-bottom:2px solid var(--bleu-doux,#c8d8f0);min-width:120px`;
    const header = `<tr><th style="${thFirstStyle}">${escapeHtml(_shortColName(plan.targetCol))}</th>${cols.map(c => `<th style="${thStyle}" title="${escapeHtml(c)}">${escapeHtml(truncCol(c))}</th>`).join('')}<th style="${thStyle};font-weight:800;min-width:60px">Total</th><th style="${thStyle};min-width:50px">%</th></tr>`;
    const body = (result.matrix || []).map((r, i) => {
      const pct = total ? (r.total / total * 100).toFixed(1).replace('.', ',') : '—';
      const rowBg = i % 2 === 1 ? 'background:var(--gris0,#f8fafc)' : '';
      return `<tr style="${rowBg}" onmouseover="this.style.background='var(--bleu2,#e8f0fe)'" onmouseout="this.style.background='${i % 2 === 1 ? 'var(--gris0,#f8fafc)' : ''}'"><td style="padding:6px 10px;font-size:12px;color:var(--bleu,#003189);font-weight:500;white-space:nowrap">${escapeHtml(r.value)}</td>${r.cells.map(c => `<td style="text-align:right;padding:6px 10px;font-size:12px">${c > 0 ? `<strong>${c.toLocaleString('fr-FR')}</strong>` : '<span style="color:var(--gris2,#e5e7eb)">—</span>'}</td>`).join('')}<td style="text-align:right;padding:6px 10px;font-size:12px;font-weight:800;color:var(--texte,#1a1a2e);border-left:1px solid var(--gris1,#f3f4f6)">${r.total.toLocaleString('fr-FR')}</td><td style="text-align:right;padding:6px 10px;font-size:11px;color:var(--gris3,#6b7280)">${pct} %</td></tr>`;
    }).join('');
    const colTotals = cols.map((_, i) => (result.matrix || []).reduce((s, r) => s + (r.cells[i] || 0), 0));
    const foot = `<tr style="background:var(--bleu2,#e8f0fe);border-top:2px solid var(--bleu-doux,#c8d8f0)"><td style="padding:7px 10px;font-weight:800;font-size:12px;color:var(--bleu,#003189)">Total</td>${colTotals.map(t => `<td style="text-align:right;padding:7px 10px;font-weight:800;font-size:12px">${t.toLocaleString('fr-FR')}</td>`).join('')}<td style="text-align:right;padding:7px 10px;font-weight:800;font-size:12px;border-left:1px solid var(--bleu-doux,#c8d8f0)">${total.toLocaleString('fr-FR')}</td><td></td></tr>`;
    const clearTitle = `${_shortColName(plan.targetCol)} × ${_shortColName(plan.targetCol2)}`;
    const colNote = cols.length > 8 ? `<p style="font-size:11px;color:var(--gris3);margin-top:6px">💡 Survolez les en-têtes pour voir les libellés complets.</p>` : '';
    return `${deTitleHtml(clearTitle, plan.blockId, plan.originalTitle || clearTitle)}${perim}<p style="font-size:13px;color:var(--gris3)"><strong style="color:var(--texte)">${total.toLocaleString('fr-FR')}</strong> lignes retenues · Croisement <strong style="color:var(--texte)">${escapeHtml(_shortColName(plan.targetCol))}</strong> × <strong style="color:var(--texte)">${escapeHtml(_shortColName(plan.targetCol2))}</strong></p><div style="overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--gris1,#f3f4f6);border-radius:10px;padding-bottom:14px;box-shadow:0 2px 8px rgba(0,0,0,.04)"><table style="border-collapse:collapse;font-size:12px;width:auto;min-width:100%;margin-bottom:0"><thead>${header}</thead><tbody>${body}${foot}</tbody></table></div>${colNote}${filtersHtml}${debug}`;
  }
  if (tool === 'stats') {
    const fmt = v => v === null || v === undefined ? '—' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
    const clearTitle = `Statistiques — ${_shortColName(plan.targetCol)}`;
    return `${deTitleHtml(clearTitle, plan.blockId, plan.originalTitle || clearTitle)}${perim}<p>Colonne : <strong>${escapeHtml(plan.targetCol)}</strong></p><ul><li>Valeurs numériques : <strong>${result.numericCount.toLocaleString('fr-FR')}</strong> / ${result.total.toLocaleString('fr-FR')}</li><li>Moyenne : <strong>${fmt(result.avg)}</strong></li><li>Médiane : <strong>${fmt(result.median)}</strong></li><li>Min : <strong>${fmt(result.min)}</strong></li><li>Max : <strong>${fmt(result.max)}</strong></li></ul>${filtersHtml}${debug}`;
  }
  return `${deTitleHtml('Résultat', plan.blockId, plan.originalTitle || 'Résultat')}${debug}`;
}

function shouldAnswerLocallyWithoutAlbert(exec) {
  if (!exec) return false;
  // Les requêtes de comptage/répartition simples doivent être résolues par le moteur,
  // sinon Albert risque de répondre à partir d'un résumé incomplet.
  // v27.7 — « unresolved » : terme introuvable, on le dit plutôt que de laisser Albert inventer
  return ['count','group_by','top','pivot','stats','export','compare','unresolved','sum'].includes(exec.kind);
}
/* ═══════════════ v27.9 — Chiffres écrits par Albert : vérifiés contre les données fournies ═══════════════
   Albert rédige ; il ne doit pas produire de chiffres. Chaque nombre de sa réponse est comparé aux nombres
   réellement présents dans ce qu'on lui a fourni (données, résultats calculés par le widget, question).
   Un nombre absent de ces sources est signalé (bandeau + surlignage) : l'agent sait qu'il ne doit pas
   l'utiliser sans vérification. */

// Nombres d'un texte, sous une forme comparable : « 14 252 » = « 14252 », « 31,59 » = « 31.59 », « 12 % » = « 12 »
function extraireNombres(texte) {
  const brut = String(texte ?? '').replace(/<[^>]*>/g, ' ');
  const out = [];
  const re = /(^|[^\p{L}\d.,])(\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)(?![\p{L}\d])/gu;
  let m;
  while ((m = re.exec(brut))) {
    const affiche = m[2];
    const n = Number(affiche.replace(/[   ]/g, '').replace(',', '.'));
    if (isFinite(n)) out.push({ affiche, valeur: n });
  }
  return out;
}
const _cleNombre = n => String(Math.round(n * 100) / 100);
// Nombres qui n'appellent pas de vérification : années, petits entiers (« 2 options », « 3 étapes »)
function _nombreAnodin(n) {
  if (Number.isInteger(n) && n >= 1990 && n <= 2040) return true;
  if (Number.isInteger(n) && n >= 0 && n <= 3) return true;
  return false;
}
function verifierChiffresAlbert(reponse, sources, question = '') {
  const connus = new Set();
  [...(Array.isArray(sources) ? sources : [sources]), question].forEach(s => extraireNombres(s).forEach(x => {
    connus.add(_cleNombre(x.valeur));
    // milliers écrits avec un point (« 14.252 ») : on accepte aussi la lecture « 14252 »
    if (/^\d{1,3}\.\d{3}$/.test(x.affiche)) connus.add(_cleNombre(Number(x.affiche.replace('.', ''))));
  }));
  const inconnus = [];
  extraireNombres(reponse).forEach(x => {
    if (_nombreAnodin(x.valeur) || connus.has(_cleNombre(x.valeur))) return;
    if (!inconnus.some(i => i.affiche === x.affiche)) inconnus.push(x);
  });
  return { inconnus, nombres: extraireNombres(reponse).length };
}
// Bandeau d'avertissement + surlignage des nombres non vérifiés (dans le texte seulement, jamais dans les balises)
function annoterReponseAlbert(reponse, verif) {
  const html = String(reponse ?? '');
  if (!verif || !verif.inconnus.length) return html;
  const aSurligner = new Set(verif.inconnus.map(x => x.affiche));
  const marque = html.split(/(<[^>]*>)/).map(part => part.startsWith('<') ? part
    : part.replace(/(^|[^\p{L}\d.,])(\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)(?![\p{L}\d])/gu,
      (tout, avant, nb) => aSurligner.has(nb)
        ? `${avant}<mark class="chiffre-non-verifie" title="Chiffre absent des données fournies au widget : à vérifier" style="background:#fff1cc;color:inherit;border-bottom:2px dotted #b45309;padding:0 2px">${nb}</mark>`
        : tout)).join('');
  const liste = verif.inconnus.slice(0, 8).map(x => x.affiche).join(' · ');
  const bandeau = `<div class="alerte-chiffres-albert" role="alert" style="border:1px solid #f59e0b;background:#fffbeb;color:#78350f;border-radius:8px;padding:8px 12px;margin-bottom:10px;font-size:13px">`
    + `<strong>⚠️ Chiffres non calculés par le widget</strong> : ${escapeHtml(liste)}${verif.inconnus.length > 8 ? ' …' : ''}. `
    + `Albert les a écrits alors qu'ils ne figurent pas dans les données fournies : ne les utilisez pas sans vérification. `
    + `Pour un chiffre fiable, posez une question de comptage (par exemple « combien de … »).</div>`;
  return bandeau + marque;
}
