/* Proxy da aba "Insights IA" da Análise de desenvolvimento.
   A página (GitHub Pages, pública) chama esta Lambda em vez de api.anthropic.com; a chave da API fica no
   Secrets Manager e nunca chega ao navegador. Travas: origem permitida, só POST /v1/messages, modelos
   permitidos, teto de max_tokens, sem ferramentas. A resposta (inclusive o streaming SSE) é repassada como veio. */
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const lista = v => (v || '').split(',').map(s => s.trim()).filter(Boolean);
const ORIGENS = lista(process.env.ALLOWED_ORIGINS);
const MODELOS = lista(process.env.ALLOWED_MODELS);
const MAX_TOKENS = Number(process.env.MAX_TOKENS) || 32000;
const SECRET_ID = process.env.SECRET_ID;
const TTL_CHAVE_MS = 5 * 60 * 1000;   // trocar a chave no Secrets Manager vale em até 5 min

const sm = new SecretsManagerClient({});
let chave = null, lidaEm = 0;
async function obterChave() {
  if (!chave || Date.now() - lidaEm > TTL_CHAVE_MS) {
    const s = (await sm.send(new GetSecretValueCommand({ SecretId: SECRET_ID }))).SecretString.trim();
    chave = s.startsWith('{') ? JSON.parse(s).ANTHROPIC_API_KEY : s;   // aceita texto puro ou {"ANTHROPIC_API_KEY": "..."}
    lidaEm = Date.now();
  }
  if (!/^sk-ant-/.test(chave || '')) throw new Error('segredo sem chave válida');
  return chave;
}

export const handler = awslambda.streamifyResponse(async (event, responseStream) => {
  const erro = (status, mensagem) => {
    const s = awslambda.HttpResponseStream.from(responseStream, { statusCode: status, headers: { 'content-type': 'application/json' } });
    s.write(JSON.stringify({ type: 'error', error: { type: 'proxy_error', message: mensagem } }));
    s.end();
  };
  const h = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const metodo = event.requestContext && event.requestContext.http && event.requestContext.http.method;
  if (!ORIGENS.includes(h.origin)) return erro(403, 'Origem não autorizada no proxy.');
  if (metodo !== 'POST' || event.rawPath !== '/v1/messages') return erro(404, 'Rota não disponível no proxy.');

  let corpo;
  try { corpo = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body); } catch (e) { return erro(400, 'Corpo da requisição inválido.'); }
  if (!corpo || !MODELOS.includes(corpo.model)) return erro(400, `Modelo não permitido no proxy: ${corpo && corpo.model}.`);
  if (!(corpo.max_tokens > 0 && corpo.max_tokens <= MAX_TOKENS)) return erro(400, `max_tokens fora do limite do proxy (1 a ${MAX_TOKENS}).`);
  if (corpo.tools || corpo.mcp_servers || corpo.container) return erro(400, 'Ferramentas não são permitidas no proxy.');

  let key;
  try { key = await obterChave(); } catch (e) { console.error('chave', e.message); return erro(500, 'Proxy sem chave da API configurada. Avise o responsável pela ferramenta.'); }

  const headers = { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': h['anthropic-version'] || '2023-06-01' };
  if (h['anthropic-beta']) headers['anthropic-beta'] = h['anthropic-beta'];
  let r;
  try { r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(corpo) }); }
  catch (e) { console.error('fetch', e.message); return erro(502, 'Falha ao contatar a API da Anthropic.'); }

  console.log(JSON.stringify({ model: corpo.model, status: r.status, stream: !!corpo.stream, max_tokens: corpo.max_tokens, request_id: r.headers.get('request-id') }));
  const out = awslambda.HttpResponseStream.from(responseStream, {
    statusCode: r.status,
    headers: { 'content-type': r.headers.get('content-type') || 'application/json', 'request-id': r.headers.get('request-id') || '' },
  });
  if (!r.body) { out.end(); return; }
  await pipeline(Readable.fromWeb(r.body), out);
});
