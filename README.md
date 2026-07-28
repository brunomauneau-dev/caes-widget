# Parcoursup Data Copilot

Widget HTML/JS intégré dans [Grist](https://grist.numerique.gouv.fr) via "Custom Widget".  
Permet aux agents SAIO (Bordeaux) d'analyser la base Parcoursup en langage naturel, via l'API Albert (LLM souverain de l'État français).

**Déployé sur GitHub Pages :** https://brunomauneau-dev.github.io/caes-widget/

---

## Architecture

8 modules JS chargés avec `defer` dans `<head>`, aucun bundler.

| Fichier | Rôle |
|---|---|
| `js/config.js` | État global, constantes, Storage, thèmes infographies |
| `js/knowledge.js` | Glossaire Parcoursup, base de connaissances (KB), open data |
| `js/documents.js` | Requêtes locales Grist, extraction, export |
| `js/planner.js` | Détection d'intention, classification colonnes (`columnKind`) |
| `js/dataEngine.js` | Calculs locaux : pivot, group_by, compare, stats, export Excel/PDF |
| `js/infographic.js` | Génération HTML infographies, few-shot prompt, thèmes charte État |
| `js/sessions.js` | Sessions, filtres persistants, compositeur infographies, barre d'action |
| `js/albert.js` | Orchestration LLM (Albert API), UI chat, suggestions dynamiques |

Fichiers de données (chargés dynamiquement depuis la racine) :

| Fichier | Rôle |
|---|---|
| `parcoursup-kb-v2.json` | Base de connaissances Parcoursup (561 fiches) |
| `parcoursup-kb-index-v2.json` | Index hybride de la KB (recherche par terme) |
| `parcoursup-opendata-reference-v1.json` | Référentiel national open data Parcoursup |

Table Grist additionnelle (chargée via GitHub Actions) :

| Table | Rôle |
|---|---|
| `Parcoursup_National` | Données nationales Parcoursup n-1 (académie Bordeaux, session 2025, 631 lignes). Rechargeable manuellement via `.github/workflows/load-parcoursup.yml`. |

---

## Règles de développement

1. **Cache-busting automatique** : à chaque modification d'un `js/*.js`, bumper le `?v=` correspondant dans `index.html`. Format : `js/albert.js?v=27.6.12` → `js/albert.js?v=27.6.13`.
2. **Max 2 fichiers par patch** (sauf patch groupé explicitement demandé).
3. **Tests obligatoires** : lancer toute la suite (`node js/test_*.js`) avant de livrer.
4. **Garde-fous DOM** : tout `document.getElementById()` doit être suivi d'un `if (!el) return;`.
5. **`defer` sur tous les scripts** : tout nouveau `<script src="...">` dans `<head>` doit avoir l'attribut `defer`.
6. **Lecture seule** : ne jamais modifier la table Grist ni la BDD.

---

## Suite de tests

16 fichiers, ~371 tests. Depuis la racine du repo :

```bash
node js/sessions.test.js
node js/pr12.test.js
node js/pr21.test.js
node js/pr22.test.js
node js/test_pr41.js
node js/pr31.test.js
node js/test_t4.js
node js/test_action_bar.js
node js/test_clear_titles.js
node js/pr32.test.js
node js/pr42.test.js
node js/test_dom_guards.js
node js/test_copilot_feel.js
node js/test_script_timing.js
node js/test_patch_ui.js
node js/test_planner_columnkind.js
```

Tous les fichiers de test sont des modules ESM. Le repo doit avoir `"type": "module"` dans `package.json`.

---

## Contexte métier

- **SAIO Bordeaux** — Service Académique d'Information et d'Orientation, rectorat de Bordeaux.
- La BDD contient 22 colonnes issues d'un export SAP BusinessObjects → Grist.
- Scope géographique : académie (courant) > département > commune > Zone Pays Basque.
- **CAES** = procédure parallèle à Parcoursup, absente de cette BDD.
- **API LLM** : Albert (https://albert.api.etalab.gouv.fr) — clé configurée par l'utilisateur via le bouton ⚙️.

---

## Ce qui n'est PAS dans ce projet

- Pas de build/bundler (Webpack, Vite…)
- Pas de framework JS (React, Vue…)
- Pas de backend — tout est côté client
- Pas d'accès API SAP BusinessObjects (bloqué réseau académique)
- Pas de généralisation à d'autres tables que Parcoursup
