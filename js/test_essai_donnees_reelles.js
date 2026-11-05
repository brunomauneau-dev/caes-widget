// test_essai_donnees_reelles.js — Script d'essai sur données réelles (scripts/essai_donnees_reelles.mjs).
// Le script est lancé à la main depuis GitHub Actions sur l'open data réel ; ici l'API est simulée.
// Vérifie : chargement de l'open data par le vrai code du widget, réponses aux questions types,
// contrôles de cohérence (réussite ET détection d'une incohérence), rapport, erreur réseau.
// node js/test_essai_donnees_reelles.js

import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { QUESTIONS, essai, controler, rapport, questionsEnPlus } = await import('../scripts/essai_donnees_reelles.mjs');

let passed = 0, failed = 0;
function assert(condition, label) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}`); failed++; }
}
async function describe(label, fn) {
  console.log(`\n${label}`);
  try { await fn(); } catch (e) { console.error(`  ✗ erreur : ${e.message}`); failed++; }
}

// ─── API open data simulée (noms et libellés des champs comme l'API réelle) ──
const FIELDS = [
  ['session', 'Session', 'date'], ['contrat_etab', "Statut de l’établissement de la filière de formation (public, privé…)", 'text'],
  ['g_ea_lib_vx', 'Établissement', 'text'], ['ville_etab', 'Commune de l’établissement', 'text'], ['acad_mies', 'Académie de l’établissement', 'text'],
  ['fili', 'Filière de formation très agrégée', 'text'], ['form_lib_voe_acc', 'Filière de formation', 'text'],
  ['fil_lib_voe_acc', 'Filière de formation détaillée bis', 'text'], ['detail_forma', 'Filière de formation très détaillée', 'text'],
  ['capa_fin', 'Capacité de l’établissement par formation', 'int'], ['voe_tot', 'Effectif total des candidats pour une formation', 'int'],
];
const lignes = [];
const add = (n, v) => { for (let i = 0; i < n; i++) lignes.push(v.join(';')); };
add(30, [2025, 'Public', 'Université de Bordeaux', 'Bordeaux', 'Bordeaux', 'PASS', 'PASS', "Parcours d'Accès Spécifique Santé (PASS)", 'PASS option Droit', 50, 900]);
add(10, [2025, 'Privé sous contrat', 'Institut catholique', 'Toulouse', 'Toulouse', 'PASS', 'PASS', "Parcours d'Accès Spécifique Santé (PASS)", 'PASS option Droit', 40, 300]);
add(60, [2025, 'Public', 'Université de Bordeaux', 'Bordeaux', 'Bordeaux', 'PASS', 'PASS', "Parcours d'Accès Spécifique Santé (PASS)", 'PASS option Biologie', 60, 1200]);
add(300, [2025, 'Public', 'Lycée Gustave Eiffel', 'Bordeaux', 'Bordeaux', 'BTS', 'BTS - Services', 'BTS - Management Commercial Opérationnel', 'Management Commercial Opérationnel', 30, 400]);
add(200, [2025, 'Public', 'Faculté de Droit et Science politique', 'Pau', 'Bordeaux', 'Licence', 'Licence - Droit, économie, gestion', 'Licence - Droit', 'Droit', 200, 2500]);
const CSV = FIELDS.map(f => f[0]).join(';') + '\n' + lignes.join('\n');

let appels = [];
function fakeFetch(url) {
  const u = String(url);
  appels.push(u);
  const json = body => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
  if (!u.includes('fr-esr-parcoursup')) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}), text: () => Promise.resolve('') });
  if (u.includes('/facets')) return json({ facets: [{ name: 'session', facets: [{ name: '2025' }] }] });
  if (u.includes('/exports/csv')) return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(CSV) });
  return json({ fields: FIELDS.map(([name, label, type]) => ({ name, label, type })) });
}

// ─── Essai complet sur l'open data simulé ────────────────────────────────────
const res = await essai({ fetchImpl: fakeFetch });
const R = Object.fromEntries(res.resultats.map(r => [r.id, r]));

await describe('Chargement par le vrai code du widget', async () => {
  assert(res.table.objects.length === 600, `600 formations chargées (obtenu : ${res.table.objects.length})`);
  assert(res.table.headers.includes('Filière de formation très détaillée'), 'en-têtes lisibles (libellés officiels)');
  assert(appels.some(u => u.includes('/exports/csv')) && appels.some(u => u.includes('refine=session')), 'export CSV demandé pour la session détectée');
});

await describe('Réponses aux questions types', async () => {
  assert(R.pass.count === 100, `« combien de PASS » → 100 (obtenu : ${R.pass.reponse})`);
  assert(R.droit.count === 40, `« PASS option Droit » → 40 (obtenu : ${R.droit.reponse})`);
  assert(R.liste1.liste && R.liste1.lignes.length === 2, `liste des PASS : 2 options (obtenu : ${R.liste1.reponse})`);
  assert(R.zoologie.kind === 'unresolved', '« option Zoologie » → non trouvée');
  assert(R.definition.routee === false, '« qu\'est-ce que le PASS ? » → Albert');
  assert(R.suite.conversation.length === 2 && R.suite.conversation[1].filtres.some(f => /PASS/.test(f)), `suite « et pour les publics ? » : le filtre PASS est gardé (obtenu : ${R.suite.conversation[1].filtres.join(' ; ')})`);
});

await describe('Contrôles de cohérence : ceux de la correction PASS réussissent sur des données saines', async () => {
  // Les contrôles « à Bordeaux » et « publics » portent sur des limites du moteur antérieures à la correction PASS :
  // l'essai doit les évaluer et les signaler, sans que ce test présume de leur résultat.
  const pass = res.controles.filter(c => /PASS|liste|formulations|Zoologie|licences de droit|filière très agrégée|plus demandées|qu'est-ce|BTS|« combien de formations »/.test(c.libelle) && !/ne compte pas tout le fichier|statut public/.test(c.libelle));
  const echecs = pass.filter(c => !c.ok);
  assert(pass.length >= 12, `au moins 12 contrôles liés à la correction (obtenu : ${pass.length})`);
  assert(echecs.length === 0, `aucun échec (échecs : ${echecs.map(c => c.libelle + ' — ' + c.detail).join(' / ') || 'aucun'})`);
  assert(res.controles.some(c => /Bordeaux/.test(c.libelle)) && res.controles.some(c => /statut public/.test(c.libelle)), 'les contrôles « à Bordeaux » et « publics » sont bien évalués');
});

await describe('Contrôles de cohérence : détectent les incohérences (faux positifs interdits)', async () => {
  const copie = () => JSON.parse(JSON.stringify(res.resultats));
  let r = copie();
  r.find(x => x.id === 'droit').count = 14252; // ancien bug : tout le fichier
  let c = controler(r);
  assert(c.some(x => !x.ok && /PASS option Droit/.test(x.libelle)), '« PASS option Droit » = tout le fichier → contrôle en échec');
  r = copie();
  Object.assign(r.find(x => x.id === 'liste1'), { kind: 'export', liste: false });
  c = controler(r);
  assert(c.some(x => !x.ok && /pas un export/.test(x.libelle)), 'liste rendue en export → contrôle en échec');
  r = copie();
  Object.assign(r.find(x => x.id === 'zoologie'), { kind: 'count', count: 14252, total: 14252 });
  c = controler(r);
  assert(c.some(x => !x.ok && /Zoologie/.test(x.libelle)), 'option inconnue comptée → contrôle en échec');
  r = copie();
  r.find(x => x.id === 'bordeaux').termes = true;
  c = controler(r);
  assert(c.some(x => !x.ok && /Bordeaux/.test(x.libelle)), 'Bordeaux pris pour une formation → contrôle en échec');
  r = copie();
  r.find(x => x.id === 'liste2').lignes.pop();
  c = controler(r);
  assert(c.some(x => !x.ok && /deux formulations/.test(x.libelle)), 'deux formulations divergentes → contrôle en échec');
});

await describe('Rapport', async () => {
  assert(/^# Essai sur données réelles/.test(res.texte), 'titre');
  assert(/^## Cohérence : \d+ \/ \d+ contrôles réussis (✅|❌)$/m.test(res.texte), 'bilan des contrôles en tête');
  assert(res.texte.includes('combien de PASS option Droit') && res.texte.includes('PASS option Biologie : **60**'), 'questions et listes détaillées');
  const avecEchec = rapport(res.table, res.resultats, [{ libelle: 'test', ok: false, detail: 'a|b' }]);
  assert(/0 \/ 1 contrôles réussis ❌/.test(avecEchec) && avecEchec.includes('a\\|b'), 'échec signalé ❌ et tableau Markdown protégé');
});

await describe('Questions en plus (champ du formulaire GitHub)', async () => {
  const q = questionsEnPlus(' combien de BUT ; ;liste des options de LAS ');
  assert(q.length === 2 && q[0].q === 'combien de BUT' && q[1].id === 'plus2', 'séparées par « ; », vides ignorées');
  assert(questionsEnPlus('').length === 0, 'champ vide → aucune question en plus');
  const r = await essai({ fetchImpl: fakeFetch, questions: [...QUESTIONS, ...q] });
  assert(r.resultats.length === QUESTIONS.length + 2, 'questions en plus posées après les questions types');
});

await describe('Erreur réseau : message clair, pas de résultat inventé', async () => {
  let erreur = null;
  try { await essai({ fetchImpl: () => Promise.reject(new Error('réseau coupé')) }); } catch (e) { erreur = e; }
  assert(erreur && /réseau coupé|open data|HTTP|export|schéma/i.test(erreur.message), `erreur remontée (obtenu : ${erreur?.message})`);
});

await describe('Workflow GitHub', async () => {
  const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'essai-donnees-reelles.yml'), 'utf8');
  assert(/workflow_dispatch:/.test(yml) && !/\n\s*push:|\n\s*schedule:/.test(yml), 'lancement manuel uniquement');
  assert(/node scripts\/essai_donnees_reelles\.mjs/.test(yml), 'lance le script');
  assert(/QUESTIONS_EN_PLUS: \$\{\{ inputs\.questions \}\}/.test(yml) && !/run:.*inputs\./.test(yml), 'questions en plus passées par variable, jamais insérées dans la commande');
  assert(/contents: read/.test(yml) && !/secrets\./.test(yml), 'lecture seule, aucun secret');
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
