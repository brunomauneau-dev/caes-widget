# Proxy CORS — Albert API ↔ widget Grist

Petit serveur Node.js/Express qui se place entre votre widget Grist (hébergé sur GitHub Pages) et Albert API. Il reçoit les requêtes du navigateur, les retransmet côté serveur (où CORS ne s'applique pas) avec la clé API, puis renvoie la réponse avec les en-têtes CORS qui manquent.

La clé API Albert reste uniquement dans les variables d'environnement du serveur — elle ne transite jamais par le navigateur ni par le code du widget.

## 1. Déployer sur Clever Cloud

1. Créez un compte sur [console.clever-cloud.com](https://console.clever-cloud.com) si ce n'est pas déjà fait.
2. Cliquez sur **Créer** → **Une application**.
3. Choisissez le type d'application **Node.js**.
4. Sélectionnez une région **Paris (PAR)** pour rester sur une infrastructure française.
5. Pour le déploiement, deux options :
   - **Via GitHub** : connectez votre compte GitHub et pointez vers un dépôt contenant ces fichiers (`server.js`, `package.json`). Clever Cloud redéploiera automatiquement à chaque push.
   - **Via Git directement** : installez [clever-tools](https://github.com/CleverCloud/clever-tools), puis depuis le dossier `albert-proxy` :
     ```
     clever login
     clever create albert-proxy --type node
     clever deploy
     ```
6. Une fois l'application créée, allez dans l'onglet **Variables d'environnement** et ajoutez :
   - `ALBERT_API_KEY` → votre clé API Albert
   - `ALLOWED_ORIGIN` → l'URL exacte de votre widget GitHub Pages (ex: `https://votre-compte.github.io`), pour ne pas ouvrir le proxy à n'importe quel site
   - `ALBERT_BASE_URL` → laissez la valeur par défaut sauf si Albert API change d'URL
7. Déployez (ou repoussez sur la branche connectée). Clever Cloud vous donnera une URL du type `https://albert-proxy-xxxx.cleverapps.io`.
8. Vérifiez que ça fonctionne en ouvrant `https://votre-url.cleverapps.io/health` : vous devez voir `{"status":"ok"}`.

## 2. Adapter le widget

Dans le code JavaScript du widget, remplacez l'appel direct à Albert API par un appel à votre proxy, en retirant l'en-tête `Authorization` (c'est désormais le proxy qui l'ajoute) :

```js
// Avant (bloqué par CORS)
fetch('https://albert.api.etalab.gouv.fr/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer VOTRE_CLE_API'
  },
  body: JSON.stringify(payload)
});

// Après (passe par le proxy)
fetch('https://albert-proxy-xxxx.cleverapps.io/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(payload)
});
```

Le proxy relaie aussi tout autre endpoint Albert commençant par `/v1/` (ex: `/v1/models`), pas seulement `/v1/chat/completions`.

## 3. Sécurité

- Ne mettez jamais la clé API Albert dans le code du widget ou dans un dépôt public : elle ne doit exister que dans les variables d'environnement Clever Cloud.
- Renseignez `ALLOWED_ORIGIN` avec l'URL précise de votre widget plutôt que `*`, pour éviter que d'autres sites n'utilisent votre proxy (et donc votre quota/clé) à votre place.
- Le palier gratuit de Clever Cloud suffit largement pour un usage ponctuel de ce type ; surveillez simplement la consommation si l'usage venait à grandir.
