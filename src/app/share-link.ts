// Sharing a map: the system share sheet where the browser has one (phones), else the clipboard.
import { copyTextToClipboard } from './hud-dom-helpers';

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

export async function shareLink(title: string, text: string, url: string): Promise<ShareOutcome> {
  const data: ShareData = { title, text, url };
  if (typeof navigator.share === 'function' && (navigator.canShare?.(data) ?? true)) {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (err) {
      // Closing the sheet is a choice, not a failure; anything else (no permission, iframe) falls back to copying.
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
    }
  }
  return (await copyTextToClipboard(url)) ? 'copied' : 'failed';
}
