# Consignes pour Claude — caes-widget

L'utilisateur n'est pas développeur. Il faut lui expliquer simplement ce qui change, et le guider clic par clic pour les fusions GitHub et les réglages des services (Grist, Cloudflare).

## 1. Tests : obligatoires pour toute modification

**Chaque modification de code est livrée avec des tests.** Pas de commit sans test.

- **Nouvelle fonctionnalité :** un nouveau fichier `js/test_<sujet>.js`. Il vérifie le cas normal, les cas limites, les erreurs, et **les faux positifs** : ce qui ne doit *pas* se passer.
- **Correction de bug :** un test qui reproduit le bug, qui échoue avant la correction et passe après.
- **Changement de règle :** mettre à jour les tests de l'ancienne règle et expliquer pourquoi. Ne jamais supprimer ni contourner un test pour « passer au vert ».
- **Tester les modules chargés ensemble,** comme dans le widget (`config.js`, `knowledge.js`, `documents.js`, `planner.js` dans un même contexte `vm`). Un module testé seul peut cacher un bug. Exemple réel : `normalizeText` de `documents.js` remplaçait la normalisation de `planner.js` et perdait le « œ » de « vœux ».
- **Les tests ne font aucun appel réseau** : les API (open data, Albert, Cloudflare) sont simulées.
- **Lancer toute la suite avant chaque commit :** `npm test`. Elle s'arrête au premier fichier en échec, donc lancer aussi chaque fichier séparément pour voir tous les échecs. GitHub Actions (`tests.yml`) relance la suite à chaque push.
- **Interface modifiée :** vérifier aussi dans Chromium (Playwright). Simuler `window.grist` avec `addInitScript`, sinon `albert.js` s'arrête sur `grist.ready`. Simuler aussi les API avec `page.route`.
- **Fiches métiers :** toute évolution de la détection de colonnes, du planner ou du moteur doit garder `js/test_fiches_metiers.js` au vert. Quand une réponse fausse est signalée, ajouter la question et sa valeur attendue (recalculée sur les lignes) dans `tests/fixtures/fiches_metiers.mjs`. Données toujours fictives.
- **Ne jamais afficher un chiffre faux comme « calcul exact ».** Si l'information demandée n'existe pas dans la source, le moteur doit le dire (`missingConceptsForQuestion` dans `dataEngine.js`).
- **Mettre à jour le nombre de tests** dans le README (section « Suite de tests »).

Format d'un fichier de test : module ESM autonome, avec les fonctions `assert(cond, libellé)` et `describe(...)`. Il affiche `Résultat : N ✓  M ✗  (T tests)` et sort avec `process.exit(1)` en cas d'échec. Prendre modèle sur `js/test_source_selector.js`.

## 2. Règles du projet

1. **Cache-busting :** tout changement dans un `js/*.js` impose d'incrémenter son `?v=` dans `index.html`.
2. **Garde-fous DOM :** tout `document.getElementById()` est suivi d'un `if (!el) return;`.
3. **`defer`** sur tout `<script src>` dans `<head>`.
4. **Lecture seule :** ne jamais modifier la table Grist ni la base de données.
5. **Aucun secret dans le code.** Le repo est public. Les clés passent par les secrets GitHub et les variables Cloudflare.

## 3. À ne pas casser

- **Proxy Albert :** `proxy/cloudflare-worker.js` est en service sur `albert-proxy.bruno-mauneau.workers.dev`. `server.js` et `package.json` (avec `start` et `express`) servent à l'ancien proxy Clever Cloud : **ne pas les supprimer**.
- **Sources de données :** l'open data n-1 est la source au lancement. La table Grist et les fichiers Excel/CSV se choisissent dans le sélecteur (`getActiveSourceKind` / `setActiveSource`, dans `documents.js`). Le moteur et Albert doivent toujours passer par `getActiveQueryTables()`.
- **Historique Git :** le clone peut être superficiel (50 commits). Faire `git fetch --unshallow` avant d'affirmer qu'un fichier « n'a jamais existé ».
