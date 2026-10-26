import test from 'node:test';
import assert from 'node:assert/strict';
import { assessMonitor } from './production-monitor-watchdog.mjs';

const now = Date.parse('2026-10-26T20:00:00Z');
const run = (hoursAgo, conclusion = 'success', event = 'schedule', status = 'completed') => ({
  event, conclusion, status,
  created_at: new Date(now - hoursAgo * 3600_000).toISOString(),
  html_url: 'https://github.com/GUKH7/Econoapp/actions/runs/' + (1000 + hoursAgo),
});
const check = (runs, state = 'active') =>
  assessMonitor({ workflow: { state }, runs, now });

test('recent successful schedule is healthy and reports gaps', () => {
  const x = check([run(8), run(15)]);
  assert.equal(x.status, 'healthy');
  assert.equal(x.scheduledRunsObserved24h, 2);
  assert.equal(x.hoursSinceSuccess, 8);
});
test('failure after previous success raises an alert', () => {
  assert.ok(check([run(2, 'failure'), run(8)]).reasons.includes('latest_scheduled_run_failed'));
});
test('newer success clears an earlier failure', () => {
  assert.equal(check([run(2), run(8, 'failure')]).status, 'healthy');
});
test('36-hour stale success is an alert', () => {
  assert.ok(check([run(37)]).reasons.includes('last_success_over_36h'));
});
test('manual execution is not counted as a scheduled success', () => {
  assert.ok(check([run(1, 'success', 'workflow_dispatch')]).reasons.includes('no_successful_scheduled_run'));
});
test('disabled schedule alerts even if it previously succeeded', () => {
  assert.ok(check([run(1)], 'disabled_manually').reasons.includes('workflow_not_active'));
});
test('recent pending run does not mask a healthy earlier success', () => {
  assert.equal(check([run(0.2, null, 'schedule', 'in_progress'), run(5)]).status, 'healthy');
});
test('cancelled and timed out schedules trigger alerts', () => {
  for (const state of ['cancelled', 'timed_out']) {
    assert.ok(check([run(1, state), run(3)]).reasons.includes('latest_scheduled_run_failed'));
  }
});
test('sort out of order GitHub results', () => {
  assert.equal(check([run(17), run(2), run(10)]).hoursSinceSuccess, 2);
});
test('future timestamps cannot be accepted as a healthy check', () => {
  assert.equal(check([run(-2)]).status, 'alert');
});
