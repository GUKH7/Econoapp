// One-off PR-only smoke of GitHub notification delivery from github-actions[bot].
import { notifyGithubIssue } from './notify-watchdog-github.mjs';

if (process.env.GITHUB_EVENT_NAME !== 'pull_request' ||
    process.env.GITHUB_REPOSITORY !== 'GUKH7/Econoapp' ||
    process.env.GITHUB_HEAD_REF !== 'feat/din-monitoring-watchdog-no-cost-20261026' ||
    process.env.GITHUB_PR_NUMBER !== '12') {
  throw new Error('Smoke is only allowed on PR #12 of the Din repository');
}
const result = await notifyGithubIssue({
  token: process.env.GITHUB_TOKEN,
  issueNumber: 12,
  assessment: {},
  smoke: true,
});
console.log('PR-only smoke comment: ' + result.result);
if (result.url) console.log(result.url);
