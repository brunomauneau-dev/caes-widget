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
| `js/planner.js` | Détection d'intention, classification colonnes (`columnKind` : nom → abréviations → contenu) |
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

Source par défaut (sans table Grist ni fichier) :

| Source | Rôle |
|---|---|
| API open data `fr-esr-parcoursup` | Au démarrage, si aucune table Grist ni aucun fichier n'est fourni, le widget charge l'open data Parcoursup **France entière** de la **session la plus récente publiée** (détectée automatiquement, repli sur 2025). Une ligne = une formation. Priorité : table Grist > fichiers déposés > open data. Code : `loadDefaultOpenDataTable()` dans `js/knowledge.js`. |

Table Grist additionnelle (chargée via GitHub Actions) :

| Table | Rôle |
|---|---|
| `Parcoursup_National` | Données nationales Parcoursup n-1 (académie Bordeaux, session 2025, 631 lignes). Rechargeable manuellement via l'onglet *Actions* → `.github/workflows/load-parcoursup.yml`. |

---

## Proxy Albert (Clever Cloud) — NE PAS SUPPRIMER

Le navigateur ne peut pas appeler Albert API directement (CORS). Le widget passe par un petit proxy :

| Fichier | Rôle |
|---|---|
| `proxy/cloudflare-worker.js` | Même proxy, version Cloudflare Workers (gratuite) — voir `proxy/README.md` |
| `server.js` | Proxy Express (Clever Cloud) : relaie `/v1/*` vers Albert API en ajoutant la clé et les en-têtes CORS. `/health` → `{"status":"ok"}` |
| `package.json` | `start: node server.js` + dépendance `express` — **indispensables** au déploiement |

- **Option gratuite recommandée : Cloudflare Workers** — code `proxy/cloudflare-worker.js`, guide pas à pas `proxy/README.md`.
- Option historique : **Clever Cloud** (application `caes-widget`, payante), redéployée automatiquement à chaque fusion sur `main`. Arrêtée le 05/11/2026 (facture impayée).
- Variables d'environnement à définir dans Clever Cloud : `ALBERT_API_KEY` (obligatoire), `ALBERT_BASE_URL` (défaut : `https://albert.api.etalab.gouv.fr`), `ALLOWED_ORIGIN` (défaut : `*`).
- Adresse utilisée par le widget : réglage ⚙️ « endpoint » (`js/config.js`).
- Si `server.js` ou `package.json` sont supprimés/vidés, le déploiement échoue et le widget affiche « Erreur de connexion à Albert API ».

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

21 fichiers, 475 tests. Depuis la racine du repo :

```bash
npm test
```

Cette commande lance tous les fichiers `js/*.test.js` et `js/test_*.js` et s'arrête au premier échec.
Les tests sont aussi lancés **automatiquement par GitHub à chaque modification** (onglet *Actions* du repo, workflow `Tests`) : une coche verte ✅ signifie que tout passe, une croix rouge ❌ qu'un test a échoué.

Tous les fichiers de test sont des modules ESM (`"type": "module"` dans `package.json`).

---

## Outils annexes

| Fichier | Rôle |
|---|---|
| `generateur_bo.html` | Générateur de requêtes SAP BusinessObjects (page autonome, indépendante du widget) |
| `scripts/load_parcoursup_to_grist.py` | Chargement de la table `Parcoursup_National` (lancé par `.github/workflows/load-parcoursup.yml`) |
| `scripts/build_parcoursup_kb_v3.py` | Construction de la future KB v3 (non encore utilisée) |

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
- Pas de backend applicatif — tout est côté client, hormis le proxy Albert (`server.js`) qui ne fait que relayer les appels
- Pas d'accès API SAP BusinessObjects (bloqué réseau académique)
- Pas de généralisation à d'autres tables que Parcoursup
