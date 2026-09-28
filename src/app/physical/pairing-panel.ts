// "Connect a depth camera" overlay: pairing QR from the relay's /pairing.json, iPhone steps and the fake-source fallback.
import { toDataURL } from 'qrcode';
import { copyButton, el } from './dom-builder';
import { describePairingProblem, fetchPairingInfo, pairingInfoUrl, type PairingInfo } from './relay-pairing-info-fetch';
import { normalizeRelayUrl, relayDisplayHost } from './relay-url-utils';

export interface PairingStatusView {
  connected: boolean;
  sources: number;
  message: string;
}

const RETRY_MS = 3000;

/** This page in virtual mode: the way out of projector mode when no depth camera is at hand. */
function virtualModeHref(): string {
  const url = new URL(location.href);
  url.searchParams.set('mode', 'virtual');
  return url.toString();
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
    this.qrImg = el('img', { className: 'lsp-qr-img', attrs: { alt: 'Pairing QR code for the LiveSand Depth iPhone app' } });
    this.qrBox = el('div', { className: 'lsp-qr is-loading', attrs: { 'data-testid': 'pairing-qr' } }, [this.qrImg, el('span', 'lsp-spinner')]);
    this.urlText = el('code', { className: 'lsp-url', text: 'loading…' });
    this.chips = el('div', 'lsp-chips');
    this.relayNote = el('p', 'lsp-relay-note');
    this.relayLine = el('p', { text: `Looking for the relay at ${relayDisplayHost(relayUrl)}…` });
    this.statusDot = el('span', 'lsp-dot');
    this.statusText = el('span', { text: 'Connecting…' });
    const step = (n: number, title: string, ...body: (Node | string)[]) =>
      el('li', 'lsp-pair-step', [el('span', { className: 'lsp-step-badge', text: String(n) }), el('div', '', [el('h3', { text: title }), ...body])]);
    const card = el('section', { className: 'lsp-card lsp-pairing', attrs: { role: 'dialog', 'aria-label': 'Connect iPhone depth camera' } }, [
      el('header', 'lsp-pair-head', [
        el('div', { className: 'lsp-eyebrow', text: 'Physical sandbox · depth camera' }),
        el('h2', { className: 'lsp-title', text: 'Connect iPhone' }),
        el('p', { className: 'lsp-sub', text: 'LiveSand turns an iPhone’s LiDAR depth into live terrain for the projector. Pair a phone with this relay to begin.' }),
      ]),
      el('div', 'lsp-pair-grid', [
        el('div', 'lsp-pair-qr-col', [this.qrBox, this.chips, el('div', 'lsp-url-row', [this.urlText, copyButton(() => this.currentUrl() ?? '')])]),
        el('ol', 'lsp-pair-steps', [
          step(1, 'Relay', this.relayLine, el('p', { className: 'lsp-muted' }, ['Start it on this computer with ', el('code', { text: 'npx livesand' }), '.']), this.relayNote),
          step(2, 'iPhone', el('p', { text: 'Open LiveSand Depth on a LiDAR iPhone or iPad Pro, tap “Scan pairing QR code”, point it at this code, then tap “Start streaming”. The phone must be on the same Wi-Fi as this computer.' })),
          step(3, 'Mount', el('p', { text: 'Hold the phone 1–1.5 m above the sand, camera pointing straight down, so the whole box is in view. Calibration starts as soon as depth arrives.' })),
        ]),
      ]),
      el('div', 'lsp-pair-alt', [
        el('p', { className: 'lsp-alt-title', text: 'No iPhone? Stream a simulated sensor from this computer:' }),
        el('div', 'lsp-url-row', [el('code', { className: 'lsp-cmd', text: fakeSourceCmd }), copyButton(() => fakeSourceCmd)]),
        el('p', { className: 'lsp-alt-title lsp-alt-exit' }, [
          'No sandbox at all? ',
          el('a', { className: 'lsp-link', text: 'Play the virtual sandbox instead', attrs: { href: virtualModeHref(), 'data-testid': 'pairing-virtual-link' } }),
        ]),
      ]),
      el('footer', { className: 'lsp-pair-status', attrs: { 'data-testid': 'pairing-status' } }, [this.statusDot, this.statusText]),
    ]);
    this.overlay = el('div', { className: 'lsp-overlay lsp-pairing-overlay', attrs: { 'data-testid': 'pairing-panel' } }, [card]);
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
    this.relayLine.classList.toggle('lsp-ok', s.connected);
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
      url = pairingInfoUrl(this.relayUrl);
      const body = await fetchPairingInfo(url, abort.signal);
      this.info = body;
      this.relayNote.textContent = body.warning ?? '';
      this.renderChips();
      await this.renderQr();
    } catch (err) {
      if (abort.signal.aborted) return;
      this.relayNote.textContent = describePairingProblem(err, url);
      if (!this.info) this.urlText.textContent = 'waiting for the relay…';
      if (this.visible) this.retryTimer = setTimeout(() => void this.loadPairing(), RETRY_MS);
    } finally {
      if (this.fetching === abort) this.fetching = null;
    }
  }

  private renderChips(): void {
    const urls = this.info?.sourceUrls ?? [];
    this.chips.replaceChildren(...(urls.length < 2 ? [] : urls.map((u, i) => {
      const chip = el('button', { className: 'lsp-chip', text: relayDisplayHost(u).replace(/:\d+$/, ''), attrs: { type: 'button', title: u } });
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
