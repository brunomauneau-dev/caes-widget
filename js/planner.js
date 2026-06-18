/* planner.js — Planner V1.3 pour Parcoursup Data Copilot.
   Rôle : transformer une question en plan d'exécution exploitable par le Data Engine.
   Correctifs V1.3 :
   - traite BUT comme l'ancien libellé DUT quand la table utilise encore DUT ;
   - évite de confondre « accepté » avec un établissement d'accueil accepté ;
   - ajoute la négation « exclure/sans/non boursiers » ;
   - réduit les faux positifs sur les colonnes établissement.
*/

function plannerNorm(s) {
  return normalizeText(String(s ?? ''));
}

function plannerTokens(s) {
  return plannerNorm(s).split(/[^a-z0-9]+/).filter(t => t.length >= 2);
}

const PLANNER_STOPWORDS = new Set('les des du de la le et en avec sans pour dans sur aux une un par au a qui que quoi dont est sont ayant avoir d un d une l'.split(/\s+/));

function plannerColumnKind(col) {
  const n = plannerNorm(col);
  if (/zone.*pays.*basque|pays.*basque/.test(n)) return 'basque_zone';
  if (/s[eé]rie.*classe|serie.*classe|type.*classe|type.*bac|serie/.test(n)) return 'bac_series';
  if (/boursier/.test(n) && !/lycee|lyc[eé]e/.test(n)) return 'boursier';
  if (/acad[eé]mie|academie/.test(n)) return 'academie';
  if (/commune/.test(n)) return 'commune';
  if (/departement|d[eé]partement/.test(n)) return 'departement';
  // Important : un « établissement d'accueil accepté » n'est pas une colonne admission.
  // Les mots accueil/accepté y décrivent le résultat final, mais les valeurs sont des établissements.
  if (/[eé]tablissement|etablissement|lyc[eé]e|lycee|universit[eé]|iut|cfa/.test(n)) return 'etablissement';
  if (/formation|specialite|sp[eé]cialit[eé]|mention|groupe|fili[eè]re|dipl[oô]me/.test(n)) return 'formation';
  if (/proposition|favorable|admission/.test(n)) return 'admission';
  if (/apprenti|apprentissage/.test(n)) return 'apprentissage';
  if (/voeu|vœu|voeux|vœux/.test(n)) return 'voeu';
  if (/sexe/.test(n)) return 'sexe';
  return 'generic';
}

function plannerColumnRole(col) {
  const n = plannerNorm(col);
  return {
    accueil: /accueil|acceptee|accept[eé]e|affectation/.test(n),
    scolarite: /scolarite|origine|lycee|établissement d'origine|etablissement d origine/.test(n),
    etablissement: /etablissement|[eé]tablissement/.test(n)
  };
}


function plannerColumnPriority(entry, qNorm = '') {
  const col = plannerNorm(entry?.column || '');
  const kind = entry?.kind || 'generic';
  let score = 0;

  // Priorités métier génériques : elles servent à choisir UNE colonne de référence
  // quand plusieurs colonnes portent une information proche.
  if (kind === 'basque_zone') score += 100;
  if (kind === 'bac_series') {
    score += 60;
    if (/s[eé]rie.*classe|serie.*classe/.test(col)) score += 80;
    if (/type.*classe|type.*bac/.test(col)) score += 20;
    if (/s[eé]rie/.test(col) && !/type/.test(col)) score += 30;
  }
  if (kind === 'academie') {
    score += 50;
    if (entry.role?.accueil) score += 70;
    if (/accept|acceptee|accept[eé]e|accueil|affectation/.test(col)) score += 40;
    if (entry.role?.scolarite) score -= 70;
  }
  if (kind === 'formation') {
    score += 45;
    if (entry.role?.accueil) score += 60;
    if (/accept|acceptee|accept[eé]e|accueil|affectation/.test(col)) score += 35;
    if (/grands? groupes?/.test(col)) score += 30;
    if (entry.role?.scolarite) score -= 50;
  }
  if (kind === 'etablissement') {
    score += 25;
    if (entry.role?.accueil) score += 35;
    // Moins prioritaire qu'une colonne formation quand la question dit formation/BUT/BTS/licence.
    if (/formation|but|dut|bts|licence|cpge/.test(qNorm)) score -= 45;
  }
  if (kind === 'admission') {
    score += 50;
    if (/r[eé]pondu favorablement|favorable|accept/.test(col)) score += 55;
    if (/a eu.*proposition|re[cç]u.*proposition/.test(col)) score += 20;
  }
  if (kind === 'boursier') score += 50;
  if (kind === 'departement') score += 45;
  if (kind === 'commune') score += 35;
  if (kind === 'apprentissage') score += 40;
  if (kind === 'sexe') score += 35;

  // Contexte question : une formation choisie doit pointer vers les colonnes d'accueil acceptées.
  if (/(choisi|choisie|accept[eé]|acceptee|accueil|admis|admission|formation)/.test(qNorm)) {
    if (entry.role?.accueil) score += 25;
    if (entry.role?.scolarite) score -= 35;
  }
  return score;
}

function plannerSemanticKey(entry) {
  const kind = entry?.kind || 'generic';
  // Ces familles ne doivent produire qu'un seul filtre à la fois, sauf demande explicite plus tard.
  if (['basque_zone','bac_series','boursier','apprentissage','sexe'].includes(kind)) return kind;
  // Pour l'académie, on distingue accueil vs scolarité, mais on évite deux filtres sur l'accueil.
  if (kind === 'academie') return entry.role?.accueil ? 'academie_accueil' : (entry.role?.scolarite ? 'academie_scolarite' : 'academie');
  if (kind === 'formation') return entry.role?.accueil ? 'formation_accueil' : 'formation';
  if (kind === 'etablissement') return entry.role?.accueil ? 'etablissement_accueil' : 'etablissement';
  if (kind === 'admission') return 'admission';
  return `${kind}:${entry?.column || ''}`;
}

function plannerEntryForColumn(catalog, col) {
  return catalog.find(e => e.column === col) || { column: col, kind: plannerColumnKind(col), role: plannerColumnRole(col) };
}

function hasSemanticFilter(filters, catalog, entry) {
  const key = plannerSemanticKey(entry);
  return filters.some(f => plannerSemanticKey(plannerEntryForColumn(catalog, f.col)) === key);
}

function addPlannerFilterSmart(filters, catalog, entry, value, reason, confidence = 0.8, op = 'eq', qNorm = '') {
  if (!entry || !entry.column) return;
  if (value === undefined || value === null || String(value).trim() === '') return;

  const newKey = plannerSemanticKey(entry);
  const newPriority = plannerColumnPriority(entry, qNorm);
  const existingIndex = filters.findIndex(f => plannerSemanticKey(plannerEntryForColumn(catalog, f.col)) === newKey && f.op === op);

  if (existingIndex >= 0) {
    const oldEntry = plannerEntryForColumn(catalog, filters[existingIndex].col);
    const oldPriority = plannerColumnPriority(oldEntry, qNorm);
    // Remplacer uniquement si la nouvelle colonne est clairement meilleure.
    if (newPriority > oldPriority + 10) {
      filters[existingIndex] = { col: entry.column, value: String(value).trim(), op, reason, confidence };
    }
    return;
  }

  filters.push({ col: entry.column, value: String(value).trim(), op, reason, confidence });
}

function plannerValues(table, col, max = 400) {
  if (typeof uniqueValues === 'function') return uniqueValues(table, col, max);
  const counts = new Map();
  (table.objects || []).forEach(r => {
    const v = r[col];
    if (v === undefined || v === null || String(v).trim() === '') return;
    const k = String(v).trim();
    counts.set(k, (counts.get(k) || 0) + 1);
  });
  return [...counts.entries()].sort((a,b) => b[1] - a[1]).slice(0, max).map(([value, count]) => ({ value, count }));
}

function buildPlannerCatalog(table) {
  const headers = (table?.headers || Object.keys(table?.objects?.[0] || {})).filter(h => h && !/^(id|manualSort)$/i.test(String(h)));
  return headers.map(col => {
    const values = plannerValues(table, col, 100);
    const filled = values.reduce((s, x) => s + (x.count || 0), 0);
    return { column: col, kind: plannerColumnKind(col), role: plannerColumnRole(col), values, filled, distinctShown: values.length };
  });
}

function plannerValueAliases(col, value) {
  const kind = plannerColumnKind(col);
  const raw = String(value ?? '').trim();
  const n = plannerNorm(raw);
  const aliases = new Set([n]);

  if (kind === 'bac_series') {
    if (/^s[eé]rie\s+g[eé]n[eé]rale$|^g[eé]n[eé]rale?$|general|generale/.test(n)) {
      ['general','generale','bac general','bac generale','serie generale','voie generale','filiere generale','bac g','serie g'].forEach(a => aliases.add(plannerNorm(a)));
    }
    if (/professionnel|professionnelle|\bpro\b/.test(n)) {
      ['professionnel','professionnelle','bac pro','bac professionnel','bac professionnelle','serie professionnelle','voie professionnelle'].forEach(a => aliases.add(plannerNorm(a)));
    }
    if (/technologique|techno|stmg|sti2d|std2a|stl|st2s|stav|s2tmd/.test(n)) {
      ['technologique','techno','bac techno','bac technologique','serie technologique','voie technologique'].forEach(a => aliases.add(plannerNorm(a)));
    }
    ['stmg','sti2d','std2a','stl','st2s','stav','s2tmd'].forEach(x => { if (n.includes(x)) aliases.add(x); });
  }

  if (kind === 'formation') {
    // Dans certains exports Parcoursup, l'ancien libellé DUT est encore utilisé
    // alors que l'utilisateur parle spontanément de BUT.
    if (/dut|dipl[oô]me universitaire de technologie/.test(n)) {
      ['dut','but','formation but','bachelor universitaire de technologie','diplome universitaire de technologie','iut'].forEach(a => aliases.add(plannerNorm(a)));
    }
    if (/but|bachelor universitaire de technologie/.test(n)) {
      ['but','formation but','dut','diplome universitaire de technologie','iut'].forEach(a => aliases.add(plannerNorm(a)));
    }
    if (/bts|brevet de technicien sup[eé]rieur/.test(n)) {
      ['bts','formation bts','brevet de technicien superieur'].forEach(a => aliases.add(plannerNorm(a)));
    }
    if (/licence|l1/.test(n)) ['licence','l1','formation licence'].forEach(a => aliases.add(plannerNorm(a)));
    if (/cpge|classe pr[eé]paratoire/.test(n)) ['cpge','prepa','prépa','classe preparatoire'].forEach(a => aliases.add(plannerNorm(a)));
  }

  if (kind === 'sexe') {
    if (/f[eé]minin|femme|fille/.test(n)) ['feminin','femme','femmes','fille','filles'].forEach(a => aliases.add(plannerNorm(a)));
    if (/masculin|homme|garcon/.test(n)) ['masculin','homme','hommes','garcon','garcons'].forEach(a => aliases.add(plannerNorm(a)));
  }

  if (kind === 'admission') {
    if (/oui|true|1|vrai/.test(n)) ['admis','admission','accepté','accepte','acceptée','acceptee','réponse favorable','reponse favorable','proposition acceptee','ayant accepté','ayant accepte'].forEach(a => aliases.add(plannerNorm(a)));
    if (/non|false|0|faux/.test(n)) ['non admis','sans admission','pas accepte','pas acceptée','pas de proposition acceptee'].forEach(a => aliases.add(plannerNorm(a)));
  }

  if (kind === 'boursier') {
    if (/oui|true|1|vrai/.test(n)) ['boursier','boursiers','bourse','avec bourse'].forEach(a => aliases.add(plannerNorm(a)));
    if (/non|false|0|faux/.test(n)) ['non boursier','non boursiers','sans bourse'].forEach(a => aliases.add(plannerNorm(a)));
  }

  if (kind === 'apprentissage') {
    if (/oui|true|1|vrai/.test(n)) ['apprenti','apprentis','apprentissage','en apprentissage'].forEach(a => aliases.add(plannerNorm(a)));
    if (/non|false|0|faux/.test(n)) ['non apprenti','hors apprentissage','pas apprenti'].forEach(a => aliases.add(plannerNorm(a)));
  }

  if (kind === 'basque_zone') {
    if (/oui|true|1|vrai/.test(n)) ['basque','pays basque','zone basque','zone du pays basque','candidats basques'].forEach(a => aliases.add(plannerNorm(a)));
    if (/non|false|0|faux/.test(n)) ['hors pays basque','non basque','hors zone basque'].forEach(a => aliases.add(plannerNorm(a)));
  }

  // Alias réduit uniquement pour valeurs longues et spécifiques.
  const toks = plannerTokens(raw).filter(t => !PLANNER_STOPWORDS.has(t));
  if (toks.length >= 2 && toks.length <= 8) aliases.add(toks.join(' '));
  return [...aliases].filter(Boolean);
}

function plannerQuestionContainsAlias(qNorm, alias) {
  const a = plannerNorm(alias);
  if (!a || a.length < 2) return false;

  // Pour les alias négatifs (hors/non/sans/pas), ne pas utiliser le matching par tokens,
  // sinon "hors académie de Bordeaux" + "Pays Basque" déclenche à tort "hors pays basque".
  if (/^(hors|non|sans|pas)\b/.test(a)) return qNorm.includes(a);

  if (qNorm.includes(a)) return true;
  const toks = a.split(/\s+/).filter(t => t.length >= 3 && !PLANNER_STOPWORDS.has(t));
  // Matching approximatif réservé aux alias longs non ambigus.
  return toks.length >= 3 && toks.every(t => qNorm.includes(t));
}

function plannerColumnContextScore(entry, qNorm) {
  const colNorm = plannerNorm(entry.column);
  const kind = entry.kind;
  let score = 0;
  if (qNorm.includes(colNorm)) score += 100;
  const colToks = colNorm.split(/\s+/).filter(t => t.length >= 4 && !PLANNER_STOPWORDS.has(t));
  colToks.forEach(t => { if (qNorm.includes(t)) score += 6; });

  if (kind === 'basque_zone' && /basque|pays basque/.test(qNorm)) score += 80;
  if (kind === 'bac_series' && /(bac|s[eé]rie|serie|voie|g[eé]n[eé]ral|general|technologique|professionnel|stmg|sti2d|std2a)/.test(qNorm)) score += 70;
  if (kind === 'boursier' && /boursier|bourse/.test(qNorm)) score += 70;
  if (kind === 'apprentissage' && /apprenti|apprentissage/.test(qNorm)) score += 70;
  if (kind === 'admission' && /admis|admission|accept|favorable|proposition/.test(qNorm)) score += 60;
  if (kind === 'academie' && /acad[eé]mie|academie/.test(qNorm)) score += 70;
  if (kind === 'departement' && /d[eé]partement|departement/.test(qNorm)) score += 60;
  if (kind === 'commune' && /commune|ville/.test(qNorm)) score += 50;
  if (kind === 'formation' && /formation|fili[eè]re|sp[eé]cialit[eé]|mention|bts|but|dut|licence|cpge|l1|iut/.test(qNorm)) score += 55;
  if (kind === 'etablissement' && /[eé]tablissement|etablissement|lyc[eé]e|lycee|universit[eé]|iut/.test(qNorm)) score += 35;

  // Lorsqu'on parle de "formation choisie/acceptée", préférer les colonnes d'accueil acceptées.
  if (entry.role.accueil && /(formation|choisi|choisie|accept[eé]|acceptee|admis|admission|accueil|affectation)/.test(qNorm)) score += 20;
  if (entry.role.scolarite && /(formation|choisi|choisie|accept[eé]|acceptee|accueil|affectation)/.test(qNorm)) score -= 30;
  return score;
}

function addPlannerFilter(filters, col, value, reason, confidence = 0.8, op = 'eq') {
  if (!col || value === undefined || value === null || String(value).trim() === '') return;
  if (filters.some(f => f.col === col && f.op === op)) return;
  filters.push({ col, value: String(value).trim(), op, reason, confidence });
}

function detectPlannerTool(question) {
  const q = plannerNorm(question);
  if (/export|excel|xlsx|csv|telecharg|t[eé]l[eé]charg|extraire|extrait|liste|sors|sortir/.test(q)) {
    return /\bcsv\b/.test(q) ? 'export_csv' : 'export_excel';
  }
  if (/croise|crois[eé]|tableau croise|pivot|croisement/.test(q)) return 'pivot';
  if (/repartition|r[eé]partition|ventilation|par\s+[a-z]|groupe|group[eé]|top|classement|pourcentage|proportion/.test(q)) return 'group_by';
  if (/combien|nombre|effectif|compte|compter|total/.test(q)) return 'count_rows';
  return null;
}

function findPlannerValue(entry, wantedNorm) {
  const vals = entry.values || [];
  return vals.find(x => plannerNorm(x.value) === wantedNorm) ||
         vals.find(x => plannerNorm(x.value).includes(wantedNorm) || wantedNorm.includes(plannerNorm(x.value))) ||
         null;
}

function findPlannerValueByAliases(entry, aliases) {
  const wanted = (aliases || []).map(a => plannerNorm(a)).filter(Boolean);
  const vals = entry?.values || [];
  for (const w of wanted) {
    const exact = vals.find(x => plannerNorm(x.value) === w);
    if (exact) return exact;
  }
  for (const item of vals) {
    const itemAliases = plannerValueAliases(entry.column, item.value);
    if (itemAliases.some(a => wanted.includes(plannerNorm(a)))) return item;
  }
  for (const w of wanted) {
    const loose = vals.find(x => {
      const n = plannerNorm(x.value);
      return n.includes(w) || w.includes(n);
    });
    if (loose) return loose;
  }
  return null;
}

function bestCatalogEntry(catalog, predicate, qNorm, extraScore = () => 0) {
  const scored = catalog.filter(predicate).map(e => ({ e, score: plannerColumnContextScore(e, qNorm) + extraScore(e) }));
  scored.sort((a,b) => b.score - a.score);
  return scored[0]?.e || null;
}

function addSpecialPlannerFilters(catalog, qNorm, filters, reasons) {
  // Zone Pays Basque : positif sauf si l'expression négative exacte apparaît.
  if (/basque|pays basque/.test(qNorm)) {
    const entry = catalog.find(e => e.kind === 'basque_zone');
    if (entry) {
      const isNegative = /hors pays basque|hors zone basque|non basque/.test(qNorm);
      const wanted = isNegative ? 'non' : 'oui';
      const hit = findPlannerValue(entry, wanted) || entry.values.find(x => /^(oui|non|yes|no|true|false|1|0)$/i.test(String(x.value)));
      if (hit) {
        addPlannerFilterSmart(filters, catalog, entry, hit.value, isNegative ? 'zone basque explicitement négative' : 'zone Pays Basque demandée', 0.97, 'eq', qNorm);
        reasons.push(`${isNegative ? '« hors/non basque »' : '« Pays Basque »'} ⇒ ${entry.column} = ${hit.value}`);
      }
    }
  }

  // Bac général / techno / pro.
  const bacEntry = bestCatalogEntry(catalog, e => e.kind === 'bac_series', qNorm, e => plannerColumnPriority(e, qNorm));
  if (bacEntry && /(bac|s[eé]rie|serie|voie|g[eé]n[eé]ral|general|technologique|professionnel|\bpro\b|stmg|sti2d|std2a)/.test(qNorm)) {
    let wanted = null;
    if (/bac\s+g[eé]n[eé]ral|bac\s+general|voie\s+g[eé]n[eé]rale|s[eé]rie\s+g[eé]n[eé]rale|\bg[eé]n[eé]ral(e)?\b/.test(qNorm)) wanted = 'generale';
    else if (/bac\s+pro|bac\s+professionnel|voie\s+professionnelle|s[eé]rie\s+professionnelle|\bprofessionnel(le)?\b/.test(qNorm)) wanted = 'professionnelle';
    else if (/bac\s+techno|bac\s+technologique|voie\s+technologique|s[eé]rie\s+technologique|\btechnologique\b/.test(qNorm)) wanted = 'technologique';
    else {
      const short = ['stmg','sti2d','std2a','stl','st2s','stav','s2tmd'].find(x => qNorm.includes(x));
      if (short) wanted = short;
    }
    if (wanted) {
      const hit = findPlannerValue(bacEntry, wanted);
      if (hit) {
        addPlannerFilterSmart(filters, catalog, bacEntry, hit.value, `série/type de bac détecté : ${wanted}`, 0.97, 'eq', qNorm);
        reasons.push(`« ${wanted} » ⇒ ${bacEntry.column} = ${hit.value}`);
      }
    }
  }

  // Boursiers : gérer la négation explicitement avant le matching par alias.
  if (/boursier|boursiers|bourse/.test(qNorm)) {
    const entry = bestCatalogEntry(catalog, e => e.kind === 'boursier', qNorm, e => plannerColumnPriority(e, qNorm));
    if (entry) {
      const negative = /(exclu|exclure|excluant|hors|sans|non|pas).{0,25}(boursier|boursiers|bourse)|(boursier|boursiers).{0,20}(exclu|exclus|exclure|hors|non)/.test(qNorm);
      const hit = findPlannerValue(entry, negative ? 'non' : 'oui') || findPlannerValue(entry, negative ? 'false' : 'true');
      if (hit) {
        addPlannerFilterSmart(filters, catalog, entry, hit.value, negative ? 'boursiers exclus' : 'boursiers demandés', 0.96, 'eq', qNorm);
        reasons.push(`${negative ? '« excluant/sans les boursiers »' : '« boursiers »'} ⇒ ${entry.column} = ${hit.value}`);
      }
    }
  }

  // Type de formation : BUT est traduit en DUT si l'export utilise encore l'ancien libellé.
  if (/but|dut|bts|licence|l1|cpge|prepa|pr[eé]pa|iut/.test(qNorm)) {
    const entry = bestCatalogEntry(
      catalog,
      e => e.kind === 'formation',
      qNorm,
      e => (e.role.accueil ? 90 : 0) + (/grands? groupes?|formation.*accueil|sp[eé]cialit[eé].*accueil|mention.*accueil/.test(plannerNorm(e.column)) ? 60 : 0) - (e.role.scolarite ? 80 : 0)
    );
    if (entry) {
      let wantedAliases = [];
      if (/but/.test(qNorm)) wantedAliases = ['but', 'dut', 'formation but', 'diplome universitaire de technologie', 'bachelor universitaire de technologie', 'iut'];
      else if (/dut/.test(qNorm)) wantedAliases = ['dut', 'but', 'diplome universitaire de technologie', 'iut'];
      else if (/bts/.test(qNorm)) wantedAliases = ['bts', 'brevet de technicien superieur'];
      else if (/licence|l1/.test(qNorm)) wantedAliases = ['licence', 'l1'];
      else if (/cpge|prepa|pr[eé]pa/.test(qNorm)) wantedAliases = ['cpge', 'prepa', 'classe preparatoire'];
      const hit = findPlannerValueByAliases(entry, wantedAliases);
      if (hit) {
        const label = /but/.test(qNorm) ? 'BUT/DUT' : wantedAliases[0];
        addPlannerFilterSmart(filters, catalog, entry, hit.value, `type de formation détecté : ${label}`, 0.96, 'eq', qNorm);
        reasons.push(`« ${label} » ⇒ ${entry.column} = ${hit.value}`);
      }
    }
  }

  // Hors académie de Bordeaux : choisir une colonne Académie d'accueil/acceptée, pas commune ni scolarité.
  if (/(hors|autre|sauf|different|differente|diff[eé]rente|pas).*acad[eé]mie.*bordeaux|acad[eé]mie.*(hors|autre|sauf|different|differente).*bordeaux|hors\s+bordeaux/.test(qNorm)) {
    const entry = bestCatalogEntry(
      catalog,
      e => e.kind === 'academie',
      qNorm,
      e => (e.role.accueil ? 80 : 0) + (/accept|acceptee|accueil/.test(plannerNorm(e.column)) ? 30 : 0) - (e.role.scolarite ? 80 : 0)
    );
    if (entry) {
      const bdx = findPlannerValue(entry, 'bordeaux');
      if (bdx) {
        addPlannerFilterSmart(filters, catalog, entry, bdx.value, 'hors académie de Bordeaux', 0.98, 'neq', qNorm);
        reasons.push(`« hors académie de Bordeaux » ⇒ ${entry.column} ≠ ${bdx.value}`);
      }
    }
  }
}

function detectPlannerTargetColumn(table, question, tool, filters) {
  const headers = (table?.headers || Object.keys(table?.objects?.[0] || {})).filter(Boolean);
  const q = plannerNorm(question);
  if (tool !== 'group_by' && tool !== 'pivot') return null;

  const mentioned = typeof findMentionedColumns === 'function' ? findMentionedColumns(headers, question, 5) : [];
  const filteredCols = new Set((filters || []).map(f => f.col));
  const candidate = mentioned.find(c => !filteredCols.has(c));
  if (candidate) return candidate;

  if (typeof detectTargetColumn === 'function') return detectTargetColumn(headers, q);
  return null;
}

function buildPlannerPlan(question, filterContextText, table, forcedTool = null) {
  if (!table || !table.objects || !table.objects.length) return null;
  const qNorm = plannerNorm(filterContextText || question);
  const headers = (table.headers || Object.keys(table.objects[0] || {})).filter(h => h && !/^(id|manualSort)$/i.test(String(h)));
  const tool = forcedTool || detectPlannerTool(question);
  if (!tool) return null;

  const catalog = buildPlannerCatalog(table).sort((a,b) => plannerColumnPriority(b, qNorm) - plannerColumnPriority(a, qNorm));
  const filters = [];
  const reasons = [];

  // 1) Filtres métier/grammaticaux prioritaires.
  addSpecialPlannerFilters(catalog, qNorm, filters, reasons);

  // 2) Détection par alias structurés, uniquement si la colonne est pertinente dans la question.
  catalog.forEach(entry => {
    if (filters.some(f => f.col === entry.column)) return;
    if (hasSemanticFilter(filters, catalog, entry)) return;
    const contextScore = plannerColumnContextScore(entry, qNorm) + plannerColumnPriority(entry, qNorm) / 5;
    // Les colonnes génériques ne sont jamais filtrées par simple valeur mentionnée.
    if (entry.kind === 'generic' && contextScore < 80) return;
    // Pour académie/commune/département/établissement, exiger que le type de colonne soit mentionné.
    if (['academie','commune','departement'].includes(entry.kind) && contextScore < 55) return;
    if (entry.kind === 'etablissement' && contextScore < 85) return;

    let values = entry.values || [];
    // Une colonne admission doit être binaire ou quasi-binaire. Cela évite de filtrer
    // un établissement parce que le nom de colonne contient « accepté ».
    if (entry.kind === 'admission') {
      values = values.filter(x => /^(oui|non|yes|no|true|false|1|0)$/i.test(String(x.value).trim()));
      if (!values.length) return;
    }
    for (const item of values) {
      const aliases = plannerValueAliases(entry.column, item.value);
      const hit = aliases.find(a => plannerQuestionContainsAlias(qNorm, a));
      if (hit) {
        // Ne pas ajouter Bordeaux comme filtre positif si la demande dit "hors académie de Bordeaux".
        if (plannerNorm(item.value) === 'bordeaux' && /(hors|autre|sauf|different|differente|pas).*bordeaux/.test(qNorm)) continue;
        addPlannerFilterSmart(filters, catalog, entry, item.value, `alias détecté : « ${hit} »`, Math.min(0.94, 0.65 + contextScore / 300), 'eq', qNorm);
        reasons.push(`« ${hit} » ⇒ ${entry.column} = ${item.value}`);
        break;
      }
    }
  });

  // 3) Fallback historique uniquement si le nouveau planner n'a rien trouvé.
  if (!filters.length && typeof detectFilters === 'function') {
    const legacy = detectFilters(table, qNorm, null) || [];
    legacy.forEach(f => {
      addPlannerFilterSmart(filters, catalog, plannerEntryForColumn(catalog, f.col), f.value, f.reason || 'détection historique', 0.68, f.op || 'eq', qNorm);
      reasons.push(`${f.reason || 'détection historique'} ⇒ ${f.col} ${f.op === 'neq' ? '≠' : '='} ${f.value}`);
    });
  }

  const targetCol = detectPlannerTargetColumn(table, question, tool, filters);
  const mentionedCols = typeof findMentionedColumns === 'function' ? findMentionedColumns(headers, question, 6) : [];
  const avgConf = filters.length ? filters.reduce((s, f) => s + (f.confidence || 0.75), 0) / filters.length : 0.55;
  const confidence = Math.min(0.99, avgConf + (targetCol ? 0.03 : 0));

  return {
    tool,
    table,
    filters,
    targetCol,
    mentionedCols,
    question,
    planner: {
      version: 'v17-planner-v1.3',
      confidence,
      reasons,
      catalogColumns: catalog.length
    },
    createdAt: new Date().toISOString()
  };
}

function plannerPlanToDebugHtml(plan) {
  const p = plan?.planner;
  if (!p) return '';
  const reasons = (p.reasons || []).length
    ? `<ul>${p.reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`
    : '<p>—</p>';
  return `<div style="font-size:10px;line-height:1.5;margin-top:6px"><strong>Planner</strong> : ${escapeHtml(p.version)} · confiance ${(p.confidence*100).toFixed(0)} %<br><strong>Raisons</strong>${reasons}</div>`;
}
