import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const file = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const app = file('web/app.js');
const chrome = file('web/views/chrome.js');
const home = file('web/views/din-home.js');
const fluid = file('web/styles/din-fluida-v1.css');
const styles = file('web/styles.css');
const sw = file('web/sw.js');
const visual = file('scripts/visual-check.mjs');

describe('Din Fluida e Moderna — isolated UI contract', () => {
  it('keeps all five fixed destinations plus a distinct add action', () => {
    const expected = [
      ["dashboard", "Início"],
      ["transactions", "Transações"],
      ["reports", "Análise"],
      ["cards", "Cartões"],
      ["budget", "Metas"],
    ] as const;
    for (const [id, label] of expected) {
      expect(app).toContain(`tabButton('${id}', '${label}')`);
    }
    expect(app).not.toContain("tabButton('more', 'Mais')");
    expect(app).toContain('data-fab aria-label="Adicionar lançamento"');
    expect(chrome).toContain("cards: icon('card')");
  });

  it('keeps settings accessible when More is not a bottom tab', () => {
    expect(app).toContain('data-tab-jump="more"');
    expect(app).toContain("if (target === 'more')");
    expect(fluid).toContain('nav.tabs button.nav-fab');
    expect(fluid).toContain('nav.tabs button:not(.nav-fab)');
  });

  it('keeps visual home sequence aligned with DOM and keyboard order', () => {
    const sections = ['din-hero', 'din-chart-section', 'din-actions', 'din-month', 'din-secondary-grid', 'din-recent'];
    const positions = sections.map((name) => home.indexOf(`class="${name}"`));
    expect(positions.every((pos) => pos >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(fluid).not.toMatch(/\.din-home\s*>\s*\.din-[^{]+\{\s*order:/);
    expect(fluid).not.toMatch(/\.din-tip\s*\{\s*order:\s*-1/);
  });

  it('caches the visual layer and serves the mascot as WebP in mocked tests', () => {
    expect(styles).toContain('din-fluida-v1.css');
    expect(sw).toContain("'./styles/din-fluida-v1.css'");
    expect(sw).toContain("'./assets/din-mascote-oficial.webp'");
    expect(visual).toContain("'.webp': 'image/webp'");
    expect(visual).toContain('assertDinNavigationFits');
    expect(visual).toContain('assertHomeReadingOrder');
  });
});
