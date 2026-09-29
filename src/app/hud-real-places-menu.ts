// "Real places" section of the level menu: the baked catalogue (Vietnamese names for places in Vietnam) plus a
// "Your hometown…" entry that opens the place search dialog.
import { placeDisplayName, placeLevelId } from '../game/real-place-levels';
import { REAL_PLACES } from '../game/real-places-catalog';
import { h } from './hud-dom-helpers';
import { ICONS } from './hud-icons';

export interface RealPlacesMenu {
  root: HTMLElement;
  /** Menu items keyed by the level id they load ('place-<id>', 'place-custom'). */
  items: Map<string, HTMLButtonElement>;
}

export function createRealPlacesMenu(onPlace: (id: string, byKeyboard: boolean) => void, onAnyPlace: (byKeyboard: boolean) => void): RealPlacesMenu {
  const items = new Map<string, HTMLButtonElement>();
  const item = (id: string, title: string, sub: string, hint: string, onPick: (byKeyboard: boolean) => void, wide = false): HTMLButtonElement => {
    const btn = h('button', {
      class: `ls-menu-item ls-place-item${wide ? ' is-wide' : ''}`,
      title: hint,
      attrs: { type: 'button', role: 'menuitemradio', 'aria-checked': 'false', 'data-place': id },
    }, [
      h('span', { class: 'ls-place-pin', html: wide ? ICONS.globe : ICONS.pin, attrs: { 'aria-hidden': 'true' } }),
      h('span', { class: 'ls-menu-text' }, [h('span', { class: 'ls-menu-title', text: title }), h('span', { class: 'ls-menu-sub', text: sub })]),
    ]);
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      onPick(ev.detail === 0);
    });
    items.set(id, btn);
    return btn;
  };
  const places = REAL_PLACES.map((p) => {
    const name = placeDisplayName(p);
    // The English name only helps where it differs from the Vietnamese one ("Fansipan"), not for "Hue" under "Huế".
    const sub = p.nameVi && foldAccents(p.nameVi) !== foldAccents(p.name) ? p.name : p.country;
    return item(placeLevelId({ id: p.id }), name, sub, `${name}, ${p.country}: ${p.blurb}`, (kb) => onPlace(p.id, kb));
  });
  const anyPlace = item(placeLevelId({ lat: 0, lon: 0, widthKm: 1 }), 'Your hometown…', 'Search any town, or use your location', 'Real terrain for any place on Earth', onAnyPlace, true);
  const root = h('div', { class: 'ls-menu-section', attrs: { role: 'group', 'aria-label': 'Real places' } }, [
    h('div', { class: 'ls-menu-heading', text: 'Real places' }),
    h('div', { class: 'ls-place-grid' }, [...places, anyPlace]),
  ]);
  return { root, items };
}

/** Lower-case ASCII letters and digits only: "Phan Xi Păng" -> "phanxipang", "Đà Nẵng" -> "danang". */
export function foldAccents(text: string): string {
  return text.normalize('NFD').replace(/[đĐ]/g, 'd').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}
