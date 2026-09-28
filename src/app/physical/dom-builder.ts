// Tiny DOM helpers so the physical-mode UI stays declarative without a framework.

export type Child = Node | string | null | undefined | false;

export interface ElOptions {
  className?: string;
  text?: string;
  attrs?: Record<string, string>;
  on?: Partial<Record<keyof HTMLElementEventMap, (ev: Event) => void>>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, opts: ElOptions | string = {}, children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const o: ElOptions = typeof opts === 'string' ? { className: opts } : opts;
  if (o.className) node.className = o.className;
  if (o.text !== undefined) node.textContent = o.text;
  for (const [k, v] of Object.entries(o.attrs ?? {})) node.setAttribute(k, v);
  for (const [type, handler] of Object.entries(o.on ?? {})) if (handler) node.addEventListener(type, handler);
  for (const c of children) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

export function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

export function button(label: string, onClick: () => void, className = 'lsp-btn'): HTMLButtonElement {
  return el('button', { className, text: label, attrs: { type: 'button' }, on: { click: () => onClick() } });
}

/** Clipboard API with a legacy fallback for plain-http LAN pages, where navigator.clipboard is unavailable. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied: fall through to the legacy path.
  }
  const area = el('textarea', { attrs: { readonly: '', 'aria-hidden': 'true' } });
  area.value = text;
  area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.append(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

/** Copy button that briefly confirms success. */
export function copyButton(getText: () => string, label = 'Copy'): HTMLButtonElement {
  const btn = button(label, () => {
    void copyText(getText()).then((ok) => {
      btn.textContent = ok ? 'Copied' : 'Select & copy';
      btn.classList.toggle('is-done', ok);
      setTimeout(() => {
        btn.textContent = label;
        btn.classList.remove('is-done');
      }, 1500);
    });
  }, 'lsp-btn lsp-btn--ghost lsp-btn--small');
  return btn;
}
