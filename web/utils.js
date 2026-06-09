export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function parseAmount(value) {
  const normalized = String(value).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : 0;
}

export function formatCurrencyInput(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  const cents = Number(digits || '0');
  return new Intl.NumberFormat('pt-BR', {
    currency: 'BRL',
    style: 'currency',
  }).format(cents / 100);
}

export function transitionTo(apply, direction = 'forward', options = {}) {
  const root = document.documentElement;
  root.dataset.routeDirection = direction;

  if (document.startViewTransition && options.native !== false) {
    document.startViewTransition(() => {
      apply();
    });
    return;
  }

  root.classList.add('route-fallback-out');
  window.setTimeout(() => {
    apply();
    root.classList.remove('route-fallback-out');
    root.classList.add('route-fallback-in');
    window.setTimeout(() => root.classList.remove('route-fallback-in'), 260);
  }, 120);
}
