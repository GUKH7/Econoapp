// Offline contracts: real local Web/Admin health routes + mocked production probe.
// No production network access, credentials, subscriptions, or database writes.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const freePort = () => new Promise((resolve, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    server.close((error) => error ? reject(error) : resolve(port));
  });
});

async function verifyLocalHealth(name, file, variable) {
  const port = await freePort();
  const child = spawn(process.execPath, [file], {
    env: { ...process.env, [variable]: String(port), WEB_PORT: String(port), API_TARGET: 'http://127.0.0.1:1' },
    stdio: 'ignore',
  });

  try {
    let response;
    for (let i = 0; i < 50; i += 1) {
      if (child.exitCode !== null) throw new Error(name + ' exited before ready');
      try {
        response = await fetch('http://127.0.0.1:' + port + '/health', {
          method: 'GET',
          signal: AbortSignal.timeout(600),
        });
        break;
      } catch {
        await delay(120);
      }
    }
    assert.ok(response, name + ' did not start');
    assert.equal(response.status, 200, name + ' must return HTTP 200');
    assert.deepEqual(await response.json(), { status: 'ok' }, name + ' health JSON changed');
    console.log('PASS local ' + name + ' /health');
  } finally {
    child.kill('SIGTERM');
  }
}

await verifyLocalHealth('web', 'web/server.js', 'WEB_PORT');
await verifyLocalHealth('admin', 'admin-web/server.js', 'ADMIN_WEB_PORT');

const recorded = [];
const realFetch = globalThis.fetch;
try {
  globalThis.fetch = async (url, options) => {
    recorded.push({ url: String(url), ...options });
    return new Response(JSON.stringify({ status: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  await import('./monitor-production.mjs');
} finally {
  globalThis.fetch = realFetch;
}

assert.equal(recorded.length, 4, 'Should request exactly four independent probes');
const expected = [
  '/health',
  '/health/ready',
  '/health',
  '/health',
];
const urlHosts = new Set();
for (let i = 0; i < recorded.length; i += 1) {
  const request = recorded[i];
  const target = new URL(request.url);
  assert.equal(target.protocol, 'https:');
  assert.equal(target.pathname, expected[i]);
  assert.equal(target.search, '');
  assert.equal(request.method, 'GET');
  assert.equal(request.redirect, 'error');
  assert.equal(request.headers?.Accept, 'application/json');
  urlHosts.add(target.host);
}
assert.equal(urlHosts.size, 3, 'Expected unique backend, web and admin service hosts');
console.log('PASS monitor with four mocked HTTPS probes (no live requests)');
