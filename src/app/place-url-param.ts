// Shareable ?place= values: a catalogue id ("ha-long-bay") or live coordinates ("lat,lon[,widthKm]"), plus an optional
// &name= so a shared hometown map opens with its name instead of raw coordinates.
import { findRealPlace } from '../game/real-places-catalog';

export type PlaceRequest = { kind: 'place'; id: string } | { kind: 'live'; lat: number; lon: number; widthKm: number; name?: string };

/** Longest place name kept from a link or a search result. */
export const PLACE_NAME_MAX_CHARS = 60;

export const LIVE_PLACE_WIDTH_DEFAULT_KM = 20;
export const LIVE_PLACE_WIDTH_MIN_KM = 2;
export const LIVE_PLACE_WIDTH_MAX_KM = 100;
// Terrain tiles use Web Mercator, which stops being usable near the poles.
const MAX_ABS_LAT = 80;

const round = (n: number, digits: number): number => Number(n.toFixed(digits));

/** Device fixes are coarsened to 0.01° (~1 km) before any lookup or link, so a shared map never pins a home. */
export function coarsenDeviceLocation(lat: number, lon: number): { lat: number; lon: number } {
  return { lat: round(lat, 2), lon: round(lon, 2) };
}

export function clampPlaceWidthKm(km: number): number {
  if (!Number.isFinite(km)) return LIVE_PLACE_WIDTH_DEFAULT_KM;
  return Math.min(LIVE_PLACE_WIDTH_MAX_KM, Math.max(LIVE_PLACE_WIDTH_MIN_KM, km));
}

/** "16.047, 108.206" (commas or spaces); null unless both numbers are valid coordinates. */
export function parseLatLon(text: string): { lat: number; lon: number } | null {
  const parts = text.trim().split(/[\s,;]+/).filter(Boolean);
  if (parts.length !== 2) return null;
  const [lat, lon] = parts.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > MAX_ABS_LAT || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/** Single-line, trimmed, length-capped display name; null when nothing printable is left. */
export function cleanPlaceName(raw: string | null | undefined): string | null {
  // Control characters would break the one-line title; everything else is shown as plain text.
  const text = (raw ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > PLACE_NAME_MAX_CHARS ? `${text.slice(0, PLACE_NAME_MAX_CHARS - 1).trimEnd()}…` : text;
}

/** `name` (the link's &name=) labels live coordinates; catalogue places keep their own name. */
export function parsePlaceParam(raw: string | null, name: string | null = null): PlaceRequest | null {
  const value = raw?.trim().toLowerCase() ?? '';
  if (!value) return null;
  if (findRealPlace(value)) return { kind: 'place', id: value };
  const parts = value.split(',');
  if (parts.length < 2 || parts.length > 3) return null;
  const at = parseLatLon(`${parts[0]},${parts[1]}`);
  if (!at) return null;
  const km = parts.length === 3 ? Number(parts[2]) : LIVE_PLACE_WIDTH_DEFAULT_KM;
  const label = cleanPlaceName(name);
  return { kind: 'live', lat: at.lat, lon: at.lon, widthKm: clampPlaceWidthKm(km), ...(label ? { name: label } : {}) };
}

export function formatPlaceParam(req: PlaceRequest): string {
  if (req.kind === 'place') return req.id;
  return `${round(req.lat, 5)},${round(req.lon, 5)},${round(req.widthKm, 1)}`;
}

/** "16.047°N 108.206°E" for headings and toasts. */
export function formatLatLon(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(3)}°${lon >= 0 ? 'E' : 'W'}`;
}
