const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const port = Number(process.env.WEB_PORT || 5173);
const apiTarget = new URL(process.env.API_TARGET || 'http://localhost:3001');
const publicApiUrl = process.env.WEB_API_URL || '';
const googleClientId = (process.env.GOOGLE_CLIENT_ID || '')
  .split(',')
  .map((clientId) => clientId.trim())
  .filter(Boolean)[0] || '';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function proxyApi(request, response) {
  const proxyClient = apiTarget.protocol === 'https:' ? https : http;
  const proxyRequest = proxyClient.request(
    {
      hostname: apiTarget.hostname,
      port: apiTarget.port || (apiTarget.protocol === 'https:' ? 443 : 80),
      method: request.method,
      path: request.url,
      headers: {
        ...request.headers,
        host: apiTarget.host,
      },
    },
    (proxyResponse) => {
      response.writeHead(proxyResponse.statusCode || 502, proxyResponse.headers);
      proxyResponse.pipe(response);
    },
  );

  proxyRequest.on('error', () => {
    response.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ message: 'API local indisponivel' }));
  });

  request.pipe(proxyRequest);
}

const server = http.createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (request.url?.startsWith('/api/v1/')) {
    proxyApi(request, response);
    return;
  }

  const requested = request.url === '/' ? '/index.html' : request.url.split('?')[0];
  const filePath = path.normalize(path.join(root, requested));

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  if (requested === '/config.js' && (publicApiUrl || googleClientId)) {
    response.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(
      `window.ECONOAPP_CONFIG = ${JSON.stringify({ apiUrl: publicApiUrl, googleClientId })};`,
    );
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }

    response.writeHead(200, {
      'Content-Type': types[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(content);
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`EconoApp web rodando em http://localhost:${port}`);
});
