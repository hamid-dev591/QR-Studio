#!/usr/bin/env node
/**
 * Minimal zero-dependency static server for QR Studio.
 *
 * Usage:
 *   node tools/dev-server.mjs
 *   PORT=8080 node tools/dev-server.mjs
 *
 * ES modules, fetch() for locales and service workers all require an HTTP
 * origin, so opening index.html with file:// does not work. This server keeps
 * the app self-contained: it only serves files from this repository.
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4173);

const MIME = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}));

function resolveRequestPath(requestUrl) {
  const url = new URL(requestUrl, `http://${HOST}:${PORT}`);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  const target = path.resolve(ROOT, `.${pathname}`);
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) return null;
  return target;
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    send(response, 405, 'Method Not Allowed', { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }

  const target = resolveRequestPath(request.url || '/');
  if (!target) {
    send(response, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }

  let info;
  try {
    info = await stat(target);
  } catch {
    send(response, 404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }

  const file = info.isDirectory() ? path.join(target, 'index.html') : target;
  try {
    info = await stat(file);
  } catch {
    send(response, 404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }
  if (!info.isFile()) {
    send(response, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }

  const type = MIME.get(path.extname(file).toLowerCase()) || 'application/octet-stream';
  response.writeHead(200, {
    'Content-Type': type,
    'Content-Length': info.size,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(self)'
  });

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  const stream = createReadStream(file);
  stream.on('error', () => {
    if (!response.headersSent) {
      send(response, 500, 'Internal Server Error', { 'Content-Type': 'text/plain; charset=utf-8' });
    } else {
      response.destroy();
    }
  });
  stream.pipe(response);
});

server.listen(PORT, HOST, () => {
  console.log(`QR Studio is running at http://${HOST}:${PORT}/`);
  console.log('Press Ctrl+C to stop.');
});

server.on('error', (error) => {
  if (error && error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Try: PORT=${PORT + 1} node tools/dev-server.mjs`);
  } else {
    console.error('[dev-server]', error);
  }
  process.exitCode = 1;
});
