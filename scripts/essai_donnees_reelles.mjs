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
  if (!exec) { r.reponse = routee ? 'Le moteur n\'a rien calculé' : 'Non traitée par le moteur : la question part vers Albert (connaissances)'; return r; }
  if (exec.kind === 'count') {
    r.count = exec.result.count; r.total = exec.result.total;
    r.reponse = `${r.count.toLocaleString('fr-FR')} sur ${r.total.toLocaleString('fr-FR')}`;
  } else if (exec.kind === 'group_by' || exec.kind === 'top') {
    r.total = exec.result.total; r.colonne = exec.plan?.targetCol; r.distinct = exec.result.distinct;
    r.lignes = (exec.result.rows || []).map(x => ({ value: x.value, count: x.count }));
    r.reponse = `${r.distinct ?? r.lignes.length} valeur(s) de « ${r.colonne} » pour ${r.total.toLocaleString('fr-FR')} formations`;
  } else if (exec.kind === 'unresolved') {
    r.suggestions = (exec.result?.suggestions || []).map(x => `${x.value} (${x.count})`);
    r.reponse = `Formation non trouvée (${(exec.result?.missing || []).join(', ') || 'termes jamais réunis'})`;
  } else if (exec.kind === 'export') {
    r.count = ctx.__exports[ctx.__exports.length - 1] ?? 0;
    r.reponse = `Export de ${r.count} lignes`;
  } else {
    r.reponse = `Résultat de type ${exec.kind}`;
  }
  return r;
}

// Pose toutes les questions ; chaque question (ou conversation) repart d'un contexte neuf
export function poserQuestions(table, questions = QUESTIONS) {
  return questions.map(item => {
    const ctx = creerMoteur({ table });
    if (item.conversation) return { id: item.id, conversation: item.conversation.map(q => resumer(ctx, q)) };
    return { id: item.id, ...resumer(ctx, item.q) };
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
  if (R.droit && R.pass) ctl('« PASS option Droit » : entre 1 et le nombre de PASS', R.droit.kind === 'count' && R.droit.count > 0 && R.droit.count < R.pass.count, `${R.droit.reponse} · PASS : ${R.pass.count ?? '?'}`);
  if (R.liste1) ctl('« liste complète des filières de PASS » : une liste, pas un export', R.liste1.kind === 'group_by' && R.liste1.liste, R.liste1.reponse);
  if (R.liste1 && R.pass) ctl('la liste des PASS couvre exactement les PASS comptés', R.liste1.total === R.pass.count && somme(R.liste1) === R.pass.count, `liste : ${R.liste1.total ?? '?'} · somme des lignes : ${somme(R.liste1)} · PASS : ${R.pass.count ?? '?'}`);
  if (R.liste1) ctl('la liste détaille plusieurs options', (R.liste1.lignes || []).length >= 2, `${(R.liste1.lignes || []).length} intitulé(s) dans « ${R.liste1.colonne || '?'} »`);
  if (R.liste1 && R.liste2) ctl('les deux formulations de la liste donnent le même résultat', R.liste2.kind === 'group_by' && valeurs(R.liste1) === valeurs(R.liste2), R.liste2.reponse);
  if (R.droit && R.liste1) {
    const ligneDroit = (R.liste1.lignes || []).find(x => /droit/i.test(x.value));
    ctl('« PASS option Droit » = la ligne Droit de la liste des PASS', ligneDroit && ligneDroit.count === R.droit.count, ligneDroit ? `liste : ${ligneDroit.value} = ${ligneDroit.count}` : 'aucune ligne « Droit » dans la liste');
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
  // Contrôle général : une question qui cite une formation ne doit jamais compter tout le fichier
  resultats.filter(r => r.kind === 'count' && r.id !== 'toutes').forEach(r => {
    if (r.count === r.total) ctl(`« ${r.question} » ne compte pas tout le fichier`, false, r.reponse);
  });
  return out;
}

// ─── Rapport ─────────────────────────────────────────────────────────────────
const cell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
export function rapport(table, resultats, controles) {
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
  lignes.push('## Réponses du moteur');
  lignes.push('');
  lignes.push('| Question | Réponse | Filtres appliqués |');
  lignes.push('|---|---|---|');
  const ligne = r => lignes.push(`| ${cell(r.question)} | ${cell(r.reponse)} | ${cell(r.filtres?.join(' ; ') || '—')} |`);
  resultats.forEach(r => r.conversation ? r.conversation.forEach(ligne) : ligne(r));
  resultats.filter(r => r.lignes?.length || r.suggestions?.length).forEach(r => {
    lignes.push('');
    lignes.push(`### « ${r.question} »`);
    lignes.push('');
    (r.lignes || []).slice(0, 30).forEach(x => lignes.push(`- ${x.value} : **${x.count.toLocaleString('fr-FR')}**`));
    if ((r.lignes || []).length > 30) lignes.push(`- … et ${r.lignes.length - 30} autres`);
    (r.suggestions || []).forEach(s => lignes.push(`- proposé : ${s}`));
  });
  return lignes.join('\n') + '\n';
}

export async function essai({ fetchImpl = globalThis.fetch, questions = QUESTIONS } = {}) {
  const table = await chargerOpenData(fetchImpl);
  const resultats = poserQuestions(table, questions);
  const controles = controler(resultats);
  return { table, resultats, controles, texte: rapport(table, resultats, controles) };
}

export function questionsEnPlus(texte) {
  return String(texte || '').split(';').map(s => s.trim()).filter(Boolean).map((q, i) => ({ id: `plus${i + 1}`, q }));
}

async function main() {
  let res;
  try {
    res = await essai({ questions: [...QUESTIONS, ...questionsEnPlus(process.env.QUESTIONS_EN_PLUS)] });
  } catch (e) {
    const msg = `# Essai sur données réelles\n\n❌ Open data Parcoursup non chargé : ${e.message}\n`;
    console.error(msg);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, msg);
    fs.writeFileSync('essai_resultats.md', msg);
    process.exit(1);
  }
  console.log(res.texte);
  fs.writeFileSync('essai_resultats.md', res.texte);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, res.texte);
  if (res.controles.some(c => !c.ok)) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
