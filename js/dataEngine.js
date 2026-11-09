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
  // v27.14 — « et à Bordeaux ? », « et en Gironde ? », « et dans l'académie de Toulouse ? », « et sur Pau ? »
  return /^(seulement|uniquement|avec|sans|sauf|hors|excluant|en excluant|les boursiers|les non boursiers|non boursiers|boursiers|et pour|et les|et chez|parmi les|pour les|chez les|uniquement les|notamment les|en particulier|et parmi|et a |et au |et aux |et en |et dans |et sur |et hors |et sauf )/.test(q);
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
  // v27.14 — « les plus / moins sélectives » est un critère de classement, pas un filtre
  if (selCol && /(?<!\b(?:plus|moins) )\bselecti(f|fs|ve|ves)\b/.test(q)) {
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
      if (prev.tool === 'classement' && prev.classement && !plan.classement) plan.classement = prev.classement; // « et à Bordeaux ? »
      if (prev.tool === 'part' && prev.part && !plan.part) plan.part = prev.part;
      if (prev.sessionsDemandees && !plan.sessionsDemandees) plan.sessionsDemandees = prev.sessionsDemandees; // « et pour les PASS ? » après une évolution
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
  non pas ne ni aucun aucune selective selectives selectif selectifs selection selectivite apprenti apprentis apprentie apprenties
  apprentissage alternance candidate candidates boursiere boursieres
  augmente augmentee augmentes augmentees augmenter augmentation depuis evolution evolue evoluer diminue diminution baisse hausse
  progression progresse recul variation compare comparee comparaison rapport relativement dernier derniere passe passee precedente
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
  q = q.replace(/\bliste d ?attente\b|\bliste complementaire\b/g, 'attente'); // v27.13 — un statut, pas une demande de liste
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
  // v27.14 — le mot d'une condition chiffrée (« avec au plus 30 admis ») n'est pas la mesure demandée
  const q = normalizeText(plan.question || '').replace(/\b(plus de|moins de|au moins|au plus)\s+\d+(?:[.,]\d+)?\s*%?\s*(places?|candidats?|admis|voeux|boursiers?)\b/g, ' ');
  if (/\b(combien|nombre) d(e|es)? ?(formations?|filieres?|offres?|etablissements?)\b/.test(q)) return plan;
  const headers = plan.table.headers || [];
  for (const m of MESURES_SOMME) {
    if (!m.re.test(q)) continue;
    const col = headers.find(h => m.col.test(normalizeText(h)));
    // v27.12 — mesure demandée (admis, places…) sans colonne correspondante : on s'arrête,
    // au lieu de compter des formations (« combien d'admis en BTS » répondait le nombre de BTS)
    if (!col) { plan.mesureIntrouvable = m.unite; return plan; }
    plan.tool = 'sum';
    plan.sumCol = col;
    plan.sumUnit = m.unite;
    return plan;
  }
  return plan;
}

/* ═══════════════ v27.14 — Classement selon un chiffre ═══════════════
   « les formations les plus demandées », « les 10 BTS les plus sélectifs », « les académies avec le plus de places ».
   Les lignes (ou les groupes : académies, régions…) sont triées sur une colonne chiffrée ; les lignes sans valeur
   sont écartées et comptées. Un taux ne s'additionne pas : pas de classement de groupes sur un taux (arrêt). */
const CLASSEMENT_CUE = /\b(les?|la) (plus|moins)\b|\b(plus|moins) (grandes?|petites?|nombreu)|\bclassement\b|\bclasse[rz]?\b|\bmeilleur(e|es|s)?\b|\btop\s*\d*\b|\bpalmares\b/;
const CLASSEMENT_MESURES = [
  // « plus sélectif » = taux d'accès le plus bas
  { re: /\bselecti(f|fs|ve|ves)\b|\bselectivite\b/, col: /taux d acces/, inverse: true, libelle: "taux d'accès", additif: false, mot: /\bselecti(f|fs|ve|ves)\b|\bselectivite\b/ },
  { re: /\btaux d ?acces\b/, col: /taux d acces/, libelle: "taux d'accès", additif: false, mot: /\btaux d ?acces\b/ },
  { re: /\b(pourcentage|part|taux|%)\b.*\bboursiers?\b|\bboursiers?\b.*\b(pourcentage|part|taux)\b/, col: /^% .*boursier|pourcentage.*boursier|part.*boursier/, libelle: '% de boursiers', additif: false, mot: /\bboursiers?\b|\b(pourcentage|part|taux)\b/ },
  { re: /\bboursiers?\b/, col: /admis boursier/, libelle: 'admis boursiers', additif: true, mot: /\bboursiers?\b|\badmis\b/ },
  { re: /\badmis(es)?\b/, col: /ayant accepte.*admis|\badmis\b/, libelle: 'admis', additif: true, mot: /\badmis(es)?\b/, numerique: true },
  { re: /\bplaces?\b|\bcapacites?\b|\b(plus|moins) (grandes?|petites?)\b/, col: /capacit/, libelle: 'places', additif: true, mot: /\bplaces?\b|\bcapacites?\b|\bgrandes?\b|\bpetites?\b/ },
  { re: /\bdemande(e|es|s)?\b|\battractiv|\bpopulaires?\b|\bprisee?s?\b|\bcandidats?\b|\bcandidatures?\b/, col: /effectif total des candidats pour une formation/, libelle: 'candidats', additif: true, mot: /\bdemande(e|es|s)?\b|\battractiv\w*|\bpopulaires?\b|\bprisee?s?\b|\bcandidats?\b|\bcandidatures?\b/ },
  { re: /\bvoeux\b/, col: /^nb.*voeux|nombre.*voeux|\bvoeux\b/, libelle: 'vœux', additif: true, mot: /\bvoeux\b/ },
];
const CLASSEMENT_ENTITES = [
  { re: /academies?/, col: h => /^academie/.test(h) && !/code/.test(h), nom: 'académies' },
  { re: /regions?/, col: h => /^region/.test(h) && !/code/.test(h), nom: 'régions' },
  { re: /departements?/, col: h => /^departement/.test(h) && !/code/.test(h), nom: 'départements' },
  { re: /communes?|villes?/, col: h => /^(commune|ville)/.test(h) && !/code|insee|postal/.test(h), nom: 'communes' },
  { re: /etablissements?|lycees|universites|ecoles/, col: h => /^etablissement( d accueil)?$|^etablissement\b/.test(h) && !/code|uai|statut|academie|commune|departement|region/.test(h), nom: 'établissements' },
];
const _estNumerique = (table, h) => { const st = numericStats((table.objects || []).slice(0, 400), h); return st.numericCount >= Math.max(3, Math.min(400, (table.objects || []).length) * 0.5); };
function detecterClassement(table, question) {
  if (!table || !Array.isArray(table.objects) || !table.objects.length) return null;
  const q = normalizeText(question || '');
  if (!CLASSEMENT_CUE.test(q)) return null;
  const headers = (table.headers || Object.keys(table.objects[0] || {})).filter(Boolean);
  // le critère est d'abord le mot qui suit « le(s) plus / moins » (« les formations sélectives les plus demandées » → demandées)
  // (3 mots au plus : « les critères les plus importants pour être admis » n'est pas un classement des admis)
  const apres = (q.match(/\b(?:les?|la) (?:plus|moins) (?:de |d )?([a-z0-9]+(?: [a-z0-9]+){0,2})/) || [])[1] || '';
  // ailleurs dans la question seulement pour « le plus haut / bas / élevé », « classement … par / selon », « top N … par »
  const ailleurs = !apres || /^(haut|hauts|haute|hautes|eleve|elevee|eleves|elevees|bas|basse|basses|faibles?|forts?|fortes?|grands?|grandes?|petits?|petites?|gros|grosses?)\b/.test(apres)
    || /\bclassement\b|\bclasse[rz]?\b|\btop\s*\d*\b.*\b(par|selon)\b|\bpalmares\b/.test(q);
  const ordreMesures = apres ? [...CLASSEMENT_MESURES.filter(m => m.re.test(apres)), ...CLASSEMENT_MESURES.filter(m => !m.re.test(apres))] : CLASSEMENT_MESURES;
  for (const m of ordreMesures) {
    if (!(m.re.test(apres) || (ailleurs && m.re.test(q)))) continue;
    const col = headers.find(h => m.col.test(_hx(h)) && _estNumerique(table, h));
    if (!col) continue;
    const moins = /\b(les?|la) moins\b|\bmoins (grandes?|nombreu)|\b(plus|moins) petites?\b|\bplus (faibles?|bas(se|ses)?)\b|\ble plus bas\b|\bderniers?\b/.test(q);
    const croissant = m.inverse ? !moins : moins;
    // entité classée : formations (les lignes) par défaut, ou un regroupement nommé comme sujet (« les académies avec… »)
    let entite = null;
    const sujet = q.match(/(?:^|\b(?:les|quel(?:le)?s?|top\s*\d*\s*(?:des)?|classement des)\s+(?:\d+\s+)?)(academies?|regions?|departements?|communes?|villes?|etablissements?|lycees|universites|ecoles)\b(?!\s+(?:de|d|du|des)\s)/);
    if (sujet) {
      const e = CLASSEMENT_ENTITES.find(x => x.re.test(sujet[1]));
      const ecol = e && headers.find(h => e.col(_hx(h)));
      if (e && ecol) entite = { col: ecol, nom: e.nom };
    }
    const n = (q.match(/\b(?:top|les|des)\s+(\d{1,3})\b/) || q.match(/\b(\d{1,3})\s+(?:premier|premieres|formations|bts|cpge|licences|but|academies|regions|communes|etablissements)/) || [])[1];
    const unique = /\b(quel(?:le)?|la formation|le bts|l etablissement|l academie)\b[^?]*\b(le|la) (plus|moins)\b/.test(q) && !/\bquel(le)?s\b/.test(q);
    return { col, ordre: croissant ? 'asc' : 'desc', libelle: m.libelle, additif: m.additif, mot: m.mot, entite, limit: n ? Math.min(Number(n), 100) : (unique ? 1 : 10) };
  }
  // « les communes avec le plus de formations », « les lycées avec le plus de candidats » (une ligne = un candidat) :
  // classement par nombre de lignes = répartition triée (outil top)
  const sujet = q.match(/(?:^|\b(?:les|quel(?:le)?s?|top\s*\d*\s*(?:des)?|classement des)\s+(?:\d+\s+)?)(academies?|regions?|departements?|communes?|villes?|etablissements?|lycees|universites|ecoles)\b(?!\s+(?:de|d|du|des)\s)/);
  if (sujet && /\b(le|les) plus de (formations?|lignes?|candidats?|eleves|dossiers?)\b|\b(le|les) plus (nombreu|represente)/.test(q)) {
    const e = CLASSEMENT_ENTITES.find(x => x.re.test(sujet[1]));
    const ecol = e && headers.find(h => e.col(_hx(h)));
    const n = (q.match(/\b(?:top|les|des)\s+(\d{1,3})\b/) || [])[1];
    if (ecol) return { frequence: true, entite: { col: ecol, nom: e.nom }, limit: n ? Math.min(Number(n), 100) : 10, mot: /\b(formations?|lignes?|candidats?|eleves|dossiers?)\b/ };
  }
  return null;
}
function applyClassement(plan) {
  if (!plan || !plan.table || ['compare', 'chart_current', 'export_current_excel', 'export_current_csv', 'export_excel', 'export_csv'].includes(plan.tool)) return plan;
  const c = detecterClassement(plan.table, plan.question);
  if (!c) return plan;
  if (c.frequence) { plan.tool = 'top'; plan.targetCol = c.entite.col; plan.limit = c.limit; return plan; }
  plan.tool = 'classement';
  plan.classement = c;
  plan.targetCol = c.entite ? c.entite.col : null;
  // le critère de classement n'est pas un filtre : « les plus sélectives » ne garde pas que les sélectives,
  // « les plus demandées » ne cherche pas un intitulé « demandées »
  const q = normalizeText(plan.question || '');
  plan.filters = (plan.filters || []).filter(f => {
    if (!f) return false;
    if (f.op === 'contains_all') {
      const mots = (f.terms || []).map(t => (Array.isArray(t) ? t : [t]).map(normalizeText));
      const restants = mots.filter(forms => !forms.some(w => c.mot.test(w)));
      if (restants.length === mots.length) return true;
      if (!restants.length) return false;
      f.terms = restants; f.label = f.value = restants.map(x => x[0]).join(' + ');
      return true;
    }
    if (/selecti/.test(_hx(f.col)) && c.col && /taux d acces/.test(_hx(c.col)) && !/\bformations? (non )?selectives?\b(?!.*\b(plus|moins) selecti)/.test(q)) return false;
    return true;
  });
  if (plan.unresolvedTerms) plan.unresolvedTerms = plan.unresolvedTerms.filter(t => !c.mot.test(normalizeText(Array.isArray(t) ? t[0] : t)));
  return plan;
}
/* v27.14 — Conditions chiffrées : « plus de 100 places », « au moins 30 admis », « un taux d'accès inférieur à 20 % »,
   « avec un taux d'accès de 0 ». Avant : la condition était ignorée et le widget comptait toutes les lignes. */
const COMPARATEURS = [
  [/superieure? ou egale? a|au moins|minimum|\bmin\b|>=/, 'gte'], [/inferieure? ou egale? a|au plus|maximum|\bmax\b|<=/, 'lte'],
  [/plus de|superieure? a|au dela de|depassant|>/, 'gt'], [/moins de|inferieure? a|en dessous de|<|sous les?/, 'lt'],
  [/egale? a|de|=|a/, 'eqn'],
];
const _CMP = '(superieure? ou egale? a|inferieure? ou egale? a|au moins|au plus|plus de|moins de|superieure? a|inferieure? a|au dela de|en dessous de|depassant|egale? a|>=|<=|>|<|=|de|a)';
const SYMBOLES_OPS = { gt: 'supérieur à', gte: 'au moins', lt: 'inférieur à', lte: 'au plus', eqn: 'égal à' };
function conditionsChiffrees(table, question) {
  if (!table || !Array.isArray(table.objects) || !table.objects.length) return [];
  const q = normalizeText(question || '');
  const headers = (table.headers || Object.keys(table.objects[0] || {})).filter(Boolean);
  const colPour = mot => { for (const m of CLASSEMENT_MESURES) { if (!m.re.test(mot)) continue; const c = headers.find(h => m.col.test(_hx(h)) && _estNumerique(table, h)); if (c) return c; } return null; };
  const opPour = txt => (COMPARATEURS.find(([re]) => re.test(txt)) || [])[1];
  const out = [];
  // 1. « plus de 100 places », « au moins 30 admis », « moins de 50 candidats »
  for (const m of q.matchAll(new RegExp(`\\b(plus de|moins de|au moins|au plus)\\s+(\\d+(?:[.,]\\d+)?)\\s*(?:%\\s*)?(places?|candidats?|admis|voeux|boursiers?)\\b`, 'g'))) {
    const col = colPour(m[3]); const op = opPour(m[1]);
    if (col && op) out.push({ col, op, value: Number(m[2].replace(',', '.')) });
  }
  // 2. « taux d'accès inférieur à 20 % », « capacité supérieure à 50 », « un taux d'accès de 0 »
  for (const m of q.matchAll(new RegExp(`\\b(taux d ?acces|capacites?|nombre de places|nombre de candidats|nombre d admis)\\s+(?:est\\s+|de la formation\\s+)?${_CMP}\\s+(\\d+(?:[.,]\\d+)?)\\s*(?:%|pour ?cent)?`, 'g'))) {
    const col = colPour(/taux/.test(m[1]) ? "taux d acces" : /candidat/.test(m[1]) ? 'candidats' : /admis/.test(m[1]) ? 'admis' : 'places'); const op = opPour(m[2]);
    if (col && op && !out.some(f => f.col === col)) out.push({ col, op, value: Number(m[3].replace(',', '.')) });
  }
  return out.map(f => ({ ...f, label: `${SYMBOLES_OPS[f.op]} ${String(f.value).replace('.', ',')}`, source: 'condition_chiffree' }));
}
function applyConditionsChiffrees(plan) {
  if (!plan || !plan.table || ['compare', 'chart_current', 'export_current_excel', 'export_current_csv'].includes(plan.tool)) return plan;
  const conds = conditionsChiffrees(plan.table, plan.question);
  if (!conds.length) return plan;
  // le nombre cité n'est pas une valeur de colonne à égaler ailleurs (« 0 », « 100 ») : on retire les filtres = nombre
  const nombres = new Set(conds.map(c => String(c.value)));
  plan.filters = [...(plan.filters || []).filter(f => !(f && f.op !== 'contains_all' && nombres.has(String(f.value).replace(',', '.')))), ...conds];
  if (plan.tool === 'sum' && conds.some(c => c.col === plan.sumCol)) { /* « combien de places dans les formations de plus de 100 places » : somme filtrée, conservée */ }
  return plan;
}

/* ═══════════════ v27.15 — Taux et parts calculés par le widget ═══════════════
   « part des boursiers parmi les admis en BTS », « pourcentage de filles parmi les boursiers », « taux de remplissage ».
   Deux modes :
   - effectifs (open data, une ligne = une formation) : somme du numérateur / somme du dénominateur, avec les
     définitions du ministère (boursiers parmi les admis NÉO-BACHELIERS, comme « % d'admis néo bacheliers boursiers ») ;
     jamais la moyenne des pourcentages de chaque formation ;
   - lignes (fichier de candidats, ou part de formations) : lignes qui remplissent la condition / lignes du périmètre.
   Le widget fait la division ; Albert ne calcule rien. */
const PART_CUE = /\b(part|parts|pourcentage|proportion|ratio|pour ?cent|taux de (?!acces)[a-z]+|taux d (?!acces)[a-z]+)\b/;
const PARTS_EFFECTIFS = [
  { re: /\bboursi/, num: /admis boursier/, den: /^effectif des admis neo bacheliers$/, quoi: 'admis boursiers', sur: 'admis néo-bacheliers', note: "même définition que la colonne officielle « % d'admis néo bacheliers boursiers »" },
  { re: /\b(filles?|femmes?|candidates)\b/, si: /\badmis(es)?\b/, num: /candidates admises|admises$/, den: /ayant accepte.*admis/, quoi: 'admises', sur: 'admis' },
  { re: /\b(filles?|femmes?|candidates)\b/, num: /effectif des candidates pour une formation/, den: /effectif total des candidats pour une formation/, quoi: 'candidates', sur: 'candidats' },
  { re: /\bbac(heliers?)? generaux|\bbac general|\bgeneraux\b/, num: /admis neo bacheliers generaux/, den: /^effectif des admis neo bacheliers$/, quoi: 'admis néo-bacheliers généraux', sur: 'admis néo-bacheliers' },
  { re: /\bneo ?bacheliers?\b/, num: /^effectif des admis neo bacheliers$/, den: /ayant accepte.*admis/, quoi: 'admis néo-bacheliers', sur: 'admis' },
  { re: /\bmeme academie\b/, num: /admis issus de la meme academie/, den: /ayant accepte.*admis/, quoi: 'admis issus de la même académie', sur: 'admis' },
  { re: /\btaux de remplissage\b|\bremplissage\b/, num: /ayant accepte.*admis/, den: /capacit/, quoi: 'admis', sur: 'places' },
  { re: /\btaux de proposition\b|\b(recu|reçu) une proposition\b|\bpropositions?\b/, num: /recu une proposition/, den: /effectif total des candidats pour une formation/, quoi: 'candidats ayant reçu une proposition', sur: 'candidats' },
  { re: /\btaux d ?admission\b|\badmission\b|\b(candidats )?admis\b/, num: /ayant accepte.*admis/, den: /effectif total des candidats pour une formation/, quoi: 'admis', sur: 'candidats' },
];
function _phrasePart(q) {
  // « part des boursiers parmi les admis en BTS » → « boursiers » ; « quelle part des formations sont sélectives » → « formations sont selectives »
  const m = q.match(/\b(?:part|parts|pourcentage|proportion|ratio|pour ?cent|taux)\s+(?:de |d |des |du |de la |de l )?(.+?)(?=\s+(?:parmi|chez|au sein|sur l ensemble|par rapport|relativement)\b|$)/);
  return m ? m[1].trim() : '';
}
function detecterPart(table, question) {
  if (!table || !Array.isArray(table.objects) || !table.objects.length) return null;
  const brut = String(question || '');
  const q = normalizeText(brut.replace(/%/g, ' pourcentage '));
  if (!PART_CUE.test(q) || /\btaux d ?acces\b/.test(q)) return null;
  if (/\b(repartition|ventilation|moyen|moyenne|median|mediane)\b|\bpar (?!rapport)\w/.test(q)) return null; // répartition en %, moyenne d'une colonne de %
  const headers = (table.headers || Object.keys(table.objects[0] || {})).filter(Boolean);
  const phrase = _phrasePart(q);
  if (!phrase) return null;
  // effectifs : seulement si une ligne = une formation et que les deux colonnes existent
  if (table.rowUnit === 'formation' || headers.some(h => /ayant accepte.*admis/.test(_hx(h)))) {
    // le sujet de la part est le début de la phrase (« boursiers », « filles », « candidats admis ») :
    // « la part de l'oral dans l'admission » ne devient pas un taux d'admission
    const sujet = phrase.split(/\s+(?:en|a|au|aux|dans|sur|chez|pour|de l academie|du departement)\s+/)[0];
    for (const sp of PARTS_EFFECTIFS) {
      const cible = /\btaux d(e)? ?(remplissage|proposition|admission)\b/.test(q) ? q : sujet;
      if (!sp.re.test(cible)) continue;
      if (sp.si && !sp.si.test(q)) continue;
      // nom tel quel (_hx y ajoute la forme développée, ce qui casse les ^…$)
      const num = headers.find(h => sp.num.test(normalizeText(h)) && _estNumerique(table, h));
      const den = headers.find(h => sp.den.test(normalizeText(h)) && _estNumerique(table, h));
      if (num && den) return { mode: 'effectifs', num, den, quoi: sp.quoi, sur: sp.sur, note: sp.note || '', phrase, mot: sp.re };
      if (table.rowUnit === 'formation') return { mode: 'effectifs', manque: `${sp.quoi} / ${sp.sur}`, phrase, mot: sp.re };
    }
  }
  // lignes : seulement si la phrase donne un vrai critère dans les données (sinon : question pour Albert)
  const courte = phrase.split(/\s+(?:en|a|au|aux|dans|sur|chez|pour|de l academie|du departement)\s+/)[0];
  // … sauf si la phrase cite un critère connu (apprentis, boursiers, filles…) absent des données : le garde-fou arrêtera le calcul
  if (!_filtresDePhrase(table, courte).length && !_filtresDePhrase(table, phrase).length && !CONCEPTS_A_FILTRER.some(c => c.re.test(phrase))) return null;
  return { mode: 'lignes', phrase, mot: new RegExp(`\\b(${phrase.split(' ').filter(w => w.length >= 3).map(w => w.replace(/[^a-z0-9]/g, '')).filter(Boolean).join('|') || 'zzz'})\\b`) };
}
// Filtres que produit la seule phrase de la part (« boursiers », « filles boursières », « formations sélectives »)
function _filtresDePhrase(table, phrase) {
  const p = { tool: 'count_rows', table, filters: [], question: `combien de ${phrase}` };
  try { if (typeof buildPlannerPlan === 'function') { const pp = buildPlannerPlan(p.question, p.question, table, 'count_rows'); if (pp) p.filters = pp.filters || []; } } catch (e) { /* planner absent */ }
  p.filters = mergeFiltersUnique(p.filters, strictFiltersFromQuestion(table, p.question));
  applyFormationTerms(p); applyConditionsChiffrees(p);
  // une colonne d'effectifs n'est pas une condition « = valeur » (« Dont effectif des candidates admises = 1 »)
  return (p.filters || []).filter(f => f && (f.op === 'contains_all' || f.source === 'condition_chiffree' || _isEtatCol(table, f.col) || !_estNumerique(table, f.col)));
}
function applyPart(plan) {
  if (!plan || !plan.table || ['compare', 'chart_current', 'export_current_excel', 'export_current_csv', 'export_excel', 'export_csv', 'classement'].includes(plan.tool)) return plan;
  const d = detecterPart(plan.table, plan.question);
  if (!d) return plan;
  plan.tool = 'part';
  plan.part = d;
  plan.targetCol = null;
  if (d.mode === 'lignes') {
    // « proportion de formations privées en Gironde » : la condition est « formations privées », « en Gironde » est le périmètre ;
    // si la partie avant « en / à / dans… » ne donne aucun critère (« part des formations en apprentissage »), on garde toute la phrase
    const courte = d.phrase.split(/\s+(?:en|a|au|aux|dans|sur|chez|pour|de l academie|du departement)\s+/)[0];
    let fx = courte !== d.phrase ? _filtresDePhrase(plan.table, courte) : [];
    if (fx.length) d.phrase = courte; else fx = _filtresDePhrase(plan.table, d.phrase);
    const cle = f => f.op === 'contains_all' ? `T::${(f.terms || []).map(t => [].concat(t)[0]).join('+')}` : `${f.col}`;
    const clesX = new Set(fx.map(cle));
    const tous = mergeFiltersUnique(plan.filters || [], fx.filter(f => !(plan.filters || []).some(g => cle(g) === cle(f))));
    d.condition = tous.filter(f => clesX.has(cle(f)));
    plan.filters = tous.filter(f => !clesX.has(cle(f)));
  } else {
    // les mots de la part (« boursiers », « admis ») ne sont pas des filtres du périmètre
    plan.filters = (plan.filters || []).filter(f => !(f && f.op === 'contains_all' && (f.terms || []).every(t => [].concat(t).some(w => d.mot.test(normalizeText(w))))));
  }
  return plan;
}
// Le contrôle final du moteur peut rajouter au périmètre les critères de la part (« sélectives », « boursiers ») :
// on les retire juste avant le calcul, sinon la part vaut 100 %. En mode effectifs, aucun filtre sur une colonne chiffrée
// (« Dont effectif des candidates admises = 1 », lu dans « parmi les admises »).
function nettoyerPerimetrePart(plan) {
  const d = plan.part;
  if (!d) return plan;
  if (d.mode === 'lignes' && d.condition) {
    const cle = f => f.op === 'contains_all' ? `T::${(f.terms || []).map(t => [].concat(t)[0]).join('+')}` : `${f.col}`;
    const cles = new Set(d.condition.map(cle));
    plan.filters = (plan.filters || []).filter(f => f && !cles.has(cle(f)));
  } else if (d.mode === 'effectifs') {
    plan.filters = (plan.filters || []).filter(f => f && (f.op === 'contains_all' || f.source === 'condition_chiffree' || f.source === 'commune_a' || !_estNumerique(plan.table, f.col)));
  }
  return plan;
}
function executerPart(plan) {
  const d = plan.part;
  nettoyerPerimetrePart(plan);
  if (d.manque) return unresolvedConceptExecution(plan, [], `les colonnes nécessaires pour calculer la part de ${d.manque} ne sont pas dans les données`);
  const base = applyLocalActionFilters(plan.table.objects || [], plan.filters || []);
  let result;
  if (d.mode === 'effectifs') {
    let num = 0, den = 0, ignorees = 0;
    base.forEach(r => { const a = _nombreCellule(r?.[d.num]), b = _nombreCellule(r?.[d.den]); if (a === null || b === null) { ignorees++; return; } num += a; den += b; });
    result = { mode: 'effectifs', num, den, pct: den ? num / den * 100 : null, total: base.length, ignorees };
  } else {
    if (!d.condition || !d.condition.length) return unresolvedConceptExecution(plan, [d.phrase], `je n'ai pas reconnu de quoi calculer la part (« ${d.phrase} »)`);
    const num = applyLocalActionFilters(base, d.condition).length;
    result = { mode: 'lignes', num, den: base.length, pct: base.length ? num / base.length * 100 : null, total: base.length, ignorees: 0 };
  }
  if (!result.den) return unresolvedConceptExecution(plan, [], 'aucune ligne (ou un total nul) dans le périmètre : la part ne peut pas être calculée');
  const exec = { kind: 'part', plan, result, text: `PART = ${result.num} / ${result.den} = ${result.pct}` };
  exec.html = renderPartHtml(plan, result);
  return exec;
}
const _pctFr = v => (Math.round(v * 10) / 10).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
function _libellePart(plan) {
  const d = plan.part;
  if (d.mode === 'effectifs') return { quoi: d.quoi, sur: d.sur };
  const unite = plan.table?.rowUnit === 'formation' ? 'formations' : 'lignes';
  return { quoi: `${unite} « ${d.condition.map(f => _filtreEnClair(f).replace(/^« [^»]+» = /, '')).join(' et ')} »`, sur: unite };
}
function renderPartHtml(plan, result) {
  const d = plan.part;
  const { quoi, sur } = _libellePart(plan);
  const titre = `Part — ${_pctFr(result.pct)} % (${quoi})`;
  const methode = d.mode === 'effectifs'
    ? `<p style="font-size:12px;color:var(--gris3)">Calcul : somme de « ${escapeHtml(d.num)} » ÷ somme de « ${escapeHtml(d.den)} », sur les ${_nf(result.total - result.ignorees)} formations du périmètre — et non la moyenne des pourcentages de chaque formation${d.note ? ` ; ${escapeHtml(d.note)}` : ''}.</p>`
    : `<p style="font-size:12px;color:var(--gris3)">Calcul : lignes qui remplissent la condition (${escapeHtml(d.condition.map(_filtreEnClair).join(' ; '))}) ÷ lignes du périmètre.</p>`;
  const de = /^[aeiouyéèêàâîôûh]/i.test(quoi) ? 'd’' : 'de ';
  const phrase = `<p>Il y a <strong>${_pctFr(result.pct)} %</strong> ${de}${escapeHtml(quoi)} : <strong>${_nf(result.num)}</strong> sur <strong>${_nf(result.den)}</strong> ${escapeHtml(sur)}.</p>`;
  const perim = perimetreResultat('part', plan, result).html;
  const debug = `<details class="msg-sources"><summary>Plan Data Engine</summary><div style="font-size:10px;line-height:1.5;margin-top:5px"><strong>Outil</strong> : part (${d.mode}) · ${escapeHtml(String(result.num))} / ${escapeHtml(String(result.den))}</div></details>`;
  return `${deTitleHtml(titre, plan.blockId, plan.originalTitle || titre)}${perim}${phrase}${methode}${debug}`;
}

/* ═══════════════ v27.16 — Comparaison entre deux sessions de l'open data ═══════════════
   « les places en BTS ont-elles augmenté depuis 2024 ? », « évolution du nombre de PASS entre 2023 et 2025 »,
   « combien de BTS en 2024 ? ». Le même calcul (comptage, somme, moyenne, part) est rejoué sur chaque session ;
   les colonnes sont rapprochées par leur nom technique dans l'API (un libellé peut changer d'une année à l'autre).
   La session demandée est chargée juste avant le calcul (preparerSessionsDemandees, appelée par albert.js). */
const EVOLUTION_FORTE = /\b(evolution|evolue\w*|augment\w*|diminu\w*|baiss\w*|progress\w*|hausse|recul\w*|variation)\b/;
const EVOLUTION_AVEC_ANNEE = /\b(compar\w*|par rapport|relativement|depuis|entre|ecart|versus|vs)\b/;
const AN_DERNIER = /\b(l an dernier|l annee derniere|annee precedente|session precedente|l an passe|l annee passee|n ?- ?1)\b/;
function sessionsDeLaQuestion(table, question) {
  if (!table || table.source !== 'Open data' || !table.session) return null;
  const q = normalizeText(question || '');
  const cur = Number(table.session);
  let annees = [...new Set((q.match(/\b20[12]\d\b/g) || []).map(Number))];
  const futures = annees.filter(y => y > cur);
  if (futures.length) return { mode: 'future', sessions: futures, courante: cur };
  annees = annees.filter(y => y >= 2018);
  if (AN_DERNIER.test(q) && !annees.includes(cur - 1)) annees.push(cur - 1);
  // « l'an dernier » désigne une session ; seule une évolution / comparaison demande les deux
  const evolution = EVOLUTION_FORTE.test(q) || (annees.length && EVOLUTION_AVEC_ANNEE.test(q));
  if (evolution) {
    let ss = [...new Set(annees)];
    if (ss.length === 1 && !ss.includes(cur)) ss.push(cur);
    if (!ss.length && EVOLUTION_FORTE.test(q)) ss = [cur - 1, cur]; // « évolution du nombre de BTS » : session précédente → courante
    ss.sort((a, b) => a - b);
    if (ss.length >= 2) return { mode: 'evolution', sessions: [ss[0], ss[ss.length - 1]], courante: cur };
    return null;
  }
  const autres = annees.filter(y => y !== cur);
  if (autres.length === 1) return { mode: 'seule', sessions: [autres[0]], courante: cur };
  return null;
}
function tableDeSession(session, base) {
  if (base && Number(base.session) === Number(session)) return base;
  return (typeof getOpenDataSessionTable === 'function') ? getOpenDataSessionTable(Number(session)) : null;
}
// Appelée avant le calcul (asynchrone) : charge les sessions demandées qui ne sont pas encore en mémoire
async function preparerSessionsDemandees(question) {
  let t = null;
  try { t = (getActiveQueryTables() || [])[0]; } catch (e) { return []; }
  const d = sessionsDeLaQuestion(t, question);
  if (!d || d.mode === 'future') return [];
  const charges = [];
  for (const s of d.sessions) {
    if (tableDeSession(s, t)) continue;
    try { if (typeof chargerSessionOpenData === 'function') { await chargerSessionOpenData(s); charges.push(s); } } catch (e) { console.warn('[Open data] session', s, 'non chargée :', e.message); }
  }
  return charges;
}
function applySessions(plan) {
  if (!plan || !plan.table || ['compare', 'chart_current', 'export_current_excel', 'export_current_csv', 'export_excel', 'export_csv'].includes(plan.tool)) return plan;
  const d = sessionsDeLaQuestion(plan.table, plan.question);
  if (!d) return plan;
  plan.sessionsDemandees = d;
  // une année citée n'est pas un filtre (« Session = 2024 » sur la table 2025 donnerait 0)
  const annees = [...new Set((normalizeText(plan.question || '').match(/\b20[12]\d\b/g) || []))];
  // … ni un morceau d'année lu comme une valeur (« 20 », « 24 », « 202 » dans « 2024 ») sur une colonne chiffrée
  const morceau = v => { const t = String(v ?? '').trim(); return /^\d+$/.test(t) && annees.some(a => a.includes(t)); };
  plan.filters = (plan.filters || []).filter(f => f && !/^session/.test(normalizeText(f.col))
    && !(f.op !== 'contains_all' && f.source !== 'condition_chiffree' && (annees.includes(String(f.value)) || (morceau(f.value) && _estNumerique(plan.table, f.col)))));
  return plan;
}
// Même filtre, colonne de l'autre session (rapprochée par le nom technique de l'API)
function _colAutreSession(col, de, vers) {
  if (!col || !de || !vers || de === vers) return col;
  const nom = de.champs?.[col];
  return (nom && vers.libelles?.[nom]) || col;
}
function _planPourSession(plan, table) {
  const tr = c => _colAutreSession(c, plan.table, table);
  const p = { ...plan, table, _sousSession: true, sessionsDemandees: null, blockId: null,
    filters: (plan.filters || []).map(f => f && ({ ...f, col: tr(f.col), cols: f.cols ? f.cols.map(tr) : f.cols })),
    targetCol: tr(plan.targetCol), sumCol: tr(plan.sumCol) };
  if (plan.part) p.part = { ...plan.part, num: tr(plan.part.num), den: tr(plan.part.den), condition: plan.part.condition ? plan.part.condition.map(f => ({ ...f, col: tr(f.col) })) : plan.part.condition };
  if (plan.classement) p.classement = { ...plan.classement, col: tr(plan.classement.col) };
  return p;
}
const _valeurExec = e => e.kind === 'count' ? e.result.count : e.kind === 'sum' ? e.result.sum : e.kind === 'stats' ? e.result.avg : e.kind === 'part' ? e.result.pct : null;
function executerSessions(plan) {
  const d = plan.sessionsDemandees;
  if (d.mode === 'future') return unresolvedConceptExecution(plan, [], `la session ${d.sessions.join(', ')} n'est pas encore publiée dans l'open data (dernière session : ${d.courante})`);
  const tables = d.sessions.map(s => ({ s, t: tableDeSession(s, plan.table) }));
  const absente = tables.find(x => !x.t);
  if (absente) return unresolvedConceptExecution(plan, [], `la session ${absente.s} de l'open data n'a pas pu être chargée (site du ministère indisponible ?) : réessayez dans un instant`);
  const execs = tables.map(({ s, t }) => ({ s, e: runDataEnginePlan(_planPourSession(plan, t)) }));
  const ko = execs.find(x => !x.e || x.e.kind === 'unresolved');
  if (ko) return ko.e ? { ...ko.e, text: `${ko.e.text} (session ${ko.s})` } : null;
  if (d.mode === 'seule') {
    const e = execs[0].e;
    e.html = e.html.replace(/(<h4[^>]*>(?:<span[^>]*>)?)([^<]*)/, (m, a, t) => `${a}${t} — session ${execs[0].s}`);
    e.plan.sessionUnique = execs[0].s;
    rememberDataEngineExecution(e);
    return e;
  }
  if (!execs.every(x => ['count', 'sum', 'stats', 'part'].includes(x.e.kind)))
    return unresolvedConceptExecution(plan, [], `la comparaison entre sessions est disponible pour les comptages, sommes, moyennes et parts (pas encore pour les ${execs[0].e.kind === 'classement' ? 'classements' : 'répartitions'})`);
  const lignes = execs.map(x => ({ session: x.s, valeur: _valeurExec(x.e), exec: x.e, formations: (x.e.plan.table.objects || []).length,
    // lignes retenues par les critères : comptage et somme → result.count ; moyenne et part → result.total (lignes du périmètre)
    retenues: ['count', 'sum'].includes(x.e.kind) ? x.e.result.count : x.e.result.total }));
  const a = lignes[0].valeur, b = lignes[lignes.length - 1].valeur;
  const kind = execs[0].e.kind;
  const result = { lignes, ecart: b - a, ecartPct: kind !== 'part' && a ? (b - a) / a * 100 : null, mesure: kind };
  const exec = { kind: 'evolution', plan, result, text: lignes.map(l => `${l.session} : ${l.valeur}`).join(' ; ') };
  exec.html = renderEvolutionHtml(plan, result);
  rememberDataEngineExecution(exec);
  return exec;
}
function _uniteEvolution(r) {
  const e = r.lignes[0].exec;
  if (r.mesure === 'count') return e.plan.table?.rowUnit === 'formation' ? 'formations' : 'lignes';
  if (r.mesure === 'sum') return e.result.unite || 'au total';
  if (r.mesure === 'stats') return `(moyenne de « ${e.plan.targetCol} »)`;
  return '%';
}
function renderEvolutionHtml(plan, r) {
  const fmt = v => r.mesure === 'part' ? `${_pctFr(v)} %` : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  const signe = v => (v > 0 ? '+' : v < 0 ? '−' : '') ;
  const abs = v => Math.abs(v);
  // écart de part sous 0,05 point : affiché avec 2 décimales et qualifié de stable (pas « baisse de −0,0 point »)
  const petit = r.mesure === 'part' && abs(r.ecart) < 0.05;
  const ecartTxt = r.mesure === 'part'
    ? `${signe(r.ecart)}${petit ? abs(r.ecart).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : _pctFr(abs(r.ecart))} point${abs(r.ecart) >= 2 ? 's' : ''}`
    : `${signe(r.ecart)}${abs(r.ecart).toLocaleString('fr-FR', { maximumFractionDigits: 2 })}${r.ecartPct !== null ? ` (${signe(r.ecartPct)}${_pctFr(abs(r.ecartPct))} %)` : ''}`;
  const [l1, l2] = [r.lignes[0], r.lignes[r.lignes.length - 1]];
  const sens = petit ? 'stable' : r.ecart > 0 ? 'hausse' : r.ecart < 0 ? 'baisse' : 'stable';
  const unite = _uniteEvolution(r);
  const titre = `Évolution ${l1.session} → ${l2.session} : ${sens}${r.ecart ? (petit ? ` (${ecartTxt})` : ` de ${ecartTxt}`) : ''}`;
  const th = 'text-align:left;padding:6px 8px;background:#e8edff;color:var(--bleu,#000091);font-size:11px';
  const td = 'padding:6px 8px;border-bottom:1px solid var(--gris1,#f3f4f6);font-size:12px';
  const table = `<table style="border-collapse:collapse;width:auto;min-width:320px;margin:8px 0"><thead><tr><th style="${th}">Session</th><th style="${th};text-align:right">${escapeHtml(r.mesure === 'part' ? 'Part' : r.mesure === 'stats' ? 'Moyenne' : unite)}</th>${r.mesure === 'part' ? `<th style="${th};text-align:right">Détail</th>` : ''}<th style="${th};text-align:right">Formations retenues</th></tr></thead><tbody>`
    + r.lignes.map(l => `<tr><td style="${td}">${l.session}</td><td style="${td};text-align:right"><strong>${fmt(l.valeur)}</strong></td>${r.mesure === 'part' ? `<td style="${td};text-align:right">${_nf(l.exec.result.num)} / ${_nf(l.exec.result.den)}</td>` : ''}<td style="${td};text-align:right">${_nf(l.retenues)} sur ${_nf(l.formations)}</td></tr>`).join('')
    + `</tbody></table>`;
  const phrase = `<p>De ${l1.session} à ${l2.session} : <strong>${fmt(l1.valeur)}</strong> → <strong>${fmt(l2.valeur)}</strong>${r.mesure === 'count' || r.mesure === 'sum' ? ` ${escapeHtml(unite)}` : ''}, soit <strong>${ecartTxt}</strong>.</p>`;
  const offre = l1.formations !== l2.formations ? `<p style="font-size:12px;color:var(--gris3)">À savoir : l'offre a changé entre les deux sessions (${_nf(l1.formations)} formations en ${l1.session}, ${_nf(l2.formations)} en ${l2.session}). Une variation peut venir de formations ouvertes ou fermées, pas seulement d'une évolution des formations existantes.</p>` : '';
  const perim = perimetreResultat(r.lignes[1].exec.kind, r.lignes[1].exec.plan, r.lignes[1].exec.result).html.replace('Sur quoi porte ce calcul</strong> :', 'Sur quoi porte ce calcul</strong> (chaque session) :').replace(/\d[\d\s\u00a0\u202f]* (?:formations?|lignes?) retenues? sur [\d\s\u00a0\u202f]+ · open data Parcoursup \d+/, 'mêmes critères appliqués à chaque session · open data Parcoursup');
  const debug = `<details class="msg-sources"><summary>Plan Data Engine</summary><div style="font-size:10px;line-height:1.5;margin-top:5px"><strong>Outil</strong> : évolution ${l1.session} → ${l2.session} · ${escapeHtml(r.mesure)}</div></details>`;
  return `${deTitleHtml(titre, plan.blockId, plan.originalTitle || titre)}${perim}${phrase}${table}${offre}${debug}`;
}

// Colonnes qui décrivent une formation dans le classement : intitulé, établissement, commune
function _colonnesDescription(table) {
  const headers = (table.headers || []).filter(Boolean);
  const objets = table.objects || [];
  const remplie = h => objets.slice(0, 500).filter(r => String(r?.[h] ?? '').trim() !== '').length >= Math.min(500, objets.length) * 0.8;
  const info = formationTermsInfo(table);
  const nbVal = h => new Set(objets.slice(0, 2000).map(r => r?.[h])).size;
  const intitule = info.cols.filter(remplie).sort((a, b) => nbVal(b) - nbVal(a))[0];
  const etab = headers.find(h => /^etablissement$|^etablissement d accueil$/.test(_hx(h))) || headers.find(h => /etablissement/.test(_hx(h)) && !/code|uai|statut|academie|commune|departement|region|origine/.test(_hx(h)) && !_estNumerique(table, h));
  const commune = headers.find(h => /^(commune|ville)/.test(_hx(h)) && !/code|insee|postal|origine/.test(_hx(h)));
  // une ligne qui n'est pas une formation (candidat, dossier) : son identifiant en premier
  const ident = table.rowUnit === 'formation' ? null : headers.find(h => /^(numero|num|n°|id|identifiant|dossier|ine)\b/.test(_hx(h)));
  return [ident, intitule, etab, commune].filter((h, i, a) => h && a.indexOf(h) === i);
}
function executerClassement(plan) {
  const c = plan.classement;
  const rows = applyLocalActionFilters(plan.table.objects || [], plan.filters || []);
  let avecValeur = rows.map(r => ({ r, v: _nombreCellule(r?.[c.col]) })).filter(x => x.v !== null);
  const sansValeur = rows.length - avecValeur.length;
  // v27.14 — « les plus sélectives » : un taux d'accès de 0 veut dire qu'aucune proposition n'a été faite par Parcoursup
  // (formation sans recrutement par cette voie), pas une formation très sélective → écartées et signalées
  let tauxNuls = 0;
  if (/taux d acces/.test(_hx(c.col)) && c.ordre === 'asc' && !c.entite) {
    tauxNuls = avecValeur.filter(x => x.v === 0).length;
    avecValeur = avecValeur.filter(x => x.v !== 0);
  }
  let lignes, exAequo = 0;
  if (c.entite) {
    if (!c.additif) return unresolvedConceptExecution(plan, [], `un classement des ${c.entite.nom} selon le ${c.libelle} demanderait de combiner des taux, ce que le widget ne fait pas (un taux ne s'additionne pas). Classez plutôt les formations : « les formations les plus … »`);
    const m = new Map();
    avecValeur.forEach(({ r, v }) => { const k = String(r?.[c.entite.col] ?? '').trim() || 'Non renseigné'; const g = m.get(k) || { valeur: k, total: 0, n: 0 }; g.total += v; g.n++; m.set(k, g); });
    const tri = [...m.values()].sort((a, b) => c.ordre === 'asc' ? a.total - b.total : b.total - a.total);
    lignes = tri.slice(0, c.limit).map((g, i) => ({ rang: i + 1, libelles: [g.valeur], valeur: Math.round(g.total * 100) / 100, n: g.n }));
    if (tri.length > c.limit) exAequo = tri.slice(c.limit).filter(g => g.total === tri[c.limit - 1].total).length;
  } else {
    const desc = _colonnesDescription(plan.table);
    const tri = avecValeur.slice().sort((a, b) => c.ordre === 'asc' ? a.v - b.v : b.v - a.v);
    lignes = tri.slice(0, c.limit).map((x, i) => ({ rang: i + 1, libelles: desc.map(h => String(x.r?.[h] ?? '').trim()), valeur: x.v }));
    plan.colonnesDescription = desc;
    if (tri.length > c.limit) exAequo = tri.slice(c.limit).filter(x => x.v === tri[c.limit - 1].v).length;
  }
  const result = { lignes, total: rows.length, avecValeur: avecValeur.length, sansValeur, exAequo, tauxNuls, groupes: c.entite ? new Set(avecValeur.map(x => String(x.r?.[c.entite.col] ?? '').trim() || 'Non renseigné')).size : null };
  const exec = { kind: 'classement', plan, result, text: lignes.map(l => `${l.rang}. ${l.libelles.join(' — ')} : ${l.valeur}`).join('\n') };
  exec.html = renderClassementHtml(plan, result);
  return exec;
}
function renderClassementHtml(plan, result) {
  const c = plan.classement;
  const sens = c.inverse ? (c.ordre === 'asc' ? 'les plus sélectives' : 'les moins sélectives') : (c.ordre === 'asc' ? `le moins de ${c.libelle}` : `le plus de ${c.libelle}`);
  const pluriel = result.lignes.length > 1;
  const quoi = c.entite ? (pluriel ? c.entite.nom : c.entite.nom.replace(/s$/, '')) : (plan.table?.rowUnit === 'formation' ? (pluriel ? 'formations' : 'formation') : (pluriel ? 'lignes' : 'ligne'));
  const titre = `Classement — ${result.lignes.length} ${quoi} ${c.inverse ? sens : `avec ${sens}`}`;
  const entetes = c.entite ? [c.entite.col.replace(/ de l'établissement.*$/i, '')] : (plan.colonnesDescription || []).map(h => _shortColName(h) || h);
  const fmt = v => Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  const th = 'text-align:left;padding:6px 8px;background:#e8edff;color:var(--bleu,#003189);font-size:11px';
  const td = 'padding:6px 8px;border-bottom:1px solid var(--gris1,#f3f4f6);font-size:12px';
  const table = `<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%"><thead><tr><th style="${th}">Rang</th>${entetes.map(h => `<th style="${th}">${escapeHtml(h)}</th>`).join('')}<th style="${th};text-align:right">${escapeHtml(c.libelle)}${c.entite ? ' (somme)' : ''}</th></tr></thead><tbody>`
    + result.lignes.map(l => `<tr><td style="${td}">${l.rang}</td>${l.libelles.map(x => `<td style="${td}">${escapeHtml(x || '—')}</td>`).join('')}<td style="${td};text-align:right"><strong>${fmt(l.valeur)}</strong></td></tr>`).join('')
    + `</tbody></table></div>`;
  const quoiNote = c.entite ? (result.exAequo > 1 ? c.entite.nom : c.entite.nom.replace(/s$/, '')) : (result.exAequo > 1 ? 'formations' : 'formation');
  const note = result.exAequo ? `<p style="font-size:12px;color:var(--gris3)">${result.exAequo.toLocaleString('fr-FR')} autre${result.exAequo > 1 ? 's' : ''} ${quoiNote} ${result.exAequo > 1 ? 'ont' : 'a'} la même valeur que la dernière ligne (ex æquo).</p>` : '';
  const crit = `<p>Classement selon la colonne <strong>${escapeHtml(c.col)}</strong>${c.inverse ? ' (plus le taux d\'accès est bas, plus la formation est sélective)' : ''}${c.entite ? `, additionnée par ${escapeHtml(c.entite.nom.replace(/s$/, ''))} (${(result.groupes || 0).toLocaleString('fr-FR')} ${escapeHtml(c.entite.nom)} en tout)` : ''}.</p>`;
  const perim = perimetreResultat('classement', plan, result).html;
  const debug = `<details class="msg-sources"><summary>Plan Data Engine</summary><div style="font-size:10px;line-height:1.5;margin-top:5px"><strong>Outil</strong> : classement · ${escapeHtml(c.col)} · ${c.ordre}${c.entite ? ` · par ${escapeHtml(c.entite.col)}` : ''}</div></details>`;
  return `${deTitleHtml(titre, plan.blockId, plan.originalTitle || titre)}${perim}${crit}${table}${note}${debug}`;
}

// v27.8 — garde-fou : un critère cité dans la question (boursiers, filles, apprentis, Pays Basque, public/privé,
// sélective, lycée X, Gironde…) qui n'a donné aucun filtre → on s'arrête au lieu de répondre sur tout le fichier.
const CONCEPTS_A_FILTRER = [
  { re: /\bboursiers?\b|\bbourse\b/, mot: 'boursiers', ok: t => /bours/.test(t) },
  { re: /\b(filles?|femmes?|feminins?|garcons?|hommes?|masculins?|candidates)\b/, mot: 'filles / garçons', ok: (t, f) => /sexe|genre|candidates/.test(t) || /^(f|m|h|feminin|masculin|femmes?|hommes?|filles?|garcons?)$/.test(normalizeText(f.value)) || (typeof plannerColumnKind === 'function' && plannerColumnKind(f.col) === 'sexe') },
  { re: /\bapprenti(e|s|es)?\b|\bapprentissage\b|\balternance\b/, mot: 'apprentis', ok: t => /appr|altern/.test(t) },
  // v27.14 — condition chiffrée non comprise (« dont la capacité dépasse 100 ») : arrêt, pas toutes les lignes
  { re: /\b(plus de|moins de|au moins|au plus|superieure? a|inferieure? a|depasse\w*|au dela de|en dessous de)\s+\d/, mot: 'condition chiffrée', ok: (t, f) => f && f.source === 'condition_chiffree' },
  // v27.13 — « combien de refusés » sans colonne de statut comptait tout le fichier
  { re: /\brefus(e|es|ee|ees)?\b|\bliste d ?attente\b|\ben attente\b|\bdesist(e|es|ee|ees|ement)?\b/, mot: 'statut de candidature (refusé, liste d\'attente…)', ok: t => /refus|attente|desist|statut|admi|candidature/.test(t) },
  { re: /\bbasques?\b/, mot: 'Pays Basque', ok: t => /basque/.test(t) },
  { re: /\bpubli(c|cs|que|ques)\b|\bprive(e|s|es)?\b/, mot: 'public / privé', ok: t => /publi|priv|statut|secteur/.test(t) },
  { re: /\bselecti(f|fs|ve|ves)\b/, mot: 'sélective', ok: t => /selecti/.test(t) },
];
const LIEUX_AMBIGUS = new Set('somme manche nord lot var ain cher orne oise eure gers aube aude gard jura tarn indre doubs loire marne meuse vienne creuse rhone yonne'.split(' '));
function conceptsNonFiltres(plan) {
  if (!plan || !plan.table || ['compare', 'chart_current', 'export_current_excel', 'export_current_csv'].includes(plan.tool)) return [];
  let q = normalizeText(plan.question || '');
  // v27.14 — le critère d'un classement (« les plus sélectives », « le plus de boursiers ») n'est pas un filtre manquant
  if (plan.tool === 'classement' && plan.classement) q = q.replace(new RegExp(plan.classement.mot.source, 'g'), ' ');
  // v27.15 — part : en mode effectifs, le sujet (« boursiers », « filles ») est une colonne du calcul, pas un filtre manquant
  if (plan.tool === 'part' && plan.part && plan.part.mode === 'effectifs' && !plan.part.manque) q = q.replace(new RegExp(plan.part.mot.source, 'g'), ' ').replace(/\badmis(es)?\b|\bcandidats?\b|\bcandidates\b|\bneo ?bacheliers?\b/g, ' ');
  const filtres = [...(plan.filters || []), ...((plan.tool === 'part' && plan.part?.condition) || [])].filter(Boolean);
  // la colonne analysée ou additionnée compte aussi (« admis boursiers » → colonne « admis boursiers »)
  const cibles = [plan.targetCol, plan.targetCol2, plan.sumCol, plan.classement?.col, plan.part?.num, plan.part?.den].filter(Boolean).map(c => ({ col: c, value: '' }));
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

/* ═══════════════ v27.17 — Option précisée pour une partie des formations seulement ═══════════════
   Open data réel (2025) : l'option d'un PASS ne figure que dans « Filière de formation très détaillée »,
   renseignée pour 70 PASS sur 287 (et qui mêle options et lieux d'enseignement). « Combien de PASS option
   Biologie à Bordeaux » répondait 0 « calcul exact », alors que les PASS de Bordeaux ne disent pas leur option.
   Quand le mot cherché (option, mention…) ne peut se lire que dans une colonne remplie pour moins de 80 %
   des formations de la famille (« PASS »), et que des formations du périmètre n'y ont rien : on s'arrête,
   et on montre ce que disent les données (formations qui le précisent, formations sans précision). */
const SEUIL_COLONNE_REMPLIE = 0.8;
const _caseRemplie = (r, c) => String(r?.[c] ?? '').trim() !== '';
const _nbRemplies = (rows, c) => rows.reduce((n, r) => n + (_caseRemplie(r, c) ? 1 : 0), 0);
function precisionPartielleIntitules(plan, termFilter) {
  const table = plan && plan.table;
  if (!table || !termFilter || !Array.isArray(termFilter.terms) || !termFilter.terms.length) return null;
  const objets = table.objects || [];
  const info = formationTermsInfo(table);
  if (!info.cols.length) return null;
  const labels = String(termFilter.label || '').split(' + ');
  const termes = termFilter.terms.map((t, i) => ({ t: Array.isArray(t) ? t : [t], label: labels[i] || String(t) }));
  // mots qui suivent « option / mention / spécialité / parcours » : ce sont eux qu'on cherche d'abord
  const qn = normalizeText(plan.question || '');
  const forces = new Set();
  const reOpt = /\b(?:option|options|mention|mentions|specialite|specialites|parcours)\s+(?:(?:de|d|en|du|des|la|le|l)\s+)?([a-z0-9]{3,})/g;
  let m;
  while ((m = reOpt.exec(qn))) forces.add(m[1]);
  const estForce = x => x.t ? x.t.some(w => forces.has(w)) || forces.has(normalizeText(x.label)) : true;
  const candidats = [];
  if (termes.length >= 2) termes.forEach((x, i) => candidats.push({ ...x, autres: termes.filter((_, j) => j !== i) }));
  candidats.sort((a, b) => Number(estForce(b)) - Number(estForce(a)));
  (plan.unresolvedTerms || []).forEach(m => candidats.push({ t: null, label: String(Array.isArray(m) ? m[0] : m), autres: termes }));
  const autresFiltres = (plan.filters || []).filter(f => f && f !== termFilter && f.op !== 'contains_all');
  for (const cand of candidats) {
    // la famille : les formations qui ont les autres mots (« PASS »), dans tout le fichier
    const famille = applyLocalActionFilters(objets, [{ col: FORMATION_TERMS_COL, op: 'contains_all', cols: info.cols, terms: cand.autres.map(a => a.t) }]);
    if (famille.length < 5) continue;
    const taux = c => _nbRemplies(famille, c) / famille.length;
    let col = null;
    if (cand.t) {
      const ou = info.cols.map(c => ({ c, n: famille.filter(r => rowContainsAllTerms(r, { cols: [c], terms: [cand.t] })).length })).filter(x => x.n > 0);
      if (ou.some(x => taux(x.c) >= SEUIL_COLONNE_REMPLIE)) continue; // le mot est dans une colonne bien remplie : chiffre fiable
      col = (ou.sort((a, b) => b.n - a.n)[0] || {}).c || null;
      // mot absent de la famille : on ne l'explique par une précision manquante que s'il suit « option… »
      // (« PASS option droit » : c'est « droit » qui manque aux PASS, pas « PASS » aux formations de droit)
      if (!col && !estForce(cand)) continue;
    }
    if (!col) {
      const partielles = info.cols.filter(c => { const x = taux(c); return x > 0 && x < SEUIL_COLONNE_REMPLIE; });
      if (!partielles.length) continue;
      const nbVal = c => new Set(famille.map(r => r?.[c]).filter(v => String(v ?? '').trim() !== '')).size;
      col = partielles.sort((a, b) => nbVal(b) - nbVal(a))[0];
    }
    // le périmètre de la question (« à Bordeaux ») : s'il est entièrement précisé, le chiffre est exact
    const perimetre = applyLocalActionFilters(famille, autresFiltres);
    const sansPrecision = perimetre.filter(r => !_caseRemplie(r, col));
    if (!sansPrecision.length) continue;
    const precisees = cand.t ? perimetre.filter(r => rowContainsAllTerms(r, { cols: [col], terms: [cand.t] })) : [];
    return {
      terme: cand.label, famille: cand.autres.map(a => a.label).join(' + '), col,
      nFamille: famille.length, nRenseignees: _nbRemplies(famille, col),
      perimetre: perimetre.length, precisees, sansPrecision, filtres: autresFiltres,
    };
  }
  return null;
}
// Formations regroupées par établissement : nombre et places (« Université de Bordeaux : 2 formations, 165 et 270 places »)
function formationsParEtablissement(table, rows, max = 40) {
  const desc = _colonnesDescription(table);
  const etab = desc.find(h => /etablissement/.test(_hx(h))) || desc[desc.length - 1];
  const commune = (table.headers || []).find(h => /^(commune|ville)/.test(_hx(h)) && !/code|insee|postal|origine/.test(_hx(h)));
  const capa = (table.headers || []).find(h => /capacit/.test(_hx(h)) && _estNumerique(table, h));
  const groupes = new Map();
  rows.forEach(r => {
    const nom = String(r?.[etab] ?? '').trim() || '(établissement non renseigné)';
    const lieu = commune ? String(r?.[commune] ?? '').trim() : '';
    const cle = nom + '\u0001' + lieu;
    if (!groupes.has(cle)) groupes.set(cle, { etablissement: nom, commune: lieu, n: 0, places: [] });
    const g = groupes.get(cle);
    g.n++;
    const v = capa ? _nombreCellule(r?.[capa]) : null;
    if (v !== null) g.places.push(v);
  });
  const liste = [...groupes.values()].sort((a, b) => b.n - a.n || a.etablissement.localeCompare(b.etablissement, 'fr'));
  liste.forEach(g => g.places.sort((a, b) => a - b));
  return { colEtab: etab, colCapa: capa || null, formations: rows.length, total: liste.length, groupes: liste.slice(0, max) };
}
function _placesEnClair(places) {
  if (!places.length) return '';
  const f = places.map(p => p.toLocaleString('fr-FR'));
  return `${f.length > 1 ? `${f.slice(0, -1).join(', ')} et ${f[f.length - 1]}` : f[0]} place${places.length > 1 || places[0] > 1 ? 's' : ''}`;
}
function _tableauEtablissementsHtml(pe) {
  if (!pe || !pe.groupes.length) return '';
  const th = 'text-align:left;padding:6px 10px;background:#e8edff;color:var(--bleu,#003189);font-size:11px';
  const td = 'padding:5px 10px;font-size:12px;border-top:1px solid var(--gris1,#f3f4f6)';
  return `<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%"><thead><tr><th style="${th}">Établissement</th><th style="${th}">Commune</th><th style="${th};text-align:right">Formations</th>${pe.colCapa ? `<th style="${th}">Capacité de chacune</th>` : ''}</tr></thead><tbody>`
    + pe.groupes.map(g => `<tr><td style="${td}">${escapeHtml(g.etablissement)}</td><td style="${td}">${escapeHtml(g.commune || '—')}</td><td style="${td};text-align:right"><strong>${g.n}</strong></td>${pe.colCapa ? `<td style="${td}">${escapeHtml(_placesEnClair(g.places) || '—')}</td>` : ''}</tr>`).join('')
    + `</tbody></table></div>`
    + (pe.total > pe.groupes.length ? `<p style="font-size:12px;color:var(--gris3)">… et ${(pe.total - pe.groupes.length).toLocaleString('fr-FR')} autres établissements.</p>` : '');
}
function unresolvedPrecisionExecution(plan, pp) {
  const table = plan.table;
  const fam = `« ${pp.famille} »`;
  const portee = pp.filtres.length ? ` (${pp.filtres.map(_filtreEnClair).join(' ; ')})` : '';
  const pe = formationsParEtablissement(table, pp.sansPrecision);
  const desc = _colonnesDescription(table);
  const capa = (table.headers || []).find(h => /capacit/.test(_hx(h)) && _estNumerique(table, h));
  const ligne = r => [r?.[desc.find(h => /etablissement/.test(_hx(h)))], r?.[pp.col], capa ? `${_nombreCellule(r?.[capa]) ?? '?'} places` : ''].filter(x => String(x ?? '').trim()).map(x => escapeHtml(String(x))).join(' — ');
  const quoi = `« ${pp.terme} » ne peut se lire que dans « ${pp.col} », renseignée pour ${_nf(pp.nRenseignees)} formations ${fam} sur ${_nf(pp.nFamille)}`;
  const html = `<h4>Option non précisée dans les données</h4>`
    + `<p>Dans ${escapeHtml(_sourceEnClair(table))}, ${escapeHtml(quoi)}. Les autres ne disent pas leur option : je ne donne donc pas de chiffre, il serait trop petit.</p>`
    + `<p><strong>Ce que disent les données</strong>, pour les ${_nf(pp.perimetre)} formations ${escapeHtml(fam)}${escapeHtml(portee)} :</p><ul>`
    + `<li><strong>${_nf(pp.precisees.length)}</strong> formation${pp.precisees.length > 1 ? 's' : ''} dont la précision contient « ${escapeHtml(pp.terme)} »${pp.precisees.length ? ' :' : ''}`
    + (pp.precisees.length ? `<ul>${pp.precisees.slice(0, 30).map(r => `<li>${ligne(r)}</li>`).join('')}</ul>` : '') + `</li>`
    + `<li><strong>${_nf(pp.sansPrecision.length)}</strong> formation${pp.sansPrecision.length > 1 ? 's' : ''} sans aucune précision : ${pp.sansPrecision.length > 1 ? 'elles peuvent' : 'elle peut'} proposer « ${escapeHtml(pp.terme)} » ou non.</li></ul>`
    + `<p><strong>Formations sans précision, par établissement</strong> :</p>${_tableauEtablissementsHtml(pe)}`
    + `<p style="font-size:12px;color:var(--gris3)">Pour connaître leur option, consultez la fiche de chaque formation sur Parcoursup. Quand un établissement a plusieurs formations au même intitulé, la capacité permet de les distinguer.</p>`;
  const text = `NON CALCULÉ : ${quoi} ; les autres ne précisent pas leur option. Dans le périmètre (${_nf(pp.perimetre)} formations ${pp.famille}${portee}) : ${pp.precisees.length} précisent « ${pp.terme} », ${pp.sansPrecision.length} sans précision.`;
  return { kind: 'unresolved', plan, result: { missing: [pp.terme], suggestions: [], precision: { ...pp, precisees: pp.precisees.length, sansPrecision: pp.sansPrecision.length, etablissements: pe.groupes } }, text, html };
}

/* v27.11 — Reformulations courantes ramenées à la forme que le moteur comprend.
   Ne change pas le sens : abréviations (« nb de »), négations (« qui ne sont pas boursiers »),
   « dans chaque académie » (= par académie), « bacheliers généraux » (= bac général),
   « sur la commune de Bordeaux » (= à Bordeaux). */
const REFORMULATIONS = [
  [/\b(?:nb|nbre|nbr)\.?\s+(?=de\b|d['’]|des\b|total\b)/gi, 'nombre '],
  // négations : « qui ne sont pas dans l'académie de X » → « hors … » ; « qui ne sont pas boursiers » → « non boursiers »
  [/\b(?:qui\s+)?(?:ne\s+|n['’]\s*)(?:sont|est|soient|soit)\s+pas\s+(?:dans|du|de\s+la|de\s+l['’]|des|en|issus?\s+du|originaires?\s+du)\s*/gi, 'hors '],
  [/\b(?:qui\s+)?(?:ne\s+|n['’]\s*)(?:sont|est|soient|soit)\s+pas\s+/gi, 'non '],
  [/\ben\s+dehors\s+(?:de\s+la|de\s+l['’]|du|des|de)\s*/gi, 'hors '],
  [/\bsans\s+s[eé]lection\b/gi, 'non sélectives'],
  [/\b(?:classes?\s+)?pr[eé]paratoires?\s+aux\s+grandes\s+[eé]coles\b|\bclasses?\s+pr[eé]paratoires?\b|\bclasses?\s+pr[eé]pas?\b|\bpr[eé]pas?\b/gi, 'CPGE'],
  [/(?<!\b(?:filles|candidates|femmes)\s+)(?<!non\s)\bboursi[eè]res\b/gi, 'filles boursières'],
  [/\bpar\s+rapport\s+(?:aux|au|a|à)(?=\s|$)/gi, 'relativement à'], // v27.16 — « par rapport à 2024 » n'est pas une répartition
  [/\b(?:dans|pour|de|sur)\s+chaque\s+/gi, 'par '],
  [/\bchaque\s+/gi, 'par '],
  [/\bbacheli[eè]re?s?\s+g[eé]n[eé]ra(?:ux|le|les|l)\b|\bvoie\s+g[eé]n[eé]rale\b|\bfili[eè]re\s+g[eé]n[eé]rale\b/gi, 'bac général'],
  [/\bbacheli[eè]re?s?\s+technologiques?\b|\bvoie\s+technologique\b/gi, 'bac technologique'],
  [/\bbacheli[eè]re?s?\s+professionnel(?:le)?s?\b|\bvoie\s+professionnelle\b|\bvoie\s+pro\b/gi, 'bac professionnel'],
  [/\b(?:sur|dans)\s+(?:la\s+)?(?:commune|ville)\s+de\s+(?![ld]['’]|la\b|l\s)/gi, 'à '],
  [/\b(?:la\s+)?(?:commune|ville)\s+de\s+(?=[A-ZÀ-Ý])/g, 'à '],
];
function reformulerQuestion(question) {
  let q = String(question ?? '');
  REFORMULATIONS.forEach(([re, rep]) => { q = q.replace(re, rep); });
  return q.replace(/\s{2,}/g, ' ').trim();
}

function isDataEngineQuestion(question) {
  const q = normalizeText(reformulerQuestion(question || ''));
  if (!q) return false;
  // Exclusion : demandes de synthèse/résumé général → répondre via Albert narratif, pas Data Engine
  if (/^(fais |donne|produis |r[eé]dige )?(une? )?(synth[eè]se|r[eé]sum[eé]|bilan|vue d'ensemble|portrait|analyse globale)/.test(q)) return false;
  // v27.14 — classement selon un chiffre (« les formations les plus demandées »)
  try { if (CLASSEMENT_CUE.test(q) && detecterClassement((getActiveQueryTables() || [])[0], question)) return true; } catch (e) { /* source absente */ }
  // v27.15 — taux et parts (« part des boursiers parmi les admis »)
  try { if (detecterPart((getActiveQueryTables() || [])[0], question)) return true; } catch (e) { /* source absente */ }
  // v27.16 — « les places en BTS ont-elles augmenté depuis 2024 ? »
  try { const _t = (getActiveQueryTables() || [])[0]; if (sessionsDeLaQuestion(_t, question) && (formationTermsFromQuestion(_t, question).terms.length || /\b(places?|candidats?|admis|formations?|boursiers?|capacite|taux|part|bts|pass|cpge|licences?|but)\b/.test(q))) return true; } catch (e) { /* source absente */ }
  return /compare|comparaison|comparer|versus| vs |combien|nombre|\btotale?\b|effectif|compte|compter|repartition|r[eé]partition|ventilation|par |groupe|group[eé]|top|classement|principa|plus frequen|plus fréquent|croise|crois[eé]|tableau crois[eé]|pivot|moyen|moyenne|median|m[eé]diane|minimum|maximum|min|max|export|excel|csv|liste|filtre|graphique|graphe|diagramme|histogramme|camembert|barres?|boursier|basque|hors|sauf|seulement|uniquement|visualis|repr[eé]sent|montre-?moi|dessine|trace|issus?\s+d[ue]|originaires?|venant\s+d[ue]|provenant|scolaris|scolarit/.test(q) || isListValuesRequest(question) || isFollowUpQuestion(question);
}

function inferMeasureIntent(question) {
  // v27.13 — « liste d'attente » est un statut de candidature, pas une demande de liste / d'export
  const q = normalizeText(question || '').replace(/\bliste d ?attente\b|\bliste complementaire\b/g, 'attente');
  // v27.16 — « comparé à 2024 », « par rapport à l'an dernier » : comparaison de sessions, pas de groupes
  const _sessionCitee = /\b20[12]\d\b|\bl an (dernier|passe)\b|\bl annee (derniere|passee|precedente)\b|\bsession precedente\b/.test(q);
  if (/compare|comparaison|comparer|versus| vs /.test(q) && !_sessionCitee) return 'compare';
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
    // v27.11 — open data : une ligne = une formation ; « répartition des formations par académie » est une répartition simple
    const _uniteFormation = (() => { try { return getActiveQueryTables()[0]?.rowUnit === 'formation'; } catch (e) { return false; } })();
    if (_uniteFormation && /^formations?$/.test(d1.trim())) return 'group_by';
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
  question = reformulerQuestion(question);
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

  let tool = inferMeasureIntent(question);
  // v27.14 — « quelle formation a le plus de candidats » : classement, même sans mot d'analyse reconnu
  if ((!tool || tool === 'stats' || tool === 'count_rows') && detecterClassement(table, question)) tool = 'top';
  if ((!tool || tool === 'group_by') && detecterPart(table, question)) tool = 'count_rows';
  if (!tool && sessionsDeLaQuestion(table, question)) tool = 'count_rows';
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
    if (plannerPlan) return inheritConversationContext(applySessions(applyPart(applyConditionsChiffrees(applyClassement(applyMeasureSum(applyListMode(applyFormationTerms(plannerPlan))))))), question);
  }

  // Fallback V16 si planner indisponible.
  const q = normalizeText(question || '');
  const mentionedCols = findMentionedColumns(headers, question, 4);
  const targetCol = tool === 'group_by' ? (detectTargetColumn(headers, q) || mentionedCols[0] || null) : null;
  // V25.1 — idem : le fallback ne doit pas analyser le contexte textuel
  // précédent comme s'il s'agissait de la question utilisateur.
  const filters = detectFilters(table, normalizeText(question || ''), targetCol);
  return inheritConversationContext(applySessions(applyPart(applyConditionsChiffrees(applyClassement(applyMeasureSum(applyListMode(applyFormationTerms({
    tool,
    table,
    filters,
    targetCol,
    mentionedCols,
    question,
    createdAt: new Date().toISOString()
  }))))))), question);
}


function currentExecutionToRows(exec) {
  if (!exec) return [];
  const p = exec.plan || {};
  if (exec.kind === 'evolution') return (exec.result?.lignes || []).map(l => ({ Session: l.session, Valeur: exec.result.mesure === 'part' ? Math.round(l.valeur * 10) / 10 : l.valeur, 'Formations retenues': l.retenues, 'Formations de la session': l.formations }));
  if (exec.kind === 'part') {
    const lp = _libellePart(p);
    return [{ 'Part (%)': Math.round(exec.result.pct * 10) / 10, [`Effectif (${lp.quoi})`]: exec.result.num, [`Total (${lp.sur})`]: exec.result.den }];
  }
  if (exec.kind === 'classement') {
    const cols = p.classement?.entite ? [p.classement.entite.col] : (p.colonnesDescription || []);
    return (exec.result?.lignes || []).map(l => Object.fromEntries([['Rang', l.rang], ...cols.map((c, i) => [c, l.libelles[i] ?? '']), [p.classement?.col || 'Valeur', l.valeur]]));
  }
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
  // v27.16 — évolution : une barre par session
  if (prev.kind === 'evolution') {
    const rows = prev.result.lignes.map(l => ({ value: `Session ${l.session}`, count: prev.result.mesure === 'part' ? Math.round(l.valeur * 10) / 10 : l.valeur }));
    const titre = `Graphique — évolution ${prev.result.lignes[0].session} → ${prev.result.lignes[prev.result.lignes.length - 1].session}`;
    const html = `${deTitleHtml(titre, prev.plan?.blockId, prev.plan?.originalTitle || titre)}${renderMiniBarChart(rows, rows.reduce((t, r) => t + r.count, 0), 'evolution.png')}`;
    return { kind: 'evolution', plan: prev.plan, result: prev.result, text: prev.text, html };
  }
  // v27.15 — part : camembert « dans la part » / « reste »
  if (prev.kind === 'part') {
    const lp = _libellePart(prev.plan);
    const rows = [{ value: lp.quoi, count: prev.result.num, pct: prev.result.pct }, { value: `autres ${lp.sur}`, count: prev.result.den - prev.result.num, pct: 100 - prev.result.pct }];
    const titre = `Graphique — part de ${lp.quoi}`;
    const html = `${deTitleHtml(titre, prev.plan?.blockId, prev.plan?.originalTitle || titre)}${perimetreResultat('part', prev.plan, prev.result).html}${renderMiniPieChart(rows, prev.result.den)}`;
    return { kind: 'part', plan: prev.plan, result: prev.result, text: prev.text, html };
  }
  // v27.14 — classement : barres des valeurs classées (pas une répartition de repli)
  if (prev.kind === 'classement') {
    const rows = (prev.result?.lignes || []).map(l => ({ value: `${l.rang}. ${l.libelles.filter(Boolean).slice(0, 2).join(' — ')}`, count: l.valeur }));
    const total = rows.reduce((t, r) => t + (r.count || 0), 0);
    const titre = `Graphique — classement selon ${prev.plan?.classement?.libelle || 'la valeur'}`;
    const html = `${deTitleHtml(titre, prev.plan?.blockId, prev.plan?.originalTitle || titre)}${perimetreResultat('classement', prev.plan, prev.result).html}${renderMiniBarChart(rows, total, 'classement.png')}`;
    return { kind: 'classement', plan: prev.plan, result: prev.result, text: prev.text, html };
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
  // v27.16 — comparaison entre sessions : le même calcul rejoué sur chaque session
  if (plan.sessionsDemandees && !plan._sousSession) {
    // filtres persistants ajoutés une fois, ici, puis transmis aux calculs de chaque session
    const _pfs = persistentFiltersOverride || (typeof persistentFilters !== 'undefined' ? persistentFilters : []);
    if (_pfs && _pfs.length) { const cols = new Set((plan.filters || []).map(f => f.col)); plan.filters = [...(plan.filters || []), ..._pfs.filter(f => !cols.has(f.col))]; }
    return executerSessions(plan);
  }
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
    // v27.17 — option lisible seulement pour une partie des formations (PASS) : pas de chiffre trop petit
    const _precision = termFilter ? precisionPartielleIntitules(plan, termFilter) : null;
    if (_precision) return unresolvedPrecisionExecution(plan, _precision);
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
  if (plan.tool === 'count_rows' && plan.mesureIntrouvable) return unresolvedConceptExecution(plan, [], `aucune colonne de ${plan.mesureIntrouvable} dans les données`);
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
  if (plan.tool === 'part' && plan.part) {
    const exec = executerPart(plan);
    if (exec && exec.kind === 'part') rememberDataEngineExecution(exec);
    return exec;
  }
  if (plan.tool === 'classement' && plan.classement) {
    const exec = executerClassement(plan);
    if (exec && exec.kind === 'classement') rememberDataEngineExecution(exec);
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
    const _res = { total: rows.length, filled: counts.filled, distinct: counts.distinct, rows: topRows };
    // v27.17 — liste d'intitulés remplie pour moins de 80 % des formations (options des PASS) :
    // la liste n'est pas celle de toutes les options ; formations sans précision montrées par établissement
    if (plan.listMode && rows.length && counts.filled < rows.length * SEUIL_COLONNE_REMPLIE) {
      _res.sansPrecision = formationsParEtablissement(plan.table, rows.filter(r => !_caseRemplie(r, col)));
    } else if (plan.listMode && rows.length > 1 && counts.distinct <= 1) {
      // aucun intitulé ne distingue ces formations (les 8 PASS de l'académie de Bordeaux) : on les montre par établissement
      _res.memeIntitule = formationsParEtablissement(plan.table, rows);
    }
    const _txtSans = _res.sansPrecision
      ? `\n(sans précision dans cette colonne : ${rows.length - counts.filled} sur ${rows.length} ; la liste ne couvre que ${counts.filled} formations)`
      : _res.memeIntitule
        ? `\n(même intitulé, option non précisée ; par établissement : ${_res.memeIntitule.groupes.map(g => `${g.etablissement}${g.commune ? ` (${g.commune})` : ''} : ${g.n}${g.places.length ? `, ${_placesEnClair(g.places)}` : ''}`).join(' ; ')})`
        : '';
    const exec = {
      kind: plan.tool,
      plan: { ...plan, targetCol: col, limit },
      result: _res,
      text: topRows.map(x => `${x.value}: ${x.count} (${x.pct.toFixed(1)}%)`).join('\n') + _txtSans,
      html: renderDataEngineResultHtml(plan.tool, { ...plan, targetCol: col, limit }, _res)
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
    // v27.15 — « pourcentage moyen de boursiers » : la colonne des pourcentages, pas celle des effectifs
    const veutPct = /\b(pourcentage|part|proportion|taux)\b/.test(q) || /%/.test(String(question || ''));
    const estPct = /^%|^(pourcentage|part|taux|proportion)\b/.test(normalizeText(h).trim()) || /^%/.test(String(h).trim());
    if (veutPct && estPct) score += 90;
    if (veutPct && !estPct && /effectif|nombre|\bnb\b/.test(hn)) score -= 40;
    const motsH = hn.split(' ').filter(w => w.length >= 4);
    motsQ.forEach(w => { if (motsH.some(m => proche(m, w))) score += 60; });
    return { col: h, score, stats };
  }).filter(x => x && x.score > 0).sort((a, b) => b.score - a.score);
  return candidates[0]?.col || null;
}

function dataEngineResultToContext(exec) {
  if (!exec || !exec.plan) return '';
  const p = exec.plan;
  const filters = (p.filters || []).map(f => SYMBOLES_OPS[f.op] ? `${f.col} ${f.label}` : `${f.col} ${f.op === 'neq' ? '≠' : '='} "${f.value}"`).join(' ; ') || 'aucun';
  let out = `=== DATA ENGINE V22 — RÉSULTAT CALCULÉ SUR LIGNES BRUTES ===\n`;
  out += `Outil : ${p.tool}\nSource : ${p.table?.source || 'Données'} · ${p.table?.name || 'table'}\nFiltres : ${filters}\n`;
  // v27.10 — périmètre en clair : Albert doit le reprendre tel quel
  const _perim = perimetreResultat(exec.kind, p, exec.result).texte;
  if (_perim) out += `${_perim}\n`;
  if (exec.kind === 'count') out += `Résultat : ${exec.result.count} ligne(s) sur ${exec.result.total}.\n`;
  if (exec.kind === 'sum') out += `Résultat : ${exec.result.sum} ${exec.result.unite} (somme de « ${exec.result.col} ») sur ${exec.result.count} formation(s).\n`;
  if (exec.kind === 'evolution') out += `Évolution calculée par le widget (mêmes critères sur chaque session) :\n${exec.result.lignes.map(l => `- session ${l.session} : ${exec.result.mesure === 'part' ? `${_pctFr(l.valeur)} %` : l.valeur} (${l.retenues} formations retenues sur ${l.formations})`).join('\n')}\nÉcart : ${exec.result.ecart}${exec.result.ecartPct !== null ? ` (${_pctFr(exec.result.ecartPct)} %)` : ''}\n`;
  if (exec.kind === 'part') { const lp = _libellePart(exec.plan); out += `Part calculée par le widget : ${_pctFr(exec.result.pct)} % (${exec.result.num} ${lp.quoi} sur ${exec.result.den} ${lp.sur}).\n`; }
  if (exec.kind === 'classement') out += `Classement selon « ${exec.plan.classement.col} » (${exec.plan.classement.ordre === 'asc' ? 'croissant' : 'décroissant'})${exec.plan.classement.entite ? `, somme par ${exec.plan.classement.entite.col}` : ''} :\n${exec.result.lignes.map(l => `${l.rang}. ${l.libelles.join(' — ')} : ${l.valeur}`).join('\n')}\n`;
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
  // v27.11 — exclusion : la valeur exclue, pas le libellé (« ≠ Hors Pays Basque » était une double négation)
  const v = String((f.op === 'neq' ? f.value : (f.label || f.value)) ?? '').trim();
  if (SYMBOLES_OPS[f.op]) return `« ${f.col} » ${SYMBOLES_OPS[f.op]} ${String(f.value).replace('.', ',')}`;
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
    : kind === 'classement' || kind === 'part' ? result.total
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
  // v27.17 — 0 dans la commune de Bordeaux, mais des formations dans l'académie de Bordeaux (PASS à Talence) :
  // le 0 est exact, mais l'agent pensait sans doute à l'académie ou au département → on le dit
  if (['count', 'count_rows', 'sum'].includes(kind) && retenues === 0) {
    const fc = filtres.find(f => f.op !== 'neq' && f.op !== 'contains_all' && !SYMBOLES_OPS[f.op] && /^(commune|ville)/.test(_hx(f.col)));
    if (fc) {
      const v = normalizeText(fc.value);
      const autres = filtres.filter(f => f !== fc);
      [['academie', "l'académie"], ['departement', 'le département']].forEach(([cle, nom]) => {
        const col = (table.headers || []).find(h => new RegExp(`^${cle}`).test(_hx(h)) && !/code|origine/.test(_hx(h)));
        if (!col || !(table.objects || []).some(r => normalizeText(r?.[col]) === v)) return;
        const fAutre = { col, op: 'eq', value: (table.objects || []).find(r => normalizeText(r?.[col]) === v)[col] };
        // « PASS option biologie à Bordeaux » : dans l'académie, l'option n'est pas toujours précisée → pas de nombre trop petit
        const tf = autres.find(f => f.op === 'contains_all');
        const pp = tf ? precisionPartielleIntitules({ ...plan, filters: [...autres, fAutre] }, tf) : null;
        if (pp && pp.sansPrecision.length) {
          notes.push(`aucune ${mot(1)} dans la commune de ${fc.value} ; dans ${nom} de ${fc.value}, ${_nf(pp.precisees.length)} ${mot(pp.precisees.length)} « ${pp.famille} » ${pp.precisees.length > 1 ? 'précisent' : 'précise'} « ${pp.terme} » et ${_nf(pp.sansPrecision.length)} ne précisent pas leur option (demandez « … dans ${nom} de ${fc.value} »)`);
          return;
        }
        const n = applyLocalActionFilters(table.objects || [], [...autres, fAutre]).length;
        if (n > 0) notes.push(`aucune ${mot(1)} dans la commune de ${fc.value}, mais ${_nf(n)} dans ${nom} de ${fc.value} (demandez « … dans ${nom} de ${fc.value} »)`);
      });
    }
  }
  if (kind === 'group_by' && plan.listMode && result.sansPrecision) {
    const sans = (result.total || 0) - (result.filled || 0);
    notes.push(`${_nf(sans)} ${mot(sans)} sur ${_nf(result.total)} sans précision dans « ${plan.targetCol} » : la liste ne couvre que ${_nf(result.filled)} ${mot(result.filled)}`);
  }
  if (kind === 'stats' && result.total > result.numericCount) {
    const ign = result.total - result.numericCount;
    notes.push(`calcul sur ${_nf(result.numericCount)} valeur${result.numericCount > 1 ? 's' : ''} chiffrée${result.numericCount > 1 ? 's' : ''} ; ${_nf(ign)} ${mot(ign)} sans valeur chiffrée ignorée${ign > 1 ? 's' : ''}`);
  }
  if (kind === 'sum' && result.renseignees !== undefined && result.renseignees < result.count) {
    const ign = result.count - result.renseignees;
    notes.push(`${_nf(ign)} ${mot(ign)} sans valeur dans « ${result.col} », non comptée${ign > 1 ? 's' : ''}`);
  }
  if (kind === 'part' && result.ignorees > 0) notes.push(`${_nf(result.ignorees)} ${mot(result.ignorees)} sans valeur dans l'une des deux colonnes, écartée${result.ignorees > 1 ? 's' : ''} du calcul`);
  if (kind === 'classement' && result.tauxNuls > 0) notes.push(`${_nf(result.tauxNuls)} ${mot(result.tauxNuls)} au taux d'accès de 0 (aucune proposition d'admission par Parcoursup) écartée${result.tauxNuls > 1 ? 's' : ''} : ce ne sont pas des formations sélectives`);
  if (kind === 'classement' && result.sansValeur > 0) notes.push(`${_nf(result.sansValeur)} ${mot(result.sansValeur)} sans valeur dans « ${plan.classement.col} », écartée${result.sansValeur > 1 ? 's' : ''} du classement`);
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
        : SYMBOLES_OPS[f.op] ? `<li>${escapeHtml(f.col)} : <strong>${escapeHtml(f.label)}</strong></li>`
        : `<li>${escapeHtml(f.col)} ${f.op === 'neq' ? '≠' : '='} <strong>${escapeHtml(f.op === 'neq' ? f.value : (f.label || f.value))}</strong></li>`).join('')}</ul>`
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
      + (result.filled !== undefined && result.filled < result.total && !result.sansPrecision ? `<p style="font-size:12px;color:var(--gris3)">${(result.total - result.filled).toLocaleString('fr-FR')} ${unit(result.total - result.filled)} sans valeur dans cette colonne.</p>` : '')
      // v27.17 — colonne peu remplie : avertissement visible et formations sans précision par établissement
      + (result.memeIntitule ? `<p style="margin:10px 0 6px">Ces ${result.total.toLocaleString('fr-FR')} ${unit(result.total)} ont le même intitulé : aucune colonne ne précise leur option. <strong>Par établissement</strong> :</p>${_tableauEtablissementsHtml(result.memeIntitule)}<p style="font-size:12px;color:var(--gris3);margin:6px 0 0">Pour connaître leur option, consultez la fiche de chaque formation sur Parcoursup ; la capacité distingue les formations au même intitulé.</p>` : '')
      + (result.sansPrecision ? `<div style="background:#fff7ed;border-left:3px solid #c2410c;border-radius:4px;padding:8px 12px;margin:10px 0"><p style="margin:0 0 6px"><strong>⚠️ Liste incomplète</strong> : seules <strong>${result.filled.toLocaleString('fr-FR')}</strong> ${unit(result.filled)} sur ${result.total.toLocaleString('fr-FR')} ont une précision dans « ${escapeHtml(plan.targetCol)} » (option, lieu d'enseignement…). Les <strong>${(result.total - result.filled).toLocaleString('fr-FR')}</strong> autres n'en ont aucune : cette liste n'est pas celle de toutes les options proposées.</p><p style="margin:0 0 6px"><strong>${unit(2).replace(/^./, c => c.toUpperCase())} sans précision, par établissement</strong> :</p>${_tableauEtablissementsHtml(result.sansPrecision)}<p style="font-size:12px;color:var(--gris3);margin:6px 0 0">Pour connaître leur option, consultez la fiche de chaque formation sur Parcoursup ; la capacité distingue les formations au même intitulé.</p></div>` : '');
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
    const thStyle = `text-align:right;padding:7px 10px;background:#e8edff;color:var(--bleu,#003189);font-size:10px;letter-spacing:.5px;white-space:nowrap;border-bottom:2px solid var(--bleu-doux,#c8d8f0);max-width:90px;overflow:hidden;text-overflow:ellipsis`;
    const thFirstStyle = `text-align:left;padding:7px 10px;background:#e8edff;color:var(--bleu,#003189);font-size:10px;letter-spacing:.5px;border-bottom:2px solid var(--bleu-doux,#c8d8f0);min-width:120px`;
    const header = `<tr><th style="${thFirstStyle}">${escapeHtml(_shortColName(plan.targetCol))}</th>${cols.map(c => `<th style="${thStyle}" title="${escapeHtml(c)}">${escapeHtml(truncCol(c))}</th>`).join('')}<th style="${thStyle};font-weight:800;min-width:60px">Total</th><th style="${thStyle};min-width:50px">%</th></tr>`;
    const body = (result.matrix || []).map((r, i) => {
      const pct = total ? (r.total / total * 100).toFixed(1).replace('.', ',') : '—';
      const rowBg = i % 2 === 1 ? 'background:var(--gris0,#f8fafc)' : '';
      return `<tr style="${rowBg}" onmouseover="this.style.background='#e8edff'" onmouseout="this.style.background='${i % 2 === 1 ? 'var(--gris0,#f8fafc)' : ''}'"><td style="padding:6px 10px;font-size:12px;color:var(--bleu,#003189);font-weight:500;white-space:nowrap">${escapeHtml(r.value)}</td>${r.cells.map(c => `<td style="text-align:right;padding:6px 10px;font-size:12px">${c > 0 ? `<strong>${c.toLocaleString('fr-FR')}</strong>` : '<span style="color:var(--gris2,#e5e7eb)">—</span>'}</td>`).join('')}<td style="text-align:right;padding:6px 10px;font-size:12px;font-weight:800;color:var(--texte,#1a1a2e);border-left:1px solid var(--gris1,#f3f4f6)">${r.total.toLocaleString('fr-FR')}</td><td style="text-align:right;padding:6px 10px;font-size:11px;color:var(--gris3,#6b7280)">${pct} %</td></tr>`;
    }).join('');
    const colTotals = cols.map((_, i) => (result.matrix || []).reduce((s, r) => s + (r.cells[i] || 0), 0));
    const foot = `<tr style="background:#e8edff;border-top:2px solid var(--bleu-doux,#c8d8f0)"><td style="padding:7px 10px;font-weight:800;font-size:12px;color:var(--bleu,#003189)">Total</td>${colTotals.map(t => `<td style="text-align:right;padding:7px 10px;font-weight:800;font-size:12px">${t.toLocaleString('fr-FR')}</td>`).join('')}<td style="text-align:right;padding:7px 10px;font-weight:800;font-size:12px;border-left:1px solid var(--bleu-doux,#c8d8f0)">${total.toLocaleString('fr-FR')}</td><td></td></tr>`;
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
  return ['count','group_by','top','pivot','stats','export','compare','unresolved','sum','classement','part','evolution'].includes(exec.kind);
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
