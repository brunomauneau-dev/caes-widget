function normalizeText(v) {
  return String(v ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function pctFr(n, d, digits = 1) {
  if (!d) return '0,0 %';
  return (n / d * 100).toFixed(digits).replace('.', ',') + ' %';
}

function topCountsForRows(rows, col, max = 12) {
  const counts = new Map();
  let filled = 0;
  rows.forEach(row => {
    const v = row[col];
    if (isEmptyCell(v)) return;
    filled++;
    const key = String(v).trim();
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'))
    .slice(0, max)
    .map(([value, count]) => ({ value, count, pct: filled ? count / filled * 100 : 0 }));
  return { filled, distinct: counts.size, top };
}

function applyLocalActionFilters(rows, filters) {
  if (!filters || !filters.length) return rows.slice();
  return rows.filter(row => filters.every(f => rowMatchesFilter(row, f)));
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function isEmptyCell(v) {
  return v === undefined || v === null || String(v).trim() === '';
}

function rowMatchesFilter(row, filter) {
  const rowValue = normalizeText(row[filter.col]);
  const filterValue = normalizeText(filter.value);
  if (filter.op === 'neq') return rowValue !== '' && rowValue !== filterValue;
  return rowValue === filterValue;
}

function detectFilters(table, questionNorm, targetCol) {
  const filters = [];
  const headers = table.headers.filter(Boolean);

  // Cas métier Parcoursup : "basque" signifie Zone du Pays Basque = oui.
  if (/basque|pays basque/.test(questionNorm)) {
    const zoneCol = findBestColumn(headers, [/zone.*pays.*basque|pays.*basque|zone/], []);
    if (zoneCol) {
      const yes = uniqueValues(table, zoneCol).find(x => /^(oui|yes|1|vrai|true)$/.test(normalizeText(x.value))) || uniqueValues(table, zoneCol)[0];
      if (yes) addFilter(filters, zoneCol, yes.value, 'déduit de "basque"');
    }
  }

  // Cas métier : groupe L1 - CUPGE - DEUST - DU.
  if (/\bl1\b/.test(questionNorm) && /cupge/.test(questionNorm) && /deust/.test(questionNorm)) {
    const groupCol = findBestColumn(headers, [/grands? groupes?.*formation.*accueil.*acceptee|groupes?.*formation|formation.*accueil.*acceptee/], []);
    if (groupCol) {
      const match = uniqueValues(table, groupCol).find(x => {
        const n = normalizeText(x.value);
        return /\bl1\b/.test(n) && /cupge/.test(n) && /deust/.test(n) && /\bdu\b/.test(n);
      });
      if (match) addFilter(filters, groupCol, match.value, 'déduit de "L1 - CUPGE - DEUST - DU"');
    }
  }

  // Cas générique utile : "autre académie que Bordeaux", "hors Bordeaux",
  // "académie différente de Bordeaux" => Académie d'accueil != Bordeaux.
  if (/(autre|hors|sauf|different|differente|≠|!=|pas).*bordeaux|bordeaux.*(exclu|exclue|sauf)/.test(questionNorm)) {
    const acadCol = findBestColumn(headers, [/academie/], [/scolarite|origine|lycee/]);
    if (acadCol && acadCol !== targetCol) {
      const bordeaux = uniqueValues(table, acadCol).find(x => normalizeText(x.value) === 'bordeaux');
      if (bordeaux) addFilter(filters, acadCol, bordeaux.value, 'déduit de "autre/hors Bordeaux"', 'neq');
    }
  }

  // Détection générique : si une valeur catégorielle apparaît dans la question,
  // elle devient un filtre, sauf pour la colonne cible du GROUP BY.
  headers.forEach(col => {
    if (col === targetCol || filters.some(f => f.col === col)) return;
    const values = uniqueValues(table, col, 150);
    if (values.length > 150) return;
    for (const item of values) {
      const valNorm = normalizeText(item.value);
      if (['', 'oui', 'non', 'true', 'false'].includes(valNorm)) continue;
      if (valueLooksMentioned(item.value, questionNorm)) {
        addFilter(filters, col, item.value, 'valeur mentionnée dans la question');
        break;
      }
    }
  });

  return filters;
}

function detectTargetColumn(headers, questionNorm) {
  if (/\bacademie\b/.test(questionNorm)) {
    return findBestColumn(headers, [/academie/], [/scolarite|origine|lycee/]);
  }
  if (/\bdepartement\b/.test(questionNorm)) {
    return findBestColumn(headers, [/departement/], [/scolarite|origine|lycee/]);
  }
  if (/\bregion\b/.test(questionNorm)) {
    return findBestColumn(headers, [/region/], [/scolarite|origine|lycee/]);
  }
  if (/formation|filiere|specialite|mention|orientation|groupe/.test(questionNorm)) {
    return findBestColumn(headers, [/grands? groupes?.*formation|formation.*accueil|specialite|mention|filiere/], []);
  }
  return null;
}

function uniqueValues(table, col, max = 300) {
  const m = new Map();
  getColumnValues(table, col).forEach(v => {
    const k = String(v).trim();
    m.set(k, (m.get(k) || 0) + 1);
  });
  return [...m.entries()].sort((a,b) => b[1] - a[1]).slice(0, max).map(([value, count]) => ({ value, count }));
}

function getColumnValues(table, col) {
  return table.objects
    .map(r => r[col])
    .filter(v => v !== undefined && v !== null && String(v).trim() !== '');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

