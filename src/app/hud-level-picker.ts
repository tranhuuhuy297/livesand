// Level picker: a pill showing the current level that opens a menu of levels plus free play.
import { BLANK_SANDBOX_LEVEL, isFreePlay, LEVELS, SANDBOX_LEVEL, type LevelDefinition } from '../game/level-definitions';
import { h, setText } from './hud-dom-helpers';
import { ICONS } from './hud-icons';
import type { HudActions, HudSnapshot } from './hud-snapshot';

export class LevelPicker {
  readonly root: HTMLDivElement;
  private readonly button: HTMLButtonElement;
  private readonly badge = h('span', { class: 'ls-level-badge' });
  private readonly label = h('span', { class: 'ls-level-name' });
  private readonly menu: HTMLDivElement;
  private readonly items = new Map<string, HTMLButtonElement>();
  private currentId = '';

  constructor(actions: HudActions) {
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
    this.menu = h('div', { class: 'ls-menu ls-glass', attrs: { role: 'menu', 'aria-label': 'Levels' } }, entries.map(([level, tag]) => {
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
    }));
    this.menu.hidden = true;
    this.root = h('div', { class: 'ls-level-picker' }, [this.button, this.menu]);
    document.addEventListener('pointerdown', (ev) => {
      if (!this.menu.hidden && !this.root.contains(ev.target as Node)) this.setOpen(false, false);
    });
  }

  update(s: HudSnapshot): void {
    if (this.currentId === s.level.id) return;
    this.currentId = s.level.id;
    const blank = s.level.id === BLANK_SANDBOX_LEVEL.id;
    setText(this.badge, s.levelIndex >= 0 ? String(s.levelIndex + 1) : blank ? '□' : '∞');
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
    if (open) (this.items.get(this.currentId) ?? this.menu.querySelector('button'))?.focus({ preventScroll: true });
  }
}

function describe(level: LevelDefinition): string {
  if (level.id === BLANK_SANDBOX_LEVEL.id) return 'An empty flat box: build everything yourself.';
  if (isFreePlay(level)) return 'Rivers to reshape, rain on demand. No clock.';
  const n = level.villages.length;
  const storm = level.storm.some((k) => k.rain > 0) ? ' · storm' : '';
  return `${n} ${n === 1 ? 'village' : 'villages'} · ${Math.round(level.durationSec)} s${storm}`;
}
