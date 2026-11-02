# Roadmap — Parcoursup Data Copilot

> État au 02/11/2026. Tout ce qui est en dessous est livré et stable.

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
| CI  | Tests lancés automatiquement par GitHub Actions à chaque push (`tests.yml`, `npm test`) + ménage du repo (doublons JSON, fichiers obsolètes) | ✅ |
| COL | Détection des colonnes dans une table inconnue : abréviations (`LIB_ACA_ACC`, `DEP_SCO`, `Bac`…) puis contenu (académies, départements, séries, formations, sexe, établissements). Colonnes techniques jamais reclassées (`test_column_detection.js`) | ✅ |
| ALB | Albert reçoit le sens détecté de chaque colonne (section « Sens des colonnes » de la synthèse) ; colonnes reconnues prioritaires dans les profils. Correctif : ligature « œ » perdue par `normalizeText` (« vœux » non reconnu dans le widget réel) | ✅ |
| PN  | Données nationales Parcoursup n-1 → Grist : GitHub Actions (`load-parcoursup.yml`) + script Python (`scripts/load_parcoursup_to_grist.py`) + table `Parcoursup_National` (631 lignes, académie Bordeaux, session 2025) + intégration `knowledge.js` (`loadParcoursupNational`, `buildNationalDataContext`) | ✅ |

---

## Prochaines pistes (non planifiées)

- Mise à jour KB vers v3 (`build_parcoursup_kb_v3.py` prêt dans `scripts/`)
- Export PDF multi-blocs
- Nettoyer le code mort de `documents.js` (`PARCOURSUP_ONTOLOGY_RULES`, `classifyParcoursupColumn`, jamais appelés)
