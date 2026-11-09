/* retours.js — v27.17 — « 👎 Réponse incorrecte » et questions à revoir.
   Les agents signalent une réponse fausse ; le widget note aussi tout seul les questions qu'il n'a pas comprises
   (« Critère non reconnu ») et les réponses d'Albert dont des chiffres n'ont pas été vérifiés.
   Tout reste dans le navigateur (localStorage) : rien n'est écrit dans Grist, rien n'est envoyé ailleurs.
   L'utilisateur exporte la liste (CSV ou texte) pour enrichir les tests du widget. */

const RETOURS_CLE = 'caes_retours_v1';
const RETOURS_MAX = 300;
const RETOURS_TYPES = {
  signalement: 'Signalée par un agent',
  non_compris: 'Non comprise par le widget',
  chiffres_douteux: 'Chiffres d’Albert non vérifiés',
};

const OUTILS_FR = { count: 'comptage', sum: 'somme', stats: 'moyenne', part: 'part', classement: 'classement', evolution: 'évolution', group_by: 'répartition', top: 'top', pivot: 'tableau croisé', compare: 'comparaison', export: 'export', albert: 'réponse d’Albert' };
const _outilFr = o => OUTILS_FR[o] || o || '';

function lireRetours() {
  try {
    const brut = (typeof localStorage !== 'undefined') ? localStorage.getItem(RETOURS_CLE) : null;
    const liste = brut ? JSON.parse(brut) : [];
    return Array.isArray(liste) ? liste : [];
  } catch (e) { return []; }
}
function _ecrireRetours(liste) {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(RETOURS_CLE, JSON.stringify(liste)); return true; }
  catch (e) { return false; } // stockage plein ou bloqué : le widget continue
}
// Résumé d'un résultat calculé (outil, chiffre, périmètre) — jamais le contenu complet de la réponse
function resumeExecution(exec) {
  if (!exec) return {};
  const r = exec.result || {};
  const chiffre = exec.kind === 'count' ? r.count : exec.kind === 'sum' ? r.sum : exec.kind === 'stats' ? r.avg
    : exec.kind === 'part' ? (typeof r.pct === 'number' ? Math.round(r.pct * 10) / 10 : null)
    : exec.kind === 'evolution' ? (r.lignes || []).map(l => l.valeur).join(' → ')
    : exec.kind === 'stats_groupes' ? `${(r.groupes || []).length} groupes`
    : exec.kind === 'evolution_groupes' ? `${(r.totaux || []).join(' → ')} (total, ${(r.sessions || []).join(' → ')})`
    : exec.kind === 'classement' ? (r.lignes || []).slice(0, 3).map(l => l.valeur).join(' · ')
    : (exec.kind === 'group_by' || exec.kind === 'top') ? `${r.distinct ?? (r.rows || []).length} valeurs` : null;
  let perimetre = '';
  try { if (typeof perimetreResultat === 'function' && exec.plan) perimetre = perimetreResultat(exec.kind, exec.plan, r).texte || ''; } catch (e) { /* résultat sans périmètre */ }
  return { outil: exec.kind || '', chiffre: chiffre ?? '', perimetre: perimetre || String(exec.text || '').slice(0, 200) };
}
function enregistrerRetour(r) {
  if (!r || !String(r.question || '').trim()) return null;
  const liste = lireRetours();
  const entree = {
    date: new Date().toISOString(),
    type: RETOURS_TYPES[r.type] ? r.type : 'signalement',
    question: String(r.question).trim().slice(0, 500),
    outil: String(r.outil || '').slice(0, 40),
    chiffre: String(r.chiffre ?? '').slice(0, 120),
    perimetre: String(r.perimetre || '').slice(0, 400),
    commentaire: String(r.commentaire || '').trim().slice(0, 1000),
    source: String(r.source || '').slice(0, 120),
  };
  // même question, même type, il y a moins de 2 minutes, sans commentaire : déjà notée
  const doublon = liste.find(x => x.question === entree.question && x.type === entree.type && !entree.commentaire
    && Math.abs(Date.parse(entree.date) - Date.parse(x.date)) < 120000);
  if (doublon) return doublon;
  liste.push(entree);
  while (liste.length > RETOURS_MAX) liste.shift();
  _ecrireRetours(liste);
  mettreAJourCompteurRetours();
  return entree;
}
function effacerRetours() { _ecrireRetours([]); mettreAJourCompteurRetours(); }
function compterRetours() { return lireRetours().length; }

// CSV « à la française » (;), ouvert directement par Excel ; protégé contre les formules (=, +, -, @)
function _celluleCSV(v) {
  let t = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}
function exporterRetoursCSV(liste = lireRetours()) {
  const entetes = ['Date', 'Type', 'Question', 'Commentaire', 'Outil', 'Chiffre donné', 'Périmètre', 'Source'];
  const lignes = liste.map(x => [x.date.slice(0, 16).replace('T', ' '), RETOURS_TYPES[x.type] || x.type, x.question, x.commentaire, _outilFr(x.outil), x.chiffre, x.perimetre, x.source].map(_celluleCSV).join(';'));
  return '﻿' + [entetes.join(';'), ...lignes].join('\r\n');
}
// Texte simple, à coller dans un message
function exporterRetoursTexte(liste = lireRetours()) {
  if (!liste.length) return 'Aucune question à revoir.';
  return liste.map((x, i) => `${i + 1}. [${RETOURS_TYPES[x.type] || x.type}] « ${x.question} »`
    + (x.commentaire ? `\n   Commentaire : ${x.commentaire}` : '')
    + (x.chiffre !== '' ? `\n   Réponse : ${_outilFr(x.outil)} ${x.chiffre}` : '')
    + (x.perimetre ? `\n   ${x.perimetre}` : '')).join('\n');
}
function telechargerRetours() {
  try {
    const blob = new Blob([exporterRetoursCSV()], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `questions_a_revoir_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (e) { console.warn('[Retours] export impossible :', e.message); }
}

function mettreAJourCompteurRetours() {
  if (typeof document === 'undefined' || !document.getElementById) return;
  const el = document.getElementById('retours-compteur');
  if (!el) return;
  const n = compterRetours();
  el.textContent = n ? String(n) : '';
  el.style.display = n ? '' : 'none';
}

// Formulaire sous une réponse : « Qu'est-ce qui ne va pas ? » (facultatif)
function ouvrirFormulaireRetour(bouton, contexte) {
  if (!bouton || typeof document === 'undefined') return;
  const barre = bouton.closest('.copilot-actions') || bouton.parentElement;
  if (!barre || barre.nextElementSibling?.classList?.contains('retour-form')) return;
  const form = document.createElement('div');
  form.className = 'retour-form';
  form.style.cssText = 'margin:6px 0 4px;padding:8px 10px;border:1px solid var(--gris2,#ddd);border-radius:8px;background:var(--gris0,#f6f6f6);font-size:12px';
  form.innerHTML = `<label style="display:block;margin-bottom:4px;font-weight:600">Qu'est-ce qui ne va pas ? <span style="font-weight:400;color:var(--gris3,#666)">(facultatif : chiffre attendu, mauvaise colonne, question mal comprise…)</span></label>`
    + `<textarea rows="2" style="width:100%;box-sizing:border-box;font:inherit;padding:6px;border:1px solid var(--gris2,#ddd);border-radius:6px"></textarea>`
    + `<div style="margin-top:6px;display:flex;gap:6px;align-items:center"><button type="button" class="copilot-action retour-envoyer">Signaler</button><button type="button" class="copilot-action retour-annuler">Annuler</button>`
    + `<span style="color:var(--gris3,#666)">Reste dans ce navigateur ; rien n'est envoyé.</span></div>`;
  barre.insertAdjacentElement('afterend', form);
  const zone = form.querySelector('textarea');
  if (zone) zone.focus();
  form.querySelector('.retour-annuler').onclick = () => form.remove();
  form.querySelector('.retour-envoyer').onclick = () => {
    enregistrerRetour({ type: 'signalement', ...(contexte || {}), commentaire: zone ? zone.value : '' });
    form.innerHTML = '<span style="color:var(--vert,#18753c)">✓ Merci, réponse signalée. Elle figure dans « 📝 À revoir ».</span>';
    bouton.disabled = true;
    bouton.textContent = '👎 Signalée';
  };
}

// Liste des questions à revoir, avec export
function ouvrirPanneauRetours() {
  if (typeof document === 'undefined') return;
  const ancien = document.getElementById('retours-panneau');
  if (ancien) ancien.remove();
  const liste = lireRetours().slice().reverse();
  const fond = document.createElement('div');
  fond.id = 'retours-panneau';
  fond.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px';
  const lignes = liste.map(x => `<tr><td style="padding:6px;border-bottom:1px solid #eee;white-space:nowrap">${escapeHtml(x.date.slice(0, 10))}</td><td style="padding:6px;border-bottom:1px solid #eee">${escapeHtml(RETOURS_TYPES[x.type] || x.type)}</td><td style="padding:6px;border-bottom:1px solid #eee"><strong>${escapeHtml(x.question)}</strong>${x.commentaire ? `<br><span style="color:#555">${escapeHtml(x.commentaire)}</span>` : ''}</td><td style="padding:6px;border-bottom:1px solid #eee;color:#555">${escapeHtml([_outilFr(x.outil), x.chiffre].filter(v => v !== '').join(' '))}</td></tr>`).join('');
  fond.innerHTML = `<div role="dialog" aria-label="Questions à revoir" style="background:#fff;border-radius:12px;max-width:820px;width:100%;max-height:85vh;overflow:auto;padding:16px 18px;font-size:13px">`
    + `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h3 style="margin:0">📝 Questions à revoir (${liste.length})</h3><button type="button" class="retours-fermer" title="Fermer" style="border:none;background:none;font-size:20px;cursor:pointer">×</button></div>`
    + `<p style="color:#555;margin:6px 0 10px">Réponses signalées par les agents, questions non comprises par le widget et chiffres d'Albert non vérifiés. Ces informations restent dans ce navigateur. Exportez-les pour les transmettre (elles servent à améliorer les tests du widget) — vérifiez avant qu'elles ne contiennent pas de données personnelles.</p>`
    + `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px"><button type="button" class="copilot-action retours-csv"${liste.length ? '' : ' disabled'}>📄 Télécharger (CSV)</button><button type="button" class="copilot-action retours-copier"${liste.length ? '' : ' disabled'}>📋 Copier le texte</button><button type="button" class="copilot-action retours-effacer"${liste.length ? '' : ' disabled'}>🗑 Tout effacer</button></div>`
    + (liste.length ? `<table style="border-collapse:collapse;width:100%"><thead><tr><th style="text-align:left;padding:6px">Date</th><th style="text-align:left;padding:6px">Type</th><th style="text-align:left;padding:6px">Question</th><th style="text-align:left;padding:6px">Réponse</th></tr></thead><tbody>${lignes}</tbody></table>` : '<p>Aucune question à revoir pour l\'instant.</p>')
    + `</div>`;
  document.body.appendChild(fond);
  const fermer = () => fond.remove();
  fond.addEventListener('click', e => { if (e.target === fond) fermer(); });
  fond.querySelector('.retours-fermer').onclick = fermer;
  fond.querySelector('.retours-csv').onclick = telechargerRetours;
  fond.querySelector('.retours-copier').onclick = async (e) => {
    try { await navigator.clipboard.writeText(exporterRetoursTexte()); e.target.textContent = '✓ Copié'; } catch (err) { e.target.textContent = 'Copie impossible'; }
  };
  fond.querySelector('.retours-effacer').onclick = () => {
    if (typeof confirm === 'function' && !confirm('Effacer toutes les questions à revoir de ce navigateur ?')) return;
    effacerRetours(); fermer();
  };
}

if (typeof window !== 'undefined') {
  Object.assign(window, { lireRetours, enregistrerRetour, effacerRetours, compterRetours, resumeExecution, exporterRetoursCSV, exporterRetoursTexte, telechargerRetours, ouvrirFormulaireRetour, ouvrirPanneauRetours, mettreAJourCompteurRetours });
  if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('DOMContentLoaded', mettreAJourCompteurRetours);
}
