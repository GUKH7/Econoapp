// Monitoramento apenas de leitura: nenhum login, alteracao de dados ou uso de segredos.
// Node >= 20, sem dependencias externas. Retorna exit code 1 se qualquer probe falhar.

const BASE_TIMEOUT_MS = 110_000;
const RETRY_DELAY_MS = 8_000;
const probes = [
  {
    name: 'backend-liveness',
    url: process.env.MONITOR_BACKEND_LIVE_URL || 'https://econoapp-backend.onrender.com/health',
  },
  {
    name: 'backend-database-readiness',
    url: process.env.MONITOR_BACKEND_READY_URL || 'https://econoapp-backend.onrender.com/health/ready',
  },
  {
    name: 'web-liveness',
    url: process.env.MONITOR_WEB_URL || 'https://econoapp-web.onrender.com/health',
  },
  {
    name: 'admin-liveness',
    url: process.env.MONITOR_ADMIN_URL || 'https://econoapp-admin.onrender.com/health',
  },
];

async function requestStatus(url) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('Endpoint must use HTTPS without embedded credentials');
  }

  const started = Date.now();
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(BASE_TIMEOUT_MS),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const body = await response.json().catch(() => null);
  if (body?.status !== 'ok') {
    throw new Error('Unexpected health payload');
  }

  return { latencyMs: Date.now() - started, httpStatus: response.status };
}

async function probeStatus({ name, url }) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await requestStatus(url);
      return { name, status: 'passed', attempts: attempt, ...result };
    } catch (error) {
      if (attempt === 2) {
        // Do not log upstream error bodies, URLs with query strings, or credentials.
        const reason = error instanceof Error && error.message.startsWith('HTTP ')
          ? error.message : 'unreachable-or-invalid-response';
        return { name, status: 'failed', attempts: attempt, reason };
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
  return { name, status: 'failed', reason: 'unknown' };
}

const results = await Promise.all(probes.map(probeStatus));
const passed = results.every((result) => result.status === 'passed');
console.log(JSON.stringify({
  monitoredAt: new Date().toISOString(),
  status: passed ? 'passed' : 'failed',
  checks: results,
}, null, 2));

if (!passed) process.exitCode = 1;
