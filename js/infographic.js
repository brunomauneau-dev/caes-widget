/* infographic.js — Rendu infographies adaptatives HTML
   Dépend de : config.js, albert.js */

/* ═══════════════════════ MODE INFOGRAPHIE ADAPTIVE HTML ═══════════════════════
   Version adaptive : Albert ne génère plus directement une page HTML figée.
   Il propose une STRUCTURE JSON éditoriale (sections, composants, messages),
   puis le widget rend cette structure avec des composants HTML/CSS réutilisables.
   Objectif : obtenir un comportement proche des Artifacts Claude, mais avec des
   calculs locaux Grist/Excel et une identité graphique cohérente. */
let generatedInfographics = [];

// ── Config du segment résiduel "Autres" pour les sections stacked ──
// Voir renderStacked() : quand la somme des segments fournis par Albert
// n'atteint pas le total réel de la population, on complète nous-mêmes
// avec un segment résiduel plutôt que de compter sur Albert pour y penser
// (une génération sur deux, il l'ajoutait spontanément ; l'autre non — d'où
// des pourcentages incohérents entre sections stacked et bars sur les mêmes
// données). Le libellé est ici un paramètre unique et modifiable, pas codé
// en dur dans la fonction de rendu.
const INFOGRAPHIC_STACKED_OTHER_LABEL = 'Autres';
// En dessous de ce seuil (en % du total réel), l'écart est considéré comme
// du bruit d'arrondi et on n'ajoute pas de segment résiduel visuel.
const INFOGRAPHIC_STACKED_OTHER_MIN_PCT = 1;

function isInfographicRequest(question) {
  const q = normalizeText(question);
  return /infographie|dataviz|visualisation|page html|rapport visuel|dashboard|tableau de bord|mise en forme visuelle|comme claude|artifact|visuel/.test(q);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function escapeAttr(s) { return escapeHtml(s); }
function clampNum(n, min, max) { n = Number(n); if (!isFinite(n)) return min; return Math.max(min, Math.min(max, n)); }
function slugCss(s) { return normalizeText(s || 'x').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x'; }

function stripCodeFences(text) {
  let t = String(text || '').trim();
  const fenced = t.match(/```(?:json|html)?\s*([\s\S]*?)```/i);
  if (fenced) t = fenced[1].trim();
  return t;
}

function parseJsonLoose(text) {
  let t = stripCodeFences(text);
  try { return JSON.parse(t); } catch(e) {}
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first >= 0 && last > first) {
    t = t.slice(first, last + 1);
    try { return JSON.parse(t); } catch(e) {}
  }
  throw new Error('Albert n’a pas renvoyé une spécification JSON exploitable.');
}

// Détecte les labels génériques dans les champs simples (eyebrow, titre, etc.)
function isPlaceholder_simple(str) {
  if (!str || typeof str !== 'string') return true;
  const s = str.trim();
  if (!s) return true;
  return /^(analyse\s*\d*|item\s*\d+|section\s*(?:[xX]|\d+)?|cat[eé]gorie\s*(?:[xX]|\d+)|donn[eé]e\s*[xX]?|p[eé]rim[eè]tre|titre|texte|label|valeur|n\/a|\.{2,}|xxx+)$/i.test(s);
}

// Détecte un pattern placeholder en sous-chaîne (pour footer, notes, etc.)
function containsPlaceholderSubstring(str) {
  if (!str || typeof str !== 'string') return false;
  return /\b(analyse\s*\d+|table\s*[«"]\s*analyse\s*\d+|item\s*\d+|catégorie\s*\d+|label\s*\d+|valeur\s*\d+|texte\s*\d+)\b/i.test(str);
}

function normalizeInfographicSpec(spec, question) {
  spec = spec && typeof spec === 'object' ? spec : {};
  spec.title = spec.title || 'Infographie de données';
  spec.subtitle = spec.subtitle || question || 'Analyse synthétique';
  spec.eyebrow = (spec.eyebrow && !isPlaceholder_simple(spec.eyebrow))
    ? spec.eyebrow
    : 'Analyse Parcoursup · Albert';
  spec.accent = /^#[0-9a-f]{6}$/i.test(spec.accent || '') ? spec.accent : '#003189';
  spec.secondary = /^#[0-9a-f]{6}$/i.test(spec.secondary || '') ? spec.secondary : '#E1000F';
  spec.metrics = Array.isArray(spec.metrics) ? spec.metrics.slice(0, 6) : [];
  spec.sections = Array.isArray(spec.sections) ? spec.sections.slice(0, 10) : [];
  spec.footer = (spec.footer && !containsPlaceholderSubstring(spec.footer))
    ? spec.footer
    : 'Infographie générée à partir des données analysées localement par le widget.';
  return improveInfographicSpec(spec, question);
}

function normalizeLabelForDedupe(s) {
  return normalizeText(String(s || '')).replace(/\d+[,.]?\d*\s*%?/g, '').replace(/\s+/g, ' ').trim();
}
function sectionLooksLikeDuplicateKpi(section, heroMetrics) {
  if ((section.type || '') !== 'kpi_grid') return false;
  const items = section.metrics || section.items || [];
  if (!Array.isArray(items) || !items.length) return false;
  const heroKeys = new Set(heroMetrics.map(m => normalizeLabelForDedupe((m.label || '') + ' ' + (m.value || ''))));
  const matches = items.filter(m => heroKeys.has(normalizeLabelForDedupe((m.label || '') + ' ' + (m.value || '')))).length;
  return matches >= Math.max(2, Math.ceil(items.length * 0.6));
}
function inferSectionScope(section) {
  const t = normalizeText([section.title, section.subtitle, section.scope, section.perimeter, section.note].filter(Boolean).join(' '));
  if (/pays basque|zone basque|basque/.test(t)) return 'Périmètre : zone Pays Basque';
  if (/global|ensemble|total|toutes zones|panorama/.test(t)) return 'Périmètre : ensemble des candidats';
  if (/hors bordeaux|autre academie|mobiles|mobilite/.test(t)) return 'Périmètre : candidats hors académie de Bordeaux';
  if (/proposition accept|repondu favorablement|admission/.test(t)) return 'Périmètre : candidats avec proposition acceptée';
  return section.scope || section.perimeter || '';
}
function _buildRealInsightsFromSpec({ sections = [], metrics = [], narrative = [] }) {
  const insights = [];

  // Insight 1 : depuis les métriques hero (ratio/volume clé)
  if (metrics.length >= 2) {
    const m0 = metrics[0], m1 = metrics[1];
    const hasPercent = metrics.find(m => /%/.test(String(m.value || '')));
    if (hasPercent) {
      insights.push({
        title: hasPercent.label,
        text: `${hasPercent.value} — ${hasPercent.detail || `${hasPercent.label} selon les données analysées`}`
      });
    } else {
      insights.push({
        title: m0.label,
        text: `${m0.value}${m0.detail ? ' — ' + m0.detail : ''}. ${m1.label} : ${m1.value}${m1.detail ? ' (' + m1.detail + ')' : ''}.`
      });
    }
  }

  // Insight 2 : depuis les sections ranking/bars — dominance du top et écart
  const rankSec = sections.find(s => (s.type === 'ranking' || s.type === 'bars') && (s.items || []).length >= 2);
  if (rankSec) {
    const items = rankSec.items || [];
    const top = items[0], second = items[1];
    const topPct  = top.percent  || (top.pct  ? `${top.pct}` : '');
    const secPct  = second.percent || (second.pct ? `${second.pct}` : '');
    const topStr  = topPct  ? `${top.label} (${topPct})` : `${top.label} avec ${top.value} candidats`;
    const secStr  = secPct  ? `${second.label} (${secPct})` : `${second.label} (${second.value})`;
    insights.push({
      title: `Concentration sur ${top.label}`,
      text: `${topStr} arrive en tête, devant ${secStr}. ${items.length > 2 ? `Les ${items.length} premières valeurs couvrent l'essentiel de la distribution.` : ''}`
    });
  }

  // Insight 3 : depuis la narrative d'Albert (1re phrase analytique pertinente)
  const narr = (narrative || []).find(p => p && p.length > 30 && !p.toLowerCase().includes('graphique') && !p.toLowerCase().includes('section'));
  if (narr && insights.length < 3) {
    const firstSentence = narr.split(/[.!?]/)[0].trim();
    if (firstSentence.length > 25) {
      insights.push({ title: 'Synthèse', text: firstSentence + '.' });
    }
  }

  return insights.filter(it => it.text && it.text.length > 20).slice(0, 3);
}

function improveInfographicSpec(spec, question) {
  const heroMetrics = Array.isArray(spec.metrics) ? spec.metrics : [];
  let sections = Array.isArray(spec.sections) ? spec.sections : [];

  // 1) Supprime les grilles KPI qui répètent exactement le hero.
  sections = sections.filter(sec => !sectionLooksLikeDuplicateKpi(sec, heroMetrics));

  // 2) Ajoute/normalise un badge de périmètre pour éviter les mélanges global/Pays Basque/acceptés.
  sections.forEach(sec => {
    if (!sec.scope && !sec.perimeter) {
      const inferred = inferSectionScope(sec);
      if (inferred) sec.scope = inferred;
    }
  });

  // 3) Évite une fin sur un tableau : les tableaux passent avant les insights/conclusion.
  const insightSections = sections.filter(sec => (sec.type || '') === 'insights');
  const otherSections = sections.filter(sec => (sec.type || '') !== 'insights');
  sections = otherSections.concat(insightSections);

  // Détection textes génériques connus (déclaré ici avant tout usage)
  const GENERIC_INSIGHT_TEXTS = ['les sections distinguent les chiffres globaux', 'les graphiques servent', 'perimetre explicite', 'lecture analytique'];
  const _isGenericInsight = it => {
    const t = (it.text || it.detail || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
    return GENERIC_INSIGHT_TEXTS.some(g => t.includes(g));
  };

  // 4) Génère une section "À retenir" avec de vrais insights chiffrés tirés de la spec
  const _hasRealConclusion = sections.some(sec =>
    /conclusion|synthese|synthèse|retenir|points saillants/i.test(sec.title || '') &&
    sec.type === 'insights' &&
    (sec.items || []).some(it => !_isGenericInsight(it))
  );
  if (!_hasRealConclusion) {
    const realInsights = _buildRealInsightsFromSpec({ sections, metrics: spec.metrics, narrative: spec.narrative });
    if (realInsights.length > 0) {
      sections.push({ type: 'insights', title: 'À retenir', scope: 'Lecture transversale', items: realInsights });
    }
  }

  spec.sections = sections.slice(0, 8);

  // Nettoyage des items avec labels génériques ("Item 1", "Catégorie X", etc.)
  const _isPlaceholder = s => /^(item\s*\d+|catégorie\s*\d+|cat[eé]gorie\s*\d*|label\s*\d*|valeur\s*\d*|texte\s*\d*)$/i.test(String(s || '').trim());
  spec.sections = spec.sections.map(sec => {
    if (Array.isArray(sec.items) && sec.items.length > 0) {
      let cleaned = sec.items.filter(it => !_isPlaceholder(it.label || it.name || it.title || ''));
      if (sec.type === 'insights') cleaned = cleaned.filter(it => !_isGenericInsight(it));
      if (cleaned.length !== sec.items.length) sec = { ...sec, items: cleaned };
    }
    return sec;
  }).filter(sec => {
    const type = sec.type || 'text';
    const items = sec.items || sec.data || sec.insights || sec.metrics || [];
    if (type === 'ranking' || type === 'bars') {
      if (!Array.isArray(items) || items.length === 0) return false;
      // Rejeter si aucun item n'a de valeur numérique exploitable (évite les barres plates à 2%)
      const hasNumericValue = items.some(it => {
        const v = it.value ?? it.count ?? it.n ?? it.effectif ?? it.nb ?? it.total ?? it.display ?? null;
        return v !== null && v !== '' && !isNaN(parseFloat(String(v).replace(/[\s ]/g, '').replace(',', '.')));
      });
      return hasNumericValue;
    }
    if (type === 'comparison')
      // Un item comparison doit avoir des valeurs gauche ET droite, pas juste un label
      return Array.isArray(items) && items.some(it => (it.left || it.right) && (it.left !== '/' && it.right !== '/'));
    if (type === 'kpi_grid')
      return Array.isArray(items) && items.length > 0;
    if (type === 'stacked')
      return Array.isArray(sec.groups || items) && (sec.groups || items).some(g => Array.isArray(g.segments) && g.segments.length > 0);
    if (type === 'insights')
      return Array.isArray(items) && items.some(it => String(it.text || it.detail || '').trim().length > 10);
    if (type === 'text')
      return String(sec.text || sec.description || '').trim().length > 10;
    if (type === 'table')
      return Array.isArray(sec.headers) && sec.headers.length > 0 && Array.isArray(sec.rows) && sec.rows.length > 0;
    // cascade et autres : garder uniquement si title + données
    return String(sec.title || '').trim().length > 2;
  });
  return spec;
}

function renderMetricCards(metrics) {
  if (!metrics || !metrics.length) return '';
  return `<div class="metric-grid">${metrics.map(m => `
    <div class="metric-card">
      <div class="metric-label">${escapeHtml(m.label || '')}</div>
      <div class="metric-value">${escapeHtml(m.value || '')}</div>
      ${m.detail ? `<div class="metric-detail">${escapeHtml(m.detail)}</div>` : ''}
    </div>`).join('')}</div>`;
}

function parseInfographicNumber(v) {
  // Accepte : 1987, "1 987", "1 987 - 8,6 %", "8,6%".
  // Pour les barres de classement, on veut l'effectif absolu, pas le pourcentage.
  if (v === null || v === undefined) return NaN;
  if (typeof v === 'number') return isFinite(v) ? v : NaN;
  const s = String(v).replace(/ /g, ' ').trim();
  const matches = [...s.matchAll(/-?\d[\d\s]*(?:[,.]\d+)?/g)].map(m => m[0]);
  if (!matches.length) return NaN;
  // On privilégie le premier nombre qui ressemble à un effectif entier avec espace de milliers
  // ou supérieur à 100. Sinon on prend le premier nombre disponible.
  for (const m of matches) {
    const cleaned = m.replace(/\s/g, '').replace(',', '.');
    const n = Number(cleaned);
    if (isFinite(n) && (n >= 100 || /\d\s+\d/.test(m))) return n;
  }
  const n = Number(matches[0].replace(/\s/g, '').replace(',', '.'));
  return isFinite(n) ? n : NaN;
}

function getBarRawValue(it) {
  // Priorité aux effectifs explicites. Si Albert met le % dans value mais l'effectif
  // dans display, on récupère l'effectif depuis display pour éviter des barres absurdes.
  const candidates = [it.count, it.n, it.effectif, it.nb, it.total, it.value, it.display];
  const nums = candidates.map(parseInfographicNumber).filter(n => isFinite(n) && n >= 0);
  if (!nums.length) return 0;
  const large = nums.filter(n => n >= 100);
  return large.length ? Math.max(...large) : nums[0];
}

function renderBars(items, opts = {}) {
  items = Array.isArray(items) ? items.slice(0, opts.limit || 12) : [];
  if (!items.length) return '';
  const values = items.map(getBarRawValue);
  const max = Math.max(...values, 1);
  return `<div class="bars">${items.map((it, idx) => {
    const raw = values[idx] || 0;
    const width = clampNum(raw / max * 100, 2, 100);
    const pct = it.percent || it.pct || it.share || '';
    const shown = it.display || it.count || it.n || it.effectif || it.nb || it.value || '';
    return `<div class="bar-row">
      <div class="bar-top"><span>${escapeHtml(it.label || it.name || it.category || `Item ${idx+1}`)}</span><strong>${escapeHtml(shown)}${pct ? ` · ${escapeHtml(pct)}` : ''}</strong></div>
      <div class="bar-track"><div class="bar-fill" style="width:${width.toFixed(1)}%"></div></div>
    </div>`;
  }).join('')}</div>`;
}

function renderComparison(items) {
  items = Array.isArray(items) ? items.slice(0, 12) : [];
  if (!items.length) return '';
  return `<div class="compare-list">${items.map(it => {
    const delta = String(it.delta || '').trim();
    const cls = /^\+/.test(delta) ? 'plus' : /^-|−/.test(delta) ? 'minus' : 'neutral';
    return `<div class="compare-row">
      <div class="compare-label">${escapeHtml(it.label || '')}</div>
      <div class="compare-values">
        <span class="val primary">${escapeHtml(it.left || it.a || '')}</span>
        <span class="sep">/</span>
        <span class="val secondary">${escapeHtml(it.right || it.b || '')}</span>
        ${delta ? `<span class="delta ${cls}">${escapeHtml(delta)}</span>` : ''}
      </div>
    </div>`;
  }).join('')}</div>`;
}

function renderStacked(groups) {
  groups = Array.isArray(groups) ? groups.slice(0, 5) : [];
  if (!groups.length) return '';
  const palette = ['var(--accent)', 'var(--secondary)', '#4f7c3a', '#d4a017', '#8b4513', '#6b6560'];
  // Couleur fixe (gris neutre) pour le segment résiduel "Autres" : il ne doit jamais
  // reprendre une couleur de la palette cyclique, sinon il se confond visuellement
  // avec le segment qui occupe cette position dans le cycle (ex. PCSI, 1er segment,
  // même teinte que "Autres" ajouté en 7e position sur une palette de 6 couleurs).
  const OTHER_COLOR = '#b7bcc4';
  const segColor = (seg, i) => seg && seg._isOtherResidual ? OTHER_COLOR : palette[i % palette.length];
  return `<div class="stacked-list">${groups.map(g => {
    let segments = Array.isArray(g.segments) ? g.segments.slice(0, 6) : [];
    let values = segments.map(x => Number(x.value) || parseInfographicNumber(x.display || x.percent) || 0);
    let sum = values.reduce((s, x) => s + x, 0);
    // Si Albert fournit déjà des pourcentages (somme proche de 100), on les utilise tels quels.
    // Sinon, on normalise sur la somme des effectifs.
    const valuesArePercents = sum > 85 && sum <= 105 && values.every(v => v >= 0 && v <= 100);

    // Segment résiduel "Autres" : si Albert a transmis le total réel de la population
    // du groupe (g.total, ex. 175 candidats) et que la somme des segments affichés ne
    // l'atteint pas, on complète nous-mêmes en code — jamais laissé à l'initiative du
    // modèle. C'est ce qui garantit qu'un même item (ex. PCSI) affiche le même % dans
    // une section "bars" (sur le total réel) et une section "stacked" juste à côté
    // (auparavant calculé sur la seule somme des segments affichés, d'où l'écart
    // 26,3 % / 33,1 % observé sur les mêmes données).
    if (!valuesArePercents) {
      const realTotal = parseInfographicNumber(g.total ?? g.n ?? g.count);
      if (realTotal && isFinite(realTotal) && realTotal > 0) {
        if (realTotal >= sum) {
          const residual = realTotal - sum;
          const residualPct = residual / realTotal * 100;
          if (residualPct >= INFOGRAPHIC_STACKED_OTHER_MIN_PCT) {
            segments = segments.concat([{ label: INFOGRAPHIC_STACKED_OTHER_LABEL, value: residual, _isOtherResidual: true }]);
            values = values.concat([residual]);
            sum = realTotal;
          }
        } else {
          // Incohérence : le total annoncé par Albert est plus petit que la somme des
          // segments qu'il a lui-même fournis. On ne casse pas l'affichage — on retombe
          // sur la normalisation existante (sur la somme des segments) — mais on trace
          // l'anomalie pour qu'elle ne reste pas invisible comme le bug initial.
          console.warn('[infographic] stacked: total groupe incohérent (< somme des segments)', { label: g.label, total: realTotal, sum });
        }
      }
    }

    const total = valuesArePercents ? 100 : (sum || 1);
    // Le pourcentage normalisé (utilisé pour la largeur ET la légende) — calculé une seule
    // fois ici, jamais repris du texte libre "display"/"percent" fourni par Albert. Avant ce
    // correctif, la légende affichait `seg.display` tel quel : rien ne garantissait qu'il
    // corresponde à `seg.value`, et Albert a déjà produit les deux pour un même segment
    // (ex. largeur 33,8 % / légende "26,7 %") — un désaccord interne à sa propre réponse,
    // impossible à détecter côté widget tant que les deux champs restaient indépendants.
    const pcts = values.map(v => clampNum(v / total * 100, 0, 100));
    return `<div class="stacked-block">
      <div class="stacked-title">${escapeHtml(g.label || '')}</div>
      <div class="stacked-bar">${segments.map((seg, i) => {
        const w = pcts[i];
        return `<div class="stacked-seg" style="width:${w.toFixed(1)}%;background:${segColor(seg, i)}">${w >= 10 ? escapeHtml(seg.shortLabel || seg.label || '') : ''}</div>`;
      }).join('')}</div>
      <div class="stacked-legend">${segments.map((seg, i) => `<span><i style="background:${segColor(seg, i)}"></i>${escapeHtml(seg.label || '')} ${pcts[i].toFixed(1).replace('.', ',')} %</span>`).join('')}</div>
    </div>`;
  }).join('')}</div>`;
}

function renderInsights(items) {
  items = Array.isArray(items) ? items.slice(0, 8) : [];
  if (!items.length) return '';
  return `<div class="insight-grid">${items.map((it, i) => `
    <div class="insight-card">
      <div class="insight-num">${String(i+1).padStart(2,'0')}</div>
      <h4>${escapeHtml(it.title || it.label || 'À retenir')}</h4>
      <p>${escapeHtml(it.text || it.detail || it.description || '')}</p>
    </div>`).join('')}</div>`;
}


function renderCascadeNodes(nodes, total, depth = 1) {
  nodes = Array.isArray(nodes) ? nodes : [];
  return `<div class="cascade-tree">${nodes.map(n => {
    const count = parseInfographicNumber(n.count ?? n.value ?? n.n) || 0;
    const pct = n.percent || n.pct || (total ? pctFr(count, total) : '');
    const children = Array.isArray(n.children) && n.children.length ? `<div class="cascade-children">${renderCascadeNodes(n.children, count || total, depth + 1)}</div>` : '';
    return `<div class="cascade-node level-${depth}">
      <div class="cascade-title"><span>${escapeHtml(n.label || n.name || '')}</span><strong>${escapeHtml(String(count || n.count || ''))}${pct ? ` · ${escapeHtml(pct)}` : ''}</strong></div>
      ${children}
    </div>`;
  }).join('')}</div>`;
}

function renderCascade(section) {
  const nodes = section.nodes || section.items || section.data || [];
  const total = parseInfographicNumber(section.total || section.count || section.n) || 0;
  const levels = Array.isArray(section.levels) && section.levels.length ? `<p class="cascade-muted">Niveaux : ${section.levels.map(escapeHtml).join(' → ')}${total ? ` · Total : ${total.toLocaleString('fr-FR')}` : ''}</p>` : '';
  return `${levels}${renderCascadeNodes(nodes, total)}`;
}

function renderTable(headers, rows) {
  headers = Array.isArray(headers) ? headers.slice(0, 6) : [];
  rows = Array.isArray(rows) ? rows.slice(0, 12) : [];
  if (!headers.length || !rows.length) return '';
  return `<div class="table-wrap"><table><thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${headers.map((h, i) => `<td>${escapeHtml(Array.isArray(r) ? r[i] : r[h])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function renderSection(section, idx) {
  const type = section.type || 'text';
  const title = section.title || `Section ${idx+1}`;
  const kicker = section.kicker || String(idx+1).padStart(2, '0');
  const scope = section.scope || section.perimeter || inferSectionScope(section);
  let body = '';
  if (type === 'kpi_grid') body = renderMetricCards(section.metrics || section.items);
  else if (type === 'ranking' || type === 'bars') body = renderBars(section.items || section.data, { limit: section.limit || 12 });
  else if (type === 'comparison') body = renderComparison(section.items || section.data);
  else if (type === 'stacked') body = renderStacked(section.groups || section.items);
  else if (type === 'insights') body = renderInsights(section.items || section.insights);
  else if (type === 'cascade') body = renderCascade(section);
  else if (type === 'table') body = renderTable(section.headers, section.rows);
  else body = `<p class="section-text">${escapeHtml(section.text || section.description || '')}</p>`;
  // Filtre : si le body ne contient pas de texte réel (seulement du HTML structurel vide), on saute la section
  const bodyText = body.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').trim();
  if (!bodyText) return '';
  const note = section.note ? `<p class="section-note">${escapeHtml(section.note)}</p>` : '';
  return `<section class="info-section type-${escapeHtml(type)}">
    <div class="section-headline"><div><div class="section-kicker">${escapeHtml(kicker)}</div><h2>${escapeHtml(title)}</h2></div>${scope ? `<div class="scope-badge">${escapeHtml(scope)}</div>` : ''}</div>
    ${section.subtitle ? `<p class="section-subtitle">${escapeHtml(section.subtitle)}</p>` : ''}
    <div class="section-body">${body}</div>
    ${note}
  </section>`;
}

function renderAdaptiveInfographicHtml(spec, question) {
  spec = normalizeInfographicSpec(spec, question);
  // Filet de sécurité (pas un correctif automatique — cf. discussion) : on trace,
  // sans rien changer à l'affichage, les cas où une section "stacked" apparaît sans
  // section ranking/bars correspondante juste avant, ou avec un périmètre ("scope")
  // différent de celle qui la précède. Un vrai doublon barres+stacked structurellement
  // fusionné ou renommé par Albert reste un choix éditorial qu'on ne corrige pas ici
  // (le risque de "deviner" un titre serait pire que le problème), mais au moins la
  // trace permet de vérifier la fréquence du phénomène plutôt que de le découvrir par
  // hasard en comparant deux captures d'écran.
  spec.sections.forEach((s, i) => {
    if ((s.type || '') !== 'stacked') return;
    const prev = spec.sections[i - 1];
    const prevIsRankingOrBars = prev && (prev.type === 'ranking' || prev.type === 'bars');
    if (!prevIsRankingOrBars) {
      console.warn('[infographic] section stacked sans ranking/bars juste avant', { index: i, title: s.title });
      return;
    }
    const scopeA = (prev.scope || prev.perimeter || '').trim();
    const scopeB = (s.scope || s.perimeter || '').trim();
    if (scopeA && scopeB && scopeA !== scopeB) {
      console.warn('[infographic] scope divergent entre section bars et section stacked adjacentes', { titleBars: prev.title, scopeBars: scopeA, titleStacked: s.title, scopeStacked: scopeB });
    }
  });
  const sections = spec.sections.map((s, i) => renderSection(s, i)).join('\n');
  const metrics = renderMetricCards(spec.metrics);
  const narrative = Array.isArray(spec.narrative) ? spec.narrative : (spec.narrative ? [spec.narrative] : []);
  const narrativeHtml = narrative.length ? `<div class="narrative">${narrative.map(p => `<p>${escapeHtml(p)}</p>`).join('')}</div>` : '';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(spec.title)}</title>
<style>
  @import url("https://unpkg.com/@gouvfr/dsfr@1.12.1/dist/fonts/Marianne-Regular.woff2");
  :root{--accent:${spec.accent};--secondary:${spec.secondary};--bg:${spec.bg||"#f7f4ef"};--card:${spec.card||"#fff"};--text:${spec.text||"#1c1a17"};--muted:${spec.muted||"#6b6560"};--line:${spec.line||"#e0dbd4"};--soft:${spec.soft||"#f1e9e3"};--hero-bg:${spec.hero||spec.text||"#1c1a17"};}
  *{box-sizing:border-box;margin:0;padding:0} body{font-family:"Marianne","Segoe UI",system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);font-size:14px;line-height:1.5} 
  .hero{background:var(--hero-bg);color:white;padding:46px 42px 38px;position:relative;overflow:hidden}.hero:before{content:"";position:absolute;right:-80px;top:-90px;width:330px;height:330px;border-radius:50%;background:var(--accent);opacity:.23}.hero>*{position:relative}.eyebrow{font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:700;color:var(--accent);margin-bottom:12px}.hero h1{font-family:Georgia,serif;font-size:clamp(30px,5vw,54px);font-weight:400;line-height:1.05;max-width:900px;margin-bottom:14px}.hero-sub{color:rgba(255,255,255,.65);max-width:760px}.page{max-width:1180px;margin:0 auto;padding:32px 26px}.metric-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px}.hero .metric-grid{max-width:920px;margin-top:30px}.metric-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px;box-shadow:0 8px 24px rgba(0,0,0,.04)}.hero .metric-card{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.08);box-shadow:none}.metric-label{font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted);font-weight:700;margin-bottom:8px}.hero .metric-label{color:rgba(255,255,255,.55)}.metric-value{font-size:30px;line-height:1;font-weight:800;color:var(--accent);margin-bottom:6px}.hero .metric-value{color:rgba(255,255,255,.95)}.metric-detail{font-size:12px;color:var(--muted)}.hero .metric-detail{color:rgba(255,255,255,.62)}.narrative{background:var(--card);border:1px solid var(--line);border-left:5px solid var(--accent);border-radius:14px;padding:22px 24px;margin-bottom:18px;display:grid;gap:10px}.narrative p{color:var(--muted)}.info-section{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px;margin-bottom:18px}.section-headline{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}.scope-badge{font-size:10px;text-transform:uppercase;letter-spacing:.7px;font-weight:800;color:var(--secondary);background:#eef3f8;border:1px solid #d5e1ee;border-radius:999px;padding:6px 10px;white-space:nowrap}.section-kicker{font-size:10px;text-transform:uppercase;letter-spacing:2px;color:var(--accent);font-weight:800;margin-bottom:8px}.info-section h2{font-family:Georgia,serif;font-size:26px;font-weight:400;margin-bottom:6px}.section-subtitle,.section-note,.section-text{color:var(--muted);font-size:13px;margin-bottom:16px}.section-body{margin-top:14px}.bars{display:grid;gap:13px}.bar-top{display:flex;justify-content:space-between;gap:18px;font-size:13px;margin-bottom:5px}.bar-top strong{white-space:nowrap;color:var(--text)}.bar-track{height:10px;background:var(--soft);border-radius:99px;overflow:hidden}.bar-fill{height:100%;background:linear-gradient(90deg,var(--accent),var(--secondary));border-radius:99px}.compare-list{display:grid;gap:0}.compare-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 0;border-bottom:1px solid var(--line)}.compare-row:last-child{border-bottom:0}.compare-label{font-size:13px;color:var(--muted)}.compare-values{display:flex;align-items:center;gap:8px}.val{font-weight:800;font-size:17px}.val.primary{color:var(--accent)}.val.secondary{color:var(--secondary)}.sep{color:var(--line)}.delta{font-size:11px;font-weight:800;border-radius:99px;padding:3px 7px;background:var(--soft);color:var(--muted)}.delta.plus{background:#ecfdf5;color:#059669}.delta.minus{background:#fff1f2;color:#e11d48}.stacked-list{display:grid;gap:16px}.stacked-title{font-weight:800;font-size:13px;margin-bottom:6px}.stacked-bar{display:flex;height:24px;border-radius:7px;overflow:hidden;background:var(--soft)}.stacked-seg{display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:800}.stacked-legend{display:flex;flex-wrap:wrap;gap:8px 14px;margin-top:7px;color:var(--muted);font-size:11px}.stacked-legend span{display:flex;align-items:center;gap:5px}.stacked-legend i{width:9px;height:9px;border-radius:2px;display:inline-block}.insight-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}.insight-card{background:linear-gradient(180deg,#fff,var(--soft));border:1px solid var(--line);border-radius:14px;padding:18px}.insight-num{font-size:10px;color:var(--accent);font-weight:900;letter-spacing:1.5px;margin-bottom:8px}.insight-card h4{font-size:15px;margin-bottom:7px}.insight-card p{font-size:12px;color:var(--muted);line-height:1.65}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border-bottom:1px solid var(--line);padding:9px 10px;text-align:left}th{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);background:var(--soft)}.foot{text-align:center;color:var(--muted);font-size:11px;padding:24px;border-top:1px solid var(--line)}@media(max-width:700px){.hero{padding:34px 24px}.page{padding:22px 14px}.compare-row{align-items:flex-start;flex-direction:column}.compare-values{width:100%;justify-content:flex-start}.info-section{padding:18px}.bar-top{flex-direction:column;gap:2px}.metric-value{font-size:26px}}


  /* ── Hub de sources : Grist pour gros volumes, drag & drop pour analyse rapide ── */
  .source-hub {
    margin: 12px;
    padding: 12px;
    border: 1px solid var(--gris1);
    border-radius: 10px;
    background: var(--gris0);
    display: grid;
    gap: 8px;
    flex-shrink: 0;
  }
  .source-hub-title {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: .6px;
    color: var(--gris3);
    text-transform: uppercase;
  }
  .source-card {
    background: var(--blanc);
    border: 1px solid var(--gris1);
    border-radius: 8px;
    padding: 10px;
  }
  .source-card.active { border-color: var(--vert); background: #f0fdf4; }
  .source-card.warn { border-color: #fbbf24; background: #fffbeb; }
  .source-card .sc-head { display:flex; justify-content:space-between; gap:8px; align-items:center; }
  .source-card .sc-title { font-size: 12px; font-weight: 800; color: var(--texte); }
  .source-card .sc-badge { font-size: 9px; font-weight: 800; border-radius: 20px; padding: 2px 7px; background: var(--gris1); color: var(--gris3); text-transform: uppercase; white-space: nowrap; }
  .source-card.active .sc-badge { background:#dcfce7; color:#166534; }
  .source-card.warn .sc-badge { background:#fef3c7; color:#92400e; }
  .source-card .sc-detail { margin-top: 5px; font-size: 11px; color: var(--gris3); line-height: 1.45; }
  .source-card .sc-actions { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
  .source-action { border:1px solid var(--gris2); background:var(--blanc); color:var(--texte); border-radius:7px; padding:5px 8px; font-size:10px; font-weight:700; cursor:pointer; }
  .source-action.primary { background:var(--albert); color:white; border-color:var(--albert); }
  .source-action:hover { border-color: var(--albert); }
  .dropzone.compact { margin-top: 6px; padding: 12px; border-style: solid; background: var(--blanc); }
  .dropzone.compact .icon { font-size: 18px; margin-bottom: 3px; }
  .dropzone.compact .txt { font-size: 11px; }
  .doc-advice {
    margin-top: 7px;
    padding: 7px 8px;
    border-radius: 7px;
    border-left: 3px solid #f59e0b;
    background: #fffbeb;
    color: #92400e;
    font-size: 10px;
    line-height: 1.45;
  }
  .mode-pill {
    font-size:10px;
    font-weight:800;
    background:#eef3f8;
    color:var(--secondary, #E1000F);
    border:1px solid #d5e1ee;
    padding:2px 8px;
    border-radius:999px;
  }

</style>
</head>
<body>
  <div class="hero">
    ${spec.themeId === 'clair' ? '<img src="data:image/png;base64,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" alt="Parcoursup" style="height:28px;margin-bottom:12px;display:block">' : '<img src="data:image/png;base64,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" alt="Parcoursup" style="height:28px;margin-bottom:12px;display:block;opacity:0.92">'}
    <div class="eyebrow">${escapeHtml(spec.eyebrow)}</div>
    <h1>${escapeHtml(spec.title)}</h1>
    <p class="hero-sub">${escapeHtml(spec.subtitle)}</p>
    ${metrics}
  </div>
  <main class="page">
    ${narrativeHtml}
    ${sections}
  </main>
  <div class="foot">${escapeHtml(spec.footer)}</div>
</body>
</html>`;
}

function buildFallbackInfographicSpec(question, localAnalysis) {
  const table = getActiveDataSource();
  const source = table ? `${table.source} · ${table.rows.length.toLocaleString('fr-FR')} lignes` : 'Données disponibles';
  const rows = table?.rows || [];
  const headers = table?.headers || [];
  const metrics = [
    { label: 'Source', value: table?.source || 'Données', detail: source },
    { label: 'Lignes', value: rows.length.toLocaleString('fr-FR'), detail: 'observations analysées' },
    { label: 'Colonnes', value: headers.length.toLocaleString('fr-FR'), detail: 'variables disponibles' }
  ];
  const sections = [];
  const interesting = headers.filter(h => !/id$|^id$|code|uai|numero|numéro/i.test(h)).slice(0, 5);
  interesting.forEach((h, idx) => {
    const counts = new Map();
    rows.forEach(r => {
      const v = String(r[h] ?? '').trim();
      if (v) counts.set(v, (counts.get(v) || 0) + 1);
    });
    const items = [...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([label, count]) => ({ label, count, value: count, percent: `${(count / Math.max(rows.length,1) * 100).toFixed(1).replace('.', ',')} %` }));
    if (items.length) sections.push({ type: 'ranking', kicker: String(idx+1).padStart(2,'0'), title: h, subtitle: 'Répartition des principales valeurs', items });
  });
  sections.push({ type: 'insights', title: 'À retenir', items: [
    { title: 'Synthèse calculée localement', text: 'Les graphiques ci-dessus sont produits à partir des lignes accessibles au widget, sans se limiter à un aperçu.' },
    { title: 'Structure adaptive', text: 'Les sections varient selon les colonnes détectées et la question posée.' }
  ]});
  return { title: question || 'Infographie adaptive', subtitle: source, eyebrow: 'Infographie adaptive · Albert', metrics, sections };
}

let _infogCounter = 0;
window._infogSpecs = window._infogSpecs || {};

function _icBuildTitlesEditorHtml(spec, uid) {
  const fields = [
    { id: `ict-${uid}-title`,    label: 'Titre principal',  val: spec.title    || '' },
    { id: `ict-${uid}-subtitle`, label: 'Sous-titre',       val: spec.subtitle || '' },
    ...(spec.sections || []).map((s, i) => ({
      id:    `ict-${uid}-s${i}`,
      label: `Section ${i+1} — ${s.type}`,
      val:   s.title || ''
    }))
  ];
  const inputs = fields.map(f =>
    `<div style="display:flex;flex-direction:column;gap:3px">
       <label style="font-size:10px;font-weight:700;color:var(--gris3);text-transform:uppercase">${escapeHtml(f.label)}</label>
       <input id="${f.id}" value="${escapeAttr(f.val)}" style="border:1px solid var(--gris1);border-radius:6px;padding:5px 8px;font-size:12px;width:100%">
     </div>`
  ).join('');
  return `<div style="display:grid;gap:8px;padding:12px 0">${inputs}
    <div style="display:flex;gap:8px;margin-top:4px">
      <button class="ic-retheme-btn" onclick="icApplyTitles(${uid})" style="background:var(--albert);color:white;border-color:var(--albert)">✅ Mettre à jour</button>
      <button class="ic-retheme-btn" onclick="icToggleTitlesEditor(${uid})">Annuler</button>
    </div>
  </div>`;
}

function icToggleTitlesEditor(uid) {
  const te = document.getElementById(`ic-te-${uid}`);
  if (te) te.style.display = te.style.display === 'none' ? 'block' : 'none';
}
window.icToggleTitlesEditor = icToggleTitlesEditor;

function icApplyTitles(uid) {
  const stored = window._infogSpecs[uid];
  if (!stored) return;
  const spec = stored.spec;
  const get = id => { const el = document.getElementById(id); return el ? el.value : null; };
  const newTitle    = get(`ict-${uid}-title`);
  const newSubtitle = get(`ict-${uid}-subtitle`);
  if (newTitle    !== null) spec.title    = newTitle;
  if (newSubtitle !== null) spec.subtitle = newSubtitle;
  (spec.sections || []).forEach((s, i) => {
    const v = get(`ict-${uid}-s${i}`);
    if (v !== null) s.title = v;
  });
  if (newTitle !== null) _icPersistInfographicTitle(uid, newTitle, false);
  // Re-render
  const theme = (typeof INFOGRAPH_THEMES !== 'undefined' ? INFOGRAPH_THEMES : []).find(t => t.id === stored.themeId) || {};
  const newHtml = renderAdaptiveInfographicHtml(spec, spec.title);
  const blob = new Blob([newHtml], { type: 'text/html;charset=utf-8' });
  const newUrl = URL.createObjectURL(blob);
  const frame = document.getElementById(`ic-frame-${uid}`);
  if (frame) frame.src = newUrl;
  const openLink = document.getElementById(`ic-open-${uid}`);
  if (openLink) openLink.href = newUrl;
  const dlLink = document.getElementById(`ic-dl-${uid}`);
  if (dlLink) dlLink.href = newUrl;
  icToggleTitlesEditor(uid);
}
window.icApplyTitles = icApplyTitles;

function addInfographicMessage(html, title = 'Infographie adaptive générée', opts = {}) {
  const safeHtml = html || renderAdaptiveInfographicHtml(buildFallbackInfographicSpec(title), title);
  generatedInfographics.push(safeHtml);
  const blob = new Blob([safeHtml], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const uid = ++_infogCounter;
  const infogId = opts.messageId || ('info_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
  const specJson = opts.spec ? JSON.stringify(opts.spec) : null;
  const activeTheme = opts.themeId || 'bordeaux';
  if (opts.spec) window._infogSpecs[uid] = { spec: JSON.parse(JSON.stringify(opts.spec)), themeId: activeTheme };

  const rethemeHtml = specJson
    ? `<div class="ic-retheme">
        ${(typeof INFOGRAPH_THEMES !== 'undefined' ? INFOGRAPH_THEMES : []).map(t =>
          `<button class="ic-retheme-btn${t.id === activeTheme ? ' ic-active' : ''}"
            onclick="rethemeInfographic(this,${escapeHtml(JSON.stringify(specJson))},'${t.id}')">
            <span class="ic-theme-dot" style="background:${t.accent};width:9px;height:9px;border-radius:50%;display:inline-block"></span>${escapeHtml(t.label)}
          </button>`).join('')}
        <button class="ic-retheme-btn" onclick="openInfographicComposer(${uid})" title="Recomposer">✏️ Recomposer</button>
        <button class="ic-retheme-btn" onclick="icToggleTitlesEditor(${uid})" title="Modifier les titres">🖊 Titres</button>
      </div>
      <div id="ic-te-${uid}" style="display:none;border:1px solid var(--gris1);border-radius:8px;padding:10px;margin-bottom:8px;background:var(--gris0)">
        ${_icBuildTitlesEditorHtml(opts.spec, uid)}
      </div>`
    : '';

  const wrap = document.getElementById('chat-messages');
  if (!wrap) return;
  const msg = document.createElement('div');
  msg.className = 'msg assistant';
  msg.style.maxWidth = '95%';
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.innerHTML = `
    <h4 class="ic-card-title" data-infog-id="${escapeAttr(infogId)}" data-original-title="${escapeAttr(title)}"><span class="ic-card-title-text">${escapeHtml(title)}</span><button type="button" class="ic-card-title-edit-btn" onclick="_icStartRenameCardTitle(this)" title="Renommer cette infographie">✎</button><button type="button" class="ic-card-title-reset-btn" onclick="_icResetCardTitle(this)" title="Revenir au titre original">↺</button></h4>
    ${rethemeHtml}
    <div style="display:flex;gap:8px;margin:10px 0;flex-wrap:wrap">
      <a id="ic-open-${uid}" href="${url}" target="_blank" rel="noopener" style="background:var(--albert);color:white;text-decoration:none;padding:7px 10px;border-radius:6px;font-size:12px;font-weight:600">Ouvrir l'infographie</a>
      <a id="ic-dl-${uid}" href="${url}" download="infographie_adaptive_albert.html" style="background:var(--gris0);color:var(--texte);text-decoration:none;padding:7px 10px;border-radius:6px;border:1px solid var(--gris1);font-size:12px;font-weight:600">Télécharger le HTML</a>
    </div>
    <iframe id="ic-frame-${uid}" src="${url}" title="${escapeAttr(title)}" style="width:100%;height:560px;border:1px solid var(--gris1);border-radius:8px;background:white"></iframe>
  `;
  msg.appendChild(bubble);
  wrap.appendChild(msg);
  wrap.scrollTop = wrap.scrollHeight;
  chatHistory.push({ role: 'assistant', content: `[Infographie adaptive générée : ${title}]` });
  if (opts.record !== false && typeof recordSessionMessage === 'function') {
    recordSessionMessage({ type: 'infographic', id: infogId, title, originalTitle: title, html: safeHtml, spec: opts.spec, themeId: activeTheme });
  }
}

function _icFindCardTitleEl(btn) {
  return btn ? btn.closest('h4.ic-card-title') : null;
}
function _icCardTitleTextEl(h4) {
  return h4 ? h4.querySelector('.ic-card-title-text') : null;
}
function _icPersistInfographicTitle(uidOrEl, title, resetToOriginal) {
  let uid = uidOrEl;
  let h4 = null;
  if (uidOrEl && uidOrEl.nodeType === 1) {
    h4 = uidOrEl;
    const frame = h4.closest('.msg-bubble')?.querySelector('iframe[id^="ic-frame-"]');
    uid = frame ? Number((frame.id || '').replace('ic-frame-', '')) : null;
  } else if (uid) {
    const frame = document.getElementById(`ic-frame-${uid}`);
    h4 = frame?.closest('.msg-bubble')?.querySelector('h4.ic-card-title');
  }
  const infogId = h4?.getAttribute('data-infog-id') || null;
  const originalTitle = h4?.getAttribute('data-original-title') || title;
  if (h4) {
    const txt = _icCardTitleTextEl(h4);
    if (txt) txt.textContent = title;
  }
  if (uid && window._infogSpecs && window._infogSpecs[uid]?.spec) {
    window._infogSpecs[uid].spec.title = title;
    const input = document.getElementById(`ict-${uid}-title`);
    if (input) input.value = title;
  }
  const session = (typeof getCurrentSession === 'function') ? getCurrentSession() : null;
  if (session && Array.isArray(session.messages)) {
    const msg = session.messages.find(m => m && m.type === 'infographic' && ((infogId && m.id === infogId) || (!infogId && m.title === originalTitle)));
    if (msg) {
      msg.title = title;
      msg.originalTitle = msg.originalTitle || originalTitle;
      if (msg.spec) msg.spec.title = title;
      session.updatedAt = new Date().toISOString();
    }
  }
  if (typeof scheduleSessionsSave === 'function') scheduleSessionsSave();
}
window._icPersistInfographicTitle = _icPersistInfographicTitle;

function _icStartRenameCardTitle(btn) {
  const h4 = _icFindCardTitleEl(btn);
  const txt = _icCardTitleTextEl(h4);
  if (!h4 || !txt || h4.querySelector('.ic-card-title-input')) return;
  const current = txt.textContent.trim();
  const input = document.createElement('input');
  input.className = 'ic-card-title-input';
  input.value = current;
  txt.replaceWith(input);
  input.focus();
  input.select();
  const commit = () => {
    const value = input.value.replace(/\s+/g, ' ').trim() || current;
    const span = document.createElement('span');
    span.className = 'ic-card-title-text';
    span.textContent = value;
    input.replaceWith(span);
    _icPersistInfographicTitle(h4, value, false);
  };
  input.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
    if (ev.key === 'Escape') { ev.preventDefault(); input.value = current; commit(); }
  });
  input.addEventListener('blur', commit, { once: true });
}
window._icStartRenameCardTitle = _icStartRenameCardTitle;

function _icResetCardTitle(btn) {
  const h4 = _icFindCardTitleEl(btn);
  if (!h4) return;
  const original = h4.getAttribute('data-original-title') || 'Infographie Albert';
  const input = h4.querySelector('.ic-card-title-input');
  if (input) {
    const span = document.createElement('span');
    span.className = 'ic-card-title-text';
    span.textContent = original;
    input.replaceWith(span);
  } else {
    const txt = _icCardTitleTextEl(h4);
    if (txt) txt.textContent = original;
  }
  _icPersistInfographicTitle(h4, original, true);
}
window._icResetCardTitle = _icResetCardTitle;

/* Le compositeur multi-blocs (openInfographicComposer, closeInfographicComposer,
   _icRenderBlocks, _icRenderThemes, icToggleBlock, icSelectTheme, submitInfographicComposer)
   est déjà implémenté de façon complète dans sessions.js — il gère en plus la fusion
   des blocs globaux/session et le mode "Recomposer" (targetUid). Pas de redéfinition ici
   pour éviter toute divergence entre deux implémentations concurrentes. */

// ── buildInfographicSpecPrompt ──
// Prompt UNIQUE de génération de spec d'infographie, partagé par les deux points
// d'entrée : le bouton "🖼 Infographie" sur un bloc (generateInfographicWithAlbert)
// et le compositeur multi-blocs (_generateInfographicFromComposer, sessions.js).
// Avant cette factorisation, chaque chemin avait son propre prompt avec des règles
// différentes (l'un exigeait un "scope" par section et un pourcentage systématique
// sur les barres, l'autre non), ce qui produisait des infographies structurellement
// différentes à partir des mêmes données selon le bouton cliqué. Un seul prompt
// commun garantit un résultat cohérent quel que soit le point d'entrée ; seuls la
// question, le contexte de données et le thème de couleurs varient.
function buildInfographicSpecPrompt(question, context, theme) {
  const accent = (theme && theme.accent) || '#003189';
  const secondary = (theme && theme.secondary) || '#E1000F';
  return `Tu es un directeur artistique, data analyst et rédacteur institutionnel.

Tu dois produire une SPECIFICATION JSON pour une infographie adaptive. Le HTML sera généré ensuite par un moteur de rendu : ne renvoie donc PAS de HTML.

Réponds UNIQUEMENT par un JSON valide, sans Markdown, sans commentaire, sans texte avant/après.

Schéma attendu :
{
  "title": "titre clair",
  "subtitle": "sous-titre avec périmètre et volume",
  "eyebrow": "contexte court",
  "accent": "${accent}",
  "secondary": "${secondary}",
  "metrics": [ {"label":"...", "value":"...", "detail":"..."} ],
  "narrative": ["phrase analytique 1", "phrase analytique 2"],
  "sections": [
    {"type":"kpi_grid", "title":"...", "metrics":[...]},
    {"type":"ranking", "title":"...", "subtitle":"...", "items":[{"label":"...", "count":"...", "value":123, "percent":"..."}]},
    {"type":"bars", "title":"...", "items":[...]},
    {"type":"comparison", "title":"...", "items":[{"label":"...", "left":"...", "right":"...", "delta":"..."}]},
    {"type":"stacked", "title":"...", "groups":[{"label":"...", "total":123, "segments":[{"label":"...", "value":60, "display":"60 %"}]}]},
    {"type":"insights", "title":"...", "items":[{"title":"...", "text":"..."}]},
    {"type":"table", "title":"...", "headers":[...], "rows":[...]},
    {"type":"text", "title":"...", "text":"..."},
    {"type":"cascade", "title":"...", "scope":"...", "levels":["Niveau 1","Niveau 2","Niveau 3","..."], "total":123, "nodes":[{"label":"...", "count":10, "percent":"8,1 %", "children":[...]}]}
  ],
  "footer": "source et prudence éventuelle"
}

Règles d'adaptation éditoriale :
- Tu es un consultant Parcoursup : utilise l'ONTOLOGIE PARCOURSUP DÉTECTÉE pour choisir les blocs pertinents selon la question (public, territoire, mobilité, formation, admission, boursiers, apprentis, etc.).
- Construis une infographie narrative, pas une suite de statistiques. Il faut un fil conducteur clair : cadrage du public → résultats/profil → choix/orientations → destinations/mobilité si pertinent → enseignements.
- Ne force jamais une section Pays Basque si la question porte sur un autre public ; Pays Basque n'est qu'une variable territoriale parmi d'autres.
- Ne répète jamais dans une section les mêmes KPI que ceux du hero.
- Chaque section doit avoir un champ "scope" explicite : "Périmètre : ensemble des candidats", "Périmètre : zone Pays Basque", "Périmètre : candidats boursiers", "Périmètre : candidats avec proposition acceptée", etc. Ne mélange pas plusieurs périmètres dans une même section sauf si le type est "comparison".
- Pour Parcoursup : privilégie uniquement les dimensions détectées dans l'ontologie : profils, propositions, formations, académies, mobilité, boursiers, séries, établissements.
- Évite les comparaisons mathématiquement vraies mais peu lisibles (ex : "1789 / 579 +209 %"). Pour une relation partie/tout, utilise plutôt une répartition explicite : Bordeaux 75,5 % / autres académies 24,5 %.
- Mets 3 à 6 grands KPI en hero, choisis pour ouvrir l'histoire.
- Utilise au plus 7 sections, chacune utile et non redondante.
- Choisis le composant adapté : ranking/barres pour top catégories, comparison pour deux groupes, stacked pour répartitions qui totalisent 100 %, insights pour interprétation.
- Pour chaque groupe d'une section "stacked", renseigne "total" avec l'effectif réel de la population de ce groupe (ex. 175 candidats), même si tu ne détailles pas tous les sous-effectifs en segments. Le widget calcule lui-même, si besoin, un segment résiduel pour les effectifs non détaillés : ne l'ajoute pas toi-même, ne l'omets pas non plus, indique juste le vrai total.
- Quand une répartition (ex. par filière) apparaît à la fois en "ranking"/"bars" et en "stacked" : ce sont deux vues du même périmètre, jamais une fusion ou un remplacement. Garde les DEUX sections, dans le même ordre d'une génération à l'autre, avec EXACTEMENT le même texte de "scope" sur les deux (ex. "Périmètre : zone Pays Basque" partout, jamais "zone Pays Basque" sur l'une et "ensemble des candidats" sur l'autre pour les mêmes chiffres).
- Évite les tableaux sauf si c'est indispensable ; préfère ranking, cartes ou insights. Ne termine jamais par un tableau : termine par des insights/conclusion. Exception : si le brief contient un TABLEAU EN CASCADE À INTÉGRER OBLIGATOIREMENT, crée une section dédiée cascade/tableau hiérarchique.
- Pour les barres/rankings, fournis TOUJOURS une valeur numérique d'effectif dans "value". Le libellé affiché peut contenir "count" et "percent", mais "value" doit rester un nombre pur.
- INTERDIT ABSOLU : Ne jamais utiliser de label générique comme "Item 1", "Item 2", "Item 3", "Catégorie X", "Label", "Valeur" ou tout autre placeholder. Chaque label doit être extrait LITTÉRALEMENT du contexte fourni (ex : "Bordeaux", "Toulouse", "CPGE - CPES", "L1"). Si tu ne trouves pas de label dans le contexte, omets l'item entier.
- Les insights doivent interpréter les chiffres : évite "X domine" seul ; explique pourquoi c'est notable, surprenant ou utile.
- N'invente aucun chiffre. Utilise seulement le contexte. Si un élément manque, n'en fais pas une section.
- Pas de données personnelles ni d'identifiants individuels.

EXEMPLES OBLIGATOIRES À SUIVRE :

✅ BON — eyebrow et ranking avec labels réels :
{"eyebrow":"Parcoursup 2026 · Pays Basque","sections":[{"type":"ranking","title":"Académies d'accueil","scope":"Périmètre : zone Pays Basque","items":[{"label":"Bordeaux","value":1789,"percent":"75,5 %"},{"label":"Toulouse","value":253,"percent":"10,7 %"},{"label":"Paris","value":68,"percent":"2,9 %"}]}]}

✅ BON — insight avec analyse chiffrée (minimum 15 mots) :
{"type":"insights","title":"Points saillants","items":[{"title":"Ancrage territorial fort","text":"75,5 % des candidats du Pays Basque restent dans l'académie de Bordeaux — un taux de proximité bien supérieur à la moyenne nationale, qui reflète l'effet frontière de la région."}]}

❌ MAUVAIS — ne jamais produire :
{"eyebrow":"Analyse 1","sections":[{"type":"ranking","title":"Répartition","items":[{"label":"Item 1","value":"..."},{"label":"Catégorie X","value":""}]}]}

Demande utilisateur : ${question}

CONTEXTE À UTILISER :
${context || '(Aucun contexte disponible)'}`;
}


async function generateInfographicWithAlbert(question, localAnalysis, dataExecution = null) {
  // Si un résultat Data Engine est disponible (compare, group_by, pivot…), on l'injecte
  // en tête de contexte — il est plus structuré que la répartition locale et doit primer.
  let deContext = '';
  if (dataExecution && typeof dataEngineResultToContext === 'function') {
    try {
      const raw = dataEngineResultToContext(dataExecution);
      if (raw && raw.length > 20) deContext = raw + '\n\n';
    } catch(e) { console.warn('[infographic] dataEngineResultToContext error:', e); }
  }
  // Quand deContext existe déjà, c'est la seule source à faire autorité pour les chiffres :
  // on n'ajoute plus le group-by local (localAnalysis, filtres détectés séparément) ni la
  // synthèse pleine table (top valeurs par colonne sur données NON filtrées) — ces deux
  // sources pouvaient diverger du résultat Data Engine sur le même indicateur et produisaient
  // des infographies non reproductibles selon le point d'entrée (bloc vs compositeur).
  const context = deContext + buildContext(localAnalysis, { suppressGlobalStats: !!deContext });
  // Thème par défaut du bouton bloc-unique : Bleu France. La spec est désormais
  // retournée en plus du HTML (voir addInfographicMessage) pour que ce point d'entrée
  // bénéficie des mêmes boutons post-génération (thème, titres, recomposer) que le
  // compositeur multi-blocs, plutôt que d'être volontairement privé de ces réglages.
  const specPrompt = buildInfographicSpecPrompt(question, context, null);

  const response = await fetch(albertConfig.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: albertConfig.model,
      messages: [
        { role: 'system', content: specPrompt },
        { role: 'user', content: question }
      ],
      temperature: 0.2
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Erreur ${response.status} : ${errText.slice(0,200)}`);
  }
  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || '';
  let spec;
  try {
    spec = parseJsonLoose(raw);
  } catch(e) {
    console.warn('JSON infographie invalide, fallback local:', e, raw);
    spec = buildFallbackInfographicSpec(question, localAnalysis);
  }
  return { html: renderAdaptiveInfographicHtml(spec, question), spec };
}

