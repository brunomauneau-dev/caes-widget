// essai_donnees_reelles.mjs — Pose des questions types au moteur du widget, sur l'open data Parcoursup réel,
// et vérifie la cohérence des réponses (ex. « PASS option Droit » ≤ « PASS » ≤ total du fichier).
//
// Lancement : GitHub → onglet Actions → « Essai sur données réelles » → Run workflow.
// En local (avec accès internet) : node scripts/essai_donnees_reelles.mjs
// Questions en plus : variable QUESTIONS_EN_PLUS, séparées par « ; ».
//
// Le script charge les vrais fichiers js/ du widget (comme le navigateur), sans Albert ni Grist :
// il montre exactement ce que le moteur de calcul répond. Rien n'est écrit dans Grist.
// Résultat : tableau dans le résumé de l'exécution GitHub, fichier essai_resultats.md,
// et sortie en erreur (croix rouge) si un contrôle de cohérence échoue.

import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const JS_DIR = path.join(ICI, '..', 'js');
const MODULES = ['config.js', 'knowledge.js', 'documents.js', 'planner.js', 'dataEngine.js', 'sessions.js'];

// Questions types : celles du test du 05/11/2026, des variantes et des pièges
export const QUESTIONS = [
  { id: 'liste1', q: 'donne moi la liste complète des filières de PASS' },
  { id: 'liste2', q: 'donne moi toutes les filières de PASS avec toutes les options' },
  { id: 'pass', q: 'combien de PASS' },
  { id: 'droit', q: 'combien de PASS option Droit' },
  { id: 'zoologie', q: 'combien de PASS option Zoologie' },
  // v27.17 — option précisée pour une partie des PASS seulement (70 sur 287 en 2025)
  { id: 'bio_bdx', q: 'combien de PASS option biologie à Bordeaux' },
  // v27.22 — mot non reconnu : arrêt, jamais un compte plus large
  { id: 'mot_inconnu', q: 'combien de formations de pilote de ligne' },
  // v27.23 — établissements différents, pas des formations
  { id: 'etab_bdx', q: "combien d'établissements dans l'académie de Bordeaux" },
  { id: 'formations_bdx_par_etab', q: "nombre de formations par établissement dans l'académie de Bordeaux" },
  { id: 'bts_ndrc', q: 'combien de BTS NDRC' },
  // v27.18 — mesure par groupe et évolution par groupe
  { id: 'places_par_aca', q: 'nombre de places en BTS par académie' },
  { id: 'formations_par_aca', q: 'nombre de BTS par académie' },
  { id: 'evo_formations_demandees', q: 'évolution des formations les plus demandées depuis {N-1}' },
  { id: 'bio_aca', q: "combien de PASS option biologie dans l'académie de Bordeaux" },
  { id: 'pass_droit', q: 'combien de PASS option droit' },
  { id: 'bts', q: 'combien de BTS' },
  { id: 'licence_droit', q: 'combien de licences de droit' },
  { id: 'bordeaux', q: 'combien de formations à Bordeaux' },
  { id: 'toutes', q: 'combien de formations' },
  { id: 'repartition', q: 'répartition des formations par filière de formation très agrégée' },
  { id: 'plus_demandees', q: 'quelles sont les formations les plus demandées' },
  { id: 'definition', q: "qu'est-ce que le PASS ?" },
  { id: 'suite', conversation: ['combien de PASS', 'et pour les publics ?'] },
  // v27.8 — robustesse : statut, lieux, sommes, moyennes, état vs chiffre
  { id: 'publiques', q: 'combien de formations publiques' },
  { id: 'privees', q: 'combien de formations privées' },
  { id: 'aca_bdx', q: "combien de formations dans l'académie de Bordeaux" },
  { id: 'ville_bdx', q: 'combien de formations à Bordeaux' },
  { id: 'gironde', q: 'combien de formations en Gironde' },
  { id: 'places_bts', q: 'combien de places en BTS' },
  { id: 'capa_bts', q: 'capacité moyenne des BTS' },
  { id: 'cand_bours', q: 'combien de candidats boursiers en BTS' },
  { id: 'licences', q: 'combien de licences' },
  // v27.10 — relances et choix de la colonne de répartition
  { id: 'bts_bdx', q: "combien de BTS dans l'académie de Bordeaux" },
  { id: 'suite_bdx', conversation: ['combien de BTS', "et pour l'académie de Bordeaux ?"] },
  { id: 'suite_bts', conversation: ['combien de PASS', 'et pour les BTS ?'] },
  { id: 'suite_par', conversation: ['combien de BTS', 'et par académie ?'] },
  { id: 'par_region', q: 'nombre de formations par région' },
  { id: 'par_statut', q: 'répartition par statut' },
  { id: 'par_couleur', q: 'répartition par couleur' },
  { id: 'selectives', q: 'combien de formations sélectives' },
  // v27.11 — reformulations : chaque groupe doit donner le même chiffre, quelle que soit la tournure
  ...[
    ['nombre de BTS', ['nombre de BTS', 'nb de BTS', 'Combien y a-t-il de BTS ?', 'combien de formations en BTS']],
    ["BTS de l'académie de Bordeaux", ["combien de BTS sur l'académie de Bordeaux", "dans l'académie de Bordeaux, combien de BTS ?", "nb de BTS académie de Bordeaux"]],
    ['formations à Bordeaux (ville)', ['nombre de formations à Bordeaux', 'combien de formations sur la commune de Bordeaux', 'combien de formations dans la ville de Bordeaux']],
    ['places en BTS', ['nombre de places en BTS', 'capacité totale des BTS', 'total des places en BTS']],
    ['formations non sélectives', ['combien de formations non sélectives', 'combien de formations qui ne sont pas sélectives', 'combien de formations sans sélection']],
    ['CPGE', ['combien de CPGE', 'combien de prépas', 'nombre de classes préparatoires']],
    ['BTS par académie', ['répartition des BTS par académie', 'nombre de BTS par académie', 'combien de BTS dans chaque académie']],
  ].flatMap(([groupe, qs], i) => qs.map((q, j) => ({ id: `reform_${i + 1}_${j + 1}`, q, groupe }))),
];

// ─── Moteur du widget dans un contexte isolé ─────────────────────────────────
export function creerMoteur({ fetchImpl, table = null, autresSessions = [] } = {}) {
  const noopEl = () => null;
  const ctx = {
    console: { ...console, log() {}, warn() {}, info() {} },
    setTimeout: () => null, clearTimeout() {}, URLSearchParams, TextDecoder,
    document: { getElementById: noopEl, querySelector: noopEl, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: fetchImpl || (() => Promise.reject(new Error('pas de réseau'))),
    escapeHtml: s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    __exports: [],
  };
  // Export Excel : rien n'est écrit, on note seulement le nombre de lignes
  ctx.XLSX = { utils: { json_to_sheet: rows => { ctx.__exports.push(rows.length); return {}; }, book_new: () => ({}), book_append_sheet() {}, sheet_to_csv: () => '' }, writeFile() {} };
  ctx.Blob = class {};
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.selectedDocIds = new Set();
  vm.createContext(ctx);
  for (const f of MODULES) vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), ctx, { filename: f });
  if (table) { ctx.__table = table; vm.runInContext(`defaultOpenDataTable = __table; defaultOpenDataState = 'ready';`, ctx); }
  // v27.16 — sessions déjà chargées (comparaison entre sessions)
  autresSessions.filter(Boolean).forEach(t => { ctx.__autre = t; vm.runInContext('openDataSessions.set(__autre.session, __autre)', ctx); });
  return ctx;
}
// Session précédente, chargée comme le widget le fait à la demande
export async function chargerSessionPrecedente(fetchImpl, session) {
  try { return await vm.runInContext(`chargerSessionOpenData(${Number(session)})`, creerMoteur({ fetchImpl })); } catch (e) { return null; }
}

// Charge l'open data comme le widget (session la plus récente, en-têtes lisibles)
export async function chargerOpenData(fetchImpl) {
  const ctx = creerMoteur({ fetchImpl });
  const table = await vm.runInContext('loadDefaultOpenDataTable()', ctx);
  if (!table) throw new Error(vm.runInContext('defaultOpenDataError', ctx) || 'open data non chargé');
  return table;
}

// Résumé lisible d'une réponse du moteur
function resumer(ctx, question) {
  ctx.__q = question;
  const routee = vm.runInContext('isDataEngineQuestion(__q)', ctx);
  const plan = routee ? vm.runInContext('detectDataEnginePlan(__q)', ctx) : null;
  const exec = plan ? vm.runInContext('runDataEnginePlan', ctx)(plan, []) : null;
  const filtres = (exec?.plan?.filters || plan?.filters || []).map(f => f.op === 'contains_all'
    ? `${f.col} : ${String(f.label || f.value).split(' + ').map(t => `« ${t} »`).join(' et ')}`
    : `${f.col} ${f.op === 'neq' ? '≠' : '='} ${f.label || f.value}`);
  const r = { question, routee: !!routee, outil: plan?.tool || null, liste: !!plan?.listMode, kind: exec?.kind || null, filtres, termes: (plan?.filters || []).some(f => f.op === 'contains_all') };
  // v27.10 — périmètre en clair, tel que l'agent le voit sous le résultat
  if (exec && exec.kind === 'evolution' && typeof ctx.perimetreResultat === 'function') {
    const der = exec.result.lignes[exec.result.lignes.length - 1].exec;
    r.perimetre = `chaque session (${exec.result.lignes.map(l => l.session).join(', ')}) · ${ctx.perimetreResultat(der.kind, der.plan, der.result).texte.replace(/^Périmètre : /, '')}`;
  } else if (exec && exec.kind === 'evolution_groupes') {
    // v27.18 — périmètre de la dernière session, calculé par le moteur (même texte que sous le résultat)
    r.perimetre = `chaque session (${exec.result.sessions.join(', ')}) · ${String(exec.result.perimetre || '').replace(/^Périmètre : /, '')}`;
  } else if (exec && exec.kind !== 'unresolved' && exec.kind !== 'export' && typeof ctx.perimetreResultat === 'function') r.perimetre = ctx.perimetreResultat(exec.kind, exec.plan, exec.result).texte.replace(/^Périmètre : /, '') || undefined;
  if (!exec) { r.reponse = routee ? 'Le moteur n\'a rien calculé' : 'Non traitée par le moteur : la question part vers Albert (connaissances)'; return r; }
  if (exec.kind === 'count') {
    r.count = exec.result.count; r.total = exec.result.total;
    r.reponse = `${r.count.toLocaleString('fr-FR')} sur ${r.total.toLocaleString('fr-FR')}`;
  } else if (exec.kind === 'group_by' || exec.kind === 'top') {
    r.total = exec.result.total; r.colonne = exec.plan?.targetCol; r.distinct = exec.result.distinct;
    r.sansValeur = exec.result.filled !== undefined ? exec.result.total - exec.result.filled : 0;
    r.lignes = (exec.result.rows || []).map(x => ({ value: x.value, count: x.count }));
    r.reponse = `${r.distinct ?? r.lignes.length} valeur(s) de « ${r.colonne} » pour ${r.total.toLocaleString('fr-FR')} formations`;
    // v27.18 — somme par groupe (places, candidats, admis par académie…)
    if (exec.result.somme) { r.somme = { col: exec.result.somme.col, unite: exec.result.somme.unite, total: exec.result.somme.total }; r.reponse += ` — ${exec.result.somme.unite} (somme, total ${exec.result.somme.total.toLocaleString('fr-FR')})`; }
    if (exec.result.memeIntitule) {
      r.parEtablissement = exec.result.memeIntitule.groupes.map(g => `${g.etablissement}${g.commune ? ` (${g.commune})` : ''} : ${g.n}${g.places.length ? ` — ${g.places.join(' / ')} places` : ''}`);
      r.reponse += ` (même intitulé : ${exec.result.memeIntitule.formations} formations dans ${exec.result.memeIntitule.total} établissement(s) — ${r.parEtablissement.join(' ; ')})`;
    }
    if (exec.result.sansPrecision) { r.incomplete = true; r.sansPrecisionEtab = exec.result.sansPrecision.formations; r.reponse += ` (liste incomplète : ${exec.result.sansPrecision.formations} sans précision)`; }
  } else if (exec.kind === 'sum') {
    r.sum = exec.result.sum; r.count = exec.result.count; r.colonne = exec.result.col;
    r.reponse = `${r.sum.toLocaleString('fr-FR')} ${exec.result.unite} (somme de « ${r.colonne} ») sur ${r.count.toLocaleString('fr-FR')} formations`;
  } else if (exec.kind === 'stats') {
    r.moyenne = exec.result.avg; r.colonne = exec.plan?.targetCol;
    r.reponse = `moyenne ${Number(r.moyenne).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} (colonne « ${r.colonne} »)`;
  } else if (exec.kind === 'evolution_groupes') {
    const x = exec.result;
    r.sessions = x.sessions; r.colonne = x.col; r.type = x.type; r.totaux = x.totaux; r.nbGroupes = x.nbGroupes;
    r.lignesEvo = x.lignes.map(l => ({ valeur: l.valeur, v1: l.v1, v2: l.v2, rang1: l.rang1 ?? null, rang2: l.rang2 ?? null }));
    r.reponse = `${x.unite} par « ${x.col} », ${x.sessions.join(' → ')} : total ${x.totaux.map(t => Number(t).toLocaleString('fr-FR')).join(' → ')} · ${x.lignes.slice(0, 3).map(l => `${l.valeur} ${l.v1 ?? '—'} → ${l.v2 ?? '—'}`).join(' · ')}…`;
  } else if (exec.kind === 'evolution') {
    r.valeurs = exec.result.lignes.map(l => l.valeur); r.sessions = exec.result.lignes.map(l => l.session);
    r.reponse = r.sessions.map((s, i) => `${s} : ${Number(r.valeurs[i]).toLocaleString('fr-FR', { maximumFractionDigits: 2 })}`).join(' → ');
  } else if (exec.kind === 'part') {
    r.num = exec.result.num; r.den = exec.result.den; r.pct = exec.result.pct;
    r.reponse = `${(Math.round(r.pct * 10) / 10).toLocaleString('fr-FR')} % (${r.num.toLocaleString('fr-FR')} sur ${r.den.toLocaleString('fr-FR')})`;
  } else if (exec.kind === 'classement') {
    r.colonne = exec.plan.classement.col; r.valeurs = exec.result.lignes.map(l => l.valeur); r.total = exec.result.total;
    r.lignes = exec.result.lignes.map(l => ({ value: `${l.rang}. ${l.libelles.join(' — ')}`, count: l.valeur }));
    r.reponse = `classement de ${r.valeurs.length} selon « ${r.colonne} » : ${r.valeurs.slice(0, 3).join(' · ')}…`;
  } else if (exec.kind === 'unresolved') {
    r.suggestions = (exec.result?.suggestions || []).map(x => `${x.value} (${x.count})`);
    r.reponse = `Non reconnu, pas de chiffre (${(exec.result?.missing || []).join(', ') || 'termes jamais réunis'})`;
    // v27.17 — option précisée pour une partie des formations seulement
    const pr = exec.result?.precision;
    if (pr) {
      r.precision = { colonne: pr.col, renseignees: pr.nRenseignees, famille: pr.nFamille, perimetre: pr.perimetre, precisees: pr.precisees, sansPrecision: pr.sansPrecision };
      r.reponse = `Option non précisée, pas de chiffre (« ${pr.terme} » : ${pr.precisees} la précisent, ${pr.sansPrecision} sans précision sur ${pr.perimetre})`;
    }
  } else if (exec.kind === 'export') {
    r.count = ctx.__exports[ctx.__exports.length - 1] ?? 0;
    r.reponse = `Export de ${r.count} lignes`;
  } else {
    r.reponse = `Résultat de type ${exec.kind}`;
  }
  return r;
}

// Pose toutes les questions ; chaque question (ou conversation) repart d'un contexte neuf
// Diagnostic : pour les PASS, ce que contient chaque colonne de formation (remplissage, valeurs différentes, exemples)
export function diagnosticColonnes(table, filiere = 'PASS') {
  const ctx = creerMoteur({ table });
  const cols = vm.runInContext('formationTermsInfo(defaultOpenDataTable).cols', ctx) || [];
  const colFili = (table.headers || []).find(h => /très agrégée/i.test(h));
  const lignes = (table.objects || []).filter(o => colFili ? String(o[colFili]).trim() === filiere : false);
  return { filiere, n: lignes.length, colonnes: cols.map(c => {
    const vals = lignes.map(o => String(o[c] ?? '').trim()).filter(Boolean);
    const comptes = new Map(); vals.forEach(v => comptes.set(v, (comptes.get(v) || 0) + 1));
    return { colonne: c, remplies: vals.length, distinctes: comptes.size, exemples: [...comptes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([v, k]) => `${v} (${k})`) };
  }) };
}

// Diagnostic des intitulés (variable DIAG_MOTS, mots séparés par « ; ») : pour chaque mot, les valeurs exactes
// des colonnes de formation qui le contiennent, avec leur nombre de formations. Sert à vérifier comment le ministère
// nomme une formation (« khâgne », « MCO », « Sciences Po »…) avant de corriger le moteur. Calcul direct sur les lignes.
const _nd = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/œ/g, 'oe').replace(/[^a-z0-9]+/g, ' ').trim();
export function diagnosticMots(table, mots = []) {
  // colonnes de formation, et colonne des établissements (nom de l'établissement)
  const cols = (table.headers || []).filter(h => (/fili|formation|intitul|nom complet|libell/i.test(h) || /^[ée]tablissement$/i.test(String(h).trim())) && !/statut|nombre|effectif|capacit|taux|%|rang|code|session|lien/i.test(h));
  return mots.map(m => String(m).trim()).filter(Boolean).map(mot => {
    // « orthophon* » : début de mot (orthophonie, orthophoniste) ; sinon mot entier
    const prefixe = /\*$/.test(mot);
    const base = _nd(mot.replace(/\*$/, ''));
    const contient = v => prefixe ? ` ${_nd(v)}`.includes(` ${base}`) : ` ${_nd(v)} `.includes(` ${base} `);
    const lignes = (table.objects || []).filter(o => cols.some(c => contient(o[c])));
    return { mot, total: lignes.length, colonnes: cols.map(c => {
      const comptes = new Map();
      lignes.forEach(o => { const v = String(o[c] ?? '').trim(); if (v && contient(v)) comptes.set(v, (comptes.get(v) || 0) + 1); });
      return { colonne: c, distinctes: comptes.size, valeurs: [...comptes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([v, k]) => `${v} (${k})`) };
    }).filter(x => x.distinctes) };
  });
}
export function motsDiagnostic(texte) { return String(texte || '').split(';').map(s => s.trim()).filter(Boolean); }

export function poserQuestions(table, questions = QUESTIONS, autresSessions = []) {
  return questions.map(item => {
    const ctx = creerMoteur({ table, autresSessions });
    if (item.conversation) return { id: item.id, conversation: item.conversation.map(q => resumer(ctx, q)) };
    return { id: item.id, ...(item.groupe ? { groupe: item.groupe } : {}), ...resumer(ctx, item.q) };
  });
}

// ─── Contrôles de cohérence ──────────────────────────────────────────────────
export function controler(resultats) {
  const R = Object.fromEntries(resultats.map(r => [r.id, r]));
  const out = [];
  const ctl = (libelle, ok, detail = '') => out.push({ libelle, ok: !!ok, detail });
  const somme = r => (r?.lignes || []).reduce((s, x) => s + x.count, 0);
  const valeurs = r => (r?.lignes || []).map(x => `${x.value}:${x.count}`).sort().join('|');

  if (R.pass) ctl('« combien de PASS » : un nombre, ni zéro ni tout le fichier', R.pass.kind === 'count' && R.pass.count > 0 && R.pass.count < R.pass.total, R.pass.reponse);
  // « PASS option Droit » : soit un nombre entre 1 et le nombre de PASS, soit « non trouvé » (l'option peut ne pas exister)
  if (R.droit && R.pass) ctl('« PASS option Droit » : un nombre plausible, ou « non trouvé » (jamais tout le fichier)', (R.droit.kind === 'count' && R.droit.count > 0 && R.droit.count < R.pass.count) || R.droit.kind === 'unresolved', `${R.droit.reponse} · PASS : ${R.pass.count ?? '?'}`);
  if (R.liste1) ctl('« liste complète des filières de PASS » : une liste, pas un export', R.liste1.kind === 'group_by' && R.liste1.liste, R.liste1.reponse);
  if (R.liste1 && R.pass) ctl('la liste des PASS couvre exactement les PASS comptés (lignes + sans valeur)', R.liste1.total === R.pass.count && somme(R.liste1) + (R.liste1.sansValeur || 0) === R.pass.count, `liste : ${R.liste1.total ?? '?'} · somme des lignes : ${somme(R.liste1)} · sans valeur : ${R.liste1.sansValeur || 0} · PASS : ${R.pass.count ?? '?'}`);
  // Données réelles 2025 : la seule colonne qui distingue les PASS n'est remplie que pour une partie d'entre eux.
  // La liste doit le dire (« N sans valeur »), pas l'exiger remplie.
  if (R.liste1) ctl('la liste signale les formations sans valeur dans la colonne listée', (R.liste1.sansValeur || 0) === (R.liste1.total || 0) - somme(R.liste1), `${R.liste1.sansValeur || 0} sans valeur sur ${R.liste1.total ?? '?'} (colonne « ${R.liste1.colonne || '?'} »)`);
  if (R.liste1) ctl('la liste détaille plusieurs options', (R.liste1.lignes || []).length >= 2, `${(R.liste1.lignes || []).length} intitulé(s) dans « ${R.liste1.colonne || '?'} »`);
  if (R.liste1 && R.liste2) ctl('les deux formulations de la liste donnent le même résultat', R.liste2.kind === 'group_by' && valeurs(R.liste1) === valeurs(R.liste2), R.liste2.reponse);
  if (R.droit && R.liste1) {
    const ligneDroit = (R.liste1.lignes || []).find(x => /droit/i.test(x.value));
    const ok = R.droit.kind === 'unresolved' ? !ligneDroit : (ligneDroit && ligneDroit.count === R.droit.count);
    ctl('« PASS option Droit » cohérent avec la liste des PASS', ok, ligneDroit ? `liste : ${ligneDroit.value} = ${ligneDroit.count} · question : ${R.droit.reponse}` : `aucune ligne « Droit » dans la liste · question : ${R.droit.reponse}`);
  }
  // v27.17 — l'option n'est écrite que pour une partie des PASS : pas de chiffre (avant : 0 « calcul exact »)
  if (R.bio_aca) ctl("« PASS option Biologie dans l'académie de Bordeaux » : pas de chiffre trop petit si des PASS ne précisent pas leur option",
    R.bio_aca.kind === 'unresolved' || (R.bio_aca.kind === 'count' && (R.bio_aca.count > 0 || (R.liste1 && !R.liste1.incomplete))), `${R.bio_aca.reponse}${R.liste1 && !R.liste1.incomplete ? ' (options toujours précisées : 0 possible)' : ''}`);
  // la commune de Bordeaux peut n'avoir aucun PASS (ils sont à Talence) : 0 exact, mais l'académie doit être signalée
  if (R.bio_bdx) ctl('« PASS option Biologie à Bordeaux » : arrêt, nombre positif, ou 0 avec la note « dans l\'académie de Bordeaux »',
    R.bio_bdx.kind === 'unresolved' || (R.bio_bdx.kind === 'count' && (R.bio_bdx.count > 0 || /dans l'académie de Bordeaux/.test(R.bio_bdx.perimetre || '') || (R.liste1 && !R.liste1.incomplete))), `${R.bio_bdx.reponse} · ${R.bio_bdx.perimetre || ''}`);
  if (R.pass_droit) ctl('« PASS option droit » : le mot cherché est « droit », parmi les PASS', !R.pass_droit.precision || (/droit/i.test(R.pass_droit.reponse) && R.pass_droit.precision.famille === R.pass?.count), R.pass_droit.reponse);
  if (R.liste1 && R.pass) {
    const peuRemplie = (R.liste1.total || 0) - (R.liste1.sansValeur || 0) < (R.liste1.total || 0) * 0.8;
    ctl('liste des PASS peu remplie : signalée « incomplète », formations sans précision par établissement',
      !peuRemplie || (R.liste1.incomplete && R.liste1.sansPrecisionEtab === R.liste1.sansValeur), `${R.liste1.sansValeur || 0} sans précision sur ${R.liste1.total ?? '?'} · ${R.liste1.incomplete ? 'signalée incomplète' : 'non signalée'}`);
  }
  if (R.places_par_aca && R.formations_par_aca) {
    const bdx = r => (r.lignes || []).find(x => x.value === 'Bordeaux')?.count;
    ctl('« places en BTS par académie » : somme des places, pas le nombre de BTS', R.places_par_aca.kind === 'group_by' && !!R.places_par_aca.somme && bdx(R.places_par_aca) > bdx(R.formations_par_aca), `Bordeaux : ${bdx(R.places_par_aca) ?? '?'} places · ${bdx(R.formations_par_aca) ?? '?'} BTS`);
  }
  if (R.evo_formations_demandees) ctl('évolution d\'un classement de formations : arrêt expliqué (pas suivies une à une)', R.evo_formations_demandees.kind === 'unresolved', R.evo_formations_demandees.reponse);
  if (R.etab_bdx && R.formations_bdx_par_etab) ctl("« combien d'établissements » = nombre d'établissements différents (pas de formations)", R.etab_bdx.kind === 'count' && R.etab_bdx.count >= R.formations_bdx_par_etab.distinct && R.etab_bdx.count < R.formations_bdx_par_etab.total, `${R.etab_bdx.reponse} · répartition : ${R.formations_bdx_par_etab.distinct ?? '?'} établissements pour ${R.formations_bdx_par_etab.total ?? '?'} formations`);
  if (R.mot_inconnu) ctl('mot absent des données (« pilote ») : arrêt, pas tout le fichier', R.mot_inconnu.kind === 'unresolved', R.mot_inconnu.reponse);
  // sigle absent des intitulés : traduit (une partie des BTS) ou arrêt — jamais tous les BTS
  if (R.bts_ndrc && R.bts) ctl('« BTS NDRC » : une partie des BTS (ou arrêt), jamais tous', R.bts_ndrc.kind === 'unresolved' || (R.bts_ndrc.kind === 'count' && R.bts_ndrc.count > 0 && R.bts_ndrc.count < R.bts.count), `${R.bts_ndrc.reponse} · BTS : ${R.bts.count ?? '?'}`);
  if (R.zoologie) ctl('« PASS option Zoologie » : non trouvée, pas de chiffre', R.zoologie.kind === 'unresolved', R.zoologie.reponse);
  if (R.bts) ctl('« combien de BTS » : un nombre, ni zéro ni tout le fichier', R.bts.kind === 'count' && R.bts.count > 0 && R.bts.count < R.bts.total, R.bts.reponse);
  if (R.licence_droit && R.droit) ctl('« licences de droit » ne se confond pas avec PASS option Droit', R.licence_droit.kind === 'count' && R.licence_droit.count > 0 && R.licence_droit.count !== R.droit.count, `${R.licence_droit.reponse} · PASS option Droit : ${R.droit.count ?? '?'}`);
  if (R.bordeaux) ctl('« à Bordeaux » : lieu, pas un intitulé de formation', !R.bordeaux.termes, R.bordeaux.filtres.join(' ; ') || 'aucun filtre');
  if (R.toutes) ctl('« combien de formations » : tout le fichier, sans filtre', R.toutes.kind === 'count' && R.toutes.count === R.toutes.total && !R.toutes.filtres.length, R.toutes.reponse);
  if (R.repartition && R.pass) {
    const lignePass = (R.repartition.lignes || []).find(x => /^pass$/i.test(x.value));
    ctl('la répartition par filière très agrégée donne le même nombre de PASS', lignePass && lignePass.count === R.pass.count, lignePass ? `répartition : PASS = ${lignePass.count}` : 'pas de ligne PASS');
  }
  if (R.plus_demandees) ctl('« les plus demandées » : pas une liste d\'intitulés', !R.plus_demandees.liste, R.plus_demandees.reponse);
  if (R.definition) ctl('« qu\'est-ce que le PASS ? » reste une question de connaissances (Albert)', !R.definition.routee, R.definition.reponse);
  if (R.suite && R.pass) {
    const [a, b] = R.suite.conversation;
    ctl('suite « et pour les publics ? » : garde le PASS, au plus autant de formations', b.kind === 'count' && b.count > 0 && b.count <= a.count && b.filtres.some(f => /pass/i.test(f)), `${a.reponse} → ${b.reponse} · ${b.filtres.join(' ; ')}`);
    ctl('suite « et pour les publics ? » : le statut public est appliqué', b.filtres.some(f => /statut|public/i.test(f) && !/pass/i.test(f)), b.filtres.join(' ; ') || 'aucun filtre');
  }
  // v27.8 — robustesse
  const partie = r => r && r.kind === 'count' && r.count > 0 && r.count < r.total;
  if (R.publiques) ctl('« formations publiques » : une partie du fichier, filtre de statut', partie(R.publiques) && R.publiques.filtres.some(f => /statut/i.test(f)), `${R.publiques.reponse} · ${R.publiques.filtres.join(' ; ')}`);
  if (R.publiques && R.privees) ctl('publiques + privées = toutes les formations', R.privees.kind === 'count' && R.publiques.count + R.privees.count <= R.publiques.total && R.publiques.count + R.privees.count >= R.publiques.total * 0.98, `${R.publiques.count ?? '?'} + ${R.privees.count ?? '?'} pour ${R.publiques.total ?? '?'}`);
  if (R.aca_bdx && R.ville_bdx) ctl('« à Bordeaux » (ville) ≤ « académie de Bordeaux »', partie(R.aca_bdx) && partie(R.ville_bdx) && R.ville_bdx.count < R.aca_bdx.count && R.ville_bdx.filtres.some(f => /commune|ville/i.test(f)), `ville : ${R.ville_bdx.reponse} · académie : ${R.aca_bdx.reponse}`);
  if (R.gironde && R.aca_bdx) ctl('« en Gironde » ≤ « académie de Bordeaux »', partie(R.gironde) && R.gironde.count <= R.aca_bdx.count, `${R.gironde.reponse}`);
  if (R.places_bts && R.bts) ctl('« places en BTS » : une somme de capacités, plus grande que le nombre de BTS', R.places_bts.kind === 'sum' && /capacit/i.test(R.places_bts.colonne || '') && R.places_bts.sum > (R.bts.count || 0), R.places_bts.reponse);
  if (R.capa_bts) ctl('« capacité moyenne des BTS » : colonne Capacité, valeur plausible (1 à 500)', R.capa_bts.kind === 'stats' && /capacit/i.test(R.capa_bts.colonne || '') && R.capa_bts.moyenne > 1 && R.capa_bts.moyenne < 500, R.capa_bts.reponse);
  if (R.licence_droit && R.licences) ctl('« licences de droit » : entre 3 % et 50 % des licences (ni toute la famille, ni une colonne presque vide)', R.licence_droit.count > 0 && R.licences.count > 0 && R.licence_droit.count < R.licences.count * 0.5 && R.licence_droit.count > R.licences.count * 0.03, `${R.licence_droit.reponse} · licences : ${R.licences.reponse} · ${R.licence_droit.filtres.join(' ; ')}`);
  if (R.cand_bours) ctl('« candidats boursiers » : aucune colonne chiffrée utilisée comme filtre d\'état', !R.cand_bours.filtres.some(f => /bours/i.test(f) && /=\s*\d/.test(f)), `${R.cand_bours.reponse} · ${R.cand_bours.filtres.join(' ; ') || 'aucun filtre'}`);

  // v27.10 — relances : le nouveau critère s'ajoute (ou remplace la formation) ; répartition sur la bonne colonne
  if (R.suite_bdx && R.bts_bdx) {
    const b = R.suite_bdx.conversation[1];
    ctl('relance « et pour l\'académie de Bordeaux ? » = « BTS dans l\'académie de Bordeaux »', b.kind === 'count' && partie(R.bts_bdx) && b.count === R.bts_bdx.count, `${b.reponse} · question directe : ${R.bts_bdx.reponse}`);
  }
  if (R.suite_bts && R.bts) {
    const b = R.suite_bts.conversation[1];
    ctl('relance « et pour les BTS ? » après les PASS : compte les BTS, pas les PASS', b.kind === 'count' && b.count === R.bts.count && !b.filtres.some(f => /pass/i.test(f)), `${b.reponse} · BTS : ${R.bts.reponse}`);
  }
  if (R.suite_par && R.bts) {
    const b = R.suite_par.conversation[1];
    ctl('relance « et par académie ? » : répartition des BTS par académie', b.kind === 'group_by' && /acad/i.test(b.colonne || '') && b.total === R.bts.count, b.reponse);
  }
  if (R.par_region) ctl('« par région » : colonne Région', R.par_region.kind === 'group_by' && /^r[ée]gion/i.test(R.par_region.colonne || ''), R.par_region.reponse);
  if (R.par_statut) ctl('« par statut » : colonne Statut', R.par_statut.kind === 'group_by' && /^statut/i.test(R.par_statut.colonne || ''), R.par_statut.reponse);
  if (R.par_couleur) ctl('« par couleur » : arrêt, pas une répartition au hasard', R.par_couleur.kind === 'unresolved', R.par_couleur.reponse);
  // v27.11 — « non sélectives » : le mot « non » était pris pour un intitulé (17 au lieu de 3 196)
  const nonSel = resultats.find(r => r.groupe === 'formations non sélectives');
  if (R.selectives && nonSel) ctl('sélectives + non sélectives = toutes les formations', partie(R.selectives) && partie(nonSel) && R.selectives.count + nonSel.count === R.selectives.total, `${R.selectives.count ?? '?'} + ${nonSel.count ?? '?'} pour ${R.selectives.total ?? '?'}`);
  // v27.11 — reformulations : même chiffre pour toutes les tournures d'une même question
  const groupes = {};
  resultats.filter(r => r.groupe).forEach(r => (groupes[r.groupe] = groupes[r.groupe] || []).push(r));
  Object.entries(groupes).forEach(([g, rs]) => {
    const vals = rs.map(valeurReponse);
    const ok = vals.every(v => v === vals[0]) && rs.every(r => ['count', 'sum', 'stats', 'group_by', 'top'].includes(r.kind));
    ctl(`reformulations « ${g} » : même chiffre pour les ${rs.length} tournures`, ok, rs.map(r => `« ${r.question} » → ${valeurReponse(r)}`).join(' · '));
  });
  // Chaque résultat chiffré porte son périmètre
  const chiffres = resultats.flatMap(r => r.conversation || [r]).filter(r => ['count', 'sum', 'group_by', 'top', 'stats', 'classement', 'part', 'evolution', 'evolution_groupes'].includes(r.kind));
  if (chiffres.length) ctl('chaque résultat chiffré dit sur quoi il porte (périmètre)', chiffres.every(r => r.perimetre && /retenues? sur/.test(r.perimetre)), `${chiffres.filter(r => r.perimetre).length} / ${chiffres.length}`);

  // Contrôle général : une question qui cite une formation ne doit jamais compter tout le fichier
  // (sauf « combien de formations [en AAAA] » : sans critère, tout le fichier de la session est la bonne réponse)
  resultats.filter(r => r.kind === 'count' && r.id !== 'toutes' && !/^combien (de|d) formations(\s+en\s+20\d\d)?\s*\??$/i.test(String(r.question).trim())).forEach(r => {
    if (r.count === r.total) ctl(`« ${r.question} » ne compte pas tout le fichier`, false, r.reponse);
  });
  return out;
}

// ─── Rapport ─────────────────────────────────────────────────────────────────
const cell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
// ─── Comparaison avec le lancement précédent ─────────────────────────────────
// Chaque lancement enregistre ses réponses (essai_resultats.json, joint au rapport sur GitHub) ;
// le lancement suivant les récupère et signale ce qui a changé (nouvelles données, effet d'une modification).
function valeurReponse(r) {
  if (!r || !r.kind) return r && r.routee === false ? 'Albert (pas de calcul)' : 'aucun calcul';
  if (r.kind === 'count' || r.kind === 'export') return r.count;
  if (r.kind === 'sum') return r.sum;
  if (r.kind === 'stats') return Math.round(Number(r.moyenne) * 100) / 100;
  if (r.kind === 'group_by' || r.kind === 'top') return `${r.distinct ?? (r.lignes || []).length} valeurs / ${r.total}`;
  if (r.kind === 'classement') return (r.valeurs || []).join(' · ');
  if (r.kind === 'part') return `${r.num} / ${r.den}`;
  if (r.kind === 'evolution') return (r.valeurs || []).join(' → ');
  if (r.kind === 'unresolved') return 'non reconnu';
  return r.kind;
}
export function instantane(table, resultats, contexte = {}) {
  const reponses = [];
  // questions d'une conversation : nommées d'après la conversation, pour ne pas se confondre avec la même question posée seule
  resultats.forEach(r => (r.conversation ? r.conversation.map((c, i) => ({ ...c, question: i ? `${r.conversation[0].question} → ${c.question}` : `${c.question} (début de conversation)` })) : [r])
    .forEach(x => reponses.push({ question: x.question, valeur: valeurReponse(x) })));
  return { date: contexte.date || new Date().toISOString(), session: table?.session ?? null, formations: table?.objects?.length || 0,
    branche: contexte.branche || '', commit: contexte.commit || '', reponses };
}
export function comparer(precedent, actuel) {
  if (!precedent || !Array.isArray(precedent.reponses)) return null;
  const avant = new Map(precedent.reponses.map(r => [r.question, r.valeur]));
  const lignes = actuel.reponses.filter(r => avant.has(r.question)).map(r => {
    const a = avant.get(r.question), b = r.valeur;
    const ecart = typeof a === 'number' && typeof b === 'number' && a !== b
      ? `${b - a > 0 ? '+' : ''}${(Math.round((b - a) * 100) / 100).toLocaleString('fr-FR')}${a ? ` (${b - a > 0 ? '+' : ''}${((b - a) / a * 100).toFixed(1).replace('.', ',')} %)` : ''}` : '';
    return { question: r.question, avant: a, apres: b, change: a !== b, ecart };
  });
  return {
    precedent: { date: precedent.date, session: precedent.session, formations: precedent.formations, branche: precedent.branche },
    donneesChangees: precedent.session !== actuel.session || precedent.formations !== actuel.formations,
    lignes, changees: lignes.filter(l => l.change).length,
    nouvelles: actuel.reponses.filter(r => !avant.has(r.question)).map(r => r.question),
  };
}
const nombre = v => typeof v === 'number' ? v.toLocaleString('fr-FR') : String(v ?? '');
function sectionComparaison(cmp) {
  const l = ['## Évolution depuis le lancement précédent', ''];
  if (!cmp) { l.push('Pas de lancement précédent à comparer (premier lancement avec historique).', ''); return l; }
  const p = cmp.precedent;
  const quand = p.date ? new Date(p.date).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) : '?';
  l.push(`Lancement précédent : ${quand}${p.branche ? ` (branche ${p.branche})` : ''} · session ${p.session ?? '?'} · ${nombre(p.formations)} formations.`);
  l.push('');
  l.push(cmp.donneesChangees ? '⚠️ **Les données ont changé** (nouvelle session ou nouvelle publication du ministère).' : 'Données identiques (même session, même nombre de formations).');
  l.push('');
  if (!cmp.changees) l.push('✅ **Aucune réponse n\'a changé.**');
  else {
    l.push(`🔄 **${cmp.changees} réponse${cmp.changees > 1 ? 's ont' : ' a'} changé :**`, '', '| Question | Avant | Maintenant | Écart |', '|---|---|---|---|');
    cmp.lignes.filter(x => x.change).forEach(x => l.push(`| ${cell(x.question)} | ${cell(nombre(x.avant))} | ${cell(nombre(x.apres))} | ${cell(x.ecart)} |`));
  }
  if (cmp.nouvelles.length) l.push('', `Nouvelles questions (pas de valeur avant) : ${cmp.nouvelles.map(q => `« ${cell(q)} »`).join(', ')}.`);
  l.push('');
  return l;
}

export function rapport(table, resultats, controles, diag = null, cmp = undefined, verifs = null, diagMots = []) {
  const ok = controles.filter(c => c.ok).length;
  const lignes = [];
  lignes.push(`# Essai sur données réelles — ${table?.name || 'open data'}`);
  lignes.push('');
  lignes.push(`${(table?.objects?.length || 0).toLocaleString('fr-FR')} formations chargées · ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`);
  lignes.push('');
  lignes.push(`## Cohérence : ${ok} / ${controles.length} contrôles réussis ${ok === controles.length ? '✅' : '❌'}`);
  lignes.push('');
  lignes.push('| | Contrôle | Détail |');
  lignes.push('|---|---|---|');
  controles.forEach(c => lignes.push(`| ${c.ok ? '✅' : '❌'} | ${cell(c.libelle)} | ${cell(c.detail)} |`));
  lignes.push('');
  lignes.push(...sectionOfficiels(verifs));
  if (cmp !== undefined) lignes.push(...sectionComparaison(cmp));
  lignes.push('## Réponses du moteur');
  lignes.push('');
  lignes.push('| Question | Réponse | Sur quoi porte le calcul |');
  lignes.push('|---|---|---|');
  const ligne = r => lignes.push(`| ${cell(r.question)} | ${cell(r.reponse)} | ${cell(r.perimetre || r.filtres?.join(' ; ') || '—')} |`);
  resultats.forEach(r => r.conversation ? r.conversation.forEach(ligne) : ligne(r));
  resultats.filter(r => r.lignes?.length || r.suggestions?.length).forEach(r => {
    lignes.push('');
    lignes.push(`### « ${r.question} »`);
    lignes.push('');
    (r.lignes || []).slice(0, 30).forEach(x => lignes.push(`- ${x.value} : **${x.count.toLocaleString('fr-FR')}**`));
    if ((r.lignes || []).length > 30) lignes.push(`- … et ${r.lignes.length - 30} autres`);
    (r.suggestions || []).forEach(s => lignes.push(`- proposé : ${s}`));
  });
  (diagMots || []).forEach(d => {
    lignes.push('', `## Diagnostic du mot « ${d.mot} » : ${d.total.toLocaleString('fr-FR')} formation(s) dont un intitulé le contient (mot entier)`, '');
    if (!d.colonnes.length) { lignes.push('Aucun intitulé ne contient ce mot.'); return; }
    lignes.push('| Colonne | Valeurs | Exemples (formations) |', '|---|---|---|');
    d.colonnes.forEach(c => lignes.push(`| ${cell(c.colonne)} | ${c.distinctes} | ${cell(c.valeurs.join(' · '))} |`));
  });
  if (diag && diag.n) {
    lignes.push('');
    lignes.push(`## Diagnostic : colonnes de formation des ${diag.filiere} (${diag.n} formations)`);
    lignes.push('');
    lignes.push('| Colonne | Remplie | Valeurs différentes | Exemples |');
    lignes.push('|---|---|---|---|');
    diag.colonnes.forEach(c => lignes.push(`| ${cell(c.colonne)} | ${c.remplies} / ${diag.n} | ${c.distinctes} | ${cell(c.exemples.join(' · '))} |`));
  }
  return lignes.join('\n') + '\n';
}

// precedent : instantané du lancement précédent (null s'il n'y en a pas) ; undefined = pas de section de comparaison
// ─── Chiffres officiels : calculés par le serveur du ministère ───────────────
// L'API de data.enseignementsup-recherche.gouv.fr compte et additionne elle-même dans sa base
// (count, sum, avg, group_by). Le widget, qui télécharge les lignes et calcule de son côté, doit
// retrouver ces chiffres À L'UNITÉ PRÈS. Deux chemins indépendants : toute erreur de chargement,
// de colonne, de filtre ou de calcul du widget apparaît comme un écart.
const API_PARCOURSUP = 'https://data.enseignementsup-recherche.gouv.fr/api/explore/v2.1/catalog/datasets/fr-esr-parcoursup';
export const REFERENCES = [
  { id: 'ref_total', q: 'combien de formations', type: 'count' },
  { id: 'ref_bts', q: 'combien de BTS', type: 'count', egal: { fili: 'BTS' } },
  { id: 'ref_pass', q: 'combien de PASS', type: 'count', egal: { fili: 'PASS' } },
  { id: 'ref_cpge', q: 'combien de CPGE', type: 'count', egal: { fili: 'CPGE' } },
  { id: 'ref_licences', q: 'combien de licences', type: 'count', egal: { fili: 'Licence' } },
  { id: 'ref_public', q: 'combien de formations publiques', type: 'count', egal: { contrat_etab: 'Public' } },
  { id: 'ref_prive', q: 'combien de formations privées', type: 'count', different: { contrat_etab: 'Public' } },
  { id: 'ref_aca_bdx', q: "combien de formations dans l'académie de Bordeaux", type: 'count', egal: { acad_mies: 'Bordeaux' } },
  { id: 'ref_bts_bdx', q: "combien de BTS dans l'académie de Bordeaux", type: 'count', egal: { fili: 'BTS', acad_mies: 'Bordeaux' } },
  { id: 'ref_ville_bdx', q: 'combien de formations à Bordeaux', type: 'count', egal: { ville_etab: 'Bordeaux' } },
  { id: 'ref_gironde', q: 'combien de formations en Gironde', type: 'count', egal: { dep_lib: 'Gironde' } },
  { id: 'ref_selectives', q: 'combien de formations sélectives', type: 'count', egal: { select_form: 'formation sélective' } },
  { id: 'ref_non_selectives', q: 'combien de formations non sélectives', type: 'count', egal: { select_form: 'formation non sélective' } },
  { id: 'ref_places', q: 'combien de places au total', type: 'sum', champ: 'capa_fin' },
  { id: 'ref_places_bts', q: 'combien de places en BTS', type: 'sum', champ: 'capa_fin', egal: { fili: 'BTS' } },
  { id: 'ref_candidats_pass', q: 'combien de candidats en PASS', type: 'sum', champ: 'voe_tot', egal: { fili: 'PASS' } },
  { id: 'ref_admis_bts', q: "combien d'admis en BTS", type: 'sum', champ: 'acc_tot', egal: { fili: 'BTS' } },
  { id: 'ref_capa_moy_bts', q: 'capacité moyenne des BTS', type: 'avg', champ: 'capa_fin', egal: { fili: 'BTS' } },
  { id: 'ref_par_region', q: 'nombre de formations par région', type: 'group', champ: 'region_etab_aff' },
  { id: 'ref_par_filiere', q: 'répartition des formations par filière de formation très agrégée', type: 'group', champ: 'fili' },
  // v27.14 — classements : le serveur trie lui-même ; mêmes valeurs, même ordre
  { id: 'ref_top_demandees', q: 'quelles sont les formations les plus demandées', type: 'top', champ: 'voe_tot', ordre: 'desc', n: 10 },
  { id: 'ref_top_bts_selectifs', q: 'les 10 BTS les plus sélectifs', type: 'top', champ: 'taux_acces_ens', ordre: 'asc', n: 10, egal: { fili: 'BTS' }, superieur: { taux_acces_ens: 0 } },
  // conditions chiffrées
  { id: 'ref_plus_100_places', q: 'combien de formations de plus de 100 places', type: 'count', superieur: { capa_fin: 100 } },
  { id: 'ref_bts_taux_0', q: "combien de BTS avec un taux d'accès de 0", type: 'count', egal: { fili: 'BTS', taux_acces_ens: 0 } },
  // v27.15 — parts : numérateur et dénominateur calculés séparément par le serveur
  { id: 'ref_part_boursiers_bts', q: 'part des boursiers parmi les admis en BTS', type: 'part', num: 'acc_brs', den: 'acc_neobac', egal: { fili: 'BTS' } },
  { id: 'ref_part_filles_admises', q: 'part des filles parmi les admis', type: 'part', num: 'acc_tot_f', den: 'acc_tot' },
  { id: 'ref_remplissage_bts', q: 'taux de remplissage des BTS', type: 'part', num: 'acc_tot', den: 'capa_fin', egal: { fili: 'BTS' } },
  { id: 'ref_part_selectives', q: 'quelle part des formations sont sélectives', type: 'part', condition: { select_form: 'formation sélective' } },
  // v27.16 — session précédente et évolution : le serveur calcule chaque session
  { id: 'ref_n1_bts', q: 'combien de BTS en {N-1}', type: 'count', egal: { fili: 'BTS' }, session: -1 },
  { id: 'ref_n1_places', q: 'combien de places au total en {N-1}', type: 'sum', champ: 'capa_fin', session: -1 },
  { id: 'ref_evolution_places_bts', q: 'les places en BTS ont-elles augmenté depuis {N-1} ?', type: 'evolution', base: { type: 'sum', champ: 'capa_fin', egal: { fili: 'BTS' } } },
  { id: 'ref_evolution_pass', q: 'évolution du nombre de PASS depuis {N-1}', type: 'evolution', base: { type: 'count', egal: { fili: 'PASS' } } },
  { id: 'ref_n1_part_boursiers_bts', q: 'part des boursiers parmi les admis en BTS en {N-1}', type: 'part', num: 'acc_brs', den: 'acc_neobac', egal: { fili: 'BTS' }, session: -1 },
  // v27.18 — somme par groupe, et évolution par groupe entre deux sessions (chaque session calculée par le serveur)
  { id: 'ref_places_bts_par_aca', q: 'nombre de places en BTS par académie', type: 'group', champ: 'acad_mies', somme: 'capa_fin', egal: { fili: 'BTS' } },
  { id: 'ref_evolution_bts_par_aca', q: 'évolution du nombre de BTS par académie depuis {N-1}', type: 'evolution_groupe', base: { type: 'group', champ: 'acad_mies', egal: { fili: 'BTS' } } },
  { id: 'ref_evolution_places_aca', q: 'les académies avec le plus de places en BTS : évolution depuis {N-1}', type: 'evolution_groupe', base: { type: 'group', champ: 'acad_mies', somme: 'capa_fin', egal: { fili: 'BTS' } } },
  // v27.22 — sigles et surnoms de formations : chiffre du serveur filtré sur l'intitulé officiel
  { id: 'ref_bts_mco', q: 'combien de BTS MCO', type: 'count', egal: { fili: 'BTS', fil_lib_voe_acc: 'Management Commercial Opérationnel' } },
  { id: 'ref_ecoles_commerce', q: "combien d'écoles de commerce", type: 'count', egal: { fili: 'Ecole de Commerce' } },
  { id: 'ref_khagnes', q: 'combien de khâgnes', type: 'count', egal: { fili: 'CPGE', fil_lib_voe_acc: 'Lettres' } },
  { id: 'ref_licences_staps', q: 'combien de licences STAPS', type: 'count', egal: { fili: 'Licence', fil_lib_voe_acc: 'Sciences et Techniques des Activités Physiques et Sportives' } },
  // v27.23 — établissements : nom exact côté serveur
  { id: 'ref_lycee_jullian', q: 'combien de formations au lycée Camille Jullian', type: 'count', egal: { g_ea_lib_vx: 'Lycée Camille Jullian' } },
  { id: 'ref_lycee_montaigne', q: 'combien de formations au lycée Montaigne', type: 'count', egal: { g_ea_lib_vx: 'Lycée Montaigne' } },
  { id: 'ref_orthophonie', q: "combien de formations d'orthophonie", type: 'count', egal: { fil_lib_voe_acc: "Certificat de capacité d'Orthophoniste" } },
  { id: 'ref_top_places_bdx', q: 'les 5 formations avec le plus de places à Bordeaux', type: 'top', champ: 'capa_fin', ordre: 'desc', n: 5, egal: { ville_etab: 'Bordeaux' } },
];
const _odsql = v => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
export function requeteOfficielle(ref, session, jeu = null) {
  const conds = [...Object.entries(ref.egal || {}).map(([k, v]) => `${k}=${typeof v === 'number' ? v : _odsql(v)}`), ...Object.entries(ref.superieur || {}).map(([k, v]) => `${k}>${v}`), ...(ref.type === 'top' ? [`${ref.champ} is not null`] : []),
    ...Object.entries(ref.different || {}).map(([k, v]) => `(${k} is null or ${k}!=${_odsql(v)})`)];
  const p = new URLSearchParams();
  p.set('select', ref.type === 'count' ? 'count(*) as n' : ref.type === 'sum' ? `sum(${ref.champ}) as n` : ref.type === 'avg' ? `avg(${ref.champ}) as n` : ref.type === 'top' ? `${ref.champ} as n` : `${ref.champ} as cle, ${ref.somme ? `sum(${ref.somme})` : 'count(*)'} as n`);
  if (ref.type === 'group') { p.set('group_by', ref.champ); p.set('limit', '100'); }
  else if (ref.type === 'top') { p.set('order_by', `${ref.champ} ${ref.ordre === 'asc' ? 'asc' : 'desc'}`); p.set('limit', String(ref.n || 10)); }
  else p.set('limit', '1');
  if (conds.length) p.set('where', conds.join(' and '));
  // jeu archivé d'une session (« fr-esr-parcoursup_2024 ») : il ne contient que cette session
  if (!jeu || jeu === 'fr-esr-parcoursup') p.append('refine', `session:${session}`);
  return `${jeu ? API_PARCOURSUP.replace(/fr-esr-parcoursup$/, jeu) : API_PARCOURSUP}/records?${p}`;
}
export async function chiffresOfficiels(fetchImpl, session, refs = REFERENCES, { jeuPrecedent = null } = {}) {
  const out = {};
  const jeuDe = s => (s === session - 1 ? jeuPrecedent : null);
  const unChiffre = async r => { const ses = session + (r.session || 0); const x = await fetchImpl(requeteOfficielle(r, ses, jeuDe(ses)), { cache: 'no-store' }); if (!x.ok) throw new Error(`HTTP ${x.status}`); const res = (await x.json()).results; if (!Array.isArray(res)) throw new Error('réponse sans résultats'); return Number(res[0]?.n ?? 0); };
  const groupes = async (base, ses) => {
    const x = await fetchImpl(requeteOfficielle(base, ses, jeuDe(ses)), { cache: 'no-store' });
    if (!x.ok) throw new Error(`HTTP ${x.status}`);
    const res = (await x.json()).results;
    if (!Array.isArray(res)) throw new Error('réponse sans résultats');
    return Object.fromEntries(res.map(y => [y.cle === null || y.cle === undefined || y.cle === '' ? '(vide)' : String(y.cle), Number(y.n)]));
  };
  for (const ref of refs) {
    if (ref.type === 'evolution_groupe') {
      try { out[ref.id] = { valeur: [await groupes(ref.base, session - 1), await groupes(ref.base, session)] }; }
      catch (e) { out[ref.id] = { erreur: e.message }; }
      continue;
    }
    if (ref.type === 'evolution') {
      try {
        const avant = await (async () => { const x = await fetchImpl(requeteOfficielle(ref.base, session - 1, jeuDe(session - 1)), { cache: 'no-store' }); if (!x.ok) throw new Error(`HTTP ${x.status}`); return Number((await x.json()).results?.[0]?.n ?? 0); })();
        out[ref.id] = { valeur: [avant, await unChiffre(ref.base)] };
      } catch (e) { out[ref.id] = { erreur: e.message }; }
      continue;
    }
    if (ref.type === 'part') {
      // part = deux chiffres du serveur : numérateur (somme ou comptage avec condition) et dénominateur
      try {
        const num = ref.num ? await unChiffre({ type: 'sum', champ: ref.num, egal: ref.egal, session: ref.session }) : await unChiffre({ type: 'count', egal: { ...(ref.egal || {}), ...ref.condition }, session: ref.session });
        const den = ref.den ? await unChiffre({ type: 'sum', champ: ref.den, egal: ref.egal, session: ref.session }) : await unChiffre({ type: 'count', egal: ref.egal, session: ref.session });
        out[ref.id] = { valeur: { num, den } };
      } catch (e) { out[ref.id] = { erreur: e.message }; }
      continue;
    }
    try {
      const r = await fetchImpl(requeteOfficielle(ref, session + (ref.session || 0), jeuDe(session + (ref.session || 0))), { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const res = (await r.json()).results;
      if (!Array.isArray(res)) throw new Error('réponse sans résultats');
      out[ref.id] = ref.type === 'group'
        ? { valeur: Object.fromEntries(res.map(x => [x.cle === null || x.cle === undefined || x.cle === '' ? '(vide)' : String(x.cle), Number(x.n)])) }
        : ref.type === 'top' ? { valeur: res.map(x => Number(x.n)) }
        : { valeur: Number(res[0]?.n ?? 0) };
    } catch (e) { out[ref.id] = { erreur: e.message }; }
  }
  return out;
}
// Compare les réponses du widget aux chiffres officiels
export function verifierOfficiels(officiels, resultats, refs = REFERENCES) {
  const R = Object.fromEntries(resultats.map(r => [r.id, r]));
  return refs.map(ref => {
    const off = officiels?.[ref.id], w = R[ref.id];
    const base = { id: ref.id, question: ref.q };
    if (!off || off.erreur) return { ...base, statut: 'indisponible', detail: `API du ministère indisponible (${off?.erreur || 'non interrogée'})` };
    if (!w) return { ...base, statut: 'ecart', detail: 'question non posée au widget' };
    if (ref.type === 'group') {
      if (!['group_by', 'top'].includes(w.kind)) return { ...base, statut: 'ecart', officiel: '—', widget: w.reponse, detail: 'pas de répartition calculée' };
      // répartition tronquée à l'affichage (plus de 30 groupes) : un groupe officiel non affiché n'est pas un écart
      const tronquee = (w.distinct || 0) > (w.lignes || []).length;
      const ecarts = Object.entries(off.valeur).filter(([k]) => k !== '(vide)').map(([k, n]) => {
        const l = (w.lignes || []).find(x => x.value === k);
        if (!l && tronquee) return null;
        return l && l.count === n ? null : `${k} : officiel ${n}, widget ${l ? l.count : 'absent'}`;
      }).filter(Boolean);
      const nbOff = Object.keys(off.valeur).filter(k => k !== '(vide)').length;
      if (w.distinct !== undefined && w.distinct !== nbOff) ecarts.push(`nombre de groupes : officiel ${nbOff}, widget ${w.distinct}`);
      if (ref.somme && !w.somme) ecarts.push('le widget a compté des formations au lieu de sommer');
      const vides = off.valeur['(vide)'] || 0;
      if (!ref.somme && (w.sansValeur || 0) !== vides) ecarts.push(`sans valeur : officiel ${vides}, widget ${w.sansValeur || 0}`);
      const nb = Object.keys(off.valeur).filter(k => k !== '(vide)').length;
      return { ...base, statut: ecarts.length ? 'ecart' : 'ok', officiel: `${nb} valeurs`, widget: w.reponse, detail: ecarts.length ? ecarts.slice(0, 5).join(' · ') : `${nb} valeurs identiques à l'unité` };
    }
    if (ref.type === 'evolution_groupe') {
      if (w.kind !== 'evolution_groupes') return { ...base, statut: 'ecart', officiel: '—', widget: w.reponse, detail: 'pas d\'évolution par groupe calculée' };
      const [o1, o2] = off.valeur;
      const val = (o, k) => (k in o ? o[k] : null);
      const ecarts = (w.lignesEvo || []).map(l => (val(o1, l.valeur) === l.v1 && val(o2, l.valeur) === l.v2) ? null : `${l.valeur} : officiel ${val(o1, l.valeur) ?? '—'} → ${val(o2, l.valeur) ?? '—'}, widget ${l.v1 ?? '—'} → ${l.v2 ?? '—'}`).filter(Boolean);
      const tot = o => Object.entries(o).filter(([k]) => k !== '(vide)').reduce((t, [, n]) => t + n, 0);
      const totaux = [tot(o1), tot(o2)].map(t => Math.round(t * 100) / 100);
      if (JSON.stringify(totaux) !== JSON.stringify(w.totaux)) ecarts.push(`totaux : officiel ${totaux.join(' → ')}, widget ${(w.totaux || []).join(' → ')}`);
      return { ...base, statut: ecarts.length ? 'ecart' : 'ok', officiel: `total ${totaux.join(' → ')}`, widget: `total ${(w.totaux || []).join(' → ')}`, detail: ecarts.length ? ecarts.slice(0, 4).join(' · ') : `${(w.lignesEvo || []).length} groupes et totaux identiques (deux sessions)` };
    }
    if (ref.type === 'evolution') {
      const obtenu = w.kind === 'evolution' ? w.valeurs : null;
      const ok = !!obtenu && JSON.stringify(obtenu) === JSON.stringify(off.valeur);
      return { ...base, statut: ok ? 'ok' : 'ecart', officiel: off.valeur.join(' → '), widget: obtenu ? obtenu.join(' → ') : w.reponse, detail: ok ? 'les deux sessions identiques' : 'évolution différente' };
    }
    if (ref.type === 'part') {
      const { num, den } = off.valeur;
      const ok = w.kind === 'part' && w.num === num && w.den === den;
      const pctOff = den ? Math.round(num / den * 1000) / 10 : null;
      return { ...base, statut: ok ? 'ok' : 'ecart', officiel: `${pctOff} % (${num} / ${den})`, widget: w.kind === 'part' ? `${Math.round(w.pct * 10) / 10} % (${w.num} / ${w.den})` : w.reponse, detail: ok ? 'numérateur et dénominateur identiques' : 'part différente' };
    }
    if (ref.type === 'top') {
      const obtenu = w.kind === 'classement' ? (w.valeurs || []) : null;
      const ok = !!obtenu && JSON.stringify(obtenu) === JSON.stringify(off.valeur);
      return { ...base, statut: ok ? 'ok' : 'ecart', officiel: off.valeur.join(' · '), widget: obtenu ? obtenu.join(' · ') : w.reponse, detail: ok ? `${off.valeur.length} valeurs identiques, même ordre` : 'classement différent' };
    }
    const attendu = ref.type === 'avg' ? Math.round(off.valeur * 100) / 100 : off.valeur;
    const obtenu = ref.type === 'count' ? (w.kind === 'count' ? w.count : null)
      : ref.type === 'sum' ? (w.kind === 'sum' ? w.sum : null)
      : (w.kind === 'stats' ? Math.round(Number(w.moyenne) * 100) / 100 : null);
    return { ...base, statut: obtenu === attendu ? 'ok' : 'ecart', officiel: attendu, widget: obtenu ?? w.reponse,
      detail: obtenu === attendu ? 'identique' : `écart : ${obtenu === null ? w.reponse : (Math.round((obtenu - attendu) * 100) / 100).toLocaleString('fr-FR')}` };
  });
}
export function sectionOfficiels(verifs) {
  if (!verifs || !verifs.length) return [];
  const ok = verifs.filter(v => v.statut === 'ok').length, ind = verifs.filter(v => v.statut === 'indisponible').length;
  const l = [`## Chiffres officiels (calculés par le serveur du ministère) : ${ok} / ${verifs.length - ind} identiques à l'unité ${ok === verifs.length - ind && ok ? '✅' : '❌'}`, ''];
  if (ind) l.push(`⚠️ ${ind} chiffre${ind > 1 ? 's' : ''} non vérifié${ind > 1 ? 's' : ''} : API du ministère indisponible.`, '');
  l.push('| | Question | Officiel | Widget | Détail |', '|---|---|---|---|---|');
  verifs.forEach(v => l.push(`| ${v.statut === 'ok' ? '✅' : v.statut === 'ecart' ? '❌' : '⚠️'} | ${cell(v.question)} | ${cell(typeof v.officiel === 'number' ? v.officiel.toLocaleString('fr-FR') : v.officiel ?? '—')} | ${cell(typeof v.widget === 'number' ? v.widget.toLocaleString('fr-FR') : v.widget ?? '—')} | ${cell(v.detail)} |`));
  l.push('');
  return l;
}

export async function essai({ fetchImpl = globalThis.fetch, questions = QUESTIONS, precedent = undefined, contexte = {}, references = REFERENCES, mots = [] } = {}) {
  const table = await chargerOpenData(fetchImpl);
  // v27.16 — session précédente (comparaisons) ; « {N-1} » dans une question = l'année de cette session
  const n1 = Number(table.session) - 1;
  const precedente = await chargerSessionPrecedente(fetchImpl, n1);
  const annee = q => String(q).replace(/\{N-1\}/g, n1);
  const questionsAnnee = questions.map(x => ({ ...x, ...(x.q ? { q: annee(x.q) } : {}), ...(x.conversation ? { conversation: x.conversation.map(annee) } : {}) }));
  references = references.map(r => ({ ...r, q: annee(r.q) }));
  // toute autre session citée dans une question (« en 2023 ») est chargée comme le widget le fait à la demande
  const cites = new Set();
  [...questionsAnnee.flatMap(x => x.conversation || [x.q]), ...references.map(r => r.q)].forEach(q => (String(q).match(/\b20[12]\d\b/g) || []).forEach(y => { y = Number(y); if (y < table.session && y !== n1) cites.add(y); }));
  const autres = [precedente];
  for (const y of cites) autres.push(await chargerSessionPrecedente(fetchImpl, y));
  const resultats = poserQuestions(table, questionsAnnee, autres);
  const resRefs = poserQuestions(table, references.map(r => ({ id: r.id, q: r.q })), autres);
  const officiels = references.length ? await chiffresOfficiels(fetchImpl, table.session, references, { jeuPrecedent: precedente?.jeu || null }) : {};
  const verifs = verifierOfficiels(officiels, resRefs, references);
  const controles = [...controler(resultats), ...verifs.filter(v => v.statut !== 'indisponible').map(v => ({ libelle: `chiffre officiel : « ${v.question} »`, ok: v.statut === 'ok', detail: `officiel ${v.officiel} · widget ${v.widget} · ${v.detail}` }))];
  const diag = diagnosticColonnes(table);
  const snap = instantane(table, resultats, contexte);
  const cmp = precedent === undefined ? undefined : comparer(precedent, snap);
  const diagMots = diagnosticMots(table, mots);
  return { table, resultats, controles, verifs, diag, diagMots, instantane: snap, comparaison: cmp, texte: rapport(table, resultats, controles, diag, cmp, verifs, diagMots) };
}

// Instantané du lancement précédent, déposé par le workflow dans precedent/ (absent au premier lancement)
export function lirePrecedent(chemin) {
  try { return JSON.parse(fs.readFileSync(chemin, 'utf8')); } catch (e) { return null; }
}

export function questionsEnPlus(texte) {
  return String(texte || '').split(';').map(s => s.trim()).filter(Boolean).map((q, i) => ({ id: `plus${i + 1}`, q }));
}

// ─── Alerte (lancement automatique hebdomadaire) ────────────────────────────
// Ce qui mérite l'attention de l'utilisateur : contrôle en échec, écart avec un chiffre officiel,
// réponse qui a changé, données du ministère modifiées (nouvelle session…). Rien à signaler → null.
export function alerteEssai(res) {
  if (!res) return null;
  const echecs = (res.controles || []).filter(c => !c.ok);
  const ecarts = (res.verifs || []).filter(v => v.statut === 'ecart');
  const indispo = (res.verifs || []).filter(v => v.statut === 'indisponible');
  const cmp = res.comparaison;
  const changees = cmp ? cmp.lignes.filter(l => l.change) : [];
  const donnees = !!(cmp && cmp.donneesChangees);
  if (!echecs.length && !ecarts.length && !changees.length && !donnees) return null;
  const l = [];
  if (donnees) l.push(`📅 **Les données du ministère ont changé** : avant session ${cmp.precedent.session ?? '?'} (${(cmp.precedent.formations || 0).toLocaleString('fr-FR')} formations), maintenant session ${res.instantane?.session ?? '?'} (${(res.instantane?.formations || 0).toLocaleString('fr-FR')} formations). C'est normal à la publication d'une nouvelle session ; vérifiez le rapport.`, '');
  if (echecs.length) { l.push(`❌ **${echecs.length} contrôle${echecs.length > 1 ? 's' : ''} en échec :**`, ''); echecs.slice(0, 15).forEach(c => l.push(`- ${c.libelle} — ${c.detail}`)); l.push(''); }
  if (ecarts.length) { l.push(`❌ **${ecarts.length} écart${ecarts.length > 1 ? 's' : ''} avec les chiffres officiels :**`, ''); ecarts.forEach(v => l.push(`- « ${v.question} » : officiel ${v.officiel}, widget ${v.widget}`)); l.push(''); }
  if (changees.length) { l.push(`🔄 **${changees.length} réponse${changees.length > 1 ? 's ont' : ' a'} changé :**`, ''); changees.slice(0, 15).forEach(c => l.push(`- « ${c.question} » : ${c.avant} → ${c.apres}${c.ecart ? ` (${c.ecart})` : ''}`)); l.push(''); }
  if (indispo.length) l.push(`⚠️ ${indispo.length} chiffre(s) officiel(s) non vérifié(s) : API du ministère indisponible.`, '');
  const titre = echecs.length || ecarts.length ? 'Essai hebdomadaire : anomalie détectée' : donnees ? 'Essai hebdomadaire : données du ministère modifiées' : 'Essai hebdomadaire : réponses modifiées';
  return { titre, texte: l.join('\n') };
}

async function main() {
  let res;
  try {
    res = await essai({
      questions: [...QUESTIONS, ...questionsEnPlus(process.env.QUESTIONS_EN_PLUS)],
      mots: motsDiagnostic(process.env.DIAG_MOTS),
      precedent: lirePrecedent(process.env.ESSAI_PRECEDENT || 'precedent/essai_resultats.json'),
      contexte: { branche: process.env.GITHUB_REF_NAME || '', commit: (process.env.GITHUB_SHA || '').slice(0, 7) },
    });
  } catch (e) {
    const msg = `# Essai sur données réelles\n\n❌ Open data Parcoursup non chargé : ${e.message}\n`;
    console.error(msg);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, msg);
    fs.writeFileSync('essai_resultats.md', msg);
    fs.writeFileSync('essai_alerte.json', JSON.stringify({ titre: 'Essai hebdomadaire : open data non chargé', texte: `❌ L'open data Parcoursup n'a pas pu être chargé : ${e.message}\n\nLe site du ministère était peut-être indisponible. Si l'erreur se répète la semaine suivante, le format des données a peut-être changé.` }));
    process.exit(1);
  }
  console.log(res.texte);
  fs.writeFileSync('essai_resultats.md', res.texte);
  fs.writeFileSync('essai_resultats.json', JSON.stringify(res.instantane, null, 1));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, res.texte);
  const alerte = alerteEssai(res);
  if (alerte) fs.writeFileSync('essai_alerte.json', JSON.stringify(alerte));
  if (res.controles.some(c => !c.ok)) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
