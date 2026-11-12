// essai_double_lecture.mjs — Étape 2 de fiabilité, essai MESURÉ (rien ne change dans le widget en service).
// Question : si Albert relisait chaque question et que l'on comparait sa lecture à celle du moteur, combien de
// contresens du moteur seraient signalés, et combien de fausses alertes sur des réponses justes ?
// Méthode : pour chaque question, la lecture attendue est écrite à la main (LECTURES ci-dessous). On compare à :
//   - l'ancien moteur (avant les séries de corrections : contresens connus),
//   - le moteur actuel,
//   - la lecture d'Albert (JSON : opération, objet, filtres, regroupement), obtenue par le proxy du widget.
// Une « alerte » = la lecture d'Albert diffère de celle du moteur. Mesures : alertes sur les erreurs du moteur
// (contresens rattrapés), alertes sur ses bonnes réponses (fausses alertes), délai d'Albert.
// Données : open data Parcoursup réel (chargé comme le widget) + export de candidats FICTIF (js/fixtures).
// Lancement : Actions → « Essai double lecture (Albert) » → Run workflow. Lecture seule.
// ANCIEN_JS : dossier des fichiers de l'ancien moteur (le workflow les extrait de l'historique git).

import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';
import { chargerOpenData, chargerSessionPrecedente } from './essai_donnees_reelles.mjs';
import * as D from '../js/fixtures/donnees_simulees.mjs';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const JS_DIR = path.join(ICI, '..', 'js');
const MODULES = ['config.js', 'knowledge.js', 'documents.js', 'planner.js', 'dataEngine.js', 'sessions.js'];
// Logique partagée avec le widget (js/verification.js), chargée dans un contexte isolé : ce qui est mesuré ici
// est exactement ce qui tourne dans le widget
const V = (() => {
  const ctx = vm.createContext({ console, setTimeout, clearTimeout, AbortController, Date, JSON });
  vm.runInContext(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js', 'verification.js'), 'utf8'), ctx, { filename: 'verification.js' });
  const get = n => vm.runInContext(n, ctx);
  return { nrm: get('_nrmVerif'), famille: get('familleVerif'), famillesEgales: get('famillesEgalesVerif'), lectureMoteur: get('lectureMoteurVerif'), desaccord: get('desaccordVerif'), schemaPourAlbert: get('schemaPourAlbertVerif'), demanderLectureAlbert: get('demanderLectureAlbert'), lireLectureAlbert: get('lireLectureAlbert') };
})();
const nrm = V.nrm, famillesEgales = V.famillesEgales, lectureMoteur = V.lectureMoteur;
export const famille = V.famille, desaccord = V.desaccord, schemaPourAlbert = V.schemaPourAlbert;
const ENDPOINT = process.env.ALBERT_ENDPOINT || 'https://albert-proxy.bruno-mauneau.workers.dev/v1/chat/completions';
const MODELE = process.env.ALBERT_MODELE || 'openweight-large';


// ─── Lectures attendues (écrites à la main) ──────────────────────────────────
// op : compter | compter_distinct | somme | statistique | liste | repartition | classement | part | comparaison |
//      evolution | export | pdf ; objet (compter_distinct, liste) ; groupe (famille de colonne) ; filtres
// (famille → mots attendus, l'un d'eux suffit par valeur ; plusieurs valeurs = « l'un ou l'autre ») ; exclus.
// conv : questions précédentes de la même conversation (la lecture porte sur la dernière).
export const LECTURES = [
  // Open data
  { id: 'od1', src: 'od', q: 'combien de BTS', op: 'compter', filtres: { formation: [['bts']] } },
  { id: 'od2', src: 'od', q: 'combien de BTS en Gironde', op: 'compter', filtres: { formation: [['bts']], departement: [['gironde']] } },
  { id: 'od3', src: 'od', q: 'combien de BTS MCO en gironde ?', op: 'compter', filtres: { formation: [['management commercial', 'mco']], departement: [['gironde']] } },
  { id: 'od4', src: 'od', conv: ['combien de BTS MCO en gironde ?'], q: 'donne moi la liste', op: 'liste', objet: 'etablissements', filtres: { formation: [['management commercial', 'mco']], departement: [['gironde']] } },
  { id: 'od5', src: 'od', q: 'donne moi la liste des établissements proposant un BTS MCO en gironde', op: 'liste', objet: 'etablissements', filtres: { formation: [['management commercial', 'mco']], departement: [['gironde']] } },
  { id: 'od6', src: 'od', q: 'quels établissements proposent le BTS MCO en Gironde', op: 'liste', objet: 'etablissements', filtres: { formation: [['management commercial', 'mco']], departement: [['gironde']] } },
  { id: 'od7', src: 'od', q: "combien d'académies proposent des PASS", op: 'compter_distinct', objet: 'academies', filtres: { formation: [['pass', 'acces specifique sante']] } },
  { id: 'od8', src: 'od', q: 'combien de communes ont un BTS', op: 'compter_distinct', objet: 'communes', filtres: { formation: [['bts']] } },
  { id: 'od9', src: 'od', q: 'quelles académies proposent des PASS', op: ['liste', 'repartition'], groupe: 'academie', filtres: { formation: [['pass', 'acces specifique sante']] } },
  { id: 'od10', src: 'od', q: 'combien de formations à Bordeaux ou à Pau', op: 'compter', filtres: { commune: [['bordeaux'], ['pau']] } },
  { id: 'od11', src: 'od', q: 'combien de formations en Gironde et dans les Landes', op: 'compter', filtres: { departement: [['gironde'], ['landes']] } },
  { id: 'od12', src: 'od', q: 'combien de BTS et de BUT', op: 'compter', filtres: { formation: [['bts'], ['but']] } },
  { id: 'od13', src: 'od', q: 'combien de formations hors Bordeaux et hors Toulouse', op: 'compter', exclus: { academie: [['bordeaux'], ['toulouse']] } },
  { id: 'od14', src: 'od', q: 'nombre de places en BTS', op: 'somme', filtres: { formation: [['bts']] } },
  { id: 'od15', src: 'od', q: 'nombre de places en BTS par académie', op: ['somme', 'repartition'], groupe: 'academie', filtres: { formation: [['bts']] } },
  { id: 'od16', src: 'od', q: 'répartition des BTS par académie', op: 'repartition', groupe: 'academie', filtres: { formation: [['bts']] } },
  { id: 'od17', src: 'od', q: "taux d'accès moyen des BTS", op: 'statistique', filtres: { formation: [['bts']] } },
  { id: 'od18', src: 'od', q: "taux d'accès moyen par académie", op: 'statistique', groupe: 'academie' },
  { id: 'od19', src: 'od', q: 'part des boursiers parmi les admis en BTS', op: 'part', filtres: { formation: [['bts']] } },
  { id: 'od20', src: 'od', q: 'part des boursiers par académie', op: 'part', groupe: 'academie' },
  { id: 'od21', src: 'od', q: 'pourcentage de formations sélectives par filière', op: 'part', groupe: 'formation' },
  { id: 'od22', src: 'od', q: 'les 10 BTS les plus sélectifs', op: 'classement', filtres: { formation: [['bts']] } },
  { id: 'od23', src: 'od', q: 'quelles sont les formations les plus demandées', op: 'classement' },
  { id: 'od24', src: 'od', q: 'les académies avec le plus de places', op: 'classement', groupe: 'academie' },
  { id: 'od25', src: 'od', q: 'quels lycées proposent le plus de BTS', op: 'classement', groupe: 'etablissement', filtres: { formation: [['bts']], etablissement: [['lycee']] } },
  { id: 'od26', src: 'od', q: 'combien de lycées proposent des BTS', op: 'compter_distinct', objet: 'etablissements', filtres: { formation: [['bts']], etablissement: [['lycee']] } },
  { id: 'od27', src: 'od', q: 'combien de formations publiques en Gironde', op: 'compter', filtres: { statut: [['public']], departement: [['gironde']] } },
  { id: 'od28', src: 'od', q: "combien de formations non sélectives dans l'académie de Bordeaux", op: 'compter', filtres: { selectivite: [['non selective']], academie: [['bordeaux']] } },
  { id: 'od29', src: 'od', q: 'combien de BTS dans le 33', op: 'compter', filtres: { formation: [['bts']], departement: [['gironde', '33']] } },
  { id: 'od30', src: 'od', q: 'combien de licences de droit', op: 'compter', filtres: { formation: [['licence'], ['droit']] }, tous: true },
  { id: 'od31', src: 'od', q: 'combien de formations de plus de 100 places', op: 'compter', filtres: { capacite: [['100']] } },
  { id: 'od32', src: 'od', conv: ['combien de BTS', 'combien sont publics'], q: 'et parmi eux combien sont sélectifs', op: 'compter', filtres: { formation: [['bts']], statut: [['public']], selectivite: [['selective']] } },
  { id: 'od33', src: 'od', conv: ['combien de PASS'], q: 'et pour les BTS ?', op: 'compter', filtres: { formation: [['bts']] } },
  { id: 'od34', src: 'od', conv: ['combien de BTS'], q: 'et par académie ?', op: 'repartition', groupe: 'academie', filtres: { formation: [['bts']] } },
  { id: 'od35', src: 'od', conv: ['combien de BTS MCO en gironde ?'], q: 'exporte', op: 'export', filtres: { formation: [['management commercial', 'mco']], departement: [['gironde']] } },
  { id: 'od36', src: 'od', q: 'comparer le lycée Montaigne et le lycée Camille Jullian', op: 'comparaison' },
  { id: 'od37', src: 'od', q: 'évolution du nombre de BTS depuis 2024', op: 'evolution', filtres: { formation: [['bts']] } },
  { id: 'od38', src: 'od', q: 'Bonjour, pourriez-vous me dire combien il y a de CPGE à Bordeaux ?', op: 'compter', filtres: { formation: [['cpge']], commune: [['bordeaux']] } },
  { id: 'od39', src: 'od', q: 'combien de formations au lycée Montaigne', op: 'compter', filtres: { etablissement: [['montaigne']] } },
  { id: 'od40', src: 'od', q: 'combien de CPGE et de PASS par académie', op: 'repartition', groupe: 'academie', filtres: { formation: [['cpge'], ['pass', 'acces specifique sante']] } },
  { id: 'od41', src: 'od', q: 'combien de BTS ou de BUT en Gironde', op: 'compter', filtres: { formation: [['bts'], ['but']], departement: [['gironde']] } },
  { id: 'od42', src: 'od', conv: ['donne moi la liste des établissements proposant un BTS MCO en gironde'], q: 'exporte cette liste en pdf', op: 'pdf' },
  // Export de candidats (fictif)
  { id: 'c1', src: 'fichier', q: 'combien de candidats ont eu une proposition', op: 'compter', filtres: { proposition: [['oui']] } },
  { id: 'c2', src: 'fichier', q: 'combien de candidats sans proposition', op: 'compter', filtres: { proposition: [['non']] } },
  { id: 'c3', src: 'fichier', q: 'combien de candidats en droit', op: 'compter', filtres: { formation: [['droit']] } },
  { id: 'c4', src: 'fichier', q: 'combien de candidats ayant la spécialité droit et économie', op: 'compter', filtres: { specialite_lycee: [['droit et economie', 'droit']] } },
  { id: 'c5', src: 'fichier', q: 'combien de candidats de bac technologique', op: 'compter', filtres: { serie: [['technologique']] } },
  { id: 'c6', src: 'fichier', q: 'combien de candidats STMG', op: 'compter', filtres: { serie: [['stmg', 'management et de la gestion']] } },
  { id: 'c7', src: 'fichier', q: 'combien de candidats scolarisés à Bordeaux', op: 'compter', filtres: { 'commune:ori': [['bordeaux']] } },
  { id: 'c8', src: 'fichier', q: 'combien de candidats de Pau', op: 'compter', filtres: { 'commune:ori': [['pau']] } },
  { id: 'c9', src: 'fichier', q: 'combien de candidats admis à Bordeaux', op: 'compter', filtres: { 'commune:acc': [['bordeaux']], admission: [['oui']] } },
  { id: 'c10', src: 'fichier', q: 'combien de candidats partent hors académie', op: 'compter', exclus: { 'academie:acc': [['bordeaux']] } },
  { id: 'c11', src: 'fichier', q: 'taux de proposition des boursiers', op: 'part', filtres: { boursier: [['boursier']] } },
  { id: 'c12', src: 'fichier', q: 'pourcentage de candidats sans proposition par département', op: 'part', groupe: 'departement' },
  { id: 'c13', src: 'fichier', q: 'combien de candidats du lycée Montaigne', op: 'compter', filtres: { 'etablissement:ori': [['montaigne']] } },
  { id: 'c14', src: 'fichier', q: 'combien de candidats admis au lycée Montaigne', op: 'compter', filtres: { 'etablissement:acc': [['montaigne']], admission: [['oui']] } },
  { id: 'c15', src: 'fichier', q: 'combien de candidats en apprentissage admis en BTS', op: 'compter', filtres: { apprenti: [['oui']], admission: [['oui']], formation: [['bts']] } },
  { id: 'c16', src: 'fichier', conv: ['combien de candidats du lycée Montaigne'], q: 'combien ont eu une proposition', op: 'compter', filtres: { 'etablissement:ori': [['montaigne']], proposition: [['oui']] } },
  { id: 'c17', src: 'fichier', conv: ['combien de candidats du lycée Montaigne', 'combien ont eu une proposition'], q: 'et parmi eux combien de boursiers', op: 'compter', filtres: { 'etablissement:ori': [['montaigne']], proposition: [['oui']], boursier: [['boursier']] } },
  { id: 'c18', src: 'fichier', q: 'quel lycée a le plus de candidats admis en CPGE', op: 'classement', groupe: 'etablissement:ori', filtres: { formation: [['cpge']], admission: [['oui']] } },
  { id: 'c19', src: 'fichier', q: 'combien de candidats admis en BTS ou en BUT', op: 'compter', filtres: { formation: [['bts'], ['dut', 'but']], admission: [['oui']] } },
  { id: 'c20', src: 'fichier', q: "combien de candidats ont eu une proposition et l'ont acceptée", op: 'compter', filtres: { proposition: [['oui']], admission: [['oui']] } },
  { id: 'c21', src: 'fichier', q: 'combien de candidats ayant suivi les spécialités maths et physique', op: 'compter', filtres: { specialite_lycee: [['mathematiques', 'maths'], ['physique']] }, tous: true },
  { id: 'c22', src: 'fichier', q: 'combien de communes ont des boursiers', op: 'compter_distinct', objet: 'communes', filtres: { boursier: [['boursier']] } },
  { id: 'c23', src: 'fichier', q: 'combien de bac pro', op: 'compter', filtres: { serie: [['professionnel']] } },
  { id: 'c24', src: 'fichier', q: 'combien de candidats de Dordogne admis à Toulouse', op: 'compter', filtres: { departement: [['dordogne']], 'commune:acc': [['toulouse']], admission: [['oui']] } },
];

// Questions NOUVELLES (jamais utilisées pour régler la règle d'alerte) : validation, pour mesurer honnêtement
export const LECTURES_VALIDATION = [
  { id: 'v1', src: 'od', q: 'combien de BUT en Nouvelle-Aquitaine', op: 'compter', filtres: { formation: [['but']], region: [['nouvelle aquitaine']] } },
  { id: 'v2', src: 'od', q: 'combien de CPGE privées', op: 'compter', filtres: { formation: [['cpge']] }, exclus: { statut: [['public']] } }, // « privé » = non public
  { id: 'v3', src: 'od', q: 'nombre de places en licence à Toulouse', op: 'somme', filtres: { formation: [['licence']], commune: [['toulouse']] } },
  { id: 'v4', src: 'od', q: 'combien de départements proposent un BTS MCO', op: 'compter_distinct', objet: 'departements', filtres: { formation: [['management commercial', 'mco']] } },
  { id: 'v5', src: 'od', q: 'combien de lycées proposent une CPGE en Gironde', op: 'compter_distinct', objet: 'etablissements', filtres: { formation: [['cpge']], departement: [['gironde']], etablissement: [['lycee']] } },
  { id: 'v6', src: 'od', q: 'quels établissements proposent une licence de psychologie à Bordeaux', op: 'liste', objet: 'etablissements', filtres: { formation: [['licence'], ['psychologie']], commune: [['bordeaux']] } },
  { id: 'v7', src: 'od', q: 'combien de formations dans les Landes ou en Dordogne', op: 'compter', filtres: { departement: [['landes'], ['dordogne']] } },
  { id: 'v8', src: 'od', q: 'combien de BTS hors académie de Bordeaux', op: 'compter', filtres: { formation: [['bts']] }, exclus: { academie: [['bordeaux']] } },
  { id: 'v9', src: 'od', q: 'capacité moyenne des CPGE par académie', op: 'statistique', groupe: 'academie', filtres: { formation: [['cpge']] } },
  { id: 'v10', src: 'od', q: 'part des formations privées en Gironde', op: 'part', filtres: { departement: [['gironde']] } },
  { id: 'v11', src: 'od', q: 'les 5 licences les plus demandées', op: 'classement', filtres: { formation: [['licence']] } },
  { id: 'v12', src: 'od', q: 'répartition des CPGE par statut', op: 'repartition', groupe: 'statut', filtres: { formation: [['cpge']] } },
  { id: 'v13', src: 'od', conv: ['combien de PASS en France'], q: 'et en Gironde ?', op: 'compter', filtres: { formation: [['pass', 'acces specifique sante']], departement: [['gironde']] } },
  { id: 'v14', src: 'od', conv: ['combien de licences de droit'], q: 'quels établissements ?', op: 'liste', objet: 'etablissements', filtres: { formation: [['licence'], ['droit']] } },
  { id: 'v15', src: 'od', q: 'combien de communes de Gironde ont une CPGE', op: 'compter_distinct', objet: 'communes', filtres: { formation: [['cpge']], departement: [['gironde']] } },
  { id: 'v16', src: 'od', q: 'combien de BTS en apprentissage à Pau', op: 'compter', filtres: { formation: [['bts'], ['apprentissage']], commune: [['pau']] } },
  { id: 'v17', src: 'od', q: 'nombre de candidats en PASS par académie', op: ['somme', 'repartition'], groupe: 'academie', filtres: { formation: [['pass', 'acces specifique sante']] } },
  { id: 'v18', src: 'od', q: 'exporte les CPGE de Bordeaux en Excel', op: 'export', filtres: { formation: [['cpge']], academie: [['bordeaux']] } }, // « de Bordeaux » = l'académie (convention)
  { id: 'v19', src: 'fichier', q: 'combien de boursiers admis hors académie', op: 'compter', filtres: { boursier: [['boursier']], admission: [['oui']] }, exclus: { 'academie:acc': [['bordeaux']] } },
  { id: 'v20', src: 'fichier', q: 'combien de candidats des Landes ont eu une proposition', op: 'compter', filtres: { departement: [['landes']], proposition: [['oui']] } },
  { id: 'v21', src: 'fichier', q: 'combien de candidats de la spécialité SES admis en droit', op: 'compter', filtres: { specialite_lycee: [['economiques', 'ses']], formation: [['droit']], admission: [['oui']] } },
  { id: 'v22', src: 'fichier', q: 'part des bac pro admis en BTS', op: 'part', filtres: { formation: [['bts']] } },
  { id: 'v23', src: 'fichier', q: 'taux de proposition par série', op: 'part', groupe: 'serie' },
  { id: 'v24', src: 'fichier', q: 'combien de candidats du lycée Victor Louis sans proposition', op: 'compter', filtres: { 'etablissement:ori': [['victor louis']], proposition: [['non']] } },
  { id: 'v25', src: 'fichier', q: 'quels lycées envoient le plus de candidats en école de commerce', op: 'classement', groupe: 'etablissement:ori', filtres: { formation: [['commerce']] } },
  { id: 'v26', src: 'fichier', q: 'combien de candidats admis à Paris ou à Toulouse', op: 'compter', filtres: { 'commune:acc': [['paris'], ['toulouse']], admission: [['oui']] } },
  { id: 'v27', src: 'fichier', conv: ['combien de candidats de bac technologique'], q: 'dont combien de boursiers', op: 'compter', filtres: { serie: [['technologique']], boursier: [['boursier']] } },
  { id: 'v28', src: 'fichier', q: 'combien de candidats du privé admis en CPGE', op: 'compter', filtres: { statut: [['prive']], formation: [['cpge']], admission: [['oui']] } },
  { id: 'v29', src: 'fichier', q: 'combien d\'académies accueillent des candidats en licence', op: 'compter_distinct', objet: 'academies', filtres: { formation: [['licence', 'l1']] } },
  { id: 'v30', src: 'fichier', q: 'nombre moyen de vœux des candidats de Gironde', op: 'statistique', filtres: { departement: [['gironde']] } },
];

// ─── Comparaison d'une lecture à l'attendu (ou de deux lectures) ─────────────
function valeursCouvrent(attendues, obtenues) {
  // chaque valeur attendue (liste de mots possibles) doit se retrouver dans l'une des valeurs obtenues
  const flat = obtenues.flat().map(nrm).join(' | ');
  const colle = obtenues.flat().map(nrm).join(' '); // mots rangés séparément (« management », « commercial »)
  return attendues.every(choix => choix.some(m => flat.includes(nrm(m)) || colle.includes(nrm(m))));
}
function blocCouvre(att = {}, obt = {}) {
  const fa = Object.keys(att), fo = Object.keys(obt);
  for (const f of fa) {
    const g = fo.find(x => famillesEgales(x, f) || (f === 'formation' && x === 'formation'));
    if (!g || !valeursCouvrent(att[f], obt[g])) return `filtre ${f} : attendu ${JSON.stringify(att[f])}, obtenu ${g ? JSON.stringify(obt[g]) : 'absent'}`;
  }
  const enTrop = fo.filter(x => !fa.some(f => famillesEgales(x, f)));
  if (enTrop.length) return `filtre en trop : ${enTrop.join(', ')}`;
  return null;
}
export function ecartLecture(att, obt) {
  const ops = [].concat(att.op);
  if (!ops.includes(obt.op)) return `opération : attendu ${ops.join(' ou ')}, obtenu ${obt.op}`;
  if (att.objet && nrm(att.objet) !== nrm(obt.objet || '')) return `objet : attendu ${att.objet}, obtenu ${obt.objet || '—'}`;
  if (att.groupe && !famillesEgales(obt.groupe || '', att.groupe)) return `regroupement : attendu ${att.groupe}, obtenu ${obt.groupe || '—'}`;
  if (!['comparaison', 'pdf', 'evolution'].includes(ops[0])) {
    const e1 = blocCouvre(att.filtres, obt.filtres); if (e1) return e1;
    const e2 = blocCouvre(att.exclus, obt.exclus); if (e2) return `exclusion — ${e2}`;
  }
  return null;
}
// ─── Moteurs ────────────────────────────────────────────────────────────────
function creerCtx(dir) {
  const noopEl = () => null;
  const ctx = {
    console: { ...console, log() {}, warn() {}, info() {} }, setTimeout: () => null, clearTimeout() {}, URLSearchParams, TextDecoder, TextEncoder,
    document: { getElementById: noopEl, querySelector: noopEl, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, click() {} }) },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, fetch: () => Promise.reject(new Error('pas de réseau')),
    escapeHtml: s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  };
  ctx.XLSX = { utils: { json_to_sheet: () => ({}), book_new: () => ({}), book_append_sheet() {}, sheet_to_csv: () => '', sheet_to_json: () => [], aoa_to_sheet: () => ({}), sheet_add_aoa() {} }, writeFile() {} };
  ctx.Blob = class {};
  ctx.window = ctx; ctx.globalThis = ctx; ctx.selectedDocIds = new Set();
  vm.createContext(ctx);
  for (const f of MODULES) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  ctx.resetContextSilent = () => {};
  return ctx;
}
export async function creerMoteurs(dir, tableOD, rowsFichier, autresSessions = []) {
  const od = creerCtx(dir);
  od.__t = tableOD; vm.runInContext("defaultOpenDataTable = __t; defaultOpenDataState = 'ready';", od);
  autresSessions.filter(Boolean).forEach(t => { od.__autre = t; try { vm.runInContext('openDataSessions.set(__autre.session, __autre)', od); } catch (e) { /* ancien moteur sans sessions */ } });
  const fi = creerCtx(dir);
  fi.XLSX.read = () => ({ SheetNames: ['BDD'], Sheets: { BDD: 'ws' } });
  fi.XLSX.utils.sheet_to_json = () => rowsFichier.map(r => r.slice());
  await vm.runInContext('importSpreadsheetFile', fi)({ name: 'BDD_candidats.xlsx', size: 1000, arrayBuffer: async () => new ArrayBuffer(8) });
  return { od, fichier: fi };
}
function poser(ctx, questions) {
  vm.runInContext('window.__DATA_ENGINE_STATE = { lastPlan: null, lastExecution: null, history: [] }', ctx);
  ctx.blocsDeLaConversation = () => [{ html: '<p class="de-perimetre"></p>', titre: 'réponse précédente', calcule: true }];
  ctx.imprimerRapport = () => true;
  let exec = null;
  for (const q of questions) {
    ctx.__q = q;
    try {
      const plan = vm.runInContext('isDataEngineQuestion(__q)', ctx) ? vm.runInContext('detectDataEnginePlan(__q)', ctx) : null;
      exec = plan ? vm.runInContext('runDataEnginePlan', ctx)(plan, []) : null;
    } catch (e) { exec = { kind: 'erreur', plan: {}, text: e.message }; }
  }
  return exec;
}

// ─── Albert ─────────────────────────────────────────────────────────────────
export async function lectureAlbert(fetchImpl, table, questions) {
  return V.demanderLectureAlbert(questions, table, { fetchImpl, endpoint: ENDPOINT, modele: MODELE, delaiMaxMs: 60000 });
}

// ─── Essai ──────────────────────────────────────────────────────────────────
export async function essaiDoubleLecture({ fetchImpl = globalThis.fetch, tableOD, autresSessions = [], ancienDir = null, lectures = LECTURES, albert = true } = {}) {
  const rows = D.exportAcademique(4000, 21);
  const actuel = await creerMoteurs(JS_DIR, tableOD, rows, autresSessions);
  const ancien = ancienDir ? await creerMoteurs(ancienDir, tableOD, rows, autresSessions) : null;
  const tables = { od: tableOD, fichier: vm.runInContext('getActiveQueryTables()[0]', actuel.fichier) };
  const res = [];
  for (const L of lectures) {
    const qs = [...(L.conv || []), L.q];
    const mA = lectureMoteur(poser(actuel[L.src], qs));
    const mO = ancien ? lectureMoteur(poser(ancien[L.src], qs)) : null;
    let al = null, erreurAlbert = null;
    if (albert) { try { al = await lectureAlbert(fetchImpl, tables[L.src], qs); } catch (e) { erreurAlbert = e.message; } }
    res.push({ id: L.id, question: qs.join(' >> '),
      actuel: { lecture: mA, ecart: ecartLecture(L, mA) },
      ancien: mO ? { lecture: mO, ecart: ecartLecture(L, mO) } : null,
      albert: al ? { lecture: al.lecture, ecart: ecartLecture(L, al.lecture), ms: al.ms, brut: al.brut } : { erreur: erreurAlbert },
      alerteActuel: al ? desaccord(al.lecture, mA) : null,
      alerteAncien: al && mO ? desaccord(al.lecture, mO) : null });
  }
  return res;
}
export function bilan(res) {
  const ok = r => r && !r.ecart;
  const avecAlbert = res.filter(r => r.albert && r.albert.lecture);
  const stat = (cle) => {
    const lignes = avecAlbert.filter(r => r[cle]);
    // arrêt (« critère non reconnu ») ou question laissée à Albert : pas un chiffre faux, compté à part
    const sansChiffre = r => ['arret', 'albert', 'erreur'].includes(r[cle].lecture.op);
    const faux = lignes.filter(r => !ok(r[cle]) && !sansChiffre(r)), justes = lignes.filter(r => ok(r[cle]));
    const alerte = r => !!r[cle === 'actuel' ? 'alerteActuel' : 'alerteAncien'];
    return { total: lignes.length, faux: faux.length, justes: justes.length, sansChiffre: lignes.filter(r => !ok(r[cle]) && sansChiffre(r)).length, rattrapes: faux.filter(alerte).length, faussesAlertes: justes.filter(alerte).length };
  };
  const ms = avecAlbert.map(r => r.albert.ms).sort((a, b) => a - b);
  return {
    questions: res.length, albertRepond: avecAlbert.length, albertErreurs: res.length - avecAlbert.length,
    albertJuste: avecAlbert.filter(r => ok(r.albert)).length,
    actuel: stat('actuel'), ancien: res.some(r => r.ancien) ? stat('ancien') : null,
    delaiMedianMs: ms.length ? ms[Math.floor(ms.length / 2)] : null, delaiMaxMs: ms.length ? ms[ms.length - 1] : null,
  };
}
export function rapportDoubleLecture(res, b) {
  const pct = (a, n) => n ? `${Math.round(a / n * 100)} %` : '—';
  const l = ['# Essai double lecture (Albert)', '', `Modèle : ${MODELE} · questions : ${process.env.JEU || 'réglage'}`, '',
    `${b.questions} questions · Albert a répondu à ${b.albertRepond} (${b.albertErreurs} erreurs d'appel) · délai médian ${b.delaiMedianMs ?? '—'} ms, max ${b.delaiMaxMs ?? '—'} ms`, '',
    '## Résumé', '', '| | Chiffres faux du moteur (contresens) | … signalés par Albert (rattrapés) | Lectures justes du moteur | … signalées à tort (fausses alertes) | Arrêts / laissés à Albert |', '|---|---|---|---|---|---|'];
  if (b.ancien) l.push(`| Ancien moteur | ${b.ancien.faux} | ${b.ancien.rattrapes} (${pct(b.ancien.rattrapes, b.ancien.faux)}) | ${b.ancien.justes} | ${b.ancien.faussesAlertes} (${pct(b.ancien.faussesAlertes, b.ancien.justes)}) | ${b.ancien.sansChiffre} |`);
  l.push(`| Moteur actuel | ${b.actuel.faux} | ${b.actuel.rattrapes} (${pct(b.actuel.rattrapes, b.actuel.faux)}) | ${b.actuel.justes} | ${b.actuel.faussesAlertes} (${pct(b.actuel.faussesAlertes, b.actuel.justes)}) | ${b.actuel.sansChiffre} |`);
  l.push('', `Lecture d'Albert juste (comparée à l'attendu) : ${b.albertJuste} / ${b.albertRepond} (${pct(b.albertJuste, b.albertRepond)}).`, '',
    '## Détail', '', '| Question | Ancien moteur | Alerte (ancien) | Moteur actuel | Albert | Alerte (actuel) |', '|---|---|---|---|---|---|');
  const c = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  res.forEach(r => l.push(`| ${c(r.question)} | ${r.ancien ? (r.ancien.ecart ? `❌ ${c(r.ancien.ecart)}` : '✅') : '—'} | ${r.alerteAncien ? `🔔 ${c(r.alerteAncien)}` : ''} | ${r.actuel.ecart ? `❌ ${c(r.actuel.ecart)}` : '✅'} | ${r.albert.lecture ? (r.albert.ecart ? `❌ ${c(r.albert.ecart)}` : '✅') : `⚠️ ${c(r.albert.erreur)}`} | ${r.alerteActuel ? `🔔 ${c(r.alerteActuel)}` : ''} |`));
  return l.join('\n');
}

// ─── Lancement ──────────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const tableOD = await chargerOpenData(globalThis.fetch);
  const ancienDir = process.env.ANCIEN_JS && fs.existsSync(process.env.ANCIEN_JS) ? process.env.ANCIEN_JS : null;
  const prec = await chargerSessionPrecedente(globalThis.fetch, Number(tableOD.session) - 1);
  const lectures = process.env.JEU === 'validation' ? LECTURES_VALIDATION : process.env.JEU === 'tout' ? [...LECTURES, ...LECTURES_VALIDATION] : LECTURES;
  const res = await essaiDoubleLecture({ tableOD, autresSessions: [prec], ancienDir, albert: process.env.SANS_ALBERT !== '1', lectures });
  const b = bilan(res);
  const texte = rapportDoubleLecture(res, b);
  fs.writeFileSync('double_lecture.md', texte);
  fs.writeFileSync('double_lecture.json', JSON.stringify({ bilan: b, resultats: res }, null, 1));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, texte + '\n');
  console.log(texte);
  // lectures d'Albert, une par ligne (pour l'analyse, sans télécharger l'artefact)
  res.forEach(r => console.log(`LECTURE ${r.id} ${JSON.stringify({ albert: r.albert.lecture || r.albert.erreur, moteur: r.actuel.lecture })}`));
}
