// tests/navigateur.mjs — Le widget ouvert dans un vrai navigateur (Chromium), comme dans Grist.
// Pourquoi : la panne de v27.5.104 (plus aucun calcul) ne se voyait que dans la page — les tests Node chargent les
// modules dans un autre ordre. Ici : la vraie page index.html, ses scripts dans leur ordre, Grist simulé (données
// fictives), Albert et l'open data coupés (aucun appel réseau). On vérifie qu'aucune erreur ne survient et que les
// chiffres affichés sont exacts. Lancé par GitHub Actions (tests.yml, tâche « navigateur ») à chaque modification.
// node tests/navigateur.mjs        (Playwright requis : npm install --no-save playwright && npx playwright install chromium)

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import * as D from '../js/fixtures/donnees_simulees.mjs';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(import.meta.url)('playwright');

let passed = 0, failed = 0;
function assert(condition, label) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}`); failed++; }
}

// ─── Serveur local de la page ────────────────────────────────────────────────
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const srv = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(0, r));
const BASE = `http://localhost:${srv.address().port}`;

// ─── Données fictives ────────────────────────────────────────────────────────
let x = 5; const r = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648; const pick = a => a[Math.floor(r() * a.length)];
const ETABS = [['Lycée Montaigne', 'Bordeaux'], ['Lycée Borda', 'Dax'], ['Lycée Barthou', 'Pau'], ['Lycée Eiffel', 'Bordeaux']].map(([Nom, Ville], i) => ({ id: i + 1, Nom, Ville }));
const SPE = ['Maths', 'SES', 'Physique', 'SVT', 'HGGSP', 'NSI'];
const CANDIDATS = Array.from({ length: 400 }, (_, i) => ({ id: i + 1, Nom_eleve: `E${i}`, Boursier: r() < 0.25,
  Specialites: (() => { const a = pick(SPE), b = pick(SPE.filter(s => s !== a)); return [a, b]; })(), Statut: pick(['Admis', 'En attente', 'Refusé']), Etablissement: 1 + Math.floor(r() * 4) }));
const AFF = D.affectation(600, 31);
const colonnes = rows => { const o = {}; Object.keys(rows[0]).forEach(k => { o[k] = rows.map(v => v[k]); }); return o; };

// ─── Une page, Grist simulé ──────────────────────────────────────────────────
const navigateur = await chromium.launch();
async function ouvrir({ courante, enregistrements, tables }) {
  const page = await navigateur.newPage({ viewport: { width: 480, height: 900 } });
  const erreurs = [];
  page.on('pageerror', e => erreurs.push(e.message));
  await page.addInitScript(({ courante, tables }) => {
    window.__cb = null;
    window.grist = { ready() {}, onRecord() {}, onOptions(cb) { setTimeout(() => cb({}), 0); }, setOptions() {}, onRecords(cb) { window.__cb = cb; },
      selectedTable: { getTableId: async () => courante },
      docApi: { listTables: async () => [courante, ...Object.keys(tables)], fetchTable: async id => tables[id] } };
  }, { courante, tables });
  // aucun appel réseau : seule la page locale répond (Albert et l'open data échouent proprement)
  await page.route('**/*', route => route.request().url().startsWith(BASE) ? route.continue() : route.fulfill({ status: 503, body: '{}' }));
  await page.goto(`${BASE}/index.html`);
  await page.waitForFunction(() => typeof window.__cb === 'function', null, { timeout: 15000 });
  await page.evaluate(v => window.__cb(v), enregistrements);
  await page.waitForTimeout(800);
  await page.evaluate(() => setActiveSource('grist'));
  await page.waitForTimeout(300);
  const poser = async q => {
    const avant = await page.locator('.msg.assistant .msg-bubble').count();
    await page.fill('#chat-input', q);
    await page.click('#btn-send');
    await page.waitForFunction(n => document.querySelectorAll('.msg.assistant .msg-bubble').length > n && /Calcul exact|Critère non reconnu|non reconnu|NON/i.test([...document.querySelectorAll('.msg.assistant .msg-bubble')].pop().innerText), avant, { timeout: 15000 }).catch(() => {});
    return page.evaluate(() => ([...document.querySelectorAll('.msg.assistant .msg-bubble')].pop()?.innerText || '').replace(/\s+/g, ' '));
  };
  return { page, erreurs, poser };
}
const nombre = (texte, n) => new RegExp(`(^|[^\\d])${n.toLocaleString('fr-FR').replace(/\s/g, '[\\s\\u202f\\u00a0]')}([^\\d]|$)`).test(texte);

try {
  console.log('\nTable Grist de candidats (cases à cocher, listes de choix, référence vers Etablissements)');
  const g = await ouvrir({ courante: 'Candidats', enregistrements: CANDIDATS, tables: { Etablissements: colonnes(ETABS) } });
  const ses = CANDIDATS.filter(o => o.Specialites.includes('SES')).length, bx = CANDIDATS.filter(o => ETABS[o.Etablissement - 1].Ville === 'Bordeaux').length;
  const boursiers = CANDIDATS.filter(o => o.Boursier).length;
  const t1 = await g.poser('combien de candidats boursiers');
  assert(/Calcul exact/.test(t1) && nombre(t1, boursiers), `« combien de candidats boursiers » : ${boursiers} affiché`);
  const t2 = await g.poser('combien de candidats ayant la spécialité SES');
  assert(/Calcul exact/.test(t2) && nombre(t2, ses), `« spécialité SES » : ${ses} affiché`);
  const t3 = await g.poser('combien de candidats de Bordeaux');
  assert(/Calcul exact/.test(t3) && nombre(t3, bx), `« candidats de Bordeaux » (par la référence) : ${bx} affiché`);
  assert(!g.erreurs.length, `aucune erreur dans la page${g.erreurs.length ? ` (${g.erreurs.slice(0, 3).join(' ; ')})` : ''}`);

  console.log('\nBase d\'affectation (tables Voeux, Eleves, Offre)');
  const a = await ouvrir({ courante: 'Voeux', enregistrements: AFF.voeux.map((v, i) => ({ id: i + 1, ...v })), tables: { Eleves: colonnes(AFF.eleves), Offre: colonnes(AFF.offre) } });
  const v1 = new Set(AFF.voeux.filter(v => v.Nombre_d_admis_voeu1_oui_non === 'Oui').map(v => v.Identifiant_eleve)).size;
  const chips = await a.page.evaluate(() => [...document.querySelectorAll('#suggestions .sugg-chip')].map(c => c.textContent));
  assert(chips.includes("Combien d'élèves ont obtenu leur vœu 1 ?"), `questions d'accueil de la base d'affectation (${chips.length})`);
  const t4 = await a.poser("Combien d'élèves ont obtenu leur vœu 1 ?");
  assert(/Calcul exact/.test(t4) && nombre(t4, v1), `« vœu 1 obtenu » : ${v1} élèves affichés`);
  const landes = AFF.eleves.filter(e => e.Departement_origine_eleve === 'Landes').length;
  const t5 = await a.poser("combien d'élèves des Landes");
  assert(/Calcul exact/.test(t5) && nombre(t5, landes), `« élèves des Landes » (table Eleves liée) : ${landes} affichés`);
  assert(!a.erreurs.length, `aucune erreur dans la page${a.erreurs.length ? ` (${a.erreurs.slice(0, 3).join(' ; ')})` : ''}`);
} catch (e) {
  console.error(`  ✗ erreur : ${e.stack || e.message}`); failed++;
} finally {
  await navigateur.close();
  srv.close();
}

console.log(`\n${'─'.repeat(50)}\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
