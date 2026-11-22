/**
 * Hand a block of text to another app. Tries the system share sheet first
 * (iOS Safari / the home-screen PWA), then the clipboard.
 *
 * Returns what happened so the caller can tell the user where the text went:
 * - 'shared'  — the share sheet completed
 * - 'copied'  — no share sheet; the text is on the clipboard
 * - 'cancelled' — the user closed the share sheet
 * - 'failed'  — neither path was available; show the text for manual copy
 */
export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

export async function shareText(title: string, text: string): Promise<ShareOutcome> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // NotAllowedError etc. — fall through to the clipboard.
    }
  }
  return (await copyText(text)) ? 'copied' : 'failed';
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or insecure context.
  }
  return false;
}
