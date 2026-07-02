/* infographic.js — Rendu infographies adaptatives HTML
   Dépend de : config.js, albert.js */

/* ═══════════════════════ MODE INFOGRAPHIE ADAPTIVE HTML ═══════════════════════
   Version adaptive : Albert ne génère plus directement une page HTML figée.
   Il propose une STRUCTURE JSON éditoriale (sections, composants, messages),
   puis le widget rend cette structure avec des composants HTML/CSS réutilisables.
   Objectif : obtenir un comportement proche des Artifacts Claude, mais avec des
   calculs locaux Grist/Excel et une identité graphique cohérente. */
let generatedInfographics = [];

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
  return `<div class="stacked-list">${groups.map(g => {
    const segments = Array.isArray(g.segments) ? g.segments.slice(0, 6) : [];
    const values = segments.map(x => Number(x.value) || parseInfographicNumber(x.display || x.percent) || 0);
    const sum = values.reduce((s, x) => s + x, 0);
    // Si Albert fournit déjà des pourcentages (somme proche de 100), on les utilise tels quels.
    // Sinon, on normalise sur la somme des effectifs.
    const valuesArePercents = sum > 85 && sum <= 105 && values.every(v => v >= 0 && v <= 100);
    const total = valuesArePercents ? 100 : (sum || 1);
    return `<div class="stacked-block">
      <div class="stacked-title">${escapeHtml(g.label || '')}</div>
      <div class="stacked-bar">${segments.map((seg, i) => {
        const w = clampNum(values[i] / total * 100, 0, 100);
        return `<div class="stacked-seg" style="width:${w.toFixed(1)}%;background:${palette[i % palette.length]}">${w >= 10 ? escapeHtml(seg.shortLabel || seg.label || '') : ''}</div>`;
      }).join('')}</div>
      <div class="stacked-legend">${segments.map((seg, i) => `<span><i style="background:${palette[i % palette.length]}"></i>${escapeHtml(seg.label || '')} ${escapeHtml(seg.display || seg.percent || '')}</span>`).join('')}</div>
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
  .hero{background:var(--hero-bg);color:white;padding:46px 42px 38px;position:relative;overflow:hidden}.hero:before{content:"";position:absolute;right:-80px;top:-90px;width:330px;height:330px;border-radius:50%;background:var(--accent);opacity:.23}.hero>*{position:relative}.eyebrow{font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:700;color:var(--accent);margin-bottom:12px}.hero h1{font-family:Georgia,serif;font-size:clamp(30px,5vw,54px);font-weight:400;line-height:1.05;max-width:900px;margin-bottom:14px}.hero-sub{color:rgba(255,255,255,.65);max-width:760px}.page{max-width:1180px;margin:0 auto;padding:32px 26px}.metric-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px}.hero .metric-grid{max-width:920px;margin-top:30px}.metric-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px;box-shadow:0 8px 24px rgba(0,0,0,.04)}.hero .metric-card{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.08);box-shadow:none}.metric-label{font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted);font-weight:700;margin-bottom:8px}.hero .metric-label{color:rgba(255,255,255,.55)}.metric-value{font-size:30px;line-height:1;font-weight:800;color:var(--accent);margin-bottom:6px}.metric-detail{font-size:12px;color:var(--muted)}.hero .metric-detail{color:rgba(255,255,255,.62)}.narrative{background:var(--card);border:1px solid var(--line);border-left:5px solid var(--accent);border-radius:14px;padding:22px 24px;margin-bottom:18px;display:grid;gap:10px}.narrative p{color:var(--muted)}.info-section{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px;margin-bottom:18px}.section-headline{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}.scope-badge{font-size:10px;text-transform:uppercase;letter-spacing:.7px;font-weight:800;color:var(--secondary);background:#eef3f8;border:1px solid #d5e1ee;border-radius:999px;padding:6px 10px;white-space:nowrap}.section-kicker{font-size:10px;text-transform:uppercase;letter-spacing:2px;color:var(--accent);font-weight:800;margin-bottom:8px}.info-section h2{font-family:Georgia,serif;font-size:26px;font-weight:400;margin-bottom:6px}.section-subtitle,.section-note,.section-text{color:var(--muted);font-size:13px;margin-bottom:16px}.section-body{margin-top:14px}.bars{display:grid;gap:13px}.bar-top{display:flex;justify-content:space-between;gap:18px;font-size:13px;margin-bottom:5px}.bar-top strong{white-space:nowrap;color:var(--text)}.bar-track{height:10px;background:var(--soft);border-radius:99px;overflow:hidden}.bar-fill{height:100%;background:linear-gradient(90deg,var(--accent),var(--secondary));border-radius:99px}.compare-list{display:grid;gap:0}.compare-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 0;border-bottom:1px solid var(--line)}.compare-row:last-child{border-bottom:0}.compare-label{font-size:13px;color:var(--muted)}.compare-values{display:flex;align-items:center;gap:8px}.val{font-weight:800;font-size:17px}.val.primary{color:var(--accent)}.val.secondary{color:var(--secondary)}.sep{color:var(--line)}.delta{font-size:11px;font-weight:800;border-radius:99px;padding:3px 7px;background:var(--soft);color:var(--muted)}.delta.plus{background:#ecfdf5;color:#059669}.delta.minus{background:#fff1f2;color:#e11d48}.stacked-list{display:grid;gap:16px}.stacked-title{font-weight:800;font-size:13px;margin-bottom:6px}.stacked-bar{display:flex;height:24px;border-radius:7px;overflow:hidden;background:var(--soft)}.stacked-seg{display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:800}.stacked-legend{display:flex;flex-wrap:wrap;gap:8px 14px;margin-top:7px;color:var(--muted);font-size:11px}.stacked-legend span{display:flex;align-items:center;gap:5px}.stacked-legend i{width:9px;height:9px;border-radius:2px;display:inline-block}.insight-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}.insight-card{background:linear-gradient(180deg,#fff,var(--soft));border:1px solid var(--line);border-radius:14px;padding:18px}.insight-num{font-size:10px;color:var(--accent);font-weight:900;letter-spacing:1.5px;margin-bottom:8px}.insight-card h4{font-size:15px;margin-bottom:7px}.insight-card p{font-size:12px;color:var(--muted);line-height:1.65}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border-bottom:1px solid var(--line);padding:9px 10px;text-align:left}th{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);background:var(--soft)}.foot{text-align:center;color:var(--muted);font-size:11px;padding:24px;border-top:1px solid var(--line)}@media(max-width:700px){.hero{padding:34px 24px}.page{padding:22px 14px}.compare-row{align-items:flex-start;flex-direction:column}.compare-values{width:100%;justify-content:flex-start}.info-section{padding:18px}.bar-top{flex-direction:column;gap:2px}.metric-value{font-size:26px}}


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
  const context = deContext + buildContext(localAnalysis);
  const specPrompt = `Tu es un directeur artistique, data analyst et rédacteur institutionnel.

Tu dois produire une SPECIFICATION JSON pour une infographie adaptive. Le HTML sera généré ensuite par un moteur de rendu : ne renvoie donc PAS de HTML.

Réponds UNIQUEMENT par un JSON valide, sans Markdown, sans commentaire, sans texte avant/après.

Schéma attendu :
{
  "title": "titre clair",
  "subtitle": "sous-titre avec périmètre et volume",
  "eyebrow": "contexte court",
  "accent": "#003189",
  "secondary": "#E1000F",
  "metrics": [ {"label":"...", "value":"...", "detail":"..."} ],
  "narrative": ["phrase analytique 1", "phrase analytique 2"],
  "sections": [
    {"type":"kpi_grid", "title":"...", "metrics":[...]},
    {"type":"ranking", "title":"...", "subtitle":"...", "items":[{"label":"...", "count":"...", "value":123, "percent":"..."}]},
    {"type":"bars", "title":"...", "items":[...]},
    {"type":"comparison", "title":"...", "items":[{"label":"...", "left":"...", "right":"...", "delta":"..."}]},
    {"type":"stacked", "title":"...", "groups":[{"label":"...", "segments":[{"label":"...", "value":60, "display":"60 %"}]}]},
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
  return renderAdaptiveInfographicHtml(spec, question);
}

