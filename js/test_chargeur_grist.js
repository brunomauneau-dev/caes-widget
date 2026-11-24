// test_chargeur_grist.js — Programme de chargement d'un gros fichier académique dans Grist par l'API
// (scripts/charger_bdd_grist.py). Le programme est lancé pour de vrai (Python), contre un FAUX Grist local
// (aucun appel réseau extérieur) et des fichiers FICTIFS : CSV (« ; », « , », Windows-1252) et Excel .xlsx.
// Vérifie : inspection sans aucune valeur affichée, en-têtes sous des lignes de titre, séparation Élèves / Vœux,
// envoi par paquets, reprise après coupure sans doublon, nouvel essai après une surcharge (429), refus d'écrire
// dans une table déjà remplie, vérification finale (lot perdu → « INCOMPLET »), clé jamais affichée.
// node js/test_chargeur_grist.js

import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, '..', 'scripts', 'charger_bdd_grist.py');

let passed = 0, failed = 0;
function assert(condition, label) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}`); failed++; }
}
async function describe(label, fn) {
  console.log(`\n${label}`);
  try { await fn(); } catch (e) { console.error(`  ✗ erreur : ${e.stack || e.message}`); failed++; }
}

const PY = ['python3', 'python'].find(c => spawnSync(c, ['--version']).status === 0);
if (!PY) { console.error('  ✗ Python 3 introuvable : ce test lance le programme de chargement pour de vrai.'); process.exit(1); }

// ─── Faux Grist ──────────────────────────────────────────────────────────────
const CLE = 'cle-secrete-de-test-0123456789';
function fauxGrist(opts = {}) {
  const etat = { tables: {}, requetes: [], postsRecords: 0, auth: new Set(), opts, tailles: [] };
  const srv = http.createServer((req, res) => {
    let corps = '';
    req.on('data', c => { corps += c; });
    req.on('end', () => {
      etat.requetes.push(`${req.method} ${req.url}`);
      etat.auth.add(req.headers.authorization || '');
      const repondre = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
      if (req.headers.authorization !== `Bearer ${CLE}`) return repondre(401, { error: 'unauthorized' });
      const m = req.url.match(/^\/api\/docs\/DOC1(\/.*)$/);
      if (!m) return repondre(404, { error: 'doc' });
      const p = m[1];
      if (req.method === 'GET' && p === '/tables') return repondre(200, { tables: Object.keys(etat.tables).map(id => ({ id })) });
      if (req.method === 'POST' && p === '/tables') {
        const t = JSON.parse(corps).tables[0];
        etat.tables[t.id] = { colonnes: t.columns, lignes: [] };
        return repondre(200, { tables: [{ id: t.id }] });
      }
      const r = p.match(/^\/tables\/([^/]+)\/records$/);
      if (req.method === 'POST' && r) {
        etat.postsRecords++;
        if (opts.panneApres && etat.postsRecords > opts.panneApres) return repondre(500, { error: 'panne' });
        if (opts.surcharge && etat.postsRecords === opts.surcharge && !etat.surchargeFaite) { etat.surchargeFaite = true; etat.postsRecords--; return repondre(429, { error: 'trop de requêtes' }); }
        const recs = JSON.parse(corps).records;
        if (opts.perdre && etat.postsRecords === opts.perdre) return repondre(200, { records: [] }); // lot accepté puis perdu
        etat.tables[r[1]].lignes.push(...recs.map(x => x.fields));
        etat.tailles.push(recs.length);
        return repondre(200, { records: recs.map((_, i) => ({ id: i + 1 })) });
      }
      const q = p.match(/^\/sql\?q=(.*)$/);
      if (req.method === 'GET' && q) {
        const sql = decodeURIComponent(q[1]); const t = sql.match(/FROM "([^"]+)"/)[1];
        return repondre(200, { records: [{ fields: { n: (etat.tables[t]?.lignes || []).length } }] });
      }
      repondre(404, { error: p });
    });
  });
  return new Promise(ok => srv.listen(0, '127.0.0.1', () => ok({ etat, srv, url: `http://127.0.0.1:${srv.address().port}` })));
}

// ─── Fichiers fictifs ────────────────────────────────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'chargeur-'));
const ENTETES = ['Numéro candidat', 'Nom', 'Département', 'Boursier', 'Nb vœux', 'Rang vœu', 'Formation demandée', 'UAI formation', 'Date du vœu'];
function voeux(nElv = 60, seed = 3) {
  let x = seed; const r = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  const lignes = [];
  for (let e = 1; e <= nElv; e++) {
    const nv = 1 + Math.floor(r() * 6), dep = ['Gironde', 'Landes', 'Dordogne'][e % 3], b = e % 4 === 0 ? 'Oui' : 'Non';
    for (let v = 1; v <= nv; v++) lignes.push([`C${String(e).padStart(5, '0')}`, `Élève Fictif ${e}`, dep, b, nv, v, ['BTS MCO', 'Licence Droit', 'BUT Info'][v % 3], `033000${v}A`, 45800 + v]);
  }
  return lignes;
}
function ecrireCSV(nom, lignes, { sep = ';', enc = 'utf8', titres = true } = {}) {
  const txt = [...(titres ? ['Export académique du 12/06/2025', ''] : []), ENTETES.join(sep), ...lignes.map(l => l.join(sep))].join('\r\n');
  const f = path.join(TMP, nom);
  fs.writeFileSync(f, enc === 'latin1' ? Buffer.from(txt.replace(/œ/g, 'oe'), 'latin1') : txt);
  return f;
}
function ecrireXLSX(nom, lignes) {
  // .xlsx minimal écrit par Python (zipfile) : chaînes partagées, chaînes en ligne, cases manquantes, nombres
  const f = path.join(TMP, nom); const data = path.join(TMP, nom + '.json');
  fs.writeFileSync(data, JSON.stringify({ entetes: ENTETES, lignes }));
  const py = `
import json, sys, zipfile
from xml.sax.saxutils import escape
d = json.load(open(sys.argv[1], encoding='utf-8'))
partagees, idx = [], {}
def s(v):
    if v not in idx: idx[v] = len(partagees); partagees.append(v)
    return idx[v]
def col(i):
    n, out = i + 1, ''
    while n: n, r = divmod(n - 1, 26); out = chr(65 + r) + out
    return out
rows = ['<row r="1"><c r="A1" t="inlineStr"><is><t>Export du 12/06/2025</t></is></c></row>']
allr = [d['entetes']] + d['lignes']
for k, l in enumerate(allr):
    rn = k + 3
    cells = []
    for i, v in enumerate(l):
        if k > 0 and i == 1 and k % 7 == 0: continue   # case manquante
        ref = col(i) + str(rn)
        if isinstance(v, (int, float)): cells.append('<c r="%s"><v>%s</v></c>' % (ref, v))
        else: cells.append('<c r="%s" t="s"><v>%d</v></c>' % (ref, s(v)))
    rows.append('<row r="%d">%s</row>' % (rn, ''.join(cells)))
sheet = '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>%s</sheetData></worksheet>' % ''.join(rows)
sst = '<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">%s</sst>' % ''.join('<si><t>%s</t></si>' % escape(x) for x in partagees)
wb = '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="BDD" sheetId="1" r:id="rId1"/></sheets></workbook>'
rels = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
with zipfile.ZipFile(sys.argv[2], 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('xl/workbook.xml', wb); z.writestr('xl/_rels/workbook.xml.rels', rels)
    z.writestr('xl/worksheets/sheet1.xml', sheet); z.writestr('xl/sharedStrings.xml', sst)
`;
  const r = spawnSync(PY, ['-c', py, data, f]);
  if (r.status !== 0) throw new Error(String(r.stderr));
  return f;
}
function reglages(nom, url, { separer = true, paquet = 50, extra = {} } = {}) {
  const dossier = fs.mkdtempSync(path.join(TMP, 'r-'));
  fs.writeFileSync(path.join(dossier, 'cle_grist.txt'), CLE + '\n');
  const R = {
    grist: { serveur: url, document: 'DOC1' }, cle_api_fichier: 'cle_grist.txt', ligne_entete: 3, paquet,
    tables: {
      ...(separer ? { eleves: { nom: 'Eleves', cle: 'Numéro candidat', colonnes: { 'Numéro candidat': 'Numéro candidat', Département: 'Département', Boursier: 'Boursier', 'Nb vœux': 'Nb vœux' } } } : {}),
      voeux: { nom: 'Voeux', colonnes: separer ? { 'Rang vœu': 'Rang', 'Formation demandée': 'Formation', 'UAI formation': 'UAI', 'Date du vœu': 'Date du vœu' } : Object.fromEntries(ENTETES.map(h => [h, h])) },
    },
    ...extra,
  };
  const f = path.join(dossier, nom);
  fs.writeFileSync(f, JSON.stringify(R));
  return f;
}
function lancer(args, { cwd = TMP, env = {} } = {}) {
  return new Promise(ok => {
    const e = { ...process.env, CHARGEUR_PAUSE: '0.01', NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost', ...env };
    for (const k of ['http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY', 'GRIST_API_KEY']) delete e[k];
    Object.assign(e, env);
    const p = spawn(PY, [SCRIPT, ...args], { cwd, env: e });
    let out = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
    p.on("close", code => { if (process.env.DEBUG) console.log("----", args.join(" ").slice(-60), "\n", out.slice(-700)); ok({ code, out }); });
  });
}
const L = voeux(60, 3);
const NB_ELEVES = new Set(L.map(l => l[0])).size;

await describe('Inspection : description du fichier, aucune valeur affichée', async () => {
  const f = ecrireCSV('bdd.csv', L);
  const regl = path.join(TMP, 'reglages_inspection.json');
  const r = await lancer(['inspecter', f, '--reglages', regl]);
  assert(r.code === 0, 'inspection terminée sans erreur');
  assert(new RegExp(`Lignes de données : ${L.length}\\b`).test(r.out), `nombre de lignes : ${L.length}`);
  assert(/Ligne d'en-têtes : 3/.test(r.out), 'en-têtes trouvés sous les lignes de titre de l\'export');
  assert(/Colonnes : 9/.test(r.out) && /Formation demandée/.test(r.out), 'colonnes listées');
  assert(!/Élève Fictif|Licence Droit|C00001/.test(r.out), 'faux positif : aucune valeur du fichier n\'est affichée');
  // changement de règle (v2) : l'identifiant est annoncé avec son nombre d'élèves, et les colonnes sont rangées par table
  assert(new RegExp(`Identifiant de l'élève : « Numéro candidat » — ${NB_ELEVES} élèves`).test(r.out), 'identifiant élève repéré, avec le nombre d\'élèves');
  const R = JSON.parse(fs.readFileSync(regl, 'utf8'));
  assert(R.ligne_entete === 3 && R.tables.references[0].cle === 'Numéro candidat' && R.tables.ecartees.includes('Nom'), 'fichier de réglages préparé (sans aucune valeur) ; la colonne « Nom » écartée');
  assert(!/Élève Fictif|C00001/.test(fs.readFileSync(regl, 'utf8')), 'faux positif : le fichier de réglages ne contient aucune donnée');
  const rx = await lancer(['inspecter', ecrireXLSX('bdd.xlsx', L), '--reglages', path.join(TMP, 'r2.json')]);
  assert(rx.code === 0 && /format XLSX/.test(rx.out) && new RegExp(`Lignes de données : ${L.length}\\b`).test(rx.out) && /Feuilles : 1 \(BDD\)/.test(rx.out), 'Excel .xlsx lu par morceaux (même nombre de lignes)');
});

await describe('Chargement : deux tables liées Élèves / Vœux, par paquets', async () => {
  const g = await fauxGrist();
  const r = await lancer(['charger', ecrireCSV('bdd.csv', L), '--reglages', reglages('reglages.json', g.url)]);
  const E = g.etat.tables.Eleves?.lignes || [], V = g.etat.tables.Voeux?.lignes || [];
  assert(r.code === 0 && /Chargement complet et vérifié/.test(r.out), 'chargement terminé et vérifié');
  assert(V.length === L.length, `Vœux : ${L.length} lignes (une par vœu)`);
  assert(E.length === NB_ELEVES && new Set(E.map(e => e.Numero_candidat)).size === NB_ELEVES, `Élèves : ${NB_ELEVES} élèves, chacun une seule fois`);
  assert(V.every(v => /^C\d{5}$/.test(v.Numero_candidat)), 'chaque vœu porte l\'identifiant de l\'élève (lien entre les tables)');
  const e1 = E.find(e => e.Numero_candidat === 'C00004');
  assert(e1 && e1.Boursier === 'Oui' && e1.Departement === 'Landes' && typeof e1.Nb_voeux === 'number', 'informations de l\'élève reprises de sa ligne (nombre gardé en nombre)');
  const colsV = g.etat.tables.Voeux.colonnes;
  assert(colsV.find(c => c.id === 'UAI').fields.type === 'Text' && V.every(v => /^033000\dA$/.test(v.UAI)), 'codes (UAI) gardés en texte');
  assert(colsV.find(c => c.id === 'Date_du_voeu').fields.type === 'Date' && /^2025-/.test(V[0].Date_du_voeu), 'date Excel (nombre de jours) convertie en date');
  assert(colsV.find(c => c.id === 'Formation').fields.label === 'Formation', 'colonne renommée comme dans les réglages');
  assert(g.etat.tailles.length >= Math.ceil(L.length / 50) && Math.max(...g.etat.tailles) <= 50, `envoi par paquets de 50 au plus (${g.etat.tailles.length} envois, le plus gros : ${Math.max(...g.etat.tailles)})`);
  assert(!r.out.includes(CLE) && [...g.etat.auth].every(a => a === `Bearer ${CLE}`), 'la clé n\'est jamais affichée ; elle sert seulement à s\'identifier auprès de Grist');
  assert(!fs.readdirSync(path.dirname(reglages('x.json', g.url))).some(f => f.startsWith('.reprise')), 'fichier de reprise supprimé après un chargement vérifié');
  g.srv.close();
});

await describe('Excel .xlsx et CSV variés', async () => {
  const g = await fauxGrist();
  const r = await lancer(['charger', ecrireXLSX('bdd.xlsx', L), '--reglages', reglages('reglages.json', g.url, { separer: false })]);
  const V = g.etat.tables.Voeux?.lignes || [];
  assert(r.code === 0 && V.length === L.length, 'Excel : toutes les lignes, en une table');
  assert(V.filter(v => v.Nom === null).length === Math.floor(L.length / 7) && V[0].Formation_demandee, 'cases manquantes de l\'Excel = cases vides (colonnes non décalées)');
  g.srv.close();
  const g2 = await fauxGrist();
  const r2 = await lancer(['charger', ecrireCSV('bdd_win.csv', L, { sep: ',', enc: 'latin1' }), '--reglages', reglages('reglages.json', g2.url, { separer: false, extra: { tables: { voeux: { nom: 'Voeux', colonnes: { 'Numéro candidat': 'Numéro', Département: 'Département', 'Nb voeux': 'Nb voeux' } } } } })]);
  const V2 = g2.etat.tables.Voeux?.lignes || [];
  assert(r2.code === 0 && V2.length === L.length && V2[0].Departement && typeof V2[0].Nb_voeux === 'number', 'CSV séparé par des virgules, en Windows-1252 : accents et nombres lus');
  g2.srv.close();
});

await describe('Essai sur les premières lignes', async () => {
  const g = await fauxGrist();
  const r = await lancer(['charger', ecrireCSV('bdd.csv', L), '--reglages', reglages('reglages.json', g.url), '--essai', '25']);
  assert(r.code === 0 && g.etat.tables.Voeux_essai?.lignes.length === 25 && !g.etat.tables.Voeux, 'essai : 25 lignes, dans « Voeux_essai » (la vraie table n\'est pas créée)');
  assert(g.etat.tables.Eleves_essai?.lignes.length === new Set(L.slice(0, 25).map(l => l[0])).size, 'essai : les élèves de ces 25 lignes');
  g.srv.close();
});

await describe('Sécurité : pas de doublon, rien de supprimé', async () => {
  const g = await fauxGrist();
  g.etat.tables.Voeux = { colonnes: [], lignes: [{ x: 1 }, { x: 2 }] };
  const r = await lancer(['charger', ecrireCSV('bdd.csv', L), '--reglages', reglages('reglages.json', g.url)]);
  assert(r.code !== 0 && /existe déjà dans Grist et contient 2 lignes/.test(r.out) && g.etat.postsRecords === 0, 'table déjà remplie : rien n\'est envoyé, le message l\'explique');
  assert(g.etat.tables.Voeux.lignes.length === 2 && !g.etat.requetes.some(q => /delete|DELETE/.test(q)), 'faux positif : les lignes existantes ne sont ni supprimées ni modifiées');
  const r2 = await lancer(['charger', ecrireCSV('bdd.csv', L), '--reglages', reglages('reglages.json', g.url, { separer: false, extra: { tables: { voeux: { nom: 'Autre', colonnes: { 'Colonne absente': 'X' } } } } })]);
  assert(r2.code !== 0 && /Colonnes absentes du fichier : « Colonne absente »/.test(r2.out) && g.etat.postsRecords === 0, 'colonne des réglages absente du fichier : arrêt avant tout envoi');
  const r3 = await lancer(['charger', ecrireCSV('bdd.csv', L), '--reglages', reglages('reglages.json', g.url)], { env: { GRIST_API_KEY: 'mauvaise-cle' } });
  assert(r3.code !== 0 && /Accès refusé par Grist/.test(r3.out) && !r3.out.includes('mauvaise-cle'), 'clé refusée : message clair, clé non affichée');
  g.srv.close();
});

await describe('Coupure en cours de route, puis reprise : aucun doublon', async () => {
  const opts = { panneApres: 4 };
  const g = await fauxGrist(opts);
  const regl = reglages('reglages.json', g.url, { paquet: 20 });
  const f = ecrireCSV('bdd.csv', L);
  const r1 = await lancer(['charger', f, '--reglages', regl]);
  assert(r1.code !== 0 && /Relancez la même commande/.test(r1.out), 'Grist en panne : arrêt, avec la consigne de relancer');
  assert(fs.readdirSync(path.dirname(regl)).some(x => x.startsWith('.reprise_Voeux')), 'point de reprise gardé');
  const avant = (g.etat.tables.Voeux?.lignes || []).length;
  assert(avant > 0 && avant < L.length, `chargement partiel (${avant} lignes sur ${L.length})`);
  opts.panneApres = 0; // le même Grist, réparé
  const r2 = await lancer(['charger', f, '--reglages', regl]);
  const E = g.etat.tables.Eleves.lignes, V = g.etat.tables.Voeux.lignes;
  assert(r2.code === 0 && /Chargement complet et vérifié/.test(r2.out), 'relance : chargement complété et vérifié');
  assert(V.length === L.length && E.length === NB_ELEVES && new Set(E.map(e => e.Numero_candidat)).size === NB_ELEVES, 'aucun doublon après la reprise (vœux et élèves)');
  assert(V.map(v => v.Numero_candidat + v.Rang).join() === L.map(l => l[0] + l[5]).join(), 'vœux dans l\'ordre du fichier, sans trou');
  g.srv.close();
});

await describe('Grist surchargé un instant (429) : nouvel essai automatique', async () => {
  const g = await fauxGrist({ surcharge: 2 });
  const r = await lancer(['charger', ecrireCSV('bdd.csv', L), '--reglages', reglages('reglages.json', g.url)]);
  assert(r.code === 0 && g.etat.tables.Voeux.lignes.length === L.length && g.etat.tables.Eleves.lignes.length === NB_ELEVES, 'chargement complet malgré la surcharge, sans doublon');
  g.srv.close();
});

await describe('Vérification finale : un lot perdu est signalé', async () => {
  const g = await fauxGrist({ perdre: 3 });
  const r = await lancer(['charger', ecrireCSV('bdd.csv', L), '--reglages', reglages('reglages.json', g.url)]);
  assert(r.code === 2 && /INCOMPLET/.test(r.out) && !/Chargement complet et vérifié/.test(r.out), 'Grist a moins de lignes que le fichier : « INCOMPLET », jamais « vérifié »');
  g.srv.close();
});

await describe('Noms de colonnes Grist', async () => {
  const g = await fauxGrist();
  const regl = reglages('reglages.json', g.url, { separer: false, extra: { tables: { voeux: { nom: 'Vœux 2025', colonnes: { 'Nb vœux': 'id', 'Rang vœu': 'Nb vœux', 'Formation demandée': 'Nb vœux !' } } } } });
  const r = await lancer(['charger', ecrireCSV('bdd.csv', L), '--reglages', regl]);
  const t = g.etat.tables.Voeux_2025;
  const ids = (t?.colonnes || []).map(c => c.id);
  assert(r.code === 0 && t, 'nom de table sans accent ni espace (« Voeux_2025 »)');
  assert(!ids.includes('id') && new Set(ids.map(x => x.toLowerCase())).size === ids.length && ids.includes('Nb_voeux'), `identifiants valides, uniques, « id » réservé évité (${ids.join(', ')})`);
  g.srv.close();
});


// ─── Fichier d'affectation fictif (structure d'un export Affelnet : une ligne par vœu) ─────────────────────
const AFF_ENTETES = ['Identifiant élève', 'Nom élève', 'Prénom élève', 'Eleve', 'Classe origine', 'Département origine élève',
  'Nom complément. étab national élève', 'Code voeu élève', 'Libellé formation voeu', 'Capacité affectation voeu', 'Ville étab. voeu',
  'Rang voeu élève', 'Bonus filière OPA', 'Code avis chef étab. voeu', 'Code décision finale résultat élève par tour', "Nombre d'admis voeu1", 'Compteur'];
function affectation(nElv = 120, seed = 9) {
  let x = seed; const r = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  const offres = Array.from({ length: 25 }, (_, i) => [`V${String(i).padStart(4, '0')}`, ['1re générale', '1re STMG', '1re STI2D', '1re pro'][i % 4], 30 + i, ['Bordeaux', 'Pau', 'Agen'][i % 3]]);
  const out = []; const dejaVu = new Set();
  for (let e = 1; e <= nElv; e++) {
    const nv = 1 + Math.floor(r() * 6), id = `E${String(e).padStart(6, '0')}`;
    for (let v = 1; v <= nv; v++) {
      const o = offres[Math.floor(r() * offres.length)];
      out.push([id, `NomFictif${e}`, `Prenom${e}`, `NomFictif${e} Prenom${e}`, ['2nde GT', '2nde pro'][e % 2], ['Gironde', 'Landes'][e % 2],
        `Lycée Fictif ${e % 9}`, o[0], o[1], o[2], o[3], v, v === 1 ? 10 : 0, v % 3 === 0 ? 'F' : '', String(1 + (v + e) % 4),
        dejaVu.has(o[0]) ? '' : (dejaVu.add(o[0]), 7), 1]); // total de l'export : rempli sur une seule ligne par offre
    }
  }
  return out;
}
function ecrireCSVAff(nom, lignes) {
  const f = path.join(TMP, nom);
  fs.writeFileSync(f, [AFF_ENTETES.join(';'), ...lignes.map(l => l.join(';'))].join('\n'));
  return f;
}
const A = affectation();
const A_ELEVES = new Set(A.map(l => l[0])).size, A_OFFRES = new Set(A.map(l => l[7])).size;

await describe('Inspection v2 : rangement automatique en trois tables, noms écartés', async () => {
  const f = ecrireCSVAff('aff.csv', A);
  const regl = path.join(TMP, 'reglages_aff.json');
  const r = await lancer(['inspecter', f, '--reglages', regl]);
  assert(r.code === 0, 'inspection terminée');
  assert(new RegExp(`Identifiant de l'élève : « Identifiant élève » — ${A_ELEVES} élèves`).test(r.out), `identifiant élève : ${A_ELEVES} élèves`);
  assert(new RegExp(`Identifiant du vœu \\(offre\\) : « Code voeu élève » — ${A_OFFRES} vœux possibles`).test(r.out), `identifiant de l'offre : « Code voeu élève » (${A_OFFRES}), pas « Code avis chef étab. voeu »`);
  const R = JSON.parse(fs.readFileSync(regl, 'utf8'));
  const [E, O] = R.tables.references, V = R.tables.principale;
  assert(E.cle === 'Identifiant élève' && ['Classe origine', 'Département origine élève', 'Nom complément. étab national élève'].every(c => c in E.colonnes), 'Élèves : les colonnes constantes pour un même élève');
  assert(O.cle === 'Code voeu élève' && ['Libellé formation voeu', 'Capacité affectation voeu', 'Ville étab. voeu'].every(c => c in O.colonnes), 'Offre : les colonnes constantes pour un même code vœu');
  assert(['Identifiant élève', 'Code voeu élève', 'Rang voeu élève', 'Bonus filière OPA', 'Code avis chef étab. voeu', 'Code décision finale résultat élève par tour'].every(c => c in V.colonnes), 'Vœux : les liens + ce qui change d\'un vœu à l\'autre (rang, bonus, avis, décision)');
  assert(!('Classe origine' in V.colonnes) && !('Libellé formation voeu' in V.colonnes) && !('Rang voeu élève' in E.colonnes), 'faux positif : aucune colonne en double ni mal rangée');
  assert(['Nom élève', 'Prénom élève', 'Eleve'].every(c => R.tables.ecartees.includes(c) && !(c in E.colonnes) && !(c in V.colonnes)), 'nom, prénom et « Eleve » écartés (non chargés)');
  assert('Nom complément. étab national élève' in E.colonnes, 'faux positif : le NOM D’ÉTABLISSEMENT n’est pas écarté');
  assert(!/NomFictif|Prenom\d|Lycée Fictif|V00\d\d|E0000/.test(r.out) && !/NomFictif|Prenom\d|V00\d\d/.test(fs.readFileSync(regl, 'utf8')), 'aucune valeur du fichier affichée ni écrite dans les réglages');
  assert(/Élèves : 120 lignes/.test(r.out) && /cases au lieu de/.test(r.out), 'taille estimée de chaque table');
  const r2 = await lancer(['inspecter', f, '--reglages', path.join(TMP, 'reglages_noms.json'), '--garder-noms']);
  const R2 = JSON.parse(fs.readFileSync(path.join(TMP, 'reglages_noms.json'), 'utf8'));
  assert(r2.code === 0 && R2.tables.ecartees.length === 0 && 'Nom élève' in R2.tables.references[0].colonnes, '--garder-noms : noms gardés, dans la table Élèves');
  const r3 = await lancer(['inspecter', f, '--reglages', path.join(TMP, 'r3.json'), '--cle-eleve', 'Colonne inconnue']);
  assert(r3.code !== 0 && /--cle-eleve : colonne « Colonne inconnue » absente/.test(r3.out), 'identifiant imposé inconnu : message clair');
  // réglages déjà complétés : jamais écrasés
  const Rc = { ...R, grist: { ...R.grist, document: 'DOC1' } };
  fs.writeFileSync(regl, JSON.stringify(Rc));
  const r4 = await lancer(['inspecter', f, '--reglages', regl]);
  assert(r4.code === 0 && JSON.parse(fs.readFileSync(regl, 'utf8')).grist.document === 'DOC1' && fs.existsSync(regl.replace('.json', '_nouveau.json')), 'réglages déjà complétés : gardés, les nouveaux à côté (« _nouveau »)');
});

await describe('Chargement en trois tables liées (Élèves, Offre, Vœux)', async () => {
  const f = ecrireCSVAff('aff.csv', A);
  const regl = path.join(TMP, 'reglages_aff3.json');
  await lancer(['inspecter', f, '--reglages', regl]);
  const R = JSON.parse(fs.readFileSync(regl, 'utf8'));
  R.grist = { serveur: '', document: 'DOC1' }; R.paquet = 40;
  const d = fs.mkdtempSync(path.join(TMP, 'r3-'));
  fs.writeFileSync(path.join(d, 'cle_grist.txt'), CLE);
  const opts = {};
  const g = await fauxGrist(opts);
  R.grist.serveur = g.url;
  fs.writeFileSync(path.join(d, 'reglages.json'), JSON.stringify(R));
  const r = await lancer(['charger', f, '--reglages', path.join(d, 'reglages.json')]);
  const T = g.etat.tables;
  assert(r.code === 0 && /Chargement complet et vérifié/.test(r.out), 'chargement complet et vérifié');
  assert(T.Voeux.lignes.length === A.length && T.Eleves.lignes.length === A_ELEVES && T.Offre.lignes.length === A_OFFRES, `Vœux ${A.length}, Élèves ${A_ELEVES}, Offre ${A_OFFRES}`);
  const o = T.Offre.lignes.find(x => x.Code_voeu_eleve === 'V0003');
  assert(o && o.Libelle_formation_voeu === '1re pro' && o.Capacite_affectation_voeu === 33 && o.Ville_etab_voeu === 'Bordeaux', 'Offre : les informations du vœu possible, une seule fois');
  assert(T.Voeux.lignes.every(v => /^E\d{6}$/.test(v.Identifiant_eleve) && /^V\d{4}$/.test(v.Code_voeu_eleve)), 'chaque vœu porte les deux liens (élève, offre)');
  assert(!T.Eleves.colonnes.some(c => /Nom_eleve|Prenom|^Eleve$/.test(c.id)) && !JSON.stringify(T).includes('NomFictif'), 'aucun nom ni prénom d’élève envoyé à Grist');
  assert(/changez le type des colonnes « Identifiant élève », « Code voeu élève » en « Référence »/.test(r.out), 'consigne pour relier les tables dans Grist');
  g.srv.close();
});

await describe('Trois tables : coupure puis reprise, sans doublon', async () => {
  const f = ecrireCSVAff('aff.csv', A);
  const regl = path.join(TMP, 'reglages_aff4.json');
  await lancer(['inspecter', f, '--reglages', regl]);
  const opts = { panneApres: 7 };
  const g = await fauxGrist(opts);
  const R = JSON.parse(fs.readFileSync(regl, 'utf8'));
  R.grist = { serveur: g.url, document: 'DOC1' }; R.paquet = 30;
  const d = fs.mkdtempSync(path.join(TMP, 'r4-'));
  fs.writeFileSync(path.join(d, 'cle_grist.txt'), CLE);
  fs.writeFileSync(path.join(d, 'reglages.json'), JSON.stringify(R));
  const r1 = await lancer(['charger', f, '--reglages', path.join(d, 'reglages.json')]);
  assert(r1.code !== 0 && g.etat.tables.Voeux.lignes.length < A.length, 'panne : chargement partiel');
  opts.panneApres = 0;
  const r2 = await lancer(['charger', f, '--reglages', path.join(d, 'reglages.json')]);
  const T = g.etat.tables;
  assert(r2.code === 0 && /Chargement complet et vérifié/.test(r2.out), 'relance : complet et vérifié');
  assert(T.Voeux.lignes.length === A.length && new Set(T.Eleves.lignes.map(x => x.Identifiant_eleve)).size === T.Eleves.lignes.length && T.Eleves.lignes.length === A_ELEVES && T.Offre.lignes.length === A_OFFRES, 'aucun doublon dans les trois tables');
  g.srv.close();
});


await describe('Colonnes écartées à la demande, totaux de l\'export signalés, ID du document en option', async () => {
  const f = ecrireCSVAff('aff.csv', A);
  const regl = path.join(TMP, 'reglages_ec.json');
  const r = await lancer(['inspecter', f, '--reglages', regl]);
  assert(/Attention : « Nombre d'admis voeu1 » ressemblent? à des totaux/.test(r.out) && /--ecarter "Nombre d'admis voeu1"/.test(r.out), 'total de l’export (rempli sur une partie des lignes) signalé, avec la commande pour l’écarter');
  assert(!/« Compteur » ressembl/.test(r.out), 'faux positif : « Compteur » (1 sur chaque ligne) n’est pas signalé');
  const r2 = await lancer(['inspecter', f, '--reglages', path.join(TMP, 'reglages_ec2.json'), '--ecarter', "Nombre d'admis voeu1", 'Ville étab. voeu']);
  const R2 = JSON.parse(fs.readFileSync(path.join(TMP, 'reglages_ec2.json'), 'utf8'));
  const toutes = [R2.tables.principale, ...R2.tables.references].flatMap(t => Object.keys(t.colonnes));
  assert(r2.code === 0 && !toutes.includes("Nombre d'admis voeu1") && !toutes.includes('Ville étab. voeu') && R2.tables.ecartees.includes('Ville étab. voeu'), '--ecarter : colonnes retirées de toutes les tables');
  assert(/Colonnes écartées à votre demande : « Nombre d'admis voeu1 », « Ville étab. voeu »/.test(r2.out) && !/Attention :/.test(r2.out), 'colonnes écartées annoncées ; plus d’avertissement');
  const r3 = await lancer(['inspecter', f, '--reglages', path.join(TMP, 'r_ec3.json'), '--ecarter', 'Code voeu élève']);
  assert(r3.code !== 0 && /on ne peut pas écarter un identifiant/.test(r3.out), 'faux positif : un identifiant (lien entre tables) ne peut pas être écarté');
  const r4 = await lancer(['inspecter', f, '--reglages', path.join(TMP, 'r_ec4.json'), '--ecarter', 'Colonne inventée']);
  assert(r4.code !== 0 && /Colonne\(s\) absente\(s\) du fichier : « Colonne inventée »/.test(r4.out), 'colonne inconnue : message clair');
  // --document : pas besoin de modifier les réglages à la main
  const g = await fauxGrist();
  const d = fs.mkdtempSync(path.join(TMP, 'rd-'));
  fs.writeFileSync(path.join(d, 'cle_grist.txt'), CLE);
  const R = JSON.parse(fs.readFileSync(path.join(TMP, 'reglages_ec2.json'), 'utf8'));
  R.grist.serveur = g.url; // document laissé à « ID_DU_DOCUMENT »
  fs.writeFileSync(path.join(d, 'reglages.json'), JSON.stringify(R));
  const sans = await lancer(['charger', f, '--reglages', path.join(d, 'reglages.json')]);
  assert(sans.code !== 0 && /ajoutez --document SON_ID/.test(sans.out) && g.etat.postsRecords === 0, 'sans ID du document : rien n’est envoyé, la commande à ajouter est indiquée');
  const avec = await lancer(['charger', f, '--reglages', path.join(d, 'reglages.json'), '--document', 'DOC1', '--essai', '50']);
  assert(avec.code === 0 && g.etat.tables.Voeux_essai?.lignes.length === 50, '--document DOC1 : essai de 50 lignes chargé');
  g.srv.close();
});


await describe('Commande « resume » : deviner le code « affecté » à partir des données (sans aucune donnée d’élève)', async () => {
  // règle Affelnet : affecté sur un seul vœu ; liste supplémentaire avant (mieux classé), refusé après
  let x = 5; const r = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  const lignes = [];
  for (let e = 1; e <= 300; e++) {
    const nv = 1 + Math.floor(r() * 6), aff = r() < 0.85 ? 1 + Math.floor(r() * nv) : 0; // 15 % sans affectation
    for (let v = 1; v <= nv; v++) {
      const code = aff === 0 ? (v % 2 ? '3' : '6') : v < aff ? '2' : v === aff ? '1' : '3';
      lignes.push([`E${String(e).padStart(6, '0')}`, `NomFictif${e}`, v, code]);
    }
  }
  const f = path.join(TMP, 'decisions.csv');
  fs.writeFileSync(f, ['Identifiant élève;Nom élève;Rang voeu élève;Code décision finale résultat élève par tour', ...lignes.map(l => l.join(';'))].join('\n'));
  const res = await lancer(['resume', f]);
  assert(res.code === 0 && /Proposition : « 1 » = AFFECTÉ/.test(res.out), 'code « 1 » proposé comme AFFECTÉ (jamais deux fois pour un même élève)');
  assert(/AVANT le vœu affecté \(mieux classé\) : 2 → probablement LISTE SUPPLÉMENTAIRE/.test(res.out), 'code « 2 » : avant le vœu affecté → liste supplémentaire');
  assert(/APRÈS le vœu affecté \(moins bien classé\) : 3 → probablement REFUSÉ/.test(res.out), 'code « 3 » : après le vœu affecté → refusé');
  assert(!/6 → probablement/.test(res.out), 'faux positif : « 6 » (seulement chez les élèves sans affectation) n’est pas deviné');
  assert(/À faire confirmer par le service de l'affectation/.test(res.out), 'la proposition est présentée comme à confirmer');
  assert(!/NomFictif|E0000/.test(res.out), 'aucune valeur d’élève affichée (seulement des codes et des nombres)');
  const nbEleves = new Set(lignes.map(l => l[0])).size;
  const fr = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  assert(res.out.includes(`${fr(lignes.length)} lignes, ${fr(nbEleves)} élèves`), 'totaux de lignes et d’élèves');
  const res2 = await lancer(['resume', f, '--colonne', 'Inexistante']);
  assert(res2.code !== 0 && /« Inexistante » absente/.test(res2.out), 'colonne inconnue : message clair');
});


await describe('Diagnostic de structure : code par élève, lignes en double pour un même rang', async () => {
  // forme du vrai export : un code de résultat répété sur toutes les lignes de l'élève ; chaque vœu présent pour 2 tours
  const lignes = [];
  for (let e = 1; e <= 200; e++) {
    const code = e % 10 === 0 ? '3' : '1', nv = 1 + (e % 4);
    for (let tour = 1; tour <= 2; tour++) for (let v = 1; v <= nv; v++) lignes.push([`E${String(e).padStart(6, '0')}`, `NomFictif${e}`, v, tour, code, `V${v}`]);
  }
  const f = path.join(TMP, 'structure.csv');
  fs.writeFileSync(f, ['Identifiant élève;Nom élève;Rang voeu élève;Compteur;Code décision finale résultat élève par tour;Code voeu élève', ...lignes.map(l => l.join(';'))].join('\n'));
  const r = await lancer(['resume', f]);
  assert(r.code === 0 && /200 élèves ont le même code sur toutes leurs lignes ; 0 en ont plusieurs/.test(r.out), 'code identique sur toutes les lignes de chaque élève : compté');
  assert(/ressemble à un RÉSULTAT PAR ÉLÈVE/.test(r.out), 'conclusion : résultat par élève, pas décision par vœu');
  const paires = new Set(lignes.map(l => l[0] + '|' + l[2])).size;
  assert(r.out.includes(`${paires} couples (élève, rang de vœu) différents ; ${paires} ont plusieurs lignes`), 'couples (élève, rang) en double comptés');
  assert(/« Compteur » : \d+/.test(r.out) && !/« Code voeu élève » : \d+\n/.test(r.out.split('Valeurs des petites')[0]), 'ce qui distingue les doublons : « Compteur » (le tour), pas le code vœu');
  assert(/« Compteur » — 1 : \d+, 2 : \d+|« Compteur » — 2 : \d+, 1 : \d+/.test(r.out), 'valeurs des petites colonnes de codes affichées (Compteur : 1 et 2)');
  assert(!/NomFictif|E0000/.test(r.out) && !/« Nom élève » —/.test(r.out) && !/« Identifiant élève » —/.test(r.out), 'aucun nom ni identifiant d’élève affiché');
});


// ─── Export d'affectation réaliste : chaque vœu répété (lignes de capacité), indicateurs « Nombre d'admis… » ──────────
const R_ENTETES = ['Identifiant élève', 'Nom élève', 'Département origine élève', 'Localité achemin. étab. nat. élève', 'Classe origine',
  'Code voeu élève', 'Libellé formation voeu', 'Rang voeu élève', 'Code décision finale résultat élève par tour', 'Capacité affectation voeu',
  'Compteur', "Nombre d'admis tous voeux", "Nombre d'admis voeu1", 'Nombre de candidats voeu1'];
function exportRealiste(nElv = 150, seed = 13) {
  let x = seed; const r = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  const lignes = [], verite = { voeux: 0, admisV1: new Set(), affectes: new Set(), landes: new Set(), bordeaux: new Set(), admisV1Pro: new Set() };
  for (let e = 1; e <= nElv; e++) {
    const id = `E${String(e).padStart(6, '0')}`, dep = ['Gironde', 'Landes', 'Dordogne'][e % 3], ville = ['BORDEAUX', 'DAX', 'PERIGUEUX', 'Bordeaux Cedex'][e % 4];
    const classe = ['2nde GT', '2nde PRO', 'Autre'][e % 3], nv = 1 + Math.floor(r() * 4), aff = r() < 0.9 ? 1 + Math.floor(r() * nv) : 0;
    const code = aff ? '1' : '3';
    if (dep === 'Landes') verite.landes.add(id);
    if (/bordeaux/i.test(ville)) verite.bordeaux.add(id);
    if (aff) verite.affectes.add(id);
    if (aff === 1) { verite.admisV1.add(id); if (classe === '2nde PRO') verite.admisV1Pro.add(id); }
    for (let v = 1; v <= nv; v++) {
      verite.voeux++;
      const copies = 1 + Math.floor(r() * 3); // le même vœu répété 1 à 3 fois (lignes de capacité)
      for (let k = 0; k < copies; k++) {
        const admisIci = v === aff && k === 0; // l'indicateur n'est rempli que sur UNE des copies
        lignes.push([id, `NomFictif${e}`, dep, ville, classe, `V${v}${e % 7}`, `1re ${v % 2 ? 'PRO' : 'GT'}`, v, code, 20 + k * 5, copies,
          admisIci ? copies : '', admisIci && v === 1 ? copies : '', v === 1 ? copies : '']);
      }
    }
  }
  return { lignes, verite };
}
const RE = exportRealiste();
const fRE = path.join(TMP, 'export_reel.csv');
fs.writeFileSync(fRE, [R_ENTETES.join(';'), ...RE.lignes.map(l => l.join(';'))].join('\n'));
const OPTS_RE = ['--regrouper', 'Identifiant élève', 'Rang voeu élève', 'Code voeu élève', 'Code décision finale résultat élève par tour',
  '--indicateurs', "Nombre d'admis tous voeux", "Nombre d'admis voeu1", 'Nombre de candidats voeu1', '--ecarter', 'Compteur', 'Capacité affectation voeu'];

await describe('Lignes en double d’un même vœu : regroupées en un seul vœu, indicateurs en Oui / Non', async () => {
  const regl = path.join(TMP, 'reglages_reel.json');
  const r = await lancer(['inspecter', fRE, '--reglages', regl, ...OPTS_RE]);
  assert(r.code === 0 && r.out.includes(`(${RE.verite.voeux} vœux)`) && r.out.includes(`après regroupement des ${RE.lignes.length} lignes`), `inspection : ${RE.lignes.length} lignes → ${RE.verite.voeux} vœux annoncés`);
  const R = JSON.parse(fs.readFileSync(regl, 'utf8'));
  assert(R.tables.principale.regrouper.length === 4 && R.tables.principale.indicateurs.length === 3 && R.tables.principale.colonnes["Nombre d'admis voeu1"] === "Nombre d'admis voeu1 (oui/non)", 'réglages : regroupement et indicateurs enregistrés');
  assert(!/Attention :/.test(r.out), 'faux positif : les indicateurs déclarés ne sont plus signalés comme totaux');
  const g = await fauxGrist();
  const d = fs.mkdtempSync(path.join(TMP, 'rr-'));
  fs.writeFileSync(path.join(d, 'cle_grist.txt'), CLE);
  R.grist = { serveur: g.url, document: 'DOC1' }; R.paquet = 60;
  fs.writeFileSync(path.join(d, 'reglages.json'), JSON.stringify(R));
  const c = await lancer(['charger', fRE, '--reglages', path.join(d, 'reglages.json')]);
  const V = g.etat.tables.Voeux.lignes;
  assert(c.code === 0 && /Chargement complet et vérifié/.test(c.out) && V.length === RE.verite.voeux, `Grist : ${RE.verite.voeux} vœux (et non ${RE.lignes.length} lignes)`);
  const col = n => Object.keys(V[0]).find(k => k.startsWith(n));
  const admis = V.filter(v => v[col('Nombre_d_admis_tous')] === 'Oui'), admisV1 = V.filter(v => v[col('Nombre_d_admis_voeu1')] === 'Oui');
  assert(admis.length === RE.verite.affectes.size && new Set(admis.map(v => v.Identifiant_eleve)).size === RE.verite.affectes.size, 'un seul vœu « admis » par élève affecté, même si l’indicateur n’était rempli que sur une copie');
  assert(admisV1.length === RE.verite.admisV1.size && admisV1.every(v => v.Rang_voeu_eleve === 1), 'admis sur le vœu 1 : le bon nombre, tous de rang 1');
  assert(V.every(v => ['Oui', 'Non'].includes(v[col('Nombre_de_candidats')])) && V.filter(v => v[col('Nombre_de_candidats')] === 'Oui').length === V.filter(v => v.Rang_voeu_eleve === 1).length, 'indicateur « vœu 1 » = Oui exactement sur les vœux de rang 1');
  assert(!JSON.stringify(g.etat.tables).includes('NomFictif') && !Object.keys(V[0]).some(k => /Compteur|Capacite/.test(k)), 'ni nom d’élève, ni Compteur, ni capacité (répétitions de l’export)');
  g.srv.close();
});

await describe('Commande « chiffres » : nombre d’élèves différents, sans aucune donnée d’élève affichée', async () => {
  const nb = async (...args) => { const r = await lancer(['chiffres', fRE, ...args]); return { r, n: Number((r.out.match(/Élèves différents : ([\d ]+)/) || [])[1]?.replace(/ /g, '')) }; };
  assert((await nb()).n === RE.verite.affectes.size + [...new Set(RE.lignes.map(l => l[0]))].filter(i => !RE.verite.affectes.has(i)).length, 'total : chaque élève compté une fois (pas une fois par ligne)');
  assert((await nb('--non-vide', "Nombre d'admis voeu1")).n === RE.verite.admisV1.size, `élèves admis sur leur vœu 1 : ${RE.verite.admisV1.size}`);
  assert((await nb('--si', 'Code décision finale résultat élève par tour=1')).n === RE.verite.affectes.size, 'élèves affectés (code 1)');
  assert((await nb('--si', 'Département origine élève=Landes')).n === RE.verite.landes.size, `élèves des Landes : ${RE.verite.landes.size}`);
  assert((await nb('--si', 'Localité achemin. étab. nat. élève~bordeaux')).n === RE.verite.bordeaux.size, '« ~ » : contient (BORDEAUX et Bordeaux Cedex)');
  const p = await nb('--non-vide', "Nombre d'admis voeu1", '--par', 'Classe origine');
  assert(p.r.out.includes(`2nde PRO : ${RE.verite.admisV1Pro.size}`), 'détail par classe d’origine (admis sur le vœu 1 venant de 2nde PRO)');
  assert(!/NomFictif|E0000/.test(p.r.out), 'aucun nom ni identifiant affiché');
  const refus = await lancer(['chiffres', fRE, '--par', 'Nom élève']);
  assert(refus.code !== 0 && /pas de détail par nom ou par identifiant/.test(refus.out), 'faux positif : détail par nom d’élève refusé');
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log('\n──────────────────────────────────────────────────');
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
