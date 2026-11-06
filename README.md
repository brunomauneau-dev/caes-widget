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

Sources de données — **sélecteur toujours visible sous la conversation** (`js/documents.js` : `getActiveSourceKind`, `setActiveSource`, `importSpreadsheetFile`) :

| Source | Quand | Détail |
|---|---|---|
| 📊 Open data Parcoursup | **Au lancement** (par défaut) | France entière, **session la plus récente publiée** (détectée automatiquement, repli 2025). Une ligne = une formation. `loadDefaultOpenDataTable()` dans `js/knowledge.js`. |
| 🗂 Table Grist liée | Sur choix dans le sélecteur | La table branchée au widget dans Grist. |
| 📎 Fichier Excel / CSV | Bouton « Importer… » ou glisser-déposer | `.xlsx`, `.xls`, `.ods`, `.csv` (≤ 50 Mo). Lu dans le navigateur, jamais envoyé ailleurs ; perdu au rechargement. Ligne d'en-têtes détectée sous les titres d'export, choix de l'onglet, CSV `;`/`,` et Windows-1252. ✕ = retour à l'open data. |

Changer de source remet le contexte d'analyse à zéro (filtres, historique) et Albert reçoit la source active.

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

- **En service : Cloudflare Workers (gratuit)** — `https://albert-proxy.bruno-mauneau.workers.dev` (vérification : `/health`). Code `proxy/cloudflare-worker.js`, guide `proxy/README.md`. Adresse par défaut du widget : `ALBERT_DEFAULT_ENDPOINT` dans `js/config.js` ; une ancienne adresse Clever Cloud mémorisée dans le navigateur est remplacée automatiquement.
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

25 fichiers, 805 tests. Depuis la racine du repo :

```bash
npm test
```

Cette commande lance tous les fichiers `js/*.test.js` et `js/test_*.js` et s'arrête au premier échec.
Les tests sont aussi lancés **automatiquement par GitHub à chaque modification** (onglet *Actions* du repo, workflow `Tests`) : une coche verte ✅ signifie que tout passe, une croix rouge ❌ qu'un test a échoué.

Tous les fichiers de test sont des modules ESM (`"type": "module"` dans `package.json`).

---


### Robustesse : faux fichiers Excel et gros volumes

`js/test_robustesse_fichiers.js` vérifie que le widget ne « se perd » pas. Les faux fichiers sont fabriqués par `js/fixtures/donnees_simulees.mjs`, toujours identiques, et la bonne réponse de chaque question est calculée directement sur les lignes :

- extraction de 3 000 candidats avec en-têtes **complets**, **abrégés** (`BOURS`, `GRP_FORM_ACC`, `LIB_ACA_ACC`…) ou **vagues** (« Colonne A »…) ;
- export **désordonné** : lignes de titre, ligne vide, colonne vide, ligne « Total », valeurs BO (« Boursier des lycées », F / M) ;
- colonnes d'**état** écrites Oui/Non, **1/0** ou **VRAI/FAUX** : filtrées, jamais additionnées ni moyennées ;
- classeur dont le 1er onglet est une **notice** ;
- **open data** de 14 000 formations : statut public/privé, académie, département, ville, région, sélectivité, sommes (places, candidats, admis), moyennes (capacité, taux d'accès), en moins de 3 secondes par question.

Règle centrale : une réponse chiffrée est **exacte**, ou le widget affiche « Critère non reconnu ». Il ne donne jamais en silence un chiffre faux, par exemple le total du fichier parce qu'un filtre a été perdu.

## Essai sur données réelles

Les tests ci-dessus utilisent des données simulées. Pour vérifier le moteur sur **l'open data Parcoursup réel** :

1. Onglet **Actions** du repo → **Essai sur données réelles** (colonne de gauche).
2. Bouton **Run workflow** → (facultatif) ajouter des questions, séparées par « ; » → **Run workflow**.
3. Après une minute environ, cliquer sur l'exécution : le **résumé** affiche les contrôles de cohérence (✅ / ❌) puis les réponses du moteur à chaque question. Le rapport est aussi téléchargeable (*essai-resultats*).

Le script (`scripts/essai_donnees_reelles.mjs`) charge les vrais fichiers `js/` du widget, comme le navigateur, sans Albert ni Grist : il montre ce que le moteur de calcul répond. Lecture seule. Le rapport compare aussi chaque réponse avec le **lancement précédent** (section « Évolution ») : « aucune réponse n'a changé », ou le tableau avant / maintenant avec l'écart, et un avertissement si les données du ministère ont changé. Une croix rouge signifie qu'au moins un contrôle de cohérence a échoué (ex. une question sur une formation qui compte tout le fichier).

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
