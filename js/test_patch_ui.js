// test_patch_ui.js — Tests du patch UI du 02/07 :
// (1) Thèmes charte graphique de l'État dans config.js
// (2) Pivot complet sans limite de colonnes (maxCols=99, scroll)
// (3) Graphique raccord avec le pivot (branche pivot dans renderCurrentChartExecution)
// (4) Police Marianne et variables CSS dynamiques dans infographic.js
// node js/test_patch_ui.js

import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let passed = 0, failed = 0;
function assert(condition, label) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}`); failed++; }
}
function describe(label, fn) { console.log(`\n${label}`); fn(); }

const configSrc = fs.readFileSync(path.join(__dirname, 'config.js'), 'utf8');
const dataEngineSrc = fs.readFileSync(path.join(__dirname, 'dataEngine.js'), 'utf8');
const infographicSrc = fs.readFileSync(path.join(__dirname, 'infographic.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// ─── (1) Thèmes charte graphique de l'État ─────────────────────────────────
describe('Thèmes — charte graphique de l\'État (config.js)', () => {
  // Extraire INFOGRAPH_THEMES
  const match = configSrc.match(/const INFOGRAPH_THEMES = \[[\s\S]*?\];/);
  assert(!!match, 'INFOGRAPH_THEMES défini dans config.js');

  const themes = new Function(`${match[0]}\nreturn INFOGRAPH_THEMES;`)();
  assert(themes.length === 4, `4 thèmes définis (obtenu : ${themes.length})`);

  const ids = themes.map(t => t.id);
  assert(ids.includes('bleu-france'), 'thème "Bleu France" présent');
  assert(ids.includes('rouge-marianne'), 'thème "Rouge Marianne" présent');
  assert(ids.includes('clair'), 'thème "Clair" présent');
  assert(ids.includes('nuit'), 'thème "Nuit" présent');

  // Couleurs officielles de la charte État
  const bleu = themes.find(t => t.id === 'bleu-france');
  assert(bleu?.accent === '#003189', `Bleu France : accent = Bleu officiel #003189 (obtenu : ${bleu?.accent})`);
  assert(bleu?.secondary === '#E1000F', `Bleu France : secondary = Rouge Marianne #E1000F (obtenu : ${bleu?.secondary})`);

  const rouge = themes.find(t => t.id === 'rouge-marianne');
  assert(rouge?.accent === '#E1000F', `Rouge Marianne : accent = Rouge officiel #E1000F (obtenu : ${rouge?.accent})`);
  assert(rouge?.secondary === '#003189', `Rouge Marianne : secondary = Bleu France #003189 (obtenu : ${rouge?.secondary})`);

  // Thème par défaut mis à jour
  assert(/_icState\s*=\s*\{[^}]*theme:\s*'bleu-france'/.test(configSrc), 'thème par défaut = "bleu-france" (plus "bordeaux")');

  // Toutes les anciennes couleurs retirées
  assert(!/#c1440e/.test(configSrc), 'ancienne couleur #c1440e retirée de config.js');
  assert(!/#1a3a5c/.test(configSrc), 'ancienne couleur #1a3a5c retirée de config.js');
});

// ─── (2) Pivot — toutes les colonnes (maxCols=99) ──────────────────────────
describe('Pivot — toutes les colonnes affichées (maxCols=99, scroll horizontal)', () => {
  assert(/pivotRows\(rows, rowCol, colCol, 12, 99\)/.test(dataEngineSrc),
    'pivotRows appelé avec maxCols=99 (plus de limite à 5)');
  assert(!/_totalColValues/.test(dataEngineSrc),
    'plus de logique _totalColValues ni de bouton "Voir tout" (supprimé)');
  assert(!/Top \${cols\.length} valeurs affichées/.test(dataEngineSrc),
    'message "Top X valeurs affichées" retiré du rendu pivot');
  assert(/overflow-x:auto/.test(dataEngineSrc),
    'overflow-x:auto présent sur le container du tableau pivot (scroll horizontal)');
  assert(!/-webkit-overflow-scrolling:touch.*"Top \${cols/.test(dataEngineSrc),
    'pas de combinaison scroll + message "Top X" résiduel');
});

// ─── (3) Graphique raccord avec le pivot ───────────────────────────────────
describe('Graphique pivot — deux graphiques (totaux + stacké) depuis renderPivotCharts', () => {
  const fnMatch = dataEngineSrc.match(/function renderCurrentChartExecution\([\s\S]*?\n}\n\n/);
  assert(!!fnMatch, 'renderCurrentChartExecution trouvée dans dataEngine.js');
  if (fnMatch) {
    assert(/prev\.kind === 'pivot'/.test(fnMatch[0]),
      'branche pivot présente dans renderCurrentChartExecution');
    assert(/renderPivotCharts/.test(fnMatch[0]),
      'renderPivotCharts appelé pour le graphique pivot (deux graphiques, pas un fallback group_by)');
    const pivotIdx = fnMatch[0].indexOf("prev.kind === 'pivot'");
    const fallbackIdx = fnMatch[0].indexOf('const fallbackCol');
    assert(pivotIdx > 0 && pivotIdx < fallbackIdx,
      'branche pivot placée avant le fallback générique');
  }
  // Vérifier que renderPivotCharts génère bien les deux graphiques
  assert(/function renderPivotCharts/.test(dataEngineSrc), 'renderPivotCharts définie dans dataEngine.js');
  assert(/Total par.*targetCol/.test(dataEngineSrc) || /chart1.*chart2/.test(dataEngineSrc),
    'renderPivotCharts génère deux sections (totaux + stacké)');
  assert(/DE_PIE_COLORS\[i %/.test(dataEngineSrc),
    'barres stackées utilisent la palette DE_PIE_COLORS pour distinguer les colonnes');
});

// ─── (4) Police Marianne et variables CSS dynamiques ───────────────────────
describe('infographic.js — police Marianne et variables CSS thème dynamiques', () => {
  assert(/Marianne/.test(infographicSrc), 'police Marianne référencée dans infographic.js');
  assert(/spec\.bg\s*\|\|/.test(infographicSrc),
    '--bg dynamique via spec.bg (plus hardcodé #f7f4ef)');
  assert(/spec\.hero\s*\|\|/.test(infographicSrc),
    '--hero-bg dynamique via spec.hero (fond héro adapté au thème)');
  assert(/spec\.text\s*\|\|/.test(infographicSrc),
    '--text dynamique via spec.text (couleur de texte adaptée au thème)');
  assert(/\.hero\{background:var\(--hero-bg\)/.test(infographicSrc),
    '.hero utilise --hero-bg (plus --text) → fond héro correct pour thème clair');
  assert(!/#f7f4ef/.test(infographicSrc) || /spec\.bg\|\|"#f7f4ef"/.test(infographicSrc),
    '#f7f4ef uniquement en fallback, pas hardcodé comme valeur principale');

  // Fallback couleurs → couleurs charte État
  assert(/spec\.accent.*'#003189'/.test(infographicSrc) || /spec\.accent.*"#003189"/.test(infographicSrc),
    'fallback accent = Bleu France #003189 (plus #c1440e)');
  assert(!/#c1440e/.test(infographicSrc),
    'ancienne couleur #c1440e retirée d\'infographic.js');
});

// ─── (5) index.html — cache-busting à jour ───────────────────────────────────
describe('index.html — cache-busting à jour', () => {
  assert(/config\.js\?v=27\.5\.7/.test(indexSrc), 'config.js bumpé v27.5.7');
  assert(/infographic\.js\?v=27\.5\.9/.test(indexSrc), 'infographic.js bumpé v27.5.9');
  assert(/dataEngine\.js\?v=27.5.18/.test(indexSrc), 'dataEngine.js bumpé v27.5.18');
  assert(/sessions\.js\?v=27\.5\.15/.test(indexSrc), 'sessions.js bumpé v27.5.15');
});

// ─── (6) Logo Parcoursup dans le héro ─────────────────────────────────────
describe('Logo Parcoursup — intégré en base64 dans le héro de l\'infographie', () => {
  assert(/data:image\/png;base64/.test(infographicSrc),
    'logo Parcoursup encodé en base64 dans infographic.js');
  assert(/alt="Parcoursup"/.test(infographicSrc),
    'balise img avec alt="Parcoursup" présente');
  assert(/spec\.themeId === 'clair'/.test(infographicSrc),
    'logo conditionnel : blanc sur thème sombre, couleur sur thème clair');
  assert(/height:28px/.test(infographicSrc),
    'taille du logo définie (hauteur 28px)');
});

// ─── (7) Bug 3 — lisibilité métriques héro ─────────────────────────────────
describe('Bug 3 — métriques héro lisibles sur fond sombre (plus de bleu sur bleu)', () => {
  assert(/\.hero \.metric-value\{color:rgba\(255,255,255,\.95\)\}/.test(infographicSrc) ||
         /\.hero \.metric-value\{color:rgba/.test(infographicSrc),
    '.hero .metric-value : texte blanc sur fond héro sombre (corrige bleu sur bleu)');
});

// ─── (8) Bug 1 — scrollbar tableau pivot ───────────────────────────────────
describe('Bug 1 — scrollbar ne mange plus la ligne Total (padding-bottom)', () => {
  assert(/overflow-x:auto.*padding-bottom:14px/.test(dataEngineSrc) ||
         /padding-bottom:14px.*overflow-x:auto/.test(dataEngineSrc),
    'padding-bottom ajouté sur le container overflow-x:auto du pivot');
});

console.log(`\n──────────────────────────────────────────────────`);
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed > 0) process.exit(1);
