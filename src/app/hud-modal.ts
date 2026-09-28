// Shared glass dialog shell: backdrop, card, close button; returns focus to where it was when closed.
import './hud-dialog-styles.css';
import { h, iconButton } from './hud-dom-helpers';
import { ICONS } from './hud-icons';

export class HudModal {
  readonly root: HTMLDivElement;
  readonly body: HTMLDivElement;
  private readonly onClose: (() => void) | null;
  private lastFocus: Element | null = null;

  constructor(className: string, label: string, opts: { dismissible?: boolean; onClose?: () => void } = {}) {
    const dismissible = opts.dismissible ?? true;
    this.onClose = opts.onClose ?? null;
    this.body = h('div', { class: 'ls-modal-body' });
    const card = h('div', { class: 'ls-modal ls-glass', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': label } }, [
      dismissible ? iconButton(ICONS.close, 'Close', () => this.close(), { class: 'ls-modal-close ls-btn-ghost', kbd: 'Esc' }) : null,
      this.body,
    ]);
    this.root = h('div', { class: `ls-modal-backdrop ${className}` }, [card]);
    this.root.hidden = true;
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Tab' && this.isOpen) this.trapTab(ev);
    });
    if (dismissible) {
      this.root.addEventListener('pointerdown', (ev) => {
        if (ev.target === this.root) this.close();
      });
    }
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Shows the dialog and focuses `focus` (default: the first visible primary action). */
  open(focus?: HTMLElement): void {
    if (this.isOpen) return;
    this.lastFocus = document.activeElement;
    this.root.hidden = false;
    // Focus the primary action so Enter/Space work immediately and screen readers land inside the dialog.
    const primary = [...this.body.querySelectorAll<HTMLElement>('.ls-btn-primary')].find((el) => !el.hidden);
    (focus ?? primary ?? this.root.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.hidden = true;
    if (this.lastFocus instanceof HTMLElement && document.contains(this.lastFocus)) this.lastFocus.focus({ preventScroll: true });
    else (document.activeElement as HTMLElement | null)?.blur?.();
    this.onClose?.();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** aria-modal promises focus stays inside: Tab and Shift+Tab wrap around the dialog's controls. */
  private trapTab(ev: KeyboardEvent): void {
    const focusable = [...this.root.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.hidden && el.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    const inside = active instanceof HTMLElement && this.root.contains(active);
    if (ev.shiftKey && (active === first || !inside)) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && (active === last || !inside)) {
      ev.preventDefault();
      first.focus();
    }
  }
}
