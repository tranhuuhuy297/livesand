// Place card: when a real map opens, its description (touch screens never see tooltips) and what to try there: "Flood
// it" (a storm on the player's town), rain, lava, and the place's own challenge level when it has one.
import { isFreePlay, LEVELS, type LevelDefinition } from '../game/level-definitions';
import { findRealPlace } from '../game/real-places-catalog';
import { h, iconButton, setHidden, setText } from './hud-dom-helpers';
import { ICONS } from './hud-icons';
import type { HudActions, HudSnapshot } from './hud-snapshot';

/** The challenge level built on a catalogue place ('hoi-an' -> Hội An Floods), if any. */
export function challengeForPlace(placeId: string): LevelDefinition | undefined {
  return LEVELS.find((level) => level.place !== undefined && 'id' in level.place && level.place.id === placeId);
}

export class PlaceIntroCard {
  readonly root: HTMLDivElement;
  private readonly eyebrow = h('div', { class: 'ls-eyebrow' });
  private readonly title = h('h2', { class: 'ls-card-title' });
  private readonly text = h('p', { class: 'ls-card-text' });
  private readonly challenge: HTMLButtonElement;
  private challengeId = '';
  private shownFor: LevelDefinition | null = null;
  // Closed (or acted on) for this map; a new map brings the card back.
  private dismissedFor: LevelDefinition | null = null;

  constructor(actions: HudActions) {
    const act = (fn: () => void) => () => {
      this.dismissedFor = this.shownFor;
      fn();
    };
    const flood = iconButton(ICONS.storm, 'Flood it', act(() => actions.floodPlace()), { class: 'ls-btn-primary ls-place-flood', showLabel: true });
    const rain = iconButton(ICONS.rain, 'Make it rain', act(() => actions.toggleRain()), { class: 'ls-btn-secondary', showLabel: true });
    const lava = iconButton(ICONS.volcano, 'Pour lava', act(() => actions.setTool('lava')), { class: 'ls-btn-secondary', showLabel: true });
    this.challenge = iconButton(ICONS.play, 'Play the challenge', act(() => actions.selectLevel(this.challengeId)), { class: 'ls-btn-secondary ls-place-challenge', showLabel: true });
    const close = iconButton(ICONS.close, 'Close', act(() => undefined), { class: 'ls-btn-ghost ls-place-card-close' });
    this.root = h('div', { class: 'ls-place-card ls-glass', attrs: { role: 'region', 'aria-label': 'About this place' } }, [
      close,
      h('div', { class: 'ls-intro-text' }, [this.eyebrow, this.title, this.text]),
      h('div', { class: 'ls-place-card-actions' }, [flood, rain, lava, this.challenge]),
    ]);
    this.root.hidden = true;
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  update(s: HudSnapshot): void {
    const link = s.place?.link ?? null;
    const show = link !== null && isFreePlay(s.level) && s.hasFreePlace && this.dismissedFor !== s.level;
    setHidden(this.root, !show);
    if (!show || this.shownFor === s.level) return;
    this.shownFor = s.level;
    const place = link.kind === 'place' ? findRealPlace(link.id) : undefined;
    setText(this.eyebrow, place ? `Real place · ${place.country}` : 'Your map');
    setText(this.title, s.level.name);
    setText(this.text, s.level.tagline);
    const level = place ? challengeForPlace(place.id) : undefined;
    this.challengeId = level?.id ?? '';
    setHidden(this.challenge, !level);
    const label = this.challenge.querySelector<HTMLElement>('.ls-btn-label');
    if (!level || !label) return;
    setText(label, `Play ${level.name}`);
    this.challenge.title = `Play ${level.name}`;
    this.challenge.setAttribute('aria-label', this.challenge.title);
  }
}
