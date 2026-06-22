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
  { id: 'bordeaux', label: 'Bordeaux', accent: '#c1440e', secondary: '#1a3a5c' },
  { id: 'ocean',    label: 'Océan',    accent: '#0369a1', secondary: '#164e63' },
  { id: 'foret',    label: 'Forêt',    accent: '#16a34a', secondary: '#14532d' },
  { id: 'nuit',     label: 'Nuit',     accent: '#7c3aed', secondary: '#1e1b4b' },
];
let _icState = { blocks: [], theme: 'bordeaux', dragSrcIdx: null };

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

