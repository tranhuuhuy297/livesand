// Real-map status: a "Loading <map>…" pill while terrain downloads, and the terrain data credit (one quiet line that
// expands on click) whenever the current level stands on real elevation data.
import { h, setHidden, setText } from './hud-dom-helpers';
import type { HudSnapshot } from './hud-snapshot';

export class PlaceStatus {
  readonly loading: HTMLDivElement;
  readonly credit: HTMLButtonElement;
  private readonly loadingText = h('span');
  private readonly creditText = h('span', { class: 'ls-credit-text' });
  private shownCredit: string | null = null;

  constructor() {
    this.loading = h('div', { class: 'ls-loading ls-glass', attrs: { role: 'status', 'aria-live': 'polite' } }, [
      h('span', { class: 'ls-loading-spinner', attrs: { 'aria-hidden': 'true' } }),
      this.loadingText,
    ]);
    this.loading.hidden = true;
    this.credit = h('button', { class: 'ls-credit', attrs: { type: 'button', 'aria-expanded': 'false' } }, [
      h('span', { class: 'ls-credit-label', text: 'Elevation' }),
      this.creditText,
    ]);
    this.credit.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (ev.detail > 0) this.credit.blur();
      const open = !this.credit.classList.contains('is-open');
      this.credit.classList.toggle('is-open', open);
      this.credit.setAttribute('aria-expanded', String(open));
    });
    this.credit.hidden = true;
  }

  update(s: HudSnapshot): void {
    setHidden(this.loading, s.loading === null);
    if (s.loading !== null) setText(this.loadingText, `Loading ${s.loading}…`);
    const credit = s.place?.attribution ?? null;
    if (credit === this.shownCredit) return;
    this.shownCredit = credit;
    setHidden(this.credit, credit === null);
    setText(this.creditText, credit ?? '');
    this.credit.title = credit ?? '';
    this.credit.classList.remove('is-open');
    this.credit.setAttribute('aria-expanded', 'false');
  }
}
