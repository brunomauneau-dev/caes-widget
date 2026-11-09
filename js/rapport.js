/* rapport.js — Rapport PDF : un ou plusieurs résultats de la conversation, imprimés proprement.
   v27.21 — Le bouton « 🖨 PDF » lançait window.print() : toute la page partait à l'impression (panneaux,
   boutons, conversation entière). Désormais :
   - « 🖨 PDF » sous une réponse : cette réponse seule, avec sa question ;
   - « 📑 Rapport PDF » (en-tête) : l'agent coche les réponses à réunir, dans l'ordre de la conversation.
   Chaque bloc garde son titre, son « 📌 Sur quoi porte ce calcul » et ses avertissements ; boutons et
   détails techniques sont retirés. Le PDF s'obtient par « Enregistrer au format PDF » dans la fenêtre
   d'impression du navigateur. Rien n'est envoyé hors du navigateur.
   Dépend de : #de-print-root et des styles @media print de index.html, escapeHtml (infographic.js). */

// Retire un élément et tout son contenu (balises de même nom imbriquées comprises), quand ses attributs
// passent le test. Travaille sur le texte HTML : testable sans navigateur.
function _retirerElements(html, tag, garderSi = () => false) {
  const re = new RegExp(`<(/?)${tag}\\b([^>]*)>`, 'gi');
  let out = '', pos = 0, m;
  re.lastIndex = 0;
  while ((m = re.exec(html))) {
    if (m[1] || garderSi(m[2] || '')) continue;
    // ouverture à retirer : chercher la fermeture qui lui correspond
    let prof = 1, fin = -1, n;
    const re2 = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
    re2.lastIndex = re.lastIndex;
    while ((n = re2.exec(html))) {
      prof += n[1] ? -1 : 1;
      if (prof === 0) { fin = re2.lastIndex; break; }
    }
    if (fin < 0) fin = html.length; // balise jamais fermée : on retire jusqu'au bout
    out += html.slice(pos, m.index);
    pos = fin;
    re.lastIndex = fin;
  }
  return out + html.slice(pos);
}
const _aClasse = (attrs, c) => new RegExp(`\\bclass\\s*=\\s*["'][^"']*\\b(?:${c})\\b`).test(attrs);

// HTML d'une réponse → HTML imprimable (sans boutons, ni détails techniques, ni actions)
function nettoyerPourImpression(html) {
  let h = String(html || '');
  ['button', 'select', 'textarea', 'script', 'iframe'].forEach(t => { h = _retirerElements(h, t); });
  h = _retirerElements(h, 'details', a => !_aClasse(a, 'msg-sources'));
  h = _retirerElements(h, 'div', a => !_aClasse(a, 'copilot-actions|ic-retheme'));
  h = h.replace(/<input\b[^>]*>/gi, '');
  h = h.replace(/<span[^>]*>\s*Afficher en\s*:\s*<\/span>/gi, '');
  h = h.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '');
  return h;
}

function _texteSimple(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}
// Titre d'un bloc : son titre (h4), sinon le début du texte
function titreDuBloc(html) {
  const h4 = String(html || '').match(/<h4\b[^>]*>([\s\S]*?)<\/h4>/i);
  const t = h4 ? _texteSimple(nettoyerPourImpression(h4[1]).replace(/<span class="de-exact-badge"[\s\S]*?<\/span>/i, '')) : '';
  if (t) return t.length > 110 ? t.slice(0, 109) + '…' : t;
  const brut = _texteSimple(nettoyerPourImpression(html));
  return brut.length > 90 ? brut.slice(0, 89) + '…' : (brut || 'Réponse');
}
const _calcule = html => /de-exact-badge|class="de-perimetre"/.test(String(html || ''));

// blocs : [{ html, question }] → HTML du rapport (en-tête, sommaire, blocs, pied)
function construireRapportHtml(blocs, { titre = '', date = new Date(), source = '' } = {}) {
  const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
  const jour = date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const liste = (blocs || []).filter(b => b && String(b.html || '').trim());
  const nbCalcules = liste.filter(b => _calcule(b.html)).length;
  const entete = `<div class="de-print-header"><span class="de-print-brand">Parcoursup Data Copilot${titre ? ` — ${esc(titre)}` : ''}</span><span class="de-print-date">${esc(jour)}</span></div>`
    + (source ? `<p class="de-print-source" style="font-size:11px;color:#555">Source active : ${esc(source)}</p>` : '');
  const sommaire = liste.length > 1
    ? `<div class="de-print-sommaire" style="margin:0 0 14px"><strong>${liste.length} résultats</strong>${nbCalcules ? ` (dont ${nbCalcules} calculé${nbCalcules > 1 ? 's' : ''} par le widget)` : ''} :<ol style="margin:4px 0 0 18px">${liste.map(b => `<li>${esc(titreDuBloc(b.html))}</li>`).join('')}</ol></div>`
    : '';
  const corps = liste.map((b, i) => `<section class="de-print-bloc" style="${i ? 'margin-top:18px;padding-top:12px;border-top:1px solid #ddd' : ''}">`
    + (b.question ? `<p class="de-print-question" style="font-size:11px;color:#555;margin:0 0 6px">${liste.length > 1 ? `${i + 1}. ` : ''}Question : « ${esc(String(b.question).trim())} »</p>` : '')
    + nettoyerPourImpression(b.html) + `</section>`).join('');
  const pied = `<p class="de-print-pied" style="font-size:10px;color:#666;margin-top:18px;border-top:1px solid #ddd;padding-top:6px">Les chiffres marqués « ✓ Calcul exact » sont calculés par le widget sur les données indiquées dans « Sur quoi porte ce calcul ». Les textes rédigés par Albert sont à relire avant diffusion.</p>`;
  return entete + sommaire + corps + pied;
}

// Réponses de la conversation, dans l'ordre, avec la question qui les précède (navigateur)
function blocsDeLaConversation() {
  if (typeof document === 'undefined') return [];
  const wrap = document.getElementById('chat-messages');
  if (!wrap) return [];
  const blocs = [];
  let question = '';
  Array.from(wrap.children).forEach(msg => {
    if (!msg.classList) return;
    if (msg.classList.contains('user')) { question = (msg.innerText || msg.textContent || '').trim(); return; }
    if (!msg.classList.contains('assistant')) return;
    const bulle = msg.querySelector('.msg-bubble');
    if (!bulle || bulle.querySelector('.loading-msg, iframe')) return; // chargement, infographie (export à part)
    const html = bulle.innerHTML;
    if (!_texteSimple(html)) return;
    blocs.push({ html, question, titre: titreDuBloc(html), calcule: _calcule(html), el: msg });
  });
  return blocs;
}

function _sourceActive() {
  try { const s = (typeof getActiveDataSource === 'function') ? getActiveDataSource() : null; return s ? `${s.source}${s.name ? ` · ${s.name}` : ''}` : ''; } catch (e) { return ''; }
}

// Imprime les blocs via #de-print-root (le reste de la page est masqué à l'impression)
function imprimerRapport(blocs, options = {}) {
  if (typeof document === 'undefined') return false;
  const root = document.getElementById('de-print-root');
  if (!root) return false;
  if (!(blocs || []).length) return false;
  root.innerHTML = construireRapportHtml(blocs, { source: _sourceActive(), ...options });
  document.body.classList.add('de-printing');
  let fini = false;
  const fin = () => { if (fini) return; fini = true; document.body.classList.remove('de-printing'); root.innerHTML = ''; };
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('afterprint', fin, { once: true });
  try { window.print(); } finally { fin(); } // print() attend la fermeture de la fenêtre d'impression
  return true;
}

// « 🖨 PDF » sous une réponse : cette réponse seule
function imprimerUneReponse(bulle, question = '') {
  if (!bulle) return false;
  let q = question;
  if (!q && bulle.closest) {
    let el = bulle.closest('.msg');
    while (el && (el = el.previousElementSibling)) { if (el.classList && el.classList.contains('user')) { q = (el.innerText || el.textContent || '').trim(); break; } }
  }
  return imprimerRapport([{ html: bulle.innerHTML, question: q }], { titre: titreDuBloc(bulle.innerHTML) });
}

// « 📑 Rapport PDF » : choisir les réponses à réunir
function ouvrirRapportPDF() {
  if (typeof document === 'undefined') return;
  const ancien = document.getElementById('rapport-panneau');
  if (ancien) ancien.remove();
  const blocs = blocsDeLaConversation();
  const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => String(s ?? ''));
  const jour = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const fond = document.createElement('div');
  fond.id = 'rapport-panneau';
  fond.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px';
  const lignes = blocs.map((b, i) => `<label style="display:flex;gap:8px;align-items:flex-start;padding:6px 4px;border-bottom:1px solid #eee;cursor:pointer"><input type="checkbox" class="rapport-choix" data-i="${i}" checked style="margin-top:3px"><span><strong>${esc(b.titre)}</strong>${b.calcule ? ' <span style="font-size:10px;color:#15803d;background:#dcfce7;border-radius:999px;padding:1px 6px">calculé</span>' : ' <span style="font-size:10px;color:#555;background:#f3f4f6;border-radius:999px;padding:1px 6px">Albert</span>'}${b.question ? `<br><span style="color:#555;font-size:12px">Question : ${esc(b.question)}</span>` : ''}</span></label>`).join('');
  fond.innerHTML = `<div role="dialog" aria-label="Rapport PDF" style="background:#fff;border-radius:12px;max-width:720px;width:100%;max-height:85vh;overflow:auto;padding:16px 18px;font-size:13px">`
    + `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h3 style="margin:0">📑 Rapport PDF</h3><button type="button" class="rapport-fermer" title="Fermer" style="border:none;background:none;font-size:20px;cursor:pointer">×</button></div>`
    + `<p style="color:#555;margin:6px 0 10px">Cochez les réponses à réunir, dans l'ordre de la conversation. Dans la fenêtre d'impression, choisissez « Enregistrer au format PDF ». Les infographies ont leur propre export.</p>`
    + (blocs.length
      ? `<label style="display:block;margin-bottom:8px">Titre du rapport : <input type="text" class="rapport-titre" value="${esc(`Rapport du ${jour}`)}" style="width:60%;padding:4px 6px;border:1px solid #ccc;border-radius:6px"></label>`
        + `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px"><button type="button" class="copilot-action rapport-tout">Tout cocher</button><button type="button" class="copilot-action rapport-calculs">Seulement les calculs</button><button type="button" class="copilot-action rapport-rien">Tout décocher</button></div>`
        + `<div>${lignes}</div>`
        + `<div style="margin-top:12px"><button type="button" class="copilot-action rapport-imprimer" style="font-weight:700">🖨 Imprimer / PDF</button></div>`
      : '<p>Aucune réponse à imprimer pour l\'instant : posez d\'abord une question.</p>')
    + `</div>`;
  document.body.appendChild(fond);
  const fermer = () => fond.remove();
  fond.addEventListener('click', e => { if (e.target === fond) fermer(); });
  fond.querySelector('.rapport-fermer').onclick = fermer;
  if (!blocs.length) return;
  const cases = () => Array.from(fond.querySelectorAll('.rapport-choix'));
  const bouton = fond.querySelector('.rapport-imprimer');
  const maj = () => { const n = cases().filter(c => c.checked).length; bouton.textContent = `🖨 Imprimer / PDF (${n} réponse${n > 1 ? 's' : ''})`; bouton.disabled = !n; };
  cases().forEach(c => { c.onchange = maj; });
  fond.querySelector('.rapport-tout').onclick = () => { cases().forEach(c => { c.checked = true; }); maj(); };
  fond.querySelector('.rapport-rien').onclick = () => { cases().forEach(c => { c.checked = false; }); maj(); };
  fond.querySelector('.rapport-calculs').onclick = () => { cases().forEach(c => { c.checked = blocs[Number(c.dataset.i)].calcule; }); maj(); };
  bouton.onclick = () => {
    const choisis = cases().filter(c => c.checked).map(c => blocs[Number(c.dataset.i)]);
    const titre = (fond.querySelector('.rapport-titre')?.value || '').trim();
    fermer();
    imprimerRapport(choisis, { titre });
  };
  maj();
}

if (typeof window !== 'undefined') {
  Object.assign(window, { nettoyerPourImpression, titreDuBloc, construireRapportHtml, blocsDeLaConversation, imprimerRapport, imprimerUneReponse, ouvrirRapportPDF });
}
