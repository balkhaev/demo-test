import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, extname } from 'node:path';
import { evaluateBrief, getDemoBrief } from '../domain/brief-service.js';
import { DomainInputError } from '../domain/validation.js';
import { getLogicGuide } from './logic-guide.js';
import { SOURCE_FILES, readSource } from './source-files.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MAX_BODY_BYTES = 64 * 1024;
const STATIC_FILES = new Set(['index.html', 'styles.css', 'app.js', 'logic-guide.js', 'logic-view.js', 'highlight.js']);
const CONTENT_TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    ...headers,
  });
  response.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
    throw new HttpError(415, 'JSON_REQUIRED', 'Передайте тело запроса в формате application/json.');
  }
  const contentLength = Number(request.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    request.resume();
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Размер запроса превышает 64 КБ.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      request.resume();
      throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Размер запроса превышает 64 КБ.');
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Не удалось прочитать JSON. Проверьте формат запроса.');
  }
}

async function route(request, response) {
  const url = new URL(request.url, 'http://localhost');
  const path = url.pathname;

  if (request.method === 'GET' && path === '/api/health') {
    send(response, 200, { status: 'ok' });
    return;
  }
  if (request.method === 'GET' && path === '/api/demo') {
    send(response, 200, getDemoBrief());
    return;
  }
  if (request.method === 'GET' && path === '/api/logic') {
    send(response, 200, await getLogicGuide());
    return;
  }
  if (request.method === 'POST' && path === '/api/evaluate') {
    const input = await readJson(request);
    send(response, 200, evaluateBrief(input));
    return;
  }
  if (request.method === 'GET' && path.startsWith('/api/source/')) {
    const key = path.slice('/api/source/'.length);
    if (!Object.hasOwn(SOURCE_FILES, key)) throw new HttpError(404, 'SOURCE_NOT_FOUND', 'Этот исходный файл не опубликован.');
    send(response, 200, await readSource(key));
    return;
  }
  if (path.startsWith('/api/')) {
    if (['/api/evaluate', '/api/demo', '/api/health', '/api/logic'].includes(path)) {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Этот HTTP-метод не поддерживается для данного адреса.');
    }
    throw new HttpError(404, 'NOT_FOUND', 'API-метод не найден.');
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Для страницы разрешены только GET и HEAD.');
  }
  const file = path === '/' ? 'index.html' : path.slice(1);
  if (!STATIC_FILES.has(file)) throw new HttpError(404, 'NOT_FOUND', 'Страница или файл не найдены.');
  const content = await readFile(resolve(ROOT, 'dist', file));
  send(response, 200, request.method === 'HEAD' ? '' : content, {
    'Content-Type': CONTENT_TYPES[extname(file)],
    'Content-Length': content.length,
    'Cache-Control': file === 'index.html' ? 'no-store' : url.searchParams.has('v') ? 'public, max-age=3600' : 'no-cache',
  });
}

/**
 * One stateless HTTP boundary. Every visitor submits their own fictional snapshot.
 * The server never changes shared sample data and never writes to external systems.
 */
export function createApp() {
  const server = createServer((request, response) => {
    void route(request, response).catch(error => {
      if (response.headersSent || response.destroyed) return;
      if (error instanceof DomainInputError) {
        send(response, 422, { error: { code: error.code, message: error.message, fields: [{ path: error.path, message: error.message }] } });
        return;
      }
      if (error instanceof HttpError) {
        send(response, error.status, { error: { code: error.code, message: error.message } });
        return;
      }
      console.error('Request failed:', error instanceof Error ? error.message : 'Unknown error');
      send(response, 500, { error: { code: 'INTERNAL_ERROR', message: 'Не удалось выполнить расчёт. Попробуйте ещё раз.' } });
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.PORT ?? 80);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535');
  const server = createApp();
  server.listen(port, process.env.HOST ?? '0.0.0.0', () => console.info('Support demo is listening on port ' + port));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
