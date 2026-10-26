// Din monitor-of-monitor: read only GitHub Actions history. No Render, Neon, POST or secrets in output.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const MAX_SUCCESS_AGE_MS = 36 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const failedConclusions = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure']);

export function assessMonitor({ workflow, runs, now = Date.now(), maxSuccessAgeMs = MAX_SUCCESS_AGE_MS }) {
  if (!Number.isFinite(now) || maxSuccessAgeMs <= 0 || !Array.isArray(runs)) {
    throw new Error('Invalid monitoring input');
  }
  const scheduled = runs.filter((run) =>
    run?.event === 'schedule' && Number.isFinite(Date.parse(run.created_at)));
  scheduled.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const successes = scheduled.filter((run) =>
    run.status === 'completed' && run.conclusion === 'success');
  const latestSuccess = successes[0];
  const latestFailure = scheduled.find((run) =>
    run.status === 'completed' && failedConclusions.has(run.conclusion));
  const lastSuccessAt = latestSuccess ? Date.parse(latestSuccess.created_at) : null;
  const hoursSinceSuccess = lastSuccessAt === null ? null :
    Math.round((now - lastSuccessAt) / HOUR_MS * 10) / 10;
  const scheduledRuns24h = scheduled.filter((run) =>
    Date.parse(run.created_at) > now - 24 * HOUR_MS &&
    Date.parse(run.created_at) <= now + 60_000).length;
  const reasons = [];
  if (workflow?.state !== 'active') reasons.push('workflow_not_active');
  if (!latestSuccess) reasons.push('no_successful_scheduled_run');
  else if (lastSuccessAt > now + 60_000 || now - lastSuccessAt > maxSuccessAgeMs) {
    reasons.push('last_success_over_36h');
  }
  if (latestFailure && (!latestSuccess ||
    Date.parse(latestFailure.created_at) > lastSuccessAt)) {
    reasons.push('latest_scheduled_run_failed');
  }
  return {
    status: reasons.length ? 'alert' : 'healthy',
    reasons,
    lastSuccessfulScheduledRun: latestSuccess?.html_url ?? null,
    lastSuccessfulAt: latestSuccess?.created_at ?? null,
    lastFailedScheduledRun: latestFailure?.html_url ?? null,
    hoursSinceSuccess,
    scheduledRunsObserved24h: scheduledRuns24h,
  };
}

async function readGitHubJSON(path, token, repo) {
  const url = new URL('https://api.github.com/repos/' + repo + '/' + path);
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(15_000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error('GitHub API HTTP ' + response.status);
  return response.json();
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !token) {
    throw new Error('Missing repository or read-only GitHub token');
  }
  const workflowId = 'production-availability.yml';
  const [workflow, history] = await Promise.all([
    readGitHubJSON('actions/workflows/' + workflowId, token, repo),
    readGitHubJSON('actions/workflows/' + workflowId + '/runs?per_page=30', token, repo),
  ]);
  const assessment = assessMonitor({ workflow, runs: history.workflow_runs });
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(), workflow: workflowId, ...assessment,
  }, null, 2));
  if (assessment.status !== 'healthy') process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(JSON.stringify({
      status: 'alert',
      reasons: ['watchdog_execution_error'],
      message: String(error.message).slice(0, 140),
    }));
    process.exitCode = 1;
  });
}
