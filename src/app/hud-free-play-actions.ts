// Free-play top-bar actions in place of the level clock: a new landscape and a global rain toggle; on real places the
// landscape button gives way to a labelled Share (a random landscape would silently throw the real map away).
import { isFreePlay } from '../game/level-definitions';
import { h, iconButton, setHidden, toggleClass } from './hud-dom-helpers';
import { ICONS } from './hud-icons';
import type { HudActions, HudSnapshot } from './hud-snapshot';

export class FreePlayActions {
  readonly root: HTMLDivElement;
  private readonly terrain: HTMLButtonElement;
  private readonly rain: HTMLButtonElement;
  private readonly share: HTMLButtonElement;
  private rainOn: boolean | null = null;

  constructor(actions: HudActions) {
    this.terrain = iconButton(ICONS.shuffle, 'New terrain', () => actions.newTerrain(), { showLabel: true, class: 'ls-free-terrain' });
    this.rain = iconButton(ICONS.rain, 'Make it rain', () => actions.toggleRain(), { showLabel: true, class: 'ls-free-rain' });
    this.rain.setAttribute('aria-pressed', 'false');
    this.share = iconButton(ICONS.share, 'Share', () => actions.shareLevel(), { showLabel: true, class: 'ls-free-share' });
    this.share.hidden = true;
    this.root = h('div', { class: 'ls-free-actions ls-glass', attrs: { role: 'group', 'aria-label': 'Free play' } }, [this.terrain, this.rain, this.share]);
    this.root.hidden = true;
  }

  update(s: HudSnapshot): void {
    setHidden(this.root, !isFreePlay(s.level));
    const real = Boolean(s.place?.link);
    setHidden(this.terrain, real);
    setHidden(this.share, !real);
    if (this.rainOn === s.freeRain) return;
    this.rainOn = s.freeRain;
    toggleClass(this.rain, 'is-active', s.freeRain);
    this.rain.setAttribute('aria-pressed', String(s.freeRain));
  }
}
