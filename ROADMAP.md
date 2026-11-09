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
| OD  | Sans table : open data Parcoursup France entière, session la plus récente détectée automatiquement, en-têtes lisibles, Albert prévenu qu'une ligne = une formation. Clé API Grist retirée du script de chargement | ✅ |
| SRC | Sélecteur de source toujours visible : open data n-1 au lancement, table Grist sur choix, import Excel/CSV (bouton ou glisser-déposer, onglets, en-têtes sous titres). Réintroduit l'import de fichier retiré le 01/07 | ✅ |
| PN  | Données nationales Parcoursup n-1 → Grist : GitHub Actions (`load-parcoursup.yml`) + script Python (`scripts/load_parcoursup_to_grist.py`) + table `Parcoursup_National` (631 lignes, académie Bordeaux, session 2025) + intégration `knowledge.js` (`loadParcoursupNational`, `buildNationalDataContext`) | ✅ |
| FT  | Intitulés de formation cités dans la question : « PASS », « option Droit »… deviennent un filtre même sans le mot « filière » ; « liste / toutes les filières / options » affiche les intitulés distincts au lieu d'un export ; terme introuvable → « Formation non trouvée » avec les intitulés proches, au lieu de compter tout le fichier ; open data compté en formations, pas en candidats (`test_formation_terms.js`) | ✅ |
| ROB | Robustesse fichiers Excel et open data : filtres conservés pour les colonnes abrégées (BOURS…) ; statut public/privé, sélectivité, région, « à <ville> » ; académie d'origine vs d'accueil ; ligne « Total » et onglet « Notice » ignorés ; états Oui/Non, 1/0, VRAI/FAUX ; une colonne chiffrée n'est jamais un filtre d'état ; moyennes sur la bonne colonne (jamais un numéro ni la session) ; sommes sur l'open data (places, candidats, admis) ; garde-fou « Critère non reconnu » au lieu du total du fichier (`test_robustesse_fichiers.js`, faux fichiers `js/fixtures/`) | ✅ |
| ALB-CHF | Chiffres d'Albert vérifiés : consigne « aucun chiffre hors contexte, aucun calcul » ; chaque nombre de sa réponse est comparé aux données fournies (contexte, résultats calculés, question) ; un chiffre inconnu est signalé (bandeau « Chiffres non calculés par le widget » + surlignage) et la réponse n'alimente pas les infographies (`test_chiffres_albert.js`) | ✅ |
| PERIM | Périmètre en clair sous chaque résultat (« Sur quoi porte ce calcul » : lignes retenues / total, source, filtres, filtres repris de la question précédente, « À noter » pour les cases vides et valeurs non affichées), transmis à Albert. Bugs corrigés au passage : relance « et pour l'académie de Bordeaux ? » qui perdait Bordeaux ; « et pour les BTS ? » après les PASS qui recomptait les PASS ; « et par académie ? » non reconnu ; « par région / sélectivité / filière / statut » sur la mauvaise colonne ; « par couleur » réparti au hasard (arrêt désormais) ; case vide comptée 0 dans les moyennes (`test_perimetre.js`) | ✅ |
| REFORM | Reformulations : 31 questions types × 3 à 16 tournures, bonne réponse calculée sur les données (`test_reformulations.js`) ; couche `reformulerQuestion` (nb de, négations, « dans chaque », prépas, bacheliers généraux, « commune de ») ; 12 chiffres faux en silence corrigés (« sur la commune de Bordeaux » comptait l'académie, « qui ne sont pas boursiers », « candidates », « bacheliers généraux » comptaient tout le fichier, « non sélectives » donnait 17 au lieu de 3 196 sur l'open data réel…) ; contrôle « même chiffre pour toutes les tournures » dans l'essai sur données réelles | ✅ |
| REFORM-2 | Questions réelles des agents à ajouter aux reformulations dès qu'elles sont collectées | ⏳ |
| OFFICIEL | Chiffres officiels : l'essai fait calculer ~20 chiffres par l'API du ministère (count, sum, avg, group_by) et exige l'égalité à l'unité avec le widget ; API indisponible → « non vérifié ». Bug corrigé : mesure absente des données (« combien d'admis » sans colonne admis) → arrêt au lieu du nombre de formations | ✅ |
| METIERS | Fiches métiers reprises de la branche `friendly-brahmagupta` (PR 8, non fusionnée : conflits avec la conception actuelle) : 5 fichiers fictifs SAIO / proviseur / CIO / BTS / chargé d'études, 131 tests ; statut de candidature en clair reconnu ; « combien de refusés » (150 → 48), « liste d'attente » (export → 59), « non admis » (admis → 107) ; information absente → « critère non reconnu » | ✅ |
| HEBDO | Essai sur données réelles lancé automatiquement chaque lundi ; ticket GitHub d'alerte (contrôle en échec, écart officiel, réponse changée, nouvelle session) ; option « tester l'alerte » | ✅ |
| CLASSEMENT | Classer selon un chiffre : formations (ou académies, régions, communes, établissements) les plus demandées / sélectives / avec le plus de places, d'admis, de boursiers ; somme par groupe, jamais de taux additionné ; sans valeur écartées, ex æquo signalés ; export, graphique, relance « et à Bordeaux ? » ; 3 classements vérifiés contre le tri du serveur du ministère. Corrigé au passage : relances « et à / en / dans … » non reconnues ; en-têtes des tableaux croisés illisibles (bleu vif) | ✅ |
| CHIFFRES-COND | Conditions chiffrées (plus de / moins de / au moins / au plus N places, candidats, admis ; taux d'accès inférieur / supérieur / égal à N) ; condition non comprise → arrêt (avant : ignorée, toutes les lignes comptées, ex. « BTS avec un taux d'accès de 0 » → 5 351) ; « les plus sélectifs » écarte les taux de 0 (aucune proposition Parcoursup) | ✅ |
| PARTS | Taux et parts calculés par le widget : effectifs (somme ÷ somme, définitions du ministère : boursiers parmi les admis néo-bacheliers ; filles admises, candidates, néo-bacheliers, bacheliers généraux, même académie, remplissage, proposition, admission) et lignes (fichiers de candidats, part de formations) ; arrêt si colonne absente ; « pourcentage moyen » prend la colonne des % ; « pourcentage de filles parmi les boursiers » ne donne plus une répartition par série ; 4 parts vérifiées contre le serveur du ministère | ✅ |

---

## Prochaines pistes (non planifiées)

- Mise à jour KB vers v3 (`build_parcoursup_kb_v3.py` prêt dans `scripts/`)
- Export PDF multi-blocs
- Bouton « National 2025 » : utiliser la session détectée au lieu de 2025 en dur
- Nettoyer le code mort de `documents.js` (`PARCOURSUP_ONTOLOGY_RULES`, `classifyParcoursupColumn`, jamais appelés)
- **Options des PASS (et autres filières à intitulé identique)** — constat du 06/11/2026 sur l'open data 2025 : l'option n'est précisée que pour 70 PASS sur 287 (colonne « très détaillée », qui mélange options et lieux) ; plusieurs PASS d'un même établissement ont exactement le même intitulé (ex. Université de Bordeaux, Talence : capacités 165 et 270). Pistes :
  1. **Rapprocher par la capacité** : relever l'option et la capacité sur la fiche de chaque formation dans Parcoursup (site indisponible le 06/11, à refaire), puis faire correspondre avec la capacité de l'open data (même établissement + même capacité) ;
  2. **Dans le widget** : quand les options ne sont pas distinguées, l'écrire (« option précisée pour 70 PASS sur 287 ») et lister les PASS par établissement et capacité, avec le lien vers la fiche Parcoursup si l'open data le fournit (champ à vérifier) ;
  3. **Autre source** : vérifier si la « cartographie des formations Parcoursup » du ministère donne l'option (diagnostic ponctuel dans l'essai sur données réelles).
