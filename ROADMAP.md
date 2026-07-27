# Roadmap — Parcoursup Data Copilot

> État au 27/07/2026. Tout ce qui est en dessous est livré et stable.

---

## Architecture finale (v27.6)

8 modules JS, aucun bundler, chargés avec `defer` dans `<head>` :

```
js/config.js       → état global, Storage, thèmes
js/knowledge.js    → KB Parcoursup, index hybride, open data
js/documents.js    → sources Grist et fichiers locaux
js/planner.js      → intention, classification colonnes (columnKind)
js/dataEngine.js   → calculs locaux (pivot, group_by, stats, export)
js/infographic.js  → génération HTML infographie, thèmes charte État
js/sessions.js     → sessions, filtres persistants, compositeur, PDF
js/albert.js       → orchestration Albert API, UI chat
```

Fichiers de données à la racine (chargés dynamiquement) :
```
parcoursup-kb-v2.json
parcoursup-kb-index-v2.json
parcoursup-opendata-reference-v1.json
```

---

## Règles permanentes

1. **Cache-busting** : tout changement dans un `js/*.js` → bumper `?v=` dans `index.html`.
2. **Garde-fous DOM** : tout `getElementById()` suivi d'un `if (!el) return;`.
3. **`defer` obligatoire** sur tout nouveau `<script src="...">` dans `<head>`.
4. **Max 2 fichiers par patch** (sauf patch groupé explicitement demandé).
5. **Tests** : lancer `node js/test_*.js` avant de livrer.
6. **Lecture seule** : ne jamais modifier la table Grist ni la BDD.

---

## Chantiers livrés

| Réf | Description | Statut |
|-----|-------------|--------|
| PR1 | Refactoring monolithe → 8 modules JS | ✅ |
| PR2 | Filtres persistants + barre contexte moteur | ✅ |
| PR3 | Sessions multi-conversation | ✅ |
| PR4 | Compositeur d'infographies (drag & drop) | ✅ |
| PR5 | Copilot feel (layout plein écran, panneau sources, mini-suggestions) | ✅ |
| T2  | Garde-fous DOM sur tous les modules | ✅ |
| T4  | Synchronisation script timing (`defer` + init guards) | ✅ |

---

## Prochaines pistes (non planifiées)

- Mise à jour KB vers v3 (`build_parcoursup_kb_v3.py` prêt dans `scripts/`)
- Export PDF multi-blocs
- Détection automatique des colonnes Parcoursup dans une table inconnue
