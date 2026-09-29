// Result list of the hometown search: one button per match (name + region), so same-named towns can be told apart.
import { h, setHidden } from './hud-dom-helpers';
import { ICONS } from './hud-icons';
import type { GeocodedPlace } from './place-name-geocoder';

export class PlaceSearchResults {
  readonly root: HTMLUListElement;

  constructor() {
    this.root = h('ul', { class: 'ls-place-results', attrs: { 'aria-label': 'Matching places' } });
    this.root.hidden = true;
  }

  /** Replaces the list; names and regions come from the network, so they are only ever set as text. */
  show(places: readonly GeocodedPlace[], onPick: (place: GeocodedPlace) => void): void {
    this.root.replaceChildren(...places.map((place) => {
      const btn = h('button', { class: 'ls-menu-item ls-place-result', attrs: { type: 'button' } }, [
        h('span', { class: 'ls-place-pin', html: ICONS.pin, attrs: { 'aria-hidden': 'true' } }),
        h('span', { class: 'ls-menu-text' }, [h('span', { class: 'ls-menu-title', text: place.name }), h('span', { class: 'ls-menu-sub', text: place.detail })]),
      ]);
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        onPick(place);
      });
      return h('li', {}, [btn]);
    }));
    setHidden(this.root, places.length === 0);
  }

  clear(): void {
    this.root.replaceChildren();
    setHidden(this.root, true);
  }

  focusFirst(): void {
    this.root.querySelector('button')?.focus({ preventScroll: true });
  }
}
