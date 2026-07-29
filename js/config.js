/* config.js — État global, constantes, Storage
   Chargé en premier, avant tous les autres modules. */

/* app.js — logique principale du widget Grist/Albert.
   Fichier extrait du HTML monolithique v16 pour faciliter la maintenance. */
/* ═══════════════════════ ÉTAT GLOBAL ═══════════════════════ */
let documents = [];        // {id, name, type, content, status}
let gristRecords = [];
let gristTableName = '';
let chatHistory = [];
let persistentFilters = []; // [{col, value, op, label}] — filtres épinglés actifs
const SESSIONS_STORAGE_KEY = 'caes-copilot-sessions-v1';
let sessions = [];
let currentSessionId = null;
let sessionsSaveTimer = null;
const INFOGRAPH_THEMES = [
  // Charte graphique de l'État — juin 2021
  // Couleurs officielles : Bleu France #003189 (Pantone 286 C), Rouge Marianne #E1000F
  // Police : Marianne (https://gouvfr.atlassian.net/wiki/spaces/DB/pages/223019527/Marianne)
  {
    id: 'bleu-france',
    label: 'Bleu France',
    accent: '#003189',    // Bleu France officiel (Pantone 286 C)
    secondary: '#E1000F', // Rouge Marianne
    bg: '#f0f4fb',        // Fond bleu très clair
    hero: '#003189',      // Fond héro bleu institutionnel
    soft: '#e0eaf8',      // Surface douce
    text: '#1a1a2e',      // Texte foncé
    muted: '#4a5568',
    line: '#c8d8f0',
    card: '#ffffff',
  },
  {
    id: 'rouge-marianne',
    label: 'Rouge Marianne',
    accent: '#E1000F',    // Rouge Marianne
    secondary: '#003189', // Bleu France
    bg: '#fff5f5',
    hero: '#c9000e',      // Rouge légèrement assombri pour le héro
    soft: '#fde8e8',
    text: '#1a0000',
    muted: '#6b4a4a',
    line: '#f0c8c8',
    card: '#ffffff',
  },
  {
    id: 'clair',
    label: 'Clair',
    accent: '#003189',    // Bleu France
    secondary: '#6b7280', // Gris neutre
    bg: '#f7f8fa',        // Fond très clair
    hero: '#1f2937',      // Fond héro gris anthracite sobre
    soft: '#eef0f3',
    text: '#1f2937',
    muted: '#6b7280',
    line: '#e2e8f0',
    card: '#ffffff',
  },
  {
    id: 'nuit',
    label: 'Nuit',
    accent: '#7bafd4',    // Bleu France pastel (sur fond sombre)
    secondary: '#f4a0a0', // Rouge Marianne pastel
    bg: '#0f172a',        // Fond nuit très sombre
    hero: '#0a0f1e',      // Fond héro encore plus sombre
    soft: '#1e2a3a',
    text: '#e8edf5',
    muted: '#94a3b8',
    line: '#1e3a5f',
    card: '#162032',
  },
];
let _icState = { blocks: [], theme: 'bleu-france', dragSrcIdx: null };

let albertConfig = {
  key: '',
  endpoint: 'https://app-6fb1a617-d3e3-4989-9dcb-b396964f246e.cleverapps.io/v1/chat/completions',
  model: 'openweight-large'
};

/* ═══════════════════════ STOCKAGE PERSISTANT ═══════════════════════
   window.storage n'existe que dans l'environnement des artifacts
   Claude.ai. Ce widget étant déployé de façon autonome (GitHub Pages,
   chargé par Grist dans un iframe externe), on utilise localStorage
   à la place — tout en restant compatible si jamais le code est
   réutilisé un jour dans un artifact Claude.ai.                     */
const Storage = {
  async get(key) {
    if (window.storage && typeof window.storage.get === 'function') {
      return await window.storage.get(key, false);
    }
    const v = localStorage.getItem(key);
    if (v === null) throw new Error('Clé non trouvée dans localStorage');
    return { key, value: v, shared: false };
  },
  async set(key, value) {
    if (window.storage && typeof window.storage.set === 'function') {
      return await window.storage.set(key, value, false);
    }
    localStorage.setItem(key, value);
    return { key, value, shared: false };
  },
  async delete(key) {
    if (window.storage && typeof window.storage.delete === 'function') {
      return await window.storage.delete(key, false);
    }
    localStorage.removeItem(key);
    return { key, deleted: true, shared: false };
  }
};

const SUGGESTIONS = [
  "Résume ce jeu de données en 5 points",
  "Quelles sont les dates clés mentionnées ?",
  "Compare les documents chargés",
  "Extrait les chiffres importants",
  "Quels sont les points d'action ?",
];

