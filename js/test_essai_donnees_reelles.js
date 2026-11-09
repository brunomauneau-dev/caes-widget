// test_essai_donnees_reelles.js — Script d'essai sur données réelles (scripts/essai_donnees_reelles.mjs).
// Le script est lancé à la main depuis GitHub Actions sur l'open data réel ; ici l'API est simulée.
// Vérifie : chargement de l'open data par le vrai code du widget, réponses aux questions types,
// contrôles de cohérence (réussite ET détection d'une incohérence), rapport, erreur réseau.
// node js/test_essai_donnees_reelles.js

import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { QUESTIONS, essai, controler, rapport, questionsEnPlus, instantane, comparer, lirePrecedent } = await import('../scripts/essai_donnees_reelles.mjs');

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
  ['lib_for_voe_ins', 'Filière de formation', 'text'], // même libellé que form_lib_voe_acc, comme dans l'API réelle
];
const lignes = [];
const add = (n, v) => { for (let i = 0; i < n; i++) lignes.push(v.join(';')); };
add(30, [2025, 'Public', 'Université de Bordeaux', 'Bordeaux', 'Bordeaux', 'PASS', 'PASS', "Parcours d'Accès Spécifique Santé (PASS)", 'PASS option Droit', 50, 900, 'PASS Bordeaux']);
add(10, [2025, 'Privé sous contrat', 'Institut catholique', 'Toulouse', 'Toulouse', 'PASS', 'PASS', "Parcours d'Accès Spécifique Santé (PASS)", 'PASS option Droit', 40, 300, 'PASS Toulouse']);
add(60, [2025, 'Public', 'Université de Bordeaux', 'Bordeaux', 'Bordeaux', 'PASS', 'PASS', "Parcours d'Accès Spécifique Santé (PASS)", 'PASS option Biologie', 60, 1200, 'PASS Bordeaux']);
add(300, [2025, 'Public', 'Lycée Gustave Eiffel', 'Bordeaux', 'Bordeaux', 'BTS', 'BTS - Services', 'BTS - Management Commercial Opérationnel', 'Management Commercial Opérationnel', 30, 400, 'BTS MCO Eiffel']);
add(200, [2025, 'Public', 'Faculté de Droit et Science politique', 'Pau', 'Bordeaux', 'Licence', 'Licence - Droit, économie, gestion', 'Licence - Droit', 'Droit', 200, 2500, 'Licence Droit Pau']);
const CSV = FIELDS.map(f => f[0]).join(';') + '\n' + lignes.join('\n');

// API « records » du ministère simulée : elle calcule elle-même count / sum / avg / group_by sur les lignes (chemin indépendant du widget)
const LIGNES_API = lignes.map(l => Object.fromEntries(FIELDS.map(([n], i) => [n, l.split(';')[i]])));
let fausserOfficiel = null; // pour vérifier qu'un écart est bien signalé
function agregatOfficiel(p) {
  let rows = LIGNES_API;
  const where = p.get('where') || '';
  for (const [, k, v] of where.matchAll(/(?:^|and )(\w+)="([^"]*)"/g)) rows = rows.filter(r => r[k] === v);
  for (const [, k, v] of where.matchAll(/\((\w+) is null or \w+!="([^"]*)"\)/g)) rows = rows.filter(r => r[k] !== v);
  const sel = p.get('select');
  const num = (r, c) => Number(r[c]);
  for (const [, k] of where.matchAll(/(\w+) is not null/g)) rows = rows.filter(r => r[k] !== '' && r[k] !== undefined);
  // classement : valeurs triées par le serveur
  if (p.get('order_by')) {
    const [c, sens] = p.get('order_by').split(' ');
    const vals = rows.map(r => num(r, c)).filter(Number.isFinite).sort((a, b) => sens === 'asc' ? a - b : b - a).slice(0, Number(p.get('limit')));
    return { results: vals.map(n => ({ n })) };
  }
  let n;
  if (p.get('group_by')) {
    const c = p.get('group_by'); const m = new Map();
    rows.forEach(r => m.set(r[c] || null, (m.get(r[c] || null) || 0) + 1));
    return { results: [...m].map(([cle, n]) => ({ cle, n })) };
  }
  if (/^count/.test(sel)) n = rows.length;
  else { const c = sel.match(/\((\w+)\)/)[1]; const vals = rows.map(r => num(r, c)).filter(Number.isFinite); n = /^sum/.test(sel) ? vals.reduce((a, b) => a + b, 0) : vals.reduce((a, b) => a + b, 0) / vals.length; }
  if (fausserOfficiel && fausserOfficiel(p)) n += 1;
  return { results: [{ n }] };
}
let appels = [];
function fakeFetch(url) {
  const u = String(url);
  appels.push(u);
  const json = body => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
  if (!u.includes('fr-esr-parcoursup')) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}), text: () => Promise.resolve('') });
  if (u.includes('/facets')) return json({ facets: [{ name: 'session', facets: [{ name: '2025' }] }] });
  if (u.includes('/exports/csv')) return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(CSV) });
  if (u.includes('/records?')) {
    // comme le vrai serveur : un champ inconnu → erreur 400
    const sel = new URL(u).searchParams.get('select');
    const champ = (sel.match(/\((\w+)\)/) || sel.match(/^(\w+) as n$/) || [])[1];
    if (champ && champ !== '*' && !FIELDS.some(([n]) => n === champ)) return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({}) });
    return json(agregatOfficiel(new URL(u).searchParams));
  }
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

await describe('Chargement : deux champs au même libellé gardent chacun leur colonne', async () => {
  const cols = res.table.headers.filter(h => /^Filière de formation( \(|$)/.test(h));
  assert(cols.length === 2 && cols.includes('Filière de formation (2)'), `deux colonnes distinctes (obtenu : ${cols.join(' | ')})`);
  assert(res.table.objects[0]['Filière de formation (2)'] === 'PASS Bordeaux' && res.table.objects[0]['Filière de formation'] === 'PASS', 'chaque colonne garde ses propres valeurs');
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
  const pass = res.controles.filter(c => /PASS|liste|formulations|Zoologie|licences de droit|filière très agrégée|plus demandées|qu'est-ce|BTS|« combien de formations »/.test(c.libelle) && !/ne compte pas tout le fichier|statut public|licences de droit » : entre|^reformulations/.test(c.libelle));
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

await describe('Contrôles adaptés au réel : une option absente des données n\'est pas une erreur', async () => {
  const r = JSON.parse(JSON.stringify(res.resultats));
  Object.assign(r.find(x => x.id === 'droit'), { kind: 'unresolved', count: undefined, reponse: 'Non reconnu' });
  r.find(x => x.id === 'liste1').lignes = r.find(x => x.id === 'liste1').lignes.filter(l => !/droit/i.test(l.value));
  r.find(x => x.id === 'liste1').sansValeur = r.find(x => x.id === 'pass').count - r.find(x => x.id === 'liste1').lignes.reduce((t, l) => t + l.count, 0);
  const c = controler(r);
  assert(c.find(x => /PASS option Droit » : un nombre plausible/.test(x.libelle))?.ok, '« option Droit » absente et signalée non trouvée → contrôle réussi');
  assert(c.find(x => /cohérent avec la liste/.test(x.libelle))?.ok, 'non trouvée ET aucune ligne Droit dans la liste → cohérent');
  assert(c.find(x => /lignes \+ sans valeur/.test(x.libelle))?.ok, 'somme des lignes + sans valeur = nombre de PASS');
  r.find(x => x.id === 'liste1').lignes.push({ value: 'PASS option Droit', count: 3 });
  assert(!controler(r).find(x => /cohérent avec la liste/.test(x.libelle))?.ok, 'non trouvée MAIS une ligne Droit dans la liste → incohérence détectée');
});

await describe('Diagnostic des colonnes de formation', async () => {
  assert(res.diag && res.diag.n === 100 && res.diag.colonnes.length >= 3, `diagnostic des 100 PASS sur les colonnes de formation (obtenu : ${res.diag?.n}, ${res.diag?.colonnes?.length} colonnes)`);
  assert(/## Diagnostic : colonnes de formation des PASS/.test(res.texte) && /\| 100 \/ 100 \|/.test(res.texte), 'tableau du diagnostic dans le rapport (remplissage)');
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

await describe('Comparaison avec le lancement précédent', async () => {
  const snap = res.instantane;
  assert(snap && snap.formations === 600 && snap.session === 2025 && snap.reponses.length > QUESTIONS.length, `instantané des réponses (obtenu : ${snap?.reponses?.length} réponses)`);
  assert(snap.reponses.some(r => r.question === 'combien de PASS' && r.valeur === 100), 'valeur numérique enregistrée (combien de PASS = 100)');
  assert(snap.reponses.some(r => /→ et pour les publics/.test(r.question)), 'les questions de suite sont enregistrées avec leur question de départ');
  // Premier lancement : pas de précédent
  const r0 = await essai({ fetchImpl: fakeFetch, precedent: null });
  assert(/## Évolution depuis le lancement précédent/.test(r0.texte) && /Pas de lancement précédent/.test(r0.texte), 'sans précédent : le rapport le dit');
  // Même données : aucun changement
  const r1 = await essai({ fetchImpl: fakeFetch, precedent: JSON.parse(JSON.stringify(snap)) });
  assert(r1.comparaison.changees === 0 && /Aucune réponse n'a changé/.test(r1.texte) && /Données identiques/.test(r1.texte), 'mêmes données : « aucune réponse n\'a changé »');
  // Précédent différent : changements et écarts signalés
  const avant = JSON.parse(JSON.stringify(snap));
  avant.formations = 580; avant.reponses.find(r => r.question === 'combien de PASS').valeur = 80;
  avant.reponses = avant.reponses.filter(r => r.question !== 'combien de BTS');
  const c = comparer(avant, snap);
  const ligne = c.lignes.find(l => l.question === 'combien de PASS');
  assert(c.donneesChangees && ligne.change && ligne.ecart === '+20 (+25,0 %)', `écart calculé (obtenu : ${ligne?.ecart})`);
  assert(c.nouvelles.includes('combien de BTS'), 'question absente avant : signalée comme nouvelle');
  const txt = rapport(res.table, res.resultats, res.controles, res.diag, c);
  assert(/Les données ont changé/.test(txt) && /\| combien de PASS \| 80 \| 100 \| \+20/.test(txt), 'tableau avant / maintenant dans le rapport');
  assert(comparer(null, snap) === null && comparer({ pas: 'de réponses' }, snap) === null, 'précédent absent ou illisible : pas de comparaison, pas d\'erreur');
  assert(lirePrecedent('/chemin/inexistant.json') === null, 'fichier précédent absent : ignoré');
  assert(!/## Évolution/.test(res.texte), 'sans demande de comparaison (tests), pas de section');
});

await describe('Workflow GitHub', async () => {
  const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'essai-donnees-reelles.yml'), 'utf8');
  // v27.14 — règle changée : lancement manuel ET automatique chaque lundi (alerte si quelque chose change) ; toujours jamais à chaque push
  assert(/workflow_dispatch:/.test(yml) && /\n\s*schedule:\s*\n\s*- cron: '\d+ \d+ \* \* 1'/.test(yml) && !/\n\s*push:/.test(yml), 'lancement manuel + automatique le lundi, jamais à chaque push');
  assert(/node scripts\/essai_donnees_reelles\.mjs/.test(yml), 'lance le script');
  assert(/QUESTIONS_EN_PLUS: \$\{\{ inputs\.questions \}\}/.test(yml) && !/run:.*inputs\./.test(yml), 'questions en plus passées par variable, jamais insérées dans la commande');
  assert(/contents: read/.test(yml) && !/secrets\./.test(yml), 'lecture seule, aucun secret');
  // v27.14 — seul droit d'écriture : ouvrir / commenter un ticket d'alerte, et seulement lors du lancement automatique
  assert(/actions: read/.test(yml) && !/actions: write|contents: write|pull-requests: write/.test(yml), 'droit de lire les lancements précédents ; jamais d\'écriture sur le code ni les lancements');
  assert(/issues: write/.test(yml) && /if: always\(\) && \(\(github\.event_name == 'schedule' && hashFiles\('essai_alerte\.json'\) != ''\) \|\| inputs\.tester_alerte\)/.test(yml), 'ticket d\'alerte : en lancement automatique s\'il y a quelque chose à signaler, ou sur demande (« tester l\'alerte »)');
  assert(/tester_alerte:[\s\S]*?type: boolean[\s\S]*?default: false/.test(yml), 'option « tester l\'alerte » : désactivée par défaut');
  assert(/gh issue list .*--state open .*Essai hebdomadaire/.test(yml) && /gh issue comment/.test(yml) && /gh issue create/.test(yml), 'un seul ticket ouvert à la fois : commentaire s\'il existe déjà');
  assert(!/\$\{\{ *(steps|inputs)\.[^}]*\}\}[^\n]*gh issue/.test(yml) && /--body-file alerte\.md/.test(yml), 'texte du ticket passé par fichier, jamais inséré dans la commande');
  assert(/continue-on-error: true/.test(yml) && /GITHUB_RUN_ID/.test(yml), 'récupération du précédent : jamais bloquante, exclut le lancement en cours');
  assert(/essai_resultats\.json/.test(yml), 'les réponses (JSON) sont gardées pour le lancement suivant');
});

await describe('v27.10 — Relances, colonne de répartition et périmètre dans l\'essai', async () => {
  const C = Object.fromEntries(res.controles.map(c => [c.libelle, c]));
  const nom = re => Object.keys(C).find(k => re.test(k));
  for (const re of [/et pour l'académie de Bordeaux/, /et pour les BTS/, /et par académie/, /« par statut »/, /« par couleur »/, /dit sur quoi il porte/]) {
    assert(nom(re) && C[nom(re)].ok, `contrôle réussi : ${nom(re) || re}`);
  }
  assert(!!nom(/« par région »/), 'contrôle « par région » évalué (pas de colonne Région dans ces données simulées : son résultat n\'est pas présumé)');
  assert(R.bts.perimetre && R.bts.perimetre.includes('300 formations retenues sur 600') && R.bts.perimetre.includes('open data Parcoursup 2025'), `périmètre enregistré pour chaque réponse (obtenu : ${R.bts.perimetre})`);
  assert(!R.zoologie.perimetre && !R.par_couleur.perimetre, 'pas de périmètre pour une question non reconnue (aucun chiffre calculé)');
  assert(res.texte.includes('| Question | Réponse | Sur quoi porte le calcul |') && res.texte.includes('300 formations retenues sur 600'), 'rapport : colonne « Sur quoi porte le calcul »');
  // Détection : les anciens bugs doivent faire échouer les contrôles
  const copie = () => JSON.parse(JSON.stringify(res.resultats));
  let r = copie(); Object.assign(r.find(x => x.id === 'suite_bts').conversation[1], { count: 100, filtres: ['Intitulé de formation contenant : « PASS »'] });
  assert(!controler(r).find(c => /et pour les BTS/.test(c.libelle)).ok, 'ancien bug « et pour les BTS ? » qui recompte les PASS → détecté');
  r = copie(); Object.assign(r.find(x => x.id === 'suite_bdx').conversation[1], { kind: 'unresolved', count: undefined });
  assert(!controler(r).find(c => /académie de Bordeaux \? » =/.test(c.libelle)).ok, 'ancien bug « Bordeaux perdu » → détecté');
  r = copie(); Object.assign(r.find(x => x.id === 'par_couleur'), { kind: 'group_by', colonne: "Académie de l'établissement" });
  assert(!controler(r).find(c => /par couleur/.test(c.libelle)).ok, 'répartition au hasard pour « par couleur » → détectée');
  r = copie(); delete r.find(x => x.id === 'bts').perimetre;
  assert(!controler(r).find(c => /dit sur quoi il porte/.test(c.libelle)).ok, 'résultat sans périmètre → détecté');
});

await describe('v27.11 — Reformulations dans l\'essai : même chiffre pour toutes les tournures', async () => {
  const reform = res.controles.filter(c => /^reformulations « /.test(c.libelle));
  assert(reform.length >= 6, `au moins 6 groupes de reformulations contrôlés (obtenu : ${reform.length})`);
  const bts = reform.find(c => /« nombre de BTS »/.test(c.libelle));
  assert(bts && bts.ok && /« nb de BTS » → 300/.test(bts.detail), `« nombre de BTS » : toutes les tournures donnent 300 (obtenu : ${bts?.detail})`);
  const r0 = JSON.parse(JSON.stringify(res.resultats));
  Object.assign(r0.find(x => x.id === 'selectives'), { kind: 'count', count: 400, total: 600 });
  Object.assign(r0.find(x => x.groupe === 'formations non sélectives'), { kind: 'count', count: 17, total: 600 });
  assert(controler(r0).find(c => /sélectives \+ non sélectives/.test(c.libelle))?.ok === false, 'bug « non sélectives » = 17 → détecté (400 + 17 ≠ 600)');
  Object.assign(r0.find(x => x.groupe === 'formations non sélectives'), { count: 200 });
  assert(controler(r0).find(c => /sélectives \+ non sélectives/.test(c.libelle))?.ok === true, 'cohérent (400 + 200 = 600) → réussi');
  const r = JSON.parse(JSON.stringify(res.resultats));
  Object.assign(r.find(x => x.groupe === 'nombre de BTS' && /nb de/.test(x.question)), { kind: 'count', count: 600 });
  assert(!controler(r).find(c => /« nombre de BTS »/.test(c.libelle)).ok, 'une tournure qui donne un autre chiffre → détectée');
  const r2 = JSON.parse(JSON.stringify(res.resultats));
  r2.filter(x => x.groupe === 'nombre de BTS').forEach(x => Object.assign(x, { kind: null, routee: false, count: undefined }));
  assert(!controler(r2).find(c => /« nombre de BTS »/.test(c.libelle)).ok, 'toutes les tournures parties vers Albert (aucun chiffre) → détecté, pas « identiques »');
});

await describe('v27.12 — Chiffres officiels : le widget retrouve à l\'unité les chiffres calculés par le serveur du ministère', async () => {
  const { REFERENCES, requeteOfficielle, verifierOfficiels, sectionOfficiels } = await import('../scripts/essai_donnees_reelles.mjs');
  const V = Object.fromEntries(res.verifs.map(v => [v.id, v]));
  assert(res.verifs.length === REFERENCES.length && REFERENCES.length >= 15, `${REFERENCES.length} chiffres officiels interrogés`);
  const req = decodeURIComponent(requeteOfficielle(REFERENCES.find(r => r.id === 'ref_bts_bdx'), 2025));
  assert(/\/records\?select=count\(\*\)\+as\+n/.test(req) && /where=fili="BTS"\+and\+acad_mies="Bordeaux"/.test(req) && /refine=session:2025/.test(req), 'requête au serveur : comptage filtré, session du widget');
  assert(/where=\(contrat_etab\+is\+null\+or\+contrat_etab!="Public"\)/.test(decodeURIComponent(requeteOfficielle(REFERENCES.find(r => r.id === 'ref_prive'), 2025))), '« privées » = statut différent de Public, cases vides comprises');
  assert(V.ref_bts.statut === 'ok' && V.ref_bts.officiel === 300 && V.ref_bts.widget === 300, `« combien de BTS » : officiel 300 = widget 300 (obtenu : ${V.ref_bts.officiel} / ${V.ref_bts.widget})`);
  assert(V.ref_places_bts.statut === 'ok' && V.ref_places_bts.officiel === 9000, 'somme : places en BTS identiques');
  assert(V.ref_capa_moy_bts.statut === 'ok', 'moyenne : capacité moyenne des BTS identique');
  assert(V.ref_par_filiere.statut === 'ok', `répartition par filière : chaque valeur identique (${V.ref_par_filiere.detail})`);
  assert(res.controles.some(c => /^chiffre officiel : « combien de BTS »/.test(c.libelle) && c.ok), 'chaque chiffre officiel est un contrôle du bilan');
  assert(/## Chiffres officiels \(calculés par le serveur du ministère\) : \d+ \/ \d+ identiques/.test(res.texte), 'section « Chiffres officiels » dans le rapport');
  // Écart d'une seule unité → détecté
  fausserOfficiel = p => /fili="BTS"/.test(p.get('where') || '') && /^count/.test(p.get('select'));
  const res2 = await essai({ fetchImpl: fakeFetch, questions: [] });
  fausserOfficiel = null;
  const v2 = res2.verifs.find(v => v.id === 'ref_bts');
  assert(v2.statut === 'ecart' && v2.officiel === 301 && /écart : -1/.test(v2.detail), `écart d'une unité signalé (obtenu : ${v2.statut} ${v2.detail})`);
  assert(res2.controles.some(c => /« combien de BTS »/.test(c.libelle) && !c.ok) && /❌/.test(res2.texte.match(/## Chiffres officiels.*$/m)[0]), 'écart → contrôle en échec, section ❌');
  // API indisponible : signalé, pas compté comme réussi ni comme échec
  const sansApi = u => String(u).includes('/records?') ? Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }) : fakeFetch(u);
  const res3 = await essai({ fetchImpl: sansApi, questions: [] });
  assert(res3.verifs.every(v => v.statut === 'indisponible') && !res3.controles.some(c => /chiffre officiel/.test(c.libelle)), 'API indisponible : chiffres « non vérifiés », ni réussis ni échoués');
  assert(/⚠️ \d+ chiffres non vérifiés : API du ministère indisponible/.test(res3.texte), 'API indisponible : avertissement dans le rapport');
  // Répartition : une valeur manquante ou des cases vides mal comptées → écart
  const faux = verifierOfficiels({ g: { valeur: { BTS: 300, PASS: 100, '(vide)': 4 } } }, [{ id: 'g', kind: 'group_by', reponse: 'x', sansValeur: 0, lignes: [{ value: 'BTS', count: 300 }] }], [{ id: 'g', q: 'g', type: 'group' }]);
  assert(faux[0].statut === 'ecart' && /PASS : officiel 100, widget absent/.test(faux[0].detail) && /sans valeur : officiel 4, widget 0/.test(faux[0].detail), 'répartition : valeur absente et cases vides → écarts détaillés');
  assert(V.ref_admis_bts.statut === 'indisponible' && /HTTP 400/.test(V.ref_admis_bts.detail), 'champ absent des données (admis) : non vérifié, pas un faux « identique »');
  assert(R.ref_admis_bts === undefined && res.verifs.length, 'questions de référence posées à part (pas mélangées aux questions de l\'essai)');
  // v27.14 — classements : mêmes valeurs, même ordre que le tri du serveur
  assert(V.ref_top_demandees.statut === 'ok' && /10 valeurs identiques, même ordre/.test(V.ref_top_demandees.detail), `classement « les plus demandées » identique au tri du serveur (obtenu : ${V.ref_top_demandees.statut} ${V.ref_top_demandees.detail} · officiel ${V.ref_top_demandees.officiel} · widget ${V.ref_top_demandees.widget})`);
  assert(V.ref_top_places_bdx.statut === 'ok', `classement « le plus de places à Bordeaux » identique (obtenu : ${V.ref_top_places_bdx.officiel} / ${V.ref_top_places_bdx.widget})`);
  assert(/order_by=voe_tot\+desc/.test(requeteOfficielle(REFERENCES.find(r => r.id === 'ref_top_demandees'), 2025)) && /voe_tot\+is\+not\+null/.test(requeteOfficielle(REFERENCES.find(r => r.id === 'ref_top_demandees'), 2025)), 'requête de classement : tri par le serveur, valeurs vides exclues (comme le widget)');
  const vt = verifierOfficiels({ t: { valeur: [9, 8, 7] } }, [{ id: 't', kind: 'classement', valeurs: [9, 7, 8], reponse: 'x' }], [{ id: 't', q: 't', type: 'top' }]);
  assert(vt[0].statut === 'ecart', 'classement dans un autre ordre → écart');
  assert(sectionOfficiels([]).length === 0 && sectionOfficiels(null).length === 0, 'aucune référence : pas de section');
});

await describe('v27.14 — Alerte de l\'essai hebdomadaire', async () => {
  const { alerteEssai } = await import('../scripts/essai_donnees_reelles.mjs');
  const base = { controles: [{ libelle: 'a', ok: true, detail: '' }], verifs: [{ statut: 'ok' }], instantane: { session: 2025, formations: 14252 },
    comparaison: { precedent: { session: 2025, formations: 14252 }, donneesChangees: false, lignes: [{ question: 'q', avant: 1, apres: 1, change: false }] } };
  assert(alerteEssai(base) === null, 'tout est normal : aucune alerte (pas de ticket chaque semaine pour rien)');
  assert(alerteEssai({ ...base, comparaison: undefined }) === null, 'premier lancement (pas de précédent) : aucune alerte');
  assert(alerteEssai({ ...base, verifs: [{ statut: 'indisponible' }] }) === null, 'API du ministère seulement indisponible : pas d\'alerte (non vérifié n\'est pas une anomalie)');
  const echec = alerteEssai({ ...base, controles: [{ libelle: 'chiffre officiel : « combien de BTS »', ok: false, detail: 'officiel 5351 · widget 5350' }] });
  assert(echec && /anomalie/.test(echec.titre) && /1 contrôle en échec/.test(echec.texte) && /combien de BTS/.test(echec.texte), 'contrôle en échec → alerte « anomalie détectée », avec le détail');
  const ecart = alerteEssai({ ...base, verifs: [{ statut: 'ecart', question: 'combien de PASS', officiel: 287, widget: 286 }] });
  assert(ecart && /officiel 287, widget 286/.test(ecart.texte), 'écart avec un chiffre officiel → alerte');
  const change = alerteEssai({ ...base, comparaison: { ...base.comparaison, lignes: [{ question: 'combien de BTS', avant: 5351, apres: 5400, change: true, ecart: '+49 (+0,9 %)' }] } });
  assert(change && /réponses modifiées/.test(change.titre) && /5351 → 5400 \(\+49/.test(change.texte), 'réponse qui change → alerte « réponses modifiées »');
  const session = alerteEssai({ ...base, instantane: { session: 2026, formations: 14500 }, comparaison: { ...base.comparaison, donneesChangees: true } });
  assert(session && /données du ministère modifiées/.test(session.titre) && /session 2025.*session 2026/.test(session.texte), 'nouvelle session publiée → alerte « données modifiées »');
  assert(alerteEssai(null) === null, 'sans résultat : pas d\'erreur');
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
