// "Your hometown" dialog: the player's location (geolocation, named by reverse geocoding), a town searched by name, or
// typed coordinates, plus a map width, become real terrain loaded from live elevation tiles. Every answer that arrives
// after the dialog was closed or a newer choice was made is dropped.
import { h, iconButton, setHidden, setText } from './hud-dom-helpers';
import { ICONS } from './hud-icons';
import { HudModal } from './hud-modal';
import { PlaceSearchResults } from './hud-place-search-results';
import { reverseGeocode, searchPlaces, type GeocodedPlace } from './place-name-geocoder';
import { coarsenDeviceLocation, LIVE_PLACE_WIDTH_DEFAULT_KM, LIVE_PLACE_WIDTH_MAX_KM, LIVE_PLACE_WIDTH_MIN_KM, parseLatLon } from './place-url-param';

const GEOLOCATION_TIMEOUT_MS = 15_000;

export type LoadPlace = (lat: number, lon: number, widthKm: number, name: string | null) => void;

export class AnyPlaceDialog {
  readonly modal: HudModal;
  private readonly query: HTMLInputElement;
  private readonly width: HTMLInputElement;
  private readonly widthText = h('span', { class: 'ls-place-width-value' });
  private readonly status = h('p', { class: 'ls-place-error', attrs: { role: 'alert' } });
  private readonly locate: HTMLButtonElement;
  private readonly results = new PlaceSearchResults();
  private readonly onLoad: LoadPlace;
  // Bumped on open, close and every new choice: late geolocation fixes and search answers compare against it.
  private requestId = 0;
  private search: AbortController | null = null;

  constructor(onLoad: LoadPlace) {
    this.onLoad = onLoad;
    this.modal = new HudModal('ls-any-place', 'Your hometown', { onClose: () => this.cancelPending() });
    this.locate = iconButton(ICONS.locate, 'Use my location', () => this.useMyLocation(), { class: 'ls-btn-primary ls-btn-lg ls-place-locate', showLabel: true });
    this.query = h('input', {
      class: 'ls-text-input',
      attrs: { type: 'search', enterkeyhint: 'search', autocomplete: 'off', spellcheck: 'false', placeholder: 'Town, city or 16.05, 108.21', 'aria-label': 'Search a town, or type latitude, longitude' },
    });
    this.width = h('input', {
      class: 'ls-place-range',
      attrs: { type: 'range', min: String(LIVE_PLACE_WIDTH_MIN_KM), max: String(LIVE_PLACE_WIDTH_MAX_KM), step: '1', value: String(LIVE_PLACE_WIDTH_DEFAULT_KM), 'aria-label': 'Map width in kilometres' },
    });
    this.width.addEventListener('input', () => this.syncWidth());
    const find = h('button', { class: 'ls-btn ls-btn-secondary ls-place-search', attrs: { type: 'submit' } }, [
      h('span', { class: 'ls-icon', html: ICONS.search, attrs: { 'aria-hidden': 'true' } }),
      h('span', { class: 'ls-btn-label', text: 'Search' }),
    ]);
    const form = h('form', { class: 'ls-place-form', attrs: { novalidate: '', role: 'search' } }, [
      this.locate,
      h('div', { class: 'ls-place-or', text: 'or search for it' }),
      h('div', { class: 'ls-place-query' }, [this.query, find]),
      this.results.root,
      this.status,
      h('label', { class: 'ls-field' }, [h('span', { class: 'ls-field-label' }, [h('span', { text: 'Map width ' }), this.widthText]), this.width]),
    ]);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      void this.submit();
    });
    // Global shortcuts ignore text fields, so Esc inside the search box is handled here.
    form.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') this.modal.close();
    });
    this.modal.body.append(
      h('h2', { class: 'ls-modal-title', text: 'Your hometown' }),
      h('p', { class: 'ls-modal-lead', text: 'Real elevation for any town on Earth. Make it rain, flood it, then share the map.' }),
      form,
      h('p', { class: 'ls-place-credit', text: 'Place search by Photon, © OpenStreetMap contributors. Elevation by Mapzen Terrain Tiles.' }),
    );
    this.syncWidth();
    this.showStatus(null);
  }

  open(): void {
    this.requestId++;
    this.results.clear();
    this.showStatus(null);
    // Keyboards type a name; touch screens start from the big location button instead of popping up a keyboard.
    this.modal.open(window.matchMedia?.('(pointer: fine)').matches ? this.query : this.locate);
  }

  private get widthKm(): number {
    return Number(this.width.value);
  }

  private syncWidth(): void {
    setText(this.widthText, `${this.width.value} km`);
    const pct = ((this.widthKm - LIVE_PLACE_WIDTH_MIN_KM) / (LIVE_PLACE_WIDTH_MAX_KM - LIVE_PLACE_WIDTH_MIN_KM)) * 100;
    this.width.style.setProperty('--fill', `${pct.toFixed(1)}%`);
  }

  private showStatus(message: string | null): void {
    setHidden(this.status, message === null);
    setText(this.status, message ?? '');
  }

  /** Drops whatever is still on its way (search answers, a geolocation fix) and frees the locate button. */
  private cancelPending(): void {
    this.requestId++;
    this.search?.abort();
    this.search = null;
    this.locate.disabled = false;
  }

  private load(lat: number, lon: number, widthKm: number, name: string | null): void {
    this.modal.close();
    this.onLoad(lat, lon, widthKm, name);
  }

  /** Typed coordinates load at once; anything else is a place-name search. */
  private async submit(): Promise<void> {
    const text = this.query.value.trim();
    const at = parseLatLon(text);
    if (at) return this.load(at.lat, at.lon, this.widthKm, null);
    if (!text) {
      this.showStatus('Type a town name, or a latitude and longitude such as 16.05, 108.21.');
      this.query.focus();
      return;
    }
    this.cancelPending();
    const id = this.requestId;
    const controller = new AbortController();
    this.search = controller;
    this.results.clear();
    this.showStatus('Searching…');
    try {
      const places = await searchPlaces(text, controller.signal);
      if (id !== this.requestId) return;
      this.showStatus(places.length ? null : `No places found for "${text}". Try another spelling, or coordinates.`);
      this.results.show(places, (p: GeocodedPlace) => this.load(p.lat, p.lon, p.widthKm ?? this.widthKm, p.name));
      if (places.length) this.results.focusFirst();
    } catch {
      if (id === this.requestId) this.showStatus('Place search is not reachable right now. Use your location or type coordinates.');
    }
  }

  private useMyLocation(): void {
    if (!('geolocation' in navigator)) {
      this.showStatus('This browser cannot share its location. Search for your town instead.');
      return;
    }
    this.cancelPending();
    const id = this.requestId;
    this.locate.disabled = true;
    this.results.clear();
    this.showStatus('Finding where you are…');
    const stale = () => id !== this.requestId || !this.modal.isOpen;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { lat, lon } = coarsenDeviceLocation(pos.coords.latitude, pos.coords.longitude);
        void this.loadLocation(lat, lon, stale);
      },
      (err) => {
        if (stale()) return;
        this.locate.disabled = false;
        this.showStatus(err.code === err.PERMISSION_DENIED ? 'Location access was denied. Search for your town instead.' : `Could not get your location (${err.message}).`);
      },
      { enableHighAccuracy: false, timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: 600_000 },
    );
  }

  /** Names the fix by reverse geocoding (best effort: the map loads with coordinates when that fails). */
  private async loadLocation(lat: number, lon: number, stale: () => boolean): Promise<void> {
    if (stale()) return;
    this.showStatus('Naming the map…');
    const name = await reverseGeocode(lat, lon).catch(() => null);
    if (stale()) return;
    this.locate.disabled = false;
    this.load(lat, lon, this.widthKm, name);
  }
}
