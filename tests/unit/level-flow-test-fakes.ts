// Fake session, scene and downloads for VirtualLevelFlow tests (the flow only needs these few members).
import { vi } from 'vitest';
import type { PlaceTerrainLoader } from '../../src/app/place-terrain-loader';
import type { SandboxGpuScene } from '../../src/app/sandbox-gpu-scene';
import type { SandboxSession } from '../../src/app/sandbox-session';
import { VirtualLevelFlow, type LevelRequest } from '../../src/app/virtual-level-flow';
import type { LevelDefinition } from '../../src/game/level-definitions';
import type { PlaceTerrain } from '../../src/game/real-places';

export function fakeTerrain(fill: number): PlaceTerrain {
  const heights = new Float32Array(256 * 192).fill(fill);
  const openEdges = { north: false, east: true, south: false, west: false };
  return { heights, seaLevel: 2, minHeight: fill, maxHeight: fill, openEdges, metersPerUnitVertical: 1, metersPerCell: 50, attribution: 'Terrain Tiles by Mapzen' };
}

export function flowWithFakes(loader: Partial<PlaceTerrainLoader>, startup: LevelRequest | null = null) {
  const loaded: { level: LevelDefinition; terrain?: Float32Array }[] = [];
  const grid = { width: 256, height: 192 };
  const session = { grid, loadLevel: (level: LevelDefinition, terrain?: Float32Array) => loaded.push({ level, terrain }) } as unknown as SandboxSession;
  const scene = { setStyle: vi.fn() } as unknown as SandboxGpuScene;
  const host = { session, scene, relief: 30, onLevelApplied: vi.fn(), showToast: vi.fn() };
  return { flow: new VirtualLevelFlow(host, loader as PlaceTerrainLoader, startup), loaded, host };
}

/** A download the test resolves or rejects by hand. */
export function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

