// test_session_kb.js — Base de connaissances : session décrite et dates d'une session passée.
// Les 561 fiches viennent du guide Parcoursup de la session 2026 (mis à jour jusqu'au 12 juin 2026).
// En novembre 2026, la session en préparation est 2027 : « quand ouvre la saisie des vœux ? » faisait
// répondre par les dates 2026, présentées comme actuelles — et le contrôle des chiffres d'Albert les
// validait, puisqu'elles figurent dans les fiches. Désormais : Albert reçoit la session des fiches et la
// consigne de le dire ; un bandeau le rappelle sous une réponse qui cite des dates.
// Aussi : le script de reconstruction (scripts/construire_index_kb.py) redonne exactement la base.
// node js/test_session_kb.js

import fs from 'fs';
import vm from 'vm';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const racine = path.join(__dirname, '..');

let passed = 0, failed = 0;
function assert(condition, label) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}`); failed++; }
}
async function describe(label, fn) {
  console.log(`\n${label}`);
  try { await fn(); } catch (e) { console.error(`  ✗ erreur : ${e.stack || e.message}`); failed++; }
}

const KB = JSON.parse(fs.readFileSync(path.join(racine, 'parcoursup-kb-v2.json'), 'utf8'));
const INDEX = JSON.parse(fs.readFileSync(path.join(racine, 'parcoursup-kb-index-v2.json'), 'utf8'));

// Widget chargé avec une date fixée (le résultat ne dépend pas du jour où le test tourne)
async function makeCtx({ jour = '2026-11-09T10:00:00', kb = KB } = {}) {
  const fixe = new Date(jour).getTime();
  class DateFixe extends Date { constructor(...a) { super(...(a.length ? a : [fixe])); } static now() { return fixe; } }
  const sub = { textContent: '' };
  const json = body => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(body))) });
  const ctx = {
    console: { ...console, log() {}, warn() {}, info() {} }, setTimeout: () => null, clearTimeout() {}, URLSearchParams, Date: DateFixe,
    document: { getElementById: id => id === 'chat-sub' ? sub : null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: url => /kb-index/.test(url) ? json(INDEX) : /parcoursup-kb-v2/.test(url) ? json(kb) : Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) }),
    escapeHtml: s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.selectedDocIds = new Set();
  vm.createContext(ctx);
  for (const f of ['config.js', 'knowledge.js', 'documents.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
  await vm.runInContext('loadParcoursupKB()', ctx);
  ctx.__sub = sub;
  return ctx;
}
const run = (ctx, code) => vm.runInContext(code, ctx);
const Q_CAL = 'quand commence la saisie des vœux pour les formations en apprentissage ?';

await describe('Session décrite par la base', async () => {
  const ctx = await makeCtx();
  const s = run(ctx, 'sessionDeLaBase()');
  assert(s && s.session === 2026 && s.miseAJour === '12 juin 2026', `session 2026, mise à jour le 12 juin 2026 (obtenu : ${JSON.stringify(s)})`);
  assert(KB.meta.session_reference === 2026 && KB.meta.mise_a_jour === '12 juin 2026', 'écrite dans la base (meta.session_reference)');
  const sansMeta = await makeCtx({ kb: { ...KB, meta: { ...KB.meta, session_reference: undefined, mise_a_jour: undefined } } });
  assert(run(sansMeta, 'sessionDeLaBase().session') === 2026, 'sans la meta : déduite de la dernière mise à jour des fiches');
  const sep = await makeCtx({ kb: { ...KB, meta: {}, entries: [{ ...KB.entries[0], last_modified: '15 septembre 2026' }] } });
  assert(run(sep, 'sessionDeLaBase().session') === 2027, 'guide mis à jour en septembre 2026 : session 2027');
  run(ctx, 'updateKnowledgeStatusBadge()');
  assert(/KB Parcoursup 561 fiches \(session 2026\)/.test(ctx.__sub.textContent), `sous-titre : « KB Parcoursup 561 fiches (session 2026) » (obtenu : ${ctx.__sub.textContent})`);
});

await describe('Session en préparation selon la date du jour', async () => {
  const cas = [['2026-11-09T10:00:00', 2027, true], ['2026-09-01T10:00:00', 2027, true], ['2026-08-31T10:00:00', 2026, false], ['2026-05-04T10:00:00', 2026, false], ['2027-03-01T10:00:00', 2027, true]];
  for (const [jour, cur, perimee] of cas) {
    const ctx = await makeCtx({ jour });
    const e = run(ctx, 'etatSessionBase()');
    assert(e.sessionCourante === cur && e.perimee === perimee, `${jour.slice(0, 10)} : session en préparation ${cur}, fiches ${perimee ? 'd\'une session passée' : 'à jour'}`);
  }
});

await describe('Albert reçoit la session des fiches et la consigne', async () => {
  const ctx = await makeCtx();
  ctx.__q = Q_CAL;
  const c = run(ctx, 'buildParcoursupKnowledgeContext(__q, "")');
  assert(/SESSION DES FICHES : session Parcoursup 2026 \(guide mis à jour le 12 juin 2026\)/.test(c), 'session des fiches dans le contexte');
  assert(/la session en préparation est 2027/.test(c) && /ne présente jamais une date de 2026 comme celle de 2027/.test(c), 'consigne : dire « session 2026 », ne pas présenter ces dates comme celles de 2027');
  assert(/Les règles et la procédure de ces fiches restent valables/.test(c), 'consigne : les règles restent valables (seules les dates exactes changent)');
  const ajour = await makeCtx({ jour: '2026-05-04T10:00:00' });
  ajour.__q = Q_CAL;
  const c2 = run(ajour, 'buildParcoursupKnowledgeContext(__q, "")');
  assert(/SESSION DES FICHES : session Parcoursup 2026/.test(c2) && !/ATTENTION : la session en préparation/.test(c2), 'faux positif : en mai 2026, fiches à jour, pas d\'avertissement');
});

await describe('Bandeau sous la réponse d\'Albert', async () => {
  const ctx = await makeCtx();
  ctx.__q = Q_CAL;
  run(ctx, 'buildParcoursupKnowledgeContext(__q, "")');
  const b = run(ctx, 'bandeauCalendrierKB')('<p>La saisie des vœux est possible à partir du 19 janvier ; ajout jusqu’au 12 mars.</p>');
  assert(/Dates de la session 2026/.test(b) && /mis à jour le 12 juin 2026/.test(b) && /les règles et la procédure restent valables/.test(b) && /session 2027 peuvent différer de quelques jours/.test(b), 'réponse avec dates : bandeau « règles valables, dates exactes de la session 2026 »');
  assert(run(ctx, 'bandeauCalendrierKB')('<p>Confirmation jusqu’au 1er avril.</p>') !== '', '« 1er avril » reconnu');
  // v27.20 — l'enchaînement du calendrier change très peu d'une année à l'autre : seules les dates précises comptent
  assert(run(ctx, 'bandeauCalendrierKB')('<p>Le calendrier : saisie des vœux, puis confirmation, puis phase d’admission.</p>') === '', 'faux positif : le calendrier sans date précise, pas de bandeau');
  assert(run(ctx, 'bandeauCalendrierKB')('<p>Un candidat peut formuler jusqu’à 10 vœux.</p>') === '', 'faux positif : pas de date, pas de bandeau');
  assert(run(ctx, 'bandeauCalendrierKB')('<p>Il y a 5 351 BTS (12 académies).</p>') === '', 'faux positif : des nombres ne sont pas des dates');
  ctx.__q2 = 'combien de BTS dans le fichier ?';
  run(ctx, 'buildParcoursupKnowledgeContext("zzz qqq", "")');
  assert(run(ctx, 'bandeauCalendrierKB')('<p>Le 19 janvier…</p>') === '', 'faux positif : aucune fiche utilisée, pas de bandeau');
  const ajour = await makeCtx({ jour: '2026-05-04T10:00:00' });
  ajour.__q = Q_CAL;
  run(ajour, 'buildParcoursupKnowledgeContext(__q, "")');
  assert(run(ajour, 'bandeauCalendrierKB')('<p>À partir du 19 janvier.</p>') === '', 'faux positif : fiches de la session en cours, pas de bandeau');
  const albert = fs.readFileSync(path.join(__dirname, 'albert.js'), 'utf8');
  assert(/answerAnnote \+ \(\(typeof bandeauCalendrierKB === 'function'\) \? bandeauCalendrierKB\(answer\) : ''\)/.test(albert), 'albert.js ajoute le bandeau sous la réponse affichée');
});

await describe('Base et index cohérents', async () => {
  const ids = new Set(KB.entries.map(e => e.id));
  assert(KB.entries.length === 561 && KB.meta.entry_count === 561 && INDEX.meta.entry_count === 561, '561 fiches partout');
  assert(ids.size === KB.entries.length, 'identifiants uniques');
  const postings = Object.values(INDEX.index).flat();
  assert(postings.length > 0 && postings.every(([id]) => ids.has(id)), 'l\'index ne renvoie qu\'à des fiches existantes');
  assert(Object.entries(INDEX.related).every(([id, rel]) => ids.has(id) && rel.every(r => ids.has(r))), 'relations entre fiches existantes');
  assert(INDEX.meta.built_at === KB.meta.built_at, 'base et index construits ensemble');
});

await describe('Script de reconstruction : redonne exactement la base', async () => {
  const script = path.join(racine, 'scripts', 'construire_index_kb.py');
  assert(fs.existsSync(script) && !fs.existsSync(path.join(racine, 'scripts', 'build_parcoursup_kb_v3.py')), 'scripts/construire_index_kb.py (l\'ancien nom « v3 » trompeur a disparu)');
  const py = spawnSync('python3', ['--version']);
  if (py.status !== 0) { console.log('  · python3 absent : reconstruction non testée ici'); return; }
  // copie du dépôt minimale dans un dossier temporaire : le script écrit à la racine de sa copie
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'kb-'));
  fs.mkdirSync(path.join(tmp, 'scripts'));
  fs.copyFileSync(script, path.join(tmp, 'scripts', 'construire_index_kb.py'));
  fs.copyFileSync(path.join(racine, 'parcoursup-kb-v2.json'), path.join(tmp, 'parcoursup-kb-v2.json'));
  const r = spawnSync('python3', ['-I', path.join(tmp, 'scripts', 'construire_index_kb.py')], { encoding: 'utf8' });
  assert(r.status === 0 && /561 fiches, 5225 termes, session de référence 2026/.test(r.stdout), `le script tourne (${(r.stdout || r.stderr).trim().slice(0, 100)})`);
  const kb2 = JSON.parse(fs.readFileSync(path.join(tmp, 'parcoursup-kb-v2.json'), 'utf8'));
  const ix2 = JSON.parse(fs.readFileSync(path.join(tmp, 'parcoursup-kb-index-v2.json'), 'utf8'));
  assert(JSON.stringify(kb2.entries) === JSON.stringify(KB.entries), 'fiches identiques après reconstruction');
  assert(JSON.stringify(ix2.index) === JSON.stringify(INDEX.index) && JSON.stringify(ix2.related) === JSON.stringify(INDEX.related), 'index et relations identiques après reconstruction');
  assert(kb2.meta.session_reference === 2026 && kb2.meta.mise_a_jour === '12 juin 2026', 'session de référence recalculée');
  fs.rmSync(tmp, { recursive: true, force: true });
});

console.log(`\nRésultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
