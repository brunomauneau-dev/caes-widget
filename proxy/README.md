# Mettre le proxy Albert sur Cloudflare (gratuit)

Le widget ne peut pas appeler Albert directement : le navigateur le bloque (règle « CORS »). Il passe donc par un petit relais, le **proxy**, qui ajoute votre clé Albert et transmet les questions.

Ce guide installe ce proxy chez **Cloudflare Workers**. C'est **gratuit**, avec 100 000 requêtes par jour, sans carte bancaire. Comptez environ 10 minutes.

---

## Avant de commencer

Il vous faut votre **clé Albert API**. Elle se trouve :
- soit dans Clever Cloud, application `caes-widget`, onglet **Environment variables**, ligne `ALBERT_API_KEY` ;
- soit sur votre espace Albert API, d'où vous pouvez en générer une nouvelle.

---

## Étape 1 : créer un compte Cloudflare

1. Allez sur https://dash.cloudflare.com/sign-up
2. Créez un compte avec votre adresse e-mail. Le plan **Free** suffit. Ne donnez aucune carte bancaire.
3. Confirmez votre adresse e-mail.

## Étape 2 : créer le Worker

1. Dans le menu de gauche, cliquez sur **Workers & Pages**. Selon la version, il peut s'appeler **Compute (Workers)**.
2. Cliquez sur **Create**, puis sur **Create Worker** (ou « Start with Hello World! »).
3. Nommez-le `albert-proxy`, puis cliquez sur **Deploy**.
4. Cliquez sur **Edit code**.
5. **Effacez tout** le code affiché à gauche.
6. Ouvrez le fichier [`cloudflare-worker.js`](cloudflare-worker.js) de ce dossier sur GitHub. Cliquez sur l'icône « Copy raw file » (deux carrés), puis collez dans Cloudflare.
7. Cliquez sur **Deploy** en haut à droite.

## Étape 3 : ajouter la clé Albert

1. Revenez sur la page du Worker `albert-proxy`, puis ouvrez **Settings** et **Variables and Secrets**.
2. Cliquez sur **Add** et remplissez :
   - Type : **Secret**
   - Variable name : `ALBERT_API_KEY`
   - Value : votre clé Albert
3. Cliquez sur **Deploy** ou **Save**.

## Étape 4 : vérifier

1. Sur la page du Worker, notez son adresse. Elle ressemble à `https://albert-proxy.VOTRE-NOM.workers.dev`.
2. Ouvrez cette adresse suivie de `/health` dans votre navigateur, par exemple `https://albert-proxy.VOTRE-NOM.workers.dev/health`.
3. Vous devez voir : `{"status":"ok","key":"configurée"}`
   - Si `key` vaut `MANQUANTE`, refaites l'étape 3.

## Étape 5 : brancher le widget

1. Dans le widget, cliquez sur ⚙️.
2. Dans **Endpoint**, mettez l'adresse du Worker suivie de `/v1/chat/completions`, par exemple `https://albert-proxy.VOTRE-NOM.workers.dev/v1/chat/completions`.
3. Enregistrez, puis posez une question.

Pour que tous les utilisateurs aient cette adresse par défaut, transmettez-la : elle sera inscrite dans `js/config.js`.

---

## Bon à savoir

- **Sécurité :** la clé Albert reste dans Cloudflare et n'est jamais envoyée au navigateur. Le proxy n'accepte que le widget publié sur `https://brunomauneau-dev.github.io`, ce qui empêche d'autres sites d'utiliser votre quota. Pour autoriser une autre adresse, ajoutez une variable `ALLOWED_ORIGIN` (adresses séparées par des virgules).
- **Mises à jour :** contrairement à Clever Cloud, Cloudflare ne se met pas à jour tout seul depuis GitHub. Le code du proxy change rarement. Si vous le modifiez, recollez-le dans Cloudflare comme à l'étape 2.
- **Ancien proxy :** `server.js` (à la racine du repo) est la version Clever Cloud. Il reste en place au cas où.
