// Level intro card (ready phase) and the won/lost result dialog with stars.
import type { LevelDefinition } from '../game/level-definitions';
import { formatClock, h, iconButton, setHidden, setText } from './hud-dom-helpers';
import { ICONS } from './hud-icons';
import { HudModal } from './hud-modal';
import { peakStormRain, type HudActions, type HudSnapshot } from './hud-snapshot';

export class LevelIntroCard {
  readonly root: HTMLDivElement;
  private readonly eyebrow = h('div', { class: 'ls-eyebrow' });
  private readonly title = h('h2', { class: 'ls-card-title' });
  private readonly tagline = h('p', { class: 'ls-card-text' });
  private readonly facts = h('div', { class: 'ls-facts' });
  private levelId = '';

  constructor(actions: HudActions) {
    const start = iconButton(ICONS.play, 'Start', () => actions.startLevel(), { class: 'ls-btn-primary ls-btn-lg', showLabel: true, kbd: 'Enter' });
    start.append(h('kbd', { class: 'ls-kbd-hint', text: 'Enter' }));
    this.root = h('div', { class: 'ls-intro ls-glass', attrs: { role: 'region', 'aria-label': 'Level briefing' } }, [
      h('div', { class: 'ls-intro-text' }, [this.eyebrow, this.title, this.tagline, this.facts]),
      h('div', { class: 'ls-intro-actions' }, [start, h('span', { class: 'ls-muted', text: 'or just start digging' })]),
    ]);
    this.root.hidden = true;
  }

  update(s: HudSnapshot): void {
    const show = s.phase === 'ready' && s.level.villages.length > 0;
    setHidden(this.root, !show);
    if (!show || this.levelId === s.level.id) return;
    this.levelId = s.level.id;
    setText(this.eyebrow, s.levelIndex >= 0 ? `Level ${s.levelIndex + 1} of ${s.levelCount}` : 'Challenge');
    setText(this.title, s.level.name);
    setText(this.tagline, s.level.tagline);
    this.facts.replaceChildren(...levelFacts(s.level));
  }
}

function levelFacts(level: LevelDefinition): HTMLElement[] {
  const fact = (icon: string, text: string): HTMLElement =>
    h('span', { class: 'ls-fact' }, [h('span', { class: 'ls-icon', html: icon, attrs: { 'aria-hidden': 'true' } }), h('span', { text })]);
  const n = level.villages.length;
  const facts = [fact(ICONS.house, `${n} ${n === 1 ? 'village' : 'villages'}`), fact(ICONS.clock, `Hold for ${formatClock(level.durationSec)}`)];
  if (peakStormRain(level) > 0) facts.push(fact(ICONS.storm, 'Storm incoming'));
  return facts;
}

export class ResultDialog {
  readonly modal: HudModal;
  private readonly stars: HTMLElement[];
  private readonly title = h('h2', { class: 'ls-modal-title' });
  private readonly text = h('p', { class: 'ls-modal-lead' });
  private readonly next: HTMLButtonElement;
  private readonly retry: HTMLButtonElement;
  private shownFor = '';

  constructor(actions: HudActions) {
    this.modal = new HudModal('ls-result', 'Level result');
    this.stars = [0, 1, 2].map(() => h('span', { class: 'ls-star', html: ICONS.star, attrs: { 'aria-hidden': 'true' } }));
    this.retry = iconButton(ICONS.retry, 'Retry', () => actions.resetLevel(), { class: 'ls-btn-secondary', showLabel: true, kbd: 'R' });
    this.next = iconButton(ICONS.next, 'Next level', () => actions.nextLevel(), { class: 'ls-btn-primary', showLabel: true });
    const freePlay = iconButton(ICONS.raise, 'Free play', () => actions.selectLevel('sandbox'), { class: 'ls-btn-ghost', showLabel: true });
    this.modal.body.append(
      h('div', { class: 'ls-stars' }, this.stars),
      this.title,
      this.text,
      h('div', { class: 'ls-modal-actions' }, [freePlay, this.retry, this.next]),
    );
  }

  /** Opens once per finished attempt; closing it keeps the finished map on screen until the next attempt. */
  update(s: HudSnapshot): void {
    const finished = s.phase === 'won' || s.phase === 'lost';
    if (!finished) {
      this.shownFor = '';
      this.modal.close();
      return;
    }
    const key = `${s.level.id}:${s.phase}`;
    if (this.shownFor === key) return;
    this.shownFor = key;
    const { saved, total, stars } = s.summary;
    this.stars.forEach((star, i) => star.classList.toggle('is-lit', i < stars));
    this.modal.root.dataset.outcome = s.phase;
    const won = s.phase === 'won';
    setText(this.title, won ? (saved === total ? 'Every village is safe!' : 'You held back the flood') : 'Flooded!');
    setText(
      this.text,
      won
        ? `${saved} of ${total} ${total === 1 ? 'village' : 'villages'} kept dry for ${formatClock(s.level.durationSec)}.`
        : 'The water swallowed every village. Dig a channel to the sea or build a levee, then try again.',
    );
    const hasNext = won && s.levelIndex >= 0 && s.levelIndex < s.levelCount - 1;
    setHidden(this.next, !hasNext);
    this.retry.classList.toggle('ls-btn-primary', !hasNext);
    this.retry.classList.toggle('ls-btn-secondary', hasNext);
    this.modal.open();
  }
}
