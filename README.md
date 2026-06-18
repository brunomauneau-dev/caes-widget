# CAES / Parcoursup Data Copilot — v16 modularisée

Cette version découpe le widget monolithique en fichiers maintenables.

## Déploiement GitHub Pages

Place ces fichiers à la racine du dépôt `caes-widget` :

- `index.html`
- `css/style.css`
- `js/app.js`
- `js/dataEngine.js`
- `parcoursup-kb-v2.json`
- `parcoursup-kb-index-v2.json`
- `parcoursup-opendata-reference-v1.json`

Ensuite, dans Grist, pointe le widget vers :

`https://brunomauneau-dev.github.io/caes-widget/`

## Ce qui change

- `js/dataEngine.js` contient le moteur local : `count_rows`, `group_by`, `export_excel`, `export_csv`.
- `js/app.js` garde la logique Grist, documents, Albert, base de connaissances et UI.
- `css/style.css` contient les styles de l'interface.

## Test rapide

Dans le widget connecté à une table Grist, essayer :

- `combien de candidats basques de bac général ?`
- `répartition des candidats basques par série de bac`
- `exporte les candidats basques en Excel`

Le résultat doit être calculé localement sur les lignes brutes, pas inventé par Albert.
