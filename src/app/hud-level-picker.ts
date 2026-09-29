// Level picker: a pill showing the current level that opens a menu of levels, free play and real places.
import { BLANK_SANDBOX_LEVEL, isFreePlay, LEVELS, SANDBOX_LEVEL, type LevelDefinition } from '../game/level-definitions';
import { h, setText } from './hud-dom-helpers';
import { ICONS } from './hud-icons';
import { createRealPlacesMenu } from './hud-real-places-menu';
import type { HudActions, HudSnapshot } from './hud-snapshot';

export class LevelPicker {
  readonly root: HTMLDivElement;
  private readonly button: HTMLButtonElement;
  private readonly badge = h('span', { class: 'ls-level-badge' });
  private readonly label = h('span', { class: 'ls-level-name' });
  private readonly menu: HTMLDivElement;
  private readonly items = new Map<string, HTMLButtonElement>();
  private currentId = '';
  // Compared by object: every hometown map shares the id 'place-custom' but has its own name.
  private shown: LevelDefinition | null = null;

  /** `onAnyPlace` opens the hometown dialog (owned by the HUD). */
  constructor(actions: HudActions, onAnyPlace: () => void) {
    this.button = h('button', {
      class: 'ls-btn ls-level-button',
      title: 'Choose a level',
      attrs: { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' },
    }, [this.badge, this.label, h('span', { class: 'ls-icon ls-chevron', html: ICONS.chevron, attrs: { 'aria-hidden': 'true' } })]);
    this.button.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (ev.detail > 0) this.button.blur();
      this.setOpen(this.menu.hidden !== false);
    });

    const entries: [LevelDefinition, string][] = LEVELS.map((level, i) => [level, String(i + 1)]);
    entries.push([SANDBOX_LEVEL, '∞'], [BLANK_SANDBOX_LEVEL, '□']);
    const levelItems = entries.map(([level, tag]) => {
      const item = h('button', { class: 'ls-menu-item', attrs: { type: 'button', role: 'menuitemradio', 'aria-checked': 'false' } }, [
        h('span', { class: 'ls-level-badge', text: tag }),
        h('span', { class: 'ls-menu-text' }, [
          h('span', { class: 'ls-menu-title', text: level.name }),
          h('span', { class: 'ls-menu-sub', text: describe(level) }),
        ]),
      ]);
      item.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.setOpen(false, ev.detail === 0);
        actions.selectLevel(level.id);
      });
      this.items.set(level.id, item);
      return item;
    });
    const places = createRealPlacesMenu(
      (id, byKeyboard) => {
        this.setOpen(false, byKeyboard);
        actions.selectPlace(id);
      },
      (byKeyboard) => {
        this.setOpen(false, byKeyboard);
        onAnyPlace();
      },
    );
    for (const [id, item] of places.items) this.items.set(id, item);
    this.menu = h('div', { class: 'ls-menu ls-glass', attrs: { role: 'menu', 'aria-label': 'Levels' } }, [...levelItems, places.root]);
    this.menu.hidden = true;
    this.root = h('div', { class: 'ls-level-picker' }, [this.button, this.menu]);
    document.addEventListener('pointerdown', (ev) => {
      if (!this.menu.hidden && !this.root.contains(ev.target as Node)) this.setOpen(false, false);
    });
  }

  update(s: HudSnapshot): void {
    if (this.shown === s.level) return;
    this.shown = s.level;
    this.currentId = s.level.id;
    if (s.levelIndex >= 0) setText(this.badge, String(s.levelIndex + 1));
    else if (s.level.place) this.badge.innerHTML = ICONS.pin;
    else setText(this.badge, s.level.id === BLANK_SANDBOX_LEVEL.id ? '□' : '∞');
    this.badge.classList.toggle('is-place', s.levelIndex < 0 && Boolean(s.level.place));
    setText(this.label, s.level.name);
    for (const [id, item] of this.items) item.setAttribute('aria-checked', String(id === s.level.id));
  }

  get isOpen(): boolean {
    return !this.menu.hidden;
  }

  /** Closes the menu; returns whether it was open (for Esc handling). */
  close(): boolean {
    const wasOpen = !this.menu.hidden;
    this.setOpen(false);
    return wasOpen;
  }

  private setOpen(open: boolean, restoreFocus = true): void {
    // Keyboard users closing the menu (Esc, Enter on an item) land back on the picker, not on <body>.
    if (!open && restoreFocus && this.menu.contains(document.activeElement)) this.button.focus({ preventScroll: true });
    this.menu.hidden = !open;
    this.button.setAttribute('aria-expanded', String(open));
    if (open) this.keepMenuOnScreen();
    if (open) (this.items.get(this.currentId) ?? this.menu.querySelector('button'))?.focus({ preventScroll: true });
  }

  /** Phones: the menu hangs off the picker, which sits right of the logo, so pull it back inside the right edge. */
  private keepMenuOnScreen(): void {
    this.menu.style.left = '';
    const rect = this.menu.getBoundingClientRect();
    const overflow = rect.right - (window.innerWidth - 8);
    if (overflow > 0) this.menu.style.left = `${-Math.min(overflow, Math.max(0, rect.left - 8))}px`;
  }
}

function describe(level: LevelDefinition): string {
  if (level.id === BLANK_SANDBOX_LEVEL.id) return 'An empty flat box: build everything yourself.';
  if (isFreePlay(level)) return 'Rivers to reshape, rain on demand. No clock.';
  const n = level.villages.length;
  const hazard = level.eruption ? ' · eruption' : level.storm.some((k) => k.rain > 0) ? ' · storm' : '';
  const real = level.place ? ' · real map' : '';
  return `${n} ${n === 1 ? 'village' : 'villages'} · ${Math.round(level.durationSec)} s${hazard}${real}`;
}
