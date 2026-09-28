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
    if (dismissible) {
      this.root.addEventListener('pointerdown', (ev) => {
        if (ev.target === this.root) this.close();
      });
    }
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    if (this.isOpen) return;
    this.lastFocus = document.activeElement;
    this.root.hidden = false;
    // Focus the primary action so Enter/Space work immediately and screen readers land inside the dialog.
    const primary = this.body.querySelector<HTMLElement>('.ls-btn-primary') ?? this.root.querySelector<HTMLElement>('button');
    primary?.focus({ preventScroll: true });
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
}
