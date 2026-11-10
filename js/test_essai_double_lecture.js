// test_essai_double_lecture.js — Script de l'essai « double lecture par Albert » (scripts/essai_double_lecture.mjs).
// Aucun appel réseau : Albert est simulé. On vérifie la mesure elle-même : lecture du moteur ramenée à une forme
// commune, comparaison à la lecture attendue, désaccord Albert / moteur, bilan (contresens rattrapés, fausses alertes).
// node js/test_essai_double_lecture.js

import { fileURLToPath } from 'url';
import path from 'path';
import * as D from './fixtures/donnees_simulees.mjs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { famille, ecartLecture, desaccord, lectureAlbert, essaiDoubleLecture, bilan, rapportDoubleLecture, LECTURES, schemaPourAlbert } = await import('../scripts/essai_double_lecture.mjs');

let passed = 0, failed = 0;
function assert(condition, label) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}`); failed++; }
}
async function describe(label, fn) {
  console.log(`\n${label}`);
  try { await fn(); } catch (e) { console.error(`  ✗ erreur : ${e.stack || e.message}`); failed++; }
}

await describe('Familles de colonnes : même langue pour le moteur, Albert et l\'attendu', () => {
  assert(famille("Académie de l'établissement d'accueil acceptée") === 'academie:acc', 'académie d\'accueil');
  assert(famille("Commune de l'établissement de la scolarité") === 'commune:ori', 'commune de scolarité');
  assert(famille('Filière de formation très agrégée') === 'formation', 'filière → formation');
  assert(famille("Statut de l'établissement de la filière de formation (public, privé…)") === 'statut', 'statut avant formation');
  assert(famille('Enseignement(s) de spécialité suivi(s)') === 'specialite_lycee', 'spécialités du lycée ≠ formation');
  assert(famille('A eu une proposition au cours de la procédure Parcoursup (Oui/Non)') === 'proposition' && famille('A actuellement répondu favorablement à une proposition (Oui/Non)') === 'admission', 'proposition ≠ admission');
});

await describe('Comparaisons', () => {
  const att = { op: 'compter', filtres: { commune: [['bordeaux'], ['pau']] } };
  assert(ecartLecture(att, { op: 'compter', filtres: { commune: [['bordeaux'], ['pau']] }, exclus: {} }) === null, 'lecture conforme : aucun écart');
  assert(/commune/.test(ecartLecture(att, { op: 'compter', filtres: { commune: [['bordeaux']] }, exclus: {} })), 'Pau oublié : écart');
  assert(/opération/.test(ecartLecture({ op: 'liste', objet: 'etablissements' }, { op: 'export', filtres: {}, exclus: {} })), 'export au lieu de liste : écart');
  assert(ecartLecture({ op: 'compter', filtres: { formation: [['management commercial']] } }, { op: 'compter', filtres: { formation: [['management'], ['commercial']] }, exclus: {} }) === null, 'mots rangés séparément : reconnus');
  // règle d'alerte (v2) : seulement les désaccords importants
  assert(/critère oublié/.test(desaccord({ op: 'compter', filtres: { commune: [['pau']] }, exclus: {} }, { op: 'compter', filtres: {}, exclus: {} })), 'critère cité par Albert, oublié par le moteur : alerte');
  assert(desaccord({ op: 'compter', filtres: { 'commune': [['bordeaux']] }, exclus: {} }, { op: 'compter', filtres: { 'commune:ori': [['bordeaux']] }, exclus: {} }) === null, 'commune / commune de scolarité : même famille');
  assert(/valeur oubliée.*pau/.test(desaccord({ op: 'compter', filtres: { commune: [['bordeaux'], ['pau']] }, exclus: {} }, { op: 'compter', filtres: { commune: [['bordeaux']] }, exclus: {} })), '« Bordeaux ou Pau », moteur Bordeaux seul : alerte « Pau oublié »');
  assert(desaccord({ op: 'compter', filtres: { formation: [['bts']] }, exclus: {} }, { op: 'compter', filtres: { formation: [['bts']], admission: [['oui']] }, exclus: {} }) === null, 'le moteur ajoute « admis » : pas d\'alerte');
  assert(desaccord({ op: 'compter', filtres: { formation: [['bts']] }, exclus: {} }, { op: 'repartition', groupe: 'academie', filtres: { formation: [['bts']] }, exclus: {} }) === null, 'le moteur détaille par académie : pas d\'alerte');
  assert(/opération/.test(desaccord({ op: 'compter_distinct', objet: 'academies', filtres: {}, exclus: {} }, { op: 'compter', filtres: {}, exclus: {} })), 'académies comptées comme des formations : alerte');
  assert(/opération/.test(desaccord({ op: 'liste', objet: 'etablissements', filtres: {}, exclus: {} }, { op: 'export', filtres: {}, exclus: {} })), 'liste demandée, export fait : alerte');
  assert(desaccord({ op: 'compter', groupe: 'academie', filtres: { formation: [['bts']] }, exclus: {} }, { op: 'repartition', groupe: 'academie', filtres: { formation: [['bts']] }, exclus: {} }) === null, '« compter regroupé par académie » = répartition par académie : pas d\'alerte');
  assert(desaccord({ op: 'compter', filtres: { formation: [['cpge']], academie: [['bordeaux']] }, exclus: {} }, { op: 'compter', filtres: { formation: [['cpge']], commune: [['bordeaux']] }, exclus: {} }) === null, '« à Bordeaux » : commune ou académie, même lieu : pas d\'alerte');
  assert(desaccord({ op: 'compter', filtres: { 'academie:acc': [['bordeaux']] }, exclus: {} }, { op: 'compter', filtres: {}, exclus: { 'academie:acc': [['bordeaux']] } }) === null, '« hors académie » : exclusion du moteur = critère présent');
  assert(/critère oublié/.test(desaccord({ op: 'compter', filtres: { academie: [['toulouse']] }, exclus: {} }, { op: 'compter', filtres: { commune: [['bordeaux']] }, exclus: {} })), 'lieu différent : alerte');
  assert(/exclusion oubliée/.test(desaccord({ op: 'compter', filtres: {}, exclus: { academie: [['bordeaux']] } }, { op: 'compter', filtres: {}, exclus: {} })), 'exclusion oubliée : alerte');
  assert(desaccord({ op: 'compter', filtres: {}, exclus: { commune: [['bordeaux']] } }, { op: 'compter', filtres: {}, exclus: { academie: [['bordeaux']] } }) === null, 'exclusion présente des deux côtés (colonne différente) : pas d\'alerte');
  assert(desaccord({ op: 'part', filtres: { proposition: [['non']] }, exclus: {} }, { op: 'part', groupe: 'departement', filtres: {}, exclus: {} }) === null, 'condition d\'une part rangée parmi les filtres par Albert : pas d\'alerte');
  assert(desaccord({ op: 'compter', filtres: { formation: [['x']] }, exclus: {} }, { op: 'arret', filtres: {}, exclus: {} }) === null, 'le moteur s\'est arrêté : rien à signaler');
});

await describe('Lecture d\'Albert (simulé) : JSON lu, colonnes ramenées aux familles', async () => {
  const table = D.tableOpenData(D.openData(500, 3));
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    assert(body.temperature === 0 && /UNIQUEMENT par un objet JSON/.test(body.messages[0].content) && /Colonnes :/.test(body.messages[0].content), 'consigne et colonnes envoyées, température 0');
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'Voici : {"operation":"compter","filtres":[{"colonne":"formation","valeurs":["BTS"]},{"colonne":"Département de l\'établissement","valeurs":["Gironde"]}],"exclusions":[],"regroupement":null}' } }] }) };
  };
  const r = await lectureAlbert(fetchImpl, table, ['combien de BTS en Gironde']);
  assert(r.lecture.op === 'compter' && r.lecture.filtres.formation && r.lecture.filtres.departement && r.lecture.groupe === null, 'opération, filtres et regroupement lus');
  assert(/Une ligne = une formation/.test(schemaPourAlbert(table)), 'schéma : unité des lignes');
});

await describe('Essai complet, Albert simulé : bilan cohérent', async () => {
  const tableOD = D.tableOpenData(D.openData(1500, 5));
  // Albert simulé : renvoie exactement la lecture attendue (lecture parfaite)
  const parQuestion = new Map(LECTURES.map(L => [L.q, L]));
  const fetchImpl = async (url, opts) => {
    const msg = JSON.parse(opts.body).messages[1].content;
    const q = msg.split('Question : ').pop();
    const L = parQuestion.get(q);
    const filtres = Object.entries(L.filtres || {}).map(([f, vals]) => ({ colonne: f === 'formation' ? 'formation' : { departement: "Département de l'établissement", commune: "Commune de l'établissement", academie: "Académie de l'établissement", statut: 'Statut', selectivite: 'Sélectivité', capacite: 'Capacité', etablissement: 'Établissement', proposition: 'A eu une proposition', admission: 'A actuellement répondu favorablement', boursier: 'Boursier des lycées', apprenti: 'Apprenti', serie: 'Série de la Classe', specialite_lycee: 'Enseignement(s) de spécialité suivi(s)', 'commune:ori': "Commune de l'établissement de la scolarité", 'commune:acc': "Commune de l'établissement d'accueil accepté", 'etablissement:ori': 'Etablissement de la scolarité', 'etablissement:acc': "Etablissement d'accueil accepté" }[f] || f, valeurs: vals.map(v => v[0]) }));
    const exclusions = Object.entries(L.exclus || {}).map(([f, vals]) => ({ colonne: { academie: "Académie de l'établissement", 'academie:acc': "Académie de l'établissement d'accueil acceptée" }[f] || f, valeurs: vals.map(v => v[0]) }));
    const groupe = L.groupe ? ({ academie: "Académie de l'établissement", formation: 'Filière de formation très agrégée', departement: "Département de l'établissement de la scolarité", etablissement: 'Établissement', 'etablissement:ori': 'Etablissement de la scolarité' }[L.groupe] || L.groupe) : null;
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ operation: [].concat(L.op)[0], objet: L.objet || null, filtres, exclusions, regroupement: groupe }) } }] }) };
  };
  const res = await essaiDoubleLecture({ fetchImpl, tableOD, lectures: LECTURES.slice(0, 12).concat(LECTURES.filter(L => L.src === 'fichier').slice(0, 6)) });
  const b = bilan(res);
  assert(b.albertRepond === res.length && b.albertErreurs === 0, `Albert a répondu à toutes les questions (${b.albertRepond})`);
  assert(b.albertJuste >= res.length - 2, `lecture d'Albert simulée conforme à l'attendu (${b.albertJuste} / ${res.length})`);
  assert(b.actuel.faussesAlertes <= 2, `peu de fausses alertes quand Albert et le moteur lisent juste (${b.actuel.faussesAlertes})`);
  const t = rapportDoubleLecture(res, b);
  assert(/## Résumé/.test(t) && /Moteur actuel/.test(t) && /## Détail/.test(t), 'rapport : résumé et détail');
  const enPanne = await essaiDoubleLecture({ fetchImpl: async () => ({ ok: false, status: 503 }), tableOD, lectures: LECTURES.slice(0, 2) });
  assert(enPanne.every(r => /HTTP 503/.test(r.albert.erreur)) && bilan(enPanne).albertErreurs === 2, 'Albert indisponible : erreur notée, pas de faux bilan');
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
