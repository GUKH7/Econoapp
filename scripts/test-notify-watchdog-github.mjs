import test from 'node:test';
import assert from 'node:assert/strict';
import { alertFingerprint, alertComment, alreadyNotified } from './notify-watchdog-github.mjs';

const base = {
  status: 'alert',
  reasons: ['last_success_over_36h'],
  lastSuccessfulAt: '2026-10-24T00:00:00Z',
  lastSuccessfulScheduledRun: 'https://github.com/GUKH7/Econoapp/actions/runs/12345',
  lastFailedScheduledRun: null,
};

test('direct @GUKH7 recipient is present', () => {
  assert.match(alertComment(base), /@GUKH7/);
});
test('no balance or secrets or production credentials are present', () => {
  assert.doesNotMatch(alertComment(base), /(DATABASE_URL|password|balance|token|transa[cç])/i);
});
test('alert mentions monitor failure, not app outage', () => {
  assert.match(alertComment(base), /não é evidência de falha do aplicativo/);
});
test('dedup marker is stable for same incident', () => {
  assert.equal(alertFingerprint(base), alertFingerprint({ ...base }));
});
test('dedup recognizes previous GitHub issue comment', () => {
  assert.equal(alreadyNotified([{ body: alertComment(base) }], base), true);
});
test('incident type change triggers fresh comment', () => {
  const changed = { ...base, reasons: ['workflow_not_active'] };
  assert.equal(alreadyNotified([{ body: alertComment(base) }], changed), false);
});
test('new failed run triggers new incident marker', () => {
  const x = { ...base, reasons: ['latest_scheduled_run_failed'], lastFailedScheduledRun: 'https://github.com/GUKH7/Econoapp/actions/runs/11' };
  const y = { ...x, lastFailedScheduledRun: 'https://github.com/GUKH7/Econoapp/actions/runs/12' };
  assert.notEqual(alertFingerprint(x), alertFingerprint(y));
});
test('untrusted external URL is not printed', () => {
  assert.doesNotMatch(alertComment({ ...base, lastFailedScheduledRun: 'https://malicious.example/path' }), /malicious/);
});
test('missing history does not crash', () => {
  assert.match(alertComment({ status: 'alert', reasons: ['no_successful_scheduled_run'] }), /não encontrado/);
});
test('dedup ignores unrelated comments', () => {
  assert.equal(alreadyNotified([{ body: 'regular GitHub comment' }], base), false);
});
