// Won/lost dialog: stars, advice that matches what the player tried, and (after a win) star + share prompts. It opens a
// moment after the end, docked and unblurred, so the flooded or burning village is seen first.
import { formatClock, h, iconButton, linkButton, setHidden, setText } from './hud-dom-helpers';
import { ICONS } from './hud-icons';
import { PROJECT_REPO_URL } from './hud-info-dialogs';
import { HudModal } from './hud-modal';
import type { HudActions, HudSnapshot } from './hud-snapshot';

const LOST_IDLE = 'The water swallowed every village. Dig a channel to the sea or build a levee, then try again.';
const LOST_TRIED = 'So close! Water still reached the village. Go over your channel again to dig it deeper, or pile the levee higher.';
const BURNED_IDLE = 'The lava reached the village. Build a wall across its path, or dig a trench to lead it away, then try again.';
const BURNED_TRIED = 'So close! The lava still found a way through. Make the wall longer and higher, or dig the trench deeper.';
/** Real seconds between the end of an attempt and the result card, with the simulation still drawing. */
export const RESULT_REVEAL_DELAY_SEC = 1.8;

export class ResultDialog {
  readonly modal: HudModal;
  private readonly stars: HTMLElement[];
  private readonly title = h('h2', { class: 'ls-modal-title' });
  private readonly text = h('p', { class: 'ls-modal-lead' });
  private readonly next: HTMLButtonElement;
  private readonly retry: HTMLButtonElement;
  private readonly share: HTMLDivElement;
  private readonly star: HTMLAnchorElement;
  private shownFor = '';

  constructor(actions: HudActions) {
    this.modal = new HudModal('ls-result', 'Level result');
    this.stars = [0, 1, 2].map(() => h('span', { class: 'ls-star', html: ICONS.star, attrs: { 'aria-hidden': 'true' } }));
    this.retry = iconButton(ICONS.retry, 'Retry', () => actions.resetLevel(), { class: 'ls-btn-secondary', showLabel: true, kbd: 'R' });
    this.next = iconButton(ICONS.next, 'Next level', () => actions.nextLevel(), { class: 'ls-btn-primary', showLabel: true });
    const freePlay = iconButton(ICONS.raise, 'Free play', () => actions.leaveLevel(), { class: 'ls-btn-ghost', showLabel: true });
    this.star = linkButton(ICONS.github, 'Star on GitHub', PROJECT_REPO_URL, 'ls-btn-secondary ls-star-link');
    const copy = iconButton(ICONS.share, 'Share', () => actions.shareLevel(), { class: 'ls-btn-ghost ls-result-share', showLabel: true });
    this.share = h('div', { class: 'ls-share' }, [
      h('p', { class: 'ls-share-text', text: 'Enjoying LiveSand? A star helps other people find it.' }),
      h('div', { class: 'ls-modal-actions' }, [copy, this.star]),
    ]);
    this.modal.body.append(
      h('div', { class: 'ls-stars' }, this.stars),
      this.title,
      this.text,
      h('div', { class: 'ls-modal-actions' }, [freePlay, this.retry, this.next]),
      this.share,
    );
  }

  /** Opens once per finished attempt, RESULT_REVEAL_DELAY_SEC after it ends; closing it keeps the map on screen. */
  update(s: HudSnapshot): void {
    const finished = s.phase === 'won' || s.phase === 'lost';
    if (!finished) {
      this.shownFor = '';
      this.modal.close();
      return;
    }
    if (s.endedSec < RESULT_REVEAL_DELAY_SEC) return;
    const key = `${s.level.id}:${s.phase}`;
    if (this.shownFor === key) return;
    this.shownFor = key;
    const { saved, total, stars } = s.summary;
    this.stars.forEach((star, i) => star.classList.toggle('is-lit', i < stars));
    this.modal.root.dataset.outcome = s.phase;
    const won = s.phase === 'won';
    const lava = Boolean(s.level.eruption);
    const burned = s.villages.some((v) => v.lostTo === 'lava');
    const lostTitle = burned ? 'Burned!' : 'Flooded!';
    setText(this.title, won ? (saved === total ? 'Every village is safe!' : lava ? 'You held back the lava' : 'You held back the flood') : lostTitle);
    const kept = `${saved} of ${total} ${total === 1 ? 'village' : 'villages'} kept ${lava ? 'safe' : 'dry'} for ${formatClock(s.level.durationSec)}.`;
    const lostText = burned ? (s.sculpted ? BURNED_TRIED : BURNED_IDLE) : s.sculpted ? LOST_TRIED : LOST_IDLE;
    setText(this.text, won ? kept : lostText);
    const hasNext = won && s.levelIndex >= 0 && s.levelIndex < s.levelCount - 1;
    setHidden(this.next, !hasNext);
    setHidden(this.share, !won);
    // After the last level the star is the natural next step; otherwise "Next level" stays the primary action.
    const starFirst = won && !hasNext;
    this.star.classList.toggle('ls-btn-primary', starFirst);
    this.star.classList.toggle('ls-btn-secondary', !starFirst);
    this.retry.classList.toggle('ls-btn-primary', !won);
    this.retry.classList.toggle('ls-btn-secondary', won);
    this.modal.open(starFirst ? this.star : undefined);
  }
}
