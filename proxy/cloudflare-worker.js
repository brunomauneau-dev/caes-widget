/* Proxy Albert API — version Cloudflare Workers (gratuite).
   Même rôle que server.js (Clever Cloud) : le navigateur ne peut pas appeler
   Albert API directement (CORS) ; ce proxy relaie /v1/* vers Albert en
   ajoutant la clé, et renvoie les en-têtes CORS.

   Réglages (Cloudflare → Worker → Settings → Variables and Secrets) :
   - ALBERT_API_KEY  (Secret, obligatoire) : clé Albert API
   - ALLOWED_ORIGIN  (optionnel) : origines autorisées, séparées par des
     virgules. Défaut : le widget sur GitHub Pages uniquement, pour que
     personne d'autre ne consomme votre quota Albert.
   - ALBERT_BASE_URL (optionnel) : défaut https://albert.api.etalab.gouv.fr
   Guide : proxy/README.md */

const DEFAULT_ORIGIN = 'https://brunomauneau-dev.github.io';
const DEFAULT_BASE = 'https://albert.api.etalab.gouv.fr';

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGIN || DEFAULT_ORIGIN).split(',').map(s => s.trim()).filter(Boolean);
  const allowOrigin = allowed.includes('*') ? '*' : (allowed.includes(origin) ? origin : allowed[0]);
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ status: 'ok', key: env.ALBERT_API_KEY ? 'configurée' : 'MANQUANTE' }, 200, cors);
    if (!url.pathname.startsWith('/v1/')) return json({ error: 'Chemin inconnu (attendu : /v1/...)' }, 404, cors);
    if (!env.ALBERT_API_KEY) return json({ error: 'ALBERT_API_KEY non configurée dans le Worker' }, 500, cors);

    try {
      const base = String(env.ALBERT_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
      const hasBody = !['GET', 'HEAD'].includes(request.method);
      const upstream = await fetch(base + url.pathname + url.search, {
        method: request.method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.ALBERT_API_KEY}` },
        body: hasBody ? await request.text() : undefined
      });
      return new Response(upstream.body, {
        status: upstream.status,
        headers: { ...cors, 'Content-Type': upstream.headers.get('content-type') || 'application/json' }
      });
    } catch (error) {
      return json({ error: 'Erreur du proxy vers Albert API', details: String(error && error.message || error) }, 502, cors);
    }
  }
};
