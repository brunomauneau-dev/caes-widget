# Parcoursup Data Copilot — Feuille de route

> Dernière mise à jour : session du 30/06 (réconciliation T4 + PR3.1 + titres clairs)

## Règles permanentes (valables pour toute la durée du projet)

- **Tests obligatoires.** Toute modification de code s'accompagne d'un test rejoué
  immédiatement (Node, fichier `js/*.test.js` ou `test_*.js`), avant livraison.
  Les anciens tests sont rejoués systématiquement après modification pour vérifier
  la non-régression, pas seulement les nouveaux tests écrits pour le patch en cours.
- **Cache-busting automatique.** Toute édition d'un fichier `js/*.js` chargé via
  `<script src="...">` dans `index.html` s'accompagne de l'incrément du `?v=` sur
  la même balise, dans le même patch, sans qu'on ait besoin de le demander.
- **Max 2 fichiers par patch.**
- Chaque PR de la roadmap doit être validée (code + tests unitaires + test Grist
  réel en navigateur) avant de passer à la suivante.

## État du repo au 30/06 (après réconciliation)

Deux lignées de travail menées en parallèle sur des sessions séparées ont été
réconciliées en une base unique cohérente :
- la lignée **PR1 → PR4.1** (roadmap v6, voir plus bas)
- la lignée **T2 / T4 / compositeur multi-blocs** (architecture infographie)

Suite de tests actuelle : **13 fichiers, 271 tests, tous verts.**
(`sessions.test.js`, `pr12.test.js`, `pr21.test.js`, `pr22.test.js`, `test_pr41.js`,
`pr31.test.js`, `test_t4.js`, `test_action_bar.js`, `test_clear_titles.js`,
`pr32.test.js`, `pr42.test.js`, `test_dom_guards.js`, `test_copilot_feel.js`)

⚠️ Point de vigilance pour la suite : `test_t4.js` et `test_action_bar.js` ont dû
être **recréés** lors de la réconciliation — les fichiers originaux écrits pendant
la session T4 n'avaient jamais été uploadés/committés. Toujours vérifier que les
fichiers de test créés en session sont bien inclus dans les exports/commits, pas
seulement les fichiers de code patché.

## Roadmap PR1 → PR5 (v6)

- **PR1 — Stabilité** ✓ validé (sessions.js quota/sanitize, albert.js null guards)
- **PR2 — Sémantique compare** ✓ validé
  - 2.1 follow-up "et pour les non-boursiers ?" hérite groupes + filtre de base
  - 2.2 badge de contexte + bouton reset
- **PR3 — Export/visu**
  - 3.1 ✓ validé — export pivot Excel : bug métadonnées filtre/date corrigé
    (`buildExportMeta` extraite et testée, 18 tests)
  - 3.2 ✓ validé (30/06) — graphique bar/pie depuis le pivot/résultat courant.
    Code déjà présent (`renderMiniBarChart`, `renderMiniPieChart`,
    `renderCurrentChartExecution`, `isPieChartRequest`) mais sans aucun test
    avant cette session — comblé par `pr32.test.js` (21 tests). Aucune
    modification du code de production, seulement ajout de couverture.
    **Limite produit identifiée, non corrigée** : `isPieChartRequest` ne
    reconnaît que les mots-clés "camembert / pie / donut / secteurs" pour
    basculer en camembert ; il n'existe pas de mot-clé symétrique pour
    redemander explicitement un graphique en barres après un camembert (le
    système conserve alors le dernier type utilisé). Pas corrigé faute de
    besoin réel constaté — à corriger si un agent rencontre concrètement
    ce blocage en usage ("refait en barres" ne marche pas).
- **PR4 — Qualité Albert + UX**
  - 4.1 ✓ validé — few-shot + anti-placeholder (44 tests)
  - 4.2 ✓ validé (30/06, corrigé le même jour suite à test réel en navigateur)
    — questions guidées par catégorie métier. Choix de conception, suite à
    discussion : pas de catégories codées en dur (jugées trop rigides — "les
    catégories sont nombreuses et peuvent changer selon les données qu'on
    traite"). À la place, les suggestions de questions sont **générées
    dynamiquement depuis le schéma réel de la table Grist connectée**, en
    réutilisant `columnKind()` du planner (exposée sur `window.plannerColumnKind`)
    plutôt que de dupliquer une logique de classification. Un gabarit de
    question par type de colonne (`SUGGESTION_TEMPLATES` dans albert.js),
    avec ordre de priorité d'affichage et limite à 6 chips. Fallback sur les
    5 suggestions statiques génériques (`SUGGESTIONS`, config.js) si aucune
    colonne métier n'est reconnue. Remplace les chips existantes au même
    emplacement. Régénérées à chaque arrivée de nouvelles données Grist
    (`grist.onRecords`).

    **Deux bugs réels trouvés en test navigateur (premier déploiement),
    corrigés le jour même :**
    1. `Uncaught TypeError: can't access property "innerHTML", wrap is null`
       — `renderSuggestions()` plantait quand appelée sur une session qui a
       déjà des messages : `#suggestions` ne vit que dans le bloc empty-state
       (voir `sessions.js` → `renderActiveSession`), qui n'est reconstruit
       dans le DOM que pour une session vide. Corrigé par un garde-fou
       `if (!wrap) return`.
    2. Suggestions systématiquement en fallback statique sur une vraie table
       (35 287 lignes) — diagnostiqué via logs temporaires : les colonnes de
       `gristRecords` étaient exposées comme "A", "B", "C"... (cas Grist
       alimenté par import Excel, où les vrais intitulés vivent dans la
       première ligne de données plutôt que dans les clés). `dataEngine.js`
       gère déjà ce cas via `buildGristQueryTable()` (`documents.js`), mais
       `buildDynamicSuggestions` lisait `gristRecords` brut sans passer par
       cette reconstruction. Corrigé en réutilisant `buildGristQueryTable()`,
       cohérent avec le chemin déjà emprunté par le Data Engine pour ses
       propres réponses.

    Tests : `pr42.test.js` (19 tests, incluant un cas dédié à chaque bug
    pour éviter la régression).
  - ~~4.3 dashboards prédéfinis~~ — **retiré de la roadmap (30/06)**. Aucune
    trace de l'intention d'origine retrouvée, et pas d'utilité franche
    identifiée pour l'utilisateur en discussion : PR4.2 (suggestions
    dynamiques) couvre déjà le besoin "je ne sais pas par où commencer", et le
    compositeur multi-blocs permet déjà d'assembler plusieurs analyses a
    posteriori. Un "dashboard" séparé aurait ajouté une troisième façon
    d'obtenir une vue d'ensemble, potentiellement redondante. Décision : ne
    pas développer, à reconsidérer seulement si un besoin concret réapparaît
    clairement en usage réel.
- **PR5 — Architecture**
  - 5.1 intent detection LLM — non démarré, pas de besoin réel identifié à ce
    jour (à creuser si besoin)
  - 5.2 connexion SAP PostgreSQL — **bloqué, pas par manque de code mais par
    accès** (30/06) : pas d'accès à l'API SAP BusinessObjects actuellement.
    Le workflow existant (export SAP BO manuel → import Grist) reste donc la
    voie utilisée. À reprendre seulement si l'accès API devient disponible
    côté SAIO/rectorat — pas de développement à l'aveugle sans pouvoir tester
    contre un vrai accès.

## Chantier T2/T4 — Architecture infographie (clos)

- **T2** ✓ validé — bugs barres plates + footer parasite (infographic.js)
- **T4** ✓ validé — contamination de contexte entre questions de périmètres
  différents (`_isExecCompatibleWithQuestion` dans albert.js)
- **Compositeur multi-blocs** ✓ fonctionnel, implémentation unique dans
  `sessions.js` (le doublon mort dans `infographic.js` a été retiré)
- **Séparation bouton local / bouton global** ✓ fait :
  - bouton "🖼 Infographie" sous chaque résultat → génère directement sur ce
    bloc précis (pas de mélange avec d'autres questions)
  - bouton "🖼 Composer une infographie" en haut de l'interface → ouvre le
    compositeur multi-blocs sur tout l'historique de la session

## Chantier lisibilité des titres de bloc (clos, 30/06)

**Contexte.** Constat de terrain : le contexte/filtre persistant entre questions
(ex. filtre "Pays Basque" actif, puis question "compare les boursiers et les
non-boursiers" qui en hérite silencieusement) n'était pas un bug en soi
(comportement voulu pour enchaîner des questions sur un même périmètre), mais
posait un vrai risque pour un agent SAIO sous consigne hiérarchique : transmettre
un chiffre filtré en le présentant comme une donnée globale, faute d'avoir
remarqué la ligne de filtre.

**Décision retenue : titre clair systématique, pas de bandeau avant calcul.**
Le titre de chaque bloc (dans le chat ET dans le compositeur) combine maintenant
systématiquement *type d'analyse + colonne/dimension + périmètre actif*, via une
seule fonction (`extractBlockTitle` dans `sessions.js`), réutilisée aux deux
endroits pour éviter toute divergence de format.

- Bug corrigé : `extractBlockTitle` perdait le périmètre actif pour les
  comparaisons (`tool === 'compare'`) — le `fPart` (résumé des filtres) n'était
  ajouté que dans la branche fallback, jamais quand `compareGroups` était
  renseigné. Exemple concret : "Comparaison : Boursiers vs Non-boursiers"
  perdait la mention "Pays Basque" même quand ce filtre était actif.
- Titres jargon remplacés dans `dataEngine.js` ("Répartition calculée
  localement", "Comparaison calculée localement", "Top calculé localement") par
  le même titre clair que dans le compositeur.
- Les sections `<details>` "Plan Data Engine" (outil, version, colonnes
  détectées — jargon d'implémentation) sont repliées par défaut au lieu de
  s'afficher ouvertes systématiquement.
- Test dédié : `test_clear_titles.js` (8 tests), verrouille notamment la
  non-régression sur le bug `compare` corrigé.

**Option étudiée et explicitement reportée : bandeau d'avertissement avant
calcul.** Idée : afficher un avertissement explicite ("Cette réponse va être
calculée sur le périmètre déjà filtré : X — clique sur Reset pour repartir de
l'ensemble") *avant* de lancer le calcul, pas seulement dans le titre du
résultat. Jugé plus protecteur mais plus intrusif (friction à chaque question,
y compris quand l'héritage du filtre est volontaire). Décision : ne pas
l'implémenter maintenant, le titre clair couvre le risque principal à coût
d'usage nul. À reconsidérer seulement si un usage réel montre que des agents
continuent de transmettre des chiffres mal cadrés malgré le titre clair, ou
s'il y a un incident concret qui justifie ce niveau de friction.

## Idée non développée : détection de "questions à sonorité globale"

Évoquée en discussion (30/06), pas implémentée. Idée : détecter automatiquement
les questions qui sonnent comme une demande de vue d'ensemble (aucun terme du
filtre actif mentionné) et forcer une confirmation explicite plutôt qu'un
héritage silencieux du filtre — sur le même principe que PR2.1 qui distingue
déjà "et pour les non-boursiers ?" (filtre, hérite) d'une vraie nouvelle paire.
Jugée plus structurante mais plus risquée (faux positifs possibles sur la
détection). Pas de décision de priorisation prise.

## Chantier "vrai copilot" — confiance et prise en main (clos, 30/06)

**Contexte.** Discussion sur l'amélioration de l'outil pour des personnels
peu familiers de la manipulation de données. Objectif explicite formulé par
l'utilisateur : "donner l'impression d'un vrai copilot / assistant
conversationnel adapté au métier", pas juste ajouter une fonctionnalité
d'aide isolée. Quatre axes retenus et implémentés :

**1. Message de chargement contextuel.** Avant : texte fixe "Albert analyse
les documents…" même quand la question portait sur la table Grist (pas des
documents), ce qui pouvait semer le doute. Après : `buildLoadingLabel()`
détecte le type de question (infographie / export / calcul Data Engine /
générique) et adapte le message en conséquence ("Calcul sur les données
Grist…", "Composition de l'infographie…", "Préparation de l'export…").

**2. Badge "✓ Calcul exact".** Avant : aucune distinction visuelle entre une
réponse calculée directement sur les lignes brutes (Data Engine, garantie
exacte) et une réponse Albert générique (interprétation IA, moins garantie).
Après : badge vert discret ajouté systématiquement sur le titre de toute
réponse Data Engine, via une fonction commune `deTitleHtml()` réutilisée par
les 5 branches de `renderDataEngineResultHtml` (count_rows, group_by/top,
pivot, stats, compare). Au passage, les deux derniers titres jargon
("Tableau croisé calculé localement", "Statistiques calculées localement")
ont été corrigés vers des titres clairs, oubliés lors du chantier titres
clairs précédent.

**3. Tooltips sur les boutons techniques.** Sessions, Sources, Composer une
infographie, Reset, paramètres (⚙️) ainsi que la section repliée "Plan Data
Engine" ont maintenant un attribut `title` natif HTML expliquant en une
phrase, en langage métier, ce que fait le bouton — pour réduire l'hésitation
à cliquer par peur de "casser quelque chose".

**4. Bandeau d'exemples permanent (mini-suggestions).** Avant : les
suggestions de questions (PR4.2) ne sont visibles que sur l'écran vide,
disparaissent dès la première question posée. Après : un second bandeau
compact (`#mini-suggestions`, 3 exemples, style discret) reste affiché en
permanence sous la zone de saisie, réutilisant `buildDynamicSuggestions()`
sans dupliquer sa logique — un utilisateur hésitant peut toujours voir
comment formuler une question, même en pleine conversation.

Test dédié : `test_copilot_feel.js` (28 tests) couvrant les 4 axes.

## Chantier garde-fous DOM — accès Grist non confirmé (clos, 30/06)

**Cause racine identifiée.** Quand le widget est rechargé, Grist affiche une
demande de confirmation d'accès en lecture à la table ("Le widget a besoin de
read la table actuelle" — boutons Accepter/Refuser). Le script JS s'exécute
déjà à ce moment-là, mais tant que l'utilisateur n'a pas cliqué "Accepter",
`gristRecords` est vide et certaines parties du DOM applicatif ne sont pas
encore dans l'état attendu. Plusieurs fonctions du widget accédaient à des
éléments DOM sans vérifier leur existence, provoquant des `TypeError`
("... is null") visibles en console à chaque rechargement avant acceptation.

**Trouvé et corrigé (suite à logs navigateur réels, 30/06) :**
- `renderSuggestions` (`albert.js`) — `#suggestions` n'existe que dans
  l'empty-state, absent du DOM si la session restaurée a déjà des messages
- `updateChatSub` (`albert.js`) — `#chat-sub` non protégé
- auto-resize du textarea `#chat-input` (`albert.js`, code top-level) — non
  protégé, plantait dès le chargement du script si le DOM n'était pas encore
  monté
- `addMessage` (`albert.js`) et `addInfographicMessage` (`infographic.js`) —
  `#chat-messages` non protégé (pas encore observé en crash réel à ce point,
  mais même fragilité structurelle — corrigé par précaution)

Toutes ces fonctions ont maintenant un garde-fou `if (!el) return`. Pas de
changement de comportement pour l'utilisateur une fois l'accès accepté —
uniquement suppression d'erreurs silencieuses (mais bruyantes en console)
pendant la fenêtre d'attente de confirmation.

Test dédié : `test_dom_guards.js` (9 tests) — vérifie statiquement la présence
des garde-fous dans le code source et, pour `updateChatSub`, le comportement
réel sans crash.

**Point de vigilance pour la suite** : si de nouvelles fonctions DOM sont
ajoutées au chemin `grist.ready()` → premier rendu, vérifier systématiquement
qu'elles ont un garde-fou avant tout accès `document.getElementById(...)`,
plutôt que de découvrir le crash en usage réel comme cette fois-ci.

