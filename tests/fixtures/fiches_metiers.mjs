// fiches_metiers.mjs — Jeux de données FICTIFS par métier, pour tester la
// reconnaissance des colonnes et la justesse des réponses du widget.
//
// Chaque fiche reproduit la façon dont un métier nomme et remplit ses
// colonnes sur le terrain (export BO, tableau de lycée, suivi CIO, liste de
// candidats d'une formation, tableau agrégé). Les données sont générées de
// façon déterministe (toujours identiques) : aucune donnée réelle.
//
// Format d'une fiche :
//   rows     : lignes du tableau telles que lues dans Excel (titres compris)
//   expected : { en-tête: sens attendu } (kinds de planner.js)
//   questions: [{ q, check(table) → { tool, value } }] — la valeur attendue
//              est recalculée directement sur les lignes, indépendamment du
//              moteur du widget.

// Générateur pseudo-aléatoire déterministe (mulberry32)
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
// Tirage pondéré : [[valeur, poids], ...]
const wpick = (r, pairs) => {
  const tot = pairs.reduce((s, p) => s + p[1], 0);
  let x = r() * tot;
  for (const [v, w] of pairs) { if ((x -= w) < 0) return v; }
  return pairs[pairs.length - 1][0];
};

const NOMS = ['Martin', 'Bernard', 'Dubois', 'Durand', 'Lefebvre', 'Moreau', 'Laurent', 'Garcia', 'Etcheverry', 'Lafitte', 'Duhalde', 'Fontaine', 'Roux', 'Mendiboure'];
const PRENOMS = ['Léa', 'Lucas', 'Emma', 'Hugo', 'Chloé', 'Nathan', 'Inès', 'Maël', 'Jade', 'Enzo', 'Manon', 'Ainhoa', 'Peio', 'Louise'];
const DEPTS_NA = [['Gironde', 45], ['Pyrénées-Atlantiques', 20], ['Landes', 12], ['Dordogne', 12], ['Lot-et-Garonne', 11]];

// Valeurs d'une colonne, sur les lignes de données
export const col = (table, name) => table.objects.map(o => o[name]);
export const countIf = (table, name, pred) => col(table, name).filter(pred).length;
export const mean = arr => { const n = arr.filter(v => typeof v === 'number'); return n.reduce((s, v) => s + v, 0) / n.length; };
export const distribution = (table, name) => {
  const m = new Map();
  col(table, name).forEach(v => { if (v !== '' && v != null) m.set(String(v), (m.get(String(v)) || 0) + 1); });
  return Object.fromEntries(m);
};

/* ───────────── 1. SAIO / rectorat : export BO académique ───────────── */
function ficheSaio() {
  const r = rng(2025);
  const H = [
    'Numéro Parcoursup*',
    "Département de l'établissement de la scolarité",
    'Zone du Pays Basque',
    'Série de la Classe',
    'Boursier des lycées',
    'A eu une proposition au cours de la procédure Parcoursup (Oui/Non)',
    'A actuellement répondu favorablement à une proposition (Oui/Non)',
    "Grands groupes de formation d'accueil acceptée",
    "Académie de l'établissement d'accueil acceptée",
    'Nb total de vœux confirmés en phase principale',
  ];
  const rows = [['Extraction BusinessObjects — Parcoursup 2026 — Académie de Bordeaux'], ['Date d\'extraction : 15/07/2026'], [], H];
  for (let i = 0; i < 240; i++) {
    const dep = wpick(r, DEPTS_NA);
    const basque = dep === 'Pyrénées-Atlantiques' && r() < 0.55 ? 'Oui' : 'Non';
    const serie = wpick(r, [['Générale', 55], ['Technologique', 25], ['Professionnelle', 20]]);
    const boursier = r() < 0.27 ? 'Oui' : 'Non';
    const prop = r() < 0.9 ? 'Oui' : 'Non';
    const fav = prop === 'Oui' && r() < 0.88 ? 'Oui' : 'Non';
    const groupe = fav === 'Oui' ? wpick(r, [['Licence', 40], ['BTS', 25], ['BUT', 15], ['CPGE', 8], ['Formations paramédicales', 7], ['Autres formations', 5]]) : '';
    const acad = fav === 'Oui' ? wpick(r, [['Bordeaux', 72], ['Toulouse', 10], ['Poitiers', 5], ['Paris', 5], ['Montpellier', 4], ['Limoges', 4]]) : '';
    rows.push([`P${String(26000000 + i)}`, dep, basque, serie, boursier, prop, fav, groupe, acad, 1 + Math.floor(r() * 14)]);
  }
  return {
    id: 'saio', metier: 'SAIO / rectorat', fichier: 'saio_export_bo_academie.xlsx', onglet: 'Export BO',
    description: 'Export BusinessObjects académique, intitulés longs, lignes de titre au-dessus des en-têtes.',
    rows,
    expected: {
      'Numéro Parcoursup*': 'generic',
      "Département de l'établissement de la scolarité": 'departement',
      'Zone du Pays Basque': 'zone_basque',
      'Série de la Classe': 'bac_series',
      'Boursier des lycées': 'boursier',
      'A eu une proposition au cours de la procédure Parcoursup (Oui/Non)': 'admission',
      'A actuellement répondu favorablement à une proposition (Oui/Non)': 'admission',
      "Grands groupes de formation d'accueil acceptée": 'formation',
      "Académie de l'établissement d'accueil acceptée": 'academie',
      'Nb total de vœux confirmés en phase principale': 'nb_voeux',
    },
    questions: [
      { q: 'Combien de candidats boursiers ?', check: t => ({ tool: 'count_rows', value: countIf(t, 'Boursier des lycées', v => v === 'Oui') }) },
      { q: 'Combien de candidats de la zone Pays Basque ?', check: t => ({ tool: 'count_rows', value: countIf(t, 'Zone du Pays Basque', v => v === 'Oui') }) },
      { q: 'Répartition par série du bac', check: t => ({ tool: 'group_by', col: 'Série de la Classe', value: distribution(t, 'Série de la Classe') }) },
      { q: "Répartition par académie d'accueil", check: t => ({ tool: 'group_by', col: "Académie de l'établissement d'accueil acceptée", value: distribution(t, "Académie de l'établissement d'accueil acceptée") }) },
      { q: 'Compare les boursiers et les non-boursiers', check: t => ({ tool: 'compare', value: { Oui: countIf(t, 'Boursier des lycées', v => v === 'Oui'), Non: countIf(t, 'Boursier des lycées', v => v === 'Non') } }) },
    ],
  };
}

/* ───────────── 2. Proviseur : suivi des terminales du lycée ───────────── */
function ficheProviseur() {
  const r = rng(33);
  const H = ['INE', 'NOM', 'PRENOM', 'CLASSE', 'SERIE_BAC', 'SEXE', 'BOURSIER', 'NB_VOEUX_PP', 'PROP_RECUE', 'LIB_FORM_ACC'];
  const rows = [H];
  for (let i = 0; i < 120; i++) {
    const serie = wpick(r, [['Générale', 60], ['STMG', 25], ['STI2D', 15]]);
    const classe = serie === 'Générale' ? pick(r, ['TG1', 'TG2', 'TG3']) : (serie === 'STMG' ? 'TSTMG1' : 'TSTI2D1');
    const prop = r() < 0.85 ? 'Oui' : 'Non';
    rows.push([
      `${String(100000000 + Math.floor(r() * 899999999))}${pick(r, ['AB', 'CD', 'EF', 'GH'])}`,
      pick(r, NOMS).toUpperCase(), pick(r, PRENOMS), classe, serie,
      r() < 0.52 ? 'F' : 'M',
      r() < 0.3 ? 'O' : 'N',
      2 + Math.floor(r() * 12),
      prop,
      prop === 'Oui' ? wpick(r, [['BTS MCO', 20], ['BUT GEA', 15], ['Licence Droit', 25], ['Licence STAPS', 15], ['CPGE ECG', 10], ['BTS SIO', 15]]) : '',
    ]);
  }
  return {
    id: 'proviseur', metier: 'Proviseur de lycée', fichier: 'proviseur_suivi_terminales.csv', onglet: '',
    description: 'Tableau de suivi des terminales, en-têtes abrégés en majuscules, boursier en O/N.',
    rows,
    expected: {
      INE: 'generic', NOM: 'generic', PRENOM: 'generic',
      SERIE_BAC: 'bac_series', SEXE: 'sexe', BOURSIER: 'boursier',
      NB_VOEUX_PP: 'nb_voeux', PROP_RECUE: 'admission', LIB_FORM_ACC: 'formation',
    },
    questions: [
      { q: "Combien d'élèves boursiers ?", check: t => ({ tool: 'count_rows', value: countIf(t, 'BOURSIER', v => v === 'O') }) },
      { q: 'Répartition par série du bac', check: t => ({ tool: 'group_by', col: 'SERIE_BAC', value: distribution(t, 'SERIE_BAC') }) },
      { q: 'Répartition par sexe', check: t => ({ tool: 'group_by', col: 'SEXE', value: distribution(t, 'SEXE') }) },
      { q: "Combien d'élèves en STMG ?", check: t => ({ tool: 'count_rows', value: countIf(t, 'SERIE_BAC', v => v === 'STMG') }) },
      { q: 'Répartition des formations acceptées', check: t => ({ tool: 'group_by', col: 'LIB_FORM_ACC', value: distribution(t, 'LIB_FORM_ACC') }) },
    ],
  };
}

/* ───────────── 3. Psy-EN / CIO : tableau de suivi manuel ───────────── */
function ficheCio() {
  const r = rng(40);
  const H = ['N°', 'Genre', 'Lycée', 'Dpt', 'Voie', 'Projet', 'Suivi'];
  const rows = [['Suivi des entretiens — CIO de Mont-de-Marsan'], H];
  const lycees = ['Lycée Victor Duruy', 'Lycée Charles Despiau', 'Lycée Robert Wlérick', 'Lycée professionnel Jean d\'Arcet'];
  for (let i = 0; i < 80; i++) {
    const voie = wpick(r, [['Générale', 50], ['Technologique', 28], ['Professionnelle', 22]]);
    rows.push([
      i + 1,
      r() < 0.55 ? 'Fille' : 'Garçon',
      pick(r, lycees),
      wpick(r, [['40 - Landes', 70], ['33 - Gironde', 15], ['64 - Pyrénées-Atlantiques', 10], ['47 - Lot-et-Garonne', 5]]),
      voie,
      wpick(r, [['BTS - Management commercial opérationnel', 20], ['Licence - Psychologie', 15], ['BUT - Techniques de commercialisation', 15], ['IFSI - Soins infirmiers', 15], ['CPGE - MPSI', 5], ['Licence - STAPS', 15], ['BTS - Services informatiques aux organisations', 15]]),
      pick(r, ['RDV pris', 'À relancer', 'Projet confirmé', 'Hésite entre deux vœux', '']),
    ]);
  }
  return {
    id: 'cio', metier: 'Psy-EN / CIO', fichier: 'cio_suivi_entretiens.xlsx', onglet: 'Entretiens',
    description: 'Tableau saisi à la main : noms de colonnes courts ou neutres, le sens se lit surtout dans les valeurs.',
    rows,
    expected: {
      'N°': 'generic', Genre: 'sexe', Lycée: 'etablissement', Dpt: 'departement',
      Voie: 'bac_series', Projet: 'formation', Suivi: 'generic',
    },
    questions: [
      { q: 'Répartition par genre', check: t => ({ tool: 'group_by', col: 'Genre', value: distribution(t, 'Genre') }) },
      { q: 'Combien de filles ?', check: t => ({ tool: 'count_rows', value: countIf(t, 'Genre', v => v === 'Fille') }) },
      { q: 'Combien de candidats en voie professionnelle ?', check: t => ({ tool: 'count_rows', value: countIf(t, 'Voie', v => v === 'Professionnelle') }) },
      { q: 'Répartition par voie', check: t => ({ tool: 'group_by', col: 'Voie', value: distribution(t, 'Voie') }) },
      { q: 'Répartition par département', check: t => ({ tool: 'group_by', col: 'Dpt', value: distribution(t, 'Dpt') }) },
    ],
  };
}

/* ───────────── 4. Responsable de formation : candidats à un BTS ───────────── */
function ficheFormation() {
  const r = rng(64);
  const H = ['Dossier', "Académie d'origine", 'Type de bac', 'Boursier', 'Statut de la candidature', 'Note dossier'];
  const rows = [['BTS MCO — Lycée Saint-John Perse, Pau — candidatures 2026'], [], H];
  for (let i = 0; i < 150; i++) {
    rows.push([
      4100 + i,
      wpick(r, [['Bordeaux', 75], ['Toulouse', 12], ['Poitiers', 5], ['Montpellier', 4], ['Limoges', 4]]),
      wpick(r, [['Générale', 30], ['Technologique', 45], ['Professionnelle', 25]]),
      r() < 0.33 ? 'Oui' : 'Non',
      wpick(r, [['Admis', 30], ['En liste d\'attente', 40], ['Refusé', 30]]),
      Math.round((8 + r() * 10) * 10) / 10,
    ]);
  }
  return {
    id: 'formation', metier: 'Responsable de formation (BTS)', fichier: 'formation_bts_candidatures.xlsx', onglet: 'Candidatures',
    description: 'Liste des candidats d\'une formation : statut en clair (Admis, liste d\'attente, refusé), note de dossier.',
    rows,
    expected: {
      Dossier: 'generic', "Académie d'origine": 'academie', 'Type de bac': 'bac_series',
      Boursier: 'boursier', 'Statut de la candidature': 'admission', 'Note dossier': 'generic',
    },
    questions: [
      { q: 'Combien de candidats admis ?', check: t => ({ tool: 'count_rows', value: countIf(t, 'Statut de la candidature', v => v === 'Admis') }) },
      { q: 'Répartition par statut de la candidature', check: t => ({ tool: 'group_by', col: 'Statut de la candidature', value: distribution(t, 'Statut de la candidature') }) },
      { q: "Répartition par académie d'origine", check: t => ({ tool: 'group_by', col: "Académie d'origine", value: distribution(t, "Académie d'origine") }) },
      { q: 'Répartition par type de bac', check: t => ({ tool: 'group_by', col: 'Type de bac', value: distribution(t, 'Type de bac') }) },
      { q: 'Compare les boursiers et les non-boursiers', check: t => ({ tool: 'compare', value: { Oui: countIf(t, 'Boursier', v => v === 'Oui'), Non: countIf(t, 'Boursier', v => v === 'Non') } }) },
    ],
  };
}

/* ───────────── 5. Chargé d'études : tableau agrégé par formation ───────────── */
function ficheEtudes() {
  const r = rng(2026);
  const H = ['Filière', 'Établissement', 'Département', 'Capacité', 'Nb vœux', 'Nb admis', "Taux d'accès (%)"];
  const rows = [H];
  const etabs = ['Université de Bordeaux', 'Université de Pau et des Pays de l\'Adour', 'IUT de Bayonne', 'Lycée Montaigne', 'Lycée Gustave Eiffel', 'Lycée Saint-Cricq'];
  for (let i = 0; i < 60; i++) {
    const cap = 20 + Math.floor(r() * 180);
    const voeux = cap * (3 + Math.floor(r() * 25));
    rows.push([
      wpick(r, [['BTS', 30], ['BUT', 15], ['Licence', 35], ['CPGE', 10], ['IFSI', 10]]),
      pick(r, etabs),
      wpick(r, DEPTS_NA),
      cap, voeux, Math.round(cap * (0.85 + r() * 0.15)),
      Math.round(r() * 1000) / 10,
    ]);
  }
  return {
    id: 'etudes', metier: 'Chargé d\'études', fichier: 'etudes_formations_agregees.csv', onglet: '',
    description: 'Une ligne par formation : capacités, vœux, admis, taux d\'accès (données agrégées).',
    rows,
    expected: {
      Filière: 'formation', Établissement: 'etablissement', Département: 'departement',
      Capacité: 'generic', 'Nb vœux': 'nb_voeux', 'Nb admis': 'admission', "Taux d'accès (%)": 'generic',
    },
    questions: [
      { q: 'Répartition par filière', check: t => ({ tool: 'group_by', col: 'Filière', value: distribution(t, 'Filière') }) },
      { q: 'Répartition par département', check: t => ({ tool: 'group_by', col: 'Département', value: distribution(t, 'Département') }) },
      { q: 'Combien de formations en Gironde ?', check: t => ({ tool: 'count_rows', value: countIf(t, 'Département', v => v === 'Gironde') }) },
    ],
  };
}

export const FICHES = [ficheSaio(), ficheProviseur(), ficheCio(), ficheFormation(), ficheEtudes()];
