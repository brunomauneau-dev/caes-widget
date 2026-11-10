// donnees_simulees.mjs — Faux fichiers réalistes pour tester la robustesse du widget.
// Générateur déterministe (même graine → mêmes lignes) : chaque test connaît la bonne réponse,
// calculée ici directement sur les lignes, indépendamment du moteur du widget.
//
// - candidats(n)        : extraction de candidats (une ligne = un candidat), valeurs « canoniques »
// - enTetes.complets / abreges / vagues : trois façons de nommer les mêmes colonnes
// - versTableau(lignes, enTetes, options) : tableau Excel brut (titres, ligne vide, total, colonne vide…)
// - openData(n)          : open data Parcoursup simulé (une ligne = une formation), libellés officiels

// ─── Hasard reproductible ────────────────────────────────────────────────────
export function hasard(graine = 42) {
  let s = graine >>> 0;
  const r = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const choix = (liste, poids) => {
    if (!poids) return liste[Math.floor(r() * liste.length)];
    const tot = poids.reduce((a, b) => a + b, 0);
    let x = r() * tot;
    for (let i = 0; i < liste.length; i++) { x -= poids[i]; if (x < 0) return liste[i]; }
    return liste[liste.length - 1];
  };
  return { r, choix, entier: (a, b) => a + Math.floor(r() * (b - a + 1)) };
}

// ─── Extraction de candidats ─────────────────────────────────────────────────
const LYCEES = [
  ['Lycée Montaigne', 'Bordeaux', 'Gironde'], ['Lycée Camille Jullian', 'Bordeaux', 'Gironde'], ['Lycée Gustave Eiffel', 'Bordeaux', 'Gironde'],
  ['Lycée Max Linder', 'Libourne', 'Gironde'], ['Lycée Victor Duruy', 'Mont-de-Marsan', 'Landes'], ['Lycée Borda', 'Dax', 'Landes'],
  ['Lycée Louis Barthou', 'Pau', 'Pyrénées-Atlantiques'], ['Lycée René Cassin', 'Bayonne', 'Pyrénées-Atlantiques'],
  ['Lycée Ravel', 'Saint-Jean-de-Luz', 'Pyrénées-Atlantiques'], ['Lycée Bertran de Born', 'Périgueux', 'Dordogne'],
  ['Lycée Bernard Palissy', 'Agen', 'Lot-et-Garonne'],
];
const BASQUE = new Set(['Bayonne', 'Saint-Jean-de-Luz']);
const FORMATIONS = [
  ['BTS', 'BTS - Services - Management Commercial Opérationnel', 'Lycée Gustave Eiffel', 'Bordeaux'],
  ['BTS', 'BTS - Services - Négociation et Digitalisation de la Relation Client', 'Lycée Ravel', 'Bordeaux'],
  ['BTS', 'BTS - Production - Conception des Produits Industriels', 'Lycée Saint-Cricq', 'Bordeaux'],
  ['BUT', 'BUT - Techniques de commercialisation', 'IUT de Bordeaux', 'Bordeaux'],
  ['BUT', 'BUT - Informatique', 'IUT de Toulouse', 'Toulouse'],
  ['CPGE', 'CPGE - MPSI', 'Lycée Montaigne', 'Bordeaux'],
  ['CPGE', 'CPGE - ECG - Économique et commerciale voie générale', 'Lycée Henri IV', 'Paris'],
  ['Licence', 'Licence - Droit', 'Université de Bordeaux', 'Bordeaux'],
  ['Licence', 'Licence - Psychologie', 'Université de Bordeaux', 'Bordeaux'],
  ['Licence', 'Licence - Droit', 'Université Toulouse Capitole', 'Toulouse'],
  ['Licence', 'Licence - STAPS', 'Université de Poitiers', 'Poitiers'],
  ['PASS', 'PASS - Parcours d\'Accès Spécifique Santé - option Droit', 'Université de Bordeaux', 'Bordeaux'],
  ['PASS', 'PASS - Parcours d\'Accès Spécifique Santé - option Biologie', 'Université de Bordeaux', 'Bordeaux'],
  ['IFSI', 'IFSI - Formation en soins infirmiers', 'IFSI du CHU de Bordeaux', 'Bordeaux'],
];

export function candidats(n = 3000, graine = 7) {
  const h = hasard(graine);
  const out = [];
  for (let i = 0; i < n; i++) {
    const [lycee, commune, dep] = h.choix(LYCEES, [14, 10, 10, 6, 7, 6, 8, 7, 5, 6, 6]);
    const serie = h.choix(['Générale', 'Technologique', 'Professionnelle'], [60, 25, 15]);
    const f = h.choix(FORMATIONS, serie === 'Professionnelle' ? [30, 25, 20, 4, 2, 0, 0, 3, 2, 1, 2, 0, 0, 3] : [8, 6, 4, 8, 4, 6, 3, 12, 8, 4, 4, 6, 5, 6]);
    out.push({
      id: i + 1,
      sexe: h.choix(['Féminin', 'Masculin'], [55, 45]),
      boursier: h.r() < 0.28 ? 'Oui' : 'Non',
      serie,
      aca_origine: 'Bordeaux',
      dep_origine: dep,
      commune_origine: commune,
      lycee_origine: lycee,
      basque: BASQUE.has(commune) ? 'Oui' : 'Non',
      groupe: f[0],
      specialite: f[1],
      etab_accueil: f[2],
      aca_accueil: f[3],
      nb_voeux: h.entier(1, 15),
      apprenti: h.r() < 0.08 ? 'Oui' : 'Non',
    });
  }
  return out;
}

// Trois façons de nommer les mêmes colonnes
export const enTetes = {
  complets: {
    id: 'Numéro du candidat', sexe: 'Sexe du candidat', boursier: 'Boursier', serie: 'Série de la classe',
    aca_origine: "Académie de l'établissement d'origine", dep_origine: "Département de l'établissement d'origine",
    commune_origine: "Commune de l'établissement d'origine", lycee_origine: "Établissement d'origine",
    basque: 'Zone du Pays Basque', groupe: "Grands groupes de formation d'accueil acceptée",
    specialite: "Spécialité / mention formation d'accueil acceptée", etab_accueil: "Établissement d'accueil",
    aca_accueil: "Académie de l'établissement d'accueil acceptée", nb_voeux: 'Nb vœux confirmés', apprenti: 'Apprenti',
  },
  abreges: {
    id: 'NUM_CAND', sexe: 'SEXE', boursier: 'BOURS', serie: 'SER_BAC', aca_origine: 'LIB_ACA_SCO', dep_origine: 'DEP_SCO',
    commune_origine: 'COM_SCO', lycee_origine: 'LIB_ETAB_SCO', basque: 'ZONE_BASQUE', groupe: 'GRP_FORM_ACC',
    specialite: 'LIB_SPE_FORM_ACC', etab_accueil: 'LIB_ETAB_ACC', aca_accueil: 'LIB_ACA_ACC', nb_voeux: 'NB_VX_CONF', apprenti: 'APPR',
  },
  vagues: {
    id: 'Colonne A', sexe: 'Colonne B', boursier: 'Colonne C', serie: 'Colonne D', aca_origine: 'Colonne E', dep_origine: 'Colonne F',
    commune_origine: 'Colonne G', lycee_origine: 'Colonne H', basque: 'Colonne I', groupe: 'Colonne J', specialite: 'Colonne K',
    etab_accueil: 'Colonne L', aca_accueil: 'Colonne M', nb_voeux: 'Colonne N', apprenti: 'Colonne O',
  },
};

// Lignes canoniques → tableau brut d'un export Excel (liste de lignes de cellules)
// etats : 'chiffres' → colonnes d'état (boursier, apprenti, Pays Basque) en 1 / 0 ; 'vraifaux' → VRAI / FAUX
export function versTableau(lignes, noms, { titres = false, total = false, colonneVide = false, valeursBO = false, etats = null } = {}) {
  const cles = Object.keys(noms);
  const rows = [];
  if (titres) {
    rows.push(['Extraction Parcoursup — candidats ayant accepté une proposition', '', '']);
    rows.push(['Académie de Bordeaux — session 2025 — extrait le 02/11/2026']);
    rows.push([]);
  }
  const entete = cles.map(k => noms[k]);
  if (colonneVide) entete.splice(5, 0, '');
  rows.push(entete);
  lignes.forEach(l => {
    const r = cles.map(k => {
      let v = l[k];
      if (valeursBO && k === 'boursier') v = v === 'Oui' ? 'Boursier des lycées' : 'Non boursier';
      if (valeursBO && k === 'sexe') v = v === 'Féminin' ? 'F' : 'M';
      if (etats && ['boursier', 'apprenti', 'basque'].includes(k)) v = etats === 'chiffres' ? (v === 'Oui' ? 1 : 0) : (v === 'Oui' ? 'VRAI' : 'FAUX');
      return v;
    });
    if (colonneVide) r.splice(5, 0, '');
    rows.push(r);
  });
  if (total) { rows.push([]); rows.push(['Total', lignes.length]); }
  return rows;
}

// Tableau brut → texte CSV « à la française » (séparateur ;)
export function versCSV(rows) {
  return rows.map(r => r.map(v => {
    const s = String(v ?? '');
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(';')).join('\r\n');
}

// ─── Open data Parcoursup simulé (une ligne = une formation) ─────────────────
export const OD = {
  session: 'Session', statut: "Statut de l'établissement de la filière de formation (public, privé…)",
  etab: 'Établissement', dep: "Département de l'établissement", region: "Région de l'établissement",
  aca: "Académie de l'établissement", commune: "Commune de l'établissement", selectivite: 'Sélectivité',
  fili: 'Filière de formation très agrégée', form: 'Filière de formation', fil_det: 'Filière de formation détaillée bis',
  detail: 'Filière de formation très détaillée', nom: 'Filière de formation (nom complet)',
  capa: "Capacité de l'établissement par formation", voe: 'Effectif total des candidats pour une formation',
  voe_f: 'Dont effectif des candidates pour une formation', prop: "Effectif total des candidats ayant reçu une proposition d'admission de la part de l'établissement",
  acc: "Effectif total des candidats ayant accepté la proposition de l'établissement (admis)",
  acc_bours: 'Dont effectif des admis boursiers néo bacheliers', pct_bours: "% d'admis néo bacheliers boursiers",
  acc_neobac: 'Effectif des admis néo bacheliers', acc_f: 'Dont effectif des candidates admises', acc_bg: 'Dont effectif des admis néo bacheliers généraux',
  pct_f: "% d'admis dont filles", taux: "Taux d'accès",
};
// Noms techniques des mêmes champs dans l'API open data (pour simuler l'API elle-même)
export const OD_API = {
  session: 'session', statut: 'contrat_etab', etab: 'g_ea_lib_vx', dep: 'dep_lib', region: 'region_etab_aff', aca: 'acad_mies',
  commune: 'ville_etab', selectivite: 'select_form', fili: 'fili', form: 'form_lib_voe_acc', fil_det: 'fil_lib_voe_acc',
  detail: 'detail_forma', nom: 'lib_for_voe_ins', capa: 'capa_fin', voe: 'voe_tot', voe_f: 'voe_tot_f', prop: 'prop_tot',
  acc: 'acc_tot', acc_bours: 'acc_brs', acc_neobac: 'acc_neobac', acc_f: 'acc_tot_f', acc_bg: 'acc_bg', pct_bours: 'pct_bours', pct_f: 'pct_f', taux: 'taux_acces_ens',
};
const ACAS = [
  ['Bordeaux', 'Nouvelle-Aquitaine', [['Gironde', 'Bordeaux'], ['Gironde', 'Talence'], ['Landes', 'Mont-de-Marsan'], ['Pyrénées-Atlantiques', 'Pau'], ['Pyrénées-Atlantiques', 'Bayonne'], ['Dordogne', 'Périgueux'], ['Lot-et-Garonne', 'Agen']]],
  ['Toulouse', 'Occitanie', [['Haute-Garonne', 'Toulouse'], ['Tarn', 'Albi'], ['Hautes-Pyrénées', 'Tarbes']]],
  ['Poitiers', 'Nouvelle-Aquitaine', [['Vienne', 'Poitiers'], ['Charente-Maritime', 'La Rochelle']]],
  ['Limoges', 'Nouvelle-Aquitaine', [['Haute-Vienne', 'Limoges']]],
  ['Paris', 'Île-de-France', [['Paris', 'Paris']]],
  ['Lyon', 'Auvergne-Rhône-Alpes', [['Rhône', 'Lyon']]],
  ['Lille', 'Hauts-de-France', [['Nord', 'Lille']]],
  ['Nantes', 'Pays de la Loire', [['Loire-Atlantique', 'Nantes']]],
];
const OFFRES = [
  // fili, form, fil_det, detail[], poids, sélective
  ['BTS', 'BTS - Services', 'BTS - Services', ['Management Commercial Opérationnel', 'Négociation et Digitalisation de la Relation Client', 'Comptabilité et Gestion', 'Tourisme'], 28, true],
  ['BTS', 'BTS - Production', 'BTS - Production', ['Conception des Produits Industriels', 'Électrotechnique', 'Bâtiment'], 10, true],
  ['Licence', 'Licence - Droit, économie, gestion', 'Licence - Droit', ['Droit'], 6, false],
  ['Licence', 'Licence - Droit, économie, gestion', 'Licence - Économie', ['Économie', 'Économie et gestion'], 6, false],
  ['Licence', 'Licence - Sciences - santé - STAPS', 'Licence - Sciences pour la santé', ['Sciences pour la santé', 'STAPS'], 6, false],
  ['Licence', 'Licence - Lettres, langues, arts', 'Licence - Psychologie', ['Psychologie', 'Lettres modernes'], 6, false],
  ['Licence_Las', 'Licence - Accès santé (LAS)', 'Licence - Droit - accès santé (LAS)', ['Droit - accès santé (LAS)', 'Biologie - accès santé (LAS)'], 3, false],
  ['PASS', 'PASS', "Parcours d'Accès Spécifique Santé (PASS)", ['PASS option Droit', 'PASS option Biologie', 'PASS option Chimie', 'PASS option Économie'], 2, false],
  ['CPGE', 'CPGE', 'Classe préparatoire scientifique', ['MPSI', 'PCSI', 'BCPST'], 5, true],
  ['CPGE', 'CPGE', 'Classe préparatoire économique et commerciale', ['ECG - Mathématiques approfondies', 'ECG - Mathématiques appliquées'], 3, true],
  ['BUT', 'BUT - Services', 'BUT - Techniques de commercialisation', ['Techniques de commercialisation', 'Gestion des entreprises et des administrations'], 5, true],
  ['BUT', 'BUT - Production', 'BUT - Informatique', ['Informatique', 'Génie électrique et informatique industrielle'], 4, true],
  ['IFSI', 'Formations des écoles paramédicales', 'IFSI', ['Formation en soins infirmiers'], 2, true],
  ["Ecole d'Ingénieur", "Formation d'ingénieur", "Formation d'ingénieur Bac + 5", ['Bac général', 'Prépa intégrée'], 1, true],
  ['Ecole de Commerce', 'École de commerce', 'Bachelor', ['Bachelor en management'], 1, true],
  ['Autre formation', 'Autre formation', 'DN MADE', ['Mention Graphisme', 'Mention Espace'], 4, true],
];

export function openData(n = 14000, graine = 11) {
  const h = hasard(graine);
  const out = [];
  for (let i = 0; i < n; i++) {
    const [aca, region, lieux] = h.choix(ACAS, [12, 9, 6, 3, 18, 10, 9, 8]);
    const [dep, commune] = h.choix(lieux);
    const o = h.choix(OFFRES, OFFRES.map(x => x[4]));
    const detail = h.choix(o[3]);
    const statut = o[0] === 'PASS' || o[0] === 'Licence' || o[0] === 'BUT' || o[0] === 'Licence_Las' ? 'Public'
      : h.choix(['Public', 'Privé sous contrat d\'association', 'Privé enseignement supérieur'], [65, 25, 10]);
    const capa = h.entier(12, o[0] === 'Licence' || o[0] === 'PASS' ? 400 : 60);
    const voe = capa * h.entier(3, 30);
    const acc = Math.max(1, Math.round(capa * (0.6 + h.r() * 0.4)));
    out.push({
      session: 2025, statut, etab: `${o[0] === 'BTS' || o[0] === 'CPGE' ? 'Lycée' : o[0] === 'BUT' ? 'IUT' : 'Établissement'} ${commune} ${1 + (i % 17)}`,
      dep, region, aca, commune, selectivite: o[5] ? 'formation sélective' : 'formation non sélective',
      fili: o[0], form: o[1], fil_det: o[2], detail, nom: `${o[2]} - ${detail}`,
      capa, voe, voe_f: Math.round(voe * (0.3 + h.r() * 0.4)), prop: Math.min(voe, Math.round(acc * (1.5 + h.r() * 3))), acc,
      acc_bours: Math.round(acc * h.r() * 0.35), pct_bours: Math.round(h.r() * 400) / 10, pct_f: Math.round(h.r() * 1000) / 10,
      taux: Math.round(h.r() * 1000) / 10,
    });
    // v27.15 — colonnes déduites sans tirage aléatoire (les autres valeurs du jeu restent identiques)
    const d = out[out.length - 1];
    d.acc_neobac = Math.max(d.acc_bours, Math.round(d.acc * 0.85));
    d.acc_f = Math.round(d.acc * d.pct_f / 100);
    d.acc_bg = Math.round(d.acc_neobac * 0.6);
  }
  return out;
}

// Table au format du widget (en-têtes lisibles), comme après le chargement de l'open data
export function tableOpenData(lignes, nom = 'Parcoursup 2025 — France entière (open data)') {
  const cles = Object.keys(OD);
  return { source: 'Open data', name: nom, session: 2025, rowUnit: 'formation', isDefault: true,
    headers: cles.map(k => OD[k]), objects: lignes.map(l => Object.fromEntries(cles.map(k => [OD[k], l[k]]))) };
}

// Comptage de vérité
export const compter = (lignes, pred) => lignes.filter(pred).length;

// ─── Export académique « BDD candidats » (22 colonnes, une ligne = un candidat) ─────────────────
// Mêmes en-têtes que l'export de suivi réel de l'académie (anonymisé : sans numéro de dossier, d'où une colonne
// sans titre), valeurs FICTIVES. Deux établissements (scolarité / accueil), deux communes, deux colonnes de série,
// deux colonnes Oui/Non (proposition / réponse favorable), enseignements de spécialité du lycée, accueil vide pour
// les candidats sans admission, communes par arrondissement (Paris).
export const EXPORT_ACADEMIQUE_ENTETES = [
  "Département de l'établissement de la scolarité", 'Code UAI établissement de la scolarité', "Commune de l'établissement de la scolarité",
  'Zone du Pays Basque', 'Etablissement de la scolarité', '', 'A eu une proposition au cours de la procédure Parcoursup (Oui/Non)',
  'A actuellement répondu favorablement à une proposition (Oui/Non)', 'Apprenti', 'Boursier des lycées',
  'Ministère de rattachement établissement de la scolarité', 'Type de contrat établissement de la scolarité', 'Type de la classe',
  'Série de la Classe', 'Spécialité', 'Enseignement(s) de spécialité suivi(s)', 'Nb total de vœux confirmés en phase principale',
  "Grands groupes de formation d'accueil acceptée", "Académie de l'établissement d'accueil acceptée",
  "Spécialité / mention formation d'accueil acceptée", "Etablissement d'accueil accepté", "Commune de l'établissement d'accueil accepté",
];
const EA_LYCEES = [
  // nom, commune, département, UAI, ministère, contrat
  ['Lycée Montaigne', 'Bordeaux', 'Gironde', '0330021U', "Ministère De L'éducation nationale", 'Public'],
  ['Lycée Gustave Eiffel', 'Bordeaux', 'Gironde', '0330028B', "Ministère De L'éducation nationale", 'Public'],
  ['Lycée Victor Louis', 'Talence', 'Gironde', '0330126H', "Ministère De L'éducation nationale", 'Public'],
  ['Lycée agricole de Bordeaux Blanquefort', 'Blanquefort', 'Gironde', '0331424X', 'Agriculture', 'Public'],
  ['LPO Louis De Foix', 'Bayonne', 'Pyrénées-Atlantiques', '0640001A', "Ministère De L'éducation nationale", 'Public'],
  ['Lycée Saint-Joseph', 'Bordeaux', 'Gironde', '0331501F', "Ministère De L'éducation nationale", "Privé sous contrat d'association"],
  ['MAISON FAMILIALE RURALE', 'Pau', 'Pyrénées-Atlantiques', '0641555P', 'Agriculture', "Privé sous contrat d'association"],
  ['Lycée Louis Barthou', 'Pau', 'Pyrénées-Atlantiques', '0640055M', "Ministère De L'éducation nationale", 'Public'],
  ['Lycée Max Linder', 'Libourne', 'Gironde', '0330088S', "Ministère De L'éducation nationale", 'Public'],
  ['Lycée Bertran de Born', 'Périgueux', 'Dordogne', '0240024W', "Ministère De L'éducation nationale", 'Public'],
  ['Lycée Bernard Palissy', 'Agen', 'Lot-et-Garonne', '0470001W', "Ministère De L'éducation nationale", 'Public'],
  ['Lycée Victor Duruy', 'Mont-de-Marsan', 'Landes', '0400017B', "Ministère De L'éducation nationale", 'Public'],
  ['Lycée Gustave Eiffel', 'Pau', 'Pyrénées-Atlantiques', '0640099K', "Ministère De L'éducation nationale", 'Public'],
  ['Porte du Lot Lycée des métiers des engins de travaux publics', 'Clairac', 'Lot-et-Garonne', '0470009E', "Ministère De L'éducation nationale", 'Public'],
];
const EA_CLASSES = [
  // type, série, spécialité (bac pro / STMG), enseignements
  ['Générale', 'Série Générale', '', 'Mathématiques | Physique-Chimie'],
  ['Générale', 'Série Générale', '', 'Histoire-Géographie, Géopolitique et Sciences politiques | Sciences Economiques et Sociales'],
  ['Générale', 'Série Générale', '', 'Physique-Chimie | Sciences de la vie et de la Terre'],
  ['Générale', 'Série Générale', '', 'Mathématiques | Sciences Economiques et Sociales'],
  ['Générale', 'Série Générale', '', 'Mathématiques | Numérique et Sciences Informatiques'],
  ['Technologique', 'Sciences et Technologies du Management et de la Gestion', 'Mercatique', 'Droit et Economie | Msgn/ Mercatique'],
  ['Technologique', "Sciences et Technologies de l'Industrie et du Développement Durable", 'Innovation technologique et eco conception', 'Ingénierie, innovation et développement durable | Physique-Chimie et Mathématiques'],
  ['Technologique', 'Sciences et technologies de la santé et du social', '', 'Chimie, biologie et physiopathologie humaines | Sciences et techniques sanitaires et sociales'],
  ['Technologique', "Sciences et Technologies de l'agronomie et du vivant", '', 'Gestion des ressources et alimentation | Territoires et technologie'],
  ['Professionnelle', 'Professionnelle', "Métiers du commerce et de la  vente option a : animation et gestion d'espace commercial", ''],
  ['Professionnelle', 'Professionnelle', 'Accompagnement soins et services à la personne', ''],
  ['Professionnelle', 'Professionnelle Agricole', 'Services aux personnes et animation dans les territoires', ''],
];
const EA_ACCUEIL = [
  // grand groupe, mention, établissement, commune, académie
  ['L1 - CUPGE - DEUST - DU', 'Droit', 'Université de Bordeaux - Bordeaux Métropole', 'Pessac', 'Bordeaux'],
  ['L1 - CUPGE - DEUST - DU', 'Droit', 'Université Toulouse Capitole', 'Toulouse', 'Toulouse'],
  ['L1 - CUPGE - DEUST - DU', "Parcours d'Accès Spécifique Santé (PASS)", 'Université de Bordeaux - Bordeaux Métropole', 'Talence', 'Bordeaux'],
  ['L1 - CUPGE - DEUST - DU', 'Mathématiques', 'Université de Bordeaux - Bordeaux Métropole', 'Talence', 'Bordeaux'],
  ['L1 - CUPGE - DEUST - DU', "Sciences pour l'ingénieur", 'Université de Pau et des pays de l\'Adour - Collège STEE (Pau)', 'Pau', 'Bordeaux'],
  ['L1 - CUPGE - DEUST - DU', 'Sciences et Techniques des Activités Physiques et Sportives', 'Université de Bordeaux - Bordeaux Métropole', 'Pessac', 'Bordeaux'],
  ['L1 - CUPGE - DEUST - DU', 'Langues étrangères appliquées', 'Université Paris Cité', 'Paris 13e  Arrondissement', 'Paris'],
  ['BTS - BTSA - DTS - DMA', 'Management commercial opérationnel', 'Lycée Gustave Eiffel', 'Bordeaux', 'Bordeaux'],
  ['BTS - BTSA - DTS - DMA', "Assistance technique d'ingénieur", 'Lycée Louis Barthou', 'Pau', 'Bordeaux'],
  ['BTS - BTSA - DTS - DMA', 'Développement, animation des territoires ruraux', 'Lycée agricole de Bordeaux Blanquefort', 'Blanquefort', 'Bordeaux'],
  ['DUT', 'Gestion des entreprises et des administrations', 'I.U.T de Bordeaux - Site de Gradignan', 'Gradignan', 'Bordeaux'],
  ['DUT', 'Informatique', 'IUT de Toulouse', 'Toulouse', 'Toulouse'],
  ['CPGE - CPES', 'MPSI', 'Lycée Montaigne', 'Bordeaux', 'Bordeaux'],
  ['CPGE - CPES', 'Lettres', 'Lycée Henri IV', 'Paris  5e  Arrondissement', 'Paris'],
  ["Formations d'ingénieurs", "Formation d'ingénieur Bac + 5", 'Bordeaux INP', 'Talence', 'Bordeaux'],
  ['Secteur sanitaire et social', 'D.E Infirmier', 'IFSI du CHU de Bordeaux', 'Bordeaux', 'Bordeaux'],
  ['Ecoles de commerce', 'Bachelor', 'KEDGE Business School', 'Talence', 'Bordeaux'],
  ['CPGE - CPES', 'CPES', 'Université de Bordeaux - Bordeaux Métropole / Lycée Montaigne', 'Bordeaux', 'Bordeaux'],
  ['L1 - CUPGE - DEUST - DU', 'Histoire', 'Université Bordeaux Montaigne', 'Pessac', 'Bordeaux'],
];
export function exportAcademique(n = 4000, graine = 21) {
  const h = hasard(graine);
  const rows = [EXPORT_ACADEMIQUE_ENTETES.slice()];
  for (let i = 0; i < n; i++) {
    const L = h.choix(EA_LYCEES, [12, 10, 9, 5, 5, 6, 4, 8, 7, 7, 6, 6, 4, 3]);
    const agricole = L[4] === 'Agriculture';
    const C = agricole ? h.choix(EA_CLASSES.filter(c => /agricole|agronomie/i.test(c[1])).concat([EA_CLASSES[0]])) : h.choix(EA_CLASSES, [14, 10, 10, 8, 5, 8, 5, 4, 1, 6, 5, 1]);
    const prop = h.r() < 0.79 ? 'Oui' : 'Non';
    const acc = prop === 'Oui' && h.r() < 0.84 ? 'Oui' : 'Non';
    const pro = C[0] === 'Professionnelle';
    const A = acc === 'Oui' ? h.choix(EA_ACCUEIL, pro ? [1, 0, 0, 0, 0, 1, 0, 9, 4, 3, 1, 0, 0, 0, 0, 2, 0, 0, 0] : [9, 3, 6, 3, 2, 4, 2, 3, 1, 1, 4, 2, 3, 1, 4, 3, 2, 1, 3]) : ['', '', '', '', ''];
    rows.push([
      L[2], L[3], L[1], L[1] === 'Bayonne' ? 'oui' : 'non', L[0], '', prop, acc,
      h.r() < 0.04 ? 'Oui' : 'Non', h.r() < 0.18 ? 'Boursier des lycées' : 'Non boursier du secondaire', L[4], L[5],
      C[0], C[1], C[2], C[3], h.r() < 0.16 ? '' : h.entier(1, 40), A[0], A[4], A[1], A[2], A[3],
    ]);
  }
  return rows;
}
