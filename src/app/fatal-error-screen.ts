// Full-page screens for "WebGPU unavailable" and unrecoverable runtime errors (friendly text, never a blank page).
import { h } from './hud-dom-helpers';
import { ICONS } from './hud-icons';
import { PROJECT_REPO_URL } from './hud-info-dialogs';

const BROWSER_TIPS = [
  'Chrome or Edge 113+ on Windows, macOS, ChromeOS or Android',
  'Safari 26+ on macOS, iPhone or iPad',
  'Firefox 141+ on Windows (other platforms: enable dom.webgpu.enabled in about:config)',
  'Chrome on Linux: enable chrome://flags/#enable-unsafe-webgpu and Vulkan',
  'Hardware acceleration must be on (check chrome://gpu)',
];

function screen(root: HTMLElement, title: string, message: string, extra: HTMLElement[]): void {
  const reload = h('button', { class: 'ls-btn ls-btn-primary', text: 'Reload', attrs: { type: 'button' } });
  reload.addEventListener('click', () => window.location.reload());
  const learn = h('a', {
    class: 'ls-btn ls-btn-secondary',
    text: 'About LiveSand',
    attrs: { href: PROJECT_REPO_URL, target: '_blank', rel: 'noopener noreferrer' },
  });
  const card = h('div', { class: 'ls-fatal-card ls-glass', attrs: { role: 'alert' } }, [
    h('div', { class: 'ls-fatal-logo', html: ICONS.logo, attrs: { 'aria-hidden': 'true' } }),
    h('h1', { class: 'ls-fatal-title', text: title }),
    h('p', { class: 'ls-fatal-message', text: message }),
    ...extra,
    h('div', { class: 'ls-modal-actions' }, [learn, reload]),
  ]);
  root.replaceChildren(h('div', { class: 'ls-fatal' }, [card]));
  document.title = `LiveSand — ${title}`;
}

export function showWebGpuUnavailableScreen(root: HTMLElement, message: string): void {
  screen(root, 'This browser can’t run LiveSand yet', message, [
    h('p', { class: 'ls-fatal-sub', text: 'LiveSand simulates water on the GPU with WebGPU. It works in:' }),
    h('ul', { class: 'ls-fatal-tips' }, BROWSER_TIPS.map((tip) => h('li', { text: tip }))),
  ]);
}

export function showFatalErrorScreen(root: HTMLElement, message: string): void {
  screen(root, 'Something went wrong', message, [
    h('p', { class: 'ls-fatal-sub', text: 'Reloading usually fixes it. If it keeps happening, please open an issue with your browser and GPU.' }),
  ]);
}

export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return typeof err === 'string' ? err : 'Unknown error';
}
