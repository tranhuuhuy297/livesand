// Place names <-> coordinates through Photon (komoot's free OpenStreetMap geocoder, CORS-enabled): search by name for
// the hometown dialog, and a reverse lookup so "Use my location" maps get a real name instead of raw coordinates.
import { anyAbortSignal } from './place-terrain-loader';
import { cleanPlaceName, clampPlaceWidthKm } from './place-url-param';

export const PHOTON_URL = 'https://photon.komoot.io';
export const GEOCODER_TIMEOUT_MS = 8000;
const MAX_RESULTS = 6;
// Map width for a searched town: its bounding box plus a margin, so the whole town and its surroundings fit.
const EXTENT_MARGIN = 1.3;
const MIN_TOWN_WIDTH_KM = 6;

export interface GeocodedPlace {
  name: string;
  /** "Quảng Nam, Vietnam": what tells same-named places apart. */
  detail: string;
  lat: number;
  lon: number;
  /** Suggested map width from the place's extent, or null (a point such as a peak). */
  widthKm: number | null;
}

interface PhotonProperties {
  name?: string;
  type?: string;
  city?: string;
  district?: string;
  county?: string;
  state?: string;
  country?: string;
  extent?: number[];
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

function features(json: unknown): { lat: number; lon: number; props: PhotonProperties }[] {
  const list = (json as { features?: unknown })?.features;
  if (!Array.isArray(list)) return [];
  return list.flatMap((f) => {
    const coords = (f as { geometry?: { coordinates?: unknown } })?.geometry?.coordinates;
    const props = ((f as { properties?: unknown })?.properties ?? {}) as PhotonProperties;
    if (!Array.isArray(coords) || coords.length < 2) return [];
    const [lon, lat] = coords.map(Number);
    return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [{ lat, lon, props }] : [];
  });
}

function extentWidthKm(extent: number[] | undefined, lat: number): number | null {
  if (!Array.isArray(extent) || extent.length !== 4 || !extent.every(Number.isFinite)) return null;
  const [west, north, east, south] = extent;
  const across = Math.abs(east - west) * 111.32 * Math.cos((lat * Math.PI) / 180);
  // The map is 4:3, so a tall town needs 4/3 of its height across.
  const tall = Math.abs(north - south) * 110.57 * (4 / 3);
  const km = Math.max(across, tall) * EXTENT_MARGIN;
  return km > 0 ? Math.round(clampPlaceWidthKm(Math.max(MIN_TOWN_WIDTH_KM, km))) : null;
}

/** Photon GeoJSON -> named places (entries without a usable name or position are dropped). */
export function parsePhotonResults(json: unknown): GeocodedPlace[] {
  const out: GeocodedPlace[] = [];
  for (const { lat, lon, props } of features(json)) {
    const name = cleanPlaceName(str(props.name) ?? str(props.city) ?? str(props.county) ?? str(props.state));
    if (!name) continue;
    const parts = [str(props.city), str(props.county), str(props.state), str(props.country)].filter((p): p is string => p !== undefined && p !== name);
    out.push({ name, detail: [...new Set(parts)].join(', '), lat, lon, widthKm: extentWidthKm(props.extent, lat) });
  }
  return out.slice(0, MAX_RESULTS);
}

/** Town-level name for a reverse lookup: the town itself, else the town the point lies in. */
export function parsePhotonReverseName(json: unknown): string | null {
  const first = features(json)[0]?.props;
  if (!first) return null;
  const town = first.type === 'city' || first.type === 'town' ? str(first.name) : undefined;
  return cleanPlaceName(town ?? str(first.city) ?? str(first.district) ?? str(first.county) ?? str(first.state) ?? str(first.name));
}

async function getJson(url: string, signal: AbortSignal | undefined, fetchImpl: typeof fetch): Promise<unknown> {
  const timeout = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(GEOCODER_TIMEOUT_MS) : undefined;
  const res = await fetchImpl(url, { signal: anyAbortSignal([signal, timeout]), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`place search failed (HTTP ${res.status})`);
  return res.json();
}

export async function searchPlaces(query: string, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<GeocodedPlace[]> {
  const q = query.trim();
  if (!q) return [];
  return parsePhotonResults(await getJson(`${PHOTON_URL}/api/?q=${encodeURIComponent(q)}&limit=${MAX_RESULTS}`, signal, fetchImpl));
}

export async function reverseGeocode(lat: number, lon: number, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  return parsePhotonReverseName(await getJson(`${PHOTON_URL}/reverse?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&limit=1`, signal, fetchImpl));
}
