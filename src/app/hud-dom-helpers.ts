// Tiny DOM builders for the HUD (no framework: the UI is small and updates are hand-diffed).

type Child = Node | string | null | undefined | false;

export interface ElementProps {
  class?: string;
  text?: string;
  /** Trusted static markup only (icons); never user or network data. */
  html?: string;
  title?: string;
  attrs?: Record<string, string>;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (ev: HTMLElementEventMap[K]) => void }>;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: ElementProps = {}, children: Child[] = []): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.html !== undefined) el.innerHTML = props.html;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.title) {
    el.title = props.title;
    if (!props.attrs?.['aria-label']) el.setAttribute('aria-label', props.title);
  }
  for (const [k, v] of Object.entries(props.attrs ?? {})) el.setAttribute(k, v);
  for (const [type, handler] of Object.entries(props.on ?? {})) {
    el.addEventListener(type, handler as EventListener);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

/** Button with an inline SVG icon and optional label; type=button so it never submits anything. */
export function iconButton(icon: string, label: string, onClick: () => void, opts: { class?: string; showLabel?: boolean; kbd?: string } = {}): HTMLButtonElement {
  const title = opts.kbd ? `${label} (${opts.kbd})` : label;
  const btn = h('button', { class: `ls-btn ${opts.class ?? ''}`.trim(), title, attrs: { type: 'button' } }, [
    h('span', { class: 'ls-icon', html: icon, attrs: { 'aria-hidden': 'true' } }),
    opts.showLabel ? h('span', { class: 'ls-btn-label', text: label }) : null,
  ]);
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    // Mouse clicks drop focus so Space/Enter keep driving global shortcuts instead of re-clicking this button.
    if (ev.detail > 0) btn.blur();
    onClick();
  });
  return btn;
}

/** Button-styled link that opens in a new tab (GitHub, docs). */
export function linkButton(icon: string, label: string, href: string, className = 'ls-btn-secondary'): HTMLAnchorElement {
  return h('a', { class: `ls-btn ${className}`, attrs: { href, target: '_blank', rel: 'noopener noreferrer' } }, [
    h('span', { class: 'ls-icon', html: icon, attrs: { 'aria-hidden': 'true' } }),
    h('span', { class: 'ls-btn-label', text: label }),
  ]);
}

/** Sets text only when it changed, avoiding layout work on every frame. */
export function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function setHidden(el: HTMLElement, hidden: boolean): void {
  if (el.hidden !== hidden) el.hidden = hidden;
}

export function toggleClass(el: HTMLElement, name: string, on: boolean): void {
  if (el.classList.contains(name) !== on) el.classList.toggle(name, on);
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Whether a keyboard event targets a text field, where shortcuts must not fire. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button'].includes(target.type);
}

/** Copies text; falls back to a hidden textarea where the async clipboard API is unavailable (plain http, iframes). */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = h('textarea', { attrs: { readonly: '', 'aria-hidden': 'true', style: 'position:fixed;opacity:0' } });
    area.value = text;
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}
