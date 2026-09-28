// Free-play top-bar actions in place of the level clock: a new landscape and a global rain toggle.
import { h, iconButton, setHidden, toggleClass } from './hud-dom-helpers';
import { ICONS } from './hud-icons';
import type { HudActions, HudSnapshot } from './hud-snapshot';

export class FreePlayActions {
  readonly root: HTMLDivElement;
  private readonly rain: HTMLButtonElement;
  private rainOn: boolean | null = null;

  constructor(actions: HudActions) {
    const terrain = iconButton(ICONS.shuffle, 'New terrain', () => actions.newTerrain(), { showLabel: true, class: 'ls-free-terrain' });
    this.rain = iconButton(ICONS.rain, 'Make it rain', () => actions.toggleRain(), { showLabel: true, class: 'ls-free-rain' });
    this.rain.setAttribute('aria-pressed', 'false');
    this.root = h('div', { class: 'ls-free-actions ls-glass', attrs: { role: 'group', 'aria-label': 'Free play' } }, [terrain, this.rain]);
    this.root.hidden = true;
  }

  update(s: HudSnapshot): void {
    setHidden(this.root, s.levelIndex >= 0);
    if (this.rainOn === s.freeRain) return;
    this.rainOn = s.freeRain;
    toggleClass(this.rain, 'is-active', s.freeRain);
    this.rain.setAttribute('aria-pressed', String(s.freeRain));
  }
}
