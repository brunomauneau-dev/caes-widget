// essai_textes_albert.mjs — Les textes rédigés par Albert reprennent-ils fidèlement les chiffres ? (essai MESURÉ)
// Les réponses calculées (comptages, sommes, parts…) sont affichées par le widget sans Albert. Albert rédige seulement
// pour les questions ouvertes (« fais une synthèse… », « commente… »), à partir des données que le widget lui fournit.
// Pour chaque question ouverte posée au vrai widget (Chromium, open data réel, Albert par le proxy) :
//   1. nombres inventés : écrits par Albert mais absents des données fournies ; le bandeau « Chiffres non calculés »
//      doit alors s'afficher ;
//   2. nombres mal attribués (estimation) : présents dans les données, mais les mots autour du nombre dans le texte
//      d'Albert n'ont rien en commun avec les mots autour de ce nombre dans les données (à relire).
// Lancement : Actions → « Essai textes Albert » → Run workflow (~N appels à Albert, sur le quota). Lecture seule.
// Rapport : textes_albert.md, textes_albert.json.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(import.meta.url)('playwright');
const N = Number(process.env.NOMBRE || 200);
const PROXY = 'albert-proxy.bruno-mauneau.workers.dev';

// ─── Questions ouvertes (celles que le moteur calcule seul sont écartées : Albert n'y écrit rien) ───────────────
const SUJETS = ['BTS', 'BUT', 'CPGE', 'licences', 'PASS', 'IFSI', "écoles d'ingénieurs", 'licences de droit', 'BTS MCO', 'licences de psychologie', 'STAPS', 'DN MADE'];
const LIEUX = ['', ' en Gironde', ' à Bordeaux', " dans l'académie de Bordeaux", ' en Nouvelle-Aquitaine', ' dans les Landes', ' à Pau', ' en France'];
const GABARITS = ['Fais une synthèse des {X}{L}', 'Quels sont les points clés à retenir sur les {X}{L} ?', "Commente l'offre de {X}{L}", 'Analyse la sélectivité des {X}{L} et commente', 'Présente les {X}{L} en quelques phrases',
  "Rédige un paragraphe sur l'accès des boursiers aux {X}{L}", "Qu'est-ce qui caractérise les {X}{L} ?", 'Décris le profil des admis en {X}{L}', 'Résume la situation des {X}{L} pour une note de service',
  'Quelles tendances observe-t-on pour les {X}{L} ?', 'Explique à un parent comment fonctionnent les {X}{L}, chiffres à l’appui', 'Rédige une synthèse sur la place des filles dans les {X}{L}'];
let x = 7; const r = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648; const pick = a => a[Math.floor(r() * a.length)];
const pool = [...new Set(Array.from({ length: N * 6 }, () => pick(GABARITS).replace('{X}', pick(SUJETS)).replace('{L}', pick(LIEUX))))];
pool.unshift('Fais une synthèse complète de ce jeu de données');

// ─── Nombres et attribution ──────────────────────────────────────────────────
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const VIDES = new Set('dans pour avec sans sont leur leurs plus moins cette ces des les une est aux par sur qui que dont entre total soit environ pres environ ainsi donc elles ils nous vous mais etre avoir fait font compte comptent representent represente'.split(' '));
function nombres(texte) {
  const brut = String(texte ?? '').replace(/<[^>]*>/g, ' ');
  const out = [];
  const re = /(^|[^\p{L}\d.,])(\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)(?![\p{L}\d])/gu;
  let m;
  while ((m = re.exec(brut))) {
    const v = Number(m[2].replace(/[   ]/g, '').replace(',', '.'));
    if (!isFinite(v)) continue;
    const debut = m.index + m[1].length, fin = debut + m[2].length;
    const mots = t => norm(t).split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !VIDES.has(w) && !/^\d+$/.test(w));
    // mots autour du nombre, dans sa phrase (ou sa ligne de tableau) seulement
    const avant = brut.slice(Math.max(0, debut - 90), debut).split(/[.;:!?\n|]\s/).pop(), apres = brut.slice(fin, fin + 90).split(/[.;:!?\n|](?:\s|$)/)[0];
    out.push({ affiche: m[2], valeur: v, autour: new Set([...mots(avant).slice(-8), ...mots(apres).slice(0, 8)]) });
  }
  return out;
}
const anodin = v => (Number.isInteger(v) && v >= 0 && v <= 10) || (v >= 2015 && v <= 2030); // petits ordinaux, années
const cle = v => Math.round(v * 100) / 100;

// ─── Serveur local et navigateur ─────────────────────────────────────────────
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json' };
const srv = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
});
await new Promise(ok => srv.listen(0, ok));
const BASE = `http://localhost:${srv.address().port}`;
const nav = await chromium.launch();
const page = await nav.newPage({ viewport: { width: 900, height: 1000 } });
const erreurs = [];
page.on('pageerror', e => erreurs.push(e.message));
await page.addInitScript(() => { window.grist = { ready() {}, onRecord() {}, onRecords() {}, onOptions(cb) { setTimeout(() => cb({}), 0); }, setOptions() {} }; });
let dernier = null; // dernier échange avec Albert (requête + réponse)
page.on('response', async resp => {
  if (!resp.url().includes(PROXY) || !/chat\/completions/.test(resp.url())) return;
  try { const req = JSON.parse(resp.request().postData() || '{}'); const rep = await resp.json(); dernier = { messages: req.messages || [], reponse: rep.choices?.[0]?.message?.content || '' }; } catch (e) { dernier = { erreur: e.message }; }
});
await page.goto(`${BASE}/index.html`);
await page.waitForFunction(() => typeof defaultOpenDataState !== 'undefined' && defaultOpenDataState === 'ready', null, { timeout: 180000 });

const res = [];
for (const q of pool) {
  if (res.length >= N) break;
  const moteur = await page.evaluate(qq => { try { return isDataEngineQuestion(qq) && !!detectDataEnginePlan(qq) && shouldAnswerLocallyWithoutAlbert(runDataEnginePlan(detectDataEnginePlan(qq), [])); } catch (e) { return false; } }, q);
  if (moteur) continue; // calculé par le widget, sans texte d'Albert
  await page.evaluate(() => { try { createNewSession(); } catch (e) { /* */ } });
  dernier = null;
  await page.fill('#chat-input', q);
  await page.click('#btn-send');
  // réponse d'Albert reçue, puis affichée (le message « en cours » a disparu)
  for (let t = 0; t < 240 && !dernier; t++) await page.waitForTimeout(500);
  try { await page.waitForFunction(() => !document.querySelector('.loading-msg'), null, { timeout: 30000 }); } catch (e) { /* délai */ }
  await page.waitForTimeout(300);
  const bandeau = await page.evaluate(() => !![...document.querySelectorAll('.msg.assistant .msg-bubble')].pop()?.querySelector('.alerte-chiffres-albert'));
  if (!dernier || dernier.erreur || !dernier.reponse) { res.push({ q, erreur: dernier?.erreur || 'pas de réponse d’Albert' }); continue; }
  const sources = dernier.messages.filter(m => m.role !== 'assistant').map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n');
  const parValeur = new Map(); nombres(sources).forEach(n => { const k = cle(n.valeur); if (!parValeur.has(k)) parValeur.set(k, []); parValeur.get(k).push(n); });
  const nb = nombres(dernier.reponse).filter(n => !anodin(n.valeur));
  const inventes = nb.filter(n => !parValeur.has(cle(n.valeur)));
  const douteux = nb.filter(n => parValeur.has(cle(n.valeur)) && !parValeur.get(cle(n.valeur)).some(s => [...n.autour].some(w => s.autour.has(w))));
  res.push({ q, nombres: nb.length, inventes: inventes.map(n => n.affiche), douteux: douteux.map(n => n.affiche), bandeau, extrait: dernier.reponse.replace(/\s+/g, ' ').slice(0, 400),
    contexteDouteux: douteux.slice(0, 3).map(n => `${n.affiche} — Albert : « …${[...n.autour].join(' ')}… » ; données : « …${[...(parValeur.get(cle(n.valeur))[0].autour)].join(' ')}… »`) });
  console.log(`${res.length}/${N} · ${nb.length} nombres · inventés ${inventes.length} · douteux ${douteux.length} · bandeau ${bandeau ? 'oui' : 'non'} · ${q}`);
}
await nav.close(); srv.close();

// ─── Rapport ─────────────────────────────────────────────────────────────────
const ok = res.filter(x => !x.erreur);
const tot = k => ok.reduce((t, x) => t + (Array.isArray(x[k]) ? x[k].length : x[k] || 0), 0);
const avecInv = ok.filter(x => x.inventes.length), sansBandeau = avecInv.filter(x => !x.bandeau), bandeauAtort = ok.filter(x => !x.inventes.length && x.bandeau);
const lignes = [
  `# Essai textes Albert`, '',
  `Questions ouvertes posées : ${res.length} (réponses reçues : ${ok.length}, erreurs : ${res.length - ok.length}).`,
  `Nombres écrits par Albert (hors années et petits nombres) : ${tot('nombres')}.`, '',
  `## 1. Nombres inventés (absents des données fournies)`,
  `${tot('inventes')} nombres dans ${avecInv.length} réponses sur ${ok.length}.`,
  `Bandeau « Chiffres non calculés » absent alors qu'un nombre est inventé : **${sansBandeau.length}** réponse(s).`,
  `Bandeau affiché sans nombre inventé (selon cet essai) : ${bandeauAtort.length} réponse(s).`, '',
  `## 2. Nombres peut-être mal attribués (présents dans les données, contexte sans mot commun) — à relire`,
  `${tot('douteux')} nombres dans ${ok.filter(x => x.douteux.length).length} réponses.`, '',
  ...ok.filter(x => x.douteux.length).slice(0, 25).flatMap(x => [`- **${x.q}**`, ...x.contexteDouteux.map(c => `  - ${c}`)]), '',
  `## Réponses avec nombres inventés`, ...avecInv.slice(0, 25).map(x => `- **${x.q}** — inventés : ${x.inventes.join(' · ')} ; bandeau : ${x.bandeau ? 'oui' : '**NON**'}`), '',
  `## Erreurs de la page`, erreurs.length ? erreurs.slice(0, 10).map(e => `- ${e}`).join('\n') : 'aucune',
];
fs.writeFileSync('textes_albert.md', lignes.join('\n'));
fs.writeFileSync('textes_albert.json', JSON.stringify(res, null, 1));
console.log('\n' + lignes.slice(0, 14).join('\n'));
