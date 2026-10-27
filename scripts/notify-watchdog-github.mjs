// GitHub-only alert delivery. Writes a comment to an EXISTING GitHub issue when authorized.
// No Render, Neon, email provider, financial data or production credentials are involved.
import { createHash } from 'node:crypto';

const API = 'https://api.github.com/repos/GUKH7/Econoapp';
const REPO = 'GUKH7/Econoapp';
const RECIPIENT = '@GUKH7';

export function alertFingerprint(assessment) {
  const key = JSON.stringify({
    reasons: [...(assessment.reasons || [])].sort(),
    lastFailedScheduledRun: assessment.lastFailedScheduledRun || null,
    lastSuccessfulAt: assessment.lastSuccessfulAt || null,
  });
  return createHash('sha256').update(key).digest('hex').slice(0, 20);
}

export function alertComment(assessment) {
  const fingerprint = alertFingerprint(assessment);
  const codes = (assessment.reasons || []).join(', ') || 'unknown';
  const validLink = (value) =>
    typeof value === 'string' && /^https:\/\/github\.com\/GUKH7\/Econoapp\/actions\/runs\/\d+$/.test(value)
      ? value : '(não disponível)';
  return [
    '<!-- din-watchdog:' + fingerprint + ' -->',
    '🔴 **ALERTA DE MONITORAMENTO DO DIN — não é evidência de falha do aplicativo**',
    RECIPIENT + ': o watchdog detectou falha ou ausência de monitoramento agendado.',
    '- Motivo: ' + codes,
    '- Último agendamento aprovado: ' + (assessment.lastSuccessfulAt || 'não encontrado'),
    '- Histórico de aprovação: ' + validLink(assessment.lastSuccessfulScheduledRun),
    '- Agendamento com falha: ' + validLink(assessment.lastFailedScheduledRun),
    '- Detalhes: https://github.com/GUKH7/Econoapp/actions/workflows/production-availability.yml',
    '',
    'Se a instância Render Free estiver acordando, aguarde e confirme antes de concluir que há indisponibilidade.',
    'Este alerta não contém informações financeiras e não comprova perda de dados.',
  ].join('\n');
}

export function alreadyNotified(comments, assessment) {
  const marker = '<!-- din-watchdog:' + alertFingerprint(assessment) + ' -->';
  return Array.isArray(comments) && comments.some((x) =>
    typeof x?.body === 'string' && x.body.includes(marker));
}

async function githubApi(path, token, { method = 'GET', data } = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: 'Bearer ' + token,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (data !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(API + path, {
    method, headers,
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(15_000), redirect: 'error',
  });
  if (!response.ok) throw new Error('GitHub API ' + method + ' HTTP ' + response.status);
  return response.json();
}

export async function notifyGithubIssue({ token, issueNumber, assessment, smoke = false }) {
  if (!token || !Number.isInteger(issueNumber) || (issueNumber !== 5 && issueNumber !== 12)) {
    throw new Error('Invalid GitHub-only notifier configuration');
  }
  if (!smoke && assessment.status !== 'alert') return { result: 'no_alert' };
  const body = smoke
    ? '<!-- din-watchdog-smoke:v1 -->\n🔔 **TESTE INOFENSIVO — NÃO É UM INCIDENTE**\n@GUKH7: este comentário foi enviado pelo GitHub Actions para testar a notificação, sem deploy e sem consultar o Render ou o Neon.'
    : alertComment(assessment);
  const path = '/issues/' + issueNumber + '/comments';
  const comments = await githubApi(path + '?per_page=100&sort=created&direction=desc', token);
  if (smoke && comments.some(c => c.body?.includes('<!-- din-watchdog-smoke:v1 -->'))) {
    return { result: 'already_sent' };
  }
  if (!smoke && alreadyNotified(comments, assessment)) return { result: 'already_sent' };
  const created = await githubApi(path, token, { method: 'POST', data: { body } });
  return { result: 'sent', url: created.html_url, target: REPO, issueNumber };
}
