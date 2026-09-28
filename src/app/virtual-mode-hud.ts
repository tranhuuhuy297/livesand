// Virtual-mode HUD: top bar (brand, level picker, timer/storm, view + actions), village chips, tool dock and dialogs.
import './hud-styles.css';
import type { ViewMode } from './app-url-params';
import { h, iconButton, setHidden, setText } from './hud-dom-helpers';
import { GameStatusBar, VillageChips } from './hud-game-status';
import { ICONS } from './hud-icons';
import { createHelpDialog, createRealSandboxDialog } from './hud-info-dialogs';
import { LevelIntroCard, ResultDialog } from './hud-level-cards';
import { LevelPicker } from './hud-level-picker';
import type { HudModal } from './hud-modal';
import type { HudActions, HudSnapshot } from './hud-snapshot';
import { ToolDock } from './hud-tool-dock';

export class VirtualModeHud {
  readonly root: HTMLDivElement;
  private readonly picker: LevelPicker;
  private readonly status = new GameStatusBar();
  private readonly chips = new VillageChips();
  private readonly dock: ToolDock;
  private readonly intro: LevelIntroCard;
  private readonly result: ResultDialog;
  private readonly help: HudModal;
  private readonly real: HudModal;
  private readonly viewButtons = new Map<ViewMode, HTMLButtonElement>();
  private readonly speedText = h('span', { class: 'ls-speed-text' });
  private readonly toast = h('div', { class: 'ls-toast ls-glass', attrs: { role: 'status' } });
  private readonly debugLine = h('div', { class: 'ls-debug ls-glass' });
  private toastTimer = 0;
  private view: ViewMode | null = null;

  constructor(actions: HudActions) {
    this.picker = new LevelPicker(actions);
    this.dock = new ToolDock(actions);
    this.intro = new LevelIntroCard(actions);
    this.result = new ResultDialog(actions);
    this.real = createRealSandboxDialog(() => actions.openProjectorMode());
    this.help = createHelpDialog(() => this.real.open());

    const viewToggle = h('div', { class: 'ls-segmented', attrs: { role: 'group', 'aria-label': 'View' } }, (['2d', '3d'] as const).map((v) => {
      const btn = iconButton(v === '2d' ? ICONS.map : ICONS.cube, v.toUpperCase(), () => actions.setView(v), { showLabel: true, kbd: 'V' });
      btn.setAttribute('aria-pressed', 'false');
      this.viewButtons.set(v, btn);
      return btn;
    }));
    const speed = iconButton(ICONS.speed, 'Simulation speed', () => actions.cycleSpeed(), { class: 'ls-speed' });
    speed.append(this.speedText);
    const realButton = iconButton(ICONS.projector, 'Real sandbox', () => this.real.open(), { class: 'ls-btn-accent', showLabel: true });

    const topbar = h('header', { class: 'ls-topbar' }, [
      h('div', { class: 'ls-brand' }, [
        h('span', { class: 'ls-logo', html: ICONS.logo, attrs: { 'aria-hidden': 'true' } }),
        h('span', { class: 'ls-wordmark', text: 'LiveSand' }),
      ]),
      this.picker.root,
      this.status.root,
      h('div', { class: 'ls-spacer' }),
      h('div', { class: 'ls-actions ls-glass' }, [
        viewToggle,
        speed,
        iconButton(ICONS.help, 'Help', () => this.help.toggle(), { kbd: 'H' }),
        iconButton(ICONS.fullscreen, 'Fullscreen', () => actions.toggleFullscreen(), { kbd: 'F', class: 'ls-fullscreen' }),
      ]),
      realButton,
    ]);
    this.toast.hidden = true;
    this.debugLine.hidden = true;
    this.root = h('div', { class: 'ls-hud' }, [
      topbar,
      this.chips.root,
      this.intro.root,
      this.dock.root,
      this.toast,
      this.debugLine,
      this.result.modal.root,
      this.help.root,
      this.real.root,
    ]);
  }

  update(s: HudSnapshot): void {
    this.picker.update(s);
    this.status.update(s);
    this.chips.update(s);
    this.dock.update(s);
    this.intro.update(s);
    this.result.update(s);
    if (this.view !== s.view) {
      this.view = s.view;
      for (const [v, btn] of this.viewButtons) {
        btn.classList.toggle('is-active', v === s.view);
        btn.setAttribute('aria-pressed', String(v === s.view));
      }
    }
    setText(this.speedText, `${s.speed}×`);
  }

  toggleHelp(): void {
    this.help.toggle();
  }

  /** Esc: closes the topmost overlay; returns false when nothing was open. */
  closeOverlays(): boolean {
    if (this.picker.close()) return true;
    for (const modal of [this.help, this.real, this.result.modal]) {
      if (modal.isOpen) {
        modal.close();
        return true;
      }
    }
    return false;
  }

  showToast(message: string, ms = 2200): void {
    setText(this.toast, message);
    setHidden(this.toast, false);
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => setHidden(this.toast, true), ms);
  }

  setDebugText(text: string | null): void {
    setHidden(this.debugLine, text === null);
    if (text !== null) setText(this.debugLine, text);
  }
}
