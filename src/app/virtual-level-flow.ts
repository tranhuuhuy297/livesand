// Level changes in virtual mode: procedural levels switch at once; real-place maps download first (with a loading
// state), and a failed download leaves the current level running. Also owns the render style, the sculpt ceiling and
// the real-place free play the "Flood it" storm challenge is built from.
import { BLANK_SANDBOX_LEVEL, getLevel, isFreePlay, LEVELS, type LevelDefinition } from '../game/level-definitions';
import { placeDisplayName, realPlaceFreePlayLevel, realPlaceStormLevel } from '../game/real-place-levels';
import { stormTownSpot } from '../game/real-place-storm-town';
import { findRealPlace, type PlaceTerrain } from '../game/real-places';
import { replaceUrlParam, type AppUrlParams } from './app-url-params';
import { describeError } from './fatal-error-screen';
import { formatLatLon, formatPlaceParam, parsePlaceParam, type PlaceRequest } from './place-url-param';
import type { PlaceTerrainLoader } from './place-terrain-loader';
import type { SandboxGpuScene } from './sandbox-gpu-scene';
import type { SandboxSession } from './sandbox-session';
import { placeRenderStyle, virtualRenderStyle } from './virtual-mode-presets';

export type LevelRequest = { kind: 'level'; id: string } | PlaceRequest;
/** A request either went live, lost to a newer request, or failed while it was still the latest. */
export type LevelRequestOutcome = 'applied' | 'superseded' | 'failed';

/** Real terrain under the current level, for the HUD credit and the shareable link. */
export interface PlaceInfo {
  name: string;
  attribution: string;
  /** Set for real-place free play and its storm (shared as ?place=); null for levels (shared as ?level=). */
  link: PlaceRequest | null;
}

export interface LevelFlowHost {
  readonly session: SandboxSession;
  readonly scene: SandboxGpuScene;
  readonly relief: number;
  /** Every new level starts with its natural tool. */
  onLevelApplied(level: LevelDefinition): void;
  showToast(message: string): void;
}

interface ResolvedLevel {
  level: LevelDefinition;
  terrain: PlaceTerrain;
  place: PlaceInfo;
}

export class VirtualLevelFlow {
  place: PlaceInfo | null = null;
  /** Highest height the sculpt tools may build to (real maps can top the procedural relief). */
  sculptMax: number;
  private readonly host: LevelFlowHost;
  private readonly loader: PlaceTerrainLoader;
  private loadingLabel: string | null = null;
  private token = 0;
  private inflight: AbortController | null = null;
  // The real-place free play currently open (or under its storm challenge), reused without downloading again.
  private freePlace: ResolvedLevel | null = null;
  // A real map named in the URL downloads after the first frame; a blank box stands in until then.
  private startup: LevelRequest | null;

  constructor(host: LevelFlowHost, loader: PlaceTerrainLoader, startup: LevelRequest | null = null) {
    this.host = host;
    this.loader = loader;
    this.startup = startup;
    this.sculptMax = host.relief;
  }

  /** Loads the URL's real map; only if that download itself fails (and nothing newer was picked) opens the first level. */
  async loadStartupLevel(): Promise<void> {
    const req = this.startup;
    this.startup = null;
    if (req && (await this.request(req)) === 'failed') await this.request({ kind: 'level', id: LEVELS[0].id });
  }

  /** Label of the map being downloaded, or null. */
  get loading(): string | null {
    return this.loadingLabel;
  }

  /** Real-place free play (catalogue or live) is open or under its storm, so "Flood it" / "back to the map" work. */
  get hasFreePlace(): boolean {
    return this.freePlace !== null;
  }

  async request(req: LevelRequest): Promise<LevelRequestOutcome> {
    const token = this.supersede();
    const level = req.kind === 'level' ? getLevel(req.id) : null;
    if (level && !level.place) {
      this.apply(level);
      return 'applied';
    }
    const label = level ? level.name : describePlace(req as PlaceRequest);
    this.loadingLabel = label;
    const controller = new AbortController();
    this.inflight = controller;
    try {
      const resolved = level ? await this.resolveLevel(level, controller.signal) : await this.resolvePlace(req as PlaceRequest, label, controller.signal);
      if (token !== this.token) return 'superseded';
      this.apply(resolved.level, resolved);
      return 'applied';
    } catch (err) {
      if (token !== this.token) return 'superseded';
      this.host.showToast(`Couldn't load ${label}: ${describeError(err)}`);
      return 'failed';
    } finally {
      if (token === this.token) {
        this.loadingLabel = null;
        this.inflight = null;
      }
    }
  }

  /** Switches right away to a procedural level (free-play landscapes); cancels any pending download. */
  applyNow(level: LevelDefinition): void {
    this.supersede();
    this.apply(level);
  }

  /** "Flood it": a storm over the open real place, with the player's town near the centre; false without one. */
  startStorm(): boolean {
    const base = this.freePlace;
    if (!base) return false;
    this.supersede();
    const town = stormTownSpot(base.terrain.heights, this.host.session.grid, base.terrain.seaLevel);
    const level = realPlaceStormLevel(base.level, town);
    this.apply(level, { ...base, level });
    return true;
  }

  /** Back to free play on the open real place (after its storm); false without one. */
  returnToPlace(): boolean {
    const base = this.freePlace;
    if (!base) return false;
    this.supersede();
    this.apply(base.level, base);
    return true;
  }

  /** Invalidates pending requests (and stops their downloads); returns the new request token. */
  private supersede(): number {
    this.inflight?.abort();
    this.inflight = null;
    this.loadingLabel = null;
    return ++this.token;
  }

  private apply(level: LevelDefinition, resolved?: ResolvedLevel): void {
    const { session, scene, relief } = this.host;
    session.loadLevel(level, resolved?.terrain.heights);
    const terrain = resolved?.terrain;
    scene.setStyle(terrain ? placeRenderStyle(terrain, relief) : virtualRenderStyle(relief));
    this.sculptMax = terrain ? Math.max(relief, terrain.maxHeight + 4) : relief;
    this.place = resolved?.place ?? null;
    if (!resolved?.place.link) this.freePlace = null;
    else if (isFreePlay(level)) this.freePlace = resolved;
    const link = this.place?.link ?? null;
    replaceUrlParam('level', link ? null : level.id);
    replaceUrlParam('place', link ? formatPlaceParam(link) : null);
    replaceUrlParam('name', link?.kind === 'live' ? link.name ?? null : null);
    this.host.onLevelApplied(level);
  }

  private async resolveLevel(level: LevelDefinition, signal: AbortSignal): Promise<ResolvedLevel> {
    const ref = level.place!;
    const terrain = 'id' in ref ? await this.loader.bakedPlace(ref.id) : await this.loader.livePlace(ref.lat, ref.lon, ref.widthKm, signal);
    return { level, terrain, place: { name: level.name, attribution: terrain.attribution, link: null } };
  }

  private async resolvePlace(req: PlaceRequest, label: string, signal: AbortSignal): Promise<ResolvedLevel> {
    if (req.kind === 'place') {
      const place = findRealPlace(req.id);
      if (!place) throw new Error(`unknown place "${req.id}"`);
      const terrain = await this.loader.bakedPlace(req.id);
      const level = realPlaceFreePlayLevel({ id: req.id }, terrain.openEdges, label, place.blurb);
      return { level, terrain, place: { name: label, attribution: terrain.attribution, link: req } };
    }
    const terrain = await this.loader.livePlace(req.lat, req.lon, req.widthKm, signal);
    const tagline = `Real terrain, ${Math.round(req.widthKm)} km across, around ${label}.`;
    const level = realPlaceFreePlayLevel({ lat: req.lat, lon: req.lon, widthKm: req.widthKm }, terrain.openEdges, label, tagline);
    return { level, terrain, place: { name: label, attribution: terrain.attribution, link: req } };
  }
}

/** Level to build the session with, plus the request still to load (real maps download after the first frame). */
export function startupLevels(params: AppUrlParams): { level: LevelDefinition; pending: LevelRequest | null } {
  const req: LevelRequest = parsePlaceParam(params.place, params.placeName) ?? { kind: 'level', id: params.levelId ?? LEVELS[0].id };
  const direct = req.kind === 'level' ? getLevel(req.id) : null;
  return direct && !direct.place ? { level: direct, pending: null } : { level: BLANK_SANDBOX_LEVEL, pending: req };
}

/** Catalogue places by their (Vietnamese) name; live coordinates by the searched name, else "16.047°N 108.206°E". */
export function describePlace(req: PlaceRequest): string {
  if (req.kind === 'live') return req.name ?? formatLatLon(req.lat, req.lon);
  const place = findRealPlace(req.id);
  return place ? placeDisplayName(place) : req.id;
}
