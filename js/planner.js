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
    if (typeof normalizeText === 'function') return normalizeText(String(s ?? ''));
    return String(s ?? '')
      .toLowerCase()
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
    if (/boursier|bourse|bours[eé]/.test(c)) return 'boursier';
    if (/serie.*classe|série.*classe|type.*classe|type.*bac|serie du bac|serie|série/.test(c)) return 'bac_series';
    if (/academie|académie/.test(c)) return 'academie';
    if (/departement|département/.test(c)) return 'departement';
    if (/commune|ville/.test(c)) return 'commune';
    if (/grand.*groupe|groupe.*formation|formation|specialite|spécialité|mention|filiere|filière|diplome|diplôme/.test(c)) return 'formation';
    if (/proposition|favorable|admission|admis|repondu|répondu/.test(c)) return 'admission';
    if (/apprenti|apprentissage/.test(c)) return 'apprentissage';
    if (/voeu|voeux|vœu|vœux/.test(c)) return 'voeu';
    if (/sexe|genre/.test(c)) return 'sexe';
    if (/etablissement|établissement|lycee|lycée|universite|université|iut|cfa/.test(c)) return 'etablissement';
    if (/annee|année|session|campagne/.test(c)) return 'year';
    return 'generic';
  }

  function columnPriority(entry, q = '') {
    const c = nrm(entry.column);
    const k = entry.kind;
    const r = entry.role || {};
    let s = 0;

    const askedAccueil = /(accueil|acceptee|accepte|accept[eé]e|admis|admission|choisi|choisie|formation)/.test(q);
    const askedOrigine = /(origine|scolarite|scolarité|lycee|lycée d origine|commune de scolarite)/.test(q);

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
    if (k === 'admission') return 'admission';
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

  function buildSchema(table) {
    const headers = (table?.headers || Object.keys(table?.objects?.[0] || {}))
      .filter(h => h && !/^(id|manualSort)$/i.test(String(h)));

    const columns = headers.map(col => {
      const vals = valuesFor(table, col, 250);
      const entry = {
        column: col,
        norm: nrm(col),
        kind: columnKind(col),
        role: columnRole(col),
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

    if (entry.kind === 'bac_series') {
      if (/general|generale|s[eé]rie generale/.test(v)) add('général','generale','générale','bac général','bac generale','voie générale','voie generale','serie generale','série générale','bac g');
      if (/professionnel|professionnelle|\bpro\b/.test(v)) add('professionnel','professionnelle','bac pro','bac professionnel','voie professionnelle','serie professionnelle');
      if (/technologique|techno|stmg|sti2d|std2a|stl|st2s|stav|s2tmd/.test(v)) add('technologique','techno','bac techno','bac technologique','voie technologique','serie technologique');
      ['stmg','sti2d','std2a','stl','st2s','stav','s2tmd'].forEach(x => { if (v.includes(x)) add(x); });
    }

    if (entry.kind === 'formation') {
      if (/\bdut\b|diplome universitaire de technologie/.test(v)) add('dut','but','formation dut','formation but','bachelor universitaire de technologie','diplôme universitaire de technologie','diplome universitaire de technologie','iut');
      if (/\bbut\b|bachelor universitaire de technologie/.test(v)) add('but','dut','formation but','formation dut','bachelor universitaire de technologie','iut');
      if (/\bbts\b|brevet de technicien superieur/.test(v)) add('bts','formation bts','brevet de technicien supérieur','brevet de technicien superieur');
      if (/licence|\bl1\b/.test(v)) add('licence','l1','formation licence');
      if (/cpge|classe preparatoire/.test(v)) add('cpge','prépa','prepa','classe préparatoire','classe preparatoire');
    }

    if (entry.kind === 'admission') {
      if (/oui|true|1|vrai/.test(v)) add('admis','admise','admission','accepté','accepte','acceptée','acceptee','réponse favorable','reponse favorable','proposition acceptée','proposition acceptee');
      if (/non|false|0|faux/.test(v)) add('non admis','pas admis','sans proposition acceptée','sans reponse favorable');
    }

    if (entry.kind === 'boursier') {
      if (/oui|true|1|vrai/.test(v)) add('boursier','boursiers','bourse','avec bourse');
      if (/non|false|0|faux/.test(v)) add('non boursier','non boursiers','sans bourse','pas boursier','excluant les boursiers');
    }

    if (entry.kind === 'zone_basque') {
      if (/oui|true|1|vrai/.test(v)) add('pays basque','basque','zone basque','zone du pays basque','candidats basques');
      if (/non|false|0|faux/.test(v)) add('hors pays basque','non basque','hors zone basque');
    }

    if (entry.kind === 'sexe') {
      if (/feminin|femme|fille/.test(v)) add('féminin','feminin','femme','femmes','fille','filles');
      if (/masculin|homme|garcon/.test(v)) add('masculin','homme','hommes','garçon','garcon','garcons');
    }

    return [...a].filter(x => x && x.length >= 2);
  }

  function aliasMatchScore(q, alias) {
    const a = nrm(alias);
    if (!a || a.length < 2) return 0;
    if (q.includes(a)) {
      // bonus aux expressions exactes longues.
      return Math.min(120, 45 + a.length * 2);
    }
    const ats = a.split(/\s+/).filter(t => t.length >= 3 && !STOPWORDS.has(t));
    if (ats.length >= 2 && ats.every(t => q.includes(t))) return 40 + ats.length * 8;
    return 0;
  }

  function contextScore(entry, q) {
    let s = columnPriority(entry, q) / 4;
    const k = entry.kind;
    if (k === 'zone_basque' && /basque|pays basque/.test(q)) s += 100;
    if (k === 'bac_series' && /(bac|serie|série|voie|general|generale|professionnel|technologique|techno|stmg|sti2d|std2a)/.test(q)) s += 95;
    if (k === 'boursier' && /(boursier|boursiers|bourse|crous)/.test(q)) s += 140;
    if (k === 'formation' && /(formation|but|dut|bts|licence|cpge|prepa|iut|filiere|sp[eé]cialit[eé]|mention)/.test(q)) s += 85;
    if (k === 'academie' && /(academie|académie|hors bordeaux|bordeaux|toulouse|poitiers|limoges)/.test(q)) s += 80;
    if (k === 'admission' && /(admis|admission|accept|favorable|proposition acceptee|réponse favorable|reponse favorable)/.test(q)) s += 80;
    if (k === 'apprentissage' && /(apprenti|apprentissage)/.test(q)) s += 80;
    if (k === 'sexe' && /(sexe|homme|femme|masculin|feminin|féminin)/.test(q)) s += 60;
    if (k === 'departement' && /(departement|département|gironde|landes|pyrenees|pyrénées)/.test(q)) s += 60;
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
    if (/(hors|sauf|exclu|excluant|exclure|different|differente|diff[eé]rent|pas|non)\s*$/.test(windowBefore)) return 'neq';
    if (/(hors|sauf|exclu|excluant|exclure|different|differente|pas|non)/.test(windowAround) && entry.kind === 'academie') return 'neq';
    return 'eq';
  }

  function conceptMentioned(entry, q) {
    // Garde-fou important : ne jamais créer un filtre Oui/Non juste parce que
    // une valeur Oui/Non apparaît dans un contexte précédent. La question doit
    // évoquer le concept de la colonne.
    const k = entry.kind;
    if (k === 'zone_basque') return /basque|pays basque|zone basque/.test(q);
    if (k === 'boursier') return /boursier|boursiers|bourse|crous/.test(q);
    if (k === 'admission') return /(admis|admise|admission|accept[eé]|acceptee|réponse favorable|reponse favorable|proposition accept[eé]e|proposition acceptee|a repondu|a répondu)/.test(q);
    if (k === 'apprentissage') return /apprenti|apprentissage|alternance/.test(q);
    if (k === 'bac_series') return /(bac|serie|série|voie|general|generale|professionnel|technologique|techno|stmg|sti2d|std2a|stl|st2s|stav|s2tmd)/.test(q);
    if (k === 'formation') return /(formation|but|dut|bts|licence|cpge|prepa|pr[eé]pa|iut|filiere|filière|sp[eé]cialit[eé]|mention)/.test(q);
    if (k === 'academie') return /academie|académie|bordeaux|toulouse|poitiers|limoges/.test(q);
    if (k === 'departement') return /departement|département|gironde|landes|pyrenees|pyrénées/.test(q);
    if (k === 'commune') return /commune|ville/.test(q);
    if (k === 'sexe') return /sexe|homme|femme|masculin|feminin|féminin|fille|garcon|garçon/.test(q);
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

      const values = entry.kind === 'admission'
        ? (entry.values || []).filter(v => /^(oui|non|yes|no|true|false|0|1|vrai|faux)$/i.test(String(v.value).trim()))
        : (entry.values || []);

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
        if (nrm(item.value) === 'bordeaux' && /(hors|autre|sauf|different|differente|pas).*bordeaux/.test(q) && entry.kind !== 'academie') return;

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
    const bacRegex = /(bac\s+general|bac\s+g[eé]n[eé]ral|voie\s+generale|voie\s+g[eé]n[eé]rale|serie\s+generale|s[eé]rie\s+g[eé]n[eé]rale|bac\s+pro|bac\s+professionnel|professionnel|technologique|bac\s+techno|stmg|sti2d|std2a|stl|st2s|stav|s2tmd)/;
    if (bacRegex.test(q)) {
      const e = bestColumn(schema, x => x.kind === 'bac_series', q);
      if (e) {
        let wanted = [];
        let label = '';
        if (/(general|g[eé]n[eé]ral|generale|g[eé]n[eé]rale)/.test(q)) { wanted = ['generale','générale','bac general','serie generale']; label = 'bac général'; }
        else if (/professionnel|bac\s+pro/.test(q)) { wanted = ['professionnelle','professionnel','bac pro','serie professionnelle']; label = 'bac professionnel'; }
        else if (/technologique|techno/.test(q)) { wanted = ['technologique','bac techno','serie technologique']; label = 'bac technologique'; }
        else {
          const short = ['stmg','sti2d','std2a','stl','st2s','stav','s2tmd'].find(x => q.includes(x));
          if (short) { wanted = [short]; label = short.toUpperCase(); }
        }
        const v = findValue(e, wanted);
        if (v) upsertCandidateFilter(filters, { entry: e, item: v, alias: label, op: 'eq', score: 255 }, reasons);
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
        if (v) upsertCandidateFilter(filters, { entry: e, item: v, alias: label, op: 'eq', score: 248 }, reasons);
      }
    }

    // Hors académie de Bordeaux : colonne Académie d'accueil acceptée, pas commune de scolarité.
    if (/((hors|autre|sauf|different|differente|diff[eé]rente|pas).*academie.*bordeaux)|(academie.*(hors|autre|sauf|different|differente).*bordeaux)|(hors\s+bordeaux)/.test(q)) {
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

    // Accepté / admis / réponse favorable.
    if (/(admis|admise|admission|accept[eé]|acceptee|réponse favorable|reponse favorable|proposition accept[eé]e|proposition acceptee)/.test(q)) {
      // Ne déclencher que si la question parle d'un statut candidat, pas seulement d'une colonne formation d'accueil acceptée.
      const e = bestColumn(schema, x => x.kind === 'admission', q);
      if (e) {
        const v = booleanValue(e, true) || findValue(e, ['oui','true','1']);
        if (v) upsertCandidateFilter(filters, { entry: e, item: v, alias: 'admis / réponse favorable', op: 'eq', score: 235 }, reasons);
      }
    }
  }

  /* ═══════════════════════ TARGET COLUMN / TOOL ═══════════════════════ */

  function detectTool(question) {
    const q = nrm(question);
    if (/export|excel|xlsx|csv|telecharg|t[eé]l[eé]charg|liste|extraire|extrait|sors moi|sort moi/.test(q)) return /\bcsv\b/.test(q) ? 'export_csv' : 'export_excel';
    if (/croise|crois[eé]|tableau croise|pivot/.test(q)) return 'pivot';
    if (/moyen|moyenne|median|m[eé]diane|minimum|maximum|\bmin\b|\bmax\b/.test(q)) return 'stats';
    if (/top|classement|principales?|principaux|plus frequentes?|plus fréquentes?|les plus/.test(q)) return 'top';
    if (/repartition|r[eé]partition|ventilation|par\s+|group[eé]|pourcentage|proportion/.test(q) && !/combien|nombre|effectif/.test(q)) return 'group_by';
    if (/combien|nombre|effectif|compte|compter|total/.test(q)) return 'count_rows';
    return null;
  }


  function targetColumnForPhrase(schema, phrase, wholeQuestion, tool, filters, excludeCols = []) {
    const q = nrm(wholeQuestion || phrase);
    const ph = nrm(phrase || wholeQuestion || '');
    const filtered = new Set((filters || []).map(f => f.col));
    (excludeCols || []).forEach(c => filtered.add(c));
    const phraseTokens = tokens(ph);

    const candidates = schema.columns
      .filter(e => !filtered.has(e.column))
      .map(e => {
        let s = contextScore(e, q) + columnPriority(e, q) / 3;
        const ctoks = tokens(e.column);
        phraseTokens.forEach(t => { if (ctoks.includes(t) || e.norm.includes(t)) s += 28; });

        if (/academie/.test(ph) && e.kind === 'academie') s += e.role.accueil ? 140 : 45;
        if (/serie|bac/.test(ph) && e.kind === 'bac_series') s += 140;
        if (/formation|filiere|specialite|mention|groupe|but|dut|bts|licence|cpge/.test(ph) && e.kind === 'formation') s += 125;
        if (/etablissement|universite|lycee|cfa|iut/.test(ph) && e.kind === 'etablissement') s += e.role.accueil ? 180 : 105;
        if (/etablissement/.test(ph) && e.kind === 'academie') s -= 120;
        if (/departement/.test(ph) && e.kind === 'departement') s += 125;
        if (/commune|ville/.test(ph) && e.kind === 'commune') s += 110;
        if (/voeu|vœu|voeux|vœux/.test(ph) && e.kind === 'voeu') s += 155;
        if (tool === 'stats') {
          if (e.type === 'number') s += 95;
          if (/voeu|vœu|voeux|vœux/.test(ph) && e.kind === 'voeu') s += 170;
          if (/confirm/.test(ph) && /confirm/.test(e.norm)) s += 90;
        }
        return { e, s };
      })
      .filter(x => x.s > 40)
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
      if (/serie|bac/.test(q)) parts.push('série de bac');
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
    const parMatch = q.match(/(?:par|selon|repartition par|répartition par|top\s+\d*\s*(?:des|de)?|principaux|principales)\s+([a-z0-9 ]{3,100})/);
    const phrase = parMatch ? parMatch[1] : q;
    return targetColumnForPhrase(schema, phrase, q, tool, filters, []);
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
      if (c.score < 95) return;
      // Ne pas ajouter un filtre si une règle sûre de même famille existe déjà.
      if (filters.some(f => f.semanticKey === semanticKey(c.entry))) return;
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
      planner: {
        version: 'v20-data-engine-pipeline-fixes',
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
