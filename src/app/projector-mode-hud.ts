// Minimal projector-mode panel (toggled with H): relay/phone status, optional level status and a few actions.
import './projector-styles.css';
import { h, iconButton, setHidden, setText, toggleClass } from './hud-dom-helpers';
import { ICONS } from './hud-icons';
import type { PhysicalStatus } from './physical/physical-mode-controller';

export interface ProjectorHudActions {
  calibrate(): void;
  toggleFullscreen(): void;
  exitToVirtual(): void;
  toggleHud(): void;
}

export class ProjectorModeHud {
  readonly root: HTMLDivElement;
  private readonly dot = h('span', { class: 'ls-status-dot' });
  private readonly statusText = h('span', { class: 'ls-projector-status' });
  private readonly message = h('div', { class: 'ls-projector-message' });
  private readonly game = h('div', { class: 'ls-projector-game' });

  constructor(actions: ProjectorHudActions) {
    this.root = h('div', { class: 'ls-projector-hud ls-glass', attrs: { role: 'region', 'aria-label': 'Projector status' } }, [
      h('div', { class: 'ls-projector-head' }, [
        h('span', { class: 'ls-logo', html: ICONS.logo, attrs: { 'aria-hidden': 'true' } }),
        h('strong', { text: 'LiveSand projector' }),
      ]),
      h('div', { class: 'ls-projector-line' }, [this.dot, this.statusText]),
      this.message,
      this.game,
      h('div', { class: 'ls-projector-actions' }, [
        iconButton(ICONS.target, 'Calibrate', () => actions.calibrate(), { class: 'ls-btn-secondary', showLabel: true, kbd: 'C' }),
        iconButton(ICONS.fullscreen, 'Fullscreen', () => actions.toggleFullscreen(), { class: 'ls-btn-secondary', kbd: 'F' }),
        iconButton(ICONS.exit, 'Virtual sandbox', () => actions.exitToVirtual(), { class: 'ls-btn-secondary' }),
        iconButton(ICONS.close, 'Hide panel', () => actions.toggleHud(), { class: 'ls-btn-ghost', kbd: 'H' }),
      ]),
      h('div', { class: 'ls-projector-hint' }, [h('kbd', { text: 'H' }), ' hide / show panel']),
    ]);
    this.setStatus({ connected: false, sources: 0, fps: 0, calibrated: false, message: 'Connecting to the relay…' });
    this.setGame(null);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  toggle(): void {
    this.root.hidden = !this.root.hidden;
  }

  setStatus(s: PhysicalStatus): void {
    const live = s.connected && s.sources > 0;
    toggleClass(this.dot, 'is-live', live);
    toggleClass(this.dot, 'is-waiting', s.connected && s.sources === 0);
    const parts = [s.connected ? 'Relay connected' : 'Relay offline'];
    if (s.connected) parts.push(s.sources > 0 ? `${s.sources} depth ${s.sources === 1 ? 'source' : 'sources'}` : 'no phone yet');
    if (live) parts.push(`${Math.round(s.fps)} fps`);
    parts.push(s.calibrated ? 'calibrated' : 'not calibrated');
    setText(this.statusText, parts.join(' · '));
    setText(this.message, s.message);
    setHidden(this.message, !s.message);
  }

  setGame(text: string | null): void {
    setHidden(this.game, text === null);
    if (text !== null) setText(this.game, text);
  }
}
