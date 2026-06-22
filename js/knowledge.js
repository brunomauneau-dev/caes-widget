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
- Quand une question évoque un pourcentage ou une proportion ("quelle part de...", "combien de %..."), vérifie toujours sur quelle population de référence (tous les candidats ? seulement ceux ayant une proposition ? seulement les boursiers ?) le calcul doit porter — ne jamais supposer la population totale par défaut sans le vérifier dans le contexte fourni.`;

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
  { match: /\bcaes\b/i, alias: 'dispositif d\'accompagnement (statut ≠ garantie d\'obtenir une proposition)' },
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

function normalizeForSearch(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
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
    console.log(`[Parcoursup KB] ${parcoursupKB.entries.length} fiches chargées`);
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
    console.log(`[Parcoursup KB] index hybride chargé : ${parcoursupKBIndex.meta?.term_count || '?'} termes`);
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
  sub.textContent = base + kb + od;
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
  console.table(lastKnowledgeTrace);
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
  if (!hits.length) return '';
  return `RÉFÉRENCES MÉTIER PARCOURSUP SÉLECTIONNÉES AUTOMATIQUEMENT\n` +
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
    console.log(`[Parcoursup OpenData] référentiel chargé : ${parcoursupOD.meta?.rows || '?'} lignes source`);
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
    const admis = r['Effectif total des candidats ayant accepté la proposition de l’établissement (admis)'];
    const prop = r['Effectif total des candidats ayant reçu une proposition d’admission de la part de l’établissement'];
    const cap = r['Capacité de l’établissement par formation'];
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
  return parts.join('\n');
}

loadParcoursupOpenDataReference();


