/**
 * Downscale a photo picked from the camera / library to a JPEG data URL.
 *
 * Phone photos are 3–6 MB; stored raw, a year of weekly progress photos would
 * be a gigabyte of IndexedDB and a backup file no share sheet can carry. At a
 * 1280 px long edge and q 0.8 a photo is ~150–250 KB and still sharp enough to
 * compare a waistline. EXIF orientation is applied by the browser when it
 * decodes (`image-orientation: from-image` is the default on iOS ≥ 13.4).
 */
export async function compressImage(file: Blob, maxEdge = 1280, quality = 0.8): Promise<string> {
  const img = await loadImage(file);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) throw new Error('התמונה לא נטענה');
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const cw = Math.round(w * scale);
  const ch = Math.round(h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('הדפדפן לא תומך בעיבוד תמונה');
  ctx.drawImage(img, 0, 0, cw, ch);
  return canvas.toDataURL('image/jpeg', quality);
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('לא ניתן לקרוא את הקובץ כתמונה'));
    };
    img.src = url;
  });
}
