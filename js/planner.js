/* planner.js — Planner V2 pour Parcoursup Data Copilot.
   Refonte : le planner construit un schéma vivant de la table, résout les
   entités par score colonne/valeur, déduplique les colonnes proches, puis
   produit un plan JSON pour le Data Engine.

   Compatible avec l'architecture actuelle : app.js → planner.js → dataEngine.js.
   Point d'entrée attendu par dataEngine.js : buildPlannerPlan(...).
*/

(function () {
  'use strict';

  const STOPWORDS = new Set('le la les un une des du de d l et ou a au aux en avec sans pour par dans sur sous entre vers chez qui que quoi dont est sont ayant avoir plus moins nombre combien candidats candidat formation formations academie académie etablissement établissement classe serie série bac zone'.split(/\s+/));

  function nrm(s) {
    if (typeof normalizeText === 'function') return normalizeText(String(s ?? '').replace(/œ/g, 'oe').replace(/Œ/g, 'OE').replace(/æ/g, 'ae'));
    return String(s ?? '')
      .toLowerCase()
      .replace(/œ/g, 'oe').replace(/æ/g, 'ae')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[’']/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function tokens(s) {
    return nrm(s).split(/\s+/).filter(t => t && t.length >= 2 && !STOPWORDS.has(t));
  }

  function uniq(arr) {
    return [...new Set((arr || []).filter(Boolean))];
  }

  function has(q, pattern) {
    return pattern.test(q);
  }

  function compactSpaces(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
  }

  function safeEscapeHtml(s) {
    if (typeof escapeHtml === 'function') return escapeHtml(s);
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  }

  /* ═══════════════════════ SCHEMA DISCOVERY ═══════════════════════ */

  function columnRole(col) {
    const c = nrm(col);
    return {
      accueil: /accueil|acceptee|accepte|acceptation|affectation|admission/.test(c),
      origine: /origine|scolarite|scolarité|etablissement d origine|lycee d origine|commune de scolarite|academie de scolarite/.test(c),
      acceptedLabelOnly: /etablissement.*acceptee|formation.*acceptee|accueil.*acceptee/.test(c),
      boursierLycee: /boursier.*lycee|boursier.*lyc[eé]e|lyc[eé]e.*boursier/.test(c)
    };
  }

  function columnKind(col) {
    const c = nrm(col);
    if (/zone.*pays.*basque|pays.*basque/.test(c)) return 'zone_basque';
    // v27.10 — « Dont effectif des admis boursiers », « % d'admis boursiers » : des mesures chiffrées, pas l'état boursier
    if (/boursier|bourse|bours[eé]/.test(c) && /effectif|nombre|\bnb\b|%|pourcentage|\btaux\b|\bpart\b/.test(c)) return 'generic';
    if (/boursier|bourse|bours[eé]/.test(c)) return 'boursier';
    // nb_voeux AVANT voeu : "Nb total de vœux..." doit → nb_voeux et non voeu
    if ((/nb|nombre|total/).test(c) && /v[oœ]ux|v[oœ]eu|voeux|voeu/.test(c)) return 'nb_voeux';
    if (/voeu|voeux|vœu|vœux/.test(c)) return 'voeu';
    if (/serie.*classe|série.*classe|type.*classe|type.*bac|serie du bac|serie|série/.test(c)) return 'bac_series';
    if (/academie|académie/.test(c)) return 'academie';
    if (/departement|département/.test(c)) return 'departement';
    if (/commune|ville/.test(c)) return 'commune';
    if (/grand.*groupe|groupe.*formation|formation|specialite|spécialité|mention|filiere|filière|diplome|diplôme/.test(c)) return 'formation';
    if (/proposition|favorable|admission|admis|repondu|répondu/.test(c)) return 'admission';
    if (/apprenti|apprentissage/.test(c)) return 'apprentissage';
    if (/sexe|genre/.test(c)) return 'sexe';
    if (/annee|année|session|campagne/.test(c)) return 'year';
    // Colonnes techniques identifiant/code → generic (pas de valeur analytique directe)
    if (/num[eé]ro|numero|code uai|uai|code postal|identifiant|minist[eè]re.*rattach|type.*contrat/.test(c)) return 'generic';
    if (/etablissement|établissement|lycee|lycée|universite|université|iut|cfa/.test(c)) {
      if (/code|uai|minist|contrat/.test(c)) return 'generic';
      if (/accueil|accepte|acceptée/.test(c) && !/acad[eé]mie|commune|sp[eé]cialit|mention|groupe/.test(c)) return 'etablissement_accueil';
      if (/scolarit|origine/.test(c) && !/commune|d[eé]partement|code|minist|type|contrat/.test(c)) return 'etablissement_origine_nom';
      return 'etablissement';
    }
    return 'generic';
  }

  /* ─────────── Détection renforcée pour les tables inconnues ───────────
     columnKind() reconnaît les intitulés « longs » de l'export académique.
     Pour une table dont les colonnes sont nommées autrement, deux filets de
     sécurité s'appliquent UNIQUEMENT quand columnKind() renvoie 'generic' :
       1. abréviations courantes (LIB_ACA_ACC, DEP_SCO, Dpt, Etab, Bac…) ;
       2. contenu de la colonne (noms d'académies, de départements, séries
          de bac, types de formation, sexe…).
     Les colonnes techniques (code, UAI, numéro, identifiant…) ne sont jamais
     reclassées. Les colonnes déjà reconnues par leur nom ne changent pas. */

  const ABBREVIATIONS = {
    aca: 'academie', acad: 'academie', acade: 'academie',
    dep: 'departement', dept: 'departement', dpt: 'departement', depart: 'departement',
    com: 'commune', comm: 'commune',
    etab: 'etablissement', etb: 'etablissement', eta: 'etablissement', etabl: 'etablissement',
    sco: 'scolarite', scol: 'scolarite', orig: 'origine',
    acc: 'accueil', accu: 'accueil', accpt: 'acceptee',
    form: 'formation', frm: 'formation', spe: 'specialite', spec: 'specialite', fil: 'filiere',
    nbr: 'nb', vx: 'voeux', voe: 'voeux', prop: 'proposition', adm: 'admission',
    app: 'apprenti', appr: 'apprenti', sex: 'sexe', bours: 'boursier', bour: 'boursier',
    ser: 'serie', bac: 'serie bac', ann: 'annee', lib: 'libelle', cp: 'code postal', cod: 'code',
    grp: 'groupe', gpe: 'groupe', conf: 'confirmes', cand: 'candidat', num: 'numero'
  };

  function expandAbbreviations(col) {
    const words = String(col ?? '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/).filter(Boolean);
    // « serie bac » seulement si la série n'est pas déjà nommée
    const hasSerie = words.some(w => w === 'serie' || w === 'ser');
    return words.map(w => (w === 'bac' && hasSerie) ? w : (ABBREVIATIONS[w] || w)).join(' ');
  }

  function isTechnicalName(c) {
    return /\b(num[eé]ro|numero|code|uai|identifiant|id|insee|siret|minist[eè]re|ministere|contrat|postal|manualsort)\b/.test(c);
  }

  const ACADEMIES = ['aix marseille','amiens','besancon','bordeaux','clermont ferrand','corse','creteil','dijon','grenoble','guadeloupe','guyane','lille','limoges','lyon','martinique','mayotte','montpellier','nancy metz','nantes','nice','normandie','caen','rouen','orleans tours','paris','poitiers','reims','rennes','la reunion','reunion','strasbourg','toulouse','versailles','polynesie francaise','nouvelle caledonie','wallis et futuna','saint pierre et miquelon'];
  const DEPARTEMENTS = ['ain','aisne','allier','alpes de haute provence','hautes alpes','alpes maritimes','ardeche','ardennes','ariege','aube','aude','aveyron','bouches du rhone','calvados','cantal','charente','charente maritime','cher','correze','corse du sud','haute corse','cote d or','cotes d armor','creuse','dordogne','doubs','drome','eure','eure et loir','finistere','gard','haute garonne','gers','gironde','herault','ille et vilaine','indre','indre et loire','isere','jura','landes','loir et cher','loire','haute loire','loire atlantique','loiret','lot','lot et garonne','lozere','maine et loire','manche','marne','haute marne','mayenne','meurthe et moselle','meuse','morbihan','moselle','nievre','nord','oise','orne','pas de calais','puy de dome','pyrenees atlantiques','hautes pyrenees','pyrenees orientales','bas rhin','haut rhin','rhone','haute saone','saone et loire','sarthe','savoie','haute savoie','paris','seine maritime','seine et marne','yvelines','deux sevres','somme','tarn','tarn et garonne','var','vaucluse','vendee','vienne','haute vienne','vosges','yonne','territoire de belfort','essonne','hauts de seine','seine saint denis','val de marne','val d oise','guadeloupe','martinique','guyane','la reunion','reunion','mayotte'];
  const ACADEMIE_SET = new Set(ACADEMIES);
  const DEPARTEMENT_SET = new Set(DEPARTEMENTS);

  // Part (pondérée par le nombre de lignes) des valeurs qui satisfont test()
  function valueShare(values, test) {
    let total = 0, ok = 0;
    values.forEach(v => {
      const n = Number(v.count) || 1;
      total += n;
      if (test(nrm(v.value))) ok += n;
    });
    return total ? ok / total : 0;
  }

  function kindFromValues(values) {
    const vals = (values || []).filter(v => String(v.value ?? '').trim() !== '');
    if (!vals.length) return 'generic';
    const normed = vals.map(v => nrm(v.value));
    // Booléens et nombres : le contenu ne dit rien du sens de la colonne
    if (normed.every(v => /^(oui|non|yes|no|true|false|vrai|faux|0|1)$/.test(v))) return 'generic';
    if (normed.filter(v => /^-?\d+([ .,]\d+)?$/.test(v)).length >= normed.length * 0.8) return 'generic';
    // Codes UAI (7 chiffres + 1 lettre) → identifiant technique
    if (normed.filter(v => /^\d{7}[a-z]$/.test(v)).length >= normed.length * 0.8) return 'generic';

    const distinct = vals.length;
    const stripAcad = v => v.replace(/^(academie|acad|aca)( de| d)? /, '').replace(/^(de|d) /, '');
    const stripDept = v => v.replace(/^\d{1,3}[ab]? /, '').replace(/^(departement|dept|dpt)( de la| du| des| de| d)? /, '');

    if (distinct <= 3 && normed.every(v => /^(f|m|h|feminin|masculin|femme|homme|fille|garcon|femmes|hommes)$/.test(v))) return 'sexe';
    // statut de candidature en clair (« Admis », « Refusé », « En liste d'attente ») — repris de la branche fiches métiers
    if (distinct <= 12 && valueShare(vals, v => /^(admis|admise|non admis|refuse|refusee|accepte|acceptee|proposition acceptee|proposition refusee|en attente|en liste d attente|liste d attente|desiste|desistee|demission|demissionnaire)$/.test(v)) >= 0.6) return 'admission';
    if (distinct <= 40 && valueShare(vals, v => /\b(general|generale|technologique|professionnel|professionnelle|stmg|sti2d|st2s|stl|std2a|stav|s2tmd|sthr|tmd|bac pro|non bachelier|dael)\b/.test(v)) >= 0.6) return 'bac_series';
    if (distinct >= 2 && distinct <= 40 && valueShare(vals, v => ACADEMIE_SET.has(stripAcad(v))) >= 0.7) return 'academie';
    if (distinct >= 2 && valueShare(vals, v => DEPARTEMENT_SET.has(stripDept(v))) >= 0.7) return 'departement';
    if (valueShare(vals, v => /\b(bts|btsa|but|dut|licence|cpge|dcg|dn made|bachelor|ifsi|pass|las|cupge|deust|dts|dma|classe preparatoire|formation d ingenieur|ecole d ingenieur|mention complementaire)\b/.test(v)) >= 0.5) return 'formation';
    if (valueShare(vals, v => /\b(lycee|lyc|college|universite|iut|ecole|institut|cfa|legt|lgt|lpo|lp|campus|faculte)\b/.test(v)) >= 0.5) return 'etablissement';
    return 'generic';
  }

  // Valeurs de la colonne dans la table active (Grist en priorité), si dispo.
  const _valueCache = new Map();
  let _tableCache = { src: null, table: null };
  function activeValuesFor(col) {
    try {
      let table = null;
      const kind = (typeof getActiveSourceKind === 'function') ? getActiveSourceKind() : 'grist';
      if (kind !== 'grist' && typeof getActiveQueryTables === 'function') {
        table = (getActiveQueryTables() || [])[0] || null;
      } else if (typeof buildGristQueryTable === 'function') {
        // Reconstruire la table Grist une seule fois par jeu d'enregistrements
        const src = (typeof gristRecords !== 'undefined') ? gristRecords : null;
        if (src && _tableCache.src === src) table = _tableCache.table;
        else { table = buildGristQueryTable(); _tableCache = { src, table }; }
      }
      if ((!table || !table.objects || !table.objects.length) && typeof getActiveQueryTables === 'function') table = (getActiveQueryTables() || [])[0];
      if (!table || !table.objects || !table.objects.length) return null;
      const key = `${table.name || ''}|${col}|${table.objects.length}`;
      if (_valueCache.has(key)) return _valueCache.get(key);
      const headers = table.headers || Object.keys(table.objects[0] || {});
      if (!headers.includes(col)) return null;
      const vals = valuesFor(table, col, 250);
      if (_valueCache.size > 500) _valueCache.clear();
      _valueCache.set(key, vals);
      return vals;
    } catch (e) {
      return null;
    }
  }

  /* Point d'entrée public : nom de colonne, puis abréviations, puis contenu.
     `values` (optionnel) : [{value, count}] ; sinon lus dans la table active. */
  function columnKindSmart(col, values) {
    const byName = columnKind(col);
    if (byName !== 'generic') return byName;
    const c = nrm(col);
    if (isTechnicalName(c)) return 'generic';

    const expanded = expandAbbreviations(col);
    if (expanded !== c) {
      if (isTechnicalName(expanded)) return 'generic';
      const byAbbrev = columnKind(expanded);
      if (byAbbrev !== 'generic') return byAbbrev;
    }

    const vals = values || activeValuesFor(col);
    return vals ? kindFromValues(vals) : 'generic';
  }

  function columnPriority(entry, q = '') {
    const c = nrm(entry.column);
    const k = entry.kind;
    const r = entry.role || {};
    let s = 0;

    const askedAccueil = /(accueil|acceptee|accepte|accept[eé]e|admis|admission|choisi|choisie|formation)/.test(q);
    const askedOrigine = /(venant de|venant du|provenant de|issu de|scolarisé|scolarise|origine|scolarite|scolarité|lycee|lycée d origine|commune de scolarite|etablissement d origine)/.test(q);
    const askedApprentis = /apprenti/.test(q);
    const askedVoeux = /(v[oœ]ux|v[oœ]eu|v?oeux|nombre de voeux)/.test(q);

    if (k === 'zone_basque') s += 200;

    if (k === 'bac_series') {
      s += 120;
      if (/serie.*classe|série.*classe/.test(c)) s += 80;
      if (/type.*classe|type.*bac/.test(c)) s += 25;
      if (/serie/.test(c) && !/type/.test(c)) s += 35;
    }

    if (k === 'boursier') {
      s += 135;
      if (entry.role?.boursierLycee) s -= 35;
      if (/boursier.*lycee|boursier.*lyc[eé]e/.test(c)) s -= 35;
      if (/boursier(?!.*lycee|.*lyc[eé]e)|candidat.*boursier|statut.*boursier/.test(c)) s += 55;
    }

    if (k === 'academie') {
      s += 90;
      if (r.accueil) s += askedOrigine ? -25 : 90;
      if (r.origine) s += askedOrigine ? 50 : -90;
      if (/acceptee|accepte|accueil|affectation/.test(c)) s += 35;
    }

    if (k === 'formation') {
      s += 85;
      if (/grand.*groupe|groupe.*formation/.test(c)) s += 55;
      if (r.accueil) s += askedOrigine ? -20 : 70;
      if (/specialite|mention/.test(c)) s += 20;
      if (r.origine) s -= 70;
    }

    if (k === 'admission') {
      s += 90;
      if (/repondu|répondu|favorable|accept/.test(c)) s += 80;
      if (/a eu|recu|reçu/.test(c)) s += 25;
    }

    if (k === 'etablissement') {
      s += 50;
      if (r.accueil) s += askedOrigine ? -20 : 45;
      if (/(formation|but|dut|bts|licence|cpge|admis|admission)/.test(q)) s -= 35;
    }

    if (k === 'departement') s += 75;
    if (k === 'commune') s += 55;
    if (k === 'apprentissage') s += 70;
    if (k === 'sexe') s += 55;
    if (k === 'voeu') s += 50;
    if (k === 'year') s += 45;

    if (askedAccueil && r.accueil) s += 25;
    if (askedAccueil && r.origine) s -= 35;
    return s;
  }

  function semanticKey(entry) {
    const k = entry.kind;
    if (['zone_basque', 'bac_series', 'boursier', 'apprentissage', 'sexe'].includes(k)) return k;
    if (k === 'academie') return entry.role?.accueil ? 'academie_accueil' : (entry.role?.origine ? 'academie_origine' : 'academie');
    if (k === 'formation') return entry.role?.accueil ? 'formation_accueil' : 'formation';
    // v27.5.53 — « A eu une proposition » et « A répondu favorablement » : deux informations distinctes, deux filtres possibles
    if (k === 'admission') return /proposition/.test(entry.norm || '') && !/repondu|favorabl|accept/.test(entry.norm || '') ? 'admission_proposition' : 'admission';
    return `${k}:${entry.column}`;
  }

  function valuesFor(table, col, max = 500) {
    if (typeof uniqueValues === 'function') return uniqueValues(table, col, max);
    const m = new Map();
    (table.objects || []).forEach(r => {
      const v = r[col];
      if (v === undefined || v === null || String(v).trim() === '') return;
      const key = String(v).trim();
      m.set(key, (m.get(key) || 0) + 1);
    });
    return [...m.entries()].sort((a,b) => b[1] - a[1]).slice(0, max).map(([value, count]) => ({ value, count }));
  }

  function inferType(values) {
    if (!values || !values.length) return 'empty';
    const vals = values.map(v => String(v.value ?? '').trim()).filter(Boolean);
    const boolish = vals.every(v => /^(oui|non|yes|no|true|false|0|1|vrai|faux)$/i.test(v));
    if (boolish) return 'boolean';
    const nums = vals.filter(v => /^-?\d+([,.]\d+)?$/.test(v)).length;
    if (nums >= Math.max(3, vals.length * 0.8)) return 'number';
    if (vals.length <= 80) return 'choice';
    return 'text';
  }

  // v27.5.59 — schéma gardé en mémoire par table (les valeurs de chaque colonne étaient relues à chaque question :
  // 0,4 s par question sur un export de 35 000 candidats)
  const _schemas = new WeakMap();
  function buildSchema(table) {
    const cle = `${(table?.objects || []).length}|${(table?.headers || []).join('\u0001')}`;
    const c = table && typeof table === 'object' ? _schemas.get(table) : null;
    if (c && c.cle === cle) return c.schema;
    const schema = _buildSchema(table);
    if (table && typeof table === 'object') _schemas.set(table, { cle, schema });
    return schema;
  }
  function _buildSchema(table) {
    const headers = (table?.headers || Object.keys(table?.objects?.[0] || {}))
      .filter(h => h && !/^(id|manualSort)$/i.test(String(h)));

    const columns = headers.map(col => {
      const vals = valuesFor(table, col, 250);
      const entry = {
        column: col,
        norm: nrm(col),
        kind: columnKindSmart(col, vals),
        // Rôle (accueil / origine) calculé aussi sur le nom désabrégé
        role: columnRole(`${col} ${expandAbbreviations(col)}`),
        values: vals,
        type: inferType(vals),
        priority: 0
      };
      entry.priority = columnPriority(entry);
      return entry;
    });

    return { table, columns };
  }

  /* ═══════════════════════ VALUE ALIASES ═══════════════════════ */

  function booleanValue(entry, yes) {
    const wanted = yes ? ['oui','yes','true','vrai','1'] : ['non','no','false','faux','0'];
    return (entry.values || []).find(v => wanted.includes(nrm(v.value))) || null;
  }

  function aliasesForValue(entry, value) {
    const raw = compactSpaces(value);
    const v = nrm(raw);
    const a = new Set([v]);

    const add = (...xs) => xs.forEach(x => a.add(nrm(x)));

    // v27.13 — statuts de candidature en clair : pluriels et formes courantes
    if (entry.kind === 'admission') {
      if (/^refuse/.test(v)) add('refusé','refuse','refusés','refuses','refusée','refusées','refusees','candidats refusés');
      if (/attente/.test(v)) add('en attente','liste d attente','en liste d attente','liste d\'attente','en liste d\'attente');
      if (/^desist/.test(v)) add('désisté','desiste','désistés','desistes','désistement');
      if (/^non admis/.test(v)) add('non admis','non admise','non admises');
    }
    if (entry.kind === 'bac_series') {
      if (/general|generale|s[eé]rie generale/.test(v)) add('général','generale','générale','bac général','bac generale','voie générale','voie generale','serie generale','série générale','bac g');
      if (/professionnel|professionnelle|\bpro\b/.test(v)) add('professionnel','professionnelle','bac pro','bac professionnel','voie professionnelle','serie professionnelle');
      if (/technologique|techno|stmg|sti2d|std2a|stl|st2s|stav|s2tmd/.test(v)) add('technologique','techno','bac techno','bac technologique','voie technologique','serie technologique');
      ['stmg','sti2d','std2a','stl','st2s','stav','s2tmd','sthr'].forEach(x => { if (new RegExp(`\\b${x}\\b`).test(v)) add(x); });
      // v27.5.53 — séries écrites en toutes lettres (« Sciences et Technologies du Management et de la Gestion ») : leur sigle
      [[/management.*gestion/, 'stmg'], [/industrie.*developpement durable/, 'sti2d'], [/design.*arts? appliqu/, 'std2a'],
       [/technologies? de laboratoire|technologie de laboratoire/, 'stl'], [/sante.*social/, 'st2s'], [/agronomie.*vivant/, 'stav'],
       [/theatre.*musique.*danse/, 's2tmd'], [/hotellerie.*restauration/, 'sthr']].forEach(([re, x]) => { if (re.test(v)) add(x, `bac ${x}`, `serie ${x}`); });
    }

    if (entry.kind === 'formation') {
      if (/\bdut\b|diplome universitaire de technologie/.test(v)) add('dut','but','formation dut','formation but','bachelor universitaire de technologie','diplôme universitaire de technologie','diplome universitaire de technologie','iut');
      if (/\bbut\b|bachelor universitaire de technologie/.test(v)) add('but','dut','formation but','formation dut','bachelor universitaire de technologie','iut');
      if (/\bbts\b|brevet de technicien superieur/.test(v)) add('bts','formation bts','brevet de technicien supérieur','brevet de technicien superieur');
      if (/licence|\bl1\b/.test(v)) add('licence','l1','formation licence');
      if (/cpge|classe preparatoire/.test(v)) add('cpge','prépa','prepa','classe préparatoire','classe preparatoire');
    }

    // v27.8 — états oui / non reconnus sur la valeur entière : « 12.5 » ou « 10 » (colonne chiffrée) n'est pas « 1 » (oui)
    const ETAT_OUI = /^(oui|o|yes|true|1|vrai)$/, ETAT_NON = /^(non|n|no|false|0|faux)$/;
    if (entry.kind === 'admission') {
      if (ETAT_OUI.test(v) || /^(admis|admise|accepte|acceptee)$/.test(v)) add('admis','admise','admission','accepté','accepte','acceptée','acceptee','réponse favorable','reponse favorable','proposition acceptée','proposition acceptee');
      if (ETAT_NON.test(v) || /^non admis/.test(v)) add('non admis','pas admis','sans proposition acceptée','sans reponse favorable');
    }

    if (entry.kind === 'boursier') {
      if (ETAT_OUI.test(v) || (/boursier|bourse/.test(v) && !/\b(non|pas|sans|aucune?)\b/.test(v))) add('boursier','boursiers','bourse','avec bourse');
      if (ETAT_NON.test(v) || /\b(non|pas|sans|aucune?)\b.*bours/.test(v)) add('non boursier','non boursiers','sans bourse','pas boursier','excluant les boursiers');
    }

    if (entry.kind === 'zone_basque') {
      if (ETAT_OUI.test(v)) add('pays basque','basque','zone basque','zone du pays basque','candidats basques');
      if (ETAT_NON.test(v)) add('hors pays basque','non basque','hors zone basque');
    }

    if (entry.kind === 'apprentissage') {
      if (/^(oui|true|1|vrai)$/.test(v) || /^apprenti/.test(v)) add('apprenti','apprentis','apprentie','apprenties','en apprentissage','en alternance');
      if (/^(non|false|0|faux)$/.test(v) || /non apprenti|hors apprentissage/.test(v)) add('non apprenti','non apprentis','hors apprentissage','pas en apprentissage');
    }

    if (entry.kind === 'sexe') {
      if (/feminin|femme|fille/.test(v) || v === 'f') add('féminin','feminin','femme','femmes','fille','filles','candidate','candidates');
      if (/masculin|homme|garcon/.test(v) || v === 'm' || v === 'h') add('masculin','homme','hommes','garçon','garcon','garcons');
    }

    return [...a].filter(x => x && x.length >= 2);
  }

  function aliasMatchScore(q, alias) {
    const a = nrm(alias);
    if (!a || a.length < 2) return 0;
    // v27.5.53 — alias court (sigle) : mot entier (« stav » est dans « Gustave », « but » dans « début »)
    if (a.length <= 5 && !new RegExp(`(^|[^a-z0-9])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?([^a-z0-9]|$)`).test(q)) return 0;
    if (q.includes(a)) {
      // bonus aux expressions exactes longues.
      return Math.min(120, 45 + a.length * 2);
    }
    const ats = a.split(/\s+/).filter(t => t.length >= 3 && !STOPWORDS.has(t));
    if (ats.length >= 2 && ats.every(t => q.includes(t))) return 40 + ats.length * 8;
    return 0;
  }

  // v27.5.53 — une valeur de la colonne citée telle quelle (mots entiers, 4 lettres au moins)
  function valeurCitee(entry, q) {
    return (entry.values || []).some(v => { const n = nrm(v.value); return n.length >= 4 && ` ${q} `.includes(` ${n} `); });
  }
  function contextScore(entry, q) {
    let s = columnPriority(entry, q) / 4;
    const k = entry.kind;
    if (k === 'zone_basque' && /basque|pays basque/.test(q)) s += 100;
    if (k === 'bac_series' && /(bac|serie|série|voie|general|generale|professionnel|technologique|techno|stmg|sti2d|std2a)/.test(q)) s += 95;
    if (k === 'boursier' && /(boursier|boursiers|bourse|crous)/.test(q)) s += 140;
    if (k === 'formation' && /(formation|but|dut|bts|licence|cpge|prepa|iut|filiere|sp[eé]cialit[eé]|mention)/.test(q)) s += 85;
    if (k === 'academie' && /(academie|académie|academique|hors bordeaux|bordeaux|toulouse|poitiers|limoges)/.test(q)) s += 80;
    if (k === 'admission' && /(admis|admission|accept|favorable|proposition acceptee|réponse favorable|reponse favorable)/.test(q)) s += 80;
    if (k === 'apprentissage' && /(apprenti|apprentissage)/.test(q)) s += 80;
    if (k === 'sexe' && /(sexe|genre|homme|femme|masculin|feminin|féminin|\bfilles?\b|gar[cç]ons?|\bcandidates\b)/.test(q)) s += 60;
    if (k === 'departement' && (/(departement|département|gironde|landes|pyrenees|pyrénées)/.test(q) || valeurCitee(entry, q))) s += 60;
    if (k === 'commune' && /(commune|ville)/.test(q)) s += 55;
    return s;
  }

  function operatorForMention(q, alias, entry) {
    const a = nrm(alias);
    if (!a) return 'eq';

    // Cas spécialisé : la négation des boursiers devient Boursier = non, pas Boursier != oui.
    if (entry.kind === 'boursier') return 'eq';
    if (entry.kind === 'zone_basque') return 'eq';

    const idx = q.indexOf(a);
    const windowBefore = idx >= 0 ? q.slice(Math.max(0, idx - 35), idx) : q;
    const windowAround = idx >= 0 ? q.slice(Math.max(0, idx - 35), Math.min(q.length, idx + a.length + 20)) : q;
    // v27.17 — mots entiers : « PASS » contient « pas » (« PASS dans l'académie de Bordeaux » devenait « ≠ Bordeaux »)
    // v27.5.64 — « sauf les BTS », « à l'exception des CPGE », « en dehors des licences » : article entre les deux
    if (/(^|\s)(hors|sauf|exclu|excluant|exclure|different|differente|diff[eé]rent|pas|non|excepte|exceptes|exception (?:de|des|du|d)|en dehors (?:de|des|du|d))(\s+(?:les|des|de|du|la|le|l|d))?\s*$/.test(windowBefore)) return 'neq';
    // v27.5.72 — « qui ne sont pas en série générale », « n'est pas en bac pro », « ne viennent pas du lycée » : la valeur
    // est précédée de « pas » + préposition + nom de la colonne (avant : négation perdue, « série = Générale »)
    if (/(^|\s)pas\s+(?:en|dans|de|du|des|d|au|aux|a|la|le|les|l)(?:\s+(?:la|le|les|l))?\s+(?:serie|series|bac|baccalaureat|voie|classe|filiere|section|type)(?:\s+(?:de|du|des|d))?\s*$/.test(windowBefore)) return 'neq';
    // v27.25 — « non / pas » qui porte sur un autre mot (« formations non sélectives dans l'académie de Bordeaux »,
    // « qui ne sont pas sélectives dans l'académie ») ne nie pas l'académie : seulement « non / pas » suivi d'un mot de lieu
    const _negAcad = windowAround.match(/(?:^|\s)(hors|sauf|exclu|excluant|exclure|different|differente|pas|non)(?=\s|$)(?:\s+(\S+))?/);
    const _vise = _negAcad ? _negAcad[2] || '' : '';
    const _surAutreMot = _negAcad && /^(pas|non)$/.test(_negAcad[1]) && _vise && !/^(dans|de|du|des|en|a|au|aux|situe|situee|situes|situees|localise|localisee|localises|localisees|issu|issue|issus|issues|l|la|le|les|academie|implante|implantee|implantes|implantees)$/.test(_vise);
    if (_negAcad && !_surAutreMot && entry.kind === 'academie') return 'neq';
    return 'eq';
  }

  function conceptMentioned(entry, q) {
    // Garde-fou important : ne jamais créer un filtre Oui/Non juste parce que
    // une valeur Oui/Non apparaît dans un contexte précédent. La question doit
    // évoquer le concept de la colonne.
    const k = entry.kind;
    if (k === 'zone_basque') return /basque|pays basque|zone basque/.test(q);
    if (k === 'boursier') return /boursier|boursiers|bourse|crous/.test(q);
    // v27.13 — statuts en clair : refusés, liste d'attente, désistés
    if (k === 'admission') return /(admis|admise|admission|accept[eé]|acceptee|réponse favorable|reponse favorable|proposition accept[eé]e|proposition acceptee|a repondu|a répondu|refus|attente|d[eé]sist|d[eé]mission)/.test(q);
    if (k === 'apprentissage') return /apprenti|apprentissage|alternance/.test(q);
    if (k === 'bac_series') return /(bac|serie|série|voie|general|generale|professionnel|technologique|techno|stmg|sti2d|std2a|stl|st2s|stav|s2tmd)/.test(q);
    if (k === 'formation') return /(formation|but|dut|bts|licence|cpge|prepa|pr[eé]pa|iut|filiere|filière|sp[eé]cialit[eé]|mention)/.test(q);
    if (k === 'academie') return /academie|académie|academique|bordeaux|toulouse|poitiers|limoges/.test(q);
    // v27.5.53 — tout département présent dans la colonne (« Dordogne », « Lot-et-Garonne » n'étaient pas reconnus)
    if (k === 'departement') return /departement|département|gironde|landes|pyrenees|pyrénées/.test(q) || valeurCitee(entry, q);
    if (k === 'commune') return /commune|ville/.test(q);
    if (k === 'sexe') return /sexe|genre|homme|femme|masculin|feminin|féminin|fille|garcon|garçon|\bcandidates\b/.test(q);
    if (k === 'voeu') return /voeu|voeux|vœu|vœux/.test(q);
    if (k === 'year') return /annee|année|session|campagne|202[0-9]/.test(q);
    return true;
  }

  function bestValueCandidates(schema, q) {
    const candidates = [];

    schema.columns.forEach(entry => {
      const ctx = contextScore(entry, q);
      if (entry.kind === 'generic' && ctx < 40) return;
      if (!conceptMentioned(entry, q)) return;

      // Ne pas utiliser une colonne texte à forte cardinalité par simple valeur mentionnée.
      if (entry.type === 'text' && !['formation','academie','departement','commune','etablissement','year'].includes(entry.kind)) return;

      // colonne admission Oui/Non : seulement ces valeurs ; colonne de statut en clair (Admis / Refusé / En liste d'attente) : toutes
      const _booleens = (entry.values || []).filter(v => /^(oui|non|yes|no|true|false|0|1|vrai|faux)$/i.test(String(v.value).trim()));
      const values = entry.kind === 'admission' && _booleens.length ? _booleens : (entry.values || []);

      values.forEach(item => {
        let bestAlias = '';
        let bestAliasScore = 0;
        aliasesForValue(entry, item.value).forEach(alias => {
          const sc = aliasMatchScore(q, alias);
          if (sc > bestAliasScore) {
            bestAliasScore = sc;
            bestAlias = alias;
          }
        });
        if (!bestAliasScore) return;

        // Si Bordeaux est présent dans "hors académie de Bordeaux", privilégier neq académie accueil.
        if (nrm(item.value) === 'bordeaux' && /\b(hors|autres?|sauf|different|differente|pas)\b.*bordeaux/.test(q) && entry.kind !== 'academie') return;

        const op = operatorForMention(q, bestAlias, entry);
        const score = bestAliasScore + ctx + columnPriority(entry, q) / 3 + Math.log10((item.count || 1) + 1);
        candidates.push({ entry, item, alias: bestAlias, op, score });
      });
    });

    return candidates.sort((a,b) => b.score - a.score);
  }

  function upsertCandidateFilter(filters, cand, reasons) {
    const key = semanticKey(cand.entry);
    const idx = filters.findIndex(f => f.semanticKey === key);
    const filter = {
      col: cand.entry.column,
      value: String(cand.item.value).trim(),
      op: cand.op || 'eq',
      reason: `Planner V2 : « ${cand.alias} »`,
      confidence: Math.min(0.99, Math.max(0.55, cand.score / 220)),
      semanticKey: key,
      score: cand.score
    };
    if (idx >= 0) {
      if (filter.score > filters[idx].score + 12) filters[idx] = filter;
      return;
    }
    filters.push(filter);
    reasons.push(`« ${cand.alias} » ⇒ ${cand.entry.column} ${filter.op === 'neq' ? '≠' : '='} ${filter.value} (score ${Math.round(cand.score)})`);
  }

  /* ═══════════════════════ SPECIAL GRAMMAR RULES ═══════════════════════ */

  function bestColumn(schema, predicate, q, extraScore = () => 0) {
    return schema.columns
      .filter(predicate)
      .map(e => ({ e, s: columnPriority(e, q) + contextScore(e, q) + extraScore(e) }))
      .sort((a,b) => b.s - a.s)[0]?.e || null;
  }

  function findValue(entry, aliases) {
    const wanted = aliases.map(nrm);
    let best = null;
    let score = 0;
    (entry.values || []).forEach(v => {
      aliasesForValue(entry, v.value).forEach(a => {
        if (wanted.includes(a) && a.length > score) {
          best = v;
          score = a.length;
        }
      });
      const nv = nrm(v.value);
      if (!best && wanted.includes(nv)) best = v;
    });
    return best;
  }
  function findBoursierValue(entry, wantYes) {
    const vals = (entry.values || []).filter(v => v && v.value !== undefined && v.value !== null && String(v.value).trim() !== '');
    if (!vals.length) return null;

    const bool = booleanValue(entry, wantYes) || findValue(entry, [wantYes ? 'oui' : 'non', wantYes ? 'yes' : 'no', wantYes ? 'true' : 'false', wantYes ? '1' : '0']);
    if (bool) return bool;

    const positives = vals
      .map(v => ({ v, n: nrm(v.value) }))
      .filter(x => /(boursier|bourse|crous)/.test(x.n) && !/(non boursier|non-boursier|pas boursier|sans bourse|aucune bourse|non)/.test(x.n));
    const negatives = vals
      .map(v => ({ v, n: nrm(v.value) }))
      .filter(x => /(non boursier|non-boursier|pas boursier|sans bourse|aucune bourse|non)/.test(x.n));

    if (wantYes && positives.length) return positives.sort((a,b) => (b.v.count || 0) - (a.v.count || 0))[0].v;
    if (!wantYes && negatives.length) return negatives.sort((a,b) => (b.v.count || 0) - (a.v.count || 0))[0].v;

    // Dernier recours : si la colonne est une colonne boursier avec seulement 2 ou 3 valeurs,
    // la valeur positive est souvent celle qui n'est pas vide/non/sans.
    if (wantYes && vals.length <= 5) {
      const candidate = vals.find(v => !/(non|sans|aucun|aucune|false|faux|0)/.test(nrm(v.value)));
      if (candidate) return candidate;
    }
    return null;
  }


  function addExplicitFilters(schema, q, filters, reasons) {
    // Pays Basque.
    if (/basque|pays basque/.test(q)) {
      const e = bestColumn(schema, x => x.kind === 'zone_basque', q);
      if (e) {
        const negative = /hors pays basque|hors zone basque|non basque/.test(q);
        const v = booleanValue(e, !negative) || findValue(e, [negative ? 'non' : 'oui']);
        if (v) upsertCandidateFilter(filters, { entry: e, item: v, alias: negative ? 'hors pays basque' : 'pays basque', op: 'eq', score: 260 }, reasons);
      }
    }

    // Bac / série.
    const bacRegex = /(bac\s+general|bac\s+g[eé]n[eé]ral|voie\s+generale|voie\s+g[eé]n[eé]rale|serie\s+generale|s[eé]rie\s+g[eé]n[eé]rale|bac\s+pro|bac\s+professionnel|professionnel|technologique|bac\s+techno|stmg|sti2d|std2a|stl|st2s|stav|s2tmd|sthr)/;
    if (bacRegex.test(q)) {
      // v27.5.72 — « qui ne sont pas en série générale », « hors bac pro », « sauf les bacs techno » : exclusion
      // (avant : négation perdue, « Type de la classe = Générale »)
      const _negBac = /\b(?:pas|non|hors|sauf|excepte|exceptes)\s+(?:(?:en|de|du|des|d|dans|la|le|les|l|un|une)\s+)*(?:(?:bacs?|series?|voies?|classes?)\s+)?(?:general|generale|generaux|generales|technologiques?|techno|professionnels?|professionnelles?|pro|stmg|sti2d|std2a|stl|st2s|stav|s2tmd|sthr)\b/.test(q);
      const _opBac = _negBac ? 'neq' : 'eq';
      // v27.5.53 — deux colonnes de série (« Type de la classe » : Générale / Technologique / Professionnelle, et
      // « Série de la Classe » : STMG, STI2D…) : on prend celle qui a la valeur demandée, de préférence à l'identique
      // (avant : « bac technologique » = la seule série STMG, 3 427 au lieu de 6 388 ; « STMG » perdait son filtre)
      const _bacCols = schema.columns.filter(x => x.kind === 'bac_series')
        .map(x => ({ x, s: columnPriority(x, q) + contextScore(x, q) })).sort((a, b) => b.s - a.s).map(o => o.x);
      const _voulu = /(general|g[eé]n[eé]ral|generale|g[eé]n[eé]rale)/.test(q) ? ['generale','générale','general','bac general','serie generale']
        : /professionnel|bac\s+pro/.test(q) ? ['professionnelle','professionnel','bac pro','serie professionnelle']
        : /technologique|techno/.test(q) ? ['technologique','bac techno','serie technologique']
        : [['stmg','sti2d','std2a','stl','st2s','stav','s2tmd','sthr'].find(x => new RegExp(`\\b${x}\\b`).test(q)) || '__'];
      // à l'identique dans plusieurs colonnes (« Professionnelle ») : la plus large, celle qui a le moins de valeurs
      // (« bac pro » = Type de la classe Professionnelle, bacs pro agricoles compris : 10 019, pas 8 507)
      const _exacte = _bacCols.filter(x => (x.values || []).some(v => _voulu.includes(nrm(v.value))))
        .sort((a, b) => (a.values || []).length - (b.values || []).length)[0];
      const _avec = _bacCols.find(x => findValue(x, _voulu));
      // une valeur de plusieurs mots citée telle quelle (« voie professionnelle agricole ») l'emporte
      let _phrase = null;
      // (masculin / féminin confondus : la question est réécrite « bac professionnel agricole »)
      const _genre = t => t.replace(/\bbac pro\b/g, 'professionnel').replace(/professionnelle/g, 'professionnel').replace(/generale/g, 'general');
      _bacCols.forEach(x => (x.values || []).forEach(v => { const n = nrm(v.value); if (n.includes(' ') && !/^serie /.test(n) && ` ${_genre(q)} `.includes(` ${_genre(n)} `) && (!_phrase || n.length > _phrase.n.length)) _phrase = { x, v, n }; }));
      if (_phrase) upsertCandidateFilter(filters, { entry: _phrase.x, item: _phrase.v, alias: _phrase.n, op: _opBac, score: 270 }, reasons);
      const e = _phrase ? null : (_exacte || _avec || _bacCols[0] || null);
      if (e) {
        let wanted = [];
        let label = '';
        if (/(general|g[eé]n[eé]ral|generale|g[eé]n[eé]rale)/.test(q)) { wanted = ['generale','générale','bac general','serie generale']; label = 'bac général'; }
        else if (/professionnel|bac\s+pro/.test(q)) { wanted = ['professionnelle','professionnel','bac pro','serie professionnelle']; label = 'bac professionnel'; }
        else if (/technologique|techno/.test(q)) { wanted = ['technologique','bac techno','serie technologique']; label = 'bac technologique'; }
        else {
          const short = ['stmg','sti2d','std2a','stl','st2s','stav','s2tmd','sthr'].find(x => new RegExp(`\\b${x}\\b`).test(q));
          if (short) { wanted = [short]; label = short.toUpperCase(); }
        }
        const v = findValue(e, wanted);
        if (v) upsertCandidateFilter(filters, { entry: e, item: v, alias: label, op: _opBac, score: 255 }, reasons);
      }
    }

    // Boursiers avec négation. Sélectionne la meilleure colonne contenant boursier/bourse,
    // même si elle s'appelle "Boursier des lycées". Préférence à la colonne candidat/statut
    // boursier quand elle existe, mais ne laisse jamais "combien de boursiers" sans filtre.
    if (/boursier|boursiers|bourse|crous/.test(q)) {
      const e = bestColumn(
        schema,
        x => x.kind === 'boursier' || /boursier|bourse|bours[eé]/.test(x.norm),
        q,
        x => (/^boursier$|candidat.*boursier|statut.*boursier|boursier.*sup[eé]rieur/.test(x.norm) ? 140 : 0)
          + (x.role?.boursierLycee ? -45 : 0)
          + ((x.type === 'boolean' || x.values?.some(v => /^(oui|non)$/i.test(String(v.value).trim()))) ? 80 : 0)
      );
      if (e) {
        const neg = /(exclu|exclure|excluant|hors|sans|non|pas).{0,35}(boursier|boursiers|bourse)|(boursier|boursiers).{0,30}(exclu|exclus|hors|non|sans|pas)/.test(q);
        let v = findBoursierValue(e, !neg);
        if (v) {
          upsertCandidateFilter(filters, { entry: e, item: v, alias: neg ? 'non boursier' : 'boursier', op: 'eq', score: 420 }, reasons);
        } else {
          reasons.push(`Concept « boursier » détecté, colonne candidate « ${e.column} », mais aucune valeur Oui/Non exploitable trouvée.`);
        }
      } else {
        reasons.push('Concept « boursier » détecté mais aucune colonne boursier/bourse trouvée dans la table Grist transmise au widget.');
      }
    }

    // Formation : BUT/DUT/BTS/licence/CPGE. Privilégier groupe/spécialité d'accueil acceptée.
    if (/(\bbut\b|\bdut\b|\bbts\b|licence|\bl1\b|cpge|prepa|pr[eé]pa|iut)/.test(q)) {
      const e = bestColumn(
        schema,
        x => x.kind === 'formation',
        q,
        x => (x.role.accueil ? 80 : 0) + (/grand.*groupe|groupe.*formation/.test(x.norm) ? 70 : 0) - (x.role.origine ? 100 : 0)
      );
      if (e) {
        let wanted = [], label = '';
        if (/\bbut\b/.test(q)) { wanted = ['but','dut','bachelor universitaire de technologie','diplome universitaire de technologie','iut']; label = 'BUT/DUT'; }
        else if (/\bdut\b/.test(q)) { wanted = ['dut','but','diplome universitaire de technologie','iut']; label = 'DUT/BUT'; }
        else if (/\bbts\b/.test(q)) { wanted = ['bts','brevet de technicien superieur']; label = 'BTS'; }
        else if (/licence|\bl1\b/.test(q)) { wanted = ['licence','l1']; label = 'licence/L1'; }
        else if (/cpge|prepa|pr[eé]pa/.test(q)) { wanted = ['cpge','prepa','classe preparatoire']; label = 'CPGE/prépa'; }
        const v = findValue(e, wanted);
        // v27.5.64 — « sauf les BTS », « hors BTS », « à l'exception des CPGE » : exclusion (avant : « sauf les BTS » = les BTS)
        const _neg = new RegExp(`\\b(?:hors|sauf|excepte|exceptes|exception (?:de|des|du|d)|en dehors (?:de|des|du|d)|pas de|non)\\s+(?:les |des |de |du |la |le |l |d )?(?:${wanted.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})s?\\b`).test(q);
        if (v) upsertCandidateFilter(filters, { entry: e, item: v, alias: label, op: _neg ? 'neq' : 'eq', score: 248 }, reasons);
      }
    }

    // Hors académie de Bordeaux : colonne Académie d'accueil acceptée, pas commune de scolarité.
    if (/(\b(hors|autres?|sauf|different|differente|diff[eé]rente|pas)\b.*academie.*bordeaux)|(academie.*\b(hors|autres?|sauf|different|differente)\b.*bordeaux)|(\bhors\s+bordeaux)/.test(q)) {
      const e = bestColumn(
        schema,
        x => x.kind === 'academie',
        q,
        x => (x.role.accueil ? 120 : 0) - (x.role.origine ? 140 : 0) + (/accueil|acceptee|accepte/.test(x.norm) ? 60 : 0)
      );
      if (e) {
        const v = findValue(e, ['bordeaux']);
        if (v) upsertCandidateFilter(filters, { entry: e, item: v, alias: 'hors académie de Bordeaux', op: 'neq', score: 265 }, reasons);
      }
    }

    // v27.5.53 — « ont eu une proposition », « sans proposition », « taux de proposition » : colonne « A eu une proposition
    // au cours de la procédure (Oui/Non) », distincte de « A répondu favorablement à une proposition » (avant : filtre perdu,
    // « combien de candidats ont eu une proposition » donnait tout le fichier)
    // (« ont eu une proposition mais ne l'ont pas acceptée » : les deux colonnes)
    if (/\bpropositions?\b/.test(q) && (!/(accept|favorabl|repondu|r[eé]pondu|\badmis)/.test(q) || /\b(eu|recu|recus|obtenu|obtenus)\b[^.]{0,15}\bpropositions?\b/.test(q))) {
      const e = bestColumn(schema, x => x.kind === 'admission' && /proposition/.test(x.norm) && !/repondu|favorabl|accept/.test(x.norm), q);
      if (e) {
        const sans = /\b(sans|aucune|jamais)\b[^.]{0,20}\bpropositions?\b|\bpas (eu )?(de|d)\s+propositions?\b|\bn ont (pas|jamais|eu aucune|recu aucune)\b|\bpas (eu|recu|obtenu)\b/.test(q);
        const v = booleanValue(e, !sans);
        if (v) upsertCandidateFilter(filters, { entry: e, item: v, alias: sans ? 'sans proposition' : 'a eu une proposition', op: 'eq', score: 300 }, reasons);
      }
    }

    // Accepté / admis / réponse favorable.
    if (/(admis|admise|admission|accept[eé]|acceptee|réponse favorable|reponse favorable|proposition accept[eé]e|proposition acceptee)/.test(q)) {
      // Ne déclencher que si la question parle d'un statut candidat, pas seulement d'une colonne formation d'accueil acceptée.
      const e = bestColumn(schema, x => x.kind === 'admission', q);
      if (e) {
        // Colonne Oui/Non, ou colonne de statut en clair (« Admis », « Proposition acceptée »)
        const v = booleanValue(e, true) || findValue(e, ['oui','true','1','admis','admise','accepte','acceptee','proposition acceptee']);
        // v27.13 — « non admis » / « pas admis » : exclusion (avant : comptait les admis)
        const _nonAdmis = /\b(non|pas)\s+(admis|admise|admises|accepte|acceptes|acceptee|acceptees)\b/.test(q);
        if (v) upsertCandidateFilter(filters, { entry: e, item: v, alias: _nonAdmis ? 'non admis' : 'admis / réponse favorable', op: _nonAdmis ? 'neq' : 'eq', score: 235 }, reasons);
      }
    }
  }

  /* ═══════════════════════ TARGET COLUMN / TOOL ═══════════════════════ */

  function detectTool(question) {
    const q = nrm(question);
    if (/export|excel|xlsx|csv|telecharg|t[eé]l[eé]charg|liste|extraire|extrait|sors moi|sort moi/.test(q)) return /\bcsv\b/.test(q) ? 'export_csv' : 'export_excel';
    if (/croise|crois[eé]|tableau croise|pivot/.test(q)) return 'pivot';
    if (/moyen|moyenne|median|m[eé]diane|minimum|maximum|\bmin\b|\bmax\b/.test(q.replace(/\b(lycees?|colleges?|etablissements?|universites?) (max|min)\b/g, ' '))) return 'stats';
    if (/top|classement|principales?|principaux|plus frequentes?|plus fréquentes?|les plus/.test(q)) return 'top';
    if (/repartition|r[eé]partition|ventilation|par\s+|group[eé]|pourcentage|proportion/.test(q) && !/combien|nombre|effectif/.test(q)) return 'group_by';
    if (/combien|nombre|effectif|compte|compter|total/.test(q)) return 'count_rows';
    return null;
  }


  function targetColumnForPhrase(schema, phrase, wholeQuestion, tool, filters, excludeCols = [], exigeLien = false) {
    const q = nrm(wholeQuestion || phrase);
    const ph = nrm(phrase || wholeQuestion || '');
    const filtered = new Set((filters || []).map(f => f.col));
    (excludeCols || []).forEach(c => filtered.add(c));
    const phraseTokens = tokens(ph);

    const candidates = schema.columns
      .filter(e => !filtered.has(e.column))
      .map(e => {
        let s = contextScore(e, q) + columnPriority(e, q) / 3;
        const _base = s;
        const ctoks = tokens(e.column);
        phraseTokens.forEach(t => { if (ctoks.includes(t) || e.norm.includes(t)) s += 28; });
        // Colonne citée par son nom complet (« répartition par statut de la candidature ») : c'est elle
        if (e.norm.length >= 4 && ` ${ph} `.includes(` ${e.norm} `)) s += 250;

        if (/academie|academique/.test(ph) && e.kind === 'academie') s += e.role.accueil ? 140 : 45;
        if (/serie|bac/.test(ph) && e.kind === 'bac_series') {
          // Si "cpge/prépa" est dans la question, "série" désigne les mentions CPGE, pas la série de bac
          // v27.5.53 — « les formations les plus demandées par les bac pro » : le bac est le filtre, la formation la colonne
          s += /cpge|prepa|pr[eé]pa/.test(q) ? 30 : (!/serie/.test(ph) && /\bformations?\b|filieres?|mentions?/.test(ph)) ? 20 : 140;
        }
        // v27.10 — « Statut de l'établissement de la filière de formation (public, privé…) » n'est pas une colonne de formation
        if (/formation|filiere|specialite|mention|groupe|but|dut|bts|licence|cpge/.test(ph) && e.kind === 'formation' && !/^(statut|secteur)\b/.test(e.norm)) {
          // Boost supplémentaire si "série" est dans la phrase mais dans un contexte CPGE
          s += (/serie/.test(ph) && /cpge|prepa|pr[eé]pa/.test(q)) ? 160 : 125;
        }
        if (/etablissement|universite|lycee|cfa|iut/.test(ph) && e.kind === 'etablissement') s += e.role.accueil ? 180 : 105;
        // v27.5.53 — fichier de candidats : « par lycée » = lycée de scolarité ; « par établissement d'accueil » = accueil
        if (/etablissement|universite|lycee|cfa|iut/.test(ph) && (e.kind === 'etablissement_origine_nom' || e.kind === 'etablissement_accueil')) {
          const versAccueil = /accueil|accept|admis|affect|universite|iut/.test(ph);
          s += (e.kind === 'etablissement_accueil') === versAccueil ? 190 : 100;
        }
        // une colonne dont le nom contient tous les mots demandés (« type de contrat ») passe devant une autre qui n'en a qu'un (« type de la classe »)
        if (phraseTokens.length >= 2 && phraseTokens.every(t => ctoks.includes(t))) s += 200;
        if (/etablissement/.test(ph) && e.kind === 'academie') s -= 120;
        if (/departement/.test(ph) && e.kind === 'departement') s += 125;
        if (/commune|ville/.test(ph) && e.kind === 'commune') s += 110;
        // v27.10 — colonne dont le nom commence par le mot demandé (« par région » → « Région de l'établissement »)
        const _premier = (e.norm.split(' ')[0] || '');
        const _memeMot = t => t && t.length >= 4 && (_premier === t || _premier === t.replace(/s$/, ''));
        const _motsPh = ph.split(/\s+/).filter(w => w.length >= 4); // mots bruts (« académie » est un mot vide pour tokens())
        if (_premier.length >= 4 && _memeMot(_motsPh[0])) s += 300;
        else if (_premier.length >= 4 && _motsPh.some(_memeMot)) s += 60;
        // v27.10 — « par statut » / « public ou privé » : la colonne Statut (ou Secteur), pas une colonne d'effectifs boursiers
        if (/\bstatuts?\b|\bsecteurs?\b|\bpubli|\bprive/.test(ph) && /^(statut|secteur)\b/.test(e.norm) && !/boursier/.test(e.norm)) s += 160;
        if (/voeu|vœu|voeux|vœux/.test(ph) && e.kind === 'voeu') s += 155;
        // v27.10 — la colonne a-t-elle un lien avec les mots demandés (« par X ») ?
        const lien = s > _base;
        // v27.10 — répartition : une colonne chiffrée (effectif, %, taux) n'est retenue que si la question la nomme
        // (« par série » sur l'open data ne doit pas répartir selon « % d'admis boursiers »)
        if ((tool === 'group_by' || tool === 'top') && e.type === 'number' && !_motsPh.some(w => e.norm.includes(w.replace(/s$/, '')))) s -= 200;
        if (tool === 'stats') {
          if (e.type === 'number') s += 95;
          if (/voeu|vœu|voeux|vœux/.test(ph) && e.kind === 'voeu') s += 170;
          if (/confirm/.test(ph) && /confirm/.test(e.norm)) s += 90;
        }
        return { e, s, lien };
      })
      .filter(x => x.s > 40 && (!exigeLien || x.lien))
      .sort((a,b) => b.s - a.s);
    return candidates[0]?.e?.column || null;
  }

  function pivotTargetColumns(schema, question, filters) {
    const q = nrm(question);
    let parts = [];
    const m = q.match(/(?:entre|croise(?:ment)?(?: entre)?|tableau croise(?: entre)?)\s+(.+?)\s+(?:et|avec|x|×)\s+(.+)$/);
    if (m) parts = [m[1], m[2]];
    else {
      // Fallback : utilise les deux concepts les plus explicitement nommés.
      if (/serie|bac/.test(q)) {
        // "séries cpge/prépa" = mentions de formation, pas série de baccalauréat
        parts.push(/cpge|prepa|pr[eé]pa/.test(q) ? 'mention formation cpge' : 'série de bac');
      }
      if (/academie/.test(q)) parts.push('académie accueil');
      if (/formation/.test(q)) parts.push('formation');
      if (/boursier/.test(q)) parts.push('boursier');
    }
    const first = targetColumnForPhrase(schema, parts[0] || q, q, 'pivot', filters, []);
    const second = targetColumnForPhrase(schema, parts[1] || q, q, 'pivot', filters, first ? [first] : []);
    return [first, second];
  }

  function targetColumn(schema, question, tool, filters) {
    if (!['group_by','top','pivot','stats'].includes(tool)) return null;
    const q = nrm(question);
    if (tool === 'stats' && /voeu|voeux|vœu|vœux|confirm/.test(q)) {
      const voeu = schema.columns
        .filter(e => e.kind === 'voeu' || /voeu|vœu|confirm/.test(e.norm))
        .sort((a,b) => (columnPriority(b, q) + contextScore(b, q)) - (columnPriority(a, q) + contextScore(a, q)))[0];
      if (voeu) return voeu.column;
    }
    // v27.5.53 — « demandées par les bac pro » : « par les / des … » désigne qui, pas une dimension (« par série »)
    const parMatch = q.match(/(?:par(?!\s+(?:les|des|le|la|l)\s)|selon|repartition par|répartition par|top\s+\d*\s*(?:des|de)?|principaux|principales)\s+([a-z0-9 ]{3,100})/);
    const phrase = parMatch ? parMatch[1] : q;
    // v27.10 — « par couleur » : aucune colonne ne correspond → null (le moteur le dit), pas l'académie par défaut
    return targetColumnForPhrase(schema, phrase, q, tool, filters, [], !!parMatch && /^(?:.*\s)?(?:par|selon)\s/.test(q) && tool !== 'pivot');
  }


  function secondTargetColumn(schema, question, tool, filters, firstCol) {
    if (tool !== 'pivot') return null;
    const [, second] = pivotTargetColumns(schema, question, filters);
    if (second && second !== firstCol) return second;
    return targetColumnForPhrase(schema, question, question, tool, filters, firstCol ? [firstCol] : []);
  }

  function publicFilters(filters) {
    return filters.map(({ col, value, op, reason, confidence }) => ({ col, value, op, reason, confidence }));
  }

  /* ═══════════════════════ PUBLIC API ═══════════════════════ */

  // Exposée pour PR4.2 (suggestions de questions guidées générées dynamiquement
  // depuis le schéma de colonnes réel, sans dupliquer cette logique de classification).
  window.plannerColumnKind = columnKindSmart;
  // v27.8 — noms abrégés développés (BOURS → boursier, GRP_FORM_ACC → groupe formation accueil)
  window.plannerExpandAbbreviations = expandAbbreviations;
  // v27.8 — noms d'académies et de départements (garde-fou : lieu cité mais non filtré)
  window.plannerGeoNames = [...new Set([...ACADEMIES, ...DEPARTEMENTS])];
  window.plannerColumnKindFromValues = kindFromValues;
  // Rôle accueil / origine, y compris pour les noms abrégés (ACC, SCO, ORIG…)
  window.plannerColumnRole = (col) => columnRole(`${col} ${expandAbbreviations(col)}`);

  window.buildPlannerPlan = function buildPlannerPlan(question, filterContextText, table, forcedTool = null) {
    if (!table || !table.objects || !table.objects.length) return null;
    // Le planner doit travailler sur la question utilisateur, pas sur le
    // contexte textuel/synthèse précédente. Sinon une question courte comme
    // "Combien de boursiers ?" récupère des filtres parasites présents dans
    // les réponses précédentes (ex. Pays Basque = oui, admission = oui).
    const q = nrm(question);
    const tool = forcedTool || detectTool(question);
    if (!tool) return null;

    const schema = buildSchema(table);
    const filters = [];
    const reasons = [];

    // 1. Règles grammaticales sûres et priorisées.
    addExplicitFilters(schema, q, filters, reasons);

    // 2. Résolution générique par valeurs + score de contexte.
    const candidates = bestValueCandidates(schema, q);
    candidates.forEach(c => {
      // v27.8 — valeur citée en entier (« lycée Montaigne ») : retenue même si le nom de colonne ne dit rien
      const valeurEntiere = c.alias === nrm(c.item.value) && c.alias.length >= 8 && c.alias.includes(' ');
      if (c.score < 95 && !valeurEntiere) return;
      // Ne pas ajouter un filtre si une règle sûre de même famille existe déjà.
      if (filters.some(f => f.semanticKey === semanticKey(c.entry))) return;
      // « A eu une proposition » : seulement par la règle dédiée (« accepté une proposition » ne la vise pas)
      if (semanticKey(c.entry) === 'admission_proposition') return;
      // Pour académie/commune/département, exiger un contexte suffisant.
      if (['academie','commune','departement','etablissement'].includes(c.entry.kind) && contextScore(c.entry, q) < 65) return;
      upsertCandidateFilter(filters, c, reasons);
    });

    let targetCol = targetColumn(schema, question, tool, filters);
    let targetCol2 = secondTargetColumn(schema, question, tool, filters, targetCol);
    if (tool === 'pivot') {
      const pair = pivotTargetColumns(schema, question, filters);
      targetCol = pair[0] || targetCol;
      targetCol2 = pair[1] || targetCol2;
    }
    const mentionedCols = schema.columns
      .map(e => ({ col: e.column, score: contextScore(e, q) + columnPriority(e, q) / 4 }))
      .filter(x => x.score > 60)
      .sort((a,b) => b.score - a.score)
      .slice(0, 8)
      .map(x => x.col);

    const avg = filters.length ? filters.reduce((s, f) => s + (f.confidence || 0.75), 0) / filters.length : 0.55;
    const confidence = Math.min(0.99, avg + (targetCol ? 0.03 : 0));

    return {
      tool,
      table,
      filters: publicFilters(filters),
      targetCol,
      targetCol2,
      mentionedCols,
      question,
      // v27.10 — « par X » sans colonne correspondante : le moteur s'arrête et le dit
      // (mot cité tel que l'agent l'a écrit, accents compris : « académie », pas « academie »)
      dimensionIntrouvable: (!targetCol && ['group_by', 'top'].includes(tool)) ? ((String(question || '').match(/(?:^|\s)(?:par|selon)\s+([^?!.,;:]{3,60})/i) || [])[1] || '').trim().toLowerCase() || null : null,
      planner: {
        version: 'v21-memory-charts-export',
        confidence,
        reasons,
        schema: {
          columns: schema.columns.length,
          choiceColumns: schema.columns.filter(c => c.type === 'choice' || c.type === 'boolean').length
        },
        candidates: candidates.slice(0, 12).map(c => ({
          column: c.entry.column,
          value: String(c.item.value),
          op: c.op,
          alias: c.alias,
          score: Math.round(c.score),
          kind: c.entry.kind
        }))
      },
      createdAt: new Date().toISOString()
    };
  };

  window.plannerPlanToDebugHtml = function plannerPlanToDebugHtml(plan) {
    const p = plan?.planner;
    if (!p) return '';
    const reasons = (p.reasons || []).length
      ? `<ul>${p.reasons.map(r => `<li>${safeEscapeHtml(r)}</li>`).join('')}</ul>`
      : '<p>—</p>';
    const candidates = (p.candidates || []).length
      ? `<details style="margin-top:6px"><summary>Candidats évalués</summary><ul>${p.candidates.map(c => `<li>${safeEscapeHtml(c.column)} ${c.op === 'neq' ? '≠' : '='} ${safeEscapeHtml(c.value)} · alias « ${safeEscapeHtml(c.alias)} » · score ${c.score}</li>`).join('')}</ul></details>`
      : '';
    return `<div style="font-size:10px;line-height:1.5;margin-top:6px"><strong>Planner</strong> : ${safeEscapeHtml(p.version)} · confiance ${(p.confidence*100).toFixed(0)} % · schéma ${p.schema?.columns || 0} colonnes<br><strong>Raisons</strong>${reasons}${candidates}</div>`;
  };
})();
