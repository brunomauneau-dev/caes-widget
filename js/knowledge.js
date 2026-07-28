/* knowledge.js — Lexique Parcoursup, base de connaissances KB, open data reference
   Dépend de : config.js */

/* ═══════════════════════ LEXIQUE PARCOURSUP ═══════════════════════
   Le modèle derrière Albert API ne connaît pas forcément le jargon
   métier Parcoursup/SAIO. On lui donne explicitement la traduction de
   quelques termes techniques courants, pour qu'il fasse le lien entre
   une question posée en langage courant (ex: "orientation") et le nom
   exact d'une colonne ou d'une notion dans les documents fournis.
   À enrichir librement si d'autres confusions sont constatées. */
const PARCOURSUP_GLOSSAIRE = `Lexique Parcoursup (à utiliser pour interpréter les colonnes et les questions posées en langage courant) :
- "Orientation" d'un candidat = la spécialité/mention/filière de formation qu'il a acceptée, en général dans une colonne nommée "Spécialité / mention formation d'accueil acceptée".
- "Code UAI" = identifiant officiel d'un établissement (jamais une donnée à moyenner ou agréger).
- "Proposition" = offre de formation faite par Parcoursup à un candidat. Distinct de :
  - "proposition reçue" (Oui/Non) = le candidat a au moins une offre, qu'il l'ait acceptée ou non ;
  - "proposition acceptée" / "a répondu favorablement" = le candidat a confirmé cette offre — seule cette dernière compte comme une admission effective.
- "Voeu" = une demande de formation formulée par le candidat. Distinct de :
  - "voeu confirmé" = le candidat a validé/maintenu ce voeu après l'avoir formulé ;
  - "voeu classé" = le candidat a positionné ce voeu dans son ordre de préférence (uniquement pertinent en phase principale, pas en complémentaire).
  Ne jamais confondre "nb de voeux" (formulés) avec "nb de voeux confirmés" — un candidat peut formuler 10 voeux et n'en confirmer que 3.
- "Boursier" = candidat bénéficiaire d'une bourse sur critères sociaux (distinct de "Boursier des lycées" qui est le statut pendant la scolarité actuelle, et "ASE" qui est l'aide sociale à l'enfance, une catégorie différente).
- "Série" = série du baccalauréat (générale, technologique, professionnelle) ; "type de classe" = origine scolaire du candidat avant Parcoursup (terminale, réorientation, etc.) — ce ne sont pas des synonymes.
- "Néo-bachelier" = candidat qui vient d'obtenir son bac l'année de la campagne en cours, par opposition aux candidats en reprise d'études ou en réorientation.
- "Phase principale" (PP) et "Phase complémentaire" (PC) sont deux périodes distinctes de la procédure Parcoursup : la PC s'adresse aux candidats sans proposition (ou non encore inscrits) après la phase principale. Une question sur "les candidats en PC" ne concerne donc PAS l'ensemble des candidats, seulement ce sous-groupe spécifique.
- "Dérogatoire" (dossier dérogatoire) = un dossier nécessitant un examen individualisé sortant du traitement standard (ex: situation médicale, familiale), à ne pas confondre avec "hors délai".
- "Hors délai" (Hors délai PC, Hors délai Parcoursup) = un candidat ou dossier soumis après l'échéance réglementaire normale — une procédure d'exception, distincte du caractère dérogatoire.
- "Secteur" / "hors secteur" = qualifie si la formation demandée relève de la zone de recrutement géographique habituelle du candidat (son secteur) ou non — n'a aucun rapport avec le secteur d'activité économique de la formation.
- "Démissionnaire" (démission) = un candidat qui renonce explicitement à une proposition ou à la procédure, distinct d'un candidat "sans proposition" qui n'a simplement encore rien reçu.
- "CAES" (Commission d'Accès à l'Enseignement Supérieur) = dispositif d'accompagnement pour les candidats sans proposition ou en difficulté dans la procédure — un statut CAES n'implique pas automatiquement une proposition obtenue.
- "Apprentissage" en tant que filière de formation est différent du statut "Apprenti" du candidat (qui peut désigner sa situation scolaire actuelle, hors Parcoursup).
- Quand une question évoque un pourcentage ou une proportion ("quelle part de...", "combien de %..."), vérifie toujours sur quelle population de référence (tous les candidats ? seulement ceux ayant une proposition ? seulement les boursiers ?) le calcul doit porter — ne jamais supposer la population totale par défaut sans le vérifier dans le contexte fourni.

Contexte SAIO Bordeaux — précisions métier :
- "Zone du Pays Basque" dans cette BDD = sous-ensemble de candidats dont l'établissement de scolarité est situé en zone Pays Basque (défini à partir des codes postaux et communes des dossiers). Ce n'est PAS une zone administrative officielle, c'est un découpage spécifique à l'académie de Bordeaux pour les analyses SAIO.
- Le scope géographique habituel des analyses SAIO est l'académie (le plus courant), puis le département, puis la commune (rare). La Zone Pays Basque est un cas particulier de cette BDD.
- L'académie de Bordeaux couvre 5 départements : Gironde (33), Dordogne (24), Lot-et-Garonne (47), Landes (40), Pyrénées-Atlantiques (64). La zone Pays Basque relève principalement des Pyrénées-Atlantiques (64).
- "CAES" (Commission d'Accès à l'Enseignement Supérieur) = procédure d'accompagnement parallèle à Parcoursup, traitée par des commissions académiques. IMPORTANT : les dossiers CAES ne sont PAS dans cette BDD — ils font l'objet d'analyses séparées. Si une question porte sur les CAES, indiquer qu'ils ne sont pas présents dans ce jeu de données.
- Acronymes courants dans l'Éducation nationale à reconnaître : SAIO (Service Académique d'Information et d'Orientation), CAES, PP (phase principale), PC (phase complémentaire), UAI (code établissement), BDD (base de données).
- "Candidater" = formuler un vœu sur Parcoursup. Synonyme opérationnel de "faire un vœu", "soumettre une candidature".
- "Vœux formulés" = tous les vœux saisis par le candidat, qu'il les ait maintenus ou non.
- "Vœux confirmés" = vœux que le candidat a explicitement validés/maintenus — c'est la colonne "Nb total de vœux confirmés en phase principale" dans cette BDD. C'est cette valeur qu'on utilise dans les analyses.
- "Proposition d'admission" = offre faite au candidat par Parcoursup ; elle peut être acceptée (= le candidat a répondu favorablement) ou non encore acceptée. Ne pas confondre "avoir une proposition" et "avoir accepté une proposition".`;

/* Associe certains intitulés de colonnes à leur signification en langage
   courant. Le matching se fait par mot-clé (insensible à la casse), pas par
   nom exact, pour rester robuste aux légères variations d'intitulé entre
   exports Parcoursup. */
const COLUMN_ALIASES = [
  { match: /sp[ée]cialit[ée].*mention|formation.*accueil.*accept[ée]e?/i, alias: 'orientation / formation acceptée par le candidat' },
  { match: /\bboursier\b(?!.*lyc[ée]e)/i, alias: "bénéficiaire d'une bourse sur critères sociaux" },
  { match: /boursier.*lyc[ée]e/i, alias: "statut boursier pendant la scolarité actuelle (≠ bourse sur critères sociaux générale)" },
  { match: /\bs[ée]rie\b/i, alias: 'série du baccalauréat' },
  { match: /type de classe/i, alias: 'origine scolaire avant Parcoursup' },
  { match: /n[ée]o.?bachelier/i, alias: 'vient d\'obtenir le bac cette année (≠ réorientation/reprise)' },
  { match: /a (eu|re[çc]u).*proposition/i, alias: 'a au moins une offre (≠ acceptée)' },
  { match: /r[ée]pondu favorablement|proposition.*accept[ée]e/i, alias: 'a confirmé/accepté une offre = admission effective' },
  { match: /voe?u.*confirm[ée]/i, alias: 'voeu validé après formulation (≠ simplement formulé)' },
  { match: /voe?u.*class[ée]/i, alias: 'voeu positionné dans l\'ordre de préférence (PP uniquement)' },
  { match: /phase principale|\bPP\b/i, alias: 'période de la procédure avant la phase complémentaire' },
  { match: /phase compl[ée]mentaire|\bPC\b/i, alias: 'sous-groupe de candidats sans proposition après la PP, pas l\'ensemble des candidats' },
  { match: /d[ée]roga(toire)?/i, alias: 'dossier à examen individualisé (≠ hors délai)' },
  { match: /hors d[ée]lai/i, alias: 'soumis après échéance réglementaire (≠ dérogatoire)' },
  { match: /hors secteur|\bsecteur\b/i, alias: 'zone de recrutement géographique du candidat (sans lien avec un secteur économique)' },
  { match: /d[ée]mission(naire)?/i, alias: 'a renoncé explicitement (≠ candidat simplement sans proposition)' },
  { match: /\bcaes\b/i, alias: 'Commission d\'Accès à l\'Enseignement Supérieur — procédure parallèle à Parcoursup, ABSENTE de cette BDD (analyses séparées)' },
  { match: /zone.*pays.*basque|pays.*basque/i, alias: 'sous-zone géographique de l\'académie de Bordeaux, définie par codes postaux/communes — colonne spécifique à cette BDD' },
  { match: /\bcandidater\b|\bcandidature\b/i, alias: 'formuler un vœu sur Parcoursup (synonyme opérationnel de "faire un vœu")' },
  { match: /voeux? formul[eé]s?/i, alias: 'vœux saisis par le candidat, maintenus ou non (≠ vœux confirmés)' },
  { match: /acad[eé]mie de bordeaux|\bbordeaux\b/i, alias: 'académie couvrant 5 départements : Gironde (33), Dordogne (24), Lot-et-Garonne (47), Landes (40), Pyrénées-Atlantiques (64)' },
  { match: /\bsaio\b/i, alias: 'Service Académique d\'Information et d\'Orientation — service du rectorat qui pilote les analyses Parcoursup' },
  { match: /proposition/i, alias: "offre de formation faite au candidat (≠ acceptation)" },
];
function columnAlias(header) {
  const found = COLUMN_ALIASES.find(e => e.match.test(header));
  return found ? ` [= ${found.alias}]` : '';
}


/* ═══════════════════════ BASE DE CONNAISSANCES PARCOURSUP ═══════════════════════
   La base est volontairement séparée du HTML : déposer parcoursup-kb-v0.json
   dans le même dossier que le widget. Le widget injecte uniquement les fiches
   pertinentes dans le prompt Albert, afin de rester léger et traçable. */
const PARCOURSUP_KB_URL = 'parcoursup-kb-v2.json';
const PARCOURSUP_KB_INDEX_URL = 'parcoursup-kb-index-v2.json';
let parcoursupKB = { meta: null, entries: [] };
let parcoursupKBReady = false;
let parcoursupKBIndex = { meta: null, index: {}, related: {} };
let parcoursupKBIndexReady = false;
let lastKnowledgeTrace = [];
const PARCOURSUP_OD_URL = 'parcoursup-opendata-reference-v1.json';
let parcoursupOD = { meta: null, important_columns: [], dimensions: {}, aggregates: {} };
let parcoursupODReady = false;
let parcoursupNational = [];
let parcoursupNationalReady = false;
let nationalModeActive = false;
function setNationalMode(active) { nationalModeActive = active; }

function normalizeForSearch(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function loadParcoursupKB() {
  try {
    const response = await fetch(PARCOURSUP_KB_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    parcoursupKB = {
      meta: data.meta || {},
      entries: Array.isArray(data.entries) ? data.entries : []
    };
    parcoursupKBReady = parcoursupKB.entries.length > 0;
    await loadParcoursupKBIndex();
    updateKnowledgeStatusBadge();
  } catch (e) {
    console.warn('[Parcoursup KB] base non chargée :', e.message);
    parcoursupKBReady = false;
    updateKnowledgeStatusBadge();
  }
}

async function loadParcoursupKBIndex() {
  try {
    const response = await fetch(PARCOURSUP_KB_INDEX_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    parcoursupKBIndex = await response.json();
    parcoursupKBIndexReady = !!(parcoursupKBIndex && parcoursupKBIndex.index);
  } catch (e) {
    console.warn('[Parcoursup KB] index hybride non chargé, fallback recherche simple :', e.message);
    parcoursupKBIndexReady = false;
  }
}

function updateKnowledgeStatusBadge() {
  const sub = document.getElementById('chat-sub');
  if (!sub) return;
  const base = getActiveDataSource && getActiveDataSource()
    ? `${getActiveDataSource().source} actif`
    : (documents.filter(d => d.status === 'ok').length ? 'Document(s) chargé(s)' : 'Aucun document chargé');
  const kb = parcoursupKBReady ? ` · KB Parcoursup ${parcoursupKB.entries.length} fiches${parcoursupKBIndexReady ? ' · index hybride' : ''}` : '';
  const od = parcoursupODReady ? ` · OpenData national` : '';
  const nat = parcoursupNationalReady ? ` · ${parcoursupNational.length} formations live` : '';
  sub.textContent = base + kb + od + nat;
}

function extractSearchTerms(text) {
  const normalized = normalizeForSearch(text);
  const stop = new Set('avec dans pour plus moins cette ces des les une un aux sur par que qui quoi dont etre est sont avoir du de la le l d a et ou il elle ils elles candidat candidats parcoursup dossier question demande vous votre vos leur leurs nos mes ses son sa ce cet donc afin cela comme mais pas oui non tout tous toute toutes depuis entre lors sans vers page voir rubrique formation formations'.split(' '));
  return normalized.split(/\s+/).filter(w => w.length >= 3 && !stop.has(w)).slice(0, 60);
}

function getKBEntryById(id) {
  if (!parcoursupKBReady) return null;
  if (!parcoursupKB._byId) {
    parcoursupKB._byId = Object.fromEntries(parcoursupKB.entries.map(e => [e.id, e]));
  }
  return parcoursupKB._byId[id] || null;
}

function trustWeight(entry) {
  if (!entry) return 0.75;
  if (typeof entry.source_weight === 'number') return entry.source_weight;
  const map = {
    officiel_interne: 1.00,
    officiel_public: 0.96,
    rapport_public: 0.88,
    opendata: 0.86,
    doctrine_saio: 0.78,
    note_locale: 0.70
  };
  return map[entry.trust_level] || 0.75;
}

function boostBusinessConcepts(question, entry) {
  const q = normalizeForSearch(question);
  const hay = normalizeForSearch(`${entry.title || ''} ${(entry.tags || []).join(' ')} ${entry.summary || ''}`);
  let boost = 0;
  const pairs = [
    [/admission|admis|accepte|acceptation|favorable/, /proposition|admission|accept|favorable|classe/],
    [/voeu|voeux|vœu|vœux|sous voeu|sous voeux/, /voeu|vœu|sous|confirme|classe/],
    [/identifiant|mot de passe|mail|mel|adresse|connexion/, /identifiant|mot passe|adresse mel|mel|connexion|compte/],
    [/boursier|bourse|crous/, /boursier|bourse|crous/],
    [/caes|commission acces|sans proposition/, /caes|commission|sans proposition|acces/],
    [/phase complementaire|pc/, /phase complementaire|pc/],
    [/phase principale|pp/, /phase principale|pp/],
    [/opendata|open data|national|moyenne|reference|comparaison/, /opendata|rapport public|reference|indicateur|national/]
  ];
  pairs.forEach(([qr, er]) => { if (qr.test(q) && er.test(hay)) boost += 14; });
  return boost;
}

function searchParcoursupKnowledge(question, columns = [], maxResults = 6) {
  if (!parcoursupKBReady) return [];
  const terms = extractSearchTerms(`${question} ${columns.join(' ')}`);
  if (!terms.length) return [];
  const scoreMap = new Map();
  const reasons = new Map();

  const addScore = (id, amount, reason) => {
    if (!id || !amount) return;
    scoreMap.set(id, (scoreMap.get(id) || 0) + amount);
    if (!reasons.has(id)) reasons.set(id, []);
    if (reason && reasons.get(id).length < 6) reasons.get(id).push(reason);
  };

  if (parcoursupKBIndexReady && parcoursupKBIndex.index) {
    for (const term of terms) {
      const postings = parcoursupKBIndex.index[term] || [];
      postings.slice(0, 35).forEach(([id, weight]) => addScore(id, weight, `terme « ${term} »`));
    }
  }

  // Fallback / complément : recherche directe sur titre, tags, résumé.
  parcoursupKB.entries.forEach(entry => {
    const title = normalizeForSearch(entry.title || '');
    const tags = normalizeForSearch((entry.tags || []).join(' '));
    const summary = normalizeForSearch(entry.summary || '');
    let score = 0;
    for (const term of terms) {
      if (tags.includes(term)) score += 8;
      if (title.includes(term)) score += 6;
      if (summary.includes(term)) score += 3;
    }
    if (score) addScore(entry.id, score * trustWeight(entry), 'titre/tags/résumé');
  });

  // Bonus concepts métier + pondération source.
  for (const [id, score] of [...scoreMap.entries()]) {
    const entry = getKBEntryById(id);
    if (!entry) continue;
    const weighted = score * trustWeight(entry) + boostBusinessConcepts(question, entry);
    scoreMap.set(id, weighted);
  }

  let ranked = [...scoreMap.entries()]
    .map(([id, score]) => ({ entry: getKBEntryById(id), score, reasons: reasons.get(id) || [] }))
    .filter(x => x.entry && x.score > 0)
    .sort((a, b) => b.score - a.score);

  // Expansion graphe : ajoute quelques fiches liées aux meilleurs résultats.
  const expanded = new Map(ranked.map(x => [x.entry.id, x]));
  ranked.slice(0, 3).forEach(hit => {
    const rel = hit.entry.related_ids || parcoursupKBIndex.related?.[hit.entry.id] || [];
    rel.slice(0, 3).forEach((rid, idx) => {
      if (expanded.has(rid)) return;
      const relEntry = getKBEntryById(rid);
      if (!relEntry) return;
      expanded.set(rid, {
        entry: relEntry,
        score: hit.score * (0.22 - idx * 0.03),
        reasons: [`fiche liée à « ${hit.entry.title} »`]
      });
    });
  });

  ranked = [...expanded.values()].sort((a, b) => b.score - a.score).slice(0, maxResults);
  lastKnowledgeTrace = ranked.map((x, i) => ({
    rank: i + 1,
    id: x.entry.id,
    title: x.entry.title,
    source: x.entry.source,
    trust_level: x.entry.trust_level,
    score: Math.round(x.score * 10) / 10,
    reasons: x.reasons
  }));
  return ranked.map(x => x.entry);
}

function formatKnowledgeTraceHtml() {
  if (!lastKnowledgeTrace || !lastKnowledgeTrace.length) return '';
  return `<details style="margin-top:8px"><summary style="cursor:pointer;color:var(--gris3);font-size:11px">Sources KB utilisées (${lastKnowledgeTrace.length})</summary><ul style="font-size:11px;color:var(--gris3);margin-top:6px">` +
    lastKnowledgeTrace.map(t => `<li><strong>${escapeHtml(t.title || '')}</strong> · ${escapeHtml(t.source || '')} · score ${t.score}${t.reasons?.length ? ` · ${escapeHtml(t.reasons.join(', '))}` : ''}</li>`).join('') +
    `</ul></details>`;
}

function buildParcoursupKnowledgeContext(question, localContext = '') {
  const src = (typeof getActiveDataSource === 'function') ? getActiveDataSource() : null;
  const columns = src && src.headers ? src.headers : [];
  const hits = searchParcoursupKnowledge(question + '\n' + localContext.slice(0, 1200), columns, 5);

  // Avertissement CAES : ces dossiers ne sont pas dans la BDD Parcoursup standard
  const qNorm = normalizeForSearch(question);
  let caesWarning = '';
  if (/\bcaes\b|commission acces|commission d.acces/.test(qNorm)) {
    caesWarning = `\nATTENTION — CAES : Les dossiers traités en Commission d'Accès à l'Enseignement Supérieur (CAES) ne sont PAS présents dans cette base de données Parcoursup. Ils font l'objet d'analyses séparées. Ne pas tenter de les chercher dans ce jeu de données.\n`;
  }

  if (!hits.length && !caesWarning) return '';
  return `RÉFÉRENCES MÉTIER PARCOURSUP SÉLECTIONNÉES AUTOMATIQUEMENT${caesWarning}\n` +
    hits.map((e, i) => {
      const content = String(e.content || '').slice(0, 1400);
      const tags = (e.tags || []).slice(0, 8).join(', ');
      return `[#${i + 1}] ${e.title}\nSource : ${e.source || 'base Parcoursup'}${e.last_modified ? ` · mise à jour : ${e.last_modified}` : ''}\nMots-clés : ${tags}\nRésumé : ${e.summary || ''}\nExtrait utile : ${content}`;
    }).join('\n\n---\n\n');
}

loadParcoursupKB();

async function loadParcoursupOpenDataReference() {
  try {
    const response = await fetch(PARCOURSUP_OD_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    parcoursupOD = await response.json();
    parcoursupODReady = !!(parcoursupOD && parcoursupOD.meta);
    updateKnowledgeStatusBadge();
  } catch (e) {
    console.warn('[Parcoursup OpenData] référentiel non chargé :', e.message);
    parcoursupODReady = false;
    updateKnowledgeStatusBadge();
  }
}

function wantsOpenDataReference(question) {
  const q = normalizeForSearch(question);
  return /national|moyenne|reference|referentiel|opendata|open data|comparer|comparaison|parcoursupdata|taux d acces|taux acces|pression|candidats par place|rang dernier appele|filiere|academie|region/.test(q);
}

function compactOpenDataRows(rows, maxRows = 10) {
  if (!Array.isArray(rows) || !rows.length) return '';
  return rows.slice(0, maxRows).map(r => {
    const label = r.label || 'Non renseigné';
    const cand = r['Effectif total des candidats pour une formation'];
    const admis = r['Effectif total des candidats ayant accepté la proposition de l'établissement (admis)'];
    const prop = r['Effectif total des candidats ayant reçu une proposition d'admission de la part de l'établissement'];
    const cap = r['Capacité de l'établissement par formation'];
    const pression = r.pression_candidats_par_place;
    const tauxAdmis = r.taux_admis_sur_candidats_pct;
    const tauxProp = r.taux_propositions_sur_candidats_pct;
    return `- ${label} : candidats=${cand ?? 'n.d.'}, propositions=${prop ?? 'n.d.'}, admis=${admis ?? 'n.d.'}, places=${cap ?? 'n.d.'}, pression=${pression ?? 'n.d.'} candidats/place, admis/candidats=${tauxAdmis ?? 'n.d.'} %, propositions/candidats=${tauxProp ?? 'n.d.'} %`;
  }).join('\n');
}

function buildOpenDataReferenceContext(question) {
  if (!parcoursupODReady || !wantsOpenDataReference(question)) return '';
  const q = normalizeForSearch(question);
  const parts = [];
  const meta = parcoursupOD.meta || {};
  parts.push(`RÉFÉRENTIEL NATIONAL OPENDATA PARCOURSUP\nSource : ${meta.source_title || 'OpenData Parcoursup'} · ${meta.rows || '?'} lignes · ${meta.columns || '?'} colonnes\nURL source : ${meta.source_url || ''}\nAttention : ces données sont agrégées par formation ; elles ne contiennent pas de données individuelles candidats.`);
  if (/filiere|formation|licence|bts|but|cpge|ecole|ifsi|pass|las/.test(q) && parcoursupOD.aggregates?.par_filiere_tres_agregee) {
    parts.push(`\nAgrégats nationaux par filière très agrégée :\n${compactOpenDataRows(parcoursupOD.aggregates.par_filiere_tres_agregee, 12)}`);
  }
  if (/academie|académie|bordeaux|versailles|creteil|paris|toulouse|region|région|territoire/.test(q)) {
    if (parcoursupOD.aggregates?.par_academie) parts.push(`\nAgrégats nationaux par académie :\n${compactOpenDataRows(parcoursupOD.aggregates.par_academie, 12)}`);
    if (parcoursupOD.aggregates?.par_region) parts.push(`\nAgrégats nationaux par région :\n${compactOpenDataRows(parcoursupOD.aggregates.par_region, 8)}`);
  }
  if (/select|sélect|non selective|non sélective|cpge|bts|but/.test(q) && parcoursupOD.aggregates?.par_selectivite) {
    parts.push(`\nAgrégats nationaux par sélectivité :\n${compactOpenDataRows(parcoursupOD.aggregates.par_selectivite, 8)}`);
  }
  if (parts.length === 1) {
    parts.push(`\nColonnes OpenData utiles :\n- ${(parcoursupOD.important_columns || []).slice(0, 35).join('\n- ')}`);
    if (parcoursupOD.aggregates?.par_filiere_tres_agregee) parts.push(`\nExtrait par filière :\n${compactOpenDataRows(parcoursupOD.aggregates.par_filiere_tres_agregee, 6)}`);
  }
  const nationalCtx = buildNationalDataContext ? buildNationalDataContext(question) : '';
  if (nationalCtx) parts.push('\n' + nationalCtx);
  return parts.join('\n');
}

loadParcoursupOpenDataReference();

/* ═══════════════════════ DONNÉES NATIONALES LIVE (data.gouv API) ═══════════════════════
   Chargées au démarrage depuis l'API OpenDataSoft du ministère.
   Aucune installation requise — l'appel se fait directement depuis le navigateur.
   Données par formation (agrégées) — pas de données individuelles candidats. */

const PARCOURSUP_GOVAPI = 'https://data.enseignementsup-recherche.gouv.fr/api/explore/v2.1/catalog/datasets/fr-esr-parcoursup';
const NATIONAL_SESSION = 2025;
const NATIONAL_ACADEMIE = 'Bordeaux';
const NATIONAL_SELECT = [
  'session', 'g_uai', 'g_ea_lib_vx', 'dep_lib', 'acad_mies', 'region_etab_aff',
  'fili', 'lib_for_voe_ins', 'lib_comp_voe_ins', 'select_form',
  'capa_fin', 'voe_tot', 'voe_tot_f', 'prop_tot', 'acc_tot', 'acc_tot_f',
  'acc_bg', 'acc_bt', 'acc_bp',
  'pct_f', 'pct_bg', 'pct_bt', 'pct_bp', 'pct_bours', 'nb_bours_t',
  'rang_der_app_b', 'taux_adm'
].join(',');

/* Colonnes Grist à conserver pour les données nationales (évite de charger les 118 colonnes) */
const NATIONAL_COLS_KEEP = new Set([
  'session', 'contrat_etab', 'g_uai', 'g_ea_lib_vx', 'dep', 'dep_lib',
  'acad_mies', 'region_etab_aff', 'ville_etab',
  'fili', 'lib_for_voe_ins', 'lib_comp_voe_ins', 'form_lib_voe_acc', 'select_form',
  'capa_fin', 'voe_tot', 'voe_tot_f', 'prop_tot', 'acc_tot', 'acc_tot_f',
  'acc_bg', 'acc_bt', 'acc_bp',
  'pct_f', 'pct_bg', 'pct_bt', 'pct_bp', 'pct_bours', 'nb_bours_t',
  'rang_der_app_b', 'taux_adm'
]);

function parseCSVSimple(text, sep = ';') {
  const lines = text.replace(/\r\n?/g, '\n').trim().split('\n');
  if (lines.length < 2) return [];
  const parseRow = (line) => {
    const cells = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (c === sep && !inQ) { cells.push(cur); cur = ''; }
      else cur += c;
    }
    cells.push(cur);
    return cells;
  };
  const headers = parseRow(lines[0]);
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = parseRow(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
    return obj;
  });
}

async function loadParcoursupNational() {
  // 1. Source principale : table Grist Parcoursup_National
  try {
    if (typeof grist !== 'undefined' && grist.docApi) {
      const raw = await grist.docApi.fetchTable('Parcoursup_National');
      if (raw && raw.id && raw.id.length > 0) {
        const keys = Object.keys(raw).filter(k => k !== 'id' && !k.startsWith('manualSort') && NATIONAL_COLS_KEEP.has(k));
        parcoursupNational = raw.id.map((_, i) => {
          const obj = {};
          keys.forEach(k => { obj[k] = raw[k][i]; });
          return obj;
        });
        parcoursupNationalReady = parcoursupNational.length > 0;
        updateKnowledgeStatusBadge();
        return;
      }
    }
  } catch (e) {
    console.warn('[Parcoursup National] table Grist non disponible, essai data.gouv :', e.message);
  }

  // 2. Fallback : API data.gouv directement (si la table Grist n'existe pas encore)
  try {
    const params = new URLSearchParams({
      where: `session=${NATIONAL_SESSION} AND acad_mies="${NATIONAL_ACADEMIE}"`,
      select: NATIONAL_SELECT,
      limit: -1,
      delimiter: ';'
    });
    const r = await fetch(`${PARCOURSUP_GOVAPI}/exports/csv?${params}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    parcoursupNational = parseCSVSimple(text, ';');
    parcoursupNationalReady = parcoursupNational.length > 0;
    updateKnowledgeStatusBadge();
  } catch (e) {
    console.warn('[Parcoursup National] données non chargées :', e.message);
    parcoursupNationalReady = false;
    updateKnowledgeStatusBadge();
  }
}

function searchNationalFormations(question, maxResults = 8) {
  if (!parcoursupNationalReady || !parcoursupNational.length) return [];
  const terms = extractSearchTerms(question);
  if (!terms.length) return [];
  const scored = parcoursupNational.map(row => {
    const hay = normalizeForSearch(
      `${row.lib_comp_voe_ins || ''} ${row.lib_for_voe_ins || ''} ${row.fili || ''} ${row.g_ea_lib_vx || ''} ${row.dep_lib || ''}`
    );
    let score = 0;
    for (const t of terms) {
      if (hay.includes(t)) score += t.length;
    }
    return { row, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults).map(x => x.row);
}

function formatNationalRows(rows) {
  if (!rows.length) return '';
  return rows.map(r =>
    `- ${r.lib_comp_voe_ins || r.fili || 'Formation'} · ${r.g_ea_lib_vx || ''} (${r.dep_lib || ''})` +
    ` · capacité=${r.capa_fin || 'n.d.'}, voeux=${r.voe_tot || 'n.d.'}, admis=${r.acc_tot || 'n.d.'}` +
    `, taux admission=${r.taux_adm || 'n.d.'}%` +
    `, boursiers=${r.pct_bours || 'n.d.'}%` +
    `, rang dernier appelé=${r.rang_der_app_b || 'n.d.'}`
  ).join('\n');
}

function buildNationalDataContext(question) {
  if (!parcoursupNationalReady) {
    if (nationalModeActive) return `MODE NATIONAL ACTIVÉ — les données nationales ${NATIONAL_SESSION} ne sont pas encore chargées. Informe l'utilisateur et invite-le à patienter quelques secondes puis à reposer sa question.`;
    return '';
  }
  const q = normalizeForSearch(question);
  if (!nationalModeActive && !/national|bordeaux|formation|comparer|comparaison|taux|admission|rang|pression|boursier|filiere|capacite|bts|but|cpge|licence|ifsi|pass|las/.test(q)) return '';

  const hits = searchNationalFormations(question, nationalModeActive ? 15 : 8);
  const header = `DONNÉES NATIONALES PARCOURSUP — académie Bordeaux, session ${NATIONAL_SESSION} (source : data.gouv.fr)\nDonnées agrégées par formation. Ne contiennent PAS de données individuelles candidats.\nINSTRUCTION : quand tu cites ces données, précise systématiquement l'année (ex : "en ${NATIONAL_SESSION}, à titre de comparaison nationale...") pour distinguer des données locales de la session en cours.`;

  if (!hits.length && nationalModeActive) {
    // Question trop générique ou formation absente — deux sous-cas
    const isGeneric = /resume|synthese|synthèse|overview|apercu|liste|toutes?|ensemble|global/i.test(q);
    if (isGeneric) {
      // Retourner un échantillon représentatif (10 formations variées)
      const sample = parcoursupNational.slice(0, 10);
      return `MODE NATIONAL ACTIVÉ — question générale détectée, voici un aperçu de la base.\n${header}\n\nÉchantillon (${sample.length} formations sur ${parcoursupNational.length}) :\n${formatNationalRows(sample)}\nINSTRUCTION : signale que la base contient ${parcoursupNational.length} formations et propose à l'utilisateur de préciser une filière ou une formation pour une analyse ciblée.`;
    }
    // Formation non trouvée
    return `MODE NATIONAL ACTIVÉ — aucune formation correspondant à cette question n'a été trouvée dans la base nationale ${NATIONAL_SESSION}.\n${header}\n\nINSTRUCTION : explique à l'utilisateur qu'aucune formation ne correspond à sa recherche dans la base nationale ${NATIONAL_SESSION} (${parcoursupNational.length} formations académie Bordeaux disponibles) et propose-lui de reformuler avec un autre nom de filière ou de formation.`;
  }

  if (!hits.length) return '';
  const modeNote = nationalModeActive ? 'MODE NATIONAL ACTIVÉ — réponds en te basant principalement sur ces données.\n' : '';
  return `${modeNote}${header}\n\n${formatNationalRows(hits)}`;
}

loadParcoursupNational();
