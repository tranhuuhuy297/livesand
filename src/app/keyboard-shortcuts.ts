// Global keyboard shortcuts for virtual mode; browser shortcuts (Ctrl/Cmd+key) and text fields are left alone.
import type { SculptTool } from '../input/sculpt-tools';
import { isTypingTarget } from './hud-dom-helpers';
import { toolForKey } from './sculpt-tool-settings';

export interface ShortcutActions {
  setTool(tool: SculptTool): void;
  toggleView(): void;
  resetLevel(): void;
  startLevel(): void;
  changeBrush(delta: number): void;
  toggleHelp(): void;
  toggleFullscreen(): void;
  setSpaceHeld(held: boolean): void;
  /** Returns true when something (menu, dialog) was closed. */
  escape(): boolean;
}

export function installKeyboardShortcuts(actions: ShortcutActions): () => void {
  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.ctrlKey || ev.metaKey || isTypingTarget(ev.target)) return;
    const onButton = ev.target instanceof HTMLButtonElement || ev.target instanceof HTMLAnchorElement;
    // Space/Enter on a focused button must activate that button, not the global shortcut.
    if (onButton && (ev.key === ' ' || ev.key === 'Enter')) return;
    const tool = ev.altKey ? null : toolForKey(ev.key);
    let handled = true;
    if (tool) actions.setTool(tool);
    else if (ev.key === ' ') actions.setSpaceHeld(true);
    else if (ev.key === 'Escape') handled = actions.escape();
    else if (ev.repeat && ev.key !== '[' && ev.key !== ']') handled = false;
    else {
      switch (ev.key.toLowerCase()) {
        case 'v':
          actions.toggleView();
          break;
        case 'r':
          actions.resetLevel();
          break;
        case 'enter':
          actions.startLevel();
          break;
        case '[':
          actions.changeBrush(-2);
          break;
        case ']':
          actions.changeBrush(2);
          break;
        case 'h':
        case '?':
          actions.toggleHelp();
          break;
        case 'f':
          actions.toggleFullscreen();
          break;
        default:
          handled = false;
      }
    }
    if (handled) ev.preventDefault();
  };
  const onKeyUp = (ev: KeyboardEvent): void => {
    if (ev.key === ' ') actions.setSpaceHeld(false);
  };
  // Releasing Space while the window is unfocused never fires keyup, which would leave orbit mode stuck.
  const onBlur = (): void => actions.setSpaceHeld(false);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
  };
}

/** Enters or leaves fullscreen; failures (iframes, iOS Safari) are ignored because the app works either way. */
export function toggleDocumentFullscreen(): void {
  const doc = document;
  const request = doc.fullscreenElement ? doc.exitFullscreen() : doc.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
  void request?.catch(() => undefined);
}
