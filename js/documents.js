/* documents.js — Requêtes locales Grist, extraction de données, export
   Dépend de : config.js, knowledge.js */


/* ═══════════════════════ CROISEMENTS AUTOMATIQUES ═══════════════════════
   Les statistiques univariées ci-dessus ne répondent pas aux questions du
   type "parmi les candidats X, quelle est la répartition de Y" — pour ça il
   faut une ventilation croisée. On ne peut pas croiser TOUTES les paires de
   colonnes (combinatoire explosive sur ~80 colonnes), donc on applique une
   heuristique : on détecte les colonnes "filtre" plausibles (peu de valeurs
   distinctes, souvent binaires/catégorielles courtes type Oui/Non, zone,
   académie, série...) et on les croise uniquement avec les colonnes
   "résultat" les plus susceptibles d'être demandées (formation, académie
   d'accueil, spécialité — repérées par mot-clé), avec des garde-fous de
   volume pour ne pas saturer le contexte envoyé à Albert. */

const CROSSTAB_FILTER_HINTS = /zone|secteur|boursier|d[ée]roga|hors d[ée]lai|s[ée]rie|type de (classe|bac)|sexe|n[ée]o|apprenti|phase|sant[ée]|handicap/i;
const CROSSTAB_RESULT_HINTS = /formation|sp[ée]cialit[ée]|mention|domaine|acad[ée]mie|fili[èe]re|[ée]tablissement|grands? groupes?|r[ée]gion/i;
const MAX_FILTER_COLS = 4;      // nb max de colonnes-filtres traitées
const MAX_RESULT_COLS_PER_FILTER = 3; // nb max de colonnes-résultat croisées par filtre
const MAX_VALUES_PER_FILTER = 6;      // nb max de valeurs distinctes d'un filtre à traiter (ex: Oui/Non = 2, pas un problème)
const MAX_BREAKDOWN_ITEMS = 8;        // nb max de lignes affichées dans une répartition croisée

function buildCrossTabs(headers, dataRows, totalRows) {
  const idPattern = /num[ée]ro|identifiant|\bid\b|code|uai/i;

  // 1. Identifier les colonnes "filtre" plausibles : peu de valeurs distinctes,
  //    pas des identifiants, et soit matchent le lexique métier, soit ont une
  //    cardinalité très faible (≤ MAX_VALUES_PER_FILTER), typique d'un Oui/Non ou
  //    d'une catégorie à choix limité.
  const candidateFilters = [];
  headers.forEach((header, j) => {
    if (!header || idPattern.test(header)) return;
    const values = dataRows.map(r => r[j]).filter(v => v !== undefined && v !== null && String(v).trim() !== '');
    if (!values.length) return;
    const uniqueVals = new Set(values.map(v => String(v).trim()));
    const looksLikeFilter = CROSSTAB_FILTER_HINTS.test(header) || uniqueVals.size <= MAX_VALUES_PER_FILTER;
    if (looksLikeFilter && uniqueVals.size >= 2 && uniqueVals.size <= MAX_VALUES_PER_FILTER) {
      candidateFilters.push({ header, colIndex: j, uniqueVals: [...uniqueVals] });
    }
  });
  if (!candidateFilters.length) return '';

  // 2. Identifier les colonnes "résultat" plausibles (formation, académie, etc.).
  //    On priorise les colonnes "accueil/accepté(e)" — c'est l'orientation FINALE
  //    du candidat, l'information la plus demandée — devant les colonnes décrivant
  //    sa scolarité d'ORIGINE (établissement, académie, commune de scolarité), qui
  //    matchent le même regex générique mais répondent à une question différente.
  const ACCUEIL_HINTS = /accueil|accept[ée]e?/i;
  const resultCols = [];
  headers.forEach((header, j) => {
    if (!header || idPattern.test(header)) return;
    if (CROSSTAB_RESULT_HINTS.test(header)) {
      resultCols.push({ header, colIndex: j, isAccueil: ACCUEIL_HINTS.test(header) });
    }
  });
  if (!resultCols.length) return '';
  resultCols.sort((a, b) => (b.isAccueil ? 1 : 0) - (a.isAccueil ? 1 : 0));

  // 3. Limiter le volume : on garde les filtres les plus "métier" (priorité au
  //    lexique connu) puis on coupe au maximum autorisé.
  const prioritizedFilters = candidateFilters
    .sort((a, b) => (CROSSTAB_FILTER_HINTS.test(b.header) ? 1 : 0) - (CROSSTAB_FILTER_HINTS.test(a.header) ? 1 : 0))
    .slice(0, MAX_FILTER_COLS);
  const limitedResultCols = resultCols.slice(0, MAX_RESULT_COLS_PER_FILTER);

  let out = `\n### Tableaux croisés (répartitions conditionnées par sous-groupe, calculées sur L'INTÉGRALITÉ des ${totalRows} lignes)\n`;
  out += `Ces croisements répondent aux questions du type "parmi les candidats [filtre], quelle est la répartition de [résultat]" — utilisez-les en priorité pour ce type de question plutôt que les statistiques globales ci-dessus, qui elles ne sont PAS filtrées.\n\n`;

  prioritizedFilters.forEach(filterCol => {
    filterCol.uniqueVals.forEach(filterVal => {
      const matchingRows = dataRows.filter(r => String(r[filterCol.colIndex] ?? '').trim() === filterVal);
      const n = matchingRows.length;
      if (!n) return;
      out += `**${filterCol.header} = "${filterVal}"** (${n} lignes, ${(n/totalRows*100).toFixed(1)}% du total) :\n`;

      limitedResultCols.forEach(resCol => {
        if (resCol.colIndex === filterCol.colIndex) return;
        const vals = matchingRows.map(r => r[resCol.colIndex]).filter(v => v !== undefined && v !== null && String(v).trim() !== '');
        if (!vals.length) return;
        const renseigne = vals.length;
        const counts = new Map();
        vals.forEach(v => { const k = String(v).trim(); counts.set(k, (counts.get(k)||0)+1); });
        const sorted = [...counts.entries()].sort((a,b) => b[1]-a[1]).slice(0, MAX_BREAKDOWN_ITEMS);
        // % calculé sur les valeurs renseignées pour cette colonne (≠ n total du
        // filtre, car certaines lignes peuvent avoir cette colonne vide — ex: pas
        // encore de proposition acceptée). On l'indique explicitement pour éviter
        // toute ambiguïté côté modèle.
        const breakdown = sorted.map(([val,c]) => `${val}: ${c} (${(c/renseigne*100).toFixed(1)}%)`).join(', ');
        out += `  - ${resCol.header} (${renseigne}/${n} lignes renseignées) → ${breakdown}\n`;
      });
      out += '\n';
    });
  });

  return out;
}


/* ═══════════════════════ MOTEUR DE REQUÊTES EXCEL LOCAL ═══════════════════════
   Objectif : faire les comptages/filtrages en JavaScript sur les lignes Excel
   brutes, puis envoyer à Albert un résultat déjà calculé. Le LLM rédige ; il ne
   compte pas. */
function normalizeText(v) {
  return String(v ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokensOf(v) {
  return normalizeText(v).split(' ').filter(t => t.length >= 2);
}

function valueLooksMentioned(value, questionNorm) {
  const valNorm = normalizeText(value);
  if (!valNorm || valNorm.length < 2) return false;
  if (questionNorm.includes(valNorm)) return true;
  const toks = tokensOf(value).filter(t => !['oui','non','avec','sans','pour','dans','des','les','une','du'].includes(t));
  if (toks.length >= 2 && toks.every(t => questionNorm.includes(t))) return true;
  return false;
}

function findBestColumn(headers, regexes, avoidRegexes = []) {
  const candidates = headers
    .filter(Boolean)
    .map(h => ({ h, n: normalizeText(h) }))
    .filter(x => regexes.some(r => r.test(x.n)))
    .filter(x => !avoidRegexes.some(r => r.test(x.n)));
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const score = x =>
      (/(accueil|acceptee|accept e|etablissement)/.test(x.n) ? 4 : 0) +
      (/(formation|academie|departement|region|specialite|mention|groupe)/.test(x.n) ? 2 : 0) -
      (/(scolarite|origine|lycee)/.test(x.n) ? 3 : 0);
    return score(b) - score(a);
  });
  return candidates[0].h;
}

function detectTargetColumn(headers, questionNorm) {
  if (/\bacademie\b/.test(questionNorm)) {
    return findBestColumn(headers, [/academie/], [/scolarite|origine|lycee/]);
  }
  if (/\bdepartement\b/.test(questionNorm)) {
    return findBestColumn(headers, [/departement/], [/scolarite|origine|lycee/]);
  }
  if (/\bregion\b/.test(questionNorm)) {
    return findBestColumn(headers, [/region/], [/scolarite|origine|lycee/]);
  }
  if (/formation|filiere|specialite|mention|orientation|groupe/.test(questionNorm)) {
    return findBestColumn(headers, [/grands? groupes?.*formation|formation.*accueil|specialite|mention|filiere/], []);
  }
  return null;
}


function isGenericGristField(name) {
  return /^(id|manualSort|A|B|C|D|E|F|G|H|I|J|K|L|M|N|O|P|Q|R|S|T|U|V|W|X|Y|Z|AA|AB|AC|AD|AE|AF|AG|AH|AI|AJ|AK|AL|AM|AN|AO|AP|AQ|AR|AS|AT|AU|AV|AW|AX|AY|AZ)$/.test(String(name));
}

function buildGristQueryTable() {
  if (!gristRecords || !gristRecords.length) return null;
  const allFields = Object.keys(gristRecords[0]).filter(f => f !== 'id' && f !== 'manualSort');
  if (!allFields.length) return null;

  // Cas fréquent après import Excel dans Grist : colonnes nommées A, B, C...
  // et vrais intitulés présents dans la première ligne. On les reconstruit ici.
  const genericColumns = allFields.every(isGenericGristField);
  if (genericColumns && gristRecords.length > 1) {
    const first = gristRecords[0];
    const headers = allFields.map(f => {
      const v = first[f];
      return (v === undefined || v === null || String(v).trim() === '') ? f : String(v).trim();
    });
    const usable = headers.filter(Boolean);
    const objects = gristRecords.slice(1).map(rec => {
      const obj = {};
      allFields.forEach((f, i) => {
        const h = headers[i];
        if (h) obj[h] = rec[f];
      });
      return obj;
    });
    return { source: 'Grist', name: 'Table Grist connectée', headers: usable, objects };
  }

  // Cas où la table Grist a déjà de vrais noms de colonnes.
  return { source: 'Grist', name: 'Table Grist connectée', headers: allFields, objects: gristRecords };
}

function getActiveQueryTables() {
  // Priorité absolue à Grist : si une table est connectée, on analyse ses lignes,
  // pas le résumé Excel éventuellement déposé dans le widget.
  const gristTable = buildGristQueryTable();
  if (gristTable && gristTable.objects && gristTable.objects.length) return [gristTable];

  const selected = documents.filter(d => selectedDocIds.has(d.id) && d.status === 'ok' && d.tables && d.tables.length);
  const docsToUse = selected.length ? selected : documents.filter(d => d.status === 'ok' && d.tables && d.tables.length);
  const tables = [];
  docsToUse.forEach(doc => {
    doc.tables.forEach(table => {
      tables.push({ ...table, source: 'Excel', docName: doc.name });
    });
  });
  return tables;
}


/* ═══════════════════════ ONTOLOGIE PARCOURSUP + PROFILAGE GRIST ═══════════════════════
   Objectif : rester spécialisé Parcoursup, mais adaptatif selon le public demandé
   (zone, boursiers, apprentis, académie, département, mobilité, formations, etc.).
   Le widget classe les colonnes détectées dans des familles métier avant d'envoyer
   le contexte à Albert. Albert raconte l'analyse ; le widget fournit la carte des
   variables et les indicateurs pertinents. */

const PARCOURSUP_ONTOLOGY_RULES = [
  { family:'identifiants', role:'identifiant technique', priority:1, re:/\b(id|identifiant|numero|num[eé]ro|code uai|uai|manualsort)\b/i, avoid:true },
  { family:'territoire', role:'filtre territorial', priority:95, re:/zone.*pays.*basque|pays.*basque|\bzone\b/i },
  { family:'territoire', role:'département du candidat', priority:82, re:/d[eé]partement(?!.*accueil)|dept/i },
  { family:'territoire', role:'académie d’origine/scolarité', priority:58, re:/acad[eé]mie.*(scolar|origine|candidat|lyc[eé]e)/i },
  { family:'territoire', role:'commune d’origine/scolarité', priority:50, re:/commune.*(scolar|origine|candidat|lyc[eé]e)/i },

  { family:'admission', role:'a reçu une proposition', priority:90, re:/proposition.*(oui|non|re[cç]ue|eu)|a.*proposition/i },
  { family:'admission', role:'a accepté / répondu favorablement', priority:92, re:/r[eé]pondu favorablement|proposition.*accept[eé]e|acceptation/i },
  { family:'admission', role:'phase Parcoursup', priority:70, re:/phase principale|phase compl[eé]mentaire|\bpp\b|\bpc\b/i },
  { family:'admission', role:'vœux et candidatures', priority:72, re:/voe?ux?|vœux|confirm[eé]s?|class[eé]s?/i },

  { family:'formation', role:'grand groupe de formation acceptée', priority:98, re:/grands? groupes?.*formation.*accueil.*accept[eé]e|groupe.*formation.*accept/i },
  { family:'formation', role:'formation/spécialité acceptée', priority:96, re:/sp[eé]cialit[eé].*mention.*formation.*accueil.*accept[eé]e|mention.*formation.*accept|formation.*accueil.*accept[eé]e/i },
  { family:'formation', role:'filière/domaine', priority:74, re:/fili[eè]re|domaine|discipline/i },

  { family:'mobilité', role:'académie d’accueil acceptée', priority:100, re:/acad[eé]mie.*(accueil|[eé]tablissement).*accept[eé]e|acad[eé]mie.*accueil/i },
  { family:'mobilité', role:'département d’accueil', priority:86, re:/d[eé]partement.*(accueil|[eé]tablissement).*accept[eé]e/i },
  { family:'mobilité', role:'région d’accueil', priority:75, re:/r[eé]gion.*(accueil|[eé]tablissement).*accept[eé]e/i },
  { family:'mobilité', role:'commune d’accueil', priority:70, re:/commune.*(accueil|[eé]tablissement).*accept[eé]e/i },

  { family:'établissement', role:'établissement d’accueil', priority:76, re:/[eé]tablissement.*accueil.*accept[eé]e|nom.*[eé]tablissement.*accueil/i },
  { family:'établissement', role:'établissement de scolarité', priority:52, re:/[eé]tablissement.*scolarit[eé]|lyc[eé]e/i },
  { family:'établissement', role:'secteur établissement', priority:68, re:/secteur.*[eé]tablissement|public|priv[eé]/i },

  { family:'profil social', role:'boursier', priority:85, re:/\bboursier\b|bourse/i },
  { family:'profil social', role:'sexe / genre', priority:64, re:/\bsexe\b|genre/i },
  { family:'profil social', role:'PCS / catégorie sociale', priority:78, re:/pcs|profession.*parents?|cat[eé]gorie.*sociale/i },
  { family:'profil social', role:'ASE / accompagnement', priority:60, re:/\base\b|aide sociale/i },

  { family:'scolarité', role:'série du bac', priority:84, re:/\bs[eé]rie\b|s[eé]rie.*classe|bac/i },
  { family:'scolarité', role:'type de classe', priority:82, re:/type de classe|classe/i },
  { family:'scolarité', role:'néo-bachelier', priority:70, re:/n[eé]o.?bachelier/i },
  { family:'scolarité', role:'spécialités suivies', priority:68, re:/enseignement.*sp[eé]cialit[eé]|sp[eé]cialit[eé].*suiv/i },
  { family:'scolarité', role:'apprentissage', priority:68, re:/apprenti|apprentissage/i },

  { family:'situations particulières', role:'dérogatoire / hors délai / CAES', priority:50, re:/d[eé]roga|hors d[eé]lai|\bcaes\b|handicap|sant[eé]/i }
];

function classifyParcoursupColumn(col) {
  const name = String(col || '').trim();
  const n = normalizeText(name);
  let best = null;
  PARCOURSUP_ONTOLOGY_RULES.forEach(rule => {
    if (rule.re.test(name) || rule.re.test(n)) {
      if (!best || rule.priority > best.priority) best = { ...rule, column: name };
    }
  });
  if (best) return best;
  return { column: name, family:'autres variables', role:'variable disponible', priority:10 };
}

function getActiveDataSource() {
  const tables = getActiveQueryTables();
  if (!tables || !tables.length) return null;
  const t = tables[0];
  return {
    source: t.source || 'Données',
    name: t.name || t.docName || 'Table active',
    headers: t.headers || [],
    rows: t.objects || []
  };
}

function summarizeColumnForOntology(rows, col) {
  const top = topCountsForRows(rows, col, 6);
  const num = numericStatsForRows(rows, col);
  const numericRatio = num && top.filled ? num.count / top.filled : 0;
  if (num && numericRatio > 0.9 && top.distinct > 10) {
    return `numérique, ${top.filled} valeurs renseignées, moyenne ${num.avg.toFixed(2).replace('.', ',')}, médiane ${String(num.median).replace('.', ',')}`;
  }
  const vals = top.top.map(x => `${x.value} (${x.count}, ${x.pct.toFixed(1).replace('.', ',')} %)`).join('; ');
  return `${top.filled} valeurs renseignées, ${top.distinct} modalités${vals ? ` — principales : ${vals}` : ''}`;
}

function detectParcoursupAnalysisIntent(question, ontology) {
  const q = normalizeText(question || '');
  const intents = [];
  if (/compare|comparaison|versus| vs |reste|autres|difference|diff[eé]rence/.test(q)) intents.push('comparaison de publics');
  if (/basque|zone|departement|d[eé]partement|academie|acad[eé]mie|territoire|secteur/.test(q)) intents.push('analyse territoriale');
  if (/mobilite|mobilit[eé]|hors|autre academie|quitt|partent|destination|accueil/.test(q)) intents.push('mobilité / destination');
  if (/formation|filiere|fili[eè]re|specialite|sp[eé]cialit[eé]|l1|bts|but|dut|cpge|sciences po|ingenieur/.test(q)) intents.push('formations et orientations');
  if (/boursier|social|pcs|ase|priv[eé]|public/.test(q)) intents.push('profil social');
  if (/serie|s[eé]rie|bac|classe|neo|n[eé]o|apprenti/.test(q)) intents.push('profil scolaire');
  if (/proposition|admission|accept|favorable|r[eé]ussite|voeu|vœu/.test(q)) intents.push('résultats Parcoursup');
  if (/infographie|synthese|synth[eè]se|rapport|resume|r[eé]sume/.test(q)) intents.push('rapport de synthèse');
  if (!intents.length) intents.push('analyse Parcoursup générale');
  return [...new Set(intents)];
}


/* ═══════════════════════ SYNTHÈSE DE TABLE COMPLÈTE ═══════════════════════
   Pour les questions générales du type "résume ce document", on ne doit pas
   envoyer seulement les 50 premières lignes Grist. On calcule ici un profil
   statistique sur TOUTES les lignes disponibles, à la manière d'une synthèse
   automatique de fichier tabulaire. */
function isEmptyCell(v) {
  return v === undefined || v === null || String(v).trim() === '';
}

function pctFr(n, d, digits = 1) {
  if (!d) return '0,0 %';
  return (n / d * 100).toFixed(digits).replace('.', ',') + ' %';
}

function topCountsForRows(rows, col, max = 12) {
  const counts = new Map();
  let filled = 0;
  rows.forEach(row => {
    const v = row[col];
    if (isEmptyCell(v)) return;
    filled++;
    const key = String(v).trim();
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'))
    .slice(0, max)
    .map(([value, count]) => ({ value, count, pct: filled ? count / filled * 100 : 0 }));
  return { filled, distinct: counts.size, top };
}

function numericStatsForRows(rows, col) {
  const vals = [];
  rows.forEach(row => {
    if (isEmptyCell(row[col])) return;
    const n = toStrictNumber(row[col]);
    if (!isNaN(n)) vals.push(n);
  });
  if (!vals.length) return null;
  vals.sort((a,b) => a-b);
  const sum = vals.reduce((a,b) => a+b, 0);
  const mid = Math.floor(vals.length/2);
  const median = vals.length % 2 ? vals[mid] : (vals[mid-1] + vals[mid]) / 2;
  return { count: vals.length, min: vals[0], max: vals[vals.length-1], avg: sum / vals.length, median, sum };
}

function scoreColumnForSummary(col) {
  const n = normalizeText(col);
  return (
    (/zone.*pays.*basque|pays basque/.test(n) ? 20 : 0) +
    (/grands? groupes?.*formation.*accueil.*acceptee|formation.*accueil.*acceptee/.test(n) ? 18 : 0) +
    (/academie.*accueil|etablissement.*accueil/.test(n) ? 16 : 0) +
    (/specialite|mention/.test(n) ? 14 : 0) +
    (/departement|region/.test(n) ? 10 : 0) +
    (/boursier|serie|type de classe|sexe|neo|apprenti|phase/.test(n) ? 8 : 0) -
    (/code|uai|numero|identifiant|id|manualsort/.test(n) ? 20 : 0)
  );
}

function buildFullTableSynthesis(table, question = '') {
  if (!table || !table.objects || !table.objects.length) return '';
  const rows = table.objects;
  const headers = table.headers.filter(h => h && !/^(id|manualSort)$/i.test(String(h)));
  const total = rows.length;
  const q = normalizeText(question);

  let out = `=== SYNTHÈSE AUTOMATIQUE SUR TABLE COMPLÈTE (${table.source || 'Données'}) ===\n`;
  out += `Table analysée : ${table.name || 'table'}\n`;
  out += `Nombre total de lignes analysées : ${total}\n`;
  out += `Nombre de colonnes : ${headers.length}\n`;
  out += `Important : cette synthèse est calculée sur toutes les lignes, pas seulement sur un aperçu.\n\n`;

  // Colonnes principales : colonnes métier + colonnes dont le nom est cité dans la question.
  const selectedCols = headers
    .map(col => ({ col, score: scoreColumnForSummary(col) + (q && q.includes(normalizeText(col)) ? 12 : 0) }))
    .filter(x => x.score > -10)
    .sort((a,b) => b.score - a.score)
    .slice(0, 14)
    .map(x => x.col);

  out += `Colonnes principales repérées : ${selectedCols.join(' | ')}\n\n`;
  out += `### Profils des colonnes utiles\n`;
  selectedCols.forEach(col => {
    const cat = topCountsForRows(rows, col, 10);
    const num = numericStatsForRows(rows, col);
    const filledPct = pctFr(cat.filled, total);
    if (cat.filled === 0) {
      out += `- ${col} : aucune valeur renseignée.\n`;
      return;
    }
    const numericRatio = num ? num.count / cat.filled : 0;
    if (num && numericRatio > 0.9 && cat.distinct > 20) {
      out += `- ${col} : ${cat.filled}/${total} valeurs renseignées (${filledPct}). Numérique : moyenne ${num.avg.toFixed(2).replace('.', ',')}, médiane ${num.median}, min ${num.min}, max ${num.max}.\n`;
    } else {
      const topTxt = cat.top.map(x => `${x.value}: ${x.count} (${x.pct.toFixed(1).replace('.', ',')} %)`).join(', ');
      out += `- ${col} : ${cat.filled}/${total} valeurs renseignées (${filledPct}), ${cat.distinct} valeurs distinctes. Principales valeurs : ${topTxt}.\n`;
    }
  });

  // Croisements Parcoursup très utiles pour les synthèses générales.
  const zoneCol = findBestColumn(headers, [/zone.*pays.*basque|pays.*basque|zone/], []);
  const groupCol = findBestColumn(headers, [/grands? groupes?.*formation.*accueil.*acceptee|grands? groupes?.*formation|formation.*accueil.*acceptee/], []);
  const acadCol = findBestColumn(headers, [/academie/], [/scolarite|origine|lycee/]);

  if (zoneCol) {
    const z = topCountsForRows(rows, zoneCol, 8);
    const yesVal = z.top.find(x => /^(oui|yes|1|vrai|true)$/i.test(String(x.value).trim()))?.value;
    if (yesVal) {
      const zoneRows = rows.filter(r => normalizeText(r[zoneCol]) === normalizeText(yesVal));
      out += `\n### Focus automatique : ${zoneCol} = "${yesVal}"\n`;
      out += `Lignes concernées : ${zoneRows.length}/${total} (${pctFr(zoneRows.length, total)}).\n`;
      if (groupCol) {
        const c = topCountsForRows(zoneRows, groupCol, 12);
        out += `Répartition par ${groupCol} (${c.filled} valeurs renseignées) : ${c.top.map(x => `${x.value}: ${x.count} (${x.pct.toFixed(1).replace('.', ',')} %)`).join(', ')}.\n`;
      }
      if (acadCol) {
        const c = topCountsForRows(zoneRows, acadCol, 12);
        out += `Répartition par ${acadCol} (${c.filled} valeurs renseignées) : ${c.top.map(x => `${x.value}: ${x.count} (${x.pct.toFixed(1).replace('.', ',')} %)`).join(', ')}.\n`;
      }
    }
  }

  out += `\nConsigne : pour une question de synthèse générale, résume les structures, volumes, colonnes clés et répartitions ci-dessus. Pour une question chiffrée précise, privilégie le résultat calculé localement s'il existe.\n`;
  return out;
}

function getColumnValues(table, col) {
  return table.objects
    .map(r => r[col])
    .filter(v => v !== undefined && v !== null && String(v).trim() !== '');
}

function uniqueValues(table, col, max = 300) {
  const m = new Map();
  getColumnValues(table, col).forEach(v => {
    const k = String(v).trim();
    m.set(k, (m.get(k) || 0) + 1);
  });
  return [...m.entries()].sort((a,b) => b[1] - a[1]).slice(0, max).map(([value, count]) => ({ value, count }));
}

function addFilter(filters, col, value, reason, op = 'eq') {
  if (!col || value === undefined || value === null || String(value).trim() === '') return;
  if (filters.some(f => f.col === col && f.op === op)) return;
  filters.push({ col, value: String(value).trim(), reason, op });
}

function rowMatchesFilter(row, filter) {
  const rowValue = normalizeText(row[filter.col]);
  const filterValue = normalizeText(filter.value);
  if (filter.op === 'neq') return rowValue !== '' && rowValue !== filterValue;
  return rowValue === filterValue;
}

function detectFilters(table, questionNorm, targetCol) {
  const filters = [];
  const headers = table.headers.filter(Boolean);

  // Cas métier Parcoursup : "basque" signifie Zone du Pays Basque = oui.
  if (/basque|pays basque/.test(questionNorm)) {
    const zoneCol = findBestColumn(headers, [/zone.*pays.*basque|pays.*basque|zone/], []);
    if (zoneCol) {
      const yes = uniqueValues(table, zoneCol).find(x => /^(oui|yes|1|vrai|true)$/.test(normalizeText(x.value))) || uniqueValues(table, zoneCol)[0];
      if (yes) addFilter(filters, zoneCol, yes.value, 'déduit de "basque"');
    }
  }

  // Cas métier : groupe L1 - CUPGE - DEUST - DU.
  if (/\bl1\b/.test(questionNorm) && /cupge/.test(questionNorm) && /deust/.test(questionNorm)) {
    const groupCol = findBestColumn(headers, [/grands? groupes?.*formation.*accueil.*acceptee|groupes?.*formation|formation.*accueil.*acceptee/], []);
    if (groupCol) {
      const match = uniqueValues(table, groupCol).find(x => {
        const n = normalizeText(x.value);
        return /\bl1\b/.test(n) && /cupge/.test(n) && /deust/.test(n) && /\bdu\b/.test(n);
      });
      if (match) addFilter(filters, groupCol, match.value, 'déduit de "L1 - CUPGE - DEUST - DU"');
    }
  }

  // Cas générique utile : "autre académie que Bordeaux", "hors Bordeaux",
  // "académie différente de Bordeaux" => Académie d'accueil != Bordeaux.
  if (/(autre|hors|sauf|different|differente|≠|!=|pas).*bordeaux|bordeaux.*(exclu|exclue|sauf)/.test(questionNorm)) {
    const acadCol = findBestColumn(headers, [/academie/], [/scolarite|origine|lycee/]);
    if (acadCol && acadCol !== targetCol) {
      const bordeaux = uniqueValues(table, acadCol).find(x => normalizeText(x.value) === 'bordeaux');
      if (bordeaux) addFilter(filters, acadCol, bordeaux.value, 'déduit de "autre/hors Bordeaux"', 'neq');
    }
  }

  // Détection générique : si une valeur catégorielle apparaît dans la question,
  // elle devient un filtre, sauf pour la colonne cible du GROUP BY.
  headers.forEach(col => {
    if (col === targetCol || filters.some(f => f.col === col)) return;
    const values = uniqueValues(table, col, 150);
    if (values.length > 150) return;
    for (const item of values) {
      const valNorm = normalizeText(item.value);
      if (['', 'oui', 'non', 'true', 'false'].includes(valNorm)) continue;
      if (valueLooksMentioned(item.value, questionNorm)) {
        addFilter(filters, col, item.value, 'valeur mentionnée dans la question');
        break;
      }
    }
  });

  return filters;
}

function executeLocalDataQuery(question, filterContextText = question) {
  const questionNorm = normalizeText(question);
  const filterContextNorm = normalizeText(filterContextText);
  const asksDistribution = /repartition|ventilation|par |group(e|er)|academie|departement|region|top|classement|combien|nombre|effectif|pourcentage|proportion/.test(questionNorm);
  if (!asksDistribution) return null;

  const tablesToUse = getActiveQueryTables();
  if (!tablesToUse.length) return null;

  let best = null;
  tablesToUse.forEach(table => {
    if (!table.objects || !table.objects.length) return;
    const targetCol = detectTargetColumn(table.headers, questionNorm);
    if (!targetCol) return;
    const filters = detectFilters(table, filterContextNorm, targetCol);
    const sourceBoost = table.source === 'Grist' ? 1000 : 0;
    const score = sourceBoost + filters.length * 10 + (normalizeText(targetCol).includes('accueil') ? 4 : 0) + table.objects.length / 100000;
    if (!best || score > best.score) best = { table, targetCol, filters, score };
  });
  if (!best) return null;

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


/* ═══════════════════════ ACTIONS LOCALES GÉNÉRIQUES ═══════════════════════
   Albert comprend et rédige ; le widget exécute les opérations mécaniques.
   Cette couche reste volontairement générique : elle ne connaît pas Parcoursup,
   sauf via les détecteurs de filtres déjà existants quand ils sont disponibles. */
const LOCAL_TOOLS = [
  { name: 'export_excel', description: 'Exporter des lignes filtrées dans un fichier .xlsx' },
  { name: 'export_csv', description: 'Exporter des lignes filtrées dans un fichier .csv' }
];

function isLocalExportRequest(question) {
  const q = normalizeText(question || '');
  const wantsFile = /excel|xlsx|xls|csv|fichier|telecharg|t[eé]l[eé]charg|export|extraire|extrait|sors moi|sort moi|sortir|liste/.test(q);
  const wantsData = /candidat|ligne|donnee|donn[eé]e|table|resultat|enregistrement|colonnes?|tout|tous|toutes/.test(q);
  return wantsFile && (wantsData || /excel|xlsx|xls|csv|export/.test(q));
}

function sanitizeFilenamePart(s) {
  return normalizeText(s || '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_\-]+/g, '')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'export';
}

function guessExportFilename(question, ext) {
  const q = normalizeText(question || '');
  let name = 'export_donnees';
  if (/pays basque|basque/.test(q)) name = 'candidats_zone_pays_basque';
  else if (/boursier/.test(q)) name = 'candidats_boursiers';
  else if (/admis|accept|favorable/.test(q)) name = 'candidats_admis';
  else if (/apprenti|apprentissage/.test(q)) name = 'candidats_apprentis';
  return `${sanitizeFilenamePart(name)}.${ext}`;
}


function applyLocalActionFilters(rows, filters) {
  if (!filters || !filters.length) return rows.slice();
  return rows.filter(row => filters.every(f => rowMatchesFilter(row, f)));
}

function cleanRowsForExport(rows, headers) {
  return rows.map(row => {
    const out = {};
    headers.forEach(h => {
      if (/^(id|manualSort)$/i.test(String(h))) return;
      out[h] = row[h] ?? '';
    });
    return out;
  });
}

function executeLocalAction(action) {
  if (!action || !action.table) return null;
  const table = action.table;
  const headers = (table.headers || Object.keys(table.objects?.[0] || {})).filter(h => !/^(id|manualSort)$/i.test(String(h)));
  const filteredRows = applyLocalActionFilters(table.objects || [], action.filters || []);
  const exportRows = cleanRowsForExport(filteredRows, headers);

  if (!exportRows.length) {
    return {
      ok: false,
      html: `<h4>Export impossible</h4><p>Aucune ligne ne correspond aux filtres détectés.</p><p style="font-size:11px;color:var(--gris3)">${escapeHtml(formatActionFilters(action.filters))}</p>`
    };
  }

  if (action.tool === 'export_csv') {
    const ws = XLSX.utils.json_to_sheet(exportRows, { header: headers });
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    triggerBlobDownload(blob, action.filename);
  } else {
    const ws = XLSX.utils.json_to_sheet(exportRows, { header: headers });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Export');
    XLSX.writeFile(wb, action.filename);
  }

  return {
    ok: true,
    rows: exportRows.length,
    html: `<h4>Export généré</h4><p>J'ai créé <strong>${escapeHtml(action.filename)}</strong> avec <strong>${exportRows.length.toLocaleString('fr-FR')}</strong> ligne${exportRows.length>1?'s':''}.</p><p style="font-size:11px;color:var(--gris3)">${escapeHtml(formatActionFilters(action.filters))}</p>`
  };
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatActionFilters(filters) {
  if (!filters || !filters.length) return 'Filtres appliqués : aucun — export de toute la table active.';
  return 'Filtres appliqués : ' + filters.map(f => `${f.col} ${f.op === 'neq' ? '≠' : '='} "${f.value}"`).join(' ; ');
}


