// URL query parameters selecting mode, level, view and debug options (shareable links).
export type AppMode = 'virtual' | 'projector';
export type ViewMode = '2d' | '3d';

export interface AppUrlParams {
  mode: AppMode;
  /** Raw ?level= value; null when absent (virtual mode then opens the first level, projector mode free play). */
  levelId: string | null;
  /** Null when absent so each mode can choose its own default. */
  view: ViewMode | null;
  relay: string | null;
  debug: boolean;
}

export function parseAppUrlParams(search: string): AppUrlParams {
  const q = new URLSearchParams(search);
  const mode = q.get('mode') === 'projector' ? 'projector' : 'virtual';
  const viewRaw = q.get('view')?.toLowerCase();
  const view = viewRaw === '2d' || viewRaw === '3d' ? viewRaw : null;
  const level = q.get('level')?.trim();
  const relay = q.get('relay')?.trim();
  const debug = q.get('debug');
  return {
    mode,
    levelId: level ? level : null,
    view,
    relay: relay ? relay : null,
    debug: debug === '1' || debug === 'true',
  };
}

/** Rewrites one query parameter in place (no reload) so the address bar always shares the current level/view. */
export function replaceUrlParam(key: string, value: string | null): void {
  try {
    const url = new URL(window.location.href);
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
    window.history.replaceState(window.history.state, '', url);
  } catch {
    // Sandboxed iframes can forbid history access; the URL is a convenience only.
  }
}

/** Same page in another mode, keeping the level and relay parameters. */
export function urlForMode(mode: AppMode): string {
  const url = new URL(window.location.href);
  url.searchParams.set('mode', mode);
  if (mode === 'projector') url.searchParams.delete('view');
  return url.toString();
}
