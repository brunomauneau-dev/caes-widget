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
export function creerMoteur({ fetchImpl, table = null } = {}) {
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
  return ctx;
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
  if (exec && exec.kind !== 'unresolved' && exec.kind !== 'export' && typeof ctx.perimetreResultat === 'function') r.perimetre = ctx.perimetreResultat(exec.kind, exec.plan, exec.result).texte.replace(/^Périmètre : /, '') || undefined;
  if (!exec) { r.reponse = routee ? 'Le moteur n\'a rien calculé' : 'Non traitée par le moteur : la question part vers Albert (connaissances)'; return r; }
  if (exec.kind === 'count') {
    r.count = exec.result.count; r.total = exec.result.total;
    r.reponse = `${r.count.toLocaleString('fr-FR')} sur ${r.total.toLocaleString('fr-FR')}`;
  } else if (exec.kind === 'group_by' || exec.kind === 'top') {
    r.total = exec.result.total; r.colonne = exec.plan?.targetCol; r.distinct = exec.result.distinct;
    r.sansValeur = exec.result.filled !== undefined ? exec.result.total - exec.result.filled : 0;
    r.lignes = (exec.result.rows || []).map(x => ({ value: x.value, count: x.count }));
    r.reponse = `${r.distinct ?? r.lignes.length} valeur(s) de « ${r.colonne} » pour ${r.total.toLocaleString('fr-FR')} formations`;
  } else if (exec.kind === 'sum') {
    r.sum = exec.result.sum; r.count = exec.result.count; r.colonne = exec.result.col;
    r.reponse = `${r.sum.toLocaleString('fr-FR')} ${exec.result.unite} (somme de « ${r.colonne} ») sur ${r.count.toLocaleString('fr-FR')} formations`;
  } else if (exec.kind === 'stats') {
    r.moyenne = exec.result.avg; r.colonne = exec.plan?.targetCol;
    r.reponse = `moyenne ${Number(r.moyenne).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} (colonne « ${r.colonne} »)`;
  } else if (exec.kind === 'unresolved') {
    r.suggestions = (exec.result?.suggestions || []).map(x => `${x.value} (${x.count})`);
    r.reponse = `Non reconnu, pas de chiffre (${(exec.result?.missing || []).join(', ') || 'termes jamais réunis'})`;
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

export function poserQuestions(table, questions = QUESTIONS) {
  return questions.map(item => {
    const ctx = creerMoteur({ table });
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
  // v27.11 — reformulations : même chiffre pour toutes les tournures d'une même question
  const groupes = {};
  resultats.filter(r => r.groupe).forEach(r => (groupes[r.groupe] = groupes[r.groupe] || []).push(r));
  Object.entries(groupes).forEach(([g, rs]) => {
    const vals = rs.map(valeurReponse);
    const ok = vals.every(v => v === vals[0]) && rs.every(r => ['count', 'sum', 'stats', 'group_by', 'top'].includes(r.kind));
    ctl(`reformulations « ${g} » : même chiffre pour les ${rs.length} tournures`, ok, rs.map(r => `« ${r.question} » → ${valeurReponse(r)}`).join(' · '));
  });
  // Chaque résultat chiffré porte son périmètre
  const chiffres = resultats.flatMap(r => r.conversation || [r]).filter(r => ['count', 'sum', 'group_by', 'top', 'stats'].includes(r.kind));
  if (chiffres.length) ctl('chaque résultat chiffré dit sur quoi il porte (périmètre)', chiffres.every(r => r.perimetre && /retenues? sur/.test(r.perimetre)), `${chiffres.filter(r => r.perimetre).length} / ${chiffres.length}`);

  // Contrôle général : une question qui cite une formation ne doit jamais compter tout le fichier
  resultats.filter(r => r.kind === 'count' && r.id !== 'toutes').forEach(r => {
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

export function rapport(table, resultats, controles, diag = null, cmp = undefined) {
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
export async function essai({ fetchImpl = globalThis.fetch, questions = QUESTIONS, precedent = undefined, contexte = {} } = {}) {
  const table = await chargerOpenData(fetchImpl);
  const resultats = poserQuestions(table, questions);
  const controles = controler(resultats);
  const diag = diagnosticColonnes(table);
  const snap = instantane(table, resultats, contexte);
  const cmp = precedent === undefined ? undefined : comparer(precedent, snap);
  return { table, resultats, controles, diag, instantane: snap, comparaison: cmp, texte: rapport(table, resultats, controles, diag, cmp) };
}

// Instantané du lancement précédent, déposé par le workflow dans precedent/ (absent au premier lancement)
export function lirePrecedent(chemin) {
  try { return JSON.parse(fs.readFileSync(chemin, 'utf8')); } catch (e) { return null; }
}

export function questionsEnPlus(texte) {
  return String(texte || '').split(';').map(s => s.trim()).filter(Boolean).map((q, i) => ({ id: `plus${i + 1}`, q }));
}

async function main() {
  let res;
  try {
    res = await essai({
      questions: [...QUESTIONS, ...questionsEnPlus(process.env.QUESTIONS_EN_PLUS)],
      precedent: lirePrecedent(process.env.ESSAI_PRECEDENT || 'precedent/essai_resultats.json'),
      contexte: { branche: process.env.GITHUB_REF_NAME || '', commit: (process.env.GITHUB_SHA || '').slice(0, 7) },
    });
  } catch (e) {
    const msg = `# Essai sur données réelles\n\n❌ Open data Parcoursup non chargé : ${e.message}\n`;
    console.error(msg);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, msg);
    fs.writeFileSync('essai_resultats.md', msg);
    process.exit(1);
  }
  console.log(res.texte);
  fs.writeFileSync('essai_resultats.md', res.texte);
  fs.writeFileSync('essai_resultats.json', JSON.stringify(res.instantane, null, 1));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, res.texte);
  if (res.controles.some(c => !c.ok)) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
