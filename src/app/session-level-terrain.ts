// Heights for a level: its procedural recipe, or real-place heights handed over once and reused on restarts.
import type { GridSize } from '../core/types';
import type { LevelDefinition } from '../game/level-definitions';
import { generateTerrain } from '../game/terrain-generators';

export class LevelTerrainSource {
  private readonly grid: GridSize;
  private cached: { level: LevelDefinition; heights: Float32Array } | null = null;

  constructor(grid: GridSize) {
    this.grid = grid;
  }

  /** Throws when a real-place level arrives without its downloaded map (and none is cached for it). */
  heightsFor(level: LevelDefinition, terrain?: Float32Array): Float32Array {
    const cells = this.grid.width * this.grid.height;
    if (terrain) {
      if (terrain.length !== cells) throw new RangeError(`Terrain has ${terrain.length} cells, the grid needs ${cells}`);
      this.cached = { level, heights: terrain.slice() };
      return terrain;
    }
    if (!level.place) return generateTerrain(this.grid, level.recipe);
    const cached = this.cached;
    if (cached && (cached.level === level || cached.level.id === level.id)) return cached.heights;
    throw new Error(`${level.name} needs its map downloaded before it can load`);
  }
}
