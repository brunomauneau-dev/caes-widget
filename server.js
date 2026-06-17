import express from 'express';

const app = express();
app.use(express.json({ limit: '2mb' }));

// --- Configuration (à définir via les variables d'environnement Clever Cloud) ---
const ALBERT_BASE_URL = process.env.ALBERT_BASE_URL || 'https://albert.api.etalab.gouv.fr';
const ALBERT_API_KEY = process.env.ALBERT_API_KEY;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

if (!ALBERT_API_KEY) {
  console.warn(
    "⚠️  ALBERT_API_KEY n'est pas définie. Le proxy ne pourra pas s'authentifier auprès d'Albert API."
  );
}

// --- En-têtes CORS sur toutes les réponses, et réponse immédiate au preflight OPTIONS ---
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// --- Vérification rapide que le service tourne ---
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// --- Relais générique de tous les endpoints Albert API (ex: /v1/chat/completions, /v1/models, ...) ---
app.all('/v1/*', async (req, res) => {
  try {
    const targetUrl = `${ALBERT_BASE_URL}${req.originalUrl}`;

    const fetchOptions = {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ALBERT_API_KEY}`,
      },
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const albertResponse = await fetch(targetUrl, fetchOptions);
    const data = await albertResponse.text();

    res.status(albertResponse.status);
    res.set('Content-Type', albertResponse.headers.get('content-type') || 'application/json');
    res.send(data);
  } catch (error) {
    console.error('Erreur proxy Albert API :', error);
    res.status(502).json({ error: 'Erreur du proxy vers Albert API', details: error.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Proxy Albert API démarré sur le port ${PORT}`);
});
