/* documents.js — Requêtes locales Grist, extraction de données, export
   Dépend de : config.js, knowledge.js */


/* ═══════════════════════ MOTEUR DE REQUÊTES EXCEL LOCAL ═══════════════════════
   Objectif : faire les comptages/filtrages en JavaScript sur les lignes Excel
   brutes, puis envoyer à Albert un résultat déjà calculé. Le LLM rédige ; il ne
   compte pas. */
function normalizeText(v) {
  return String(v ?? '')
    // Ligatures avant NFD : sinon « vœux » devient « v ux » et n'est plus reconnu
    .replace(/œ/g, 'oe').replace(/Œ/g, 'OE').replace(/æ/g, 'ae').replace(/Æ/g, 'AE')
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

/* ═══════════════════════ SOURCE ACTIVE ═══════════════════════
   Une seule source à la fois, choisie dans le sélecteur au-dessus de la
   zone de question :
   - 'opendata' (par défaut au lancement) : open data Parcoursup n-1
   - 'grist'    : la table Grist liée au widget (sur choix explicite)
   - 'file'     : un fichier Excel / CSV importé (reste dans le navigateur)
   Si la source choisie n'est pas disponible, on se replie sur l'open data. */
let activeSourceKind = 'opendata';
let importedFile = null; // { name, sheets: [noms], sheet, workbook, table }

function getActiveSourceKind() {
  if (activeSourceKind === 'grist' && (typeof gristRecords === 'undefined' || !gristRecords || !gristRecords.length)) return 'opendata';
  if (activeSourceKind === 'file' && !(importedFile && importedFile.table)) return 'opendata';
  return activeSourceKind;
}

function isGristSourceActive() {
  return getActiveSourceKind() === 'grist';
}

function refreshSourceUI() {
  ['updateSourceHub', 'renderContextPills', 'updateChatSub', 'renderSuggestions', 'renderMiniSuggestions'].forEach(fn => {
    try { if (typeof window !== 'undefined' && typeof window[fn] === 'function') window[fn](); } catch (e) { /* UI absente */ }
  });
}

// Change de source. Le contexte d'analyse (filtres, historique) est remis à
// zéro : des filtres posés sur une source n'ont pas de sens sur une autre.
function setActiveSource(kind) {
  const next = ['opendata', 'grist', 'file'].includes(kind) ? kind : 'opendata';
  const changed = next !== getActiveSourceKind();
  activeSourceKind = next;
  if (changed && typeof resetContextSilent === 'function') { try { resetContextSilent(); } catch (e) {} }
  refreshSourceUI();
  return getActiveSourceKind();
}

function clearImportedFile() {
  importedFile = null;
  if (activeSourceKind === 'file') setActiveSource('opendata');
  else refreshSourceUI();
}

function getActiveQueryTables() {
  const kind = getActiveSourceKind();
  if (kind === 'grist') {
    const gristTable = buildGristQueryTable();
    if (gristTable && gristTable.objects && gristTable.objects.length) return [gristTable];
  }
  if (kind === 'file' && importedFile && importedFile.table) return [importedFile.table];

  // Open data Parcoursup (source par défaut)
  if (typeof getDefaultOpenDataTable === 'function') {
    const def = getDefaultOpenDataTable();
    if (def && def.objects && def.objects.length) return [def];
  }
  return [];
}

/* ─────────── Import d'un fichier Excel / CSV ───────────
   Le fichier est lu dans le navigateur (rien n'est envoyé ailleurs) et
   transformé en table : en-têtes + lignes. Gère les exports dont la
   ligne d'en-têtes n'est pas la première (titres, lignes vides au-dessus). */
const IMPORT_EXTENSIONS = /\.(xlsx|xlsm|xls|ods|csv|txt)$/i;
const IMPORT_MAX_BYTES = 50 * 1024 * 1024;

function cellToValue(v) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) {
    const p = n => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  if (typeof v === 'string') return v.trim();
  return v === null || v === undefined ? '' : v;
}

// Tableau de lignes (tableaux de cellules) → table { headers, objects }
function rowsToTable(rows) {
  const clean = (rows || []).map(r => (r || []).map(cellToValue));
  const filled = r => r.filter(c => c !== '' && c !== null && c !== undefined).length;
  const nonEmpty = clean.filter(r => filled(r) > 0);
  if (!nonEmpty.length) return null;
  const maxCols = Math.max(...nonEmpty.slice(0, 50).map(filled));
  // Ligne d'en-têtes : la première (parmi les 15 premières) assez remplie,
  // composée surtout de textes
  let h = clean.findIndex((r, i) => i < 15 && filled(r) >= Math.max(2, Math.ceil(maxCols * 0.6))
    && r.filter(c => typeof c === 'string' && c !== '').length >= filled(r) * 0.6);
  if (h < 0) h = clean.findIndex(r => filled(r) > 0);
  const raw = clean[h];
  const width = Math.max(raw.length, ...clean.slice(h + 1, h + 200).map(r => r.length));
  const seen = new Map();
  const headers = [];
  for (let i = 0; i < width; i++) {
    let name = String(raw[i] ?? '').replace(/\s+/g, ' ').trim() || `Colonne ${i + 1}`;
    const n = (seen.get(name) || 0) + 1;
    seen.set(name, n);
    if (n > 1) name = `${name} (${n})`;
    headers.push(name);
  }
  const objects = clean.slice(h + 1).filter(r => filled(r) > 0).map(r => {
    const o = {};
    headers.forEach((hd, i) => { o[hd] = r[i] ?? ''; });
    return o;
  });
  // v27.8 — lignes de total d'un export (« Total », « Sous-total », « Ensemble ») : ce ne sont pas des données
  const estTotal = o => {
    const vals = headers.map(hd => o[hd]).filter(v => v !== '' && v !== null && v !== undefined);
    return vals.length && vals.length <= Math.max(2, Math.ceil(headers.length * 0.3))
      && /^(total|totaux|sous[- ]?total|ensemble|somme)\b/i.test(String(vals[0]).trim());
  };
  for (let i = objects.length - 1; i >= 0; i--) if (estTotal(objects[i])) objects.splice(i, 1);
  // Colonnes entièrement vides et sans en-tête : retirées
  const keep = headers.filter((hd, i) => String(raw[i] ?? '').trim() !== '' || objects.some(o => o[hd] !== ''));
  if (keep.length !== headers.length) objects.forEach(o => headers.forEach(hd => { if (!keep.includes(hd)) delete o[hd]; }));
  return { headers: keep, objects };
}

function decodeText(buffer) {
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  if (!utf8.includes('�')) return utf8.replace(/^﻿/, '');
  try { return new TextDecoder('windows-1252').decode(buffer); } catch (e) { return utf8; }
}

function parseDelimitedText(text) {
  const first = (text.split(/\r?\n/).find(l => l.trim()) || '');
  const count = ch => first.split(ch).length - 1;
  const sep = [';', '\t', ','].sort((a, b) => count(b) - count(a))[0];
  const rows = [];
  let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  // Nombres « à la française » (1 234,5) → nombres
  return rows.map(r => r.map(v => {
    const t = String(v).trim();
    if (/^0\d/.test(t)) return t; // codes (postal, département…) : zéro initial conservé
    if (/^-?\d{1,3}([ \u00a0\u202f]?\d{3})*([.,]\d+)?$|^-?\d+([.,]\d+)?$/.test(t)) {
      const x = Number(t.replace(/[ \u00a0\u202f]/g, '').replace(',', '.'));
      if (isFinite(x)) return x;
    }
    return t;
  }));
}

function buildImportedTable(fileName, sheetName, rows) {
  const t = rowsToTable(rows);
  if (!t || !t.objects.length) return null;
  return {
    source: 'Fichier',
    name: sheetName ? `${fileName} — ${sheetName}` : fileName,
    fileName, sheetName: sheetName || '',
    headers: t.headers, objects: t.objects
  };
}

function sheetRows(workbook, sheetName) {
  const ws = workbook.Sheets[sheetName];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true, blankrows: false });
}

async function importSpreadsheetFile(file) {
  if (!file) throw new Error('Aucun fichier.');
  if (!IMPORT_EXTENSIONS.test(file.name || '')) throw new Error('Format non pris en charge : importez un fichier Excel (.xlsx, .xls) ou CSV.');
  if (file.size > IMPORT_MAX_BYTES) throw new Error('Fichier trop volumineux (plus de 50 Mo) : importez-le plutôt dans Grist (Ajouter → Importer depuis un fichier).');
  const buffer = await file.arrayBuffer();
  let info;
  if (/\.(csv|txt)$/i.test(file.name)) {
    const table = buildImportedTable(file.name, '', parseDelimitedText(decodeText(buffer)));
    info = { name: file.name, sheets: [], sheet: '', workbook: null, table };
  } else {
    if (typeof XLSX === 'undefined') throw new Error('La bibliothèque de lecture Excel n\'est pas chargée. Rechargez le widget.');
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    const sheets = workbook.SheetNames || [];
    // Premier onglet qui contient un vrai tableau (au moins 2 colonnes et 2 lignes) ; un onglet « Notice »
    // fait d'une seule colonne de texte est sauté. À défaut, premier onglet non vide.
    let sheet = sheets[0], table = null, repli = null;
    for (const sh of sheets) {
      const t = buildImportedTable(file.name, sheets.length > 1 ? sh : '', sheetRows(workbook, sh));
      if (!t) continue;
      if (!repli) repli = { sh, t };
      if (t.headers.length >= 2 && t.objects.length >= 2) { sheet = sh; table = t; break; }
    }
    if (!table && repli) { sheet = repli.sh; table = repli.t; }
    info = { name: file.name, sheets, sheet, workbook, table };
  }
  if (!info.table) throw new Error('Aucune donnée tabulaire trouvée dans ce fichier.');
  importedFile = info;
  setActiveSource('file');
  return info.table;
}

function selectImportedSheet(sheetName) {
  if (!importedFile || !importedFile.workbook) return null;
  const table = buildImportedTable(importedFile.name, sheetName, sheetRows(importedFile.workbook, sheetName));
  if (!table) throw new Error(`L'onglet « ${sheetName} » ne contient pas de données.`);
  importedFile.sheet = sheetName;
  importedFile.table = table;
  if (typeof resetContextSilent === 'function') { try { resetContextSilent(); } catch (e) {} }
  activeSourceKind = 'file';
  refreshSourceUI();
  return table;
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
  // toStrictNumber : convertit une valeur en nombre, retourne NaN si impossible
  const toStrictNumber = (v) => {
    if (v === null || v === undefined || v === '') return NaN;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, '').replace(',', '.'));
    return isFinite(n) ? n : NaN;
  };
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

/* Sens détecté d'une colonne (planner.js : nom → abréviations → contenu),
   transmis à Albert pour qu'il comprenne aussi les tables aux colonnes mal
   nommées. Renvoie null si la colonne n'est pas reconnue. */
const DETECTED_KIND_LABELS = {
  zone_basque: 'Zone Pays Basque', boursier: 'statut boursier', nb_voeux: 'nombre de vœux',
  voeu: 'vœux', bac_series: 'série / type de bac', academie: 'académie', departement: 'département',
  commune: 'commune', formation: 'formation', admission: 'proposition / admission',
  apprentissage: 'apprentissage', sexe: 'sexe', year: 'année / session',
  etablissement_accueil: 'établissement d\'accueil', etablissement_origine_nom: 'établissement d\'origine',
  etablissement: 'établissement'
};
const DETECTED_KIND_SCORES = {
  zone_basque: 20, formation: 14, etablissement_accueil: 14, academie: 12, departement: 10,
  boursier: 8, bac_series: 8, sexe: 8, apprentissage: 8, admission: 8, nb_voeux: 6, voeu: 6,
  commune: 6, etablissement: 5, etablissement_origine_nom: 5, year: 4
};

function detectColumnMeaning(col, rows) {
  if (typeof window === 'undefined' || typeof window.plannerColumnKind !== 'function') return null;
  let kind = 'generic';
  try {
    // Valeurs de la table analysée, pour la détection par le contenu
    const values = rows ? topCountsForRows(rows, col, 250).top.map(x => ({ value: x.value, count: x.count })) : undefined;
    kind = window.plannerColumnKind(col, values) || 'generic';
  } catch (e) { return null; }
  if (!DETECTED_KIND_LABELS[kind]) return null;
  let role = {};
  try { role = (typeof window.plannerColumnRole === 'function' && window.plannerColumnRole(col)) || {}; } catch (e) { role = {}; }
  let label = DETECTED_KIND_LABELS[kind];
  const n = normalizeText(col);
  if (kind === 'formation' && /enseignements? .*specialite|specialites? .*suivi/.test(n)) {
    // Spécialités du lycée, pas une formation du supérieur
    return { kind, role, label: 'enseignements de spécialité suivis au lycée' };
  }
  if (kind === 'formation' && !role.accueil) label = 'formation / spécialité';
  if (['academie', 'departement', 'commune', 'formation'].includes(kind)) {
    if (role.accueil) label += ' d\'accueil (formation acceptée)';
    else if (role.origine) label += ' d\'origine (scolarité)';
  }
  return { kind, role, label };
}

function findColumnByMeaning(meanings, test) {
  for (const [col, m] of meanings) if (m && test(m)) return col;
  return null;
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
  out += `Important : cette synthèse est calculée sur toutes les lignes, pas seulement sur un aperçu.\n`;
  if (table.rowUnit === 'formation') {
    out += `ATTENTION — UNE LIGNE = UNE FORMATION (open data agrégé, session ${table.session || ''}, France entière), PAS un candidat. Les comptages de lignes sont des nombres de formations. Pour des effectifs de candidats (vœux, propositions, admis…), additionne les colonnes chiffrées correspondantes. Précise toujours la session et la source (open data Parcoursup) dans ta réponse, et qu'il ne s'agit pas des données individuelles de l'académie.\n`;
  }
  out += `\n`;

  // Colonnes principales : colonnes métier + colonnes dont le nom est cité dans la question.
  // Le score par nom est complété par le sens détecté : une colonne mal nommée
  // mais reconnue (abréviation ou contenu) n'est plus reléguée en fin de liste.
  // Les colonnes techniques (score négatif) restent écartées.
  const meanings = new Map(headers.map(col => [col, detectColumnMeaning(col, rows)]));
  const summaryScore = col => {
    const byName = scoreColumnForSummary(col);
    if (byName < 0) return byName;
    const m = meanings.get(col);
    return Math.max(byName, m ? (DETECTED_KIND_SCORES[m.kind] || 0) : 0);
  };
  const selectedCols = headers
    .map(col => ({ col, score: summaryScore(col) + (q && q.includes(normalizeText(col)) ? 12 : 0) }))
    .filter(x => x.score > -10)
    .sort((a,b) => b.score - a.score)
    .slice(0, 14)
    .map(x => x.col);

  out += `Colonnes principales repérées : ${selectedCols.join(' | ')}\n\n`;

  // Carte des colonnes : sens détecté automatiquement + définition métier
  const mapLines = headers.map(col => {
    const m = meanings.get(col);
    const alias = (typeof columnAlias === 'function') ? columnAlias(col) : '';
    if (!m && !alias) return null;
    return `- ${col} → ${m ? m.label : 'variable'}${alias}`;
  }).filter(Boolean);
  if (mapLines.length) {
    out += `### Sens des colonnes (détecté automatiquement d'après le nom, les abréviations ou le contenu)\n`;
    out += mapLines.join('\n') + '\n';
    out += `Utilise ce sens pour interpréter les colonnes, même si leur nom est abrégé ou peu explicite. Les colonnes absentes de cette liste n'ont pas été reconnues : ne leur prête pas un sens Parcoursup sans indice dans leurs valeurs.\n\n`;
  }

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
  // Repli sur le sens détecté si aucun intitulé ne correspond
  const zoneCol = findBestColumn(headers, [/zone.*pays.*basque|pays.*basque|zone/], [])
    || findColumnByMeaning(meanings, m => m.kind === 'zone_basque');
  const groupCol = findBestColumn(headers, [/grands? groupes?.*formation.*accueil.*acceptee|grands? groupes?.*formation|formation.*accueil.*acceptee/], [])
    || findColumnByMeaning(meanings, m => m.kind === 'formation' && m.role.accueil);
  const acadCol = findBestColumn(headers, [/academie/], [/scolarite|origine|lycee/])
    || findColumnByMeaning(meanings, m => m.kind === 'academie' && !m.role.origine);

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

// v27.7 — filtre « intitulé de formation contenant » : tous les mots présents dans les colonnes de formation de la ligne
const _rowTermsCache = new WeakMap();
function rowContainsAllTerms(row, filter) {
  if (!row || typeof row !== 'object') return false;
  const key = (filter.cols || []).join('\u0001');
  let byCols = _rowTermsCache.get(row);
  if (!byCols) { byCols = new Map(); _rowTermsCache.set(row, byCols); }
  let words = byCols.get(key);
  if (!words) {
    words = new Set(normalizeText((filter.cols || []).map(c => row[c] ?? '').join(' ')).split(' '));
    byCols.set(key, words);
  }
  // chaque terme : une forme ou plusieurs (singulier / pluriel)
  return (filter.terms || []).every(t => (Array.isArray(t) ? t : [t]).some(w => words.has(w)));
}

// v27.14 — conditions chiffrées (« plus de 100 places », « taux d'accès inférieur à 20 ») ; une case vide ne satisfait aucune condition
const OPS_CHIFFRES = { gt: (a, b) => a > b, gte: (a, b) => a >= b, lt: (a, b) => a < b, lte: (a, b) => a <= b, eqn: (a, b) => a === b };
function _chiffreCellule(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = String(v ?? '').replace(/[\s\u00a0\u202f]/g, '').replace(',', '.').replace(/%$/, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
function rowMatchesFilter(row, filter) {
  if (filter && filter.op === 'contains_all') return rowContainsAllTerms(row, filter);
  // v27.23 — une valeur parmi une liste (établissements dont le nom correspond : « Lycée Montaigne », …)
  if (filter && filter.op === 'in') return (filter.values || []).includes(normalizeText(row[filter.col]));
  // v27.5.53 — mots présents dans une seule colonne (« Enseignement(s) de spécialité suivi(s) » contient « Sciences
  // Economiques et Sociales » parmi « SES | Mathématiques ») : chaque terme, sous l'une de ses formes
  if (filter && filter.op === 'contains_words') {
    const mots = new Set(normalizeText(row[filter.col]).split(' '));
    return (filter.terms || []).every(t => [].concat(t).some(w => mots.has(w)));
  }
  if (filter && OPS_CHIFFRES[filter.op]) { const x = _chiffreCellule(row[filter.col]); return x !== null && OPS_CHIFFRES[filter.op](x, Number(filter.value)); }
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
  return 'Filtres appliqués : ' + filters.map(f => f.op === 'in' ? `${f.col} : ${f.label || f.value}` : f.op === 'contains_words' ? `${f.col} contient « ${f.label || f.value} »` : `${f.col} ${({ neq: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤' })[f.op] || '='} "${f.value}"`).join(' ; ');
}


