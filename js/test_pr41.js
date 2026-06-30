// test_pr41.js — Tests unitaires PR 4.1 (few-shot + anti-placeholder)
// Run : node test_pr41.js
'use strict';

let passed = 0, failed = 0;
const results = [];

function test(name, fn) {
  try { fn(); passed++; results.push({ ok: true, name }); }
  catch(e) { failed++; results.push({ ok: false, name, err: e.message }); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertEqual(a, b, msg) { if (a !== b) throw new Error(`${msg} — attendu: ${JSON.stringify(b)}, reçu: ${JSON.stringify(a)}`); }

// ── Implémentation de référence (miroir infographic.js) ──
const PLACEHOLDER_PATTERNS = [
  /^item\s*\d+$/i,
  /^analyse\s*\d*$/i,
  /^cat[eé]gorie\s*(?:[xX]|\d+|n°\s*\d*)$/i,
  /^section\s*(?:[xX]|\d+)?$/i,
  /^donn[eé]e\s*(?:[xX]|\d+)?$/i,
  /^label\s*\d*$/i,
  /^valeur\s*\d*$/i,
  /^p[eé]rim[eè]tre$/i,
  /^titre$/i,
  /^texte$/i,
  /^\.\.\.*$/,
  /^xxx+$/i,
  /^n\/a$/i,
  /^à\s+compl[eé]ter$/i,
  /^à\s+d[eé]finir$/i,
];
// ⚠️ isPlaceholder ne rejette que les chaînes présentes et génériques.
// Une valeur undefined/null signifie "champ absent" : on laisse cleanItems décider.
function isPlaceholder(str) {
  if (typeof str !== 'string') return false; // champ absent → pas un placeholder
  const s = str.trim();
  if (!s) return true;                        // chaîne vide → placeholder
  return PLACEHOLDER_PATTERNS.some(p => p.test(s));
}

function cleanItems(items) {
  if (!Array.isArray(items)) return items;
  return items.filter(item => {
    if (!item || typeof item !== 'object') return false;
    const isInsightPattern = item.title !== undefined && item.label === undefined;
    const isRankingPattern = item.label !== undefined;
    const identifier = item.label ?? item.title ?? item.name;
    if (identifier === undefined) return false;
    if (isPlaceholder(String(identifier))) return false;
    if (isInsightPattern) {
      // Insights : doit avoir un texte de ≥ 10 mots
      if (typeof item.text !== 'string') return false;
      if (item.text.trim().split(/\s+/).length < 10) return false;
    } else {
      // Ranking/bars/kpi : doit avoir une valeur non vide
      if (item.value === undefined || String(item.value).trim() === '') return false;
    }
    return true;
  });
}

// ─── Suite 1 : isPlaceholder ────────────────────────────────────────────────
test('"Item 1" est un placeholder',        () => assert(isPlaceholder('Item 1')));
test('"Item 12" est un placeholder',       () => assert(isPlaceholder('Item 12')));
test('"Analyse 1" est un placeholder',     () => assert(isPlaceholder('Analyse 1')));
test('"Analyse" seul est un placeholder',  () => assert(isPlaceholder('Analyse')));
test('"Section X" est un placeholder',     () => assert(isPlaceholder('Section X')));
test('"Section x" minuscule',              () => assert(isPlaceholder('Section x')));
test('"Section 2" est un placeholder',     () => assert(isPlaceholder('Section 2')));
test('"Section" seul est un placeholder',  () => assert(isPlaceholder('Section')));
test('"Catégorie X" est un placeholder',   () => assert(isPlaceholder('Catégorie X')));
test('"Donnée X" est un placeholder',      () => assert(isPlaceholder('Donnée X')));
test('"Périmètre" est un placeholder',     () => assert(isPlaceholder('Périmètre')));
test('"..." est un placeholder',           () => assert(isPlaceholder('...')));
test('"N/A" est un placeholder',           () => assert(isPlaceholder('N/A')));
test('undefined n\'est PAS un placeholder (champ absent)', () => assert(!isPlaceholder(undefined)));
test('"Bordeaux" n\'est PAS un placeholder',             () => assert(!isPlaceholder('Bordeaux')));
test('"CPGE - CPES" n\'est PAS un placeholder',          () => assert(!isPlaceholder('CPGE - CPES')));
test('"75,5 %" n\'est PAS un placeholder',               () => assert(!isPlaceholder('75,5 %')));
test('"L1 - CUPGE - DEUST - DU" n\'est PAS un placeholder', () => assert(!isPlaceholder('L1 - CUPGE - DEUST - DU')));

// ─── Suite 2 : cleanItems ──────────────────────────────────────────────────
test('cleanItems retire les items label=placeholder', () => {
  const items = [
    { label: 'Item 1',      value: '42' },
    { label: 'Bordeaux',    value: '1 789' },
    { label: 'Catégorie X', value: '10' },
  ];
  const r = cleanItems(items);
  assertEqual(r.length, 1, 'doit garder 1 item');
  assertEqual(r[0].label, 'Bordeaux', 'doit garder Bordeaux');
});

test('cleanItems retire les items sans champ text (insights)', () => {
  const items = [
    { title: 'Point fort',  value: '997' },    // pas de text → rejeté
    { title: 'Analyse',     text: 'court' },   // title placeholder → rejeté
    { title: 'Concentration', text: 'Les candidats du Pays Basque restent très majoritairement dans l\'académie de Bordeaux avec 75 % du total.' },
  ];
  const r = cleanItems(items);
  assertEqual(r.length, 1, 'doit garder 1 item');
  assert(r[0].title === 'Concentration', 'doit garder Concentration');
});

test('cleanItems retire les insights avec texte < 10 mots', () => {
  const items = [
    { title: 'Synthèse', text: 'Bordeaux domine.' },
    { title: 'Résultat', text: 'Les candidats boursiers choisissent davantage les BTS que leurs pairs non boursiers (27,7 % contre 20,3 %).' },
  ];
  const r = cleanItems(items);
  assertEqual(r.length, 1, 'doit garder 1 item');
});

test('cleanItems conserve les items valides ranking (sans title)', () => {
  const items = [
    { label: 'Bordeaux', value: '1 789', percent: '75,5 %' },
    { label: 'Toulouse', value: '253',   percent: '10,7 %' },
  ];
  const r = cleanItems(items);
  assertEqual(r.length, 2, 'doit garder 2 items ranking');
});

test('cleanItems retire un item sans label/title/name', () => {
  const items = [{ value: '42' }, { label: 'Bordeaux', value: '1 789' }];
  const r = cleanItems(items);
  assertEqual(r.length, 1, 'item sans identifiant → rejeté');
});

// ─── Suite 3 : prompt few-shot (sessions.js) ────────────────────────────────
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sessionsContent = fs.readFileSync(path.join(__dirname, 'sessions.js'), 'utf8');

test('Prompt contient les exemples few-shot',       () => assert(sessionsContent.includes('EXEMPLES (à suivre strictement)')));
test('Prompt contient exemple BON ranking',         () => assert(sessionsContent.includes('✅ BON — section ranking')));
test('Prompt contient exemple BON insights',        () => assert(sessionsContent.includes('✅ BON — section insights')));
test('Prompt contient exemple MAUVAIS',             () => assert(sessionsContent.includes('❌ MAUVAIS')));
test('Prompt contient INTERDIT ABSOLU (régression)',() => assert(sessionsContent.includes('INTERDIT ABSOLU')));
test('Labels réels dans les exemples (Bordeaux)',   () => assert(sessionsContent.includes('"Bordeaux"')));
test('Exemple MAUVAIS cite "Item 1"',               () => assert(sessionsContent.includes('"Item 1"')));

// ─── Suite 4 : isPlaceholder_simple (eyebrow / titre global) ──────────────
// Simule la fonction de infographic.js
function isPlaceholder_simple(str) {
  if (!str || typeof str !== 'string') return true;
  const s = str.trim();
  if (!s) return true;
  return /^(analyse\s*\d*|item\s*\d+|section\s*(?:[xX]|\d+)?|cat[eé]gorie\s*(?:[xX]|\d+)|donn[eé]e\s*[xX]?|p[eé]rim[eè]tre|titre|texte|label|valeur|n\/a|\.{2,}|xxx+)$/i.test(s);
}

test('"Analyse 1" détecté par isPlaceholder_simple', () => assert(isPlaceholder_simple('Analyse 1')));
test('"Analyse" seul détecté',                      () => assert(isPlaceholder_simple('Analyse')));
test('"Section X" détecté par isPlaceholder_simple', () => assert(isPlaceholder_simple('Section X')));
test('"Périmètre" détecté par isPlaceholder_simple', () => assert(isPlaceholder_simple('Périmètre')));
test('"Parcoursup 2026 · Pays Basque" NON détecté', () => assert(!isPlaceholder_simple('Parcoursup 2026 · Pays Basque')));
test('"Comparaison boursiers / non-boursiers" NON détecté', () => assert(!isPlaceholder_simple('Comparaison boursiers / non-boursiers')));
test('"Lycée Cantau · 349 candidats" NON détecté',  () => assert(!isPlaceholder_simple('Lycée Cantau · 349 candidats')));

// ─── Suite 5 : prompt generateInfographicWithAlbert ────────────────────────
const infContent = fs.readFileSync(path.join(__dirname, 'infographic.js'), 'utf8');

test('Prompt infographic contient les exemples few-shot',     () => assert(infContent.includes('EXEMPLES OBLIGATOIRES')));
test('Prompt infographic contient exemple BON eyebrow réel',  () => assert(infContent.includes('"eyebrow":"Parcoursup 2026')));
test('Prompt infographic contient exemple MAUVAIS eyebrow',   () => assert(infContent.includes('"eyebrow":"Analyse 1"')));
test('isPlaceholder_simple définie dans infographic.js',      () => assert(infContent.includes('function isPlaceholder_simple(')));
test('normalizeInfographicSpec filtre le champ eyebrow',      () => assert(infContent.includes('isPlaceholder_simple(spec.eyebrow)')));

// ─── Suite 6 : albert.js — lastExecution fallback ──────────────────────────
const albertContent = fs.readFileSync(path.join(__dirname, 'albert.js'), 'utf8');

test('albert.js passe lastExecution en fallback', () =>
  assert(albertContent.includes('getDataEngineState().lastExecution'), 'lastExecution fallback manquant'));
test('generateInfographicWithAlbert reçoit _infExec', () =>
  assert(albertContent.includes('generateInfographicWithAlbert(question, localAnalysis, _infExec)'), 'appel avec _infExec manquant'));

// ─── Rapport ────────────────────────────────────────────────────────────────
console.log('\n──────────────────────────────────────────────────');
results.filter(r => !r.ok).forEach(r => console.log(`  ❌ ${r.name}\n     → ${r.err}`));
console.log(`\nRésultat : ${passed}/${passed+failed} tests réussis`);
if (failed === 0) console.log('Tous les tests sont verts. ✅');
