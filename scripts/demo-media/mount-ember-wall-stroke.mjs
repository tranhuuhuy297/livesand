// The Mount Ember save for scripted media: the Raise wall along the level's hint line, dragged with the real mouse so
// the recording shows exactly what a player would do (works in the 2D map and the 3D view).
import { moveToGrid, step } from './demo-page-hooks.mjs';

/** The hint stroke in grid cells, read from the level itself so the media follow any retune of the level. */
export async function emberWallPath(page) {
  return page.evaluate(async () => {
    const { MOUNT_EMBER_LEVEL } = await import('/src/game/mount-ember-level.ts');
    const hint = MOUNT_EMBER_LEVEL.hint;
    if (!hint) throw new Error('Mount Ember has no hint line to build the wall along');
    const { width, height } = window.__demoApp.session.grid;
    const cell = (p) => ({ x: p.u * (width - 1), y: p.v * (height - 1) });
    return { from: cell(hint.from), to: cell(hint.to) };
  });
}

/**
 * Drags the wall back and forth `passes` times with `moves` pointer moves per pass and one `dt` frame after each move
 * (strokes deposit per cell travelled, so more moves only make the motion smoother); `onFrame` runs after every frame.
 */
export async function dragEmberWall(page, { passes = 3, moves = 4, dt = 0.25, draw = false, onFrame = null } = {}) {
  const { from, to } = await emberWallPath(page);
  await moveToGrid(page, from);
  await page.mouse.down();
  try {
    for (let pass = 0; pass < passes; pass++) {
      const [a, b] = pass % 2 === 0 ? [from, to] : [to, from];
      for (let i = 1; i <= moves; i++) {
        await moveToGrid(page, { x: a.x + ((b.x - a.x) * i) / moves, y: a.y + ((b.y - a.y) * i) / moves });
        await step(page, 1, dt, draw);
        if (onFrame) await onFrame();
      }
    }
  } finally {
    await page.mouse.up();
  }
}
