const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const port = Number(process.env.ADMIN_WEB_PORT || process.env.WEB_PORT || 5174);
const apiTarget = new URL(process.env.API_TARGET || 'http://localhost:3001');
const publicApiUrl = process.env.ADMIN_WEB_API_URL || process.env.WEB_API_URL || '';
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };

function securityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'same-origin');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: https:; font-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
}

function proxyApi(request, response) {
  const client = apiTarget.protocol === 'https:' ? https : http;
  const proxied = client.request({ hostname: apiTarget.hostname, port: apiTarget.port || (apiTarget.protocol === 'https:' ? 443 : 80), method: request.method, path: request.url, headers: { ...request.headers, host: apiTarget.host } }, (incoming) => {
    response.writeHead(incoming.statusCode || 502, incoming.headers);
    incoming.pipe(response);
  });
  proxied.on('error', () => { response.writeHead(502, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ message: 'API indisponível' })); });
  request.pipe(proxied);
}

http.createServer((request, response) => {
  securityHeaders(response);
  if (request.url === '/health') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ status: 'ok' })); return; }
  if (request.url?.startsWith('/api/v1/')) { proxyApi(request, response); return; }
  const pathname = new URL(request.url || '/', 'http://localhost').pathname;
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(root, requested));
  if (!filePath.startsWith(root)) { response.writeHead(403); response.end('Forbidden'); return; }
  if (requested === '/config.js') { response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(`window.DIN_ADMIN_CONFIG = ${JSON.stringify({ apiUrl: publicApiUrl })};`); return; }
  fs.readFile(filePath, (error, content) => { if (error) { response.writeHead(404); response.end('Not found'); return; } response.writeHead(200, { 'Content-Type': types[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); response.end(content); });
}).listen(port, '0.0.0.0', () => console.log(`Din Admin rodando em http://localhost:${port}`));
