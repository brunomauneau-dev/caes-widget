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
  const q = normalizeText(question || '').replace(/\s+(stp|svp|s il (te|vous) plait|merci)$/, '').trim();
  if (/^(graphique|graphe|diagramme|histogramme|camembert|barres?|chart|fais un graphique|affiche un graphique|visualise|visualise[- ]?moi|montre[- ]?moi [çca]a|dessine|trace un graphique)$/.test(q)) return true;
  // v27.5.68 — « en graphique », « sous forme de camembert », « montre-le en graphique », « mets ça en barres »
  // (avant : nouvelle question SANS filtre, toutes les formations de France)
  return /^(?:(?:et )?(?:(?:montre|affiche|mets|met|transforme|presente|fais|faites|dessine|trace)(?:[- ]?(?:le|la|les|moi|nous|ca|cela))*\s+)?(?:en |sous forme d ?(?:un |une )?|sous forme de |un |une |avec un )(?:graphique|graphe|diagramme|histogramme|camembert|barres?|diagramme en barres|courbe)(?: en barres)?|(?:fais|faites|fait)[- ]?(?:moi|nous)? (?:un |une )?(?:graphique|camembert|diagramme|histogramme)(?: de (?:ca|cela|ce tableau|ce resultat|cette repartition))?)$/.test(q);
}

function isBareExportRequest(question) {
  const q = normalizeText(question || '').replace(/\s+(stp|svp|s il (te|vous) plait|merci)$/, '').trim();
  if (/^(export|exporte|exporte en excel|excel|xlsx|csv|exporte en csv|telecharge|télécharge|telechargement|téléchargement)$/.test(q)) return true;
  // v27.5.68 — « exporte ce tableau », « télécharge ce résultat en CSV » : le tableau affiché (avant : toutes les lignes
  // du calcul, 1 244 formations au lieu des 15 départements du tableau)
  return /^(?:(?:exporte|exportez|exporter|telecharge|telechargez|telecharger|enregistre|sauvegarde|mets|met)(?:[- ]?(?:le|la|les|moi|nous|ca|cela))*\s+)?(?:ce|cette|ces|le|la)\s+(?:tableau|resultat|repartition|classement|recapitulatif)(?:\s+(?:en|au format|sous)\s+(?:excel|xlsx|csv|tableur))?$/.test(q) && /exporte|telecharg|enregistre|sauvegarde|excel|xlsx|csv|tableur/.test(q);
}

function isDimensionOnlyFollowUp(question) {
  const q = normalizeText(question || '');
  // v27.10 — « et par académie ? », « puis par filière » : même relance que « par académie »
  if (/^(?:(?:et|puis|maintenant|ensuite)\s+)?(par|selon)\s+/.test(q)) return true;
  // v27.5.68 — « fais un graphique par académie », « montre-moi la répartition par département » après un calcul
  return /^(?:(?:et|puis|maintenant|ensuite)\s+)?(?:fais|faites|affiche|montre|donne|mets|dessine|trace)(?:[- ]?(?:moi|nous|le|la|les))*\s+(?:un |une |la |le )?(?:graphique|camembert|diagramme|histogramme|repartition|ventilation|detail|tableau)(?: en barres)?\s+(?:par|selon)\s+/.test(q);
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
  if (RELANCE_SOUS_ENSEMBLE.test(q)) return false; // « combien ont eu une proposition ? » : les mêmes candidats
  if (RELANCE_MESURE_SEULE.test(q)) return false;
  return true;
}

const LISTE_CONDITION_RE = /^(?:les|quels|quelles|quel|quelle|lesquels|lesquelles)\s/;
const RELANCE_LESQUELS = /^(lesquel(?:le)?s|lesquels|quel(?:le)?s sont[- ]?(?:elles|ils)|ou sont[- ]?(?:elles|ils)|ou se trouvent[- ]?(?:elles|ils)|ou ca|lesquelles sont|lesquels sont)\b/;
// v27.5.60 — « donne-moi la liste », « la liste des établissements », « quels sont les établissements ? » après un
// comptage : les mêmes lignes, détaillées (avant : export de tout le fichier, 14 252 lignes sans aucun filtre)
const RELANCE_LISTE = /^(?:(?:et |alors |ok |d accord )?(?:donne|donnez|affiche|affichez|montre|montrez|fais|faites|sors|sortez|peux tu me donner|pouvez vous me donner|je veux|je voudrais|j aimerais)(?: moi| nous)? )?(?:la |une |leur )?liste(?: des| de ces)? ?(etablissements?|lycees?|formations?|ecoles?|universites?|iut|intitules?)?(?: concernee?s?| correspondante?s?| en question)?\s*\??$|^(?:quel(?:le)?s sont (?:les|ces) (etablissements|lycees|formations|ecoles|universites)|(?:et )?(?:les|ces) (etablissements|lycees|formations)\s*\?)\s*\??$|^(?:et )?(?:dans )?quel(?:le)?s (etablissements|lycees|formations|ecoles|universites)(?: (?:sont[- ]?ils|sont[- ]?elles|exactement|concernes|concernees|precisement))?\s*\??$/;
// question qui demande des établissements (« quels établissements proposent… », « liste des lycées qui… »)
const LISTE_ETAB_RE = /\b(?:quel(?:le)?s|liste(?: des)?|lister|nommer|citer)\s+(?:les |des )?(etablissements|lycees|universites|ecoles|iut)\b/;
// v27.25 — « et l'an dernier ? », « et en 2024 ? » : la même question sur une autre session
const RELANCE_SESSION = /^(?:et\s+)?(?:pour\s+|en\s+|a\s+|sur\s+)?(?:l an dernier|l annee derniere|l annee precedente|la session precedente|l an passe|l annee passee|20[12]\d|la session 20[12]\d)\s*\??$/;
// v27.5.56 — « combien ont eu une proposition ? », « et parmi eux combien de boursiers ? », « dont combien de filles ? » :
// une partie de la population précédente (avant : la question repartait de tout le fichier, ou « eux » était inconnu)
// v27.5.66 — « combien de places ? », « combien d'admis ? » juste après « combien de BTS en Gironde » : la mesure
// sur les MÊMES formations (avant : toute la France, 259 530 places)
const RELANCE_MESURE_SEULE = /^(?:et\s+)?(?:(?:le|la)\s+)?(?:combien|nombre|total|somme)\s+(?:de\s+|d\s+|des\s+)?(?:places?|admis|admises|candidats?|candidates|candidatures?|voeux)(?:\s+(?:au total|en tout|cela fait|ca fait))?\s*$/;
const RELANCE_SOUS_ENSEMBLE = /^(?:et\s+)?(?:parmi\s+(?:eux|elles|ceux ci|celles ci|ces \w+)|dont|combien\s+(?:d\s+entre\s+(?:eux|elles)|parmi\s+(?:eux|elles)|ont|sont|avaient|etaient|n\s+ont)|ceux qui|celles qui|et combien)\b/;
function isFilterOnlyFollowUp(question) {
  const q = normalizeText(question || '').trim();
  if (RELANCE_LISTE.test(q)) return true;
  if (RELANCE_SOUS_ENSEMBLE.test(q) && !/^combien\s+sont[- ]?(ils|elles)\s*\??$/.test(q)) return true;
  if (RELANCE_MESURE_SEULE.test(q)) return true;
  // v27.5.66 — « et privées ? », « et les sélectives ? » (avant : pas de calcul)
  if (/^et (?:les |des |en |pour les |dans le )?(?:publi\w*|priv\w*|(?:non )?selecti\w*|(?:non )?boursier\w*|apprenti\w*|filles|garcons)\s*$/.test(q)) return true;
  if (/^combien\s+(sont[- ]ils|y\s*(?:en\s+)?a[- ]?t[- ]?il|en tout|au total|maintenant|cela|ca|[cç]a)\s*\??$/.test(q)) return true;
  // v27.25 — « lesquelles sont à Bordeaux ? », « quels sont-ils ? », « où sont-elles ? » : les mêmes, détaillés
  if (RELANCE_LESQUELS.test(q)) return true;
  // v27.14 — « et à Bordeaux ? », « et en Gironde ? », « et dans l'académie de Toulouse ? », « et sur Pau ? »
  return /^(seulement|uniquement|avec|sans|sauf|hors|excluant|en excluant|les boursiers|les non boursiers|non boursiers|boursiers|et pour|et les|et chez|parmi les|pour les|chez les|uniquement les|notamment les|en particulier|et parmi|et a |et au |et aux |et en |et dans |et sur |et hors |et sauf |et de |et du |et des |et d )/.test(q);
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
  // v27.5.59 — gardé en mémoire par table et par colonne (relu à chaque question avant)
  if (!table || typeof table !== 'object') return [];
  const n = (table.objects || []).length;
  if (!table._distinct || table._distinct.n !== n) table._distinct = { n, m: new Map() };
  if (!table._distinct.m.has(col)) table._distinct.m.set(col, [...new Set((table.objects || []).map(r => String(r?.[col] ?? '').trim()).filter(Boolean))]);
  return table._distinct.m.get(col).slice();
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

const _MATIERES_LYCEE = [
  [/\bses\b|sciences economiques et sociales/, ['economiques', 'sociales'], 'Sciences Economiques et Sociales', ['ses']],
  [/\bsvt\b|sciences de la vie et de la terre/, ['vie', 'terre'], 'Sciences de la vie et de la Terre', ['svt']],
  [/\bhggsp\b|geopolitique/, ['geopolitique'], 'Histoire-Géographie, Géopolitique et Sciences politiques', ['hggsp', 'geopolitique']],
  [/\bhlp\b|humanites/, ['humanites'], 'Humanités, Littérature et Philosophie', ['hlp', 'humanites']],
  [/\bllcer\b|langues litteratures et cultures/, ['langues', 'cultures'], 'Langues, littératures et cultures étrangères et régionales', ['llcer']],
  [/\bnsi\b|numerique et sciences informatiques/, ['numerique', 'informatiques'], 'Numérique et Sciences Informatiques', ['nsi']],
  [/\bamc\b|anglais monde/, ['anglais', 'monde'], 'Anglais, Monde Contemporain', ['amc']],
  [/\bphysique ?chimie\b|\bphysique\b|\bpc\b/, ['physique'], 'Physique-Chimie', ['physique', 'chimie', 'pc']],
  [/\bmaths?\b|\bmathematiques?\b/, ['mathematiques'], 'Mathématiques', ['maths', 'math', 'mathematiques', 'mathematique']],
  [/\bsciences de l ingenieur\b|\bsi\b/, ['ingenieur'], "Sciences de l'ingénieur", ['si', 'ingenieur']],
  // « Droit et Économie » (terminale STMG) ; « spécialité droit » au lycée = cette spécialité
  [/\b(?:specialites? (?:de |du )?)?droit et eco(?:nomie)?\b|\bdroit eco\b|\bspecialites? (?:de |du )?droit\b/, ['droit', 'economie'], 'Droit et Economie', ['droit', 'economie', 'eco']],
  [/\bmercatique\b/, ['mercatique'], 'Mercatique', ['mercatique']],
];
// v27.5.53 — spécialités du lycée citées dans la question : filtres « contient » sur la colonne des enseignements
// de spécialité, et mots de la question qu'elles expliquent (pour ne pas les chercher dans les formations d'accueil)
// v27.5.55 — colonnes qui décrivent le LYCÉE du candidat : enseignements de spécialité de terminale (« Mathématiques |
// Physique-Chimie ») et spécialité de la classe (bac pro, STMG : « Mercatique », « Gestion et finance »). Distinctes de la
// formation d'accueil (« Spécialité / mention formation d'accueil acceptée »), dont beaucoup de mots sont communs.
// v27.5.79 — « par spécialité » dans un fichier de candidats : trois colonnes possibles. Le contexte de la question
// décide ; sans indice, le widget demande de préciser (avant : la spécialité du bac pro, presque toujours vide, même pour
// « les admis en PASS par spécialité »)
function _dimensionSpecialite(table, question) {
  const q = normalizeText(question || '');
  if (!/\bpar\s+(?:enseignements?\s+de\s+)?specialites?\b|\bpar\s+enseignements?\b|\bpar\s+doublettes?\b/.test(q)) return null;
  const L = _colonnesLycee(table);
  const hs = (table?.headers || []).filter(Boolean);
  const acc = hs.find(h => /^specialite.*mention.*accueil|specialite.*formation d accueil/.test(normalizeText(h))) || null;
  const choix = [L.ens && 'enseignements de spécialité suivis au lycée', acc && 'spécialité / mention de la formation d\'accueil', L.spe && 'spécialité du bac (bac pro)'].filter(Boolean);
  if (choix.length < 2) return null; // une seule colonne : rien d'ambigu
  if (L.ens && /\benseignements?\b|\blycee\b|\bterminale\b|\bsuivie?s?\b|\bdoublettes?\b|\bpremiere\b/.test(q)) return { col: L.ens, eclater: true };
  if (acc && /\b(?:de la |de leur |d )?formation(?:s)?(?: d accueil)?\b|\baccueil\b|\bmentions?\b/.test(q.replace(/^.*?\bpar\b/, ''))) return { col: acc };
  if (L.spe && /\bbac(?:s|heliers?)? pros?\b|\bprofessionnel(?:le)?s?\b/.test(q)) return { col: L.spe };
  return { ambigu: true, choix };
}
// colonne à plusieurs valeurs (« Mathématiques | Physique-Chimie ») : chaque valeur comptée (un candidat compte dans
// chacune de ses spécialités) ; pct = part des lignes qui ont cette valeur
function _comptesEclates(rows, col) {
  const m = new Map(); let filled = 0;
  rows.forEach(r => { const parts = String(r?.[col] ?? '').split('|').map(x => x.trim().replace(/^Msgn\/\s*/, '')).filter(Boolean); if (!parts.length) return; filled++; [...new Set(parts)].forEach(p => m.set(p, (m.get(p) || 0) + 1)); });
  const top = [...m].map(([value, count]) => ({ value, count, pct: filled ? count / filled * 100 : 0 })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'fr'));
  return { top, filled, distinct: top.length, eclate: true };
}
function _colonnesLycee(table) {
  const hs = (table?.headers || []).filter(Boolean);
  const ens = hs.find(h => /enseignements? .*specialite|specialites? .*suivi/.test(normalizeText(h))) || null;
  if (!ens) return { ens: null, spe: null, cols: [] };
  const spe = hs.find(h => h !== ens && /^specialite( de la classe| du bac| de terminale)?$/.test(normalizeText(h).trim())) || null;
  return { ens, spe, cols: [ens, spe].filter(Boolean) };
}
// Spécialités de la colonne (chaque enseignement d'une case « A | B », et chaque spécialité de classe), avec leurs mots
function _sujetsLycee(table) {
  if (table._sujetsLycee) return table._sujetsLycee;
  const { ens, spe } = _colonnesLycee(table);
  const m = new Map();
  (table.objects || []).forEach(r => {
    const parts = [...String(r?.[ens] ?? '').split('|'), ...(spe ? [String(r?.[spe] ?? '')] : [])].map(x => x.trim()).filter(Boolean);
    parts.forEach(x => { const k = x.replace(/^Msgn\/\s*/, ''); if (!m.has(k)) m.set(k, { nom: k, mots: new Set(normalizeText(k).split(' ')), n: 0 }); m.get(k).n++; });
  });
  return (table._sujetsLycee = [...m.values()]);
}
// sigles et abréviations des enseignements de spécialité → leurs mots
const _SIGLES_LYCEE = [
  [/\bses\b/g, 'sciences economiques et sociales'], [/\bsvt\b/g, 'sciences de la vie et de la terre'], [/\bhggsp\b/g, 'geopolitique'],
  [/\bhlp\b/g, 'humanites litterature et philosophie'], [/\bllcer\b/g, 'langues litteratures et cultures etrangeres'],
  [/\bnsi\b/g, 'numerique et sciences informatiques'], [/\beppcs\b/g, 'education physique pratiques et culture sportives'], [/\bamc\b/g, 'anglais monde contemporain'], [/\bmaths?\b/g, 'mathematiques'],
  [/\bphysique chimie\b/g, 'physique chimie'], [/\bpc\b/g, 'physique chimie'], [/\bdroit eco\b/g, 'droit et economie'],
  [/\bdroit et eco\b/g, 'droit et economie'],
  // noms propres aux spécialités du lycée, reconnus même sans « spécialité » (la formation d'accueil s'appelle « Droit »)
  [/\bdroit et economie\b/g, 'droit et economie'], [/\bphysique chimie\b/g, 'physique chimie'],
  [/\bsciences economiques et sociales\b/g, 'sciences economiques et sociales'],
];
const _VIDES_SPE = new Set('de du des d la le les l et en a au aux un une option ou'.split(' '));
const _VERBES_SPE = new Set('fait faisaient pris suivi suivie suivis suivies suivant suivent eu'.split(' '));
const _COUPE_SPE = new Set('admis admise admises acceptes acceptees inscrits inscrites qui ayant dans pour par combien sont ont avec sans boursiers boursieres apprentis candidats candidates eleves terminale lycee premiere classe mais parmi chez'.split(' '));
const _CUES_LYCEE = /\b(specialites?|enseignements? de specialites?|enseignements?|doublettes?)\b/g;
// accueil juste avant « spécialité » (« admis en licence spécialité droit », « formation d'accueil spécialité ») : pas le lycée
const _ACCUEIL_AVANT = /\b(admis|admise|admises|inscrits?|inscrites?|acceptes?|acceptees?|accueil|formations?|licences?|mentions?|bts|but|dut|cpge|master|ecoles?)\b(?: \S+){0,2}\s*$/;
function _specialitesLycee(table, q) {
  const vide = { col: null, filtres: [], mots: new Set(), spans: [] };
  const L = _colonnesLycee(table);
  if (!L.ens) return vide;
  const cle = `${q}`;
  table._speCache = table._speCache || new Map();
  if (table._speCache.has(cle)) return table._speCache.get(cle);
  const sujets = _sujetsLycee(table);
  let qs = q;
  const sigles = [];
  _SIGLES_LYCEE.forEach(([re, mots]) => { if (re.test(qs)) { sigles.push(mots); qs = qs.replace(re, mots); } re.lastIndex = 0; });
  const tokens = qs.split(' ');
  const departs = [];
  // après « spécialité(s) / enseignement(s) de spécialité » (sauf formation d'accueil juste avant)
  let m; _CUES_LYCEE.lastIndex = 0;
  while ((m = _CUES_LYCEE.exec(qs))) {
    if (_ACCUEIL_AVANT.test(qs.slice(0, m.index))) continue;
    departs.push(qs.slice(0, m.index + m[0].length).split(' ').filter(Boolean).length);
  }
  // avant « en terminale / au lycée » (« ayant fait maths en terminale »)
  const t = qs.match(/^(.*?)\b(?:en|de) (?:classe de )?terminale\b|^(.*?)\bau lycee\b/);
  if (t) {
    const avant = (t[1] ?? t[2] ?? '').trim().split(' ').filter(Boolean);
    let i = avant.length; while (i > 0 && !_COUPE_SPE.has(avant[i - 1]) && avant.length - i < 6) i--;
    for (let j = i; j < avant.length; j++) departs.push(j); // « ayant fait histoire en terminale » : « fait » n'est pas une spécialité
  }
  // sigle cité seul (« les SVT admis en PASS »)
  sigles.forEach(mots => { const w = mots.split(' ')[0]; const i = tokens.indexOf(w); if (i >= 0) departs.push(i); });
  const out = { col: L.ens, cols: L.cols, filtres: [], mots: new Set(), spans: [] };
  const contient = (suj, w) => suj.mots.has(w) || suj.mots.has(w + 's') || suj.mots.has(w.replace(/s$/, ''));
  const vus = new Set();
  const pris = new Set();
  [...new Set(departs)].sort((a, b) => a - b).forEach(d0 => {
    let i = d0;
    const debut = d0;
    while (i < tokens.length) {
      while (i < tokens.length && (_VIDES_SPE.has(tokens[i]) || _VERBES_SPE.has(tokens[i]))) i++;
      if (i >= tokens.length || _COUPE_SPE.has(tokens[i])) break;
      let fait = null;
      for (let k = Math.min(7, tokens.length - i); k >= 1 && !fait; k--) {
        const seq = tokens.slice(i, i + k);
        if (seq.some(w => _COUPE_SPE.has(w)) || _VIDES_SPE.has(seq[seq.length - 1])) continue;
        const sig = seq.filter(w => !_VIDES_SPE.has(w) && w.length >= 2);
        if (!sig.length) continue;
        const phrase = seq.join(' ');
        // le nom exact d'une spécialité (« mathématiques » = Mathématiques, pas « Physique-Chimie et Mathématiques ») ;
        // sinon plusieurs mots : à la suite dans le nom (« maths et physique » = deux spécialités) ; un mot : contenu
        const nomN = su => normalizeText(su.nom);
        let ok = sujets.filter(su => nomN(su) === phrase || nomN(su) === phrase + 's');
        // puis le nom qui commence par ces mots (« physique » = Physique-Chimie…, pas « Sciences physiques et chimiques »)
        if (!ok.length) ok = sujets.filter(su => nomN(su).startsWith(phrase + ' ') || nomN(su).startsWith(phrase + 's '));
        if (!ok.length) ok = k > 1 ? sujets.filter(su => ` ${nomN(su)} `.includes(` ${phrase} `)) : sujets.filter(su => sig.every(w => contient(su, w)));
        if (ok.length) fait = { k, sig, ok };
      }
      if (!fait) break;
      const cleF = fait.sig.join(' ');
      if (!vus.has(cleF)) {
        vus.add(cleF);
        const noms = [...new Map(fait.ok.sort((a, b) => b.n - a.n).map(x => [normalizeText(x.nom), x.nom])).values()];
        const label = noms.length <= 3 ? noms.join(' ou ') : `${noms.length} spécialités contenant « ${fait.sig.join(' ')} »`;
        out.filtres.push({ col: L.ens, cols: L.cols, op: 'contains_words', sujets: noms.map(normalizeText), terms: fait.sig.map(w => [w, w + 's', w.replace(/s$/, '')]), value: label, label, source: 'specialite_lycee', _de: i, _a: i + fait.k });
        fait.sig.forEach(w => out.mots.add(w));
      }
      for (let j = debut > 0 && /^(specialites?|enseignements?|doublettes?|specialite)$/.test(tokens[debut - 1]) ? debut - 1 : debut; j < i + fait.k; j++) pris.add(j);
      i += fait.k;
    }
  });
  // v27.5.74 — « SES ou HGGSP », « maths ou physique » : l'une ou l'autre (avant : les deux exigées, 2 223 au lieu de 8 390)
  if (out.filtres.length >= 2) {
    const tri = out.filtres.slice().sort((a, b) => a._de - b._de);
    const ouEntre = tri.slice(1).every((f, k) => { const entre = tokens.slice(tri[k]._a, f._de); return entre.includes('ou') && !entre.includes('et'); });
    if (ouEntre) {
      const label = tri.map(f => f.label).join(' ou ');
      out.filtres = [{ col: L.ens, op: 'or', groupes: tri.map(f => [f]), value: label, label: `« ${L.ens} » contient ${tri.map(f => `« ${f.label} »`).join(' ou ')}`, source: 'specialite_lycee' }];
    }
  }
  out.filtres.forEach(f => { delete f._de; delete f._a; });
  if (out.filtres.length) {
    // reste de la question (pour les formations d'accueil) : sans les spécialités du lycée ni « en terminale / au lycée »
    out.reste = tokens.filter((w, j) => !pris.has(j)).join(' ').replace(/\b(?:en|de) (?:classe de )?terminale\b|\bau lycee\b|\b(enseignements? de )?specialites?\b/g, ' ').replace(/\s+/g, ' ').trim();
    // ce qui est expliqué par la spécialité du lycée : retiré de la question pour la recherche des formations d'accueil
    sigles.forEach(x => x.split(' ').forEach(w => out.mots.add(w)));
    ['ses', 'svt', 'hggsp', 'hlp', 'llcer', 'nsi', 'amc', 'eppcs', 'maths', 'math', 'pc', 'eco'].forEach(w => { if (` ${q} `.includes(` ${w} `)) out.mots.add(w); });
  }
  const res = out.filtres.length ? out : vide;
  table._speCache.set(cle, res);
  return res;
}
// la question sans les spécialités du lycée qu'elle cite (« spécialité droit et économie admis en droit » → « … admis en droit »)
function _horsSpecialitesLycee(table, q) {
  const sp = _specialitesLycee(table, q);
  return sp.filtres.length && sp.reste !== undefined ? sp.reste : q;
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

  // v27.5.53 — « partent hors académie », « restent dans l'académie » sans nommer l'académie : l'académie des candidats du
  // fichier, c'est-à-dire l'académie d'accueil majoritaire (plus de la moitié des admis), nommée dans le périmètre.
  // Avant : filtre perdu, tout le fichier. Si aucune académie n'est majoritaire, rien n'est supposé.
  const _horsAca = /\b(hors|en dehors) (de )?(l |leur |notre |son )?academie\b|\b(quittent|quitter|quitte|sortent de|sortir de|partent de) (l |leur |notre |son )?academie\b|\b(une |d )?autres? academies?\b/.test(q);
  const _dansAca = /\b(restent|reste|restant|rester|demeurent|restes|restees?) (dans|en) (l |leur |notre |son )?academie\b|\bdans (l |leur |notre |son )academie\b/.test(q);
  if ((_horsAca || _dansAca) && !/\bacademies? (de|d) [a-z]/.test(q)) {
    const col = findColumnByConceptStrict(table, 'academie_accueil');
    if (col && !out.some(f => f.col === col)) {
      const n = new Map();
      (table.objects || []).forEach(r => { const v = String(r?.[col] ?? '').trim(); if (v) n.set(v, (n.get(v) || 0) + 1); });
      const tot = [...n.values()].reduce((a, b) => a + b, 0);
      const [ref, nb] = [...n.entries()].sort((a, b) => b[1] - a[1])[0] || [];
      if (ref && nb > tot / 2) add(col, ref, _horsAca ? 'neq' : 'eq');
    }
  }

  // v27.5.53 — « lycées agricoles », « enseignement agricole » : « Ministère de rattachement » = Agriculture
  // (avant : « nom contenant lycée agricoles », un seul établissement)
  if (/\b(lycees?|etablissements?|enseignement|eleves|candidats?) agricoles?\b|\bde l agriculture\b/.test(q)) {
    const minCol = (table?.headers || Object.keys(table?.objects?.[0] || {})).filter(Boolean).find(h => /minist/.test(_hx(h)) && _distinctValues(table, h).some(v => /agricult/.test(normalizeText(v))));
    if (minCol) add(minCol, _distinctValues(table, minCol).find(v => /agricult/.test(normalizeText(v))), 'eq');
  }

  // v27.5.53 — spécialités suivies au lycée (« ayant suivi la spécialité SES », « doublette maths-physique ») :
  // colonne « Enseignement(s) de spécialité suivi(s) ». Avant : filtre perdu (SES) ou formation d'accueil « Mathématiques ».
  out.push(..._specialitesLycee(table, q).filtres);

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
  // v27.5.53 — fichier de candidats : « Type de contrat établissement de la scolarité » (Public / Privé sous contrat…)
  const statutCol = headersS.find(h => /statut|secteur/.test(_hx(h)) && _distinctValues(table, h).some(v => /^public/.test(normalizeText(v))))
    || headersS.find(h => /contrat/.test(_hx(h)) && _distinctValues(table, h).some(v => /^public/.test(normalizeText(v))));
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
      // v27.5.53 — « à Paris » : la commune est écrite par arrondissement (« Paris 11e Arrondissement ») → tous
      const _arr = new Map();
      _distinctValues(table, col).forEach(x => { const m = normalizeText(x).match(/^(.+?) \d+ ?(er|e|eme)? arrondissement$/); if (m) { if (!_arr.has(m[1])) _arr.set(m[1], []); _arr.get(m[1]).push(normalizeText(x)); } });
      const base = [..._arr.keys()].find(b => new RegExp(`(^| )a ${b}( |$)`).test(q));
      if (base) {
        const nom = base.charAt(0).toUpperCase() + base.slice(1);
        out.push({ col, op: 'in', values: _arr.get(base), value: nom, label: `${nom} (${_arr.get(base).length} arrondissements)`, source: 'commune_a' });
        break;
      }
    }
    // v27.5.53 — fichier de candidats : « candidats de Pau », « des lycées de Bordeaux », « scolarisés à Bordeaux » :
    // la commune de SCOLARITÉ. « de X » seulement si X n'est pas une académie (« de Bordeaux » = l'académie, sauf
    // « lycées de Bordeaux »). Avant : filtre perdu, « combien de candidats de Pau » donnait tout le fichier.
    const comOrig = comCols.find(h => (typeof plannerColumnRole === 'function') && plannerColumnRole(h).origine);
    if (comOrig && !out.some(f => f.col === comOrig)) {
      const acaVals = new Set(headersS.filter(h => /acad[eé]mi/.test(_hx(h))).flatMap(h => _distinctValues(table, h).map(normalizeText)));
      const v = _distinctValues(table, comOrig).filter(x => normalizeText(x).length >= 3).sort((a, b) => b.length - a.length).find(x => {
        const n = normalizeText(x);
        if (new RegExp(`\\b(lycees?|etablissements?|eleves|lyceens|scolarises?|scolarisees?|issus?|issues?|venant|originaires?|provenant)( (de la|de l|du|des|de|d|a|au|en))? ${n}( |$)`).test(q)) return true;
        return !acaVals.has(n) && new RegExp(`\\b(candidats?|candidates?|bacheliers?|bachelieres?|boursiers?|boursieres?|apprenti(e)?s?|ceux|celles|jeunes) (de|d) ${n}( |$)`).test(q);
      });
      if (v) out.push({ col: comOrig, value: v, op: 'eq', label: null, source: 'commune_a' });
    }
    // v27.5.64 — « admis en BTS de Pau », « les BTS de Dax » : « de X » (X commune, pas académie) non lu ailleurs.
    // Avant : Pau perdu, 4 975 admis en BTS (tout le fichier) au lieu de 257. Commune d'accueil après un verbe
    // d'accueil (admis, acceptés…), sinon d'origine si le fichier la distingue.
    if (!out.some(f => comCols.includes(f.col))) {
      const acaVals = new Set(headersS.filter(h => /acad[eé]mi|departement|region/.test(_hx(h))).flatMap(h => _distinctValues(table, h).map(normalizeText)));
      const _role = c => (typeof plannerColumnRole === 'function') ? plannerColumnRole(c) : {};
      const comAcc = comCols.find(h => _role(h).accueil), comOri = comCols.find(h => _role(h).origine);
      const col = comOri && comAcc ? (_VERBE_ACCUEIL_RE.test(q) ? comAcc : comOri) : comCols[0];
      const v = _distinctValues(table, col).filter(x => normalizeText(x).length >= 3 && !acaVals.has(normalizeText(x))).sort((a, b) => b.length - a.length)
        .find(x => new RegExp(`(^| )(de|d) ${normalizeText(x)}( |$)`).test(q) && !new RegExp(`\\b(universite|universites|iut|lycee|lycees|ecole|ecoles|institut|college|campus|academie|departement|region|commune|ville) (de |d )${normalizeText(x)}\\b`).test(q));
      if (v) out.push({ col, value: v, op: 'eq', label: null, source: 'commune_a' });
    }
  }

  // Etablissement d\'origine : "venant du/de", "issus du/de", "originaires du/de"
  const _etablPattern = /(?:venant\s+(?:du|de(?:\s+l[ae']?)?)|provenant\s+(?:du|de)|originaires?\s+(?:du|de)|issus?\s+(?:du|de)|qui\s+viennent\s+(?:du|de)|scolaris[eé]e?s?\s+(?:au|[àa]))\s*(?:lyc[eé]e|[eé]tablissement)?\s+([a-zA-ZÀ-ÿ][a-zA-ZÀ-ÿ\s\-']{2,45}?)(?:\s*[?!.]|$)/i;
  const _etablMatch = (question || '').match(_etablPattern);
  if (_etablMatch) {
    const name = _etablMatch[1].trim();
    const origCol = findColumnByConceptStrict(table, 'etablissement_origine');
    // v27.5.53 — « scolarisés à Bordeaux » : une commune, pas le premier lycée dont le nom contient « Bordeaux »
    // (avant : « Lycée agricole de Bordeaux Blanquefort », 0 candidat)
    const _estCommune = comCols.some(h => _distinctValues(table, h).some(v => normalizeText(v) === normalizeText(name)));
    if (origCol && !_estCommune) {
      const stopWords = new Set(['du','de','des','le','la','les','et','au','aux','en','lycee','etablissement','public','publics','publique','publiques','prive','prives','privee','privees','agricole','agricoles']);
      const nameWords = normalizeText(name).split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
      const vals = [...new Set((table.objects || []).map(r => String(r[origCol] ?? '')).filter(Boolean))];
      const match = nameWords.length ? vals.find(v => nameWords.every(w => normalizeText(v).includes(w))) : null;
      if (match) add(origCol, match, 'eq');
    }
  }

  // v27.5.71 — open data : « formations de Lyon », « établissements de Lille » : « de X » = l'académie X si elle existe,
  // sinon le département, la région, la commune (même règle que « de Bordeaux »). Avant : arrêt « aucune valeur pour lyon ».
  {
    const _role = c => (typeof plannerColumnRole === 'function') ? plannerColumnRole(c) : {};
    const lieuxCols = headersS.filter(h => /acad[eé]mi|departement|region|commune|ville/.test(_hx(h)) && !/code|insee|postal/.test(_hx(h)));
    const sansRoles = !lieuxCols.some(h => _role(h).origine || _role(h).accueil);
    if (sansRoles && lieuxCols.length && !out.some(f => lieuxCols.includes(f.col))) {
      const ordre = [/acad[eé]mi/, /departement/, /region/, /commune|ville/].map(re => lieuxCols.find(h => re.test(_hx(h)))).filter(Boolean);
      const qde = ` ${q} `;
      let trouve = null;
      for (const col of ordre) {
        const v = _distinctValues(table, col).filter(x => normalizeText(x).length >= 3).sort((a, b) => b.length - a.length)
          .find(x => { const n = normalizeText(x); return new RegExp(`\\b(?:de|d|du|des) ${n} `).test(qde) && !new RegExp(`\\b(?:academie|departement|region|commune|ville|universite|iut|lycee|ecole|institut)s? (?:de|d|du|des) ${n} `).test(qde); });
        if (v) { trouve = { col, value: v }; break; }
      }
      if (trouve) out.push({ col: trouve.col, value: trouve.value, op: 'eq', label: null, source: 'de_lieu' });
    }
  }
  // v27.5.64 — énumération de 3 valeurs ou plus d'une même colonne (« académies de Bordeaux, Toulouse et Poitiers ») :
  // une seule condition « l'une des valeurs ». Avant : Bordeaux seul lu, puis arrêt. (Deux valeurs : « X et/ou Y », union.)
  const qv = question ? normalizeText(String(question).replace(/\s*,\s*/g, ' qqvirgule ')).replace(/ ?qqvirgule ?/g, ' , ') : '';
  const enums = [];
  if (/ , /.test(qv)) {
    for (const col of headersS) {
      if (_estNumerique(table, col)) continue;
      const vals = _distinctValues(table, col);
      if (vals.length > 5000) continue;
      const occ = [];
      vals.forEach(v => { const n = normalizeText(v); if (n.length < 3) return; const m = new RegExp(`(^| )${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?= |$)`).exec(qv); if (m) occ.push({ v, n, d: m.index + m[1].length, f: m.index + m[1].length + n.length }); });
      if (occ.length < 3) continue;
      occ.sort((x, y) => x.d - y.d || y.n.length - x.n.length);
      const lien = /^ (?:, |, et |, ou |et |ou )(?:(?:de|d|du|des|la|le|l|en|a|au|aux) )*$/;
      let chaine = [occ[0]], best = [];
      for (let i = 1; i < occ.length; i++) {
        const o = occ[i], last = chaine[chaine.length - 1];
        if (o.d < last.f) continue; // chevauchement (« Paris » dans « Paris 11e… »)
        if (lien.test(qv.slice(last.f, o.d) + (qv.slice(last.f, o.d).endsWith(' ') ? '' : ' '))) chaine.push(o);
        else { if (chaine.length > best.length) best = chaine; chaine = [o]; }
      }
      if (chaine.length > best.length) best = chaine;
      if (best.length >= 3 && qv.slice(best[0].d, best[best.length - 1].f).includes(' , ')) {
        enums.push({ col, best });
      }
    }
    // mêmes valeurs dans deux colonnes (académie ET commune de Bordeaux, Toulouse, Poitiers) : le mot de la question
    // (« académies », « départements »…) tranche ; sinon académie > département > région > commune
    const rang = c => { const h = _hx(c); const mot = [['academi', /academi/], ['departement', /departement/], ['region', /region/], ['commune', /commune|ville/]].findIndex(([m, re]) => re.test(h) && new RegExp(m === 'commune' ? '\\b(communes?|villes?)\\b' : `\\b${m}`).test(qv)); return mot >= 0 ? mot - 10 : [/academi/, /departement/, /region/, /commune|ville/].findIndex(re => re.test(h)); };
    // fichier de candidats : commune d'accueil ou de scolarité (« admis à… » : accueil ; « de… », « lycées de… » : scolarité)
    const _roleE = c => (typeof plannerColumnRole === 'function') ? plannerColumnRole(c) : {};
    const rangRole = e => { const r = _roleE(e.col); if (!r.accueil && !r.origine) return 0; const avant = qv.slice(0, e.best[0].d); const acc = (_VERBE_ACCUEIL_RE.test(qv) || / a $/.test(avant)) && !/venant|issus?|originaires?|provenant|scolaris|origine|lycees?/.test(qv); return (acc ? r.accueil : r.origine) ? 0 : 0.5; };
    const parValeurs = new Map();
    enums.forEach(e => { const k = e.best.map(o => o.n).join('|'); if (!parValeurs.has(k) || rang(e.col) + rangRole(e) < rang(parValeurs.get(k).col) + rangRole(parValeurs.get(k))) parValeurs.set(k, e); });
    parValeurs.forEach(({ col, best }) => {
      const ns = new Set(best.map(o => o.n));
      for (let i = out.length - 1; i >= 0; i--) if (out[i].col === col || ((out[i].op || 'eq') === 'eq' && ns.has(normalizeText(out[i].value)))) out.splice(i, 1);
      out.push({ col, op: 'in', values: best.map(o => o.n), value: best.map(o => o.v).join(', '), label: best.map(o => o.v).join(', '), source: 'enumeration' });
    });
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
  // v27.5.53 — mot d'intitulé déjà traduit par un filtre exact (« agricoles » → Ministère = Agriculture) : retiré
  const _pref = w => w.slice(0, 5);
  const _motsStrict = new Set(strict.filter(f => f.source !== 'specialite_lycee').flatMap(f => normalizeText(f.value).split(/[^a-z0-9]+/).filter(w => w.length >= 5).map(_pref)));
  // v27.5.64 — « BTS, BUT et CPGE » : valeurs d'une énumération, pas des mots à réunir dans un même intitulé
  const _motsEnum = new Set(strict.filter(f => f.source === 'enumeration').flatMap(f => f.values.flatMap(v => v.split(' '))));
  plan.filters = (plan.filters || []).filter(f => {
    if (!(f && f.op === 'contains_all' && f.source === 'termes_formation')) return true;
    const i = (f.terms || []).map((t, k) => ({ t, l: String(f.label || '').split(' + ')[k] })).filter(x => ![].concat(x.t).some(w => (w.length >= 5 && _motsStrict.has(_pref(w))) || _motsEnum.has(normalizeText(w))));
    if (i.length === (f.terms || []).length) return true;
    if (!i.length) return false;
    Object.assign(f, { terms: i.map(x => x.t), label: i.map(x => x.l).join(' + '), value: i.map(x => x.l).join(' + ') });
    return true;
  });
  // v27.5.53 — « lycées de Bordeaux » : la commune de scolarité remplace l'académie (d'accueil) = Bordeaux lue dans le même mot
  const _communes = new Set(strict.filter(f => f.source === 'commune_a').map(f => normalizeText(f.value)));
  const _aca = f => f && f.op === 'eq' && /acad[eé]mi/.test(_hx(f.col)) && _communes.has(normalizeText(f.value)) && !/\bacademi/.test(q);
  const _ensMots = _specialitesLycee(plan.table, q).mots;
  const _qHors = new Set(_horsSpecialitesLycee(plan.table, q).split(' '));
  const _formCols = new Set(formationTermsInfo(plan.table).cols);
  const _colsLycee = new Set(_colonnesLycee(plan.table).cols);
  const _matiere = f => f && f.op === 'eq' && _ensMots.size && ((_formCols.has(f.col) && normalizeText(f.value).split(' ').every(w => _ensMots.has(w) && !_qHors.has(w))) || _colsLycee.has(f.col));
  const _valsEnum = new Set(strict.filter(f => f.source === 'enumeration').flatMap(f => f.values));
  const _dansEnum = f => f && f.op === 'eq' && _valsEnum.has(normalizeText(f.value)); // v27.5.64 — Bordeaux lu ailleurs
  const base = (plan.filters || []).filter(f => !strictCols.has(f.col) && !_aca(f) && !_matiere(f) && !_dansEnum(f));
  plan.filters = mergeFiltersUnique(base, strict);
  plan.mentionedCols = Array.from(new Set([...(plan.mentionedCols || []), ...strict.map(f => f.col)]));
  return plan;
}

// v27.5.66 — relance « et à Pau ? » après « les BUT des Landes » : un nouveau lieu (même rôle : accueil, origine, ou
// lieu de la formation) remplace le lieu précédent, quel que soit son niveau (avant : Landes ET Pau, 0 formation)
function _roleLieu(col) {
  const h = _hx(col || '');
  if (!/acad[eé]mi|departement|region|commune|ville/.test(h) || /code|insee|postal/.test(h)) return null;
  const r = (typeof plannerColumnRole === 'function') ? plannerColumnRole(col) : {};
  return r.accueil ? 'acc' : r.origine ? 'ori' : 'lieu';
}
function _lieuRemplacePar(f, nouveaux) {
  const r = f && f.op !== 'neq' && _roleLieu(f.col);
  return !!r && (nouveaux || []).some(n => n && n.op !== 'neq' && n.col !== f.col && _roleLieu(n.col) === r);
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

    // v27.25 — après une moyenne (« taux d'accès moyen des BTS »), « et par académie ? » / « et pour les CPGE ? »
    // gardent la mesure (avant : nombre de formations par académie, ou arrêt)
    const _prevStats = prev.tool === 'stats' || prev.tool === 'stats_groupes';
    if (dimensionFollowUp && _prevStats) {
      plan.tool = 'stats'; plan.statsCol = prev.statsCol || prev.targetCol; plan.statsDemandee = prev.statsDemandee;
    } else if (dimensionFollowUp && prev.tool === 'part' && prev.part) {
      // v27.5.54 — « taux de proposition des boursiers » puis « et par département ? » : le taux dans chaque département
      // (avant : la répartition des boursiers entre départements)
      const g = _dimensionPart(plan.table || prev.table, question);
      if (g) { plan.tool = 'part'; plan.part = { ...prev.part, groupe: g }; plan.targetCol = null; }
      else plan.tool = 'group_by';
    } else if (dimensionFollowUp && (prev.tool === 'sum' || prev.groupSumCol)) {
      // « combien de places en BTS » puis « et par académie ? » : places par académie (somme), pas des formations
      plan.tool = 'group_by'; plan.groupSumCol = prev.groupSumCol || prev.sumCol; plan.sumUnit = prev.sumUnit;
    } else if (dimensionFollowUp) {
      plan.tool = 'group_by';
      if (!plan.targetCol && prev.targetCol && !plan.dimensionIntrouvable) plan.targetCol = prev.targetCol;
    } else if (filterFollowUp && (RELANCE_SOUS_ENSEMBLE.test(q) || RELANCE_MESURE_SEULE.test(q)) && !['compare'].includes(prev.tool)) {
      // v27.5.56 — sous-population : les filtres précédents + ceux de cette question ; l'outil est celui de la question
      const _strict = strictFiltersFromQuestion(plan.table, question);
      const _colsNouvelles = new Set([..._strict, ..._filtresPlanner].filter(f => f && f.op !== 'contains_all').map(f => f.col));
      const _prevGardes = prevKept.filter(f => !(f && f.op !== 'contains_all' && _colsNouvelles.has(f.col)) && !_lieuRemplacePar(f, [..._strict, ..._filtresPlanner]));
      plan.filters = mergeFiltersUnique(mergeFiltersUnique(_prevGardes, _strict), _filtresPlanner);
      plan.sousEnsemble = true;
    } else if (filterFollowUp && RELANCE_LISTE.test(q)) {
      // v27.5.60 — « donne-moi la liste » : les lignes de la question précédente, par établissement (ou par intitulé
      // si « la liste des formations ») ; aucun filtre perdu
      const t = plan.table || prev.table;
      const veutFormations = /\b(formations?|intitules?)\b/.test(q);
      const etab = _colEtablissement(t) || _colEtablissementQuestion(t, q, q.length);
      plan.filters = mergeFiltersUnique(prevKept, strictFiltersFromQuestion(t, question));
      plan.tool = 'group_by'; plan.lesquelles = true; plan.limit = 300;
      plan.targetCol = veutFormations ? (pickListColumn(t, plan.filters) || prev.targetCol) : (etab || pickListColumn(t, plan.filters) || prev.targetCol);
      if (veutFormations) plan.listMode = true;
    } else if (filterFollowUp && RELANCE_LESQUELS.test(q)) {
      // « lesquelles sont à Bordeaux ? » : les formations retenues, détaillées par établissement
      const etab = _colEtablissement(plan.table || prev.table);
      plan.tool = 'group_by'; plan.targetCol = etab || prev.targetCol; plan.limit = 50; plan.lesquelles = true;
    } else if (filterFollowUp && _prevStats) {
      plan.tool = 'stats'; plan.statsCol = prev.statsCol || prev.targetCol; plan.statsDim = prev.statsDim; plan.statsDemandee = prev.statsDemandee;
      // filtres : comme toute relance de filtre (« et pour les CPGE ? » remplace BTS)
      const _strict = strictFiltersFromQuestion(plan.table, question);
      const _colsNouvelles = new Set([..._strict, ..._filtresPlanner].filter(f => f && f.op !== 'contains_all').map(f => f.col));
      const _prevGardes = prevKept.filter(f => !(f && f.op !== 'contains_all' && _colsNouvelles.has(f.col)) && !_lieuRemplacePar(f, [..._strict, ..._filtresPlanner]));
      plan.filters = mergeFiltersUnique(mergeFiltersUnique(_prevGardes, _strict), _filtresPlanner);
    } else if (filterFollowUp) {
      plan.tool = prev.tool || plan.tool;
      if (prev.tool === 'classement' && prev.classement && !plan.classement) plan.classement = prev.classement; // « et à Bordeaux ? »
      if (prev.tool === 'part' && prev.part && !plan.part) plan.part = prev.part;
      // v27.5.65 — « nombre de places en BTS » puis « et en BUT ? » : la colonne additionnée est reprise
      // (avant : somme d'aucune colonne, « 0 place » affiché comme exact)
      if (prev.tool === 'sum' && prev.sumCol && !plan.sumCol) { plan.sumCol = prev.sumCol; plan.sumUnit = prev.sumUnit; }
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
        const _prevGardes = prevKept.filter(f => !(f && f.op !== 'contains_all' && _colsNouvelles.has(f.col)) && !_lieuRemplacePar(f, [..._strict, ..._filtresPlanner]));
        plan.filters = mergeFiltersUnique(mergeFiltersUnique(_prevGardes, _strict), _filtresPlanner);
      }
    }

    // v27.5.64 — « et de Bayonne ? » / « et à Bayonne ? » après « candidats de Pau » : le lieu change de VALEUR dans la
    // même colonne (commune de scolarité). Avant : « et de Bayonne » n'était pas lu (chiffre de Pau redonné) et
    // « et à Bayonne » cumulait Pau (scolarité) et Bayonne (accueil), 55 au lieu de 1 494.
    if (filterFollowUp && !plan.sousEnsemble && !RELANCE_LISTE.test(q)) {
      const _m = q.match(/^et (?:pour |a |au |aux |en |dans |de |du |des |d |sur |chez )?(?:la |le |l |les )?(?:(?:commune|ville|academie|departement|region|lycee|etablissement) (?:de |d |du |des )?(?:la |le |l )?)?([a-z0-9][a-z0-9 \-']*?)\s*\??$/);
      const _lieu = c => /commune|ville|acad[eé]mi|d[eé]partement|r[eé]gion/.test(_hx(c)) && !/code|insee|postal/.test(_hx(c));
      if (_m) {
        const x = _m[1].trim();
        const tbl = plan.table || prev.table;
        const cible = previousFilters.find(f => f && f.op === 'eq' && _lieu(f.col) && _distinctValues(tbl, f.col).some(v => normalizeText(v) === x));
        if (cible) {
          const v = _distinctValues(tbl, cible.col).find(v => normalizeText(v) === x);
          const autres = (plan.filters || []).filter(f => !(f && _lieu(f.col)) && !previousFilters.some(p => _cleFiltre(p) === _cleFiltre(f)));
          plan.filters = mergeFiltersUnique(previousFilters.map(f => f === cible ? { ...f, value: v, label: null } : f), autres);
          plan.lieuRemplace = cible.col; // le lieu lu dans la question n'est pas relu ailleurs (sanitize)
        }
      }
    }
    // v27.5.68 — « combien de BTS en 2024 » puis « et en Gironde ? » : toujours la session 2024 (avant : 2025, sans le dire)
    if (prev.sessionUnique && !plan.sessionsDemandees && !RELANCE_SESSION.test(q) && plan.table && !sessionsDeLaQuestion(plan.table, question)) {
      plan.sessionsDemandees = { mode: 'seule', sessions: [prev.sessionUnique], courante: Number(plan.table.session) };
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
  moyen moyens moyenne moyennes mediane minimum maximum existe existent propose proposes proposee proposees disponible disponibles
  ouvert ouverte ouvertes ouverts parcoursup open data donnees base jeu fichier table colonne colonnes ligne lignes
  non pas ne ni aucun aucune selective selectives selectif selectifs selection selectivite apprenti apprentis apprentie apprenties
  apprentissage alternance candidate candidates boursiere boursieres
  augmente augmentee augmentes augmentees augmenter augmentation depuis evolution evolue evoluer diminue diminution baisse hausse
  progression progresse recul variation compare comparee comparaison rapport relativement dernier derniere passe passee precedente
  svp merci peux pouvez voudrais aimerais veux montre montrer affiche afficher selective selectives selectif selectifs
  demande demandes demandee demandees exporte exporter export excel csv superieur superieure inferieur inferieure egal
  bonjour bonsoir salut pourriez pourrais pourrait pourrions voudrais voudrait voudrions aimerais aimerait souhaiterais souhaite souhaiterait
  savoir connaitre dire indiquer indiquez preciser precisez aider aide besoin cherche chercher trouver plait sil please
  est-ce estce y-a-t-il connais sais
  situe situee situes situees localise localisee localises localisees implante implantee implantes implantees trouve trouvent
  lesquelles lesquels laquelle lequel elles ils
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
  let cols = headers.filter(h => textual(h) && !NOT_FORMATION_COL_RE.test(_hx(h)) && (FORMATION_COL_RE.test(_hx(h)) || parContenu(h)));
  // v27.5.53 — fichier de candidats : « candidats en droit » vise la formation d'ACCUEIL. Les colonnes qui décrivent
  // le lycée du candidat (« Spécialité » de bac pro, « Enseignement(s) de spécialité suivi(s) » : « Droit et Economie »)
  // ne sont plus fouillées dès qu'une colonne de formation d'accueil existe (avant : 5 301 « en droit » au lieu de 1 987)
  const _accueil = cols.filter(h => /accueil|accepte|affecte|affectation|admis/.test(_hx(h)));
  if (_accueil.length) cols = _accueil;
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
  let q = normalizeText(question || '');
  const covered = new Set();
  (otherFilters || []).forEach(f => normalizeText(f.value).split(' ').forEach(w => covered.add(w)));
  // Mots qui suivent « option / mention / spécialité / parcours » : toujours cherchés, signalés s'ils sont introuvables
  const forced = new Set();
  const reOpt = /\b(?:option|options|mention|mentions|specialite|specialites|parcours)\s+(?:(?:de|d|en|du|des|la|le|l)\s+)?([a-z0-9]{3,})/g;
  let m;
  const _ens = new Set(); // v27.5.54 — les mots des spécialités du lycée sont retirés de la question, pas ignorés partout
  q = _horsSpecialitesLycee(table, q);
  while ((m = reOpt.exec(q))) if (!FORMATION_TERM_STOP.has(m[1]) && !_ens.has(m[1])) forced.add(m[1]);
  const originals = String(question || '').split(/[^A-Za-zÀ-ÿ0-9œŒæÆ]+/).filter(Boolean);
  const labelFor = tok => originals.find(w => normalizeText(w) === tok) || tok;
  // v27.5.53 — mot d'un nom de colonne cité avec un autre mot de ce nom (« par académie d'accueil ») : la colonne, pas un
  // mot d'intitulé (avant : « répartition par académie d'accueil » ne gardait que 13 lignes dont l'intitulé contient « accueil »)
  const _motsQ = new Set(q.split(' '));
  const _deColonne = new Set();
  (table.headers || []).forEach(h => {
    const mots = normalizeText(h).split(/[^a-z0-9]+/).filter(w => w.length >= 4);
    const _dansQ = w => _motsQ.has(w) || _motsQ.has(w + 's') || _motsQ.has(w + 'x');
    if (mots.filter(_dansQ).length >= 2) mots.forEach(w => { _deColonne.add(w); _deColonne.add(w + 's'); });
  });
  q.split(' ').forEach(tok => {
    if (tok.length < 3 || /^\d+$/.test(tok) || FORMATION_TERM_STOP.has(tok) || covered.has(tok)) return;
    if (_deColonne.has(tok) && !forced.has(tok)) return;
    if (_ens.has(tok)) return; // « spécialité SES / maths » au lycée : pas une formation d'accueil
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
  // v27.5.55 — filtre du planner sur une formation d'accueil lu dans une spécialité du lycée (« spécialité
  // physique-chimie admis en chimie » → mention « Physique, chimie ») : retiré, seuls les mots hors spécialité comptent
  const _spl = _specialitesLycee(plan.table, normalizeText(plan.question || ''));
  if (_spl.filtres.length) {
    const hors = new Set(_horsSpecialitesLycee(plan.table, normalizeText(plan.question || '')).split(' '));
    plan.filters = (plan.filters || []).filter(f => !(f && f.op === 'eq' && formCols.has(f.col) && normalizeText(f.value).split(' ').some(w => _spl.mots.has(w) && !hors.has(w))));
  }
  const isFormationFilter = f => f && f.source !== 'categorie_formation' && (f.source === 'termes_formation' || (formCols.has(f.col) && f.op !== 'neq'));
  const others = (plan.filters || []).filter(f => !isFormationFilter(f));
  const found = formationTermsFromQuestion(plan.table, plan.question, others);
  if (found.missing.length) plan.unresolvedTerms = found.missing;
  if (!found.terms.length) return plan;
  const formFilters = (plan.filters || []).filter(f => isFormationFilter(f) && f.source !== 'termes_formation');
  const coveredByPlanner = formFilters.length && found.terms.every(t => formFilters.some(f => normalizeText(f.value).split(' ').some(w => t.includes(w))));
  if (coveredByPlanner) return plan;
  // v27.5.53 — mot déjà traduit par un filtre du planner sur une catégorie (« licence » → « L1 - CUPGE - DEUST - DU »,
  // « BUT » → « DUT », « prépa » → « CPGE - CPES ») : ce n'est plus un mot d'intitulé à chercher en plus
  // (avant : « licence de droit » cherchait « licence » ET « droit » dans les intitulés → 0, critère non trouvé)
  for (let i = found.terms.length - 1; i >= 0; i--) {
    if (formFilters.some(f => f.op === 'eq' && _categorieTraduite(found.terms[i], f.value))) { found.terms.splice(i, 1); found.labels.splice(i, 1); }
  }
  if (!found.terms.length) return plan;
  // v27.22 — « licences de droit / STAPS » : « licence » est une catégorie officielle (Filière très agrégée = Licence),
  // distincte de « Licence_Las » (LAS, licences accès santé). Par l'intitulé, les LAS étaient comptées aussi
  // (licences STAPS : 134 au lieu de 93), alors que « combien de licences » les exclut. Quand plusieurs valeurs de la
  // catégorie contiennent le mot, on filtre sur la valeur exacte, et la note du périmètre dit ce qui est laissé de côté.
  // second passage (relance, nettoyage) : la catégorie déjà choisie est gardée, son mot n'est plus un mot d'intitulé
  let catFilter = (plan.filters || []).find(f => f && f.source === 'categorie_formation') || null;
  if (catFilter) {
    const cv = normalizeText(catFilter.value);
    const i = found.terms.findIndex(t => t.some(w => w === cv || w.replace(/s$/, '') === cv));
    if (i >= 0) { found.terms.splice(i, 1); found.labels.splice(i, 1); }
  } else if (found.terms.length > 1) {
    const cat = _colonneCategories(plan.table, info);
    // un filtre du planner sur cette colonne (« Licence ») n'empêche pas : il sera remplacé par le filtre de catégorie
    const surCat = (plan.filters || []).filter(f => f && f.col === cat);
    if (cat && surCat.every(f => f.op === 'eq')) {
      const valeurs = new Map();
      (plan.table.objects || []).forEach(r => { const v = r?.[cat]; if (v !== undefined && v !== null && String(v).trim()) valeurs.set(normalizeText(v), String(v).trim()); });
      for (let i = 0; i < found.terms.length; i++) {
        const formes = found.terms[i].flatMap(w => [w, w.replace(/s$/, '')]);
        const exacte = formes.find(w => valeurs.has(w));
        if (!exacte) continue;
        // « Licence_Las » : le tiret bas sépare aussi les mots
        const autres = [...valeurs.entries()].filter(([k]) => k !== exacte && formes.some(w => k.split(/[^a-z0-9]+/).includes(w))).map(([, v]) => v);
        if (!autres.length) continue; // une seule valeur porte ce mot (BTS, PASS) : rien d'ambigu, on garde l'intitulé
        if (surCat.some(f => normalizeText(f.value) !== exacte)) break; // le planner a choisi une autre catégorie : on n'y touche pas
        catFilter = { col: cat, op: 'eq', value: valeurs.get(exacte), label: valeurs.get(exacte), source: 'categorie_formation' };
        plan.filters = (plan.filters || []).filter(f => !surCat.includes(f));
        plan.categorieExclue = { col: cat, valeur: valeurs.get(exacte), mot: found.labels[i], autres };
        found.terms.splice(i, 1); found.labels.splice(i, 1);
        break;
      }
    }
  }
  // v27.5.53 — un seul mot, qui désigne une seule grande catégorie (« écoles d'ingénieurs » → « Formations d'ingénieurs ») :
  // la catégorie, pas tout intitulé contenant le mot (avant : + licences « Sciences pour l'ingénieur », BTS « Assistance
  // technique d'ingénieur » : 1 158 au lieu de 1 050)
  // (« écoles d'ingénieurs » : « écoles » est un mot générique, laissé de côté s'il n'apparaît pas dans cette catégorie)
  const _GENERIQUES = new Set(['ecole', 'ecoles', 'formation', 'formations', 'etablissement', 'etablissements', 'cursus', 'filiere', 'filieres']);
  if (!catFilter && found.terms.length >= 1 && found.terms.length <= 2 && !(plan.filters || []).some(f => f && formCols.has(f.col) && f.op === 'eq')) {
    const cat = _colonneCategories(plan.table, info);
    if (cat) {
      const valeurs = new Map();
      (plan.table.objects || []).forEach(r => { const v = r?.[cat]; if (v !== undefined && v !== null && String(v).trim()) valeurs.set(normalizeText(v), String(v).trim()); });
      for (let i = 0; i < found.terms.length; i++) {
        const formes = found.terms[i];
        if (formes.some(w => _GENERIQUES.has(w))) continue;
        const porteuses = [...valeurs.entries()].filter(([k]) => formes.some(w => k.split(/[^a-z0-9]+/).includes(w)));
        if (porteuses.length !== 1) continue;
        // seulement si le mot apparaît aussi hors de cette catégorie (sinon rien ne change : « PASS »)
        const _f = makeFormationTermsFilter(plan.table, [formes], [found.labels[i]]);
        const _cat = normalizeText(porteuses[0][1]);
        if (!(plan.table.objects || []).some(r => normalizeText(r?.[cat]) !== _cat && applyLocalActionFilters([r], [_f]).length)) continue;
        // les autres mots : gardés s'ils existent dans cette catégorie ; un mot générique absent est laissé de côté
        const dansCat = (plan.table.objects || []).filter(r => normalizeText(r?.[cat]) === _cat);
        const autres = found.terms.map((t, k) => ({ t, l: found.labels[k], k })).filter(x => x.k !== i);
        const garder = autres.filter(x => !x.t.some(w => _GENERIQUES.has(w)) || dansCat.some(r => applyLocalActionFilters([r], [makeFormationTermsFilter(plan.table, [x.t], [x.l])]).length));
        if (garder.length && found.terms.length > 1 && garder.length === autres.length) continue; // deux vrais mots : règle habituelle
        catFilter = { col: cat, op: 'eq', value: porteuses[0][1], label: porteuses[0][1], source: 'categorie_formation' };
        found.terms = garder.map(x => x.t); found.labels = garder.map(x => x.l);
        break;
      }
    }
  }
  if (catFilter && !found.terms.length) { plan.filters = [...others.filter(f => f !== catFilter), catFilter]; return plan; }
  const filtre = makeFormationTermsFilter(plan.table, found.terms, found.labels);
  // v27.8 — si une seule colonne contient tous les mots, on prend la plus précise (le moins de lignes) :
  // « licences de droit » = « Licence - Droit », pas toute la famille « Licence - Droit, économie, gestion ».
  // Sinon (« CPGE » + « MPSI » dans deux colonnes différentes), on cherche sur toutes les colonnes ensemble.
  // (v27.22 — aussi quand la catégorie a remplacé l'un des mots : « licences de droit » = Licence + « droit » dans la colonne précise)
  if (found.terms.length > 1 || catFilter) {
    let meilleure = null;
    const objets = _lignesAvecFormation(catFilter ? applyLocalActionFilters(plan.table.objects || [], [catFilter]) : (plan.table.objects || []), info.cols);
    // seulement les colonnes remplies (≥ 80 % des lignes) : une colonne presque vide (« très détaillée »)
    // ne contient les deux mots que pour quelques lignes et donnerait un compte trop petit
    const remplie = c => objets.filter(r => String(r?.[c] ?? '').trim() !== '').length >= objets.length * 0.8;
    info.cols.filter(remplie).forEach(c => {
      const n = applyLocalActionFilters(objets, [{ ...filtre, cols: [c] }]).length;
      if (n > 0 && (!meilleure || n < meilleure.n)) meilleure = { c, n };
    });
    if (meilleure) filtre.cols = [meilleure.c];
  }
  plan.filters = [...others.filter(f => f !== catFilter), ...(catFilter ? [catFilter] : []), filtre];
  plan.mentionedCols = Array.from(new Set([...(plan.mentionedCols || []), ...info.cols]));
  return plan;
}
const _CATEGORIES_TRADUITES = [
  [/^licences?$/, /\bl1\b|\blicences?\b/], [/^(but|dut)s?$/, /\b(but|dut)\b|\biut\b/], [/^(prepas?|cpge)$/, /\bcpge\b|prepa/],
  [/^bts$/, /\bbts\b/],
];
function _categorieTraduite(formes, valeur) {
  const v = normalizeText(valeur);
  const motsV = v.split(/[^a-z0-9]+/);
  // le mot écrit tel quel dans la valeur (« Licence », « BTS ») : rien à traduire, les règles habituelles s'appliquent
  if ((formes || []).some(w => motsV.includes(w) || motsV.includes(w.replace(/s$/, '')))) return false;
  return (formes || []).some(w => _CATEGORIES_TRADUITES.some(([mot, val]) => mot.test(w) && val.test(v)));
}
// v27.5.53 — fichier de candidats : les colonnes de formation d'accueil sont vides pour les candidats sans admission
// (35 % des lignes). « Remplie » se juge sur les lignes qui ont une formation, pas sur tout le fichier.
function _lignesAvecFormation(objets, cols) {
  const avec = objets.filter(r => cols.some(c => String(r?.[c] ?? '').trim() !== ''));
  return avec.length ? avec : objets;
}
// Colonne des grandes catégories de formation (BTS, BUT, Licence…) : remplie, le moins de valeurs différentes (≥ 2)
function _colonneCategories(table, info) {
  const objets = _lignesAvecFormation(table.objects || [], info.cols);
  const remplie = c => objets.filter(r => String(r?.[c] ?? '').trim() !== '').length >= objets.length * 0.8;
  const nb = c => new Set(objets.slice(0, 5000).map(r => normalizeText(r?.[c]))).size;
  const cand = info.cols.filter(remplie).map(c => ({ c, n: nb(c) })).filter(x => x.n >= 2 && x.n <= 40).sort((a, b) => a.n - b.n);
  return cand.length ? cand[0].c : null;
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
  // v27.5.60 — « liste des établissements proposant un BTS MCO en Gironde », « quels établissements proposent… » :
  // les établissements, pas les intitulés de formation (avant : « BTS - Services - Management Commercial Opérationnel : 6 »)
  // « quelles académies proposent des PASS » : une ligne par académie (avec le nombre de formations)
  const _lg = !hasExportWords(q) && !CLASSEMENT_CUE.test(q) ? q.match(LISTE_GEO_RE) : null;
  if (_lg) { const g = _colonneGeoObjet(plan.table, _lg[1], q); if (g) { plan.tool = 'group_by'; plan.targetCol = g.col; plan.limit = 300; return plan; } }
  if (!hasExportWords(q) && LISTE_ETAB_RE.test(q) && !CLASSEMENT_CUE.test(q)) {
    const i = q.search(LISTE_ETAB_RE);
    const col = _colEtablissement(plan.table) || _colEtablissementQuestion(plan.table, q, i + q.slice(i).indexOf(q.match(LISTE_ETAB_RE)[1]));
    if (col) { plan.tool = 'group_by'; plan.targetCol = col; plan.limit = 300; plan.lesquelles = true; return plan; }
  }
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
  // v27.5.72 — mesures précises AVANT « admis » / « candidates » (avant : « néo-bacheliers admis en BUT », « bacheliers
  // généraux admis en licence » additionnaient TOUS les admis ; « filles admises » s'arrêtait)
  { re: /\b(?:filles?|candidates?|femmes?)\b.*\badmis(?:es)?\b|\badmises\b/, col: /effectif des candidates admises/, unite: 'candidates admises' },
  { re: /\b(?:bacheliers?|bachelieres?|bac|neo ?bacheliers?)\s+(?:generaux|generales?|general)\b|\bgeneraux\b.*\badmis\b/, col: /admis neo bacheliers generaux/, unite: 'admis néo-bacheliers généraux' },
  { re: /\b(?:bacheliers?|bachelieres?|bac|neo ?bacheliers?)\s+(?:technologiques?|techno)\b/, col: /admis neo bacheliers technologiques/, unite: 'admis néo-bacheliers technologiques' },
  { re: /\b(?:bacheliers?|bachelieres?|bac|neo ?bacheliers?)\s+(?:professionnels?|pro)\b/, col: /admis neo bacheliers professionnels/, unite: 'admis néo-bacheliers professionnels' },
  { re: /\bneo ?bacheliers?\b/, col: /^effectif des admis neo bacheliers$/, unite: 'admis néo-bacheliers' },
  { re: /\bcandidates\b/, col: /effectif des candidates/, unite: 'candidates' },
  { re: /\bboursiers?\b.*\badmis\b|\badmis\b.*\bboursiers?\b/, col: /admis boursiers/, unite: 'admis boursiers' },
  { re: /\badmis(es)?\b|\bont accepte\b/, col: /ayant accepte.*admis/, unite: 'admis' },
  { re: /\bpropositions?\b/, col: /recu une proposition/, unite: 'propositions' },
  { re: /\bcandidats?\b|\bcandidatures?\b|\bvoeux\b/, col: /effectif total des candidats pour une formation/, unite: 'candidats' },
];
// v27.18 — somme d'une colonne par valeur (« places par académie ») ; même forme que topCountsForRows
// (count = la somme du groupe, pct = sa part de la somme totale). Case vide : ligne écartée et comptée.
function sommesParGroupe(rows, col, sumCol) {
  const m = new Map();
  let filled = 0, somme = 0, sansValeur = 0;
  rows.forEach(r => {
    const v = r?.[col];
    if (isEmptyCell(v)) return;
    filled++;
    const x = _nombreCellule(r?.[sumCol]);
    if (x === null) { sansValeur++; return; }
    const k = String(v).trim();
    m.set(k, (m.get(k) || 0) + x);
    somme += x;
  });
  const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'))
    .map(([value, total]) => ({ value, count: Math.round(total * 100) / 100, pct: somme ? total / somme * 100 : 0 }));
  return { filled, distinct: m.size, top, somme: Math.round(somme * 100) / 100, sansValeur };
}
function applyMeasureSum(plan) {
  // v27.5.73 — fichier de candidats : « nombre total de vœux confirmés », « combien de vœux au total » = la somme de la
  // colonne des vœux (avant : le nombre de candidats, 35 286, affiché comme un nombre de vœux)
  if (plan && plan.table && plan.table.rowUnit !== 'formation' && plan.tool === 'count_rows') {
    const qv = normalizeText(plan.question || '');
    if (/^(?:quel est le |quel est |le |la )?(?:nombre total|total|somme|nombre)\s+(?:des |de |d )?voeux\b|^combien (?:de |d )?voeux\b(?!.*\b(?:moyenne|moyen|maximum|minimum|max|min|median|mediane)\b)/.test(qv)) {
      const col = (plan.table.headers || []).find(h => /voeux/.test(normalizeText(h)) && _estNumerique(plan.table, h));
      if (col) { plan.tool = 'sum'; plan.sumCol = col; plan.sumUnit = 'vœux'; return plan; }
      plan.mesureIntrouvable = 'vœux'; return plan;
    }
  }
  if (!plan || !plan.table || plan.table.rowUnit !== 'formation') return plan;
  // v27.18 — répartition (« places en BTS par académie ») : somme par groupe, pas le nombre de formations
  // (avant : « Paris : 315 » = 315 formations, affiché comme des places)
  const groupe = ['group_by', 'top', 'pivot'].includes(plan.tool) && !plan.listMode;
  if (plan.tool !== 'count_rows' && !groupe) return plan;
  // v27.14 — le mot d'une condition chiffrée (« avec au plus 30 admis ») n'est pas la mesure demandée
  const q = normalizeText(plan.question || '').replace(/\b(plus de|moins de|au moins|au plus)\s+\d+(?:[.,]\d+)?\s*%?\s*(places?|candidats?|admis|voeux|boursiers?)\b/g, ' ')
    .replace(/\b(?:aucun|aucune|sans|pas de|pas d|zero|0)\s+(places?|candidats?|candidatures?|admis|voeux|voeu)\b/g, ' ');
  if (/\b(combien|nombre|repartition|ventilation) d(e|es)? ?(formations?|filieres?|offres?|etablissements?)\b/.test(q)) return plan;
  const headers = plan.table.headers || [];
  for (const m of MESURES_SOMME) {
    if (!m.re.test(q)) continue;
    const col = headers.find(h => m.col.test(normalizeText(h)));
    // v27.12 — mesure demandée (admis, places…) sans colonne correspondante : on s'arrête,
    // au lieu de compter des formations (« combien d'admis en BTS » répondait le nombre de BTS)
    if (!col) { plan.mesureIntrouvable = m.unite; return plan; }
    if (groupe) {
      if (col === plan.targetCol || col === plan.targetCol2) return plan; // « répartition par capacité » : la dimension, pas la mesure
      if (plan.tool === 'pivot') { plan.mesurePivot = m.unite; return plan; }
      plan.groupSumCol = col;
      plan.sumUnit = m.unite;
      return plan;
    }
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
  { re: /etablissements?|lycees?|universites?|ecoles?/, col: h => /^etablissement( d accueil)?$|^etablissement\b/.test(h) && !/code|uai|statut|academie|commune|departement|region/.test(h), nom: 'établissements' },
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
    const sujet = q.match(/(?:^|\b(?:les|quel(?:le)?s?|top\s*\d*\s*(?:des)?|classement des)\s+(?:\d+\s+)?)(academies?|regions?|departements?|communes?|villes?|etablissements?|lycees?|universites?|ecoles?)\b(?!\s+(?:de|d|du|des)\s(?!accueil|scolarite|origine))/);
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
  const sujet = q.match(/(?:^|\b(?:les|quel(?:le)?s?|top\s*\d*\s*(?:des)?|classement des)\s+(?:\d+\s+)?)(academies?|regions?|departements?|communes?|villes?|etablissements?|lycees?|universites?|ecoles?)\b(?!\s+(?:de|d|du|des)\s(?!accueil|scolarite|origine))/);
  // (« quels lycées proposent le plus de BTS » : le nombre de lignes retenues par le filtre BTS, par lycée)
  // v27.5.70 — « quel département a le moins de licences » : classement croissant, groupes à zéro compris
  const moins = sujet && /\b(le|les) moins (?:de|d) [a-z0-9]{2,}/.test(q) && !/\b(le|les) plus\b/.test(q);
  if (moins) {
    const e = CLASSEMENT_ENTITES.find(x => x.re.test(sujet[1]));
    let ecol = e && headers.find(h => e.col(_hx(h)));
    if (e && e.nom === 'établissements' && !_colEtablissement(table)) ecol = _colEtablissementRole(table, /\b(accueill\w*|d accueil)\b/.test(q) || /^(universites?|iut|ecoles?)$/.test(sujet[1]) ? 'accueil' : 'origine') || ecol;
    const n = (q.match(/\b(?:top|les|des)\s+(\d{1,3})\b/) || [])[1];
    if (ecol) return { frequence: true, croissant: true, entite: { col: ecol, nom: e.nom }, limit: n ? Math.min(Number(n), 100) : 10, mot: /\b(formations?|lignes?|candidats?|eleves|dossiers?)\b/ };
  }
  if (sujet && /\b(le|les) plus (?:de|d) (formations?|lignes?|candidats?|eleves|dossiers?|bacheliers?|boursiers?|admis|apprentis|[a-z0-9]{2,})\b|\b(le|les) plus (nombreu|represente|frequent)/.test(q)) { // v27.5.70 — « le plus d'admis »
    const e = CLASSEMENT_ENTITES.find(x => x.re.test(sujet[1]));
    // v27.5.56 — fichier de candidats : lycée de scolarité ou établissement d'accueil (« les universités qui accueillent… »)
    let ecol = e && headers.find(h => e.col(_hx(h)));
    if (e && e.nom === 'établissements' && !_colEtablissement(table)) {
      // l'établissement qui accueille (« qui accueillent », « d'accueil », universités…), pas « des candidats admis »
      // (« quel lycée a le plus de candidats admis en CPGE » = le lycée d'origine de ces candidats)
      // v27.5.65 — le mot SUJET décide (« quels lycées envoient le plus de candidats en école de commerce » : les lycées
      // d'origine ; avant, « école » ailleurs dans la phrase faisait classer les écoles d'accueil)
      const versAccueil = (/\b(accueill\w*|d accueil|admettent|recrut\w*)\b/.test(q) || /^(universites?|iut|ecoles?)$/.test(sujet[1])) && !/\b(scolarite|origine|lycees? d origine|envoi\w*|envoy\w*)\b/.test(q);
      ecol = _colEtablissementRole(table, versAccueil ? 'accueil' : 'origine') || ecol;
    }
    const n = (q.match(/\b(?:top|les|des)\s+(\d{1,3})\b/) || [])[1];
    if (ecol) return { frequence: true, entite: { col: ecol, nom: e.nom }, limit: n ? Math.min(Number(n), 100) : 10, mot: /\b(formations?|lignes?|candidats?|eleves|dossiers?)\b/ };
  }
  return null;
}
// v27.5.78 — « quels lycées ont le plus fort taux de boursiers », « quelle académie a le plus fort pourcentage de
// boursiers », « classement des lycées par taux de proposition », « le taux … le plus bas » : un TAUX calculé dans chaque
// groupe, puis classé (avant : un seul taux global, « Oui / Non », ou un nombre présenté comme un taux)
const _ENTITES_TAUX = /\b(lycees?|etablissements?|universites?|departements?|academies?|regions?|communes?|villes?|series?|filieres?)\b/;
const _TAUX_MOTS = /\b(taux|pourcentage|part|proportion)\b/;
function _classementParTaux(table, question) {
  const q = normalizeText(String(question || '').replace(/%/g, ' pourcentage '));
  if (!_TAUX_MOTS.test(q) || /\btaux d ?acces\b/.test(q)) return null;
  const sup = /\b(?:le|la|les)\s+(?:plus|moins)\s+(?:fort|forte|forts|fortes|eleve|elevee|eleves|elevees|haut|haute|bas|basse|faible|faibles|grand|grande)\b|\b(?:meilleur|meilleure|meilleurs|meilleures|pire|pires)\b|\bclassement\b|\bclasse[rz]?\b|\btop\s*\d*\b|\b(?:le|la)\s+plus\s+(?:bas|basse|faible)\b/;
  if (!sup.test(q)) return null;
  const ent = q.match(_ENTITES_TAUX);
  if (!ent) return null;
  const mot = ent[1];
  const col = _colonneDimension(table, `par ${mot}`);
  if (!col) return null;
  const tauxM = q.match(/\b(?:taux|pourcentage|part|proportion)\b.*$/);
  if (!tauxM) return null;
  // la phrase du taux sans les superlatifs ni le sujet (« taux de boursiers », « taux de proposition des boursiers »)
  let phrase = tauxM[0].replace(/\b(?:le|la|les)\s+(?:plus|moins)\s+(?:fort|forte|forts|fortes|eleve|elevee|eleves|elevees|haut|haute|bas|basse|faible|faibles|grand|grande)\b/g, ' ')
    .replace(/\b(?:meilleur|meilleure|meilleurs|meilleures|pire|pires)\b/g, ' ').replace(new RegExp(`\\b(?:les |des |par )?${mot}\\b`, 'g'), ' ').replace(/\s+/g, ' ').trim();
  const croissant = /\b(?:plus|moins)\s+(?:bas|basse|faible|faibles)\b|\bmoins\s+(?:fort|forte|eleve|elevee|haut|haute)\b|\bpires?\b/.test(q);
  const n = (q.match(/\b(?:top|les|des)\s+(\d{1,3})\b/) || [])[1];
  return { col, phrase, croissant, limit: n ? Math.min(Number(n), 100) : null };
}
function applyClassement(plan) {
  if (plan && plan.table && !['compare', 'chart_current', 'export_current_excel', 'export_current_csv', 'export_excel', 'export_csv'].includes(plan.tool)) {
    const ct = _classementParTaux(plan.table, plan.question);
    if (ct) { plan._classementTaux = ct; plan.tool = 'count_rows'; plan.targetCol = null; return plan; }
  }
  if (!plan || !plan.table || ['compare', 'chart_current', 'export_current_excel', 'export_current_csv', 'export_excel', 'export_csv'].includes(plan.tool)) return plan;
  const c = detecterClassement(plan.table, plan.question);
  if (!c) return plan;
  if (c.frequence) { plan.tool = 'top'; plan.targetCol = c.entite.col; plan.limit = c.limit; if (c.croissant) plan.croissant = true; return plan; }
  // v27.5.73 — « quel lycée a le plus de vœux EN MOYENNE », « quelle académie a les plus grandes formations en moyenne » :
  // la moyenne par groupe, classée (avant : le TOTAL par groupe, présenté comme le classement demandé)
  if (c.entite && c.col && c.additif && /\ben moyenne\b|\bmoyen(?:ne)?s?\b/.test(normalizeText(plan.question || ''))) {
    plan.tool = 'stats'; plan.statsCol = c.col; plan.statsDim = c.entite.col; plan.statsDemandee = 'avg'; plan.targetCol = c.col;
    return plan;
  }
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
// v27.5.67 — « taux d'accès > 80 % », « ≤ 30 » : les symboles disparaissaient au nettoyage du texte (condition perdue,
// tous les BTS comptés). Ils sont écrits en toutes lettres avant.
function _symbolesEnMots(question) {
  return String(question ?? '').replace(/>=|≥/g, ' superieur ou egal a ').replace(/<=|≤/g, ' inferieur ou egal a ')
    .replace(/>/g, ' superieur a ').replace(/</g, ' inferieur a ');
}
function conditionsChiffrees(table, question) {
  if (!table || !Array.isArray(table.objects) || !table.objects.length) return [];
  const q = normalizeText(_symbolesEnMots(question || ''));
  const headers = (table.headers || Object.keys(table.objects[0] || {})).filter(Boolean);
  const colPour = mot0 => { const mot = mot0 === 'voeu' ? 'voeux' : mot0; for (const m of CLASSEMENT_MESURES) { if (!m.re.test(mot)) continue; const c = headers.find(h => m.col.test(_hx(h)) && _estNumerique(table, h)); if (c) return c; } return null; };
  const opPour = txt => (COMPARATEURS.find(([re]) => re.test(txt)) || [])[1];
  const out = [];
  // 1. « plus de 100 places », « au moins 30 admis », « moins de 50 candidats »
  for (const m of q.matchAll(new RegExp(`\\b(plus de|moins de|au moins|au plus|superieure? ou egale? a|inferieure? ou egale? a|superieure? a|inferieure? a)\\s+(\\d+(?:[.,]\\d+)?)\\s*(?:%\\s*)?(places?|candidats?|admis|voeux|boursiers?)\\b`, 'g'))) {
    const col = colPour(m[3]); const op = opPour(m[1]);
    if (col && op) out.push({ col, op, value: Number(m[2].replace(',', '.')) });
  }
  // 2. « taux d'accès inférieur à 20 % », « capacité supérieure à 50 », « un taux d'accès de 0 »
  for (const m of q.matchAll(new RegExp(`\\b(taux d ?acces|capacites?|nombre de places|nombre de candidats|nombre d admis)\\s+(?:est\\s+|de la formation\\s+)?${_CMP}\\s+(\\d+(?:[.,]\\d+)?)\\s*(?:%|pour ?cent)?`, 'g'))) {
    const col = colPour(/taux/.test(m[1]) ? "taux d acces" : /candidat/.test(m[1]) ? 'candidats' : /admis/.test(m[1]) ? 'admis' : 'places'); const op = opPour(m[2]);
    if (col && op && !out.some(f => f.col === col)) out.push({ col, op, value: Number(m[3].replace(',', '.')) });
  }
  // 2b. v27.5.73 — « entre 5 et 10 vœux », « de 5 à 10 vœux » : bornes comprises (avant : condition perdue, tout le fichier)
  for (const m of q.matchAll(/\b(?:entre|de)\s+(\d+(?:[.,]\d+)?)\s+(?:et|a)\s+(\d+(?:[.,]\d+)?)\s*(?:%\s*)?(places?|candidats?|admis|voeux|boursiers?)\b/g)) {
    const col = colPour(m[3]);
    if (col && !out.some(f => f.col === col)) { out.push({ col, op: 'gte', value: Number(m[1].replace(',', '.')) }); out.push({ col, op: 'lte', value: Number(m[2].replace(',', '.')) }); }
  }
  for (const m of q.matchAll(/\b(?:un seul|une seule|qu un|qu une)\s+(voeu|place|candidat|admis)\b/g)) {
    const col = colPour(m[1]);
    if (col && !out.some(f => f.col === col)) out.push({ col, op: 'eqn', value: 1 });
  }
  // 3. v27.5.72 — « aucun admis », « pas de places », « sans candidat », « 0 vœu » : la valeur vaut 0
  // (avant : « combien de formations n'ont aucun admis » comptait tout ; « BTS n'ayant pas de places » additionnait les places)
  for (const m of q.matchAll(/\b(?:aucun|aucune|sans|pas de|pas d|zero|0)\s+(places?|candidats?|candidatures?|admis|voeux|voeu)\b/g)) {
    const col = colPour(m[1]);
    // colonne sans aucun 0 mais avec des cases vides (« Nb de vœux » vide = aucun vœu confirmé ?) : on ne sait pas, le
    // garde-fou s'arrête et l'explique (pas « 0 » affiché comme exact)
    const objs = table.objects || [];
    const zeroPresent = col && objs.some(r => _nombreCellule(r?.[col]) === 0), videPresent = col && objs.some(r => _nombreCellule(r?.[col]) === null);
    if (col && !zeroPresent && videPresent) continue;
    if (col && !out.some(f => f.col === col)) out.push({ col, op: 'eqn', value: 0, zero: true });
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
  // « combien de BTS n'ayant pas de places » : on compte les formations à 0, on n'additionne pas la colonne
  const zeros = new Set(conds.filter(c => c.zero).map(c => c.col));
  if (zeros.size && plan.tool === 'sum' && (!plan.sumCol || zeros.has(plan.sumCol) || /^(combien|nombre) (de |d )?(formations?|bts|but|licences?|cpge|pass|filieres?)\b/.test(normalizeText(plan.question || '')))) { plan.tool = 'count_rows'; plan.sumCol = null; plan.sumUnit = null; }
  if (zeros.size && plan.groupSumCol && zeros.has(plan.groupSumCol)) { plan.groupSumCol = null; plan.sumUnit = null; }
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
// v27.5.56 — « part des candidats admis en BTS » : « en BTS » fait partie de la condition (admis où ?), pas du périmètre
// (avant : 100 %, les admis en BTS parmi les admis en BTS). « part des formations privées en Gironde » : périmètre.
const _COUPE_PART = /(?<!\b(?:admis|admises|acceptes|acceptees|inscrits|inscrites|affectes|affectees|partis|parties|scolarises|scolarisees|etudient|poursuivent|orientes|orientees|reussi|reussis))\s+(?:en|a|au|aux|dans|sur|chez|pour|de l academie|du departement)\s+/;
const _COUPE_PART_SIMPLE = /\s+(?:en|a|au|aux|dans|sur|chez|pour|de l academie|du departement)\s+/;
// sujet générique (« candidats », « élèves ») : « admis en BTS » est la condition ; sujet précis (« boursiers ») :
// « part des boursiers admis en CPGE » = boursiers parmi les admis en CPGE, comme le pourcentage officiel
function _coupePart(phrase) {
  return /^(candidats?|candidates?|eleves?|lyceens?|lyceennes?|jeunes|bacheliers?|bachelieres?|neo ?bacheliers?)\b/.test(String(phrase || '')) ? _COUPE_PART : _COUPE_PART_SIMPLE;
}
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
  let q = normalizeText(brut.replace(/%/g, ' pourcentage '));
  if (!PART_CUE.test(q) || /\btaux d ?acces\b/.test(q)) return null;
  if (/\b(repartition|ventilation|moyen|moyenne|median|mediane)\b/.test(q)) return null; // répartition en %, moyenne d'une colonne de %
  // v27.5.54 — « pourcentage de candidats sans proposition par département » : un taux DANS chaque département
  // (avant : la répartition des candidats sans proposition entre départements, lue « Gironde : 50 % »)
  let groupe = null;
  // v27.5.56 — « taux de proposition des boursiers et des non boursiers » : un taux pour chaque état (avant : seuls les
  // non-boursiers, le premier filtre étant remplacé par le second)
  const _etats = q.match(/\s*\b(?:des |les |chez les |pour les )?(boursiers|apprentis|basques)\s+et\s+(?:des |les |chez les |pour les )?non[- ]?\1\b/);
  if (_etats) {
    const concept = { boursiers: 'boursier', apprentis: 'apprenti', basques: 'basque' }[_etats[1]];
    const col = findColumnByConceptStrict(table, concept);
    if (col) { groupe = col; q = q.replace(_etats[0], ' ').replace(/\s+/g, ' ').trim(); }
  }
  const PAR_GROUPE = /\s*\bpar (?!rapport\b)(?:type de |grande? )?[a-z0-9]+(?: (?:d|de|du|des|de la|de l) [a-z0-9]+)?/;
  if (!groupe && /\bpar (?!rapport\b|le\b|la\b|les\b|l\b|un\b|une\b|des\b)\w/.test(q)) { // v27.5.71 — « offertes par le privé » : pas un regroupement
    groupe = _dimensionPart(table, brut);
    if (!groupe) return null;
    q = q.replace(PAR_GROUPE, ' ').replace(/\s+/g, ' ').trim();
  }
  const headers = (table.headers || Object.keys(table.objects[0] || {})).filter(Boolean);
  // v27.5.71 — « quelle part des places en BTS est dans le privé », « pourcentage des places de BTS en Gironde » :
  // Σ places (BTS ET privé) ÷ Σ places (BTS). Avant : des formations comptées, et le critère BTS parfois perdu.
  if (table.rowUnit === 'formation' && !groupe) {
    const mq = q.match(/\b(?:part|pourcentage|proportion)\s+(?:des|de|du|d)\s+(places?|candidats?|candidatures?|admis|voeux)\b\s*(.*)$/);
    if (mq) {
      const rest = mq[2].trim();
      const mesure = MESURES_SOMME.find(m => m.re.test(mq[1]) && !/candidates|boursiers|propositions/.test(m.unite));
      const col = mesure && headers.find(h => mesure.col.test(normalizeText(h)) && _estNumerique(table, h));
      let x = null, y = null;
      const m1 = rest.match(/^(.*?)\s*\b(?:qui\s+)?(?:est|sont|se trouvent?|situees?|offertes?|proposees?|relevent)\s+(?:par|dans|en|a|au|aux|du|de|des)?\s*(.+)$/);
      const m2 = rest.match(/^((?:en|de|des|du|d)\s+\S+(?:\s+\S+){0,3}?)\s+((?:en|dans|a|au|aux|hors|sauf)\s+.+)$/);
      if (m1 && m1[2]) { x = m1[1]; y = m1[2]; } else if (m2) { x = m2[1]; y = m2[2]; }
      if (col && y && _filtresDePhrase(table, y.replace(/^(?:le|la|les|l)\s+/, '')).length) {
        return { mode: 'mesure', col, unite: mesure.unite, x: x || '', y: y.replace(/^(?:le|la|les|l)\s+/, ''), phrase: rest, mot: /zzzz/ };
      }
    }
  }
  const phrase = _phrasePart(q);
  if (!phrase) return null;
  // effectifs : seulement si une ligne = une formation et que les deux colonnes existent
  if (table.rowUnit === 'formation' || headers.some(h => /ayant accepte.*admis/.test(_hx(h)))) {
    // le sujet de la part est le début de la phrase (« boursiers », « filles », « candidats admis ») :
    // « la part de l'oral dans l'admission » ne devient pas un taux d'admission
    const sujet = phrase.split(_coupePart(phrase))[0];
    for (const sp of PARTS_EFFECTIFS) {
      const cible = /\btaux d(e)? ?(remplissage|proposition|admission)\b/.test(q) ? q : sujet;
      if (!sp.re.test(cible)) continue;
      if (sp.si && !sp.si.test(q)) continue;
      // nom tel quel (_hx y ajoute la forme développée, ce qui casse les ^…$)
      const num = headers.find(h => sp.num.test(normalizeText(h)) && _estNumerique(table, h));
      const den = headers.find(h => sp.den.test(normalizeText(h)) && _estNumerique(table, h));
      if (num && den) return { mode: 'effectifs', num, den, quoi: sp.quoi, sur: sp.sur, note: sp.note || '', phrase, mot: sp.re, groupe };
      if (table.rowUnit === 'formation') return { mode: 'effectifs', manque: `${sp.quoi} / ${sp.sur}`, phrase, mot: sp.re };
    }
  }
  // lignes : seulement si la phrase donne un vrai critère dans les données (sinon : question pour Albert)
  const courte = phrase.split(_coupePart(phrase))[0];
  // … sauf si la phrase cite un critère connu (apprentis, boursiers, filles…) absent des données : le garde-fou arrêtera le calcul
  if (!_filtresDePhrase(table, courte).length && !_filtresDePhrase(table, phrase).length && !CONCEPTS_A_FILTRER.some(c => c.re.test(phrase))) return null;
  return { mode: 'lignes', phrase, groupe, mot: new RegExp(`\\b(${phrase.split(' ').filter(w => w.length >= 3).map(w => w.replace(/[^a-z0-9]/g, '')).filter(Boolean).join('|') || 'zzz'})\\b`) };
}
// Colonne du « par X » d'une part : celle que le planner choisirait pour la répartition, à défaut la dimension connue
function _dimensionPart(table, question) {
  try {
    if (typeof buildPlannerPlan === 'function') {
      const pp = buildPlannerPlan(question, question, table, 'group_by');
      if (pp && pp.targetCol) return pp.targetCol;
    }
  } catch (e) { /* planner absent */ }
  return _colonneDimension(table, normalizeText(question || ''));
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
  let d;
  if (plan._classementTaux) {
    const ct = plan._classementTaux;
    // le taux est rejoué « par X » (même calcul que « taux de proposition par lycée »), puis classé
    d = detecterPart(plan.table, `${ct.phrase} par ${ct.col}`) || detecterPart(plan.table, ct.phrase);
    if (d) { d.groupe = ct.col; d.classe = { croissant: ct.croissant, limit: ct.limit }; }
    // les filtres tirés du sujet (« lycées » : nom contenant lycée) ne restreignent pas le classement
    plan.filters = (plan.filters || []).filter(f => !(f && f.source === 'etablissement' && f.col === ct.col) && !(f && f.op === 'eq' && /^\d+$/.test(String(f.value)) && _estNumerique(plan.table, f.col)));
  } else d = detecterPart(plan.table, plan.question);
  if (!d) return plan;
  plan.tool = 'part';
  plan.part = d;
  plan.targetCol = null;
  if (d.mode === 'mesure') {
    // la condition = les critères de la seconde partie (« dans le privé ») ; le reste de la question = le périmètre
    const fy = _filtresDePhrase(plan.table, d.y);
    const cle = f => f.op === 'contains_all' ? `T::${(f.terms || []).map(t => [].concat(t)[0]).join('+')}` : `${f.col}`;
    const clesY = new Set(fy.map(cle));
    const fx = d.x ? _filtresDePhrase(plan.table, d.x.replace(/^(?:en|de|des|du|d)\s+/, '')) : [];
    const tous = mergeFiltersUnique(mergeFiltersUnique(plan.filters || [], fx.filter(f => !(plan.filters || []).some(g => cle(g) === cle(f)))), fy.filter(f => !(plan.filters || []).some(g => cle(g) === cle(f))));
    d.condition = fy.map(f => tous.find(g => cle(g) === cle(f)) || f);
    plan.filters = tous.filter(f => !clesY.has(cle(f)) && !(f && f.op !== 'contains_all' && f.source !== 'condition_chiffree' && _estNumerique(plan.table, f.col)));
    return plan;
  }
  if (d.mode === 'lignes') {
    // « proportion de formations privées en Gironde » : la condition est « formations privées », « en Gironde » est le périmètre ;
    // si la partie avant « en / à / dans… » ne donne aucun critère (« part des formations en apprentissage »), on garde toute la phrase
    // v27.5.53 — « taux de proposition des boursiers » : la condition est « proposition », « des boursiers » est le périmètre
    // (avant : la part des boursiers dans tout le fichier, 18 %, au lieu de la part des boursiers ayant eu une proposition)
    const _deQui = /^taux\b/.test(normalizeText(plan.question || '').replace(/^.*?\b(?=taux\b)/, '')) ? d.phrase.split(/\s+(?:des|du|chez les|chez)\s+/)[0] : d.phrase;
    // v27.5.64 — « pourcentage des candidats boursiers (qui) ont accepté une proposition », « part des boursiers ayant
    // eu une proposition » : les boursiers sont le périmètre, l'action est la condition (avant : boursiers ayant accepté
    // parmi TOUS les candidats, 11 % au lieu de 61 %)
    // v27.5.75 — aussi « … viennent de Gironde », « … sont originaires des Landes », « … vont / partent hors académie »
    // (avant : « quelle part des admis en CPGE viennent de Gironde » = 1 082 / 1 082 = 100 %)
    const _mAct = _deQui.match(/^(?:(?:candidats?|candidates?|eleves?|lyceens?)\s+)?(.+?)\s+(?:qui\s+)?(?:ayant|ont|sont|etant|qui ont|qui sont|avaient|etaient|viennent|venant|proviennent|provenant|sont originaires|originaires|vont|partent|restent|etudient|habitent)\s+(.+)$/);
    let courte = _deQui.split(_coupePart(_deQui))[0];
    if (_mAct && _filtresDePhrase(plan.table, _mAct[1]).length && _filtresDePhrase(plan.table, `ont ${_mAct[2]}`).length) courte = `ont ${_mAct[2]}`;
    else if (_mAct && _filtresDePhrase(plan.table, _mAct[1]).length && _filtresDePhrase(plan.table, `candidats ${_mAct[2]}`).length) courte = `candidats ${_mAct[2]}`;
    else {
      // « part des candidats de Gironde admis hors académie » : les candidats de Gironde = le périmètre ; « admis hors
      // académie » = la condition (avant : 2 034 / 35 286, tout le fichier au dénominateur)
      const _mAdm = _deQui.match(/^(?:(?:candidats?|candidates?|eleves?|lyceens?|bacheliers?)\s+)?(.+?)\s+((?:admis|admises|acceptes?|acceptees?)\s+.+)$/);
      if (_mAdm && /^(?:de|des|du|d|venant|issus?|originaires?|scolarises?|provenant)\b/.test(_mAdm[1]) && _filtresDePhrase(plan.table, _mAdm[1]).length && _filtresDePhrase(plan.table, `candidats ${_mAdm[2]}`).length) courte = `candidats ${_mAdm[2]}`;
    }
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
  if ((d.mode === 'lignes' || d.mode === 'mesure') && d.condition) {
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
  // la colonne des groupes n'est pas un filtre (« des boursiers et des non boursiers » : les deux groupes)
  if (d.groupe) plan.filters = (plan.filters || []).filter(f => f && f.col !== d.groupe);
  if (d.manque) return unresolvedConceptExecution(plan, [], `les colonnes nécessaires pour calculer la part de ${d.manque} ne sont pas dans les données`);
  const base = applyLocalActionFilters(plan.table.objects || [], plan.filters || []);
  let result;
  if (d.mode === 'effectifs') {
    let num = 0, den = 0, ignorees = 0;
    base.forEach(r => { const a = _nombreCellule(r?.[d.num]), b = _nombreCellule(r?.[d.den]); if (a === null || b === null) { ignorees++; return; } num += a; den += b; });
    result = { mode: 'effectifs', num, den, pct: den ? num / den * 100 : null, total: base.length, ignorees };
  } else if (d.mode === 'mesure') {
    if (!d.condition || !d.condition.length) return unresolvedConceptExecution(plan, [d.y], `je n'ai pas reconnu de quoi calculer la part (« ${d.y} »)`);
    const somme = rs => rs.reduce((t, r) => { const a = _nombreCellule(r?.[d.col]); return a === null ? t : t + a; }, 0);
    const ignorees = base.filter(r => _nombreCellule(r?.[d.col]) === null).length;
    const num = somme(applyLocalActionFilters(base, d.condition)), den = somme(base);
    result = { mode: 'mesure', num, den, pct: den ? num / den * 100 : null, total: base.length, ignorees };
  } else {
    if (!d.condition || !d.condition.length) return unresolvedConceptExecution(plan, [d.phrase], `je n'ai pas reconnu de quoi calculer la part (« ${d.phrase} »)`);
    const num = applyLocalActionFilters(base, d.condition).length;
    result = { mode: 'lignes', num, den: base.length, pct: base.length ? num / base.length * 100 : null, total: base.length, ignorees: 0 };
  }
  if (d.groupe) return executerPartGroupes(plan, base, result);
  if (!result.den) return unresolvedConceptExecution(plan, [], 'aucune ligne (ou un total nul) dans le périmètre : la part ne peut pas être calculée');
  const exec = { kind: 'part', plan, result, text: `PART = ${result.num} / ${result.den} = ${result.pct}` };
  exec.html = renderPartHtml(plan, result);
  return exec;
}
const _pctFr = v => (Math.round(v * 10) / 10).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
function _libellePart(plan) {
  const d = plan.part;
  if (d.mode === 'effectifs') return { quoi: d.quoi, sur: d.sur };
  if (d.mode === 'mesure') return { quoi: `${d.unite} « ${d.condition.map(f => f.op === 'neq' ? `hors ${f.value}` : f.op === 'eq' ? String(f.label || f.value) : _filtreEnClair(f).replace(/^« [^»]+» = /, '')).join(' et ')} »`, sur: `${d.unite} du périmètre` };
  const unite = plan.table?.rowUnit === 'formation' ? 'formations' : 'lignes';
  // v27.5.54 — valeur d'état seule (« oui », « non ») : on dit de quelle colonne (« A eu une proposition… = non »)
  const etat = d.condition.some(f => /^(oui|non)$/i.test(_filtreEnClair(f).replace(/^« [^»]+» = /, '')));
  if (etat) return { quoi: `${unite} où ${d.condition.map(_filtreEnClair).join(' et ')}`, sur: unite };
  return { quoi: `${unite} « ${d.condition.map(f => _filtreEnClair(f).replace(/^« [^»]+» = /, '')).join(' et ')} »`, sur: unite };
}
// v27.5.54 — taux par groupe : numérateur et dénominateur calculés DANS chaque groupe
function executerPartGroupes(plan, base, ensemble) {
  const d = plan.part, col = d.groupe;
  const groupes = new Map(); let sansGroupe = 0;
  base.forEach(r => { const v = String(r?.[col] ?? '').trim(); if (!v) { sansGroupe++; return; } if (!groupes.has(v)) groupes.set(v, []); groupes.get(v).push(r); });
  const lignes = [...groupes.entries()].map(([valeur, rs]) => {
    if (d.mode === 'effectifs') {
      let num = 0, den = 0;
      rs.forEach(r => { const a = _nombreCellule(r?.[d.num]), b = _nombreCellule(r?.[d.den]); if (a === null || b === null) return; num += a; den += b; });
      return { valeur, num, den, pct: den ? num / den * 100 : null };
    }
    const num = applyLocalActionFilters(rs, d.condition).length;
    return { valeur, num, den: rs.length, pct: rs.length ? num / rs.length * 100 : null };
  }).filter(g => g.den > 0).sort((a, b) => (d.classe && d.classe.croissant ? (a.pct ?? 1e9) - (b.pct ?? 1e9) : (b.pct ?? -1) - (a.pct ?? -1)) || a.valeur.localeCompare(b.valeur, 'fr'));
  // v27.5.78 — classement par taux : les très petits groupes (1 candidat sur 1 = 100 %) sont mis à part, et dits
  if (d.classe && d.mode !== 'effectifs') {
    const min = Math.max(10, Math.ceil(base.length * 0.002));
    const petits = lignes.filter(g => g.den < min);
    if (petits.length && petits.length < lignes.length) { for (let i = lignes.length - 1; i >= 0; i--) if (lignes[i].den < min) lignes.splice(i, 1); d.classe.petits = { n: petits.length, min }; }
  }
  if (d.classe && d.classe.limit && lignes.length > d.classe.limit) lignes.splice(d.classe.limit);
  if (!lignes.length) return unresolvedConceptExecution(plan, [], `aucune ligne avec une valeur dans « ${col} » : le taux par groupe ne peut pas être calculé`);
  const result = { mode: d.mode, groupe: col, groupes: lignes, ensemble, total: base.length, sansGroupe };
  const p2 = { ...plan, tool: 'part', targetCol: col }; // outil « part » gardé : les relances reprennent la part
  const lp = _libellePart(plan);
  const exec = { kind: 'part_groupes', plan: p2, result,
    text: `PART PAR « ${col} » (${lp.quoi} / ${lp.sur}) :\n` + lignes.slice(0, 40).map(g => `${g.valeur} : ${g.num} / ${g.den} = ${g.pct}`).join('\n') + `\nEnsemble : ${ensemble.num} / ${ensemble.den} = ${ensemble.pct}` };
  exec.html = renderPartGroupesHtml(p2, result);
  rememberDataEngineExecution(exec);
  return exec;
}
function renderPartGroupesHtml(plan, r) {
  const { quoi, sur } = _libellePart(plan);
  const dim = _shortColName(r.groupe) || r.groupe;
  const titre = `Part de ${quoi} par ${dim}`;
  const th = 'text-align:left;padding:6px 8px;background:#e8edff;color:var(--bleu,#003189);font-size:11px;white-space:nowrap';
  const td = 'padding:5px 8px;border-bottom:1px solid var(--gris1,#f3f4f6);font-size:12px';
  const tdr = td + ';text-align:right';
  const corps = r.groupes.slice(0, 40).map(g => `<tr><td style="${td}">${escapeHtml(g.valeur)}</td><td style="${tdr};font-weight:800">${g.pct === null ? '—' : `${_pctFr(g.pct)} %`}</td><td style="${tdr}">${_nf(g.num)} / ${_nf(g.den)}</td></tr>`).join('');
  const e = r.ensemble;
  const pied = `<tr style="background:#e8edff"><td style="${td};font-weight:800">Ensemble</td><td style="${tdr};font-weight:800">${e.pct === null ? '—' : `${_pctFr(e.pct)} %`}</td><td style="${tdr};font-weight:800">${_nf(e.num)} / ${_nf(e.den)}</td></tr>`;
  const table = `<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;margin:8px 0"><thead><tr><th style="${th}">${escapeHtml(dim)}</th><th style="${th};text-align:right">Part</th><th style="${th};text-align:right">Détail (${escapeHtml(quoi)} / ${escapeHtml(sur)})</th></tr></thead><tbody>${corps}${pied}</tbody></table></div>`;
  const methode = `<p style="font-size:12px;color:var(--gris3)">Chaque part est calculée à l'intérieur du groupe : ${escapeHtml(quoi)} du groupe ÷ ${escapeHtml(sur)} du groupe.${r.groupes.length > 40 ? ` 40 groupes affichés sur ${r.groupes.length}.` : ''}</p>`;
  const perim = perimetreResultat('part_groupes', plan, r).html;
  const debug = `<details class="msg-sources"><summary>Plan Data Engine</summary><div style="font-size:10px;line-height:1.5;margin-top:5px"><strong>Outil</strong> : part par groupe (${escapeHtml(r.mode)}) · ${escapeHtml(r.groupe)}</div></details>`;
  const cl = plan.part && plan.part.classe;
  const noteClasse = cl ? `<p style="font-size:12px;color:var(--gris3)">Classement du taux ${cl.croissant ? 'le plus bas au plus haut' : 'le plus haut au plus bas'}${cl.petits ? ` ; ${_nf(cl.petits.n)} groupe(s) de moins de ${_nf(cl.petits.min)} lignes écarté(s) (un taux sur quelques lignes n'est pas comparable, ex. 1 sur 1 = 100 %)` : ''}.</p>` : '';
  return `${deTitleHtml(titre, plan.blockId, plan.originalTitle || titre)}${perim}${noteClasse}${table}${methode}${debug}`;
}
function renderPartHtml(plan, result) {
  const d = plan.part;
  const { quoi, sur } = _libellePart(plan);
  const titre = `Part — ${_pctFr(result.pct)} % (${quoi})`;
  const methode = d.mode === 'effectifs'
    ? `<p style="font-size:12px;color:var(--gris3)">Calcul : somme de « ${escapeHtml(d.num)} » ÷ somme de « ${escapeHtml(d.den)} », sur les ${_nf(result.total - result.ignorees)} formations du périmètre — et non la moyenne des pourcentages de chaque formation${d.note ? ` ; ${escapeHtml(d.note)}` : ''}.</p>`
    : d.mode === 'mesure'
      ? `<p style="font-size:12px;color:var(--gris3)">Calcul : somme de « ${escapeHtml(d.col)} » des formations qui remplissent la condition (${escapeHtml(d.condition.map(_filtreEnClair).join(' ; '))}) ÷ somme de « ${escapeHtml(d.col)} » de toutes les formations du périmètre${result.ignorees ? ` (${result.ignorees} formation(s) sans valeur écartée(s))` : ''}.</p>`
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
  // v27.5.68 — deux années citées (« en 2024 et en 2025 ») : les deux sessions (avant : 2024 seule, sans le dire)
  const evolution = EVOLUTION_FORTE.test(q) || (annees.length && EVOLUTION_AVEC_ANNEE.test(q)) || new Set(annees).size >= 2;
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
    targetCol: tr(plan.targetCol), sumCol: tr(plan.sumCol), groupSumCol: tr(plan.groupSumCol) };
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
  // v27.18 — répartitions (« places en BTS par académie ») et classements de groupes : groupe par groupe
  if (execs.every(x => ['group_by', 'top', 'classement', 'pivot'].includes(x.e.kind))) return executerEvolutionGroupes(plan, execs);
  if (!execs.every(x => ['count', 'sum', 'stats', 'part'].includes(x.e.kind)))
    return unresolvedConceptExecution(plan, [], `la comparaison entre sessions est disponible pour les comptages, sommes, moyennes, parts, répartitions et classements de groupes (pas pour ce type de résultat : ${execs[0].e.kind})`);
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
/* v27.18 — Évolution d'une répartition ou d'un classement de groupes entre deux sessions.
   Même calcul sur chaque session (comptage ou somme par groupe), groupes rapprochés par leur libellé
   (sans accents ni majuscules). Un groupe absent d'une session est montré « — » et signalé : groupe nouveau,
   disparu, ou libellé changé. Les formations, elles, ne sont pas suivies une à une (pas d'identifiant commun). */
function _donneesGroupes(e) {
  const p = e.plan;
  const rows = applyLocalActionFilters(p.table.objects || [], p.filters || []);
  const formation = p.table?.rowUnit === 'formation';
  if (e.kind === 'classement') {
    const c = p.classement;
    const d = sommesParGroupe(rows, c.entite.col, c.col);
    return { type: 'classement', col: c.entite.col, unite: c.libelle, ordre: c.ordre, limit: c.limit, groupes: d.top, total: d.somme, sansValeur: d.sansValeur, retenues: rows.length, nomGroupes: c.entite.nom };
  }
  if (p.groupSumCol) {
    const d = sommesParGroupe(rows, p.targetCol, p.groupSumCol);
    return { type: 'repartition', col: p.targetCol, unite: p.sumUnit, ordre: 'desc', limit: 30, groupes: d.top, total: d.somme, sansValeur: d.sansValeur, retenues: rows.length, mesureCol: p.groupSumCol };
  }
  const d = topCountsForRows(rows, p.targetCol, Infinity);
  return { type: 'repartition', col: p.targetCol, unite: formation ? 'formations' : 'lignes', ordre: 'desc', limit: 30, groupes: d.top, total: d.filled, sansValeur: rows.length - d.filled, retenues: rows.length };
}
function executerEvolutionGroupes(plan, execs) {
  const [x1, x2] = [execs[0], execs[execs.length - 1]];
  const ex = x2.e;
  if (ex.kind === 'pivot') return unresolvedConceptExecution(plan, [], `la comparaison entre sessions d'un tableau croisé n'est pas disponible : demandez une seule répartition (« évolution du nombre de formations par ${_shortColName(ex.plan.targetCol || '') || 'académie'} depuis ${x1.s} »)`);
  if (ex.kind === 'classement' && !ex.plan.classement?.entite) return unresolvedConceptExecution(plan, [], `les formations ne peuvent pas être suivies une à une d'une session à l'autre (aucun identifiant commun fiable dans l'open data chargé) : comparez plutôt des groupes, par exemple « évolution des places par académie depuis ${x1.s} » ou « les académies avec le plus de places : évolution depuis ${x1.s} »`);
  if (ex.plan.listMode) return unresolvedConceptExecution(plan, [], `la comparaison entre sessions d'une liste d'intitulés n'est pas disponible : demandez par exemple « évolution du nombre de formations par filière depuis ${x1.s} »`);
  const d1 = _donneesGroupes(x1.e), d2 = _donneesGroupes(x2.e);
  // colonne introuvable dans une session (renommée sans correspondance) : pas un tableau de « — »
  const vide = [[x1, d1], [x2, d2]].find(([, d]) => d.retenues > 0 && !d.groupes.length);
  if (vide) return unresolvedConceptExecution(plan, [], `la colonne « ${d2.col} »${d2.mesureCol ? ` ou « ${d2.mesureCol} »` : ''} n'a pas été retrouvée (ou est vide) dans la session ${vide[0].s} : comparaison impossible`);
  const cle = v => normalizeText(v);
  const m = new Map();
  d1.groupes.forEach(g => m.set(cle(g.value), { valeur: g.value, v1: g.count, v2: null }));
  d2.groupes.forEach(g => { const k = cle(g.value); const o = m.get(k) || { valeur: g.value, v1: null, v2: null }; o.valeur = g.value; o.v2 = g.count; m.set(k, o); });
  const rangs = (d, champ) => {
    const tri = [...m.values()].filter(o => o[champ] !== null).sort((a, b) => d.ordre === 'asc' ? a[champ] - b[champ] : b[champ] - a[champ]);
    tri.forEach((o, i) => { o[champ === 'v1' ? 'rang1' : 'rang2'] = i + 1; });
  };
  rangs(d1, 'v1'); rangs(d2, 'v2');
  const toutes = [...m.values()].map(o => ({ ...o,
    ecart: o.v1 !== null && o.v2 !== null ? Math.round((o.v2 - o.v1) * 100) / 100 : null,
    ecartPct: o.v1 && o.v2 !== null ? (o.v2 - o.v1) / o.v1 * 100 : null }));
  const ordre = d2.ordre === 'asc' ? 1 : -1;
  toutes.sort((a, b) => (a.v2 === null) - (b.v2 === null) || (a.v2 !== null && b.v2 !== null ? ordre * (a.v2 - b.v2) : 0) || ((b.v1 || 0) - (a.v1 || 0)) || a.valeur.localeCompare(b.valeur, 'fr'));
  const lignes = toutes.slice(0, d2.limit);
  const result = {
    type: d2.type, col: d2.col, unite: d2.unite, ordre: d2.ordre, nomGroupes: d2.nomGroupes || null, mesureCol: d2.mesureCol || null,
    sessions: [x1.s, x2.s], lignes, nbGroupes: toutes.length,
    totaux: [d1.total, d2.total], retenues: [d1.retenues, d2.retenues], sansValeur: [d1.sansValeur, d2.sansValeur],
    formations: [(x1.e.plan.table.objects || []).length, (x2.e.plan.table.objects || []).length],
    nouveaux: toutes.filter(o => o.v1 === null).map(o => o.valeur), disparus: toutes.filter(o => o.v2 === null).map(o => o.valeur),
    perimetre: perimetreResultat(x2.e.kind, x2.e.plan, x2.e.result).texte,
  };
  const exec = { kind: 'evolution_groupes', plan: { ...plan, targetCol: d2.col }, result,
    text: `${result.unite} par ${d2.col}, ${x1.s} → ${x2.s} :\n` + lignes.map(l => `${l.valeur} : ${l.v1 ?? '—'} → ${l.v2 ?? '—'}${l.ecart !== null ? ` (${l.ecart > 0 ? '+' : ''}${l.ecart})` : ''}`).join('\n') };
  exec.html = renderEvolutionGroupesHtml(exec.plan, result, x2.e);
  rememberDataEngineExecution(exec);
  return exec;
}
function renderEvolutionGroupesHtml(plan, r, exec2) {
  const [s1, s2] = r.sessions;
  const fmt = v => v === null || v === undefined ? '—' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  const signe = v => v > 0 ? '+' : v < 0 ? '−' : '';
  const ecartTxt = l => l.ecart === null ? '—' : `${signe(l.ecart)}${fmt(Math.abs(l.ecart))}`;
  const pctTxt = l => l.ecartPct === null ? '—' : `${signe(l.ecartPct)}${_pctFr(Math.abs(l.ecartPct))} %`;
  const couleur = v => v > 0 ? 'color:#15803d' : v < 0 ? 'color:#b91c1c' : '';
  const dim = _shortColName(r.col) || r.col;
  const classement = r.type === 'classement';
  const titre = classement
    ? `Classement des ${r.nomGroupes} (${r.unite}) : évolution ${s1} → ${s2}`
    : `Évolution ${s1} → ${s2} — ${r.unite} par ${dim}`;
  const th = 'text-align:left;padding:6px 8px;background:#e8edff;color:var(--bleu,#003189);font-size:11px;white-space:nowrap';
  const td = 'padding:5px 8px;border-bottom:1px solid var(--gris1,#f3f4f6);font-size:12px';
  const tdr = td + ';text-align:right;white-space:nowrap';
  const entete = `<tr>${classement ? `<th style="${th}">Rang ${s2}</th>` : ''}<th style="${th}">${escapeHtml(dim)}</th><th style="${th};text-align:right">${s1}</th><th style="${th};text-align:right">${s2}</th><th style="${th};text-align:right">Écart</th><th style="${th};text-align:right">Évolution</th>${classement ? `<th style="${th};text-align:right">Rang ${s1}</th>` : ''}</tr>`;
  const corps = r.lignes.map(l => `<tr>${classement ? `<td style="${td}">${l.rang2 ?? '—'}</td>` : ''}<td style="${td}">${escapeHtml(l.valeur)}</td><td style="${tdr}">${fmt(l.v1)}</td><td style="${tdr}"><strong>${fmt(l.v2)}</strong></td><td style="${tdr};${couleur(l.ecart)}">${ecartTxt(l)}</td><td style="${tdr};${couleur(l.ecartPct)}">${pctTxt(l)}</td>${classement ? `<td style="${tdr}">${l.rang1 ?? '—'}</td>` : ''}</tr>`).join('');
  const tot = { ecart: Math.round((r.totaux[1] - r.totaux[0]) * 100) / 100, ecartPct: r.totaux[0] ? (r.totaux[1] - r.totaux[0]) / r.totaux[0] * 100 : null };
  const pied = `<tr style="background:#e8edff">${classement ? `<td style="${td}"></td>` : ''}<td style="${td};font-weight:800">Total${r.nbGroupes > r.lignes.length ? ` (tous les ${r.nbGroupes} groupes)` : ''}</td><td style="${tdr};font-weight:800">${fmt(r.totaux[0])}</td><td style="${tdr};font-weight:800">${fmt(r.totaux[1])}</td><td style="${tdr};font-weight:800;${couleur(tot.ecart)}">${ecartTxt(tot)}</td><td style="${tdr};font-weight:800;${couleur(tot.ecartPct)}">${pctTxt(tot)}</td>${classement ? `<td style="${td}"></td>` : ''}</tr>`;
  const table = `<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;margin:8px 0"><thead>${entete}</thead><tbody>${corps}${pied}</tbody></table></div>`;
  const notes = [];
  if (r.nbGroupes > r.lignes.length) notes.push(`${r.lignes.length} groupes affichés sur ${r.nbGroupes} (les plus ${classement && r.ordre === 'asc' ? 'petits' : 'grands'} en ${s2}) ; le total porte sur tous les groupes.`);
  if (r.nouveaux.length || r.disparus.length) notes.push(`« — » : groupe absent d'une session${r.nouveaux.length ? ` (seulement en ${s2} : ${r.nouveaux.slice(0, 5).map(escapeHtml).join(', ')}${r.nouveaux.length > 5 ? '…' : ''})` : ''}${r.disparus.length ? ` (seulement en ${s1} : ${r.disparus.slice(0, 5).map(escapeHtml).join(', ')}${r.disparus.length > 5 ? '…' : ''})` : ''} — groupe nouveau, disparu, ou libellé changé d'une année à l'autre.`);
  if (r.sansValeur.some(n => n > 0)) notes.push(`Formations sans valeur, non comptées : ${r.sansValeur[0].toLocaleString('fr-FR')} en ${s1}, ${r.sansValeur[1].toLocaleString('fr-FR')} en ${s2}.`);
  if (r.formations[0] !== r.formations[1]) notes.push(`L'offre a changé entre les deux sessions (${_nf(r.formations[0])} formations en ${s1}, ${_nf(r.formations[1])} en ${s2}) : une variation peut venir de formations ouvertes ou fermées.`);
  if (r.mesureCol) notes.push(`Chiffres = somme de « ${escapeHtml(r.mesureCol)} » par groupe, pas un nombre de formations.`);
  const perim = perimetreResultat(exec2.kind, exec2.plan, exec2.result).html
    .replace('Sur quoi porte ce calcul</strong> :', 'Sur quoi porte ce calcul</strong> (chaque session) :')
    .replace(/\d[\d\s  ]* (?:formations?|lignes?) retenues? sur [\d\s  ]+ · open data Parcoursup \d+/, `mêmes critères appliqués à chaque session (${_nf(r.retenues[0])} formations retenues en ${s1}, ${_nf(r.retenues[1])} en ${s2}) · open data Parcoursup`);
  const debug = `<details class="msg-sources"><summary>Plan Data Engine</summary><div style="font-size:10px;line-height:1.5;margin-top:5px"><strong>Outil</strong> : évolution par groupe ${s1} → ${s2} · ${escapeHtml(r.type)} · ${escapeHtml(r.col)}</div></details>`;
  return `${deTitleHtml(titre, plan.blockId, plan.originalTitle || titre)}${perim}${table}${notes.map(n => `<p style="font-size:12px;color:var(--gris3);margin:4px 0">${n}</p>`).join('')}${debug}`;
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
  // v27.5.69 — « boursières » aussi (avant : critère au féminin ignoré sans colonne reconnue, chiffre faux affiché)
  { re: /\bboursi(?:er|ers|ere|eres)\b|\bbourses?\b/, mot: 'boursiers', ok: t => /bours/.test(t) },
  { re: /\b(filles?|femmes?|feminins?|garcons?|hommes?|masculins?|candidates)\b/, mot: 'filles / garçons', ok: (t, f) => /sexe|genre|candidates/.test(t) || /^(f|m|h|feminin|masculin|femmes?|hommes?|filles?|garcons?)$/.test(normalizeText(f.value)) || (typeof plannerColumnKind === 'function' && plannerColumnKind(f.col) === 'sexe') },
  { re: /\bapprenti(e|s|es)?\b|\bapprentissage\b|\balternance\b/, mot: 'apprentis', ok: t => /appr|altern/.test(t) },
  // v27.14 — condition chiffrée non comprise (« dont la capacité dépasse 100 ») : arrêt, pas toutes les lignes
  { re: /\b(plus de|moins de|au moins|au plus|superieure? a|inferieure? a|depasse\w*|au dela de|en dessous de)\s+\d/, mot: 'condition chiffrée', ok: (t, f) => f && f.source === 'condition_chiffree' },
  // v27.13 — « combien de refusés » sans colonne de statut comptait tout le fichier
  { re: /\brefus(e|es|ee|ees)?\b|\bliste d ?attente\b|\ben attente\b|\bdesist(e|es|ee|ees|ement)?\b/, mot: 'statut de candidature (refusé, liste d\'attente…)', ok: t => /refus|attente|desist|statut|admi|candidature/.test(t) },
  { re: /\bbasques?\b/, mot: 'Pays Basque', ok: t => /basque/.test(t) },
  { re: /\bpubli(c|cs|que|ques)\b|\bprive(e|s|es)?\b/, mot: 'public / privé', ok: t => /publi|priv|statut|secteur|contrat/.test(t) },
  { re: /\bselecti(f|fs|ve|ves)\b/, mot: 'sélective', ok: t => /selecti/.test(t) },
  // v27.5.53 — « n'ont confirmé aucun vœu » : la colonne du nombre de vœux est vide, pas à 0 → arrêt, pas tout le fichier
  { re: /\baucuns? v(oe|œ)?ux?\b|\bsans v(oe|œ)ux?\b|\bpas de v(oe|œ)ux?\b|\b0 v(oe|œ)ux?\b|\bzero v(oe|œ)ux?\b/, mot: 'aucun vœu', ok: (t, f) => f && f.source === 'condition_chiffree' && /v(oe|œ)u/.test(t) },
];
const LIEUX_AMBIGUS = new Set('somme manche nord lot var ain cher orne oise eure gers aube aude gard jura tarn indre doubs loire marne meuse vienne creuse rhone yonne'.split(' '));
/* v27.22 — Mot de la question qui n'a servi à rien : arrêt, au lieu de compter plus large.
   Open data réel : « combien de khâgnes » comptait tout le fichier (14 252), « BTS NDRC » tous les BTS. Pour une
   source où une ligne = une formation, chaque mot porteur de sens doit correspondre à un filtre, à une colonne
   utilisée ou à un mot connu (outils de la question, lieux, mesures). Sinon le moteur s'arrête et le nomme. */
const MOTS_QUESTION = new Set(`
  eux elles ceux celles entre parmi exception excepte exceptes dehors
  croise croisee croises croisees croiser pivot
  seul seule seuls seules
  suivi suivie suivis suivies terminale terminales
  meilleur meilleure meilleurs meilleures pire pires fort forte forts fortes eleve elevee eleves elevees faible faibles
  fais faites fait faire mets mettre trace tracer dessine dessiner camembert diagramme histogramme barres courbe forme visualise visualiser
  combien quel quelle quels quelles nombre nombres total totale totaux somme effectif effectifs compte compter
  formation formations filiere filieres ligne lignes dont avec sans pour par dans sur des les une aux leur
  est sont ont a y il elles ils ya existe existent propose proposent proposees proposes offert offerte offertes offerts
  y-a-t-il peux pouvez peut donne donner donnez moi indique indiquer dis dire calcule calculer montre montrer affiche afficher
  ensemble actuellement actuelle actuel aujourd hui cette annee session sessions parcoursup open data jeu fichier donnees
  repartition repartitions ventilation ventile distribution groupe groupes graphique tableau liste lister
  moyen moyenne moyens moyennes median mediane minimum maximum min max part parts pourcentage pourcentages taux proportion
  places place capacite capacites candidats candidat candidates candidate admis admises voeux voeu demandes demande demandees
  propositions proposition boursiers boursier inscrits accueil accueillis accepte acceptes ecole ecoles etablissement etablissements
  academie academies region regions departement departements commune communes ville villes lieu lieux france entiere national nationale
  classement classe classer top premieres premiers derniers dernieres principales principaux ordre plus moins grand grands petit petits
  evolution evoluer augmente baisse depuis entre rapport relativement compare comparaison an annee annees dernier derniere precedente
  selective selectives selectif selectifs selectivite public publics publique publiques prive prives privee privees statut
  apprentissage apprenti apprentis alternance svp merci stp
  bas basse haut haute eleve elevee eleves elevees faible faibles fort forte forts fortes important importante
  remplissage admission admissions acceptation reussite acces filles fille garcons garcon femmes hommes sexe genre
  neo bachelier bacheliers bacheliere bachelieres bac general generale generaux technologique technologiques professionnel professionnels
  origine meme accueillies accueillis recrutement recrutes`.trim().split(/\s+/));
const MOTS_COURTS = new Set('a y d l s n j m t c qu de la le du au un et ou en se ne sa son ma ta me te on il je tu nb vs si ni mes ses ces des les une aux par sur'.split(' '));
function elaguerTermesCouverts(plan) {
  const tf = (plan.filters || []).find(f => f && f.op === 'contains_all');
  if (!tf || !Array.isArray(tf.terms)) return plan;
  // (une spécialité du lycée ne couvre pas un mot de formation d'accueil : « spécialité droit et économie admis en droit »)
  const autres = (plan.filters || []).filter(f => f && f !== tf && f.op !== 'contains_all' && f.op !== 'neq' && !SYMBOLES_OPS[f.op] && f.source !== 'specialite_lycee');
  const sing = w => String(w).replace(/(s|x)$/, '');
  const mots = new Set(autres.flatMap(f => normalizeText(f.value).split(' ')).filter(w => w.length >= 3).map(sing));
  if (!mots.size) return plan;
  const labels = String(tf.label || '').split(' + ');
  // singulier / pluriel confondus (« Nouvelles » d'un intitulé, « Nouvelle » de la région)
  const garder = tf.terms.map((t, i) => ({ t, l: labels[i] })).filter(x => !(Array.isArray(x.t) ? x.t : [x.t]).some(w => mots.has(sing(w))) && !mots.has(sing(normalizeText(x.l || ''))));
  if (garder.length === tf.terms.length) return plan;
  if (!garder.length) { plan.filters = plan.filters.filter(f => f !== tf); return plan; }
  const nv = { ...tf, terms: garder.map(x => x.t), label: garder.map(x => x.l).join(' + '), value: garder.map(x => x.l).join(' + ') };
  plan.filters = plan.filters.map(f => f === tf ? nv : f);
  return plan;
}
// v27.5.53 — fichiers de candidats : verbes et tournures qui décrivent le parcours sans être un critère
const MOTS_FICHIER_CANDIDATS = new Set(`
  vont va aller partent partis parties part partir restent reste restes restees rester restant demeurent quittent quitte quitter
  sortent sortir etudier etudient etudie poursuivre poursuivent ayant eu eus recu recus recue obtenu obtenus issus issue issues
  venant viennent provenant originaires originaire scolarises scolarisees scolarise scolarisee scolarite eleves eleve lyceens lyceennes
  jeunes bacheliers bachelieres neo suivant suivent suivi suivie suivis ont confirme confirmes confirmee confirmees aucun aucune
  autre autres dehors hors leurs notre nos son sa ses lycee lycees etudiants etudiante etudiantes etudiant
  acceptee acceptees accepte acceptes acceptent accepter favorable favorables favorablement repondu reponse admise affectes affectees
  choisi choisie choisis choisies choisissent prefere preferee preferees privilegiees terminale terminales premiere classe classes
  envoient envoie envoyes forment comptent accueillent accueille admettent recrutent
  fait faisaient pris frequents frequentes frequent frequente representes representees eux elles ceux celles entre parmi dont
`.split(/\s+/).filter(Boolean));
// mots traduits par un filtre (« STMG » → « Sciences et Technologies du Management… », « licence » → « L1 - CUPGE… »)
const _SIGLES_SERIES = [[/management.*gestion/, 'stmg'], [/industrie.*developpement durable/, 'sti2d'], [/design.*arts? appliqu/, 'std2a'],
  [/laboratoire/, 'stl'], [/sante.*social/, 'st2s'], [/agronomie.*vivant/, 'stav'], [/theatre.*musique.*danse/, 's2tmd'], [/hotellerie.*restauration/, 'sthr']];
function _motsTraduits(valeur) {
  const v = normalizeText(valeur), out = [];
  _SIGLES_SERIES.forEach(([re, x]) => { if (re.test(v)) out.push(x); });
  _CATEGORIES_TRADUITES.forEach(([mot, val]) => { if (val.test(v)) out.push(...String(mot.source).replace(/[\^$()?]/g, '').split('|').map(w => w.replace(/s$/, ''))); });
  if (/\binfirmier/.test(v)) out.push('ifsi');
  _MATIERES_LYCEE.forEach(([, , nom, alias]) => { if (normalizeText(nom) === v) out.push(...alias); });
  if (/\bprofessionnel/.test(v)) out.push('pro');
  if (/\btechnologique/.test(v)) out.push('techno');
  return out;
}
function motsNonReconnus(plan) {
  if (!plan || !plan.table) return [];
  const _fichierCandidats = plan.table.rowUnit !== 'formation';
  if (!['count_rows', 'sum', 'stats', 'group_by', 'top', 'classement', 'part'].includes(plan.tool)) return [];
  if (plan.dimensionIntrouvable && !plan.targetCol) return []; // « par couleur » : message dédié plus loin
  const info = formationTermsInfo(plan.table);
  const filtres = [...(plan.filters || []), ...((plan.tool === 'part' && plan.part?.condition) || [])].filter(Boolean);
  const cols = [plan.targetCol, plan.targetCol2, plan.sumCol, plan.groupSumCol, plan.classement?.col, plan.classement?.entite?.col, plan.part?.num, plan.part?.den, plan.part?.groupe, ...filtres.map(f => f.col)].filter(Boolean);
  const connus = new Set();
  const ajouter = t => normalizeText(t).split(' ').forEach(w => { if (w) connus.add(w); });
  if (filtres.some(f => f.source === 'specialite_lycee')) ['ses svt hggsp hlp llcer nsi amc eppcs maths math pc eco terminale lycee specialite specialites enseignement enseignements doublette'].forEach(ajouter);
  filtres.filter(f => f.op === 'or').forEach(f => (f.groupes || []).flat().forEach(g => { ajouter(g.value); ajouter(g.label || ''); (g.terms || []).forEach(t => [].concat(t).forEach(ajouter)); (g.values || []).forEach(ajouter); _motsTraduits(g.value).forEach(ajouter); ajouter(_hx(g.col || '')); }));
  filtres.forEach(f => { ajouter(f.value); ajouter(f.label || ''); (f.terms || []).forEach(t => (Array.isArray(t) ? t : [t]).forEach(ajouter)); (f.values || []).forEach(ajouter); (f.noms || []).forEach(ajouter); _motsTraduits(f.value).forEach(ajouter); });
  cols.forEach(c => ajouter(_hx(c)));
  (plan.table.headers || []).forEach(h => ajouter(h)); // un mot d'en-tête désigne une colonne (« taux d'accès »)
  const prefixe = w => w.slice(0, Math.min(5, w.length));
  const couvert = w => connus.has(w) || [...connus].some(c => c.length >= 4 && w.length >= 4 && prefixe(c) === prefixe(w));
  const q = normalizeText(plan.question || '');
  const manque = [];
  q.split(' ').forEach(w => {
    // mots de 2 lettres : seuls les mots outils sont ignorés (« Sciences Po », « BUT TC » : « po », « tc » comptent)
    if (!w || /^\d/.test(w) || (w.length < 3 && MOTS_COURTS.has(w)) || w.length === 1) return;
    if (FORMATION_TERM_STOP.has(w) || MOTS_QUESTION.has(w) || info.geo.has(w) || couvert(w)) return;
    if (_fichierCandidats && MOTS_FICHIER_CANDIDATS.has(w)) return;
    manque.push(w);
  });
  return [...new Set(manque)];
}

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
    + `<p style="font-size:12px;color:var(--gris3)">Pour connaître leur option, consultez la fiche de chaque formation sur Parcoursup. Quand un établissement a plusieurs formations au même intitulé, la capacité aide à les repérer (deux formations peuvent avoir la même).</p>`;
  const text = `NON CALCULÉ : ${quoi} ; les autres ne précisent pas leur option. Dans le périmètre (${_nf(pp.perimetre)} formations ${pp.famille}${portee}) : ${pp.precisees.length} précisent « ${pp.terme} », ${pp.sansPrecision.length} sans précision.`;
  return { kind: 'unresolved', plan, result: { missing: [pp.terme], suggestions: [], precision: { ...pp, precisees: pp.precisees.length, sansPrecision: pp.sansPrecision.length, etablissements: pe.groupes } }, text, html };
}

/* v27.11 — Reformulations courantes ramenées à la forme que le moteur comprend.
   Ne change pas le sens : abréviations (« nb de »), négations (« qui ne sont pas boursiers »),
   « dans chaque académie » (= par académie), « bacheliers généraux » (= bac général),
   « sur la commune de Bordeaux » (= à Bordeaux). */
// v27.25 — numéros de département → noms (« combien de BTS dans le 33 » comptait tous les BTS)
const DEPARTEMENTS_FR = { '01': 'Ain', '02': 'Aisne', '03': 'Allier', '04': 'Alpes-de-Haute-Provence', '05': 'Hautes-Alpes', '06': 'Alpes-Maritimes', '07': 'Ardèche', '08': 'Ardennes', '09': 'Ariège', '10': 'Aube', '11': 'Aude', '12': 'Aveyron', '13': 'Bouches-du-Rhône', '14': 'Calvados', '15': 'Cantal', '16': 'Charente', '17': 'Charente-Maritime', '18': 'Cher', '19': 'Corrèze', '2a': 'Corse-du-Sud', '2b': 'Haute-Corse', '21': "Côte-d'Or", '22': "Côtes-d'Armor", '23': 'Creuse', '24': 'Dordogne', '25': 'Doubs', '26': 'Drôme', '27': 'Eure', '28': 'Eure-et-Loir', '29': 'Finistère', '30': 'Gard', '31': 'Haute-Garonne', '32': 'Gers', '33': 'Gironde', '34': 'Hérault', '35': 'Ille-et-Vilaine', '36': 'Indre', '37': 'Indre-et-Loire', '38': 'Isère', '39': 'Jura', '40': 'Landes', '41': 'Loir-et-Cher', '42': 'Loire', '43': 'Haute-Loire', '44': 'Loire-Atlantique', '45': 'Loiret', '46': 'Lot', '47': 'Lot-et-Garonne', '48': 'Lozère', '49': 'Maine-et-Loire', '50': 'Manche', '51': 'Marne', '52': 'Haute-Marne', '53': 'Mayenne', '54': 'Meurthe-et-Moselle', '55': 'Meuse', '56': 'Morbihan', '57': 'Moselle', '58': 'Nièvre', '59': 'Nord', '60': 'Oise', '61': 'Orne', '62': 'Pas-de-Calais', '63': 'Puy-de-Dôme', '64': 'Pyrénées-Atlantiques', '65': 'Hautes-Pyrénées', '66': 'Pyrénées-Orientales', '67': 'Bas-Rhin', '68': 'Haut-Rhin', '69': 'Rhône', '70': 'Haute-Saône', '71': 'Saône-et-Loire', '72': 'Sarthe', '73': 'Savoie', '74': 'Haute-Savoie', '75': 'Paris', '76': 'Seine-Maritime', '77': 'Seine-et-Marne', '78': 'Yvelines', '79': 'Deux-Sèvres', '80': 'Somme', '81': 'Tarn', '82': 'Tarn-et-Garonne', '83': 'Var', '84': 'Vaucluse', '85': 'Vendée', '86': 'Vienne', '87': 'Haute-Vienne', '88': 'Vosges', '89': 'Yonne', '90': 'Territoire de Belfort', '91': 'Essonne', '92': 'Hauts-de-Seine', '93': 'Seine-Saint-Denis', '94': 'Val-de-Marne', '95': "Val-d'Oise", '971': 'Guadeloupe', '972': 'Martinique', '973': 'Guyane', '974': 'La Réunion', '976': 'Mayotte' };
const REFORMULATIONS = [
  [/\b(?:nb|nbre|nbr)\.?\s+(?=de\b|d['’]|des\b|total\b)/gi, 'nombre '],
  // v27.25 — fautes de frappe courantes (« conbien de BTS » partait vers Albert)
  [/\b(?:conbien|combein|cobien|combiens|conbiens|cmbien|comben|combie)\b/gi, 'combien'],
  // v27.5.76 — écarts et rangs : « combien de BTS de plus en Gironde que dans les Landes », « différence entre le nombre
  // de BTS en Gironde et dans les Landes », « y a-t-il plus de BTS en Gironde ou dans les Landes » = une comparaison
  // (avec l'écart) ; « quelle est la deuxième académie pour le nombre de BTS » = le classement (avant : arrêt)
  [/^\s*combien\s+(?:de|d['’])\s*(.+?)\s+(?:de plus|en plus|de moins|en moins)\s+(.+?)\s+(?:que\s+|qu['’]\s*)(.+?)\s*\??\s*$/i, 'comparer le nombre de $1 $2 et $3'],
  [/^\s*(?:quel(?:le)?\s+est\s+)?(?:la\s+diff[ée]rence|l['’]\s*[ée]cart)\s+entre\s+(?:le\s+nombre\s+(?:de|d['’])\s*)?(.+?)\s*\??\s*$/i, 'comparer le nombre de $1'],
  [/^\s*(?:y\s+a[- ]?t[- ]?il|est[- ]ce\s+qu['’]\s*il\s+y\s+a|il\s+y\s+a)\s+plus\s+(?:de|d['’])\s*(.+?)\s+((?:en|à|a|dans|au|aux)\s+.+?)\s+ou\s+(.+?)\s*\??\s*$/i, 'comparer le nombre de $1 $2 et $3'],
  [/^\s*(?:quel(?:le)?\s+est\s+)?(?:la|le|l['’])\s*(?:deuxi[eè]me|troisi[eè]me|quatri[eè]me|cinqui[eè]me|second(?:e)?|2e|3e|4e|5e|derni[eè]re?)\s+([a-zà-ÿ]+?)s?\s+(?:pour|par|en|selon)\s+(?:le\s+)?nombre\s+(?:de|d['’])\s*(.+?)\s*\??\s*$/i, 'classement des $1s par nombre de $2'],
  [/\b(?:environ|approximativement|à peu près|a peu pres|grosso modo)\s+/gi, ''],
  // v27.5.67 — abréviations de la saisie rapide (avant : arrêt « non reconnu », ou envoyé à Albert)
  [/\b(?:cmb|cbn|cbien|cmbn)\b/gi, 'combien'],
  [/\btx\b(?=\s+(?:d|de)\b|\s+d['’])/gi, 'taux'],
  [/\bds\s+(?=(?:le|la|les|l['’])\b)/gi, 'dans '],
  [/\bbdx\b/gi, 'Bordeaux'], [/\btlse\b/gi, 'Toulouse'],
  [/\b(en|de|la|dans la|pour la)\s+NA\b(?!\s*[:=])/g, '$1 Nouvelle-Aquitaine'],
  [/\bIDF\b/gi, 'Île-de-France'], [/\bPACA\b/gi, "Provence-Alpes-Côte d'Azur"], [/\bA?URA\b|\bARA\b/g, 'Auvergne-Rhône-Alpes'],
  [/\bHDF\b/g, 'Hauts-de-France'], [/\bBFC\b/g, 'Bourgogne-Franche-Comté'],
  // v27.5.70 — « classement des lycées par nombre d'admis en CPGE » = « quels lycées ont le plus d'admis en CPGE »
  // (avant : classement des spécialités de CPGE, présenté comme des lycées)
  [/\bclassement\s+des\s+([a-zà-ÿ]+)\s+(?:par|selon|en fonction du|d['’]apr[eè]s le)\s+(?:le\s+)?nombre\s+(de\s+|d['’]\s*)/gi, (m, x, de) => `quels ${x} ont le plus ${/^d['’]/.test(de) ? "d'" : 'de '}`],
  // v27.5.71 — « quelles formations propose le lycée X ? », « que propose l'IUT X ? » = la liste des formations de X
  // (avant : envoyé à Albert, sans calcul)
  [/^\s*(?:quelles?\s+(?:sont\s+les\s+)?formations?\s+(?:propose|offre|proposent|offrent|dispense|sont\s+propos[ée]es\s+(?:par|à|au|a)|y\s+a[- ]t[- ]il\s+(?:à|au|a|dans))|que\s+propose|qu['’]\s*est[- ]ce\s+que\s+propose)\s+(?:le\s+|la\s+|l['’]\s*|les\s+)?(?=(?:lyc[ée]e|iut|universit[ée]|[ée]cole|[ée]tablissement|institut|campus)\b)/i, 'liste des formations du '],
  // STS (sections de techniciens supérieurs) = BTS ; « licence pro » = licence professionnelle (pas toutes les licences)
  [/\bSTS\b/gi, 'BTS'],
  // v27.5.77 — « la fac » = l'université (établissement)
  [/\b(?:la |les |en )?(?:facs?|facult[ée]s?)\b(?!\s+de\s+(?:m[ée]decine|pharmacie))/gi, " l'université"],
  [/\blicences?\s+pros?\b(?!fess)/gi, 'licence professionnelle'],
  // « y a-t-il des BTS au lycée X ? », « existe-t-il des … » : un comptage (0 = non)
  [/\b(?:est[- ]ce\s+qu['’]\s*)?(?:il\s+)?y\s+a[- ]?t[- ]?il\s+(?:des|un|une|du|de\s+la|de\s+l['’]|de)\s+/gi, 'combien de '],
  [/\bexiste[- ]?t[- ]?il\s+(?:des|un|une|du|de\s+la|de\s+l['’]|de)\s+/gi, 'combien de '],
  // v27.5.64 — « je cherche les IFSI de Nouvelle-Aquitaine », « où trouver un BTS MCO à Pau ? » : la liste des
  // établissements (avant : envoyé à Albert, sans calcul)
  [/^\s*(?:je\s+(?:re)?cherche|(?:re)?cherche|trouve[sz]?[- ]moi|o[uù]\s+trouver|je\s+voudrais\s+trouver)\s+(?:les|des|un|une|tous\s+les|toutes\s+les)\s+(?!(?:infos?|informations?|renseignements?|conseils?|aides?|id[ée]es?|documents?|explications?|r[ée]ponses?|chiffres?|donn[ée]es|statistiques?|stats?|textes?|r[èe]gles?|dates?|calendriers?)\b)/i, 'quels établissements proposent des '],
  [/\b(?:dans\s+le|du|le\s+d[eé]partement(?:\s+du|\s+de\s+la|\s+des)?|d[eé]partement(?:\s+du|\s+de\s+la|\s+des)?)\s+(\d{2,3}|2[ab])\b(?!\s*(?:%|places?|formations?|candidats?|admis|premi|derni|e\b|ème))/gi,
    (m, code) => { const nom = DEPARTEMENTS_FR[String(code).toLowerCase()]; return nom ? `en ${nom}` : m; }],
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
/* ═══════════════ v27.23 — Établissements ═══════════════
   Essai sur l'open data réel : « formations à l'université de Bordeaux » → 8 (le mot « université » cherché dans
   les intitulés de formation), « combien d'établissements dans l'académie de Bordeaux » → 631 (des formations),
   « formations dans les lycées de Bordeaux » → 0, « lycée Montaigne » → arrêt. Désormais :
   - « lycée Montaigne », « université de Bordeaux », « IUT Bordeaux Montaigne » : filtre sur le nom de l'établissement
     (expression exacte d'abord, puis tous les mots) ; plusieurs établissements du même nom sont listés ;
   - « les lycées de Bordeaux », « combien d'universités » : établissements dont le nom contient « lycée » / « université » ;
   - « combien d'établissements / de lycées … », « nombre d'établissements par académie » : établissements différents. */
const NOM_ETAB_RE = /\b(lycees?|universites?|iut|etablissements?)\b/;
const COUPURES_ETAB = new Set('dans en a au aux pour par avec sur proposent propose proposant offrent offre qui ou et sont est ont combien quel quels quelles ayant en admis admises acceptes acceptees affectes inscrits boursiers boursieres apprentis sans accueillent accueille admettent recrutent comptent envoient forment'.split(' '));
const MOTS_LIENS_ETAB = new Set('de du des la le les l d'.split(' '));
function _colEtablissement(table) {
  const headers = (table?.headers || []).filter(Boolean);
  return headers.find(h => /^etablissement$/.test(_hx(h).trim()) || /^etablissement /.test(_hx(h)) && /g ea lib/.test(_hx(h)))
    || headers.find(h => /^etablissement\b/.test(_hx(h)) && !/code|uai|statut|academie|commune|departement|region|origine|accueil|scolarite/.test(_hx(h)));
}
// « I.U.T de Bordeaux » → « iut de bordeaux » : lettres isolées d'un sigle recollées, pour la recherche
const _compacte = k => String(k).replace(/\b[a-z](?: [a-z]\b)+/g, m => m.replace(/ /g, ''));
function _nomsEtablissements(table, col) {
  const cache = table._nomsEtab || (table._nomsEtab = {});
  if (cache[col]) return cache[col];
  const m = new Map();
  (table.objects || []).forEach(r => { const v = r?.[col]; if (v !== undefined && v !== null && String(v).trim()) { const k = normalizeText(v); if (!m.has(k)) m.set(k, String(v).trim()); } });
  return (cache[col] = m);
}
// { col, nom, phrase, valeurs[normalisées], noms[originaux], type, introuvable } ou null
// v27.5.53 — fichier de candidats : deux colonnes d'établissement, celui de SCOLARITÉ (« Etablissement de la scolarité »)
// et celui d'ACCUEIL (« Etablissement d'accueil accepté »). « candidats du lycée Montaigne » = lycée d'origine ;
// « admis au lycée Montaigne » = lycée d'accueil. Avant : aucune des deux n'était cherchée (« critère non reconnu »).
const _ETAB_ROLE_RE = /^etablissement|^lycee|^universite/;
function _colEtablissementRole(table, role) {
  return (table?.headers || []).filter(Boolean).find(h => {
    const x = _hx(h);
    if (!_ETAB_ROLE_RE.test(x) || /code|uai|statut|academie|commune|departement|region|ministere|contrat|type|specialite|mention|groupe/.test(x)) return false;
    return role === 'accueil' ? /accueil|accepte|affect|admis/.test(x) : /scolarite|origine/.test(x);
  }) || null;
}
const _VERBE_ACCUEIL_RE = /\b(admis|admises?|acceptes?|acceptees?|accueillis|accueillies|affectes?|affectees?|inscrits?|inscrites?|etudi\w*|vont|partent|rejoign\w*|integr\w*|poursui\w*)\b/;
function _colEtablissementQuestion(table, q, idx) {
  const acc = _colEtablissementRole(table, 'accueil'), ori = _colEtablissementRole(table, 'origine');
  if (!acc || !ori) return acc || ori;
  const avant = q.slice(0, idx).trim();
  if (/^\S+ (qui )?(accueill\w*|admett\w*|recrut\w*)\b/.test(q.slice(idx).trim())) return acc;
  if (/^\S+ (d |de l |de |des )?(accueil|acceptes?|acceptees?|d accueil)\b/.test(q.slice(idx).trim())) return acc;
  if (/\bscolaris\w*\s+(au|aux|a|en|dans)( l| le| la| les)?$|\b(du|de|des|d|issus?|issues?|venant|provenant|originaires?)( l| le| la| les)?$/.test(avant)) return ori;
  if (_VERBE_ACCUEIL_RE.test(avant)) return acc;
  return ori;
}
function etablissementDeLaQuestion(table, question) {
  if (!table || !Array.isArray(table.objects) || !table.objects.length) return null;
  const q = normalizeText(question || '');
  const m = q.match(NOM_ETAB_RE);
  if (!m) return null;
  const col = _colEtablissement(table) || _colEtablissementQuestion(table, q, m.index);
  if (!col) return null;
  const _roleCol = col !== _colEtablissement(table);
  // v27.5.53 — « par lycée », « répartition des lycées » : une dimension, pas un filtre (avant : « nom contenant lycée »,
  // puis répartition selon une autre colonne)
  if (/\bpar$/.test(q.slice(0, m.index).trim())) return null;
  // « les établissements d'accueil les plus fréquents » : la colonne désignée, pas un nom d'établissement
  if (/^(d |de l |de la |de )?(accueil|scolarite|origine)\b/.test(q.slice(m.index + m[0].length).trim())) return null;
  // « lycées agricoles / privés / professionnels » : un qualificatif traité par une autre colonne, pas un nom
  if (_roleCol && /^(agricoles?|prives?|privees?|publi(c|cs|que|ques)|professionnels?|generaux|general|generale|technologiques?|polyvalents?)\b/.test(q.slice(m.index + m[0].length).trim())) return null;
  const nom = m[1];
  const apres = q.slice(m.index + m[0].length).trim().split(' ').filter(Boolean);
  const suite = [];
  const noms = _nomsEtablissements(table, col);
  // v27.5.71 — « IUT Tarbes 3 », « Université Paris 1 » : le numéro fait partie du nom quand un établissement le porte
  // (avant : numéro ignoré, « Paris 1 » comptait aussi Paris 8, « IUT Tarbes 3 » les 9 IUT de Tarbes)
  const _avecNumero = mots => { const ph = ` ${[nom.replace(/s$/, ''), ...mots].join(' ')} `; return [...noms.keys()].some(k => ` ${_compacte(k)} `.includes(ph)); };
  for (const w of apres) {
    if (COUPURES_ETAB.has(w) || suite.length >= 6) break;
    if (/^\d/.test(w)) { if (/^\d{1,3}$/.test(w) && suite.length && _avecNumero([...suite, w])) suite.push(w); break; }
    suite.push(w);
  }
  while (suite.length && MOTS_LIENS_ETAB.has(suite[suite.length - 1])) suite.pop();
  const pluriel = /s$/.test(nom) && nom !== 'iut';
  const generique = /^etablissement/.test(nom);
  const geo = (() => { try { return formationTermsInfo(table).geo; } catch (e) { return new Set(); } })();
  // qualificatifs (« public », « privés », « sélectifs ») : pas un nom d'établissement
  let contenu = suite.filter(w => !MOTS_LIENS_ETAB.has(w) && !MOTS_QUESTION.has(w) && !FORMATION_TERM_STOP.has(w));
  if (pluriel || generique) contenu = contenu.filter(w => !geo.has(w)); // « les lycées de Bordeaux » : Bordeaux est un lieu
  const singulier = nom.replace(/s$/, '');
  if (!contenu.length) {
    if (generique) return null; // « établissements » sans nom : tous
    // v27.5.53 — fichier de candidats, établissement de SCOLARITÉ : « les lycées » = tous les établissements d'origine
    // (« LPO Louis de Foix », CFA, MFR… n'ont pas « lycée » dans leur nom : « lycées de Bordeaux » en perdait 169)
    if (col !== _colEtablissement(table) && singulier === 'lycee' && /scolarite|origine/.test(_hx(col))) return { col, tousLycees: true };
    // type d'établissement : nom contenant « lycée », « université », « IUT »
    let valeurs = [...noms.keys()].filter(k => _compacte(k).split(' ').includes(singulier));
    // v27.5.56 — « les universités qui accueillent… » : aucune université parmi les lycées d'origine → l'accueil
    if (!valeurs.length && _roleCol) {
      const autre = [_colEtablissementRole(table, 'accueil'), _colEtablissementRole(table, 'origine')].find(c => c && c !== col);
      if (autre) {
        const n2 = _nomsEtablissements(table, autre);
        const v2 = [...n2.keys()].filter(k => _compacte(k).split(' ').includes(singulier));
        if (v2.length) return { col: autre, nom: singulier, type: true, phrase: singulier, valeurs: v2, noms: v2.map(k => n2.get(k)) };
      }
    }
    // v27.5.77 — aucun établissement de ce type (« à la fac » sans université dans les données) : arrêt, pas 0
    return { col, nom: singulier, type: true, phrase: singulier, valeurs, noms: valeurs.map(k => noms.get(k)), introuvable: !valeurs.length };
  }
  const phrase = [generique ? '' : singulier, ...suite].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  let valeurs = [...noms.keys()].filter(k => ` ${_compacte(k)} `.includes(` ${phrase} `));
  if (!valeurs.length) {
    const mots = [generique ? null : singulier, ...contenu].filter(Boolean);
    valeurs = [...noms.keys()].filter(k => { const ws = _compacte(k).split(' '); return mots.every(w => ws.includes(w)); });
  }
  let horsNom = [];
  if (!valeurs.length) {
    // « lycée Montesquieu de Bordeaux » : « Bordeaux » est le lieu, pas le nom → reste un filtre de lieu
    horsNom = contenu.filter(w => geo.has(w));
    const mots = [generique ? null : singulier, ...contenu.filter(w => !geo.has(w))].filter(Boolean);
    if (horsNom.length && mots.length > 1) valeurs = [...noms.keys()].filter(k => { const ws = _compacte(k).split(' '); return mots.every(w => ws.includes(w)); });
    if (!valeurs.length) horsNom = [];
  }
  const motsNom = new Set([singulier, ...suite].filter(w => !horsNom.includes(w)));
  return { col, nom: singulier, type: false, phrase, motsNom: [...motsNom], valeurs, noms: valeurs.map(k => noms.get(k)), introuvable: !valeurs.length };
}
function unresolvedEtablissementExecution(plan, e) {
  const noms = _nomsEtablissements(plan.table, e.col);
  // pistes : établissements dont le nom contient le mot le plus rare de la demande
  const mots = (e.motsNom || []).filter(w => w.length >= 3 && w !== e.nom && !MOTS_LIENS_ETAB.has(w));
  const pistes = [...noms.keys()].filter(k => mots.some(w => k.split(' ').includes(w))).slice(0, 12).map(k => noms.get(k));
  const quoi = `aucun établissement dont le nom correspond à « ${e.phrase} »`;
  const html = `<h4>Établissement non trouvé</h4><p>Je n'ai trouvé ${escapeHtml(quoi)} dans <strong>${escapeHtml(plan.table.name || 'la table active')}</strong> (colonne « ${escapeHtml(e.col)} »). Je ne donne donc pas de chiffre.</p>`
    + (pistes.length ? `<p><strong>Établissements aux noms proches</strong> :</p><ul>${pistes.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul>` : '')
    + `<p style="font-size:12px;color:var(--gris3)">Reformulez avec le nom tel qu'il figure dans les données.</p>`;
  return { kind: 'unresolved', plan, result: { missing: [e.phrase], suggestions: pistes.map(v => ({ value: v, count: 0 })) }, text: `NON TROUVÉ : ${quoi}`, html };
}
// Un établissement = un nom dans une commune (« Lycée Gustave Eiffel » existe dans plusieurs villes)
function _cleEtablissement(table, col) {
  // la commune qui va avec cet établissement (accueil ↔ accueil, scolarité ↔ scolarité)
  const _role = /accueil|accepte|affect|admis/.test(_hx(col)) ? 'accueil' : /scolarite|origine/.test(_hx(col)) ? 'origine' : '';
  const _communes = (table?.headers || []).filter(h => /^(commune|ville)/.test(_hx(h)) && !/code|insee|postal/.test(_hx(h)));
  const commune = (_role === 'accueil' ? _communes.find(h => /accueil|accepte|affect|admis/.test(_hx(h)))
    : _role === 'origine' ? _communes.find(h => /scolarite|origine/.test(_hx(h))) : null)
    || _communes.find(h => !/origine/.test(_hx(h)));
  return r => { const n = normalizeText(r?.[col]); return n ? `${n}|${commune ? normalizeText(r?.[commune]) : ''}` : ''; };
}
const COMPTER_GEO_RE = /\b(?:combien|nombre)\s+(?:d\s+|de\s+|des\s+)?(academies|departements|communes|villes|regions)\b/;
const LISTE_GEO_RE = /\b(?:quel(?:le)?s|liste(?: des)?|lister)\s+(?:les |des )?(academies|departements|communes|villes|regions)\b/;
const _NOMS_GEO = { academies: 'académies', departements: 'départements', communes: 'communes', villes: 'communes', regions: 'régions' };
const _differents = nom => /^(académies|communes|régions)$/.test(nom) ? 'différentes' : 'différents';
// colonne du lieu demandé ; fichier de candidats : scolarité par défaut, accueil si la question parle d'accueil / d'admis
function _colonneGeoObjet(table, mot, q) {
  const hs = (table?.headers || []).filter(Boolean);
  const re = { academies: /^academie/, departements: /^departement/, communes: /^(commune|ville)/, villes: /^(commune|ville)/, regions: /^region/ }[mot];
  const cands = hs.filter(h => re.test(_hx(h)) && !/code|insee|postal/.test(_hx(h)));
  if (!cands.length) return null;
  const acc = cands.find(h => /accueil|accepte|affect|admis/.test(_hx(h))), ori = cands.find(h => /scolarite|origine/.test(_hx(h)));
  const versAcc = /\b(accueil\w*|admis|admises|acceptes?|partent|etudier|vont)\b/.test(q);
  const col = (versAcc ? acc || ori : ori || acc) || cands[0];
  return { col, nom: _NOMS_GEO[mot] };
}
const COMPTER_ETAB_RE = /\b(?:combien|nombre)\s+(?:d\s+|de\s+|des\s+)?(etablissements?|lycees|universites|iut)\b/;
function applyEtablissements(plan) {
  if (!plan || !plan.table || ['compare', 'chart_current', 'export_current_excel', 'export_current_csv'].includes(plan.tool)) return plan;
  const q = normalizeText(plan.question || '');
  let e = etablissementDeLaQuestion(plan.table, plan.question);
  if (e && e.tousLycees) { plan.lyceesTous = e.col; e = null; }
  if (e) {
    if (e.introuvable) { plan.etablissementIntrouvable = e; return plan; }
    const ACCENTS = { lycee: 'lycée', universite: 'université', iut: 'IUT', etablissement: 'établissement' };
    const joli = t => String(t).split(' ').map(w => ACCENTS[w] || w).join(' ');
    const libelle = e.type
      ? `nom contenant « ${joli(e.nom)} » (${e.noms.length.toLocaleString('fr-FR')} établissements)`
      : e.noms.length <= 4 ? e.noms.map(x => `« ${x} »`).join(', ') : `${e.noms.length} établissements dont le nom contient « ${joli(e.phrase)} »`;
    const filtre = { col: e.col, op: 'in', values: e.valeurs, value: e.type ? e.nom : e.phrase, label: libelle, source: 'etablissement', noms: e.noms };
    // v27.5.53 — le même nom lu par le planner sur l'AUTRE colonne d'établissement (accueil ↔ scolarité) : retiré
    // (avant : « candidats du lycée Montaigne » = scolarisés ET admis au lycée Montaigne)
    const _autreEtab = f => f && f.op === 'eq' && f.col !== e.col && /^(etablissement|lycee|universite)/.test(_hx(f.col)) && (e.valeurs || []).concat([e.phrase]).some(v => normalizeText(f.value) === v || ` ${normalizeText(f.value)} `.includes(` ${e.phrase} `));
    let filtres = (plan.filters || []).filter(f => f && f.col !== e.col && !_autreEtab(f));
    // un nom d'établissement n'est pas un intitulé de formation (« université »), ni un lieu (« Bordeaux » de « université de Bordeaux »)
    const motsNom = new Set(e.type ? [e.nom, e.nom + 's'] : e.motsNom);
    filtres = filtres.filter(f => {
      if (f.op === 'contains_all' && f.source === 'termes_formation') {
        const garder = (f.terms || []).map((t, i) => ({ t, l: String(f.label || '').split(' + ')[i] })).filter(x => !(Array.isArray(x.t) ? x.t : [x.t]).some(w => motsNom.has(w)));
        if (!garder.length) return false;
        if (garder.length < (f.terms || []).length) { Object.assign(f, { terms: garder.map(x => x.t), label: garder.map(x => x.l).join(' + '), value: garder.map(x => x.l).join(' + ') }); }
        return true;
      }
      if (!e.type && f.op === 'eq' && GEO_COL_RE.test(_hx(f.col))) return !normalizeText(f.value).split(' ').every(w => motsNom.has(w));
      // v27.5.71 — le numéro du nom (« lycée Bayonne 13 ») n'est pas une valeur à égaler (« Capacité = 13 » : 0 formation)
      if (!e.type && f.op === 'eq' && /^\d+$/.test(String(f.value ?? '').trim()) && motsNom.has(String(f.value).trim())) return false;
      return true;
    });
    plan.filters = [...filtres, filtre];
    plan.etablissement = e;
  }
  // v27.5.61 — « combien d'académies proposent des PASS », « combien de communes ont un BTS » : des valeurs
  // différentes de la colonne, pas des formations (avant : 67 = le nombre de PASS, sans avertissement)
  const _mG = q.match(COMPTER_GEO_RE);
  if (_mG && ['count_rows', 'sum'].includes(plan.tool) && !plan.compterEtablissements) {
    const g = _colonneGeoObjet(plan.table, _mG[1], q);
    if (g) { plan.tool = 'count_rows'; plan.compterValeurs = g; plan.sumCol = null; }
  }
  if (COMPTER_ETAB_RE.test(q)) {
    const _m = q.match(COMPTER_ETAB_RE);
    const col = _colEtablissement(plan.table) || (e && e.col) || _colEtablissementQuestion(plan.table, q, _m.index + _m[0].length - _m[1].length);
    if (col) {
      if (['group_by', 'top'].includes(plan.tool) && plan.targetCol && plan.targetCol !== col) plan.distinctCol = col;
      else if (['count_rows', 'sum', 'group_by', 'top'].includes(plan.tool)) { plan.tool = 'count_rows'; plan.compterEtablissements = col; plan.sumCol = null; }
    }
  }
  return plan;
}
// Nombre d'établissements différents par valeur de la colonne (même forme que topCountsForRows)
function distinctParGroupe(rows, col, distinctCol, table = null) {
  const cle = table ? _cleEtablissement(table, distinctCol) : (r => normalizeText(r?.[distinctCol]));
  const m = new Map(); let filled = 0;
  rows.forEach(r => { const v = r?.[col]; if (isEmptyCell(v)) return; filled++; const k = String(v).trim(); const d = cle(r); if (!d) return; if (!m.has(k)) m.set(k, new Set()); m.get(k).add(d); });
  const total = new Set(rows.map(cle).filter(Boolean)).size;
  const top = [...m.entries()].map(([value, s]) => ({ value, count: s.size, pct: total ? s.size / total * 100 : 0 })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'fr'));
  return { filled, distinct: m.size, top, totalDistinct: total };
}

/* v27.22 — Sigles et surnoms de formations → mots des intitulés officiels.
   Open data réel : « MCO », « NDRC », « SIO », « GEA », « TC », « khâgne », « Sciences Po » n'apparaissent dans
   aucun intitulé ; le mot était ignoré et le moteur comptait tous les BTS (5 351), tous les BUT (820), tout le
   fichier (khâgnes) ou toutes les formations dont l'intitulé contient « Sciences » (2 525). Un sigle n'est traduit
   que s'il est absent des intitulés de la source active (un fichier qui écrit « BTS MCO » reste lu tel quel) et que
   les mots de la traduction y sont tous. [re, traduction, sigle tel qu'il serait écrit dans les données] */
const SIGLES_FORMATIONS = [
  // BTS
  [/\bmco\b|\bmuc\b/gi, 'management commercial opérationnel', 'mco'],
  [/\bndrc\b|\bnrc\b/gi, 'négociation et digitalisation de la relation client', 'ndrc'],
  [/\bsio\b/gi, 'services informatiques aux organisations', 'sio'],
  [/\bbts\s+cg\b/gi, 'BTS comptabilité et gestion', 'cg'],
  [/\bbts\s+ci\b/gi, 'BTS commerce international', 'ci'],
  [/\bsam\b/gi, 'support à l action managériale', 'sam'],
  [/\bgpme\b|\bpme\s*-?\s*pmi\b/gi, 'gestion de la PME', 'gpme'],
  [/\bsp3s\b/gi, 'services et prestations des secteurs sanitaire et social', 'sp3s'],
  [/\besf\b/gi, 'économie sociale familiale', 'esf'],
  [/\bciel\b/gi, 'cybersécurité informatique et réseaux électronique', 'ciel'],
  [/\bati\b/gi, 'assistance technique d ingénieur', 'ati'],
  // BUT
  [/\bgea\b/gi, 'gestion des entreprises et des administrations', 'gea'],
  [/\bbut\s+tc\b/gi, 'BUT techniques de commercialisation', 'tc'],
  [/\bgeii\b/gi, 'génie électrique et informatique industrielle', 'geii'],
  [/\bgmp\b/gi, 'génie mécanique et productique', 'gmp'],
  [/\bmmi\b/gi, 'métiers du multimédia et de l internet', 'mmi'],
  [/\bqlio\b/gi, 'qualité logistique industrielle et organisation', 'qlio'],
  [/\bgccd\b/gi, 'génie civil construction durable', 'gccd'],
  [/\bbut\s+cj\b/gi, 'BUT carrières juridiques', 'cj'],
  [/\bbut\s+rt\b/gi, 'BUT réseaux et télécommunications', 'rt'],
  // prépas littéraires, Sciences Po, écoles, santé
  [/\b(?:hypo)?kh[aâ]gnes?\s+b\s*\/?\s*l\b|\bcpge\s+b\s*\/\s*l\b/gi, 'CPGE lettres et sciences sociales', 'khagne'],
  [/\b(?:hypo)?kh[aâ]gnes?\b|\bcpge\s+a\s*\/?\s*l\b/gi, 'CPGE lettres', 'khagne'], // A/L ; la B/L est une autre valeur
  // sigle null : traduit même si le mot existe ailleurs dans les données (« orthophonie » dans une licence
  // préparatoire, « Sciences Po » dans un intitulé de licence) — la traduction désigne la formation elle-même
  [/\bsciences?\s*-?\s*po\b|\biep\b|\binstituts?\s+d\s*['’]?\s*(?<![a-zà-ÿ])[eé]tudes\s+politiques\b/gi, 'instituts d études politiques', null],
  [/(?<![a-zà-ÿ])[eé]coles?\s+de\s+commerce\b/gi, 'formation des écoles de commerce et de management', null],
  [/(?<![a-zà-ÿ])[eé]coles?\s+d\s*['’]?\s*ing[eé]nieurs?\b/gi, 'formations des écoles d\'ingénieurs', null],
  [/\bstaps\b/gi, 'sciences et techniques des activités physiques et sportives', null],
  [/\borthophonie\b/gi, 'orthophoniste', null],
  [/\b(?:formations?\s+en\s+)?soins\s+infirmiers\b/gi, 'IFSI', null],
  [/\bifsi\b/gi, 'D.E infirmier', 'ifsi'],
  [/\bl1\b/gi, 'licence', null], // première année de licence : sur Parcoursup, toutes les licences sont des L1
  // v27.5.77 — abréviations de la langue courante (traduites seulement si les mots existent dans les intitulés ;
  // sinon le widget s'arrête et le dit)
  [/\bpsycho\b/gi, 'psychologie', null], [/\bsocio\b/gi, 'sociologie', null], [/\bphilo\b/gi, 'philosophie', null],
  [/\bcompta\b/gi, 'comptabilité', null], [/\bhisto\b/gi, 'histoire', null], [/\bhistoire[- ]g[ée]o\b/gi, 'histoire géographie', null],
  [/(?<![a-zà-ÿ])(?:pr[ée]pas?|cpge)\s+[ée]co(?:nomiques?)?(?![a-zà-ÿ])/gi, 'classe préparatoire économique', null],
  [/(?<![a-zà-ÿ])(?:pr[ée]pas?|cpge)\s+(?:scientifiques?|scien?t?i?f?)(?![a-zà-ÿ])/gi, 'classe préparatoire scientifique', null],
  [/(?<![a-zà-ÿ])[ée]co(?:\s*-?\s*gestion)?(?![a-zà-ÿ])/gi, 'économie', null],
  [/(?<![a-zà-ÿ])ing[ée]s?(?![a-zà-ÿ])/gi, 'ingénieurs', null], [/(?<![a-zà-ÿ])kin[ée]s?(?![a-zà-ÿ])/gi, 'kinésithérapie', null],
  [/(?<![a-zà-ÿ])(?:[ée]coles?|instituts?|formations?)\s+(?:d['’]\s*|de\s+|en\s+)?(?:infirmi[eè]re?s?|soins infirmiers)(?![a-zà-ÿ])/gi, 'IFSI', null],
];
function appliquerSiglesFormations(question, table) {
  let q = String(question ?? '');
  if (!table || !Array.isArray(table.objects) || !table.objects.length) return q;
  let info;
  try { info = formationTermsInfo(table); } catch (e) { return q; }
  if (!info.cols.length) return q;
  // texte de tous les intitulés (une fois par valeur distincte) pour chercher un sigle ou une expression
  if (!info._texteIntitules) {
    const vus = new Set();
    table.objects.forEach(r => info.cols.forEach(c => { const v = r?.[c]; if (v !== undefined && v !== null && v !== '') vus.add(normalizeText(v)); }));
    info._texteIntitules = ` ${[...vus].join(' | ')} `;
  }
  const present = expr => info._texteIntitules.includes(` ${normalizeText(expr)} `);
  SIGLES_FORMATIONS.forEach(([re, trad, sigle]) => {
    re.lastIndex = 0;
    if (!re.test(q)) return;
    re.lastIndex = 0;
    if (sigle && present(sigle)) return; // le sigle existe tel quel dans les données : on le garde
    // v27.5.65 — l'expression elle-même est un intitulé des données (« Ecoles de commerce », grand groupe) : gardée
    // (avant : traduite en « écoles de commerce et de management », introuvable dans certains fichiers → arrêt)
    re.lastIndex = 0;
    const _exp = (q.match(re) || [])[0];
    re.lastIndex = 0;
    const _valeurExacte = e => { const n = normalizeText(e); return info._texteIntitules.includes(`| ${n} |`) || info._texteIntitules.startsWith(` ${n} |`) || info._texteIntitules.endsWith(`| ${n} `) || info._texteIntitules === ` ${n} `; };
    if (!sigle && _exp && normalizeText(_exp).split(' ').length >= 3 && _valeurExacte(_exp.replace(/[ée]cole\b/i, m => m + 's'))) return;
    const mots = normalizeText(trad).split(' ').filter(w => w.length >= 3 && !FORMATION_TERM_STOP.has(w));
    if (!mots.every(w => info.words.has(w) || info.words.has(w.replace(/s$/, '')) || info.words.has(w + 's'))) return; // traduction absente : on ne change rien
    q = q.replace(re, trad);
  });
  return q;
}

// v27.5.67 — faute de frappe sur un lieu (« giroonde », « Bordaux ») : corrigée si UN SEUL lieu des données est à une
// lettre près (mot de 6 lettres ou plus, absent de toutes les valeurs du fichier). Le lieu corrigé apparaît dans
// « Sur quoi porte ce calcul ». Avant : arrêt « non reconnu ».
function _uneLettrePres(a, b) {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++;
    else if (a[i + 1] === b[j] && a[i] === b[j + 1]) { i += 2; j += 2; } // deux lettres inversées
    else { i++; j++; }
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
}
function corrigerFautesLieux(question, table) {
  if (!question || !table || !Array.isArray(table.objects) || !table.objects.length) return question;
  if (!table._lieuxFautes || table._lieuxFautes.n !== table.objects.length) {
    const lieux = new Map(), voc = new Set();
    (table.headers || []).filter(Boolean).forEach(h => {
      const d = _distinctValues(table, h);
      if (d.length > 5000) return;
      const estLieu = /acad[eé]mi|departement|region|commune|ville/.test(_hx(h)) && !/code|insee|postal/.test(_hx(h));
      d.forEach(v => {
        const n = normalizeText(v);
        n.split(' ').forEach(w => voc.add(w));
        if (estLieu && !n.includes(' ') && n.length >= 6) lieux.set(n, String(v));
      });
    });
    table._lieuxFautes = { n: table.objects.length, lieux, voc };
  }
  const { lieux, voc } = table._lieuxFautes;
  return String(question).replace(/[A-Za-zÀ-ÿ'’-]{6,}/g, mot => {
    const n = normalizeText(mot);
    if (n.includes(' ') || n.length < 6 || voc.has(n) || voc.has(n.replace(/s$/, '')) || MOTS_QUESTION_FAUTES.has(n)) return mot;
    const proches = [...lieux.keys()].filter(l => _uneLettrePres(n, l));
    return proches.length === 1 ? lieux.get(proches[0]) : mot;
  });
}
const MOTS_QUESTION_FAUTES = new Set('combien nombre formations formation candidats candidat combiens taux acces moyenne mediane repartition admises boursiers boursier selectives selectifs publiques publics privees prives licences licence etablissements etablissement lycees academie academies departement departements region regions commune communes places proposition propositions accepte acceptes apprentis bacheliers terminale generale generaux technologique professionnelle quelles quels quelle parmi depuis entre avec selon chaque toutes souhaite voudrais aimerais pourriez merci bonjour'.split(' '));

// v27.5.75 — fichier de candidats (origine ET accueil) : « d'où viennent les admis en CPGE ? » = répartition par
// département d'origine ; « où vont les boursiers ? » = répartition par académie d'accueil (avant : Albert, sans calcul)
const MOBILITE_RE = /^\s*(?:(d['’]\s*o[uù]|de quels? (?:d[ée]partements?|lyc[ée]es?))\s+(?:viennent|proviennent|sont issus|arrivent)|(o[uù]|dans quelles? (?:acad[ée]mies?|formations?))\s+(?:vont|partent|sont admis|sont admises|s['’]inscrivent|poursuivent leurs [ée]tudes))\s+(.+?)\s*\??\s*$/i;
function _avecRoles(table) {
  const hs = (table?.headers || []).filter(Boolean);
  const r = c => (typeof plannerColumnRole === 'function') ? plannerColumnRole(c) : {};
  return hs.some(h => r(h).origine) && hs.some(h => r(h).accueil);
}
function reformulerMobilite(question, table) {
  const m = String(question || '').match(MOBILITE_RE);
  if (!m || !_avecRoles(table)) return question;
  const qui = m[3].replace(/^(?:les|des)\s+/i, '');
  if (m[1]) return /lyc[ée]e/i.test(m[1]) ? `répartition des ${qui} par lycée d'origine` : `répartition des ${qui} par département d'origine`;
  return /formation/i.test(m[2]) ? `répartition des ${qui} par grand groupe de formation` : `répartition des ${qui} par académie d'accueil`;
}

function reformulerQuestion(question) {
  let q = String(question ?? '');
  REFORMULATIONS.forEach(([re, rep]) => { q = q.replace(re, rep); });
  return q.replace(/\s{2,}/g, ' ').trim();
}

function isDataEngineQuestion(question) {
  const q = normalizeText(reformulerQuestion(question || ''));
  if (!q) return false;
  try { if (getDataEngineState().lastPlan && RELANCE_SESSION.test(q)) return true; } catch (e) { /* pas d'état */ }
  // Exclusion : demandes de synthèse/résumé général → répondre via Albert narratif, pas Data Engine
  if (/^(fais |donne|produis |r[eé]dige )?(une? )?(synth[eè]se|r[eé]sum[eé]|bilan|vue d'ensemble|portrait|analyse globale)/.test(q)) return false;
  // v27.5.60 — « quels établissements proposent… », et « donne-moi la liste » après un calcul
  if (LISTE_ETAB_RE.test(q) || LISTE_GEO_RE.test(q)) return true;
  // v27.5.62 — « imprime ce résultat », « en PDF » : impression de la dernière réponse calculée
  if (PDF_RE.test(q) && !/\b(excel|xlsx|csv)\b/.test(q)) return true;
  try { if (getDataEngineState().lastPlan && RELANCE_LISTE.test(q)) return true; } catch (e) { /* pas d'état */ }
  try { if (MOBILITE_RE.test(question || '') && _avecRoles((getActiveQueryTables() || [])[0])) return true; } catch (e) { /* source absente */ }
  // v27.5.67 — « quels BTS ont un taux d'accès inférieur à 10 % ? », « les BTS dont le taux d'accès est < 30 % » : liste calculée
  try { if (LISTE_CONDITION_RE.test(q) && conditionsChiffrees((getActiveQueryTables() || [])[0], question).length) return true; } catch (e) { /* source absente */ }
  // v27.14 — classement selon un chiffre (« les formations les plus demandées »)
  try { if (CLASSEMENT_CUE.test(q) && detecterClassement((getActiveQueryTables() || [])[0], question)) return true; } catch (e) { /* source absente */ }
  // v27.15 — taux et parts (« part des boursiers parmi les admis »)
  try { if (detecterPart((getActiveQueryTables() || [])[0], question)) return true; } catch (e) { /* source absente */ }
  // v27.16 — « les places en BTS ont-elles augmenté depuis 2024 ? »
  try { const _t = (getActiveQueryTables() || [])[0]; if (sessionsDeLaQuestion(_t, question) && (formationTermsFromQuestion(_t, question).terms.length || /\b(places?|candidats?|admis|formations?|boursiers?|capacite|taux|part|bts|pass|cpge|licences?|but)\b/.test(q))) return true; } catch (e) { /* source absente */ }
  return /taux d ?acces|compare|comparaison|comparer|versus| vs |combien|nombre|\btotale?\b|effectif|compte|compter|repartition|r[eé]partition|ventilation|par |groupe|group[eé]|top|classement|principa|plus frequen|plus fréquent|croise|crois[eé]|tableau crois[eé]|pivot|moyen|moyenne|median|m[eé]diane|minimum|maximum|min|max|export|excel|csv|liste|filtre|graphique|graphe|diagramme|histogramme|camembert|barres?|boursier|basque|hors|sauf|seulement|uniquement|visualis|repr[eé]sent|montre-?moi|dessine|trace|issus?\s+d[ue]|originaires?|venant\s+d[ue]|provenant|scolaris|scolarit/.test(q) || isListValuesRequest(question) || isFollowUpQuestion(question);
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
  if (/moyen|moyenne|median|m[eé]diane|minimum|maximum|\bmin\b|\bmax\b/.test(q.replace(/\b(lycees?|colleges?|etablissements?|universites?) (max|min)\b/g, ' '))) return 'stats';
  // v27.24 — « taux d'accès des PASS », « taux d'accès au lycée Montaigne » : statistiques du taux (pas un comptage)
  if (/\btaux d ?acces\b/.test(q) && !/\b(combien|nombre|plus|moins|classement|top)\b|\b(inferieur|superieur|egal)\b/.test(q)) return 'stats';
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

// v27.5.59 — Plusieurs valeurs d'une même information reliées par « et / ou » : « en Gironde et dans les Landes »,
// « BTS ou BUT », « à Bordeaux ou à Pau », « hors Bordeaux et hors Toulouse ». Avant : arrêt, ou pire, seule la première
// valeur était comptée (« à Bordeaux ou à Pau » = Bordeaux seul). Méthode : la question est rejouée avec chacune des deux
// valeurs ; si les deux plans ne diffèrent que par des filtres sur la (les) même(s) colonne(s), on garde les filtres
// communs et on ajoute « l'un ou l'autre » (ou les deux exclusions pour « hors X et hors Y »). On ne touche à rien quand
// la question est déjà comprise avec ses deux critères (« maths et physique », « boursiers et apprentis » : les deux à la fois).
let _enUnion = false;
const _COUPE_UNION = new Set('par pour qui avec sans selon parmi combien admis admises acceptes inscrits ayant dont'.split(' '));
const _LIENS_UNION = new Set('de du des d en a au aux dans les le la l sur chez'.split(' '));
function _planCasse(p) {
  if (!p || !p.table) return true;
  if (p.unresolvedTerms && p.unresolvedTerms.length) return true;
  if (p.etablissementIntrouvable) return true;
  try {
    if (conceptsNonFiltres(p).length) return true;
    if (motsNonReconnus(p).length) return true;
    const tf = (p.filters || []).find(f => f && f.op === 'contains_all');
    if (tf && !applyLocalActionFilters(p.table.objects || [], [tf]).length) return true;
  } catch (e) { return true; }
  return false;
}
function _clesFiltres(p) { return new Set((p?.filters || []).map(f => f.op === 'contains_all' ? `T::${(f.terms || []).map(t => [].concat(t)[0]).join('+')}` : f.op === 'in' ? `${f.col}::in::${(f.values || []).join('|')}` : _cleFiltre(f))); }
function _cleUnion(f) { return f.op === 'contains_all' ? `T::${(f.terms || []).map(t => [].concat(t)[0]).join('+')}` : f.op === 'in' ? `${f.col}::in::${(f.values || []).join('|')}` : _cleFiltre(f); }
function _colUnion(f) { return f.op === 'contains_all' ? FORMATION_TERMS_COL : f.col; }
// même famille d'information : lieux, formations (catégorie ou intitulé), établissements, ou la même colonne
function _familleUnion(f, table) {
  if (f.op === 'contains_all' || f.source === 'categorie_formation') return 'formation';
  const h = _hx(f.col || '');
  try { if (formationTermsInfo(table).cols.includes(f.col)) return 'formation'; } catch (e) { /* source sans formation */ }
  if (/^(etablissement|lycee|universite)/.test(h)) return `etab:${/accueil|accepte|affect|admis/.test(h) ? 'acc' : 'ori'}`;
  if (GEO_COL_RE.test(h)) return `geo:${/accueil|accepte|affect|admis/.test(h) ? 'acc' : 'ori'}`;
  return f.col;
}
function _essaiUnion(question, filterContextText, plan0) {
  const q = normalizeText(reformulerQuestion(question || ''));
  const toks = q.split(' ');
  const idx = toks.map((w, i) => (w === 'et' || w === 'ou') ? i : -1).filter(i => i > 0);
  if (!idx.length || !plan0 || ['compare', 'chart_current', 'export_current_excel', 'export_current_csv'].includes(plan0.tool)) return null;
  if (plan0.part && plan0.part.groupe) return null; // « des boursiers et des non boursiers » : déjà un taux par groupe
  // la question est déjà comprise (aucun signe de critère perdu) : rien à faire, sauf si un plan « une seule valeur » l'égale
  // aussi « cassé » : des filtres incompatibles (« admis en licence ou en BUT » lu licence ET BUT : 0 ligne)
  let casse0 = _planCasse(plan0);
  if (!casse0) { try { casse0 = !applyLocalActionFilters(plan0.table.objects || [], plan0.filters || []).length; } catch (e) { /* plan sans lignes */ } }
  const cles0 = _clesFiltres(plan0);
  let meilleur = null;
  const memo = new Map();
  const planDe = x => { if (!memo.has(x)) { let p = null; try { p = detectDataEnginePlan(x, x); } catch (e) { p = null; } memo.set(x, p && !_planCasse(p) ? p : null); } return memo.get(x); };
  const motsPlan0 = new Set();
  (plan0.filters || []).forEach(f => [f.value, f.label, ...(f.values || []), ...(f.terms || []).flat()].forEach(v => normalizeText(v || '').split(' ').forEach(w => motsPlan0.add(w))));
  const oublie = x => x.filter(w => !_LIENS_UNION.has(w) && w.length >= 2).some(w => !motsPlan0.has(w));
  // vocabulaire des valeurs du fichier (et sigles courants) : une valeur de chaque côté, sinon découpage inutile
  const t0 = plan0.table;
  if (!t0._vocUnion || t0._vocUnion.n !== (t0.objects || []).length) {
    const v = new Set('bts but dut iut licence licences prepa prepas cpge pass las pro techno general generale professionnel technologique ifsi staps'.split(' '));
    (t0.headers || []).filter(Boolean).forEach(h => { const d = _distinctValues(t0, h); if (d.length <= 3000) d.forEach(x => normalizeText(x).split(' ').forEach(w => w.length >= 2 && v.add(w))); });
    t0._vocUnion = { n: (t0.objects || []).length, v };
  }
  const voc = t0._vocUnion.v;
  const porteur = x => x.some(w => !_LIENS_UNION.has(w) && (voc.has(w) || voc.has(w.replace(/s$/, ''))));
  // les découpages les plus courts d'abord ; le premier qui convient est retenu
  for (let taille = 2; taille <= 9 && !meilleur; taille++) {
    for (const k of idx) {
      if (meilleur) break;
      for (let l = 1; l <= 4 && !meilleur; l++) {
        const r = taille - l;
        if (r < 1 || r > 5 || k - l < 0 || k + r >= toks.length) continue;
        const droite = toks.slice(k + 1, k + 1 + r), gauche = toks.slice(k - l, k);
        if (droite.some(w => _COUPE_UNION.has(w) || w === 'et' || w === 'ou') || _LIENS_UNION.has(droite[droite.length - 1])) continue;
        if (gauche.some(w => _COUPE_UNION.has(w) || w === 'et' || w === 'ou') || _LIENS_UNION.has(gauche[0])) continue;
        // B : la valeur de droite à la place de celle de gauche (ses mots de liaison gardés : « à Pau », « de BUT »)
        const liens = droite.filter((w, i) => i < droite.length - 1 && _LIENS_UNION.has(w) && droite.slice(0, i).every(x => _LIENS_UNION.has(x)));
        const contenu = droite.slice(liens.length);
        if (!porteur(contenu) || !porteur(gauche) || !voc.has(contenu[contenu.length - 1].replace(/s$/, '')) && !voc.has(contenu[contenu.length - 1])) continue;
        // la question entière est comprise et ses deux valeurs y figurent (« Droit et Economie ») : rien à faire
        if (!casse0 && !oublie(contenu) && !oublie(gauche)) continue;
        const qa = [...toks.slice(0, k), ...toks.slice(k + 1 + r)].join(' ');
        const qb = [...toks.slice(0, k - l), ...contenu, ...toks.slice(k + 1 + r)].join(' ');
        const pa = planDe(qa); if (!pa) continue;
        const pb = planDe(qb); if (!pb || pa.tool !== pb.tool) continue;
        const ka = _clesFiltres(pa), kb = _clesFiltres(pb);
        const dA = (pa.filters || []).filter(f => !kb.has(_cleUnion(f))), dB = (pb.filters || []).filter(f => !ka.has(_cleUnion(f)));
        if (!dA.length || !dB.length) continue;
        const colsA = new Set(dA.map(f => _familleUnion(f, pa.table))), colsB = new Set(dB.map(f => _familleUnion(f, pa.table)));
        if (colsA.size !== colsB.size || [...colsA].some(c => !colsB.has(c))) continue;
        // question comprise : seulement si elle se réduit à l'une des deux valeurs (« à Bordeaux ou à Pau » = Bordeaux)
        if (!casse0 && ![ka, kb].some(kx => kx.size === cles0.size && [...kx].every(x => cles0.has(x)))) continue;
        meilleur = { pa, pb, dA, dB };
      }
    }
  }
  if (!meilleur) return null;
  const { pa, dA, dB } = meilleur;
  const communs = (pa.filters || []).filter(f => !dA.includes(f));
  const exclusions = [...dA, ...dB].every(f => f.op === 'neq');
  const enClair = g => g.map(f => _filtreEnClair(f)).join(' et ');
  const simple = dA.length === 1 && dB.length === 1 && dA[0].op === 'eq' && dB[0].op === 'eq' && dA[0].col === dB[0].col;
  const libelle = simple ? `« ${dA[0].col} » = ${dA[0].label || dA[0].value} ou ${dB[0].label || dB[0].value}` : `${enClair(dA)}, ou ${enClair(dB)}`;
  const filtres = exclusions ? [...communs, ...dA, ...dB]
    : [...communs, { col: _colUnion(dA[0]), op: 'or', groupes: [dA, dB], value: libelle, label: libelle, source: 'union' }];
  return { ...pa, question: plan0.question || question, filters: filtres, union: true, unresolvedTerms: null };
}
function detectDataEnginePlan(question, filterContextText = question) {
  const plan = _gardeRelances(_detectDataEnginePlanBase(question, filterContextText), question);
  if (_enUnion || !plan || !/\b(et|ou)\b/.test(normalizeText(question || ''))) return plan;
  _enUnion = true;
  // les questions rejouées partent de l'état de conversation actuel, qui est restauré ensuite
  const etat = getDataEngineState();
  const sauve = { lastPlan: etat.lastPlan, lastExecution: etat.lastExecution };
  try { return _essaiUnion(question, filterContextText, plan) || plan; }
  catch (e) { return plan; }
  finally { _enUnion = false; etat.lastPlan = sauve.lastPlan; etat.lastExecution = sauve.lastExecution; }
}
// v27.5.61 — relances qui perdaient le résultat précédent :
// - un export juste après un résultat filtré (« exporte », « donne-moi le fichier ») garde ses filtres, sauf « tout »
//   (avant : « donne moi la liste » exportait les 14 252 lignes de l'open data, sans filtre) ;
// - « donne-moi la liste » sans question précédente : le widget demande « la liste de quoi ? » au lieu d'exporter tout
// v27.5.62 — « exporte cette liste en PDF », « imprime ce résultat » : la dernière réponse calculée, imprimée comme avec
// le bouton « 🖨 PDF » (avant : un fichier Excel)
const PDF_RE = /\b(pdf|imprim\w*|impression)\b/;
function _gardeRelances(plan, question) {
  if (_enUnion) return plan;
  const q = normalizeText(question || '');
  if (PDF_RE.test(q) && !/\b(excel|xlsx|csv)\b/.test(q)) {
    let prev = null; try { prev = getDataEngineState().lastPlan; } catch (e) { prev = null; }
    const t = plan?.table || prev?.table || (getActiveQueryTables() || [])[0] || null;
    return { tool: 'export_pdf', table: t, question, filters: [], createdAt: new Date().toISOString() };
  }
  if (!plan) return plan;
  let prev = null; try { prev = getDataEngineState().lastPlan; } catch (e) { prev = null; }
  // « quels établissements ? » sans question précédente ni critère : « lesquels ? »
  if (!/^export/.test(plan.tool || '') && RELANCE_LISTE.test(q) && !(plan.filters || []).length) {
    let prev0 = null; try { prev0 = getDataEngineState().lastPlan; } catch (e) { prev0 = null; }
    if (!prev0) plan.clarification = 'quels établissements, pour quelle formation et quel lieu ? Précisez (par exemple « quels établissements proposent un BTS MCO en Gironde ? »)';
  }
  if (/^export/.test(plan.tool || '')) {
    const tout = /\b(tout|toute|toutes|tous|entier|entiere|complet|complete|integral|integrale|ensemble du|la table|le fichier entier|toutes les lignes)\b/.test(q);
    if (tout && prev && (plan.filters || []).length && (plan.filters || []).every(f => (prev.filters || []).some(g => _cleFiltre(g) === _cleFiltre(f)))) {
      plan.filters = []; plan.filtresRepris = []; // « exporte toute la table » : tout, sans les filtres précédents
      if (plan.tool === 'export_current_excel') plan.tool = 'export_excel';
      if (plan.tool === 'export_current_csv') plan.tool = 'export_csv';
    } else if (!(plan.filters || []).length && prev && (prev.filters || []).length && !tout && prev.table === plan.table) {
      plan.filters = prev.filters.map(f => ({ ...f }));
      plan.filtresRepris = plan.filters.map(_cleFiltre);
    } else if (!(plan.filters || []).length && !prev && RELANCE_LISTE.test(q)) {
      plan.clarification = 'la liste de quoi ? Précisez ce qu\'il faut lister (par exemple « liste des BTS en Gironde », « quels établissements proposent un BTS MCO en Gironde ») ; pour tout le fichier : « exporte toute la table »';
    }
  }
  return plan;
}
// v27.5.61 — objet demandé (« combien d'académies… », « quels établissements… ») : le calcul doit en compter
const OBJET_RE = /\b(?:combien|nombre|liste|lister|quel(?:le)?s)\s+(?:d |de |des |les |sont les )?(etablissements?|lycees?|universites?|ecoles?|iut|academies|departements|communes|villes|regions)\b/;
function objetNonRespecte(plan) {
  const m = normalizeText(plan.question || '').match(OBJET_RE);
  if (!m || ['compare', 'export_excel', 'export_csv', 'chart_current', 'export_current_excel', 'export_current_csv', 'evolution'].includes(plan.tool)) return null;
  const etab = /^(etablissement|lycee|universite|ecole|iut)/.test(m[1]);
  const re = etab ? /^(etablissement|lycee|universite)/ : { academies: /^academie/, departements: /^departement/, communes: /^(commune|ville)/, villes: /^(commune|ville)/, regions: /^region/ }[m[1]];
  const ok = c => c && re.test(_hx(c));
  if (etab && plan.compterEtablissements) return null;
  if (plan.compterValeurs && ok(plan.compterValeurs.col)) return null;
  if ([plan.targetCol, plan.distinctCol, plan.classement?.entite?.col, plan.part?.groupe, plan.statsDim].some(ok)) return null;
  if (plan.tool === 'part') return null; // « quelle part des établissements… » : la part dit sur quoi elle porte
  return etab ? 'établissements' : _NOMS_GEO[m[1]];
}
function _detectDataEnginePlanBase(question, filterContextText = question) {
  question = reformulerQuestion(question);
  // v27.25 — « et l'an dernier ? », « et en 2024 ? » : la question précédente, sur l'autre session
  const _prevPlan = getDataEngineState().lastPlan;
  if (_prevPlan && _prevPlan.table && RELANCE_SESSION.test(normalizeText(question)) && !['compare', 'chart_current', 'export_current_excel', 'export_current_csv'].includes(_prevPlan.tool)) {
    const base = _prevPlan.questionSansSession || _prevPlan.question || '';
    const p = { ..._prevPlan, filters: (_prevPlan.filters || []).map(f => ({ ...f })), sessionsDemandees: null, sessionUnique: null, blockId: null,
      question: `${base} ${question}`, questionSansSession: base, filtresRepris: (_prevPlan.filters || []).map(_cleFiltre), createdAt: new Date().toISOString() };
    if (p.tool === 'stats_groupes') p.tool = 'stats';
    return applySessions(p);
  }
  if (!isDataEngineQuestion(question)) return null;
  const tables = getActiveQueryTables();
  if (!tables.length) return null;
  const table = tables[0]; // Grist est déjà prioritaire dans getActiveQueryTables()
  // v27.22 — sigles (« BTS MCO », « BUT GEA », « khâgne », « Sciences Po ») → mots des intitulés de la source
  const _avecSigles = appliquerSiglesFormations(corrigerFautesLieux(reformulerMobilite(question, table), table), table);
  if (_avecSigles !== question) { if (filterContextText === question) filterContextText = _avecSigles; question = _avecSigles; }
  if (!table || !table.objects || !table.objects.length) return null;
  const headers = table.headers || Object.keys(table.objects[0] || {});

  // "Graphique" / "Excel" seuls agissent sur le dernier résultat calculé,
  // pas sur une nouvelle requête replanifiée.
  const currentPlan = buildCurrentResultPlan(question, table);
  if (currentPlan) return currentPlan;

  let tool = inferMeasureIntent(question);
  let _listeCondition = false;
  // v27.5.60 — « quels établissements proposent le BTS MCO en Gironde ? » : une liste d'établissements calculée
  if ((!tool || /^export/.test(tool)) && (LISTE_ETAB_RE.test(normalizeText(question)) || LISTE_GEO_RE.test(normalizeText(question))) && !hasExportWords(normalizeText(question))) tool = 'group_by';
  // v27.14 — « quelle formation a le plus de candidats » : classement, même sans mot d'analyse reconnu
  if ((!tool || tool === 'stats' || tool === 'count_rows') && detecterClassement(table, question)) tool = 'top';
  if ((!tool || tool === 'group_by') && detecterPart(table, question)) tool = 'count_rows';
  if (!tool && sessionsDeLaQuestion(table, question)) tool = 'count_rows';
  if (!tool && LISTE_CONDITION_RE.test(normalizeText(question)) && conditionsChiffrees(table, question).length) { tool = 'group_by'; _listeCondition = true; }
  if (!tool) return null;

  if (tool === 'compare') {
    const groups = detectCompareGroups(table, question);
    if (groups.length >= 2) {
      const _colsG = new Set(groups.flatMap(g => (g.filters || []).map(gf => gf.col)));
      const _valsG = new Set(groups.flatMap(g => (g.filters || []).map(gf => normalizeText(gf.value))));
      // mots des valeurs des groupes (« cpge », « bts » de « CPGE - CPES », « BTS - BTSA… ») : un intitulé « contenant CPGE
      // et BTS » n'est pas un critère commun (avant : 0 ligne de chaque côté)
      const _motsG = new Set([..._valsG].flatMap(v => v.split(/[^a-z0-9]+/)).filter(w => w.length >= 2));
      const _horsGroupes = f => f && !_colsG.has(f.col) && !_valsG.has(normalizeText(f.value)) && !(f.op === 'contains_all' && (f.terms || []).every(t => [].concat(t).some(w => _valsG.has(normalizeText(w)) || _motsG.has(normalizeText(w)))));
      let baseFilters = strictFiltersFromQuestion(table, question).filter(_horsGroupes);
      // v27.5.64 — critères communs aux deux groupes (« le nombre de BTS en Gironde et dans les Landes » : BTS),
      // lus par le planner ; avant : perdus, la comparaison portait sur toutes les formations
      try {
        if (typeof buildPlannerPlan === 'function') {
          const pp = applyFormationTerms(buildPlannerPlan(question, question, table, 'count_rows'));
          baseFilters = mergeFiltersUnique(baseFilters, ((pp && pp.filters) || []).filter(_horsGroupes));
        }
      } catch (e) { /* planner indisponible : filtres stricts seuls */ }
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
    const _mr = normalizeText(question).match(/\b(candidats?|candidatures?|voeux|demandes?|admis)\s+par\s+place\b/);
    if (plannerPlan && _mr) {
      const hs = (table.headers || []).filter(Boolean);
      const den = hs.find(h => /capacit/.test(_hx(h)) && _estNumerique(table, h));
      const num = /admis/.test(_mr[1]) ? hs.find(h => /ayant accepte.*admis|\badmis\b/.test(_hx(h)) && /effectif/.test(_hx(h)) && _estNumerique(table, h)) : hs.find(h => /effectif total des candidats pour une formation|^nb.*voeux|voeux confirmes/.test(_hx(h)) && _estNumerique(table, h));
      const p = applyConditionsChiffrees(applyEtablissements(applyFormationTerms(plannerPlan)));
      if (!num || !den) { p.tool = 'count_rows'; p.mesureIntrouvable = 'places ou de candidats'; return inheritConversationContext(p, question); }
      p.tool = 'ratio'; p.targetCol = null;
      p.ratio = { num, den, libelle: /admis/.test(_mr[1]) ? 'Admis par place' : 'Candidats par place', unNum: /admis/.test(_mr[1]) ? 'admis' : 'candidats' };
      return inheritConversationContext(p, question);
    }
    if (plannerPlan && _listeCondition) {
      // v27.5.67 — liste des formations qui remplissent la condition (intitulés), pas une répartition d'une colonne chiffrée
      const p = applyConditionsChiffrees(applyEtablissements(applyFormationTerms(plannerPlan)));
      p.tool = 'group_by'; p.listMode = true; p.limit = 300;
      p.targetCol = pickListColumn(table, p.filters) || p.targetCol;
      return inheritConversationContext(p, question);
    }
    if (plannerPlan) return inheritConversationContext(applySessions(applyPart(applyConditionsChiffrees(applyClassement(applyMeasureSum(applyListMode(applyEtablissements(applyFormationTerms(plannerPlan)))))))), question);
  }

  // Fallback V16 si planner indisponible.
  const q = normalizeText(question || '');
  const mentionedCols = findMentionedColumns(headers, question, 4);
  const targetCol = tool === 'group_by' ? (detectTargetColumn(headers, q) || mentionedCols[0] || null) : null;
  // V25.1 — idem : le fallback ne doit pas analyser le contexte textuel
  // précédent comme s'il s'agissait de la question utilisateur.
  const filters = detectFilters(table, normalizeText(question || ''), targetCol);
  return inheritConversationContext(applySessions(applyPart(applyConditionsChiffrees(applyClassement(applyMeasureSum(applyListMode(applyEtablissements(applyFormationTerms({
    tool,
    table,
    filters,
    targetCol,
    mentionedCols,
    question,
    createdAt: new Date().toISOString()
  })))))))), question);
}


function currentExecutionToRows(exec) {
  if (!exec) return [];
  const p = exec.plan || {};
  if (exec.kind === 'part_groupes') {
    const r = exec.result; const lp = _libellePart(p);
    return r.groupes.map(g => ({ [r.groupe]: g.valeur, 'Part (%)': g.pct === null ? '' : Math.round(g.pct * 10) / 10, [`Effectif (${lp.quoi})`]: g.num, [`Total (${lp.sur})`]: g.den }));
  }
  if (exec.kind === 'stats_groupes') {
    const r = exec.result;
    return r.groupes.map(g => ({ [r.dim]: g.valeur, Formations: g.numericCount, Moyenne: g.avg === null ? '' : Math.round(g.avg * 100) / 100, 'Médiane': g.median ?? '', Min: g.min ?? '', Max: g.max ?? '' }));
  }
  if (exec.kind === 'evolution_groupes') {
    const r = exec.result; const [s1, s2] = r.sessions;
    return (r.lignes || []).map(l => ({ [r.col]: l.valeur, ...(r.type === 'classement' ? { [`Rang ${s2}`]: l.rang2 ?? '', [`Rang ${s1}`]: l.rang1 ?? '' } : {}), [`${s1} (${r.unite})`]: l.v1 ?? '', [`${s2} (${r.unite})`]: l.v2 ?? '', 'Écart': l.ecart ?? '', 'Évolution (%)': l.ecartPct === null ? '' : Math.round(l.ecartPct * 10) / 10 }));
  }
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
    const _mes = exec.result?.somme ? `${exec.result.somme.unite.replace(/^./, c => c.toUpperCase())} (somme)` : 'Nombre';
    return (exec.result?.rows || []).map(r => ({
      [label]: r.value,
      [_mes]: r.count,
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
  // v27.5.54 — taux par groupe : barres des parts (en %)
  if (prev.kind === 'part_groupes') {
    const r = prev.result; const lp = _libellePart(prev.plan);
    const rows = r.groupes.slice(0, 12).map(g => ({ value: g.valeur, count: Math.round((g.pct ?? 0) * 10) / 10 }));
    const titre = `Graphique — part de ${lp.quoi} par ${_shortColName(r.groupe) || r.groupe} (%)`;
    const html = `${deTitleHtml(titre, prev.plan?.blockId, prev.plan?.originalTitle || titre)}${renderMiniBarChart(rows, rows.reduce((t, x) => t + x.count, 0), 'parts.png')}`;
    return { kind: 'part_groupes', plan: prev.plan, result: prev.result, text: prev.text, html };
  }
  // v27.24 — statistiques par groupe : barres de la statistique demandée
  if (prev.kind === 'stats_groupes') {
    const r = prev.result;
    const rows = r.groupes.slice(0, 12).map(g => ({ value: g.valeur, count: Math.round((g[r.demandee] ?? 0) * 100) / 100 }));
    const titre = `Graphique — ${_shortColName(r.col)} : ${_NOMS_STAT[r.demandee]} par ${_shortColName(r.dim) || r.dim}`;
    const html = `${deTitleHtml(titre, prev.plan?.blockId, prev.plan?.originalTitle || titre)}${renderMiniBarChart(rows, rows.reduce((t, x) => t + x.count, 0), 'statistiques.png')}`;
    return { kind: 'stats_groupes', plan: prev.plan, result: prev.result, text: prev.text, html };
  }
  // v27.18 — évolution par groupe : deux barres par groupe (session précédente, session courante)
  if (prev.kind === 'evolution_groupes') {
    const r = prev.result; const [s1, s2] = r.sessions;
    const rows = r.lignes.slice(0, 6).flatMap(l => [{ value: `${l.valeur} — ${s1}`, count: l.v1 || 0 }, { value: `${l.valeur} — ${s2}`, count: l.v2 || 0 }]);
    const titre = `Graphique — ${r.unite} par ${_shortColName(r.col) || r.col}, ${s1} et ${s2}`;
    const html = `${deTitleHtml(titre, prev.plan?.blockId, prev.plan?.originalTitle || titre)}${renderMiniBarChart(rows, rows.reduce((t, x) => t + x.count, 0), 'evolution_groupes.png')}${r.lignes.length > 6 ? `<p style="font-size:12px;color:var(--gris3)">Les 6 premiers groupes sur ${r.lignes.length}.</p>` : ''}`;
    return { kind: 'evolution_groupes', plan: prev.plan, result: prev.result, text: prev.text, html };
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
  // v27.5.53 — doublon = même valeur sur deux colonnes du MÊME genre (académie d'accueil / de scolarité = Bordeaux),
  // jamais deux colonnes d'état différentes (« Apprenti = Oui » et « A répondu favorablement = Oui » : l'une était
  // retirée, « combien d'apprentis admis en BTS » perdait le filtre apprenti)
  // (« A eu une proposition » et « A répondu favorablement » : deux informations, pas un doublon)
  const genre = c => { const k = (typeof plannerColumnKind === 'function') ? String(plannerColumnKind(c)).replace(/_(accueil|origine_nom)$/, '') : ''; return k === 'admission' ? `${k}:${normalizeText(c)}` : k; };
  groupes.forEach(g0 => {
    const parGenre = new Map();
    g0.forEach(f => { const k = genre(f.col); if (!parGenre.has(k)) parGenre.set(k, []); parGenre.get(k).push(f); });
    parGenre.forEach(g => {
    const cols = new Set(g.map(f => f.col));
    if (cols.size < 2) return;
    const voulu = g.find(f => veutOrigine ? role(f.col).origine : role(f.col).accueil) || g[0];
    g.forEach(f => { if (f !== voulu) retirer.add(f); });
    });
  });
  plan.filters = filters.filter(f => !retirer.has(f));
  return plan;
}

function finalSanitizeAnalysisPlan(plan) {
  return (_exclusionsMultiples(_filiereExacte(_retirerValeursEmboitees(resolveRoleDuplicates(_finalSanitizeAnalysisPlanBase(plan))))));
}
// v27.5.72 — « hors BTS et hors BUT », « sauf les BTS et les BUT », « sauf BTS, BUT et CPGE » : chaque valeur citée après
// l'exclusion est exclue (avant : BTS exclu mais BUT EXIGÉ, « intitulé contenant BUT »)
function _exclusionsMultiples(plan) {
  if (!plan || !plan.table || !Array.isArray(plan.filters)) return plan;
  const q = normalizeText(String(plan.question || '').replace(/\s*,\s*/g, ' et '));
  const m = q.match(/\b(?:hors|sauf|excepte|exceptes|en dehors (?:de|des|du|d)|a l exception (?:de|des|du|d))\s+((?:(?:les|des|la|le|l|de|du|d|hors|sauf|en|dans|au|aux|a)\s+)*[a-z0-9]+(?:\s*(?:,|et|ni|ou)\s+(?:(?:les|des|la|le|l|de|du|d|hors|sauf|en|dans|au|aux|a)\s+)*[a-z0-9]+)+)/);
  if (!m) return plan;
  const mots = m[1].split(/\s*(?:,|\bet\b|\bni\b|\bou\b)\s*/).map(x => x.replace(/^(?:(?:les|des|la|le|l|de|du|d|hors|sauf|en|dans|au|aux|a)\s+)+/, '').trim()).filter(Boolean);
  if (mots.length < 2) return plan;
  let col = (plan.table.headers || []).find(h => /^filiere de formation tres agregee$/.test(normalizeText(h)));
  let vals = col ? mots.map(w => _distinctValues(plan.table, col).find(x => normalizeText(x) === w || normalizeText(x) === w.replace(/s$/, ''))) : [];
  if (!col || vals.some(v => !v)) {
    // fichier de candidats (« Grands groupes de formation » : « BTS - BTSA - DTS - DMA », « L1 - CUPGE… ») : la valeur que
    // le moteur donne à chaque mot seul (« licence » → L1…), toutes dans la même colonne
    const lus = mots.map(w => _filtresDePhrase(plan.table, w).filter(f => f && f.op === 'eq' && f.source !== 'condition_chiffree'));
    if (lus.some(l => l.length !== 1) || new Set(lus.map(l => l[0].col)).size !== 1) return plan; // pas une liste de formations : on ne touche à rien
    col = lus[0][0].col; vals = lus.map(l => l[0].value);
  }
  const ns = new Set(vals.map(normalizeText));
  const motsN = new Set(mots.flatMap(w => [w, w.replace(/s$/, '')]));
  const touche = f => f && ((f.col === col && ns.has(normalizeText(f.value))) || (f.op === 'in' && f.col === col && (f.values || []).every(v => ns.has(normalizeText(v)))) ||
    (f.op === 'or' && (f.groupes || []).flat().every(g => g.col === col && ns.has(normalizeText(g.value)))) ||
    (f.op === 'contains_all' && (f.terms || []).every(t => [].concat(t).some(w => motsN.has(normalizeText(w))))) || (f.op === 'contains_all' && (f.terms || []).every(t => [].concat(t).some(w => ns.has(normalizeText(w)) || ns.has(normalizeText(w).replace(/s$/, ''))))));
  plan.filters = [...plan.filters.filter(f => !touche(f)), ...vals.map(v => ({ col, op: 'neq', value: v, label: null, source: 'exclusion' }))];
  return plan;
}
// v27.5.72 — un seul mot de formation qui est EXACTEMENT une filière (« licence » → Licence) : la filière, comme dans
// « combien de licences » (avant : « bacheliers généraux admis en licence » cherchait « licence » dans les intitulés et
// comptait aussi les LAS : 69 929 au lieu de 68 757)
function _filiereExacte(plan) {
  if (!plan || !plan.table || !Array.isArray(plan.filters)) return plan;
  if ((plan.unresolvedTerms || []).length || plan.clarification || /\boptions?\b/.test(normalizeText(plan.question || ''))) return plan;
  const termes = plan.filters.filter(f => f && f.op === 'contains_all' && f.source === 'termes_formation');
  if (termes.length !== 1 || (termes[0].terms || []).length !== 1) return plan;
  const mots = [].concat(termes[0].terms[0]).map(w => normalizeText(String(w)));
  const col = (plan.table.headers || []).find(h => /^filiere de formation tres agregee$/.test(normalizeText(h)));
  if (!col || plan.filters.some(f => f && f.col === col)) return plan;
  const v = _distinctValues(plan.table, col).find(x => mots.some(w => normalizeText(x) === w || normalizeText(x) === w.replace(/s$/, '')));
  if (!v) return plan;
  plan.filters = plan.filters.map(f => f === termes[0] ? { col, op: 'eq', value: v, label: null, source: 'filiere_exacte' } : f);
  return plan;
}
// v27.5.67 — « BTS en Auvergne-Rhône-Alpes » : « Rhône » (département) lu DANS le nom de la région ; filtre en trop
// retiré, sauf si le mot figure aussi ailleurs dans la question (« en Auvergne-Rhône-Alpes, dans le Rhône »)
function _retirerValeursEmboitees(plan) {
  if (!plan || !Array.isArray(plan.filters) || plan.filters.length < 2) return plan;
  const q = ` ${normalizeText(_symbolesEnMots(plan.question || ''))} `;
  const eqs = plan.filters.filter(f => f && f.op === 'eq' && typeof f.value === 'string' && f.value.length >= 3);
  const retirer = new Set();
  eqs.forEach(petit => {
    const np = normalizeText(petit.value);
    eqs.forEach(grand => {
      if (grand === petit || grand.col === petit.col) return;
      const ng = normalizeText(grand.value);
      if (ng.length <= np.length || !new RegExp(`(^| )${np}( |$)`).test(ng) || !q.includes(` ${ng} `)) return;
      const ailleurs = q.split(` ${ng} `).join(' ');
      if (!new RegExp(`(^| )${np}( |$)`).test(ailleurs)) retirer.add(petit);
    });
  });
  if (retirer.size) plan.filters = plan.filters.filter(f => !retirer.has(f));
  return plan;
}

function _finalSanitizeAnalysisPlanBase(plan) {
  if (!plan) return plan;
  const q = normalizeText(plan.question || '');
  const state = getDataEngineState();
  const prev = state.lastPlan;
  const table = plan.table || prev?.table;

  // v27.5.59 — « à Bordeaux ou à Pau » : le filtre « l'un ou l'autre » remplace les filtres lus séparément dans la question
  const _colsUnion = new Set((plan.filters || []).filter(f => f && f.source === 'union').flatMap(f => (f.groupes || []).flat().map(g => g.col)));
  const _lieuQ = c => /commune|ville|acad[eé]mi|d[eé]partement|r[eé]gion/.test(_hx(c)) && !/code|insee|postal/.test(_hx(c));
  const strict = strictFiltersFromQuestion(table, plan.question || '').filter(f => !_colsUnion.has(f.col) && !(plan.lieuRemplace && _lieuQ(f.col)));
  const explicitFresh = isExplicitFreshDataQuestion(plan.question || '') && !/^(et pour|et les|idem|m[eê]me|meme)/.test(q);
  const dimensionFollowUp = isDimensionOnlyFollowUp(plan.question || '');
  const filterFollowUp = isFilterOnlyFollowUp(plan.question || '');
  const bareAction = isBareChartRequest(plan.question || '') || isBareExportRequest(plan.question || '');

  const onlyBoursier = /^(combien|nombre|effectif|total)\s+(de\s+)?(candidats\s+)?(non\s+)?boursiers?\s*\??$/.test(q);
  // v27.7 — filtre « intitulé de formation contenant » : vient de la question elle-même, toujours conservé
  // v27.22 — la catégorie officielle tirée d'un mot de la question (« licences » → Licence) aussi
  const _deQuestion = f => f && (f.source === 'termes_formation' || f.source === 'categorie_formation' || f.source === 'etablissement' || f.source === 'union');
  const termFilters = (plan.filters || []).filter(_deQuestion);
  const keepTermFilters = () => {
    if (!termFilters.length) return;
    plan.filters = [...(plan.filters || []).filter(f => !_deQuestion(f)), ...termFilters];
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
    // v27.5.53 — mot d'intitulé déjà traduit par un filtre exact (« agricoles » → Ministère = Agriculture) : retiré
    const _pref = w => w.slice(0, 5);
    const _motsStrict = new Set(strict.filter(f => f.source !== 'specialite_lycee').flatMap(f => normalizeText(f.value).split(/[^a-z0-9]+/).filter(w => w.length >= 5).map(_pref)));
    plan.filters = (plan.filters || []).filter(f => {
      if (!(f && f.op === 'contains_all' && f.source === 'termes_formation')) return true;
      const i = (f.terms || []).map((t, k) => ({ t, l: String(f.label || '').split(' + ')[k] })).filter(x => ![].concat(x.t).some(w => w.length >= 5 && _motsStrict.has(_pref(w))));
      if (i.length === (f.terms || []).length) return true;
      if (!i.length) return false;
      Object.assign(f, { terms: i.map(x => x.t), label: i.map(x => x.l).join(' + '), value: i.map(x => x.l).join(' + ') });
      return true;
    });
    const kept = (plan.filters || []).filter(f => {
      if (!f || !f.col) return false;
      if (f.source === 'termes_formation' || f.source === 'union' || f.source === 'condition_chiffree') return true; // v27.7 — mots cités dans la question (v27.5.72 : « aucun admis » = 0)
      if (strictCols.has(f.col)) return false; // remplacés par strict ci-dessous
      if (f.op === 'eq' && strict.some(e => e.source === 'enumeration' && e.values.includes(normalizeText(f.value)))) return false; // v27.5.64
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
    // v27.5.66 — même garde-fou que pour une question nouvelle : un chiffre absent de la question (« Dont effectif des
    // admis … = 1 », lu dans « combien d'admis ? ») n'est pas un filtre. Avant : « et combien d'admis ? » donnait 43
    // (formations ayant 1 admis de ce type) au lieu de 1 550.
    const _chiffreInvente = f => {
      if (!f || f.op !== 'eq' || !/^\d+(?:[,.]\d+)?$/.test(String(f.value ?? '').trim())) return false;
      const etat01 = table && _distinctValues(table, f.col).every(x => /^(0|1)$/.test(String(x).trim()));
      return !etat01 && !new RegExp(`(^|\\D)${String(f.value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\D|$)`).test(plan.question || '');
    };
    const _nouveaux = _entrants.filter(f => !_clesPrev.has(_cleFiltre(f)) && !_chiffreInvente(f));
    const _colsNouv = new Set([...strict, ..._nouveaux].filter(f => f && f.op !== 'contains_all').map(f => f.col));
    const _clesEntrants = new Set(_entrants.map(_cleFiltre));
    const _prevGardes = (prev.filters || []).filter(pf => pf && _clesEntrants.has(_cleFiltre(pf)) && !(pf.op !== 'contains_all' && _colsNouv.has(pf.col)));
    plan.filters = mergeFiltersUnique(mergeFiltersUnique(_prevGardes, strict), _nouveaux);
    // v27.25 — relance déjà résolue (mesure d'une moyenne gardée, somme par groupe, « lesquelles … ») : outil conservé
    const _resolue = plan.statsCol || plan.lesquelles || plan.sousEnsemble || (dimensionFollowUp && plan.groupSumCol) || (plan.tool === 'part' && plan.part && plan.part.groupe);
    if (dimensionFollowUp && !_resolue) {
      plan.tool = 'group_by';
    }
    if (filterFollowUp && !_resolue) {
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

  // v27.5.56 — deux établissements cités (« comparer le lycée Montaigne et le lycée Victor Louis ») : un groupe chacun
  // (avant : pas de calcul, la question partait vers Albert)
  const mE = q.match(/\b(lycees?|universites?|iut|etablissements?)\b/);
  if (mE && /\s(et|avec|versus|vs)\s/.test(q.slice(mE.index))) {
    const debut = q.slice(0, mE.index), suite = q.slice(mE.index);
    const [a1, ...r] = suite.split(/\s+(?:et|avec|versus|vs)\s+(?:celui |ceux |celle |celles )?(?:du |de l |de la |de |le |la |l |des |au |a l )?/);
    const b1 = r.join(' et ');
    const b2 = NOM_ETAB_RE.test(b1.split(' ')[0] || '') ? b1 : `${mE[1].replace(/s$/, '')} ${b1}`;
    const e1 = etablissementDeLaQuestion(table, debut + a1), e2 = etablissementDeLaQuestion(table, debut + b2);
    if (e1 && e2 && !e1.tousLycees && !e2.tousLycees && !e1.introuvable && !e2.introuvable && !e1.type && !e2.type && e1.col === e2.col && e1.phrase !== e2.phrase) {
      const g = e => ({ col: e.col, op: 'in', values: e.valeurs, value: e.phrase, label: e.noms.length <= 2 ? e.noms.join(', ') : `${e.noms.length} établissements « ${e.phrase} »`, source: 'etablissement', noms: e.noms });
      addGroup(e1.noms.length <= 2 ? e1.noms.join(' / ') : e1.phrase, [g(e1)]);
      addGroup(e2.noms.length <= 2 ? e2.noms.join(' / ') : e2.phrase, [g(e2)]);
      return groups;
    }
  }

  // ── 0b. v27.5.64 — deux lieux, AVANT les paires boursiers / admis (« comparer les boursiers de Pau et de
  // Bayonne » : Pau contre Bayonne, parmi les boursiers) (« comparer la Gironde et les Landes », « candidats de Pau et de Bayonne ») ──
  // avant : un seul lieu lu, pas de calcul (la question partait vers Albert)
  {
    const _role = c => (typeof plannerColumnRole === 'function') ? plannerColumnRole(c) : {};
    const acc = _VERBE_ACCUEIL_RE.test(q) && !/venant|issus?|originaires?|provenant|scolaris|origine|lycees?/.test(q);
    const lieux = (table.headers || []).filter(h => h && /acad[eé]mi|departement|region|commune|ville/.test(_hx(h)) && !/code|insee|postal/.test(_hx(h)))
      .sort((a, b) => {
        const k = h => { const x = _hx(h); const i = [/academi/, /departement/, /region/, /commune|ville/].findIndex(re => re.test(x)); const mot = ['academi', 'departement', 'region', 'commune'][i]; return (new RegExp(`\\b${mot}`).test(q) ? -10 : 0) + i + (((acc ? _role(h).origine : _role(h).accueil)) ? 0.5 : 0); };
        return k(a) - k(b);
      });
    for (const col of lieux) {
      const vals = _distinctValues(table, col);
      if (vals.length > 5000) continue;
      const cites = vals.map(v => ({ v, n: normalizeText(v), i: -1 })).filter(o => o.n.length >= 3).map(o => { const m = new RegExp(`(^| )${o.n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).exec(q); return m ? { ...o, i: m.index } : null; }).filter(Boolean)
        .sort((x, y) => x.i - y.i);
      const uniques = cites.filter((o, k) => !cites.some((p, j) => j !== k && p.n.length > o.n.length && p.n.includes(o.n)));
      if (uniques.length >= 2) {
        uniques.slice(0, 2).forEach(o => addGroup(o.v, [{ col, op: 'eq', value: o.v }]));
        return groups;
      }
    }
  }

  // ── 0c. Formations nommées (CPGE, L1, BTS, BUT, etc.) — v27.5.74 : AVANT les paires boursiers / admis
  // (« comparer les boursiers admis en CPGE et en BTS » : CPGE contre BTS parmi les boursiers admis ; avant : 0 / 0)
  // v27.5.74 — open data : la filière très agrégée (« comparer les BTS et les BUT en Gironde » ; avant : Albert, sans calcul)
  {
    const fcol = (table.headers || []).find(h => /^filiere de formation tres agregee$/.test(normalizeText(h)));
    if (fcol) {
      const cites = _distinctValues(table, fcol).map(v => ({ v, n: normalizeText(v) })).filter(o => o.n.length >= 2)
        .map(o => { const m = new RegExp(`(^| )(${o.n}|${o.n}s)( |$)`).exec(q); return m ? { ...o, i: m.index } : null; }).filter(Boolean).sort((a, b) => a.i - b.i);
      if (cites.length >= 2) { cites.slice(0, 2).forEach(o => addGroup(o.v, [{ col: fcol, op: 'eq', value: o.v }])); return groups; }
    }
  }
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
      // v27.5.76 — dans l'ordre de la question (« de plus en BTS qu'en CPGE » : BTS d'abord, l'écart est BTS − CPGE)
      const pos = f => { const k = FORM_KEYS.find(x => x.label === f.label); const m = k && k.re.exec(q); return m ? m.index : 999; };
      found.sort((a, b) => pos(a) - pos(b));
      found.slice(0, 2).forEach(f => addGroup(f.raw, [{ col: formationCol, op: 'eq', value: f.raw }]));
      return groups;
    }
  }

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
  // v27.5.74 — « comparer les admis en CPGE et en BTS » : deux formations, pas admis / non admis (avant : 0 / 0)
  if (/admis|r[eé]pondu favorablement|avec proposition/.test(q) &&
      /(non[- ]?admis|sans proposition|refus[eé]|\badmis\s+(?:et|ou|vs|versus|contre)\s+(?:les\s+)?non\b|^compar\w*\s+(?:les\s+)?admis\s*\??$)/.test(q)) {
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
  // v27.5.76 — une valeur comparée (« Pau », « Bayonne ») relue sur une autre colonne (commune d'accueil) n'est pas un
  // filtre commun (avant : « boursiers à Pau ou à Bayonne » = Pau 10 / Bayonne 45, au lieu de 332 / 229)
  const valsG = new Set((groups || []).flatMap(g => (g.filters || []).map(f => normalizeText(f.value))));
  return merged.filter(f => f && f.col && !axisCols.has(f.col) && !(f.op === 'eq' && valsG.has(normalizeText(f.value))));
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

// v27.5.57 — fichier de candidats : taux de chaque groupe comparé (proposition, admission, boursiers, apprentis, hors
// académie), numérateur et dénominateur calculés dans le groupe. Seulement les colonnes présentes dans le fichier.
function compareIndicateurs(table, groupRows) {
  if (!table || table.rowUnit === 'formation' || !groupRows?.length) return [];
  const hs = (table.headers || []).filter(Boolean);
  const etat = (re, sauf) => hs.find(h => re.test(_hx(h)) && !(sauf && sauf.test(_hx(h))) && _isEtatCol(table, h));
  const oui = c => r => /^(oui|o|1|vrai|true)$/.test(normalizeText(r?.[c]));
  const out = [];
  const prop = etat(/proposition/, /repondu|favorabl|accept/);
  if (prop) out.push({ label: 'A eu une proposition', col: prop, test: oui(prop) });
  const acc = etat(/repondu|favorabl|accept/, /academie|commune|etablissement|formation|groupe|specialite/);
  if (acc) out.push({ label: 'A accepté une proposition', col: acc, test: oui(acc) });
  const bours = findColumnByConceptStrict(table, 'boursier');
  if (bours) { const v = normalizeText(pickColumnValue(table, bours, 'boursier_oui')); out.push({ label: 'Boursiers', col: bours, test: r => normalizeText(r?.[bours]) === v }); }
  const app = findColumnByConceptStrict(table, 'apprenti');
  if (app) out.push({ label: 'Apprentis', col: app, test: oui(app) });
  const aca = findColumnByConceptStrict(table, 'academie_accueil');
  if (aca) {
    const n = new Map();
    (table.objects || []).forEach(r => { const v = String(r?.[aca] ?? '').trim(); if (v) n.set(v, (n.get(v) || 0) + 1); });
    const tot = [...n.values()].reduce((a, b) => a + b, 0);
    const [ref, nb] = [...n.entries()].sort((a, b) => b[1] - a[1])[0] || [];
    if (ref && nb > tot / 2) out.push({ label: `Admis hors académie de ${ref} (parmi les admis)`, col: aca, test: r => String(r?.[aca] ?? '').trim() !== ref, base: r => String(r?.[aca] ?? '').trim() !== '' });
  }
  const colsGroupes = new Set(groupRows.flatMap(g => (g.filters || []).map(f => f.col)));
  return out.filter(ind => !colsGroupes.has(ind.col)).map(ind => ({ label: ind.label, col: ind.col, groupes: groupRows.map(g => {
    const base = ind.base ? (g.rows || []).filter(ind.base) : (g.rows || []);
    const num = base.filter(ind.test).length;
    return { label: g.label, num, den: base.length, pct: base.length ? num / base.length * 100 : null };
  }) }));
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
  // v27.5.76 — écart entre les deux groupes, en clair (« combien de BTS de plus en Gironde que dans les Landes »)
  const ecartHtml = rows.length === 2 ? (() => {
    const [a, b] = rows, d = (a.count || 0) - (b.count || 0);
    const rapport = b.count ? (a.count / b.count) : null;
    return `<p style="margin:10px 0"><strong>Écart</strong> : ${escapeHtml(a.label)} − ${escapeHtml(b.label)} = <strong>${d > 0 ? '+' : ''}${d.toLocaleString('fr-FR')}</strong>${rapport && d !== 0 ? ` (${escapeHtml(a.label)} : ${rapport.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} fois ${escapeHtml(b.label)})` : ''}.</p>`;
  })() : '';
  const missingNote = ecartHtml + (missing ? `<p style="font-size:12px;color:var(--gris6,#6b7280);margin:8px 0 0">Autres / non renseignés hors groupes comparés : <strong>${missing.toLocaleString('fr-FR')}</strong> ligne${missing>1?'s':''} (${fmtComparePct(baseTotal ? missing / baseTotal * 100 : 0)}).</p>` : '');
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
  const _ind = compareIndicateurs(plan.table, rows);
  const _th = 'text-align:left;padding:7px 10px;border-bottom:1px solid var(--gris2,#e5e7eb)';
  const _td = 'padding:7px 10px;border-bottom:1px solid var(--gris1,#f3f4f6)';
  const indicateursTable = _ind.length ? `<section class="de-section" style="margin:12px 0;padding:12px;border:1px solid var(--gris2,#e5e7eb);border-radius:10px;background:#fff"><div style="font-weight:800;margin-bottom:6px">Taux de chaque groupe</div><div style="overflow:auto"><table style="border-collapse:separate;border-spacing:0;width:100%;font-size:12px;min-width:300px"><tbody><tr><th style="${_th}">Indicateur</th>${rows.map(r => `<th style="${_th};text-align:right">${escapeHtml(r.label)}</th>`).join('')}</tr>${_ind.map(i => `<tr><td style="${_td}">${escapeHtml(i.label)}</td>${i.groupes.map(g => `<td style="${_td};text-align:right"><strong>${g.pct === null ? '—' : `${_pctFr(g.pct)} %`}</strong><br><span style="font-size:11px;color:var(--gris6,#6b7280)">${_nf(g.num)} / ${_nf(g.den)}</span></td>`).join('')}</tr>`).join('')}</tbody></table></div><p style="font-size:11px;color:var(--gris6,#6b7280);margin:6px 0 0">Chaque taux est calculé à l'intérieur du groupe.</p></section>` : '';
  const charts = plan.renderChart ? `<section class="de-section de-charts" style="margin:14px 0">${renderCompareCharts(plan, result)}</section>` : '';
  const detailsTables = `<details class="de-detail-tables" style="margin:16px 0;border:1px solid var(--gris2,#e5e7eb);border-radius:12px;background:#fff"><summary style="cursor:pointer;font-weight:800;padding:12px 14px">Afficher les tableaux détaillés</summary><div style="padding:0 14px 14px">${formationTable}${academieTable}${serieTable}</div></details>`;
  const debug = `<details class="msg-sources"><summary title="Détail technique du calcul (pour vérification ou support) — sans impact sur le résultat affiché ci-dessus">Plan Data Engine</summary><div style="font-size:10px;line-height:1.5;margin-top:5px"><strong>Outil</strong> : compare<br><strong>Version</strong> : v27.6.0<br><strong>Source</strong> : ${escapeHtml(plan.table?.source || 'Données')} · ${escapeHtml(plan.table?.name || 'table')}<br><strong>Groupes</strong> : ${escapeHtml(rows.map(r => r.label).join(' / ') || '—')}</div></details>`;
  const clearTitle = (typeof extractBlockTitle === 'function') ? extractBlockTitle({ plan, result }, '') : 'Comparaison';
  return `${deTitleHtml(clearTitle, plan.blockId, plan.originalTitle || clearTitle)}${perim}<p>Base comparée : <strong>${baseTotal.toLocaleString('fr-FR')}</strong> lignes.</p><section class="de-section de-population" style="margin:12px 0;padding:12px;border:1px solid var(--gris2,#e5e7eb);border-radius:10px;background:#fff"><div style="overflow:auto"><table style="border-collapse:separate;border-spacing:0;width:100%;font-size:12px;min-width:360px"><tbody><tr><th style="text-align:left;padding:7px 10px;border-bottom:1px solid var(--gris2,#e5e7eb)">Population</th><th style="text-align:right;padding:7px 10px;border-bottom:1px solid var(--gris2,#e5e7eb)">Nombre</th><th style="text-align:right;padding:7px 10px;border-bottom:1px solid var(--gris2,#e5e7eb)">Part</th></tr>${tableRows}</tbody></table></div>${missingNote}</section>${indicateursTable}${filtersHtml}${insights}${charts}${statsTable}${detailsTables}${debug}`;
}

function executerPdf(plan) {
  let bloc = null;
  try { bloc = (typeof blocsDeLaConversation === 'function' ? blocsDeLaConversation() : []).filter(b => b.calcule).pop() || null; } catch (e) { bloc = null; }
  const titre = 'Impression en PDF';
  if (!bloc) {
    const html = `<h4>${titre}</h4><p>Il n'y a pas encore de réponse calculée à imprimer dans cette conversation. Posez d'abord la question (par exemple « liste des établissements proposant un BTS MCO en Gironde »), puis demandez le PDF, ou utilisez le bouton « 🖨 PDF » sous la réponse.</p>`;
    return { kind: 'pdf', plan, result: { imprime: false }, text: 'PDF : aucune réponse calculée à imprimer', html };
  }
  let ok = false;
  try { ok = typeof imprimerRapport === 'function' && imprimerRapport([bloc], { titre: bloc.titre }); } catch (e) { ok = false; }
  const html = `<h4>${titre}</h4><p>${ok ? 'La fenêtre d\'impression s\'est ouverte' : 'La fenêtre d\'impression n\'a pas pu s\'ouvrir'} pour la réponse « <strong>${escapeHtml(bloc.titre || '')}</strong> ». Pour obtenir un fichier PDF, choisissez « Enregistrer au format PDF » comme imprimante.</p><p style="font-size:12px;color:var(--gris3)">Pour réunir plusieurs réponses dans un seul PDF : bouton « 📑 Rapport PDF » en haut du widget.</p>`;
  return { kind: 'pdf', plan, result: { imprime: ok, titre: bloc.titre }, text: `PDF : ${bloc.titre}`, html };
}
function runDataEnginePlan(plan, persistentFiltersOverride) {
  if (plan && plan.tool === 'export_pdf') return executerPdf(plan);
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
  if ((plan.tool === 'group_by' || plan.tool === 'top' || plan.tool === 'pivot') && !plan._speResolue) {
    const sp = _dimensionSpecialite(plan.table, plan.question);
    if (sp && sp.ambigu) return unresolvedConceptExecution(plan, [], `« par spécialité » peut désigner ${sp.choix.map(c => `« ${c} »`).join(', ')} : précisez (par exemple « par enseignement de spécialité », « par spécialité de la formation d'accueil », « par spécialité du bac pro »)`);
    if (sp && sp.col) {
      // « au lycée », « en terminale » : pas un établissement d'accueil « lycée » ni un intitulé « terminale »
      const _motsSpe = /^(suivie?s?|terminales?|lycees?|enseignements?|specialites?|classes?|premieres?)$/;
      const filtres = (plan.filters || []).filter(f => !(f && f.source === 'etablissement' && f.op === 'in' && normalizeText(String(f.value || '')) === 'lycee' && /\b(?:au|du|en) lycee\b/.test(normalizeText(plan.question || ''))))
        .filter(f => !(f && f.op === 'contains_all' && f.source === 'termes_formation' && (f.terms || []).every(t => [].concat(t).some(w => _motsSpe.test(normalizeText(w))))));
      return runDataEnginePlan({ ...plan, tool: plan.tool === 'pivot' ? 'group_by' : plan.tool, targetCol: sp.col, eclater: sp.eclater, filters: filtres, unresolvedTerms: [], clarification: null, _speResolue: true }, persistentFiltersOverride);
    }
  }
  if (plan.clarification) return unresolvedConceptExecution(plan, [], plan.clarification);
  if (plan.tool !== 'compare' && plan.tool !== 'chart_current' && plan.tool !== 'export_current_excel' && plan.tool !== 'export_current_csv') {
    // v27.5.61 — la question demande des établissements / des académies… : un calcul qui compte autre chose s'arrête
    const _objet = objetNonRespecte(plan);
    if (_objet) return unresolvedConceptExecution(plan, [], `vous demandez des ${_objet}, mais ce calcul compterait des ${plan.table?.rowUnit === 'formation' ? 'formations' : 'lignes'} : reformulez (par exemple « combien de ${_objet} proposent… », « liste des ${_objet} qui… », « nombre de BTS par ${_objet.replace(/s$/, '')} »)`);
    // v27.23 — établissement cité mais introuvable : message dédié (avec des noms proches), avant les autres contrôles
    if (plan.etablissementIntrouvable) return unresolvedEtablissementExecution(plan, plan.etablissementIntrouvable);
    const manque = conceptsNonFiltres(plan);
    if (manque.length) return unresolvedConceptExecution(plan, manque);
    // v27.22 — un mot d'intitulé déjà couvert par un autre filtre (« Nouvelle » de « Région = Nouvelle Aquitaine »,
    // ajouté après la recherche des intitulés) n'est pas un critère d'intitulé : on le retire
    elaguerTermesCouverts(plan);
    const termFilter = (plan.filters || []).find(f => f && f.op === 'contains_all');
    // v27.17 — option lisible seulement pour une partie des formations (PASS) : pas de chiffre trop petit
    const _precision = termFilter ? precisionPartielleIntitules(plan, termFilter) : null;
    if (_precision) return unresolvedPrecisionExecution(plan, _precision);
    if (plan.unresolvedTerms && plan.unresolvedTerms.length) return unresolvedFormationExecution(plan, plan.unresolvedTerms, termFilter);
    if (termFilter && !applyLocalActionFilters(plan.table.objects || [], [termFilter]).length) return unresolvedFormationExecution(plan, [], termFilter);
    // v27.22 — un mot de la question n'a correspondu à rien (« khâgnes », « NDRC ») : arrêt, pas un compte plus large
    // (après les messages plus précis : formation non trouvée, option non précisée)
    const inconnus = motsNonReconnus(plan);
    if (inconnus.length) return unresolvedConceptExecution(plan, inconnus, `je n'ai reconnu dans les données ni intitulé ni colonne pour « ${inconnus.join(' », « ')} » : le chiffre porterait sur un ensemble plus large que celui demandé. Écrivez l'intitulé tel qu'il figure dans les données (par exemple « BTS management commercial opérationnel » plutôt que « BTS MCO »)`);
  }
  if (plan.tool === 'compare') {
    const groups = plan.compareGroups || detectCompareGroups(plan.table, plan.question);
    if (!groups || groups.length < 2) return null;
    // v27.5.74 — open data : « comparer le nombre de PLACES en BTS et en BUT » : une comparaison compte des formations ;
    // on s'arrête plutôt que d'afficher des formations sous le nom de places
    if (plan.table.rowUnit === 'formation') {
      const qc = normalizeText(plan.question || '').replace(/\b(plus de|moins de|au moins|au plus)\s+\d+\S*\s*\w+/g, ' ');
      const mes = MESURES_SOMME.find(m => m.re.test(qc));
      if (mes && !/\b(nombre|combien) d(e|es)? ?(formations?|filieres?)\b/.test(qc)) {
        const g = groups.map(x => x.label).join(' » et « ');
        return unresolvedConceptExecution(plan, [], `une comparaison compte des formations, pas des ${mes.unite} : demandez « nombre de ${mes.unite} en ${groups[0].label} » puis « et en ${groups[1].label} ? » (comparaison de « ${g} »)`);
      }
    }
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
  let rows = applyLocalActionFilters(plan.table.objects || [], plan.filters || []);
  // v27.23 — établissement cité mais introuvable : arrêt, avec les noms proches
  if (plan.etablissementIntrouvable) return unresolvedEtablissementExecution(plan, plan.etablissementIntrouvable);
  if (['count_rows', 'group_by', 'top', 'pivot'].includes(plan.tool) && plan.mesureIntrouvable) return unresolvedConceptExecution(plan, [], `aucune colonne de ${plan.mesureIntrouvable} dans les données`);
  // v27.18 — tableau croisé de places / candidats / admis : il compterait des formations → arrêt
  if (plan.tool === 'pivot' && plan.mesurePivot) return unresolvedConceptExecution(plan, [], `un tableau croisé compte des formations, pas des ${plan.mesurePivot} : demandez une seule répartition (« ${plan.mesurePivot} par ${_shortColName(plan.targetCol || '') || 'académie'} »)`);
  if (plan.tool === 'count_rows' && plan.compterValeurs) {
    const { col, nom } = plan.compterValeurs;
    const cle = r => normalizeText(r?.[col]);
    const distinct = new Set(rows.map(cle).filter(Boolean)).size;
    const tous = new Set((plan.table.objects || []).map(cle).filter(Boolean)).size;
    const parCandidat = plan.table.rowUnit !== 'formation';
    const result = { count: distinct, total: tous, formations: rows.length, totalFormations: (plan.table.objects || []).length, etablissements: true, valeurs: nom, col, parCandidat };
    const exec = { kind: 'count', plan, result, text: `${nom.toUpperCase()} ${_differents(nom).toUpperCase()} = ${distinct} (${rows.length} ${parCandidat ? 'lignes' : 'formations'})`, html: renderDataEngineResultHtml('count_rows', plan, result) };
    rememberDataEngineExecution(exec);
    return exec;
  }
  // v27.23 — « combien d'établissements / de lycées … » : établissements différents, pas des formations
  if (plan.tool === 'count_rows' && plan.compterEtablissements) {
    const col = plan.compterEtablissements;
    const cle = _cleEtablissement(plan.table, col);
    const distinct = new Set(rows.map(cle).filter(Boolean)).size;
    const tous = new Set((plan.table.objects || []).map(cle).filter(Boolean)).size;
    // v27.5.53 — fichier de candidats : une ligne = un candidat, pas une formation
    const parCandidat = plan.table.rowUnit !== 'formation' && /scolarite|origine|accueil|accepte/.test(_hx(col));
    const result = { count: distinct, total: tous, formations: rows.length, totalFormations: (plan.table.objects || []).length, etablissements: true, col, parCandidat };
    const exec = { kind: 'count', plan, result, text: `ÉTABLISSEMENTS DIFFÉRENTS = ${distinct} (${rows.length} ${parCandidat ? 'candidats' : 'formations'})`, html: renderDataEngineResultHtml('count_rows', plan, result) };
    rememberDataEngineExecution(exec);
    return exec;
  }
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
  if (plan.tool === 'ratio') {
    // v27.5.70 — « nombre de candidats par place en BTS » : Σ candidats / Σ places sur les mêmes formations
    // (avant : une répartition par filière, sans rapport avec la question)
    const num = rows.reduce((t, r) => { const x = _nombreCellule(r?.[plan.ratio.num]); return x === null ? t : t + x; }, 0);
    const lignesDen = rows.filter(r => _nombreCellule(r?.[plan.ratio.den]) !== null);
    const den = lignesDen.reduce((t, r) => t + _nombreCellule(r[plan.ratio.den]), 0);
    if (!den) return unresolvedConceptExecution(plan, [], `aucune place renseignée dans « ${plan.ratio.den} » pour ces formations`);
    const valeur = num / den;
    const result = { num, den, valeur, count: rows.length, total: (plan.table.objects || []).length, colNum: plan.ratio.num, colDen: plan.ratio.den, libelle: plan.ratio.libelle };
    const fmt = v => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
    const titre = `${plan.ratio.libelle} : ${fmt(valeur)}`;
    const perim = perimetreResultat('ratio', plan, result).html;
    const html = `${deTitleHtml(titre, plan.blockId, titre)}${perim}<p><strong>${fmt(valeur)}</strong> ${escapeHtml(plan.ratio.libelle.toLowerCase())} : ${num.toLocaleString('fr-FR')} ${escapeHtml(plan.ratio.unNum)} pour ${den.toLocaleString('fr-FR')} places (somme sur ${rows.length.toLocaleString('fr-FR')} formations).</p>`;
    const exec = { kind: 'ratio', plan, result, text: `RAPPORT ${plan.ratio.libelle} = ${num} / ${den} = ${valeur}`, html };
    rememberDataEngineExecution(exec);
    return exec;
  }
  if (plan.tool === 'sum') {
    if (!plan.sumCol) return unresolvedConceptExecution(plan, [], 'aucune colonne à additionner n\'a été reconnue : précisez (places, candidats, admis…)');
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
    let counts = plan.eclater ? _comptesEclates(rows, col) : plan.distinctCol ? distinctParGroupe(rows, col, plan.distinctCol, plan.table)
      : plan.groupSumCol ? sommesParGroupe(rows, col, plan.groupSumCol) : topCountsForRows(rows, col, Math.max(limit, 30));
    if (plan.croissant && !plan.distinctCol && !plan.groupSumCol) {
      // le moins : tous les groupes du fichier, y compris ceux à 0 (sinon un département sans licence serait oublié)
      const tous = new Map(_distinctValues(plan.table, col).filter(v => String(v ?? '').trim() !== '').map(v => [String(v), 0]));
      rows.forEach(r => { const v = String(r?.[col] ?? '').trim(); if (v) tous.set(v, (tous.get(v) || 0) + 1); });
      const top = [...tous].map(([value, count]) => ({ value, count, pct: rows.length ? count / rows.length * 100 : 0 })).sort((a, b) => a.count - b.count || a.value.localeCompare(b.value, 'fr'));
      counts = { ...counts, top, distinct: top.length };
    }
    const topRows = counts.top.slice(0, limit);
    const _res = { total: rows.length, filled: counts.filled, distinct: counts.distinct, rows: topRows };
    if (counts.eclate) _res.eclate = true;
    if (plan.groupSumCol) _res.somme = { col: plan.groupSumCol, unite: plan.sumUnit, total: counts.somme, sansValeur: counts.sansValeur };
    if (plan.distinctCol) _res.etablissements = { col: plan.distinctCol, total: counts.totalDistinct };
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
    // v27.5.70 — « par série et par département » : les deux colonnes NOMMÉES (avant : série × type de la classe)
    const _qp = normalizeText(plan.question || '');
    const _mots = [...(_qp.match(/\bpar\s+(?:type\s+de\s+|grande\s+)?[a-z]+(?:\s+(?:et|puis)\s+(?:par\s+)?[a-z]+)?/g) || [])]
      .flatMap(x => x.replace(/^par\s+/, '').split(/\s+(?:et|puis)\s+(?:par\s+)?/)).filter(w => !_PAR_UNITE.test(w));
    // « tableau croisé boursier par série », « croiser la série et le département » : le premier mot aussi
    const _mx = _qp.match(/\b(?:croise|croiser|pivot)\s+(?:des |du |de la |de l |de |d |entre |les |le |la )?([a-z]+)\s+(?:par|et|x|avec)\s+(?:les |le |la |l |des )?([a-z]+)/);
    if (_mots.length < 2 && _mx && !_PAR_UNITE.test(_mx[1])) _mots.splice(0, _mots.length, _mx[1], _mx[2]);
    // une seule dimension nommée (« tableau croisé des boursiers de Gironde par série ») : la seconde serait prise au
    // hasard (avant : série × type de la classe) → répartition simple sur la dimension demandée
    if (_mots.length === 1 && !plan._pivotSimple) {
      const c1 = _colonneDimension(plan.table, `par ${_mots[0]}`);
      if (c1) return runDataEnginePlan({ ...plan, tool: 'group_by', targetCol: c1, targetCol2: null, _pivotSimple: true }, persistentFiltersOverride);
    }
    if (_mots.length >= 2) {
      const c1 = _colonneDimension(plan.table, `par ${_mots[0]}`), c2 = _colonneDimension(plan.table, `par ${_mots[1]}`, c1);
      if (!c1 || !c2) return unresolvedConceptExecution(plan, [], `aucune colonne ne correspond à « par ${!c1 ? _mots[0] : _mots[1]} »`);
      // une dimension du tableau n'est pas un filtre (« boursier » : les deux états, pas les boursiers seuls)
      const filtres = (plan.filters || []).filter(f => !f || (f.col !== c1 && f.col !== c2) || new RegExp(`\\b${normalizeText(String(f.value)).split(' ')[0]}\\b`).test(_qp.replace(new RegExp(`\\b${_mots[0]}\\b|\\b${_mots[1]}\\b`, 'g'), '')));
      plan = { ...plan, targetCol: c1, targetCol2: c2, filters: filtres };
      rows = applyLocalActionFilters(plan.table.objects || [], plan.filters || []);
    }
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
    const col = plan.statsCol || inferredStatsCol || repli; // v27.25 — relance : la colonne de la question précédente
    if (!col) return unresolvedConceptExecution(plan, [], 'aucune colonne numérique ne correspond à la question');
    // v27.24 — taux d'accès de 0 : aucune proposition faite par Parcoursup (pas une formation très sélective) → écartés,
    // comme dans les classements ; le nombre est dit dans le périmètre
    const tauxAcces = /taux d acces/.test(_hx(col));
    const tauxNuls = tauxAcces ? rows.filter(r => _nombreCellule(r?.[col]) === 0).length : 0;
    const lignes = tauxNuls ? rows.filter(r => _nombreCellule(r?.[col]) !== 0) : rows;
    let qn = normalizeText(plan.question || '');
    // v27.5.73 — open data : « par formation », « par BTS », « par licence » = l'unité (moyenne par formation), pas un
    // regroupement (avant : moyenne par intitulé, ou arrêt « aucune colonne pour par bts »)
    if (plan.table.rowUnit === 'formation') {
      const filieres = (() => { try { const c = (plan.table.headers || []).find(h => /^filiere de formation tres agregee$/.test(normalizeText(h))); return c ? _distinctValues(plan.table, c).map(normalizeText) : []; } catch (e) { return []; } })();
      qn = qn.replace(/\bpar\s+(?:une?\s+)?([a-z0-9]+)\b/g, (m, w) => (/^formations?$/.test(w) || filieres.includes(w) || filieres.includes(w.replace(/s$/, ''))) ? ' ' : m).replace(/\s+/g, ' ').trim();
    }
    const demandee = plan.statsDemandee && !/\b(median|minimum|maximum|min|max|moyen|moyenne)\b/.test(qn) ? plan.statsDemandee : /\bmedian/.test(qn) ? 'median' : /\bminimum\b|\bmin\b|\ble plus bas\b|\bplus faible\b/.test(qn) ? 'min' : /\bmaximum\b|\bmax\b|\ble plus (haut|eleve)\b/.test(qn) ? 'max' : 'avg';
    // « … par académie / par filière » : une statistique par groupe
    const dim = _colonneDimension(plan.table, qn, col) || plan.statsDim || null;
    if (!dim) { const x = _dimensionIntrouvable(plan.table, qn, col); if (x) return unresolvedConceptExecution(plan, [], `aucune colonne ne correspond à « par ${x} » : la statistique serait donnée pour l'ensemble, sans le détail demandé`); }
    if (dim) {
      const groupes = new Map();
      lignes.forEach(r => { const v = String(r?.[dim] ?? '').trim(); if (!v) return; if (!groupes.has(v)) groupes.set(v, []); groupes.get(v).push(r); });
      const lignesG = [...groupes.entries()].map(([valeur, rs]) => ({ valeur, ...numericStats(rs, col) })).filter(g => g.numericCount > 0)
        .sort((a, b) => (b[demandee] ?? -Infinity) - (a[demandee] ?? -Infinity) || a.valeur.localeCompare(b.valeur, 'fr'));
      const result = { col, dim, demandee, groupes: lignesG, total: rows.length, tauxNuls, ensemble: numericStats(lignes, col) };
      const p2 = { ...plan, tool: 'stats_groupes', targetCol: col, statsCol: col, statsDim: dim, statsDemandee: demandee };
      const exec = { kind: 'stats_groupes', plan: p2, result, text: `Stats ${col} par ${dim} :\n` + lignesG.slice(0, 40).map(g => `${g.valeur} : moyenne ${g.avg}, médiane ${g.median} (${g.numericCount})`).join('\n') };
      exec.html = renderStatsGroupesHtml(p2, result);
      rememberDataEngineExecution(exec);
      return exec;
    }
    const stats = { ...numericStats(lignes, col), total: rows.length, tauxNuls, demandee };
    if (stats.numericCount === 1) {
      const desc = _colonnesDescription(plan.table);
      const r1 = lignes.find(r => _nombreCellule(r?.[col]) !== null);
      stats.uneFormation = desc.map(h => String(r1?.[h] ?? '').trim()).filter(Boolean).join(' — ');
    }
    const exec = {
      kind: 'stats',
      plan: { ...plan, targetCol: col, statsCol: col, statsDemandee: demandee },
      result: stats,
      text: `Stats ${col}: ${({ avg: 'moyenne', median: 'médiane', min: 'minimum', max: 'maximum' })[demandee]} ${stats[demandee]} (moyenne ${stats.avg}, médiane ${stats.median}, min ${stats.min}, max ${stats.max})`,
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
// v27.24 — « par académie / région / département / commune / établissement / filière / statut / sélectivité »
function _colonneDimension(table, q, sauf = null) {
  const m = String(q || '').match(/\bpar\s+(?:type\s+de\s+|grande\s+)?([a-z]+)/g);
  if (!m) return null;
  const headers = (table?.headers || []).filter(Boolean);
  const trouve = mot => {
    if (/^academies?$/.test(mot)) return headers.find(h => /^academie/.test(_hx(h)) && !/code|origine/.test(_hx(h)));
    if (/^regions?$/.test(mot)) return headers.find(h => /^region/.test(_hx(h)) && !/code|origine/.test(_hx(h)));
    if (/^departements?$/.test(mot)) return headers.find(h => /^departement/.test(_hx(h)) && !/code|origine/.test(_hx(h)));
    if (/^(communes?|villes?)$/.test(mot)) return headers.find(h => /^(commune|ville)/.test(_hx(h)) && !/code|insee|postal|origine/.test(_hx(h)));
    // v27.5.73 — fichier de candidats : « par lycée » = l'établissement de scolarité (« par université » : d'accueil)
    if (/^(etablissements?|lycees?|universites?)$/.test(mot)) return _colEtablissement(table) || _colEtablissementRole(table, /^universites?$/.test(mot) ? 'accueil' : 'origine') || _colEtablissementRole(table, 'origine');
    if (/^(filieres?|formations?|diplomes?)$/.test(mot)) { try { return _colonneCategories(table, formationTermsInfo(table)); } catch (e) { return null; } }
    if (/^(statuts?|secteurs?)$/.test(mot)) return headers.find(h => /^statut/.test(_hx(h)));
    if (/^selectivite$/.test(mot)) return headers.find(h => /selectiv/.test(_hx(h)));
    // v27.5.70 — tout autre mot (« par série », « par sexe », « par ministère ») : la colonne qui le porte dans son nom
    // (avant : « par série » ignoré, une seule moyenne affichée)
    const m1 = mot.replace(/s$/, '');
    const cands = headers.filter(h => h !== sauf && !_isIdentifiantCol(h, table) && !_estNumerique(table, h) && _hx(h).split(' ').some(w => w === mot || w === m1 || w.replace(/s$/, '') === m1));
    return cands.find(h => new RegExp(`^${m1}`).test(_hx(h))) || cands[0] || null;
  };
  for (const x of m) { const c = trouve(x.replace(/^par\s+(?:type\s+de\s+|grande\s+)?/, '')); if (c && c !== sauf) return c; }
  return null;
}
// v27.5.70 — « par X » cité mais aucune colonne X : le mot (pour s'arrêter au lieu d'ignorer le regroupement)
const _PAR_UNITE = /^(candidat|candidats|candidate|candidates|formation|formations|ligne|lignes|personne|personnes|eleve|eleves|place|places|an|annee|rapport|exemple|contre|ailleurs|consequent|hasard|defaut|voeu|voeux|dossier|dossiers|jour|mois|semaine)$/;
function _dimensionIntrouvable(table, q, sauf = null) {
  const m = [...String(q || '').matchAll(/\bpar\s+(?:type\s+de\s+|grande\s+)?([a-z]+)/g)].map(x => x[1]).filter(w => !_PAR_UNITE.test(w));
  if (!m.length || _colonneDimension(table, q, sauf)) return null;
  return m[0];
}
const _NOMS_STAT = { avg: 'moyenne', median: 'médiane', min: 'minimum', max: 'maximum' };
function renderStatsGroupesHtml(plan, r) {
  const fmt = v => v === null || v === undefined ? '—' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  const dim = _shortColName(r.dim) || r.dim;
  const titre = `${_shortColName(r.col)} : ${_NOMS_STAT[r.demandee]} par ${dim}`;
  const th = 'text-align:left;padding:6px 8px;background:#e8edff;color:var(--bleu,#003189);font-size:11px;white-space:nowrap';
  const td = 'padding:5px 8px;border-bottom:1px solid var(--gris1,#f3f4f6);font-size:12px';
  const tdr = td + ';text-align:right';
  const fort = k => r.demandee === k ? 'font-weight:800' : '';
  const corps = r.groupes.slice(0, 40).map(g => `<tr><td style="${td}">${escapeHtml(g.valeur)}</td><td style="${tdr}">${g.numericCount.toLocaleString('fr-FR')}</td><td style="${tdr};${fort('avg')}">${fmt(g.avg)}</td><td style="${tdr};${fort('median')}">${fmt(g.median)}</td><td style="${tdr};${fort('min')}">${fmt(g.min)}</td><td style="${tdr};${fort('max')}">${fmt(g.max)}</td></tr>`).join('');
  const e = r.ensemble;
  const pied = `<tr style="background:#e8edff"><td style="${td};font-weight:800">Ensemble</td><td style="${tdr};font-weight:800">${e.numericCount.toLocaleString('fr-FR')}</td><td style="${tdr};font-weight:800">${fmt(e.avg)}</td><td style="${tdr};font-weight:800">${fmt(e.median)}</td><td style="${tdr};font-weight:800">${fmt(e.min)}</td><td style="${tdr};font-weight:800">${fmt(e.max)}</td></tr>`;
  const table = `<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;margin:8px 0"><thead><tr><th style="${th}">${escapeHtml(dim)}</th><th style="${th};text-align:right">Formations</th><th style="${th};text-align:right">Moyenne</th><th style="${th};text-align:right">Médiane</th><th style="${th};text-align:right">Min</th><th style="${th};text-align:right">Max</th></tr></thead><tbody>${corps}${pied}</tbody></table></div>`;
  const note = `<p style="font-size:12px;color:var(--gris3)">Moyenne simple des valeurs de chaque formation (non pondérée par le nombre de candidats).${r.groupes.length > 40 ? ` 40 groupes affichés sur ${r.groupes.length}.` : ''}</p>`;
  const perim = perimetreResultat('stats_groupes', plan, r).html;
  const debug = `<details class="msg-sources"><summary>Plan Data Engine</summary><div style="font-size:10px;line-height:1.5;margin-top:5px"><strong>Outil</strong> : statistiques par groupe · ${escapeHtml(r.col)} × ${escapeHtml(r.dim)}</div></details>`;
  return `${deTitleHtml(titre, plan.blockId, plan.originalTitle || titre)}${perim}${table}${note}${debug}`;
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
  const motsQ = q.split(' ').filter(w => w.length >= 4 && !STATS_MOTS_VIDES.has(w) && !/^formations?$/.test(w));
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
    // v27.5.73 — « nombre moyen d'admis / de candidats par formation » : la colonne de cet effectif (avant : la capacité,
    // à cause du mot « formation » commun aux deux noms)
    if (/\badmis(es)?\b/.test(q) && /ayant accepte.*admis/.test(hn) && !/boursier|candidates|neo/.test(q)) score += 100;
    if (/\bcandidats?\b/.test(q) && !/\badmis\b/.test(q) && /effectif total des candidats pour une formation/.test(hn)) score += 100;
    // v27.5.64 — « en moyenne combien de places a un BUT » : les places = la capacité (avant : arrêt)
    if (/\bplaces?\b/.test(q) && /capacit|\bplaces?\b/.test(hn)) score += 80;
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
  const _pr = perimetreResultat(exec.kind, p, exec.result);
  const _perim = _pr.texte;
  if (_pr.compris) out += `Question comprise et calculée : ${_pr.compris}.\n`;
  if (_perim) out += `${_perim}\n`;
  if (exec.kind === 'count') out += exec.result.valeurs
    ? `Résultat : ${exec.result.count} ${exec.result.valeurs} ${_differents(exec.result.valeurs)} (pour ${exec.result.formations} ${exec.result.parCandidat ? 'ligne(s)' : 'formation(s)'}) — ce n'est pas un nombre de ${exec.result.parCandidat ? 'lignes' : 'formations'}.\n`
    : exec.result.etablissements === true
    ? (exec.result.parCandidat ? `Résultat : ${exec.result.count} établissement(s) différent(s) (pour ${exec.result.formations} candidat(s)) — ce n'est pas un nombre de candidats.\n` : `Résultat : ${exec.result.count} établissement(s) différent(s) (qui proposent ${exec.result.formations} formation(s)) — ce n'est pas un nombre de formations.\n`)
    : `Résultat : ${exec.result.count} ligne(s) sur ${exec.result.total}.\n`;
  if (exec.kind === 'ratio') out += `Résultat : ${exec.result.valeur} ${exec.result.libelle.toLowerCase()} (${exec.result.num} / ${exec.result.den} places, somme sur ${exec.result.count} formation(s)).\n`;
  if (exec.kind === 'sum') out += `Résultat : ${exec.result.sum} ${exec.result.unite} (somme de « ${exec.result.col} ») sur ${exec.result.count} formation(s).\n`;
  if (exec.kind === 'evolution_groupes') {
    const r = exec.result; const [s1, s2] = r.sessions;
    out += `Évolution par groupe calculée par le widget (mêmes critères sur chaque session ; chiffres = ${r.unite}${r.mesureCol ? `, somme de « ${r.mesureCol} »` : ''}) :\n`
      + r.lignes.map(l => `- ${l.valeur} : ${s1} = ${l.v1 ?? 'absent'} ; ${s2} = ${l.v2 ?? 'absent'}${l.ecart !== null ? ` ; écart ${l.ecart}${l.ecartPct !== null ? ` (${_pctFr(l.ecartPct)} %)` : ''}` : ''}${r.type === 'classement' ? ` ; rang ${s1} = ${l.rang1 ?? '—'}, rang ${s2} = ${l.rang2 ?? '—'}` : ''}`).join('\n')
      + `\nTotal : ${s1} = ${r.totaux[0]} ; ${s2} = ${r.totaux[1]}${r.nbGroupes > r.lignes.length ? ` (tous les ${r.nbGroupes} groupes)` : ''}\n`;
  }
  if (exec.kind === 'evolution') out += `Évolution calculée par le widget (mêmes critères sur chaque session) :\n${exec.result.lignes.map(l => `- session ${l.session} : ${exec.result.mesure === 'part' ? `${_pctFr(l.valeur)} %` : l.valeur} (${l.retenues} formations retenues sur ${l.formations})`).join('\n')}\nÉcart : ${exec.result.ecart}${exec.result.ecartPct !== null ? ` (${_pctFr(exec.result.ecartPct)} %)` : ''}\n`;
  if (exec.kind === 'part') { const lp = _libellePart(exec.plan); out += `Part calculée par le widget : ${_pctFr(exec.result.pct)} % (${exec.result.num} ${lp.quoi} sur ${exec.result.den} ${lp.sur}).\n`; }
  if (exec.kind === 'classement') out += `Classement selon « ${exec.plan.classement.col} » (${exec.plan.classement.ordre === 'asc' ? 'croissant' : 'décroissant'})${exec.plan.classement.entite ? `, somme par ${exec.plan.classement.entite.col}` : ''} :\n${exec.result.lignes.map(l => `${l.rang}. ${l.libelles.join(' — ')} : ${l.valeur}`).join('\n')}\n`;
  if (exec.kind === 'unresolved') out += `Résultat : aucun calcul. ${exec.text}\nIntitulés proches : ${(exec.result?.suggestions || []).map(s => s.value).join(' ; ')}\n`;
  if (exec.kind === 'group_by' || exec.kind === 'top') {
    out += `Colonne de répartition : ${p.targetCol}\nLignes retenues : ${exec.result.total}\nValeurs renseignées : ${exec.result.filled}\n`;
    if (exec.result.somme) out += `Chiffre de chaque groupe : somme de « ${exec.result.somme.col} » (${exec.result.somme.unite}), total ${exec.result.somme.total} — ce ne sont pas des nombres de formations\n`;
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
    if (exec.result.demandee && exec.result.demandee !== 'avg') out += `Statistique demandée : ${_NOMS_STAT[exec.result.demandee]} = ${exec.result[exec.result.demandee]}\n`;
    if (exec.result.uneFormation) out += `Une seule formation : ${exec.result.uneFormation}\n`;
  }
  if (exec.kind === 'part_groupes') {
    const r = exec.result; const lp = _libellePart(p);
    out += `Part de ${lp.quoi} parmi les ${lp.sur}, calculée dans chaque groupe de « ${r.groupe} » :\n`
      + r.groupes.slice(0, 40).map(g => `- ${g.valeur} : ${g.pct === null ? '—' : _pctFr(g.pct)} % (${g.num} / ${g.den})`).join('\n')
      + `\nEnsemble : ${_pctFr(r.ensemble.pct)} % (${r.ensemble.num} / ${r.ensemble.den})\n`;
  }
  if (exec.kind === 'stats_groupes') {
    const r = exec.result;
    out += `Statistiques de « ${r.col} » par « ${r.dim} » (moyenne simple des formations, non pondérée ; statistique demandée : ${_NOMS_STAT[r.demandee]}) :\n`
      + r.groupes.slice(0, 40).map(g => `- ${g.valeur} : ${g.numericCount} formations · moyenne ${g.avg} · médiane ${g.median} · min ${g.min} · max ${g.max}`).join('\n')
      + `\nEnsemble : moyenne ${r.ensemble.avg} · médiane ${r.ensemble.median}\n`;
  }
  if (exec.kind === 'compare') {
    const rows = exec.result?.rows || [];
    const baseTotal = exec.result?.baseTotal || rows.reduce((s, r) => s + (r.count || 0), 0);
    out += `Comparaison de groupes — base : ${baseTotal} ligne(s)\n`;
    out += `Effectifs par groupe :\n${rows.map(r => `- ${r.label} : ${r.count} (${r.pct.toFixed(1).replace('.', ',')} %)`).join('\n')}\n`;
    const cols = (typeof getCompareColumns === 'function') ? getCompareColumns(p.table) : {};
    // v27.5.57 — taux de chaque groupe (fichier de candidats)
    const _ind = compareIndicateurs(p.table, rows);
    if (_ind.length) {
      out += `\nTaux de chaque groupe (calculés dans le groupe) :\n`;
      _ind.forEach(i => { out += `- ${i.label} — ${i.groupes.map(g => `${g.label} : ${g.pct === null ? '—' : _pctFr(g.pct)} % (${g.num} / ${g.den})`).join(' · ')}\n`; });
    }
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
  if (f.op === 'in') return `« ${f.col} » : ${f.label || f.value}`;
  if (f.op === 'or') return `(${f.label || f.value})`;
  if (f.op === 'contains_words') return `« ${f.col} » contient « ${f.label || f.value} »`;
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
function _noteSpecialiteLycee(plan, filtres) {
  const table = plan.table;
  const L = _colonnesLycee(table);
  if (!L.ens) return '';
  const formCols = formationTermsInfo(table).cols;
  const formSet = new Set(formCols);
  const spe = filtres.filter(f => f.source === 'specialite_lycee');
  // v27.5.55 — sens inverse : la question visait la spécialité du lycée ; combien ont une formation d'accueil du même nom
  if (spe.length) {
    if (filtres.some(f => f.op === 'contains_all' || (f.op === 'eq' && formSet.has(f.col)))) return ''; // les deux sont demandés
    const parts = spe.map(f => {
      const mots = (f.terms || []).map(t => [].concat(t));
      const n = (table.objects || []).filter(r => { const ws = new Set(normalizeText(formCols.map(c => r?.[c] ?? '').join(' ')).split(' ')); return mots.length && mots.every(t => t.some(w => ws.has(w))); }).length;
      // mots écrits comme dans le nom de la spécialité (accents)
      const orig = String(f.label || '').split(/[^A-Za-zÀ-ÿ0-9]+/).filter(Boolean);
      const joli = w => orig.find(o => normalizeText(o) === w) || w;
      return n ? { n, mots: mots.map(t => joli(t[0])).join(' ') } : null;
    }).filter(Boolean);
    if (!parts.length) return '';
    return `le chiffre porte sur les enseignements de spécialité suivis au lycée ; ${parts.map(x => `${_nf(x.n)} candidat${x.n > 1 ? 's ont' : ' a'} été admis dans une formation d'accueil dont l'intitulé contient « ${x.mots} »`).join(', ')}, ce qui est autre chose (pour eux : « candidats admis en ${parts[0].mots} »)`;
  }
  // sens direct : un mot de formation d'accueil (« droit ») qui est aussi dans une spécialité du lycée (« Droit et Economie »)
  // groupes de mots : chaque mot de la formation (« arts » ET « plastiques »), sous ses formes
  // (pas la grande catégorie : « L1 - CUPGE - DEUST - DU » n'est pas une matière)
  const _cat = _colonneCategories(table, formationTermsInfo(table));
  const groupes = [];
  filtres.forEach(f => {
    if (f.op === 'contains_all' && f.source === 'termes_formation') (f.terms || []).forEach(t => groupes.push([].concat(t)));
    else if (f.op === 'eq' && formSet.has(f.col) && f.source !== 'categorie_formation' && f.col !== _cat) normalizeText(f.value).split(' ').filter(w => w.length >= 4).forEach(w => groupes.push([w, w + 's', w.replace(/s$/, '')]));
  });
  if (!groupes.length) return '';
  const sujets = _sujetsLycee(table).filter(x => { const ws = new Set(normalizeText(x.nom).split(' ')); return groupes.every(g => g.some(w => ws.has(w))); });
  if (!sujets.length) return '';
  const noms = new Set(sujets.map(x => normalizeText(x.nom)));
  const n = (table.objects || []).filter(r => L.cols.some(c => String(r?.[c] ?? '').split('|').some(x => noms.has(normalizeText(x.replace(/^\s*Msgn\/\s*/i, '')))))).length;
  if (!n) return '';
  // suggestion : le nom le plus proche du mot (le plus court), pas le plus fréquent
  const proche = sujets.slice().sort((a, b) => a.nom.length - b.nom.length)[0];
  const affiches = sujets.sort((a, b) => b.n - a.n).slice(0, 3).map(x => `« ${x.nom} »`).join(', ') + (sujets.length > 3 ? ` et ${sujets.length - 3} autre${sujets.length > 4 ? 's' : ''}` : '');
  return `le chiffre porte sur la formation d'accueil ; ${_nf(n)} candidat${n > 1 ? 's' : ''} du fichier ${n > 1 ? 'ont' : 'a'} suivi au lycée une spécialité dont le nom contient ce mot (${affiches}), ce qui est autre chose (pour eux : « candidats ayant suivi la spécialité ${proche.nom} »)`;
}
function perimetreResultat(kind, plan, result) {
  if (!plan || !result) return { texte: '', html: '' };
  const table = plan.table || {};
  const totalTable = (table.objects || []).length;
  const mot = n => `${table.rowUnit === 'formation' ? 'formation' : 'ligne'}${n > 1 ? 's' : ''}`;
  const retenues = result.etablissements === true ? result.formations
    : ['count', 'count_rows', 'sum', 'ratio'].includes(kind) ? result.count
    : kind === 'classement' || kind === 'part' || kind === 'part_groupes' ? result.total
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
  if ((kind === 'group_by' || kind === 'top') && result.somme) {
    notes.push(`chiffres = somme de « ${result.somme.col} » (${result.somme.unite}) par groupe, pas un nombre de ${mot(2)}`);
    if (result.somme.sansValeur > 0) notes.push(`${_nf(result.somme.sansValeur)} ${mot(result.somme.sansValeur)} sans valeur dans « ${result.somme.col} », non comptée${result.somme.sansValeur > 1 ? 's' : ''}`);
  }
  // v27.5.53 — « pourcentage de candidats sans proposition par département » : la répartition donne la part de chaque
  // département DANS le total retenu, pas le taux à l'intérieur de chaque département. Dit en clair, pour ne pas lire
  // « Gironde : 50 % » comme « la moitié des candidats de Gironde ».
  if ((kind === 'group_by' || kind === 'top') && !result.somme && !result.etablissements && PART_CUE.test(normalizeText(plan.question || '')) && /\bpar (?!rapport)\w/.test(normalizeText(plan.question || ''))) {
    notes.push(`les pourcentages indiquent la part de chaque groupe dans les ${_nf(result.filled ?? result.total)} ${mot(2)} retenues, pas un taux calculé à l'intérieur de chaque groupe (pour un taux, demandez-le groupe par groupe : « … en Gironde »)`);
  }
  if ((kind === 'group_by' || kind === 'top') && !plan.listMode) {
    const vides = (result.total || 0) - (result.filled ?? result.total ?? 0);
    if (vides > 0) notes.push(`${_nf(vides)} ${mot(vides)} sans valeur dans « ${plan.targetCol} »`);
    const affichees = Math.min((result.rows || []).length, 20);
    if (result.eclate) notes.push(`un candidat suit plusieurs spécialités : il est compté dans chacune (le total dépasse le nombre de candidats) ; chaque % est la part des ${_nf(result.filled)} candidats qui ont suivi cette spécialité`);
    if ((result.distinct || 0) > affichees && !plan.lesquelles) notes.push(`seules les ${_nf(affichees)} valeurs les ${plan.croissant ? 'moins' : 'plus'} fréquentes sont affichées, sur ${_nf(result.distinct)}${plan.croissant ? ' (y compris celles à 0)' : ''}`);
  }
  // v27.17 — 0 dans la commune de Bordeaux, mais des formations dans l'académie de Bordeaux (PASS à Talence) :
  // le 0 est exact, mais l'agent pensait sans doute à l'académie ou au département → on le dit
  if (['count', 'count_rows', 'sum', 'group_by', 'top'].includes(kind) && retenues === 0) {
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
  // v27.23 — établissements
  if (result.valeurs) notes.push(`le chiffre compte des ${result.valeurs} ${_differents(result.valeurs)} (${_nf(result.count)}), pas des ${result.parCandidat ? 'lignes' : 'formations'} (${_nf(result.formations)})`);
  else if (result.etablissements === true) notes.push(result.parCandidat ? `le chiffre compte des établissements différents (${_nf(result.count)}), pas des candidats (${_nf(result.formations)})` : `le chiffre compte des établissements différents (${_nf(result.count)}), pas des formations (${_nf(result.formations)})`);
  if (result.etablissements && result.etablissements !== true) notes.push(`chiffres = nombre d'établissements différents par groupe, pas un nombre de formations`);
  // v27.5.54 — fichier de candidats : un mot de formation d'accueil (« droit ») qui est aussi un enseignement de spécialité
  // du lycée (« Droit et Economie ») : on dit lequel est compté, et combien de candidats ont l'autre
  const _noteEns = _noteSpecialiteLycee(plan, filtres);
  if (_noteEns) notes.push(_noteEns);
  if (kind === 'part_groupes' && result.sansGroupe > 0) notes.push(`${_nf(result.sansGroupe)} ${mot(result.sansGroupe)} sans valeur dans « ${result.groupe} », comptée${result.sansGroupe > 1 ? 's' : ''} dans l'ensemble mais dans aucun groupe`);
  if (plan.lyceesTous) notes.push(`« lycées » = tous les établissements de scolarité du fichier (colonne « ${plan.lyceesTous} » : lycées, mais aussi CFA, maisons familiales rurales…)`);
  const fe = filtres.find(f => f.op === 'in' && f.source === 'etablissement');
  if (fe && !plan.etablissement?.type) {
    // établissements réellement retenus : nom + commune (homonymes dans plusieurs villes)
    const commune = (table.headers || []).find(h => /^(commune|ville)/.test(_hx(h)) && !/code|insee|postal|origine/.test(_hx(h)));
    const lignes = applyLocalActionFilters(table.objects || [], filtres);
    const vus = new Map();
    lignes.forEach(r => { const k = `${r?.[fe.col]}${commune && r?.[commune] ? ` (${r[commune]})` : ''}`; vus.set(k, (vus.get(k) || 0) + 1); });
    if (vus.size > 1) notes.push(`${_nf(vus.size)} établissements correspondent : ${[...vus.keys()].slice(0, 12).join(' ; ')}${vus.size > 12 ? ' …' : ''} — précisez la commune si un seul est visé`);
    // 0 : l'établissement existe, mais pas avec les autres critères (« lycée Montesquieu de Bordeaux » : il est ailleurs)
    if (!lignes.length) {
      const seul = applyLocalActionFilters(table.objects || [], [fe]);
      const ou = [...new Set(seul.map(r => `${r?.[fe.col]}${commune && r?.[commune] ? ` (${r[commune]})` : ''}`))];
      if (ou.length) notes.push(`aucune formation avec ces critères ; ${ou.length > 1 ? 'les établissements de ce nom figurent' : 'l\'établissement figure'} dans les données avec d'autres formations ou ailleurs : ${ou.slice(0, 8).join(' ; ')}${ou.length > 8 ? ' …' : ''} (${_nf(seul.length)} formation${seul.length > 1 ? 's' : ''} en tout)`);
    }
  }
  // v27.22 — catégorie exacte (« Licence ») : formations d'une catégorie voisine (« Licence_Las ») laissées de côté
  if (plan.categorieExclue && ['count', 'count_rows', 'sum', 'stats', 'group_by', 'top', 'classement', 'part'].includes(kind)) {
    const ce = plan.categorieExclue;
    const sans = filtres.filter(f => !(f.col === ce.col && f.op === 'eq'));
    ce.autres.forEach(v => {
      const k = applyLocalActionFilters(table.objects || [], [...sans, { col: ce.col, op: 'eq', value: v }]).length;
      if (k > 0) notes.push(`${_nf(k)} ${mot(k)} « ${v} » (${/las/i.test(v) ? 'LAS, licences accès santé' : 'autre catégorie'}) ont aussi ces mots mais ne sont pas comptée${k > 1 ? 's' : ''} : seule la catégorie « ${ce.valeur} » est retenue`);
    });
  }
  if (kind === 'group_by' && plan.listMode && result.sansPrecision) {
    const sans = (result.total || 0) - (result.filled || 0);
    notes.push(`${_nf(sans)} ${mot(sans)} sur ${_nf(result.total)} sans précision dans « ${plan.targetCol} » : la liste ne couvre que ${_nf(result.filled)} ${mot(result.filled)}`);
  }
  if ((kind === 'stats' || kind === 'stats_groupes') && result.tauxNuls > 0) notes.push(`${_nf(result.tauxNuls)} ${mot(result.tauxNuls)} au taux d'accès de 0 (aucune proposition d'admission par Parcoursup) écartée${result.tauxNuls > 1 ? 's' : ''} du calcul`);
  if (kind === 'stats' && result.total > result.numericCount + (result.tauxNuls || 0)) {
    const ign = result.total - result.numericCount - (result.tauxNuls || 0);
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
  const compris = questionComprise(kind, plan, result);
  const html = `<p class="de-perimetre" style="font-size:12px;line-height:1.5;color:var(--gris6,#4b5563);background:var(--gris0,#f8fafc);border-left:3px solid var(--bleu,#003189);border-radius:4px;padding:6px 10px;margin:6px 0 10px">`
    + (compris ? `🧭 <strong>J'ai compris</strong> : ${escapeHtml(compris)}.<br>` : '')
    + `📌 <strong>Sur quoi porte ce calcul</strong> : ${escapeHtml(parties.join(' · '))}.`
    + (notes.length ? `<br>⚠️ <strong>À noter</strong> : ${escapeHtml(notes.join(' ; '))}.` : '')
    + `</p>`;
  return { texte, html, compris };
}

// v27.5.61 — « J'ai compris : … » : ce que le widget a calculé, en une phrase (l'opération, pas les filtres, qui sont
// dans le périmètre). L'agent voit tout de suite un contresens (« liste des intitulés » quand il demandait des établissements).
function questionComprise(kind, plan, result) {
  if (!plan || !result) return '';
  const table = plan.table || {};
  const unite = table.rowUnit === 'formation' ? 'formations' : (table.source === 'Fichier' ? 'candidats (lignes du fichier)' : 'lignes');
  const col = c => `« ${_shortColName(c || '') || c} »`;
  try {
    if (kind === 'count' || kind === 'count_rows') {
      if (result.valeurs) return `nombre de ${result.valeurs} ${_differents(result.valeurs)} (colonne ${col(result.col)}), pas un nombre de ${unite}`;
      if (result.etablissements === true) return `nombre d'établissements différents (colonne ${col(result.col)}), pas un nombre de ${unite}`;
      return `nombre de ${unite}`;
    }
    if (kind === 'ratio') return `${(result.libelle || 'rapport').toLowerCase()} = somme de ${col(result.colNum)} ÷ somme de ${col(result.colDen)}`;
    if (kind === 'sum') return `somme de ${col(result.col)} (${result.unite || 'total'})`;
    if (kind === 'stats') return `${_NOMS_STAT[result.demandee || 'avg']} de ${col(plan.targetCol || plan.statsCol)}`;
    if (kind === 'stats_groupes') return `${_NOMS_STAT[result.demandee || 'avg']} de ${col(result.col)}, pour chaque valeur de ${col(result.dim)}`;
    if (kind === 'group_by' || kind === 'top') {
      if (plan.lesquelles && /^(etablissement|lycee|universite)/.test(_hx(plan.targetCol || ''))) return `liste des établissements (colonne ${col(plan.targetCol)})`;
      if (plan.listMode) return `liste des intitulés de formation (colonne ${col(plan.targetCol)})`;
      if (result.somme) return `somme de ${col(result.somme.col)} pour chaque valeur de ${col(plan.targetCol)}`;
      if (result.etablissements) return `nombre d'établissements différents pour chaque valeur de ${col(plan.targetCol)}`;
      return kind === 'top' ? `valeurs les ${plan.croissant ? 'moins' : 'plus'} fréquentes de ${col(plan.targetCol)} (nombre de ${unite})` : `répartition des ${unite} par ${col(plan.targetCol)}`;
    }
    if (kind === 'pivot') return `tableau croisé ${col(plan.targetCol)} × ${col(plan.targetCol2)} (nombre de ${unite})`;
    if (kind === 'part') { const lp = _libellePart(plan); return `part des ${lp.quoi} parmi les ${lp.sur}`; }
    if (kind === 'part_groupes') { const lp = _libellePart(plan); return `part des ${lp.quoi} parmi les ${lp.sur}, calculée dans chaque valeur de ${col(result.groupe)}`; }
    if (kind === 'classement') return `classement des ${plan.classement?.entite ? plan.classement.entite.nom : unite} selon ${plan.classement?.libelle || col(plan.classement?.col)}`;
    if (kind === 'compare') return `comparaison de ${(result.rows || []).map(r => `« ${r.label} »`).join(' et ')}`;
    if (kind === 'evolution' || kind === 'evolution_groupes') return `évolution entre les sessions ${(result.sessions || (result.lignes || []).map(l => l.session)).join(' et ')}`;
  } catch (e) { /* résultat incomplet : pas de phrase */ }
  return '';
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

// v27.5.60 — chaque établissement avec sa commune et son nombre de lignes, tous affichés (pas de pourcentages, pas de
// limite à 20) : « donne-moi la liste », « quels établissements proposent le BTS MCO en Gironde ? »
function renderListeEtablissementsHtml(plan, result, perim, filtersHtml, debug) {
    const lignes = applyLocalActionFilters(plan.table.objects || [], plan.filters || []);
    const cle = _cleEtablissement(plan.table, plan.targetCol);
    const _role = /accueil|accepte|affect|admis/.test(_hx(plan.targetCol)) ? 'accueil' : /scolarite|origine/.test(_hx(plan.targetCol)) ? 'origine' : '';
    const communes = (plan.table.headers || []).filter(h => /^(commune|ville)/.test(_hx(h)) && !/code|insee|postal/.test(_hx(h)));
    const comCol = (_role === 'accueil' ? communes.find(h => /accueil|accepte|affect|admis/.test(_hx(h))) : _role === 'origine' ? communes.find(h => /scolarite|origine/.test(_hx(h))) : null) || communes.find(h => !/origine/.test(_hx(h)));
    const m = new Map();
    lignes.forEach(r => { const k = cle(r); if (!k) return; if (!m.has(k)) m.set(k, { nom: String(r[plan.targetCol]).trim(), commune: comCol ? String(r[comCol] ?? '').trim() : '', n: 0 }); m.get(k).n++; });
    const liste = [...m.values()].sort((a, b) => a.commune.localeCompare(b.commune, 'fr') || a.nom.localeCompare(b.nom, 'fr'));
    const unite = plan.table.rowUnit === 'formation' ? 'formation' : 'candidat';
    const _t0 = (typeof extractBlockTitle === 'function') ? extractBlockTitle({ plan, result }, '') : '';
    const _suite = String(_t0).includes(' — ') ? String(_t0).slice(String(_t0).indexOf(' — ')) : '';
    const titre = `Établissements (${liste.length})${_suite}`;
    const items = liste.map(x => `<li>${escapeHtml(x.nom)}${x.commune ? ` <span style="color:var(--gris6,#6b7280)">(${escapeHtml(x.commune)})</span>` : ''} — ${x.n.toLocaleString('fr-FR')} ${unite}${x.n > 1 ? 's' : ''}</li>`).join('');
    const intro = `<p><strong>${liste.length.toLocaleString('fr-FR')}</strong> établissement${liste.length > 1 ? 's' : ''} pour <strong>${lignes.length.toLocaleString('fr-FR')}</strong> ${unite}${lignes.length > 1 ? 's' : ''}${comCol ? ', classés par commune' : ''}.</p>`;
    return `${deTitleHtml(titre, plan.blockId, plan.originalTitle || titre)}${perim}${intro}<ul>${items}</ul><p><strong>Filtres appliqués</strong></p>${filtersHtml}${debug}`;
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
    // v27.23 — établissements différents (« combien de lycées proposent des BTS »)
    const _nomV = result.valeurs || 'établissements';
    const phrase = result.valeurs
      ? `Il y a <strong>${result.count.toLocaleString('fr-FR')}</strong> ${escapeHtml(result.count > 1 ? _nomV : _nomV.replace(/s$/, ''))} ${result.count > 1 ? _differents(_nomV) : _differents(_nomV).replace(/s$/, '')} correspondant à la demande, pour <strong>${result.formations.toLocaleString('fr-FR')}</strong> ${result.parCandidat ? 'ligne' : 'formation'}${result.formations > 1 ? 's' : ''} (sur ${result.total.toLocaleString('fr-FR')} dans les données).`
      : result.etablissements
      ? (result.parCandidat
        ? `Il y a <strong>${result.count.toLocaleString('fr-FR')}</strong> ${result.count > 1 ? 'établissements différents' : 'établissement'} correspondant à la demande, pour <strong>${result.formations.toLocaleString('fr-FR')}</strong> candidat${result.formations > 1 ? 's' : ''} (sur ${result.total.toLocaleString('fr-FR')} établissements dans le fichier).`
        : `Il y a <strong>${result.count.toLocaleString('fr-FR')}</strong> ${result.count > 1 ? 'établissements différents' : 'établissement'} correspondant à la demande, qui proposent <strong>${result.formations.toLocaleString('fr-FR')}</strong> formation${result.formations > 1 ? 's' : ''} (sur ${result.total.toLocaleString('fr-FR')} établissements dans les données).`)
      : `Il y a <strong>${result.count.toLocaleString('fr-FR')}</strong> ${unit(result.count)} correspondant à la demande (${pct} du jeu de données).`;
    return `${deTitleHtml(clearTitle, plan.blockId, plan.originalTitle || clearTitle)}${perim}<p>${phrase}</p><p><strong>Filtres appliqués</strong></p>${filtersHtml}${debug}`;
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
      + (result.memeIntitule ? `<p style="margin:10px 0 6px">Ces ${result.total.toLocaleString('fr-FR')} ${unit(result.total)} ont le même intitulé : aucune colonne ne précise leur option. <strong>Par établissement</strong> :</p>${_tableauEtablissementsHtml(result.memeIntitule)}<p style="font-size:12px;color:var(--gris3);margin:6px 0 0">Pour connaître leur option, consultez la fiche de chaque formation sur Parcoursup ; la capacité aide à repérer les formations au même intitulé (deux formations peuvent avoir la même).</p>` : '')
      + (result.sansPrecision ? `<div style="background:#fff7ed;border-left:3px solid #c2410c;border-radius:4px;padding:8px 12px;margin:10px 0"><p style="margin:0 0 6px"><strong>⚠️ Liste incomplète</strong> : seules <strong>${result.filled.toLocaleString('fr-FR')}</strong> ${unit(result.filled)} sur ${result.total.toLocaleString('fr-FR')} ont une précision dans « ${escapeHtml(plan.targetCol)} » (option, lieu d'enseignement…). Les <strong>${(result.total - result.filled).toLocaleString('fr-FR')}</strong> autres n'en ont aucune : cette liste n'est pas celle de toutes les options proposées.</p><p style="margin:0 0 6px"><strong>${unit(2).replace(/^./, c => c.toUpperCase())} sans précision, par établissement</strong> :</p>${_tableauEtablissementsHtml(result.sansPrecision)}<p style="font-size:12px;color:var(--gris3);margin:6px 0 0">Pour connaître leur option, consultez la fiche de chaque formation sur Parcoursup ; la capacité aide à repérer les formations au même intitulé (deux formations peuvent avoir la même).</p></div>` : '');
    return `${deTitleHtml(clearTitle, plan.blockId, plan.originalTitle || clearTitle)}${perim}<p><strong>${(result.distinct ?? rows.length).toLocaleString('fr-FR')}</strong> intitulé${(result.distinct ?? rows.length) > 1 ? 's' : ''} différent${(result.distinct ?? rows.length) > 1 ? 's' : ''} dans <strong>${escapeHtml(plan.targetCol)}</strong>, pour <strong>${result.total.toLocaleString('fr-FR')}</strong> ${unit(result.total)}.</p><ul>${rows.map(r => `<li>${escapeHtml(r.value)} : <strong>${r.count.toLocaleString('fr-FR')}</strong></li>`).join('')}</ul>${reste}<p><strong>Filtres appliqués</strong></p>${filtersHtml}${debug}`;
  }
  // v27.5.60 — liste d'établissements (« donne-moi la liste », « quels établissements proposent… »)
  if ((tool === 'group_by' || tool === 'top') && plan.lesquelles && plan.targetCol && /^(etablissement|lycee|universite)/.test(_hx(plan.targetCol))) return renderListeEtablissementsHtml(plan, result, perim, filtersHtml, debug);
  if (tool === 'group_by' || tool === 'top') {
    const rows = result.rows || [];
    const clearTitle = (typeof extractBlockTitle === 'function') ? extractBlockTitle({ plan, result }, '') : (tool === 'top' ? 'Top' : 'Répartition');
    const _so = result.somme;
    const _et = result.etablissements;
    const _intro = _et
      ? `<p><strong>${_et.total.toLocaleString('fr-FR')}</strong> établissements différents, sur <strong>${result.total.toLocaleString('fr-FR')}</strong> ${unit(result.total)}. Nombre d'établissements par <strong>${escapeHtml(plan.targetCol)}</strong>.</p>`
      : _so
      ? `<p><strong>${_so.total.toLocaleString('fr-FR')}</strong> ${escapeHtml(_so.unite)} au total, sur <strong>${result.total.toLocaleString('fr-FR')}</strong> ${unit(result.total)}. Somme de « ${escapeHtml(_so.col)} » par <strong>${escapeHtml(plan.targetCol)}</strong>.</p>`
      : `<p><strong>${result.total.toLocaleString('fr-FR')}</strong> ligne${result.total>1?'s':''} retenue${result.total>1?'s':''}. Analyse par <strong>${escapeHtml(plan.targetCol)}</strong>.</p>`;
    return `${deTitleHtml(clearTitle, plan.blockId, plan.originalTitle || clearTitle)}${perim}${_intro}<ul>${rows.slice(0,20).map(r => `<li>${escapeHtml(r.value)} : <strong>${r.count.toLocaleString('fr-FR')}</strong>${_so ? ` ${escapeHtml(_so.unite)}` : _et ? ` établissement${r.count > 1 ? 's' : ''}` : ''}${_et ? '' : ` (${r.pct.toFixed(1).replace('.', ',')} %)`}</li>`).join('')}</ul>${plan.renderChart ? (plan.chartType === 'pie' ? renderMiniPieChart(rows, result.total) : renderMiniBarChart(rows, result.total)) : ''}${filtersHtml}${debug}`;
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
    // v27.24 — la statistique demandée (médiane, minimum…) en titre ; une seule formation : sa valeur
    const dem = result.demandee || 'avg';
    const clearTitle = result.numericCount === 1 ? `${_shortColName(plan.targetCol)} : ${fmt(result.avg)}` : `${_shortColName(plan.targetCol)} — ${_NOMS_STAT[dem]} : ${fmt(result[dem])}`;
    const corpsStats = result.numericCount === 1
      ? `<p>Une seule formation correspond : <strong>${escapeHtml(result.uneFormation || '')}</strong> — ${escapeHtml(plan.targetCol)} : <strong>${fmt(result.avg)}</strong>.</p>${filtersHtml}${debug}`
      : null;
    return `${deTitleHtml(clearTitle, plan.blockId, plan.originalTitle || clearTitle)}${perim}${corpsStats !== null ? corpsStats : `<p>Colonne : <strong>${escapeHtml(plan.targetCol)}</strong> (moyenne simple des formations, non pondérée)</p><ul><li>Valeurs numériques : <strong>${result.numericCount.toLocaleString('fr-FR')}</strong> / ${result.total.toLocaleString('fr-FR')}</li><li>Moyenne : <strong>${fmt(result.avg)}</strong></li><li>Médiane : <strong>${fmt(result.median)}</strong></li><li>Min : <strong>${fmt(result.min)}</strong></li><li>Max : <strong>${fmt(result.max)}</strong></li></ul>${filtersHtml}${debug}`}`;
  }
  return `${deTitleHtml('Résultat', plan.blockId, plan.originalTitle || 'Résultat')}${debug}`;
}

function shouldAnswerLocallyWithoutAlbert(exec) {
  if (!exec) return false;
  // Les requêtes de comptage/répartition simples doivent être résolues par le moteur,
  // sinon Albert risque de répondre à partir d'un résumé incomplet.
  // v27.7 — « unresolved » : terme introuvable, on le dit plutôt que de laisser Albert inventer
  // v27.5.78 — « ratio » (candidats par place) : calculé, affiché sans Albert (avant : un appel à Albert inutile)
  return ['count','group_by','top','pivot','stats','export','compare','unresolved','sum','classement','part','evolution','evolution_groupes','stats_groupes','part_groupes','pdf','ratio'].includes(exec.kind);
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
