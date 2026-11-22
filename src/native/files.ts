import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/**
 * Native replacement for the `<a download>` trick, which does nothing inside
 * the iOS app's web view. Writes the file to the app's cache and opens the iOS
 * share sheet, where "Save to Files" (or AirDrop / mail) takes it off the phone.
 *
 * Resolves `true` when the share sheet completed, `false` if the user closed it.
 */
export async function shareTextFile(filename: string, text: string): Promise<boolean> {
  const { uri } = await Filesystem.writeFile({
    path: filename,
    data: text,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });
  try {
    await Share.share({ title: filename, url: uri });
    return true;
  } catch (err) {
    // The plugin rejects with "Share canceled" when the sheet is dismissed.
    if (err instanceof Error && /cancel/i.test(err.message)) return false;
    throw err;
  }
}
