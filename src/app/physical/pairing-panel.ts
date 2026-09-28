// "Connect a depth camera" overlay: pairing QR from the relay's /pairing.json, iPhone steps and the fake-source fallback.
import { toDataURL } from 'qrcode';
import { copyButton, el } from './dom-builder';
import { normalizeRelayUrl, relayDisplayHost, relayHttpUrl } from './relay-url-utils';

interface PairingInfo {
  sourceUrls: string[];
  viewerUrls: string[];
  port: number;
}

export interface PairingStatusView {
  connected: boolean;
  sources: number;
  message: string;
}

const RETRY_MS = 3000;

function isPairingInfo(v: unknown): v is PairingInfo {
  const o = v as Partial<PairingInfo> | null;
  return Boolean(o && Array.isArray(o.sourceUrls) && o.sourceUrls.every((u) => typeof u === 'string'));
}

/** `--url …` for the fake-source command; omitted (CLI default) when the relay URL is unusable. */
function fakeSourceUrlArg(relayUrl: string): string {
  try {
    return ` --url ${normalizeRelayUrl(relayUrl, 'source')}`;
  } catch {
    return '';
  }
}

export class PairingPanel {
  private readonly relayUrl: string;
  private readonly overlay: HTMLElement;
  private readonly qrImg: HTMLImageElement;
  private readonly qrBox: HTMLElement;
  private readonly urlText: HTMLElement;
  private readonly chips: HTMLElement;
  private readonly relayNote: HTMLElement;
  private readonly relayLine: HTMLElement;
  private readonly statusDot: HTMLElement;
  private readonly statusText: HTMLElement;
  private info: PairingInfo | null = null;
  private selected = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private fetching: AbortController | null = null;
  private visible = false;

  constructor(private readonly root: HTMLElement, relayUrl: string) {
    this.relayUrl = relayUrl;
    const fakeSourceCmd = `npx livesand fake-source${fakeSourceUrlArg(relayUrl)}`;
    this.qrImg = el('img', { className: 'ls-qr-img', attrs: { alt: 'Pairing QR code for the LiveSand Depth iPhone app' } });
    this.qrBox = el('div', { className: 'ls-qr is-loading', attrs: { 'data-testid': 'pairing-qr' } }, [this.qrImg, el('span', 'ls-spinner')]);
    this.urlText = el('code', { className: 'ls-url', text: 'loading…' });
    this.chips = el('div', 'ls-chips');
    this.relayNote = el('p', 'ls-relay-note');
    this.relayLine = el('p', { text: `Looking for the relay at ${relayDisplayHost(relayUrl)}…` });
    this.statusDot = el('span', 'ls-dot');
    this.statusText = el('span', { text: 'Connecting…' });
    const step = (n: number, title: string, ...body: (Node | string)[]) =>
      el('li', 'ls-pair-step', [el('span', { className: 'ls-step-badge', text: String(n) }), el('div', '', [el('h3', { text: title }), ...body])]);
    const card = el('section', { className: 'ls-card ls-pairing', attrs: { role: 'dialog', 'aria-label': 'Connect iPhone depth camera' } }, [
      el('header', 'ls-pair-head', [
        el('div', { className: 'ls-eyebrow', text: 'Physical sandbox · depth camera' }),
        el('h2', { className: 'ls-title', text: 'Connect iPhone' }),
        el('p', { className: 'ls-sub', text: 'LiveSand turns an iPhone’s LiDAR depth into live terrain for the projector. Pair a phone with this relay to begin.' }),
      ]),
      el('div', 'ls-pair-grid', [
        el('div', 'ls-pair-qr-col', [this.qrBox, this.chips, el('div', 'ls-url-row', [this.urlText, copyButton(() => this.currentUrl() ?? '')])]),
        el('ol', 'ls-pair-steps', [
          step(1, 'Relay', this.relayLine, el('p', { className: 'ls-muted' }, ['Start it on this computer with ', el('code', { text: 'npx livesand' }), '.']), this.relayNote),
          step(2, 'iPhone', el('p', { text: 'Open LiveSand Depth on a LiDAR iPhone or iPad Pro, tap “Scan pairing QR code”, point it at this code, then tap “Start streaming”. The phone must be on the same Wi-Fi as this computer.' })),
          step(3, 'Mount', el('p', { text: 'Hold the phone 1–1.5 m above the sand, camera pointing straight down, so the whole box is in view. Calibration starts as soon as depth arrives.' })),
        ]),
      ]),
      el('div', 'ls-pair-alt', [
        el('p', { className: 'ls-alt-title', text: 'No iPhone? Stream a simulated sensor from this computer:' }),
        el('div', 'ls-url-row', [el('code', { className: 'ls-cmd', text: fakeSourceCmd }), copyButton(() => fakeSourceCmd)]),
      ]),
      el('footer', { className: 'ls-pair-status', attrs: { 'data-testid': 'pairing-status' } }, [this.statusDot, this.statusText]),
    ]);
    this.overlay = el('div', { className: 'ls-overlay ls-pairing-overlay', attrs: { 'data-testid': 'pairing-panel' } }, [card]);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    if (this.visible) return;
    this.visible = true;
    this.root.append(this.overlay);
    if (!this.info) void this.loadPairing();
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.overlay.remove();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.fetching?.abort();
    this.fetching = null;
  }

  update(s: PairingStatusView): void {
    this.statusDot.dataset.state = !s.connected ? 'off' : s.sources > 0 ? 'live' : 'wait';
    this.statusText.textContent = s.message;
    const host = relayDisplayHost(this.relayUrl);
    this.relayLine.textContent = s.connected ? `✓ Connected to the relay at ${host}` : `Looking for the relay at ${host}…`;
    this.relayLine.classList.toggle('ls-ok', s.connected);
    // A relay that just came up can now answer /pairing.json.
    if (s.connected && this.visible && !this.info && !this.fetching) void this.loadPairing();
  }

  private currentUrl(): string | null {
    return this.info?.sourceUrls[this.selected] ?? null;
  }

  private async loadPairing(): Promise<void> {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const abort = new AbortController();
    this.fetching?.abort();
    this.fetching = abort;
    let url = this.relayUrl;
    try {
      url = relayHttpUrl(this.relayUrl, '/pairing.json');
      const res = await fetch(url, { cache: 'no-store', signal: abort.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body: unknown = await res.json();
      if (!isPairingInfo(body) || body.sourceUrls.length === 0) throw new Error('the relay returned no source URLs');
      this.info = body;
      this.relayNote.textContent = '';
      this.renderChips();
      await this.renderQr();
    } catch (err) {
      if (abort.signal.aborted) return;
      this.relayNote.textContent = `Couldn’t load pairing info from ${url} (${(err as Error).message}). Is the relay running? Retrying…`;
      if (!this.info) this.urlText.textContent = 'waiting for the relay…';
      if (this.visible) this.retryTimer = setTimeout(() => void this.loadPairing(), RETRY_MS);
    } finally {
      if (this.fetching === abort) this.fetching = null;
    }
  }

  private renderChips(): void {
    const urls = this.info?.sourceUrls ?? [];
    this.chips.replaceChildren(...(urls.length < 2 ? [] : urls.map((u, i) => {
      const chip = el('button', { className: 'ls-chip', text: relayDisplayHost(u).replace(/:\d+$/, ''), attrs: { type: 'button', title: u } });
      chip.classList.toggle('is-active', i === this.selected);
      chip.addEventListener('click', () => {
        this.selected = i;
        this.renderChips();
        void this.renderQr();
      });
      return chip;
    })));
  }

  private async renderQr(): Promise<void> {
    const url = this.currentUrl();
    if (!url) return;
    this.urlText.textContent = url;
    try {
      this.qrImg.src = await toDataURL(url, { margin: 1, width: 440, errorCorrectionLevel: 'M', color: { dark: '#0b1016', light: '#ffffff' } });
      this.qrBox.classList.remove('is-loading');
    } catch (err) {
      this.relayNote.textContent = `Couldn’t draw the QR code (${(err as Error).message}); type the URL into the app instead.`;
    }
  }
}
