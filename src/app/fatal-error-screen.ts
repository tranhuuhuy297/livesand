// Full-page screens for "WebGPU unavailable" and unrecoverable runtime errors (friendly text, never a blank page).
import { h, linkButton } from './hud-dom-helpers';
import { ICONS } from './hud-icons';
import { PROJECT_REPO_URL } from './hud-info-dialogs';

const BROWSER_TIPS = [
  'Chrome or Edge 113+ on Windows, macOS, ChromeOS or Android',
  'Safari 26+ on macOS, iPhone or iPad',
  'Firefox 141+ on Windows (other platforms: enable dom.webgpu.enabled in about:config)',
  'Chrome on Linux: enable chrome://flags/#enable-unsafe-webgpu and Vulkan',
  'Hardware acceleration must be on (check chrome://gpu)',
];

/** Picture of the running app, so visitors whose browser cannot run it still see what LiveSand is. */
export const PREVIEW_IMAGE_URL = `${import.meta.env.BASE_URL}og-image.jpg`;

function screen(root: HTMLElement, title: string, message: string, extra: HTMLElement[], starFirst: boolean): void {
  const reload = h('button', { class: `ls-btn ${starFirst ? 'ls-btn-secondary' : 'ls-btn-primary'}`, text: 'Reload', attrs: { type: 'button' } });
  reload.addEventListener('click', () => window.location.reload());
  const star = linkButton(ICONS.github, starFirst ? 'Star on GitHub' : 'About LiveSand', PROJECT_REPO_URL, starFirst ? 'ls-btn-primary' : 'ls-btn-secondary');
  const card = h('div', { class: 'ls-fatal-card ls-glass', attrs: { role: 'alert' } }, [
    h('div', { class: 'ls-fatal-logo', html: ICONS.logo, attrs: { 'aria-hidden': 'true' } }),
    h('h1', { class: 'ls-fatal-title', text: title }),
    h('p', { class: 'ls-fatal-message', text: message }),
    ...extra,
    h('div', { class: 'ls-modal-actions' }, starFirst ? [reload, star] : [star, reload]),
  ]);
  root.replaceChildren(h('div', { class: 'ls-fatal' }, [card]));
  document.title = `LiveSand — ${title}`;
}

export function showWebGpuUnavailableScreen(root: HTMLElement, message: string): void {
  const preview = h('figure', { class: 'ls-fatal-preview' }, [
    h('img', { attrs: { src: PREVIEW_IMAGE_URL, alt: 'LiveSand running: a river fills a lake that floods a village beside the sea', width: '1200', height: '630' } }),
    h('figcaption', { text: 'What you are missing: dig rivers, build levees and save the villages from the flood.' }),
  ]);
  screen(root, 'This browser can’t run LiveSand yet', message, [
    preview,
    h('p', { class: 'ls-fatal-sub', text: 'LiveSand simulates water on the GPU with WebGPU. It works in:' }),
    h('ul', { class: 'ls-fatal-tips' }, BROWSER_TIPS.map((tip) => h('li', { text: tip }))),
  ], true);
}

export function showFatalErrorScreen(root: HTMLElement, message: string): void {
  screen(root, 'Something went wrong', message, [
    h('p', { class: 'ls-fatal-sub', text: 'Reloading usually fixes it. If it keeps happening, please open an issue with your browser and GPU.' }),
  ], false);
}

export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return typeof err === 'string' ? err : 'Unknown error';
}
