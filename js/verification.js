/* verification.js — Étape 2 de fiabilité : double lecture de la question par Albert (mode prudent).
   Le moteur répond tout de suite, comme avant. En parallèle, un modèle Albert rapide relit la question et propose
   sa lecture (opération, objet, filtres, regroupement), sans rien calculer. En cas de DÉSACCORD IMPORTANT avec le
   moteur (autre chose compté, critère / lieu / exclusion oublié, liste au lieu d'export…), une ligne d'avertissement
   s'ajoute sous la réponse et l'alerte est notée dans « À revoir ». Sinon : rien ne s'affiche.
   Mesuré avant activation (scripts/essai_double_lecture.mjs, essai réel, Mistral Small 24B) : 0 fausse alerte sur
   92 lectures justes puis sur 37 lectures de questions nouvelles ; 71 à 73 % des contresens de l'ancien moteur
   signalés ; délai médian 1,5 à 2 s. Albert indisponible ou lent : rien ne s'affiche, le widget marche comme avant.
   La même logique sert à l'essai (chargée dans un contexte isolé) : ce qui a été mesuré est ce qui tourne ici. */

const VERIF_MODELE = 'mistral-small-3-2-24b-instruct-2506';
const VERIF_DELAI_MAX_MS = 9000;
const _nrmVerif = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/œ/g, 'oe').toLowerCase().replace(/[^a-z0-9%<>=.]+/g, ' ').trim();
function familleVerif(col) {
  const c = _nrmVerif(col);
  if (!c) return '';
  const role = /accueil|accepte|affect/.test(c) ? ':acc' : /scolarite|origine/.test(c) ? ':ori' : '';
  if (/enseignement.*specialite|specialites? suivi/.test(c)) return 'specialite_lycee';
  if (/pays basque|basque/.test(c)) return 'basque';
  if (/boursier/.test(c) && !/effectif|%|taux|dont/.test(c)) return 'boursier';
  if (/apprenti/.test(c)) return 'apprenti';
  if (/a eu une proposition/.test(c)) return 'proposition';
  if (/repondu|favorabl/.test(c)) return 'admission';
  if (/^statut|^type de contrat|public|prive/.test(c)) return 'statut';
  if (/selectiv/.test(c)) return 'selectivite';
  if (/serie|type de la classe|^bac\b/.test(c)) return 'serie';
  if (/taux d acces/.test(c)) return 'taux_acces';
  if (/capacit|places?$/.test(c)) return 'capacite';
  if (/voeux/.test(c)) return 'voeux';
  if (/^academie|academie/.test(c) && !/admis issus/.test(c)) return 'academie' + role;
  if (/departement/.test(c)) return 'departement' + (role === ':acc' ? ':acc' : '');
  if (/commune|ville/.test(c)) return 'commune' + role;
  if (/region/.test(c)) return 'region';
  if (/^etablissement|^lycee|^universite|etablissement d accueil|etablissement de la scolarite/.test(c)) return 'etablissement' + role;
  if (/filiere|formation|specialite|mention|intitule|groupe|diplome/.test(c)) return 'formation';
  return c;
}
// fichier de candidats : département et commune « d'origine » quand le rôle n'est pas précisé
const famillesEgalesVerif = (a, b) => a === b || a.replace(/:ori$/, '') === b.replace(/:ori$/, '');

function lectureMoteurVerif(exec) {
  if (!exec) return { op: 'albert', filtres: {}, exclus: {} };
  const p = exec.plan || {};
  const k = exec.kind;
  const op = k === 'count' ? (p.compterEtablissements || p.compterValeurs ? 'compter_distinct' : 'compter')
    : k === 'sum' ? 'somme' : (k === 'stats' || k === 'stats_groupes') ? 'statistique'
    : k === 'group_by' ? ((p.lesquelles || p.listMode) ? 'liste' : (exec.result?.somme ? 'somme' : 'repartition'))
    : (k === 'top' || k === 'classement') ? 'classement' : (k === 'part' || k === 'part_groupes') ? 'part'
    : k === 'compare' ? 'comparaison' : k === 'export' ? 'export' : k === 'pdf' ? 'pdf' : k === 'unresolved' ? 'arret'
    : (k === 'evolution' || k === 'evolution_groupes') ? 'evolution' : k === 'pivot' ? 'tableau_croise' : String(k);
  const objet = p.compterEtablissements ? 'etablissements' : p.compterValeurs ? _nrmVerif(p.compterValeurs.nom).replace(/s$/, '') + 's'
    : (op === 'liste' && /^(etablissement|lycee|universite)/.test(_nrmVerif(p.targetCol))) ? 'etablissements' : null;
  const groupeCol = p.part?.groupe || p.classement?.entite?.col || (['repartition', 'classement', 'statistique', 'somme'].includes(op) ? (p.targetCol && op !== 'statistique' ? p.targetCol : (exec.result?.dim || null)) : null);
  const filtres = {}, exclus = {};
  const ajoute = (cible, fam, vals) => { if (!fam) return; (cible[fam] = cible[fam] || []).push(vals.map(_nrmVerif).filter(Boolean)); };
  (p.filters || []).forEach(f => {
    if (!f) return;
    if (f.op === 'contains_all') (f.terms || []).forEach(t => ajoute(filtres, 'formation', [].concat(t)));
    else if (f.op === 'or') { const g = (f.groupes || []).flat(); const fam = familleVerif(g[0]?.col || f.col); filtres[fam] = filtres[fam] || []; (f.groupes || []).forEach(gr => filtres[fam].push(gr.flatMap(x => x.op === 'contains_all' ? (x.terms || []).flat() : [x.value, ...(x.values || [])]).map(_nrmVerif))); }
    else if (f.op === 'neq') ajoute(exclus, familleVerif(f.col), [f.value]);
    else if (f.op === 'contains_words') ajoute(filtres, familleVerif(f.col), [f.value, ...(f.terms || []).flat()]);
    else ajoute(filtres, familleVerif(f.col), [f.value, f.label, ...(f.values || [])].filter(Boolean));
  });
  return { op, objet, groupe: groupeCol ? familleVerif(groupeCol) : null, filtres, exclus };
}

// Alerte = désaccord IMPORTANT entre Albert et le moteur (ce qui serait montré à l'agent). Pas d'alerte quand le
// moteur en dit plus (« admis en BTS » : il ajoute « a accepté » ; « lycées » : nom contenant lycée), ni pour la
// condition d'une part ou le critère d'un classement (Albert les range parfois parmi les filtres).
const GEO_VERIF = /^(commune|departement|academie|region|etablissement)/;
const _equivVerif = f => ({ specialite_lycee: 'formation' }[f.replace(/:(ori|acc)$/, '')] || f.replace(/:ori$/, ''));
const _opsProchesVerif = (a, m) => a === m
  || (a === 'liste' && m === 'repartition') || (a === 'repartition' && m === 'liste')
  || (a === 'somme' && m === 'repartition') || (a === 'repartition' && m === 'somme')
  || (a === 'repartition' && m === 'classement') || (a === 'classement' && m === 'repartition')
  || (a === 'compter_distinct' && m === 'repartition'); // « quelles académies… » : la répartition les nomme et les compte
function desaccordVerif(a, m) {
  if (!a || !m) return 'lecture manquante';
  if (['arret', 'albert', 'erreur'].includes(m.op)) return null; // pas de chiffre donné : rien à signaler
  // le moteur détaille davantage (répartition, taux par groupe) quand Albert ne voit qu'un total : pas d'alerte
  const moteurDetaille = m.groupe && !a.groupe && ['compter', 'somme', 'statistique', 'part'].includes(a.op);
  // « compter, regroupé par académie » (Albert) = répartition par académie (moteur)
  const memeRegroupement = a.groupe && m.groupe && famillesEgalesVerif(_equivVerif(a.groupe), _equivVerif(m.groupe)) && ['compter', 'somme', 'repartition', 'classement', 'liste'].includes(a.op) && ['repartition', 'somme', 'classement', 'liste'].includes(m.op);
  if (memeRegroupement && !Object.keys(a.filtres || {}).map(_equivVerif).some(f => !Object.keys(m.filtres || {}).map(_equivVerif).includes(f) && f !== _equivVerif(m.groupe) && f !== 'admission')) return null;
  if (!_opsProchesVerif(a.op, m.op) && !moteurDetaille) return `opération : Albert ${a.op}, moteur ${m.op}`;
  if (a.op === 'compter_distinct' && m.op === 'compter_distinct' && a.objet && m.objet && _nrmVerif(a.objet).replace(/s$/, '') !== _nrmVerif(m.objet).replace(/s$/, '')) return `objet : Albert ${a.objet}, moteur ${m.objet}`;
  if (['comparaison', 'pdf', 'evolution', 'export'].includes(m.op)) return null;
  if (m.op === 'part' || m.op === 'classement') {
    // seulement un lieu / une formation de la question oubliés par le moteur
    const fa = Object.keys(a.filtres || {}).map(_equivVerif).filter(f => GEO_VERIF.test(f) || f === 'formation');
    const fm = new Set(Object.keys(m.filtres || {}).map(_equivVerif));
    const manque = fa.filter(f => !fm.has(f) && f !== _equivVerif(m.groupe || ''));
    return manque.length ? `critère oublié par le moteur : ${manque.join(', ')}` : null;
  }
  // critère cité par Albert, absent du moteur (une exclusion du moteur compte : « hors académie »)
  const fm = new Set([...Object.keys(m.filtres || {}), ...Object.keys(m.exclus || {})].map(_equivVerif));
  // même lieu à un autre niveau (« à Bordeaux » : commune pour le moteur, académie pour Albert) : convention, pas un oubli
  const valeursMoteur = Object.values(m.filtres || {}).flat(2).map(_nrmVerif).join(' | ');
  const memeLieu = f => GEO_VERIF.test(f) && (a.filtres[Object.keys(a.filtres).find(x => _equivVerif(x) === f)] || []).flat().map(_nrmVerif).every(v => v && valeursMoteur.includes(v));
  const manque = Object.keys(a.filtres || {}).map(_equivVerif).filter(f => !fm.has(f) && f !== _equivVerif(m.groupe || '') && f !== 'admission' && !memeLieu(f));
  if (manque.length) return `critère oublié par le moteur : ${[...new Set(manque)].join(', ')}`;
  // valeur de lieu / d'établissement oubliée (« à Bordeaux ou à Pau » : Pau)
  for (const [f, vals] of Object.entries(a.filtres || {})) {
    if (!GEO_VERIF.test(_equivVerif(f))) continue;
    const cle = Object.keys(m.filtres || {}).find(x => _equivVerif(x) === _equivVerif(f));
    if (!cle) continue; // famille absente du moteur : déjà traitée (même lieu, ou exclusion)
    const texte = (m.filtres[cle] || []).flat().map(_nrmVerif).join(' | ');
    const oubli = vals.flat().map(_nrmVerif).filter(v => v && !v.split(' ').some(w => w.length >= 3 && texte.includes(w)));
    if (oubli.length) return `valeur oubliée par le moteur : ${oubli.join(', ')}`;
  }
  // exclusion vue par Albert, aucune exclusion dans le moteur
  if (Object.keys(a.exclus || {}).length && !Object.keys(m.exclus || {}).length) return `exclusion oubliée par le moteur : ${Object.keys(a.exclus).join(', ')}`;
  return null;
}

function schemaPourAlbertVerif(table) {
  const objets = table.objects || [];
  const lignes = (table.headers || []).filter(Boolean).map(h => {
    const vals = new Map();
    let num = 0, vide = 0;
    objets.forEach(r => { const v = String(r?.[h] ?? '').trim(); if (!v) { vide++; return; } if (/^-?\d+([.,]\d+)?$/.test(v)) num++; vals.set(v, (vals.get(v) || 0) + 1); });
    const n = objets.length - vide;
    if (n && num >= n * 0.8) return `- « ${h} » : nombre`;
    const top = [...vals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([v]) => v);
    return `- « ${h} » : texte, ${vals.size} valeurs${vals.size <= 60 ? ` (ex. : ${top.join(' ; ')})` : ` (ex. : ${top.slice(0, 5).join(' ; ')})`}`;
  });
  return `Une ligne = ${table.rowUnit === 'formation' ? 'une formation' : 'un candidat'}. Colonnes :\n${lignes.join('\n')}`;
}
const CONSIGNE_VERIF = `Tu traduis une question d'un agent d'orientation en plan de calcul, pour vérifier la lecture d'un moteur de calcul.
Tu ne calcules rien. Réponds UNIQUEMENT par un objet JSON, sans texte autour :
{"operation": "...", "objet": "...", "filtres": [{"colonne": "...", "valeurs": ["..."]}], "exclusions": [{"colonne": "...", "valeurs": ["..."]}], "regroupement": "..."}
- operation : compter (nombre de lignes) | compter_distinct (nombre d'établissements, d'académies, de communes… différents) | somme | statistique (moyenne, médiane…) | liste (lister des établissements ou des intitulés) | repartition (effectifs par valeur d'une colonne) | classement (les plus / les moins, top N) | part (pourcentage, taux, proportion) | comparaison (comparer deux groupes) | evolution (entre années) | export (fichier Excel/CSV) | pdf (impression)
- objet : seulement pour compter_distinct et liste : etablissements | academies | departements | communes | regions | formations
- colonne : nom EXACT d'une colonne de la liste ; pour un mot d'intitulé de formation (BTS, MCO, droit, PASS…), utilise "formation"
- valeurs : telles qu'on les trouve dans la colonne, ou les mots de la question ; plusieurs valeurs = l'une ou l'autre
- exclusions : valeurs exclues (« hors », « sauf », « non »)
- regroupement : colonne du « par … », du classement, ou des groupes du taux ; sinon null
- une question de relance (« et pour… », « combien ont… », « la liste », « parmi eux ») reprend les filtres des questions précédentes`;
// Réponse d'Albert (texte contenant un objet JSON) → lecture ramenée aux familles de colonnes
function lireLectureAlbert(texte) {
  const m = String(texte || '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('réponse sans JSON');
  const j = JSON.parse(m[0]);
  const filtres = {}, exclus = {};
  const fam = c => /^formation$/i.test(String(c || '').trim()) ? 'formation' : familleVerif(c);
  (j.filtres || []).forEach(f => { const k = fam(f.colonne); if (k) (filtres[k] = filtres[k] || []).push(...[].concat(f.valeurs || []).map(v => [_nrmVerif(v)])); });
  (j.exclusions || []).forEach(f => { const k = fam(f.colonne); if (k) (exclus[k] = exclus[k] || []).push(...[].concat(f.valeurs || []).map(v => [_nrmVerif(v)])); });
  const op = _nrmVerif(j.operation).replace(/ /g, '_');
  const objet = j.objet && ['compter_distinct', 'liste'].includes(op) ? _nrmVerif(j.objet) : null;
  return { lecture: { op, objet, groupe: j.regroupement && j.regroupement !== 'null' ? fam(j.regroupement) : null, filtres, exclus }, brut: m[0] };
}
// Appel à Albert (même proxy que le widget) ; questions = [précédentes…, question]
async function demanderLectureAlbert(questions, table, { fetchImpl = (typeof fetch === 'function' ? fetch : null), endpoint = null, modele = VERIF_MODELE, delaiMaxMs = VERIF_DELAI_MAX_MS } = {}) {
  if (!fetchImpl || !table) throw new Error('vérification indisponible');
  const url = endpoint || (typeof albertConfig !== 'undefined' && albertConfig && albertConfig.endpoint) || (typeof ALBERT_DEFAULT_ENDPOINT !== 'undefined' ? ALBERT_DEFAULT_ENDPOINT : '');
  const conv = questions.length > 1 ? `Questions précédentes de la conversation :\n${questions.slice(0, -1).map(x => `- ${x}`).join('\n')}\n\n` : '';
  if (!table._schemaVerif) table._schemaVerif = schemaPourAlbertVerif(table);
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const minuteur = ctrl && typeof setTimeout === 'function' ? setTimeout(() => ctrl.abort(), delaiMaxMs) : null;
  const debut = Date.now();
  try {
    const r = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl ? ctrl.signal : undefined,
      body: JSON.stringify({ model: modele, temperature: 0, messages: [{ role: 'system', content: `${CONSIGNE_VERIF}\n\n${table._schemaVerif}` }, { role: 'user', content: `${conv}Question : ${questions[questions.length - 1]}` }] }) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const texte = (await r.json())?.choices?.[0]?.message?.content || '';
    return { ...lireLectureAlbert(texte), ms: Date.now() - debut };
  } finally { if (minuteur && typeof clearTimeout === 'function') clearTimeout(minuteur); }
}

// Désaccord en clair, pour l'agent
function alerteEnClair(desaccord) {
  const d = String(desaccord || '');
  const op = { compter: 'un nombre de lignes', compter_distinct: 'un nombre d\'éléments différents (académies, établissements…)', somme: 'une somme', statistique: 'une moyenne', liste: 'une liste', repartition: 'une répartition', classement: 'un classement', part: 'un pourcentage', comparaison: 'une comparaison', evolution: 'une évolution', export: 'un export Excel', pdf: 'une impression PDF' };
  let m;
  if ((m = d.match(/^opération : Albert (\S+), moteur (\S+)/))) return `la question peut demander ${op[m[1]] || m[1]}, alors que le calcul donne ${op[m[2]] || m[2]}`;
  if ((m = d.match(/^objet : Albert (.+), moteur (.+)$/))) return `la question peut porter sur des ${m[1]}, alors que le calcul compte des ${m[2]}`;
  if ((m = d.match(/^critère oublié par le moteur : (.+)$/))) return `un critère de la question ne semble pas appliqué (${m[1].replace(/_/g, ' ').replace(/:(acc|ori)/g, '')})`;
  const maj = t => String(t).replace(/(^|[\s-])([a-zà-ÿ])/g, (x, a, c) => a + c.toUpperCase());
  if ((m = d.match(/^valeur oubliée par le moteur : (.+)$/))) return `une valeur citée ne semble pas prise en compte (« ${maj(m[1])} »)`;
  if ((m = d.match(/^exclusion oubliée par le moteur : (.+)$/))) return `une exclusion (« hors… », « sauf… ») ne semble pas appliquée`;
  return 'la question peut se lire autrement';
}
const VERIF_SANS_OBJET = ['unresolved', 'export', 'pdf', 'compare', 'evolution', 'evolution_groupes', 'chart_current', 'erreur'];
// Vérifie une réponse calculée ; renvoie le désaccord (texte) ou null. Aucune exception ne remonte.
async function verifierLecture({ exec, questions, bubble = null, fetchImpl, endpoint } = {}) {
  try {
    if (!exec || !exec.plan || VERIF_SANS_OBJET.includes(exec.kind) || !exec.plan.table) return null;
    if (typeof localStorage !== 'undefined' && localStorage.getItem && localStorage.getItem('caes_verif_lecture') === 'non') return null;
    const al = await demanderLectureAlbert(questions, exec.plan.table, { fetchImpl, endpoint });
    const d = desaccordVerif(al.lecture, lectureMoteurVerif(exec));
    if (!d) return null;
    if (bubble) afficherAlerteVerif(bubble, d);
    if (typeof enregistrerRetour === 'function') {
      let perim = ''; try { perim = (typeof perimetreResultat === 'function') ? perimetreResultat(exec.kind, exec.plan, exec.result).texte : ''; } catch (e) { perim = ''; }
      enregistrerRetour({ type: 'alerte_lecture', question: questions[questions.length - 1], outil: exec.kind, perimetre: perim, commentaire: `Vérification automatique : ${alerteEnClair(d)} (${d})` });
    }
    return d;
  } catch (e) { return null; } // Albert indisponible, lent ou réponse illisible : on ne dit rien
}
function afficherAlerteVerif(bubble, desaccord) {
  if (!bubble || !bubble.querySelector || bubble.querySelector('.de-verif')) return;
  const p = (typeof document !== 'undefined' && document.createElement) ? document.createElement('p') : null;
  if (!p) return;
  p.className = 'de-verif';
  p.setAttribute('style', 'font-size:12px;line-height:1.5;color:#92400e;background:#fffbeb;border-left:3px solid #f59e0b;border-radius:4px;padding:6px 10px;margin:6px 0 10px');
  const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => String(s ?? ''));
  p.innerHTML = `⚠️ <strong>Vérification</strong> : ${esc(alerteEnClair(desaccord))}. Vérifiez la ligne « J'ai compris » ou reformulez la question.`;
  const perim = bubble.querySelector('.de-perimetre');
  if (perim && perim.parentNode) perim.parentNode.insertBefore(p, perim.nextSibling); else bubble.appendChild(p);
}
