// Pre-deploy, read-only smoke tests of the health endpoints ALREADY deployed.
// No authorization, SQL, credentials, webhook or POST. Readiness is intentionally
// excluded until the new /health/ready endpoint exists in production.
const urls = [
  ['backend', 'https://econoapp-backend.onrender.com/health'],
  ['web', 'https://econoapp-web.onrender.com/health'],
  ['admin', 'https://econoapp-admin.onrender.com/health'],
];

const results = await Promise.all(urls.map(async ([name, url]) => {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
        redirect: 'error',
        signal: AbortSignal.timeout(110_000), // account for Render Free cold starts
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const body = await response.json();
      if (body?.status !== 'ok') throw new Error('unexpected /health payload');
      return { name, status: 'passed', attempt, httpStatus: response.status };
    } catch (error) {
      if (attempt === 2) {
        return {
          name,
          status: 'failed',
          attempt,
          reason: error?.message?.startsWith('HTTP ')
            ? error.message : 'unreachable-or-unexpected-response',
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 8_000));
    }
  }
  return { name, status: 'failed', reason: 'unknown' };
}));
console.log(JSON.stringify({
  note: 'Pre-deploy check: only previously deployed /health, no database readiness',
  results,
}, null, 2));
if (results.some(item => item.status !== 'passed')) process.exitCode = 1;
