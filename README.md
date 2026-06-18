Patch planner v2.3

Remplacer dans GitHub :
- index.html (pour forcer le navigateur à recharger planner.js via ?v=23)
- js/planner.js

Pourquoi index.html aussi : GitHub Pages / le navigateur peuvent garder l'ancien planner.js en cache. La capture montrait encore v2.1, donc le nouveau fichier n'était probablement pas chargé.
