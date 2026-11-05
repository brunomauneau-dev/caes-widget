// generer_fichiers.mjs — Écrit les fiches métiers fictives en vrais fichiers
// Excel / CSV dans tests/fixtures/fichiers/, pour les essayer à la main dans
// le widget (sélecteur de source → Importer un fichier, ou glisser-déposer).
//
// Usage (depuis la racine du repo) :
//   npm install --no-save xlsx@0.18.5
//   node tests/fixtures/generer_fichiers.mjs
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { FICHES } from './fiches_metiers.mjs';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fichiers');
fs.mkdirSync(dir, { recursive: true });

for (const f of FICHES) {
  const out = path.join(dir, f.fichier);
  if (f.fichier.endsWith('.csv')) {
    // CSV « à la française » : séparateur ; et virgule décimale, encodage UTF-8 avec BOM (Excel)
    const csv = f.rows.map(r => r.map(v => {
      const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? '');
      return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(';')).join('\r\n');
    fs.writeFileSync(out, '﻿' + csv, 'utf8');
  } else {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Fichier fictif généré pour les tests du widget — aucune donnée réelle.'], [`Métier : ${f.metier}`], [f.description]]), 'Notice');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(f.rows), f.onglet);
    XLSX.writeFile(wb, out);
  }
  console.log('écrit', path.relative(process.cwd(), out));
}
