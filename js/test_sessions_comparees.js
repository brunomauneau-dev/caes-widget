// test_sessions_comparees.js — Comparer deux sessions de l'open data : « les places en BTS ont-elles augmenté
// depuis 2024 ? », « combien de BTS en 2024 ? ». Même calcul rejoué sur chaque session (comptage, somme, moyenne,
// part en points) ; colonnes rapprochées par le nom technique de l'API ; session chargée à la demande ; années
// futures ou non chargées → arrêt ; aucun filtre parasite tiré d'une année ; faux positifs (« compare A et B »).
// node js/test_sessions_comparees.js

import fs from 'fs';
import vm from 'vm';
import { fileURLToPath } from 'url';
import path from 'path';
import * as D from './fixtures/donnees_simulees.mjs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let passed = 0, failed = 0;
function assert(condition, label) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}`); failed++; }
}
async function describe(label, fn) {
  console.log(`\n${label}`);
  try { await fn(); } catch (e) { console.error(`  ✗ erreur : ${e.stack || e.message}`); failed++; }
}

// ─── Widget chargé comme dans le navigateur (modules ensemble) ───────────────
function makeCtx() {
  const noopEl = () => null;
  const ctx = {
    console: { ...console, log() {}, warn() {}, info() {} },
    setTimeout: () => null, clearTimeout() {}, URLSearchParams, TextDecoder, TextEncoder,
    document: { getElementById: noopEl, querySelector: noopEl, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => Promise.reject(new Error('hors ligne')),
    escapeHtml: s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  };
  ctx.XLSX = { utils: { json_to_sheet: () => ({}), book_new: () => ({}), book_append_sheet() {}, sheet_to_csv: () => '' }, writeFile() {} };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.selectedDocIds = new Set();
  vm.createContext(ctx);
  for (const f of ['config.js', 'knowledge.js', 'documents.js', 'planner.js', 'dataEngine.js', 'sessions.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
  }
  ctx.resetContextSilent = () => {};
  return ctx;
}
const run = (ctx, code) => vm.runInContext(code, ctx);
function ctxOpenData(lignes) {
  const ctx = makeCtx();
  ctx.__t = D.tableOpenData(lignes);
  run(ctx, "defaultOpenDataTable = __t; defaultOpenDataState = 'ready';");
  return ctx;
}
async function ctxCSV(rows, name = 'extraction.csv') {
  const ctx = makeCtx();
  const buf = new TextEncoder().encode(D.versCSV(rows));
  await run(ctx, 'importSpreadsheetFile')({ name, size: buf.length, arrayBuffer: async () => buf.buffer });
  return ctx;
}
// Question posée « à froid », comme une nouvelle conversation
function ask(ctx, q) {
  run(ctx, 'window.__DATA_ENGINE_STATE = { lastPlan: null, lastExecution: null, history: [] }');
  ctx.__q = q;
  const plan = run(ctx, 'isDataEngineQuestion(__q)') ? run(ctx, 'detectDataEnginePlan(__q)') : null;
  return plan ? run(ctx, 'runDataEnginePlan')(plan, []) : null;
}
// Pose une question dans la conversation en cours (sans remise à zéro)
function suite(ctx, q) {
  ctx.__q = q;
  const plan = run(ctx, 'isDataEngineQuestion(__q)') ? run(ctx, 'detectDataEnginePlan(__q)') : null;
  return plan ? run(ctx, 'runDataEnginePlan')(plan, []) : null;
}
const valeurs = e => (e?.result?.lignes || []).map(l => l.valeur);
const meme = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const proche = (a, b) => Math.abs(a - b) < 1e-9;

// Deux sessions simulées : 2025 (session courante, chargée au lancement) et 2024 (chargée à la demande)
const OD25 = D.openData(3000, 3);
const OD24 = D.openData(2700, 44).map(o => ({ ...o, session: 2024 }));
const avecChamps = (t, renommer = {}) => {
  const cles = Object.keys(D.OD);
  const headers = cles.map(k => renommer[k] || D.OD[k]);
  return { ...t, headers, objects: t.objects.map(o => Object.fromEntries(cles.map((k, i) => [headers[i], o[D.OD[k]]]))),
    champs: Object.fromEntries(cles.map((k, i) => [headers[i], D.OD_API[k]])), libelles: Object.fromEntries(cles.map((k, i) => [D.OD_API[k], headers[i]])) };
};
function ctxDeuxSessions({ renommer = {} } = {}) {
  const ctx = makeCtx();
  ctx.__t25 = { ...avecChamps(D.tableOpenData(OD25)), session: 2025 };
  ctx.__t24 = { ...avecChamps(D.tableOpenData(OD24, 'Parcoursup 2024 — France entière (open data)'), renommer), session: 2024, isDefault: false };
  run(ctx, "defaultOpenDataTable = __t25; defaultOpenDataState = 'ready'; openDataSessions.set(2024, __t24);");
  return ctx;
}
const n = (L, p) => L.filter(p).length;
const S = (L, p, f) => L.filter(p).reduce((t, o) => t + f(o), 0);
const bts = o => o.fili === 'BTS';

await describe('Évolution entre deux sessions : le même calcul sur chaque session', () => {
  const ctx = ctxDeuxSessions();
  let e = ask(ctx, 'les places en BTS ont-elles augmenté depuis 2024 ?');
  const p24 = S(OD24, bts, o => o.capa), p25 = S(OD25, bts, o => o.capa);
  assert(e && e.kind === 'evolution' && meme(e.result.lignes.map(l => [l.session, l.valeur]), [[2024, p24], [2025, p25]]), `places en BTS : 2024 = ${p24}, 2025 = ${p25} (obtenu : ${e?.kind} ${e?.result?.lignes?.map(l => l.valeur).join(' → ')})`);
  assert(e.result.ecart === p25 - p24 && proche(e.result.ecartPct, (p25 - p24) / p24 * 100), 'écart et évolution en % exacts');
  e = ask(ctx, 'évolution du nombre de BTS entre 2024 et 2025');
  assert(meme(e.result.lignes.map(l => l.valeur), [n(OD24, bts), n(OD25, bts)]), 'nombre de BTS dans chaque session');
  e = ask(ctx, 'évolution du nombre de BTS');
  assert(e.kind === 'evolution' && meme(e.result.lignes.map(l => l.session), [2024, 2025]), '« évolution » sans année : session précédente → session courante');
  e = ask(ctx, "évolution du nombre de BTS par rapport à l'an dernier");
  assert(e.kind === 'evolution' && e.result.lignes[0].session === 2024, '« par rapport à l\'an dernier » = session précédente');
  e = ask(ctx, 'capacité moyenne des BTS : évolution depuis 2024');
  assert(e.kind === 'evolution' && e.result.mesure === 'stats' && proche(e.result.lignes[0].valeur, S(OD24, bts, o => o.capa) / n(OD24, bts)), 'moyenne : évolution de la capacité moyenne');
  e = ask(ctx, 'part des boursiers parmi les admis en BTS par rapport à 2024');
  const pc = L => S(L, bts, o => o.acc_bours) / S(L, bts, o => o.acc_neobac) * 100;
  assert(e.kind === 'evolution' && e.result.mesure === 'part' && proche(e.result.lignes[0].valeur, pc(OD24)) && proche(e.result.ecart, pc(OD25) - pc(OD24)), 'part : écart en points de pourcentage');
  assert(/point/.test(e.html) && !/\(\+?−?[\d,]+ %\)/.test(e.html.match(/soit <strong>[^<]*<\/strong>/)[0]), '   … affiché en points, pas en % de %');
  assert(!(e.plan.filters || []).some(f => /^\d+$/.test(String(f.value)) && String(2024).includes(String(f.value))), '« 2024 » ne crée aucun filtre parasite (« 20 », « 24 », « 202 »)');
});

await describe('Une seule autre session ; années hors limites', () => {
  const ctx = ctxDeuxSessions();
  let e = ask(ctx, 'combien de BTS en 2024');
  assert(e.kind === 'count' && e.result.count === n(OD24, bts) && /session 2024/.test(e.html) && /open data Parcoursup 2024/.test(e.html), `« combien de BTS en 2024 » → ${n(OD24, bts)}, session 2024 indiquée`);
  e = ask(ctx, "combien de BTS l'an dernier");
  assert(e.kind === 'count' && e.result.count === n(OD24, bts), '« l\'an dernier » seul : la session précédente, pas une comparaison');
  e = ask(ctx, 'combien de BTS en 2025');
  assert(e.kind === 'count' && e.result.count === n(OD25, bts) && !e.plan.sessionsDemandees, 'session courante citée : calcul normal');
  e = ask(ctx, 'les formations les plus demandées en 2024');
  assert(e.kind === 'classement' && e.result.lignes[0].valeur === Math.max(...OD24.map(o => o.voe)), 'classement sur la session 2024');
  e = ask(ctx, 'combien de BTS en 2027');
  assert(e.kind === 'unresolved' && /n'est pas encore publiée/.test(e.text), 'année future : arrêt « pas encore publiée »');
  e = ask(ctx, 'combien de BTS en 2021');
  assert(e.kind === 'unresolved' && /n'a pas pu être chargée/.test(e.text), 'session non chargée : arrêt explicite, pas le chiffre de 2025');
  e = ask(ctx, 'évolution des formations les plus demandées depuis 2024');
  assert(e.kind === 'unresolved' && /comptages, sommes, moyennes et parts/.test(e.text), 'évolution d\'un classement : pas encore disponible, dit clairement');
});

await describe('Colonne renommée par le ministère entre deux sessions : rapprochée par le nom technique', () => {
  const ctx = ctxDeuxSessions({ renommer: { fili: 'Filière de formation (très agrégée)', capa: 'Capacité par formation' } });
  const e = ask(ctx, 'les places en BTS ont-elles augmenté depuis 2024 ?');
  assert(e.kind === 'evolution' && e.result.lignes[0].valeur === S(OD24, bts, o => o.capa), `libellés différents en 2024 : même filtre et même colonne retrouvés (obtenu : ${e?.result?.lignes?.[0]?.valeur ?? e?.text})`);
});

await describe('Faux positifs : rien ne change sans demande de comparaison', () => {
  const ctx = ctxDeuxSessions();
  assert(ask(ctx, 'combien de BTS').result.count === n(OD25, bts), '« combien de BTS » : session courante');
  assert(ask(ctx, 'combien de formations de plus de 100 places').kind === 'count', 'nombre dans une condition : pas une année');
  assert(!run(ctx, 'sessionsDeLaQuestion')(run(ctx, 'defaultOpenDataTable'), 'compare boursiers et non boursiers'), '« compare A et B » sans année : pas une comparaison de sessions');
  assert(!run(ctx, 'sessionsDeLaQuestion')(run(ctx, 'defaultOpenDataTable'), 'combien de formations entre Bordeaux et Toulouse'), '« entre Bordeaux et Toulouse » : pas une comparaison de sessions');
  const fichier = { source: 'Fichier', name: 'x.csv', headers: ['a'], objects: [{ a: 1 }] };
  assert(!run(ctx, 'sessionsDeLaQuestion')(fichier, 'évolution depuis 2024'), 'fichier importé : pas de session à comparer');
});

await describe('Relance, affichage, export, Albert', () => {
  const ctx = ctxDeuxSessions();
  ask(ctx, 'évolution du nombre de BTS depuis 2024');
  const r = suite(ctx, 'et pour les PASS ?');
  const pass = o => o.fili === 'PASS';
  assert(r && r.kind === 'evolution' && meme(r.result.lignes.map(l => l.valeur), [n(OD24, pass), n(OD25, pass)]), `« et pour les PASS ? » : même comparaison, sur les PASS (obtenu : ${r?.kind})`);
  const e = ask(ctx, 'évolution du nombre de BTS depuis 2024');
  const d = n(OD25, bts) - n(OD24, bts);
  assert(new RegExp(`Évolution 2024 → 2025 : ${d > 0 ? 'hausse' : 'baisse'} de ${d > 0 ? '\\+' : '−'}${Math.abs(d).toLocaleString('fr-FR').replace(/\s/g, '.')}`).test(e.html), 'titre : sens et écart');
  assert(/l'offre a changé entre les deux sessions/.test(e.html), 'avertissement : l\'offre de formations a changé');
  assert(/<table/.test(e.html) && /Calcul exact/.test(e.html) && /chaque session/.test(e.html), 'tableau par session, badge, périmètre');
  const contexte = run(ctx, 'dataEngineResultToContext')(e);
  assert(/session 2024 : \d+/.test(contexte) && /session 2025 : \d+/.test(contexte) && /Écart : -?\d+/.test(contexte), 'contexte Albert : valeurs et écart');
  assert(run(ctx, 'verifierChiffresAlbert')(`<p>De ${n(OD24, bts)} à ${n(OD25, bts)} BTS, soit ${d}.</p>`, [contexte]).inconnus.length === 0, 'Albert qui recopie les chiffres : aucun signalé');
  const x = run(ctx, 'currentExecutionToRows')(e);
  assert(x.length === 2 && x[0].Session === 2024 && x[1].Valeur === n(OD25, bts), 'export Excel : une ligne par session');
  assert(run(ctx, 'shouldAnswerLocallyWithoutAlbert')(e), 'réponse donnée par le widget');
  assert(meme(e.result.lignes.map(l => l.retenues), [n(OD24, bts), n(OD25, bts)]) && e.html.includes(`${n(OD24, bts).toLocaleString('fr-FR')} sur ${OD24.length.toLocaleString('fr-FR')}`), 'tableau : BTS retenus sur formations de la session (pas le total sur le total)');
  const pl = ask(ctx, 'les places en BTS ont-elles augmenté depuis 2024 ?');
  assert(pl.result.lignes[0].retenues === n(OD24, bts), 'somme : formations retenues = BTS de la session');
  const g = run(ctx, 'renderCurrentChartExecution')({ sourceExecution: e, question: 'graphique' });
  assert(g && g.kind === 'evolution' && (g.html.match(/data-bar-label="Session \d{4}"/g) || []).length === 2, 'bouton « Graphique » : une barre par session');
});

await describe('Chargement à la demande de la session précédente (API simulée)', async () => {
  const ctx = makeCtx();
  const appels = [];
  const champs = Object.keys(D.OD_API).map(k => ({ name: D.OD_API[k], label: D.OD[k], type: typeof OD24[0][k] === 'number' ? 'double' : 'text' }));
  const csv = [Object.keys(D.OD_API).map(k => D.OD_API[k]).join(';'), ...OD24.map(o => Object.keys(D.OD_API).map(k => String(o[k] ?? '').replace(/;/g, ',')).join(';'))].join('\n');
  ctx.fetch = async u => { appels.push(String(u)); return /exports\/csv/.test(u) ? { ok: true, text: async () => csv } : { ok: true, json: async () => ({ fields: champs }) }; };
  ctx.__t25 = { ...avecChamps(D.tableOpenData(OD25)), session: 2025 };
  run(ctx, "defaultOpenDataTable = __t25; defaultOpenDataState = 'ready';");
  const charges = await run(ctx, 'preparerSessionsDemandees')('les places en BTS ont-elles augmenté depuis 2024 ?');
  assert(JSON.stringify(charges) === '[2024]' && appels.some(u => /refine=session%3A2024/.test(u)), 'la session 2024 est téléchargée avant le calcul');
  const e = ask(ctx, 'les places en BTS ont-elles augmenté depuis 2024 ?');
  assert(e.kind === 'evolution' && e.result.lignes[0].valeur === S(OD24, bts, o => o.capa), 'puis comparée à 2025');
  const avant = appels.length;
  await run(ctx, 'preparerSessionsDemandees')('évolution du nombre de PASS depuis 2024');
  assert(appels.length === avant, 'déjà chargée : pas de nouveau téléchargement');
  assert((await run(ctx, 'preparerSessionsDemandees')('combien de BTS')).length === 0, 'question sans année : rien à charger');
  const albert = fs.readFileSync(path.join(__dirname, 'albert.js'), 'utf8');
  assert(/await preparerSessionsDemandees\(question\)/.test(albert) && albert.indexOf('await preparerSessionsDemandees') < albert.indexOf('let dataPlan = detectDataEnginePlan'), 'albert.js : chargement avant le calcul');
});

await describe('Session précédente absente du jeu principal : jeu archivé (« fr-esr-parcoursup_2024 »)', async () => {
  // le jeu principal ne garde que la dernière session (constaté sur l'API réelle : 0 formation pour 2024)
  const ctx = makeCtx();
  const appels = [];
  const champs = Object.keys(D.OD_API).map(k => ({ name: D.OD_API[k], label: D.OD[k], type: typeof OD24[0][k] === 'number' ? 'double' : 'text' }));
  const csv = [Object.keys(D.OD_API).map(k => D.OD_API[k]).join(';'), ...OD24.map(o => Object.keys(D.OD_API).map(k => String(o[k] ?? '').replace(/;/g, ',')).join(';'))].join('\n');
  const entete = csv.split('\n')[0];
  ctx.fetch = async u => {
    u = String(u); appels.push(u);
    const archive = /fr-esr-parcoursup_2024/.test(u);
    if (/exports\/csv/.test(u)) return { ok: true, text: async () => archive ? csv : entete }; // jeu principal : aucune ligne 2024
    return { ok: true, json: async () => ({ fields: champs }) };
  };
  ctx.__t25 = { ...avecChamps(D.tableOpenData(OD25)), session: 2025 };
  run(ctx, "defaultOpenDataTable = __t25; defaultOpenDataState = 'ready';");
  await run(ctx, 'preparerSessionsDemandees')('évolution du nombre de BTS depuis 2024');
  const t = run(ctx, 'getOpenDataSessionTable(2024)');
  assert(t && t.jeu === 'fr-esr-parcoursup_2024' && t.objects.length === OD24.length, `jeu principal vide pour 2024 → jeu archivé utilisé (obtenu : ${t?.jeu})`);
  assert(appels.findIndex(u => /fr-esr-parcoursup\/exports/.test(u)) < appels.findIndex(u => /fr-esr-parcoursup_2024\/exports/.test(u)), 'le jeu principal est essayé en premier');
  const e = ask(ctx, 'évolution du nombre de BTS depuis 2024');
  assert(e.kind === 'evolution' && e.result.lignes[0].valeur === n(OD24, bts), 'puis la comparaison est juste');
  // lignes d'une autre session renvoyées par erreur : refusées (jamais les chiffres 2025 présentés comme 2024)
  const ctx2 = makeCtx();
  const csv25 = csv.replace(/^2024;/gm, '2025;');
  ctx2.fetch = async u => /exports\/csv/.test(String(u)) ? { ok: true, text: async () => csv25 } : { ok: true, json: async () => ({ fields: champs }) };
  ctx2.__t25 = ctx.__t25; run(ctx2, "defaultOpenDataTable = __t25; defaultOpenDataState = 'ready';");
  await run(ctx2, 'preparerSessionsDemandees')('combien de BTS en 2024');
  assert(!run(ctx2, 'getOpenDataSessionTable(2024)'), 'lignes d\'une autre session : refusées');
  assert(ask(ctx2, 'combien de BTS en 2024').kind === 'unresolved', '… et la question s\'arrête (pas les chiffres 2025 sous l\'étiquette 2024)');
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
