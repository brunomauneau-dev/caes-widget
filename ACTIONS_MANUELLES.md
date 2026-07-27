# Actions manuelles à appliquer sur GitHub

> Toutes les modifications ci-dessous sont à faire directement sur le repo
> https://github.com/brunomauneau-dev/caes-widget
> via l'éditeur en ligne GitHub ou un `git push` local.

---

## 1. Copier les fichiers produits par ce ménage

Les fichiers suivants ont été nettoyés/réécrits et sont à écraser sur le repo :

| Fichier local (outputs/) | → Fichier GitHub |
|--------------------------|------------------|
| `README.md` | `README.md` |
| `ROADMAP.md` | `ROADMAP.md` |
| `config.js` | `js/config.js` |
| `knowledge.js` | `js/knowledge.js` |

---

## 2. Bumper 2 versions dans `index.html`

Ouvrir `index.html` dans l'éditeur GitHub et faire ces 2 remplacements :

```
js/planner.js?v=27.5.7   →   js/planner.js?v=27.5.8
js/knowledge.js?v=27.5.6  →   js/knowledge.js?v=27.5.7
```

Lignes concernées (dans `<head>`) :
```html
<!-- AVANT -->
<script src="js/planner.js?v=27.5.7" defer></script>
<script src="js/knowledge.js?v=27.5.6" defer></script>

<!-- APRÈS -->
<script src="js/planner.js?v=27.5.8" defer></script>
<script src="js/knowledge.js?v=27.5.7" defer></script>
```

---

## 3. Supprimer le fichier prototype obsolète

**Fichier à supprimer :**
```
doc_analyzer_albert_parcoursup_cascade_flexible_v15_hybrid.html
```
C'est un ancien prototype standalone, remplacé par le widget modulaire actuel.

Sur GitHub : ouvrir le fichier → bouton `...` (3 points) → **Delete file** → Commit.

---

## 4. Déplacer le script Python

**Déplacer :**
```
build_parcoursup_kb_v3.py   →   scripts/build_parcoursup_kb_v3.py
```

Il s'agit d'un outil de build, pas d'un fichier déployé — sa place est dans `scripts/`.

Sur GitHub : impossible de déplacer directement via l'UI. Options :
- En local : `git mv build_parcoursup_kb_v3.py scripts/` puis `git commit && git push`
- Ou : copier le contenu dans `scripts/build_parcoursup_kb_v3.py` (new file) puis supprimer l'original.

---

## 5. Décision sur `parcoursup_roue.html`

Ce fichier est un quiz standalone "La Roue Parcoursup" (6 questions, roue animée).
Il est indépendant du widget copilot.

**Options :**

| Option | Action |
|--------|--------|
| Garder à la racine | Ne rien faire — il est accessible via GitHub Pages |
| Déplacer dans un sous-dossier | Créer `tools/parcoursup_roue.html` et supprimer l'original |
| Supprimer | Fichier trop ancré dans le repo pour l'effacer sans décision explicite |

**Recommandation** : le déplacer dans `tools/` pour garder la racine propre, ou le garder à la racine s'il est partagé tel quel via son URL GitHub Pages.

---

## Résumé des fichiers du repo après ménage

```
caes-widget/
├── index.html                          ← widget principal (2 versions bumper)
├── README.md                           ← réécrit ✅
├── ROADMAP.md                          ← archivé/simplifié ✅
├── package.json                        ← inchangé
├── parcoursup-kb-v2.json               ← inchangé (déployé)
├── parcoursup-kb-index-v2.json         ← inchangé (déployé)
├── parcoursup-opendata-reference-v1.json ← inchangé (déployé)
├── parcoursup_roue.html                ← à décider (cf. §5)
├── js/
│   ├── config.js                       ← nettoyé ✅
│   ├── knowledge.js                    ← nettoyé ✅
│   ├── planner.js                      ← inchangé
│   ├── dataEngine.js                   ← inchangé
│   ├── documents.js                    ← inchangé
│   ├── infographic.js                  ← inchangé
│   ├── sessions.js                     ← inchangé
│   ├── albert.js                       ← inchangé
│   └── test_*.js / *.test.js          ← 16 fichiers de tests
├── css/                                ← inchangé
├── knowledge/                          ← sources KB (inchangé)
└── scripts/
    └── build_parcoursup_kb_v3.py      ← à déplacer depuis la racine (cf. §4)

SUPPRIMÉ :
└── doc_analyzer_albert_parcoursup_cascade_flexible_v15_hybrid.html  ← cf. §3
```
