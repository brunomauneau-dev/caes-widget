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
  assert(new RegExp(`« Numéro candidat » : ${NB_ELEVES} valeurs différentes`).test(r.out) && /une ligne par vœu/.test(r.out), 'identifiant élève repéré : une ligne par vœu, deux tables conseillées');
  const R = JSON.parse(fs.readFileSync(regl, 'utf8'));
  assert(R.ligne_entete === 3 && R.tables.eleves.cle === 'Numéro candidat' && Object.keys(R.tables.voeux.colonnes).length === 9, 'fichier de réglages préparé (sans aucune valeur)');
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

fs.rmSync(TMP, { recursive: true, force: true });
console.log('\n──────────────────────────────────────────────────');
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
