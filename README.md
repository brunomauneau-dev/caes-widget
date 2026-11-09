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

31 fichiers, 1 496 tests. Depuis la racine du repo :

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

### Comparaison entre sessions

`js/test_sessions_comparees.js` vérifie les questions qui comparent deux sessions, par exemple « les places en BTS ont-elles augmenté depuis 2024 ? », « évolution du nombre de PASS », « part des boursiers en BTS par rapport à l'an dernier » ou « combien de BTS en 2024 ? ».

- **Chargement :** la session demandée est téléchargée au moment de la question, puis gardée en mémoire. Le jeu principal du ministère ne contient que la dernière session ; les précédentes (2018 à 2024) viennent des jeux archivés (`fr-esr-parcoursup_2024`…).
- **Calcul :** le même calcul (comptage, somme, moyenne ou part) est fait sur chaque session. L'écart est donné en valeur et en %, ou en points pour une part.
- **Colonnes :** elles sont rapprochées par leur nom technique dans l'API, car le ministère peut changer un libellé d'une année à l'autre.
- **Avertissement :** le widget signale quand l'offre de formations a changé entre les deux sessions.
- **Arrêt :** une année non publiée, ou une session non chargée, arrête le calcul au lieu de répondre avec la mauvaise session.

L'essai sur données réelles fait calculer les deux sessions par le serveur du ministère.

### Taux et parts

`js/test_parts.js` vérifie les questions de taux et de parts. **C'est le widget qui fait la division, jamais Albert.** Deux cas :

- **Open data** (une ligne = une formation). Exemples : « part des boursiers parmi les admis en BTS », « part des filles parmi les admis », « taux de remplissage », « taux de proposition ». Le calcul divise la somme du numérateur par la somme du dénominateur, et non la moyenne des pourcentages de chaque formation. Il suit les définitions du ministère : les boursiers sont comptés parmi les admis néo-bacheliers.
- **Fichiers de candidats.** Exemples : « part des boursiers », « pourcentage de filles parmi les boursiers ». Le calcul divise le nombre de lignes qui remplissent la condition par le nombre de lignes du périmètre.

Si une colonne manque, le widget s'arrête. L'essai sur données réelles fait calculer le numérateur et le dénominateur par le serveur du ministère.

### Classements

`js/test_classement.js` vérifie les questions de classement, par exemple « quelles sont les formations les plus demandées », « les 10 BTS les plus sélectifs », « les formations avec le plus de places à Bordeaux » ou « les académies avec le plus de places ». Les formations, ou les regroupements, sont triées selon une colonne chiffrée, et le test vérifie l'ordre et les valeurs.

Règles vérifiées :
- « plus sélectif » signifie un taux d'accès plus bas ;
- les formations sans valeur sont écartées et comptées ;
- les ex æquo sont signalés ;
- un taux n'est jamais additionné par académie : le widget s'arrête ;
- une question comme « les critères les plus importants » reste à Albert.

**Conditions chiffrées** : « les formations de plus de 100 places », « au moins 30 admis », « un taux d'accès inférieur à 20 % ». Une condition que le widget ne comprend pas (« dont la capacité dépasse 100 ») l'arrête au lieu d'être ignorée.

« Les plus sélectifs » écarte les formations au taux d'accès de 0 : aucune proposition n'y a été faite par Parcoursup. Elles sont signalées à part.

L'essai sur données réelles compare trois classements et deux conditions chiffrées aux calculs du serveur du ministère.

### Fiches métiers

`js/test_fiches_metiers.js` : 5 fichiers **fictifs**, un par métier, avec leur façon de nommer les colonnes : export BO du SAIO, suivi des terminales d'un proviseur, entretiens d'un CIO, candidatures d'un BTS, tableau agrégé d'un chargé d'études (`tests/fixtures/`). Le test vérifie, par le vrai chemin d'import :
- le sens de chaque colonne ;
- le chiffre exact de chaque question métier ;
- ce qu'Albert reçoit ;
- l'arrêt quand l'information est absente.

Il couvre aussi les statuts de candidature en clair (Admis / Refusé / En liste d'attente) et les valeurs O/N.

Les 5 fichiers existent aussi en vrais fichiers Excel / CSV, prêts à importer à la main dans le widget pour une démonstration : `tests/fixtures/fichiers/` (régénérés par `node tests/fixtures/generer_fichiers.mjs`).

### Reformulations

`js/test_reformulations.js` : 31 questions types (open data et extraction de candidats), chacune posée de 3 à 16 façons : « nb de », « il y a combien de », négations (« qui ne sont pas boursiers »), « dans chaque académie », « prépas », « bacheliers généraux », « sur la commune de Bordeaux »… La bonne réponse est calculée sur les données. Chaque tournure doit donner le bon chiffre ou s'arrêter (« critère non reconnu ») : **jamais un autre chiffre en silence**. Les reformulations courantes sont ramenées à une forme comprise par le moteur (`reformulerQuestion`, dans `dataEngine.js`).

### Périmètre de chaque résultat

`js/test_perimetre.js` : sous le titre de chaque résultat calculé, le bloc **« 📌 Sur quoi porte ce calcul »** dit en clair combien de lignes sont retenues sur combien, la source (open data Parcoursup 2025, table Grist, fichier), les filtres appliqués et ceux **repris de la question précédente**. Ce qui n'entre pas dans le chiffre est écrit dans **« ⚠️ À noter »** : cases vides ignorées, valeurs non affichées. Le même périmètre est transmis à Albert, qui doit le recopier avec le chiffre.

Règle centrale : une réponse chiffrée est **exacte**, ou le widget affiche « Critère non reconnu ». Il ne donne jamais en silence un chiffre faux, par exemple le total du fichier parce qu'un filtre a été perdu.

## Essai sur données réelles

Les tests ci-dessus utilisent des données simulées. Pour vérifier le moteur sur **l'open data Parcoursup réel** :

1. Onglet **Actions** du repo → **Essai sur données réelles** (colonne de gauche).
2. Bouton **Run workflow** → (facultatif) ajouter des questions, séparées par « ; » → **Run workflow**.
3. Après une minute environ, cliquer sur l'exécution : le **résumé** affiche les contrôles de cohérence (✅ / ❌) puis les réponses du moteur à chaque question. Le rapport est aussi téléchargeable (*essai-resultats*).

Le script (`scripts/essai_donnees_reelles.mjs`) charge les vrais fichiers `js/` du widget, comme le navigateur, sans Albert ni Grist : il montre ce que le moteur de calcul répond. Lecture seule. Le rapport compare aussi chaque réponse avec le **lancement précédent** (section « Évolution ») : « aucune réponse n'a changé », ou le tableau avant / maintenant avec l'écart, et un avertissement si les données du ministère ont changé. Une croix rouge signifie qu'au moins un contrôle de cohérence a échoué (ex. une question sur une formation qui compte tout le fichier).

### Essai automatique chaque lundi

L'essai se lance aussi tout seul **chaque lundi matin**. S'il y a quelque chose à signaler, un **ticket GitHub** (onglet *Issues*) est ouvert, ou complété s'il en existe déjà un ouvert. GitHub vous prévient alors par e-mail et dans l'application. Cela concerne :
- un contrôle en échec ;
- un écart avec un chiffre officiel ;
- une réponse qui change ;
- de nouvelles données publiées par le ministère, par exemple la session 2026.

Si tout va bien, aucun ticket n'est créé. Pour essayer le circuit : *Run workflow* → cocher « Tester l'alerte ».

À savoir : GitHub suspend les lancements programmés d'un dépôt resté **60 jours sans aucune modification**. Il prévient alors par e-mail ; un clic sur *Enable workflow* (onglet Actions) les relance.

### Chiffres officiels

À chaque lancement, l'essai demande aussi au **serveur du ministère** (API de data.enseignementsup-recherche.gouv.fr) de calculer lui-même une vingtaine de chiffres : nombre de formations, de BTS, de PASS, formations publiques et privées, académie et ville de Bordeaux, Gironde, sélectives, places, candidats, admis, capacité moyenne, répartitions par région et par filière. Le widget doit retrouver chacun **à l'unité près**. Ce sont deux chemins indépendants : toute erreur de chargement, de colonne, de filtre ou de calcul du widget apparaît comme un écart ❌. Si l'API est indisponible, le chiffre est marqué ⚠️ « non vérifié » ; il n'est compté ni comme réussi ni comme échoué.

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
