// test_cloudflare_worker.js — Proxy Albert version Cloudflare Workers
// (proxy/cloudflare-worker.js). Albert API est simulé.
// node js/test_cloudflare_worker.js

import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const worker = (await import(pathToFileURL(path.join(__dirname, '..', 'proxy', 'cloudflare-worker.js')).href)).default;

let passed = 0, failed = 0;
function assert(condition, label) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}`); failed++; }
}

const WIDGET = 'https://brunomauneau-dev.github.io';
const W = 'https://albert-proxy.exemple.workers.dev';
const env = { ALBERT_API_KEY: 'cle-secrete' };
let upstream = null;
globalThis.fetch = async (url, opts) => {
  upstream = { url, opts };
  return new Response(JSON.stringify({ choices: [{ message: { content: 'Bonjour' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
};
const req = (p, init = {}) => new Request(W + p, { ...init, headers: { Origin: WIDGET, ...(init.headers || {}) } });

console.log('\nProxy Cloudflare Worker');
let r = await worker.fetch(req('/v1/chat/completions', { method: 'OPTIONS' }), env);
assert(r.status === 204, 'preflight OPTIONS → 204');
assert(r.headers.get('Access-Control-Allow-Origin') === WIDGET, 'CORS : origine du widget autorisée');

r = await worker.fetch(req('/health'), env);
assert(r.status === 200 && (await r.json()).status === 'ok', '/health → ok');

const body = JSON.stringify({ model: 'openweight-large', messages: [{ role: 'user', content: 'Salut' }] });
r = await worker.fetch(req('/v1/chat/completions', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } }), env);
assert(r.status === 200, 'POST /v1/chat/completions relayé (200)');
assert(upstream.url === 'https://albert.api.etalab.gouv.fr/v1/chat/completions', 'envoyé vers Albert API');
assert(upstream.opts.headers.Authorization === 'Bearer cle-secrete', 'clé ajoutée par le proxy (jamais dans le navigateur)');
assert(upstream.opts.body === body, 'corps de la requête transmis tel quel');
assert((await r.json()).choices[0].message.content === 'Bonjour', 'réponse d\'Albert renvoyée au widget');
assert(r.headers.get('Access-Control-Allow-Origin') === WIDGET, 'CORS présent sur la réponse');

r = await worker.fetch(new Request(W + '/v1/models', { headers: { Origin: 'https://site-inconnu.example' } }), env);
assert(r.headers.get('Access-Control-Allow-Origin') === WIDGET, 'autre site : non autorisé par CORS (quota protégé)');

r = await worker.fetch(req('/v1/chat/completions', { method: 'POST', body }), {});
assert(r.status === 500 && /ALBERT_API_KEY/.test((await r.json()).error), 'clé absente → message clair');

r = await worker.fetch(req('/autre'), env);
assert(r.status === 404, 'chemin hors /v1/ → 404');

globalThis.fetch = async () => { throw new Error('réseau coupé'); };
r = await worker.fetch(req('/v1/chat/completions', { method: 'POST', body }), env);
assert(r.status === 502, 'Albert injoignable → 502 avec détail');

console.log('\n' + '─'.repeat(50));
console.log(`Résultat : ${passed} ✓  ${failed} ✗  (${passed + failed} tests)`);
if (failed) process.exit(1);
