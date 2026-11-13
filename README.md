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
| `Parcoursup_National` | Copie Grist de l'open data Parcoursup (académie Bordeaux), rechargeable via l'onglet *Actions* → `.github/workflows/load-parcoursup.yml`. Le widget ne la lit plus d'office (l'ancien bouton « National 2025 » est retiré) : pour l'interroger, la choisir dans le sélecteur de source comme toute table Grist. |

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

69 fichiers, 2 791 tests. Depuis la racine du repo :

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

### Réponses incorrectes et questions à revoir

`js/test_tournures_libres.js` vérifie les **tournures libres** : formules de politesse et verbes d'intention (« Bonjour, pourriez-vous me dire… », « j'aimerais savoir… » ; avant, « savoir » était cherché dans les intitulés et donnait 0), fautes de frappe (« conbien »), « y a-t-il des… », numéros de département (« dans le 33 » = Gironde ; avant : tous les BTS), portée de la négation (« non sélectives dans l'académie de Bordeaux » ; avant : hors Bordeaux), et relances : « et par académie ? » / « et pour les CPGE ? » après une moyenne gardent la mesure, « et par académie ? » après des places donne des places, « lesquelles sont à Bordeaux ? » détaille par établissement, « et l'an dernier ? » reprend la question sur la session précédente.

`js/test_fichier_candidats.js` vérifie l'**export académique de suivi des candidats** (une ligne = un candidat, 22 colonnes, données fictives aux mêmes en-têtes que l'export réel) : « a eu une proposition » ≠ « a accepté » (avant : tout le fichier), taux de proposition des boursiers, formation d'accueil plutôt que spécialités du lycée (« en droit » comptait « Droit et Économie »), bonne colonne de série (bac technologique, bac pro agricole, STMG), lieux de scolarité ou d'accueil (« scolarisés à Bordeaux » donnait 0, « candidats de Pau » tout le fichier, Paris par arrondissements), hors académie, lycée d'origine ou d'accueil, public / privé, lycées agricoles, spécialités suivies au lycée (SES, NSI…), critères Oui/Non cumulés (« apprentis admis en BTS » perdait le filtre apprenti), arrêt sur ce que le fichier ne contient pas. « Droit » : la formation d'accueil est comptée, et le périmètre dit combien de candidats ont suivi au lycée l'enseignement de spécialité « Droit et Économie » ; « spécialité droit et économie » compte ces derniers.

`js/test_specialites_lycee.js` vérifie la règle **spécialité du lycée ≠ spécialité / mention de la formation d'accueil**, sur le modèle du droit, pour toutes les spécialités : « candidats en X » vise la formation d'accueil et le périmètre signale les spécialités de terminale qui contiennent X ; « spécialité X », « X en terminale », les sigles (SES, SVT, NSI, EPPCS…) et les noms propres au lycée (« droit et économie ») visent la spécialité du lycée (enseignements de spécialité et spécialité de bac pro / STMG), et le périmètre signale les formations d'accueil du même nom ; nom exact d'abord (« mathématiques » ≠ « Physique-Chimie et Mathématiques »), « maths et physique » = deux spécialités.

`js/test_bilan_lycee.js` vérifie les questions d'un **bilan de lycée** sur l'export de candidats : relances sur une partie de la population (« combien ont eu une proposition ? », « et parmi eux combien de boursiers ? », « dont combien admis en CPGE ? »), taux de deux groupes (« des boursiers et des non boursiers »), « part des candidats admis en BTS » (avant : 100 %), classements d'établissements d'origine ou d'accueil (« quel lycée a le plus de candidats admis en CPGE », « les universités qui accueillent le plus »), comparaison de deux lycées, avec les taux de chaque lycée (proposition, admission, boursiers, apprentis, admis hors académie).

`js/test_plusieurs_valeurs.js` vérifie les questions qui citent **plusieurs valeurs d'une même information** : « à Bordeaux ou à Pau » (avant : Bordeaux seul), « en Gironde et dans les Landes », « BTS et BUT », « admis en CPGE ou en école d'ingénieurs » (avant : 0), « hors Bordeaux et hors Toulouse » (les deux exclusions), sur l'open data et sur l'export de candidats ; « maths et physique », « boursiers et apprentis », « Droit et Économie » gardent leur sens « les deux à la fois ».

`js/test_listes.js` vérifie **« donne-moi la liste »** après un comptage (avant : export de toute la table, sans filtre) et **« quels établissements proposent… »** (avant : liste des intitulés) : les établissements retenus, avec leur commune et leur nombre de formations (ou de candidats), tous affichés.

`js/test_coherence.js` vérifie les **garde-fous de cohérence** (étape 1 de fiabilité) : « J'ai compris : … » en tête de chaque réponse (l'opération calculée, en clair) ; objet demandé respecté (« combien d'académies proposent des PASS » compte des académies différentes, avant : le nombre de PASS ; sinon arrêt) ; un export juste après un résultat filtré garde ses filtres (sauf « toute la table ») ; « donne-moi la liste » sans contexte demande « la liste de quoi ? ».

`js/test_pdf_demande.js` vérifie les demandes **« exporte cette liste en PDF »**, « imprime ce résultat » : la dernière réponse calculée est imprimée, comme avec le bouton « 🖨 PDF » (avant : un fichier Excel) ; « exporte en Excel » reste un export Excel.

`js/test_essai_double_lecture.js` vérifie le script de l'**essai « double lecture par Albert »** (`scripts/essai_double_lecture.mjs`, Actions → « Essai double lecture (Albert) ») : pour ~70 questions, la lecture attendue est comparée à celles de l'ancien moteur, du moteur actuel et d'Albert (Albert simulé dans le test) ; le bilan compte les contresens qu'Albert aurait signalés, les fausses alertes et le délai.

`js/test_verification_lecture.js` vérifie la **double lecture par Albert** dans le widget (`js/verification.js`, mode prudent) : le moteur répond tout de suite ; un modèle Albert rapide (Mistral Small) relit la question en arrière-plan ; en cas de désaccord important (autre chose compté, critère, lieu ou exclusion oubliés, liste au lieu d'export…), un avertissement « ⚠️ Vérification » s'ajoute sous la réponse et l'alerte est notée dans « À revoir » ; accord, Albert indisponible ou lent : rien ne s'affiche. Mesuré avant activation (`scripts/essai_double_lecture.mjs`) : 0 fausse alerte, 71 à 73 % des contresens signalés, 1,5 à 2 s.

`js/test_serie3.js` vérifie les corrections de la **série 3** (35 questions nouvelles) : « sauf les BTS » / « à l'exception des BTS » (avant : les BTS seuls), taux « des boursiers ayant… » rapporté aux boursiers, relances « et de Bayonne ? » / « et à Bayonne ? » (même colonne de lieu), « admis en BTS de Pau » (Pau n'est plus perdu), énumérations de 3 valeurs (« Bordeaux, Toulouse et Poitiers »), places moyennes, « je cherche les … », comparaison de deux lieux avec le critère commun gardé.

`js/test_serie4.js` vérifie les **enchaînements de relances** (2 à 4 questions à la suite, open data et fichier de candidats) : chaque relance garde ce qui ne change pas (formation, lieu, population, mesure) et remplace ce qui change ; « et à Pau ? » remplace le lieu précédent, « combien de places ? » / « combien d'admis ? » portent sur les mêmes formations, « et privées ? » est calculé.

`js/test_serie5.js` vérifie les **tournures de la vie réelle** : symboles (« taux d'accès > 80 % », « > 100 places »), abréviations (« cmb », « tx », « ds le 33 », « bdx », « en NA », « IDF », « STS »), fautes de frappe sur un lieu (« giroonde » → Gironde si un seul lieu est à une lettre près), « Rhône » lu à tort dans « Auvergne-Rhône-Alpes », listes avec condition (« quels BTS ont un taux d'accès inférieur à 10 % »).

`js/test_serie6.js` vérifie les **graphiques, exports et comparaisons entre années** : « en graphique », « en camembert », « fais un graphique par académie » reprennent le résultat affiché ; « exporte ce tableau » exporte le tableau, un export après une relance garde ses filtres ; « en 2024 et en 2025 » compare les deux sessions ; « combien de BTS en 2024 » puis « et en Gironde ? » reste en 2024.

`js/test_serie7.js` vérifie **16 questions longues à plusieurs critères** (sexe, boursier, série, lycée, lieu, formation, exclusions, « ou », taux) sur **8 présentations du même fichier** : colonnes complètes, abrégées (SEXE, BOURS…), en majuscules sans accents, anonymes (« Colonne A… » : bon chiffre ou arrêt, jamais un autre chiffre), lignes de titre et ligne « Total », colonne vide, valeurs codées (1 / 0, VRAI / FAUX, F / M).

`js/test_serie8.js` vérifie les **classements, tableaux croisés, statistiques par groupe et rapports** : « moyenne des vœux par série » (une moyenne par série ; « par couleur » sans colonne : arrêt), « par série et par département » (les deux colonnes nommées), « tableau croisé boursier par série », « classement des lycées par nombre d'admis » (les lycées, pas les spécialités), « le moins de licences » (groupes à 0 compris), « candidats par place » (Σ candidats ÷ Σ places).

`js/test_serie9.js` vérifie la **table Grist comme source** et le **passage d'une source à l'autre** : 18 questions sur le fichier de candidats donnent les mêmes chiffres en Excel et en table Grist (identifiants de colonnes, cases à cocher, listes de choix, colonnes A, B, C…) ; une copie de l'open data (table Grist ou fichier) est reconnue comme « une ligne = une formation » (places, candidats, admis additionnés) ; un changement de source remet le contexte à zéro.

`js/test_serie10.js` vérifie les **parts, établissements précis et lieux** : le numéro fait partie du nom d'établissement (« IUT Tarbes 3 », « Paris 1 » ≠ « Paris 10 »), « quelles formations propose le lycée X » (liste calculée), part d'une quantité (« part des places en BTS dans le privé » = Σ places ÷ Σ places), « formations de Lyon » = l'académie (comme « de Bordeaux »), lieux composés.

`js/test_serie11.js` vérifie les **effectifs précis, valeurs à zéro, exclusions multiples et négations** : « néo-bacheliers admis », « bacheliers généraux admis », « filles admises » (la bonne colonne, ou arrêt si elle manque), « aucun admis » / « pas de places » (formations à 0), « hors BTS et hors BUT », « sauf BTS, BUT et CPGE », « sauf en CPGE et en BTS », « qui ne sont pas en série générale ».

`js/test_serie12.js` vérifie les **vœux et moyennes** : « nombre total de vœux » (somme, pas le nombre de candidats), « entre 5 et 10 vœux », « un seul vœu », « sans vœu » sur une colonne vide (arrêt), « nombre moyen de vœux par lycée », « quel lycée a le plus de vœux en moyenne » (classé sur la moyenne), et dans l'open data « par formation » / « par BTS » = l'unité de la moyenne.

`js/test_serie13.js` vérifie les **spécialités combinées et comparaisons de formations** : « SES ou HGGSP » (l'une ou l'autre ; « et » : les deux), « comparer les admis en CPGE et en BTS », « comparer les boursiers admis en CPGE et en BTS » (deux formations, pas admis / non admis ni boursiers / non-boursiers), open data « comparer les BTS et les BUT en Gironde », et arrêt pour « comparer le nombre de places » (une comparaison compte des formations).

`js/test_serie14.js` vérifie la **mobilité des candidats** (fichier de candidats) : « quelle part des admis en CPGE viennent de Gironde » (parmi les admis en CPGE), « part des candidats de Gironde admis hors académie » (parmi les candidats de Gironde), « d'où viennent les admis en CPGE » (par département ou lycée d'origine), « où vont les boursiers » (par académie d'accueil), « dans quelles formations vont… » ; pas de réécriture sur l'open data.

`js/test_serie15.js` vérifie les **écarts, rangs et « environ »** : « combien de BTS de plus en Gironde que dans les Landes », « différence / écart entre… », « y a-t-il plus de … ou … » (comparaison avec l'écart affiché, groupes dans l'ordre de la question), « la deuxième académie pour le nombre de BTS » (classement), « environ combien… » ; une valeur comparée n'est jamais un filtre commun aux deux groupes.

`js/test_serie16.js` vérifie les **noms de formations de la langue courante** : psycho, compta, éco, prépa éco / scientifique, ingé, école d'infirmiers (= IFSI), « la fac » (= université) ; ce qui n'existe pas dans les données (kiné, médecine, université absente) s'arrête, jamais 0.

`js/test_serie17.js` vérifie les **classements selon un taux** : « quels lycées ont le plus fort taux de boursiers », « quel département… », « le taux de proposition le plus bas », « classement des lycées par taux de… », « les 5 lycées avec le meilleur taux… » (taux calculé dans chaque groupe, puis classé ; très petits groupes écartés et comptés), open data « quelle académie a le plus fort pourcentage de boursiers » (effectifs) ; « candidats par place » répondu sans Albert.

`js/test_serie18.js` vérifie **« par spécialité »** dans un fichier de candidats : le contexte choisit la colonne (enseignement / lycée / terminale → enseignements suivis, chaque spécialité comptée une fois par candidat ; formation / accueil / mention → la formation d'accueil ; bac pro → la spécialité du bac) ; sans indice, le widget demande de préciser.

`js/test_serie19.js` reproduit sur données fictives les deux erreurs trouvées par le **banc de contrôle de 100 questions sur le vrai fichier de candidats** (gardé hors du dépôt, données réelles) : deux lieux pour deux rôles (« scolarisés à Bordeaux admis à Bordeaux »), « combien de boursiers parmi eux ? » en relance.

`js/test_part_groupes.js` vérifie les **taux par groupe** : « pourcentage de candidats sans proposition par département », « part des boursiers par académie », « taux de remplissage des BTS par académie » donnent un taux calculé **dans** chaque groupe (avant : la répartition du total entre groupes, lue à tort comme un taux), avec la ligne « Ensemble », l'export, le graphique et les relances (« taux de proposition des boursiers » puis « et par département ? »).

`js/test_taux_acces.js` vérifie les **questions sur le taux d'accès**. « Taux d'accès moyen par académie / par filière » donne une statistique par groupe (formations, moyenne, médiane, min, max ; avant : une seule moyenne nationale) ; la statistique demandée (médiane, minimum, maximum) est en titre ; « taux d'accès des PASS », « … au lycée Montaigne » sont calculés par le moteur (une seule formation : sa valeur et son nom). Les formations au taux d'accès de 0 (aucune proposition Parcoursup) sont écartées des moyennes comme des classements, et c'est écrit. La moyenne est simple (non pondérée), et c'est écrit aussi.

`js/test_etablissements.js` vérifie les **questions sur les établissements**. « Formations au lycée Montaigne », « places à l'université de Bordeaux », « BUT à l'IUT de Bordeaux » filtrent sur le nom de l'établissement (expression exacte, puis tous les mots ; « I.U.T » = « IUT ») ; les homonymes de plusieurs villes sont listés avec leur commune. « Les lycées de … », « combien d'universités » portent sur le type d'établissement. « Combien d'établissements / de lycées … » et « nombre d'établissements par académie » comptent des établissements différents (nom + commune), plus des formations. Avant : « université de Bordeaux » → 8 (le mot cherché dans les intitulés de formation), « combien d'établissements dans l'académie de Bordeaux » → 631 (des formations), « les lycées de Bordeaux » → 0.

`js/test_sigles_formations.js` vérifie les **sigles et surnoms de formations**. Dans l'open data, « MCO », « NDRC », « SIO », « GEA », « TC », « khâgne » ou « Sciences Po » n'apparaissent dans aucun intitulé : le mot était ignoré sans prévenir, et le widget comptait tous les BTS, tous les BUT ou tout le fichier. Les sigles courants sont traduits vers les intitulés officiels (« BTS MCO » → Management Commercial Opérationnel), seulement s'ils sont absents de la source active (un fichier qui écrit « BTS MCO » reste lu tel quel). Et **un mot de la question qui ne correspond à rien arrête le calcul** (« combien de formations de pilote de ligne » → « pilote » non reconnu), au lieu de compter un ensemble plus large. Enfin, « licences de … » suit la catégorie officielle « Licence », comme « combien de licences » : les LAS (licences accès santé) ne sont plus comptées avec elles, et le périmètre dit combien sont laissées de côté (licences STAPS : 93, comme le ministère ; licences de droit : 273 = 264 « Droit » + 9 doubles licences avec droit).

`js/test_rapport_pdf.js` vérifie le **rapport PDF**. « 🖨 PDF » sous une réponse imprime cette réponse seule (avant : toute la page) ; « 📑 Rapport PDF » (en-tête) réunit les réponses cochées, dans l'ordre de la conversation, avec un titre, la date, la source, un sommaire et la question avant chaque bloc. Titres, « Sur quoi porte ce calcul » et avertissements sont gardés ; boutons et détails techniques retirés. Le PDF s'obtient par « Enregistrer au format PDF » dans la fenêtre d'impression ; rien ne sort du navigateur.

`js/test_session_kb.js` vérifie la **session décrite par la base de connaissances**. Les 561 fiches viennent du guide Parcoursup de la session 2026 (mis à jour jusqu'au 12 juin 2026). À partir de septembre 2026, la session en préparation est 2027 : Les règles et la procédure restent valables (elles changent très peu d'une année à l'autre) : seules les dates exactes sont celles de 2026. Albert reçoit la consigne de ne jamais présenter une date de 2026 comme celle de 2027, et un bandeau « 📅 Dates de la session 2026 » s'affiche sous une réponse qui cite une date précise. Le test vérifie aussi que `scripts/construire_index_kb.py` redonne exactement la base et son index.

`js/test_code_mort.js` vérifie que le **code jamais appelé** retiré de `documents.js` (anciens tableaux croisés, ancienne classification des colonnes, ancienne détection des exports : 193 lignes) ne revient pas, que les modules se chargent toujours ensemble, et qu'aucune fonction de `documents.js` ne reste sans appel.

`js/test_evolution_groupes.js` vérifie les **répartitions d'une mesure** et leur **évolution entre deux sessions**. « Nombre de places en BTS par académie » donne la somme des places de chaque académie (avant : le nombre de BTS, présenté comme des places) ; de même pour les candidats et les admis. « Évolution du nombre de BTS (ou des places) par académie depuis 2024 » et « les académies avec le plus de places : évolution » donnent, groupe par groupe, la valeur de chaque session, l'écart, l'évolution en %, les rangs et le total ; un groupe absent d'une session est signalé. Les formations ne peuvent pas être suivies une à une d'une année à l'autre, ni les tableaux croisés comparés : le widget le dit.

`js/test_options_pass.js` vérifie les **options des PASS**. Dans l'open data 2025, l'option d'un PASS n'est écrite que pour 70 PASS sur 287. Le widget ne donne donc pas de chiffre pour « combien de PASS option Biologie à Bordeaux » (avant : 0, affiché comme « calcul exact ») : il écrit « Option non précisée dans les données », combien de formations précisent l'option, combien n'en disent rien, et liste ces dernières par établissement avec la capacité de chacune. « Liste des PASS » est signalée **incomplète**, avec le même tableau ; quand des formations ont toutes le même intitulé (les 8 PASS de l'académie de Bordeaux), elles sont listées par établissement avec leur capacité. Quand toutes les formations du périmètre précisent leur option, le chiffre est donné normalement. Enfin, un 0 pour une commune qui porte aussi le nom d'une académie est complété : « aucune formation dans la commune de Bordeaux, mais 12 dans l'académie de Bordeaux » (les PASS de l'Université de Bordeaux sont à Talence). Corrigé au passage : « PASS » contient « pas », et « PASS dans l'académie de Bordeaux » était compris « hors académie de Bordeaux » (279 PASS au lieu de 8 sur les données réelles) ; cas ajouté au banc `test_reformulations.js`.

`js/test_sans_mode_national.js` vérifie le retrait du bouton **« National 2025 »**. Ce bouton changeait seulement le sous-titre : aucun calcul ne s'en servait, et un agent pouvait croire interroger la France entière en 2025 alors que le calcul portait sur la source choisie. La source se choisit désormais uniquement dans le sélecteur.

`js/test_retours.js` vérifie le bouton **« 👎 Réponse incorrecte »**, présent sous chaque réponse. L'agent peut préciser ce qui ne va pas, par exemple le chiffre attendu. Le widget note aussi automatiquement deux cas :
- les questions qu'il n'a pas comprises (« Critère non reconnu ») ;
- les réponses d'Albert dont des chiffres n'ont pas été vérifiés.

Le bouton **« 📝 À revoir »** de l'en-tête, avec un compteur, affiche la liste. On peut la **télécharger en CSV** (Excel), la copier en texte ou l'effacer.

**Tout reste dans le navigateur** : rien n'est écrit dans Grist, rien n'est envoyé ailleurs. Seuls la question, le commentaire et un résumé du résultat sont gardés (outil, chiffre, périmètre), jamais la réponse complète. La liste est limitée à 300 entrées. Les formules sont neutralisées dans le CSV.

Les questions exportées servent à enrichir `test_reformulations.js` et `test_fiches_metiers.js`.

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
| `scripts/construire_index_kb.py` | Reconstruit la base de connaissances et son index (`python3 scripts/construire_index_kb.py [fiches.json]`) ; relancé sur la base actuelle, il la redonne à l’identique |

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
