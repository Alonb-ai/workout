import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/Modal';
import { IconPlus } from '@/components/Icon';
import { formatHebDate } from '@/utils/dates';
import type { BodyMeasurement, PhotoPose } from '@/types';
import { POSES, withPhotos } from './bodyMetrics';

/**
 * Progress photos: before / after side by side, one pose at a time. Defaults
 * to the first photo day against the latest — the comparison that shows what
 * the scale doesn't.
 */
export function BodyPhotos({
  list,
  onAdd,
}: {
  /** Every measurement, oldest first. */
  list: BodyMeasurement[];
  onAdd: () => void;
}) {
  const dated = useMemo(() => withPhotos(list), [list]);
  const [beforeId, setBeforeId] = useState<string | null>(null);
  const [afterId, setAfterId] = useState<string | null>(null);
  const [pose, setPose] = useState<PhotoPose>('front');
  const [zoom, setZoom] = useState<{ src: string; title: string } | null>(null);

  // Fall back to oldest / latest whenever a selection disappears (deleted
  // measurement, removed photo) or nothing was chosen yet.
  const before = dated.find((m) => m.id === beforeId) ?? dated[0];
  const after = dated.find((m) => m.id === afterId) ?? dated[dated.length - 1];

  const posesAvailable = POSES.filter((p) =>
    [before, after].some((m) => m?.photos?.some((x) => x.pose === p.key)),
  );
  useEffect(() => {
    if (posesAvailable.length > 0 && !posesAvailable.some((p) => p.key === pose)) {
      setPose(posesAvailable[0]!.key);
    }
  }, [posesAvailable, pose]);

  if (dated.length === 0) {
    return (
      <button type="button" onClick={onAdd} className="card-flat w-full p-4 flex items-center gap-3 text-start">
        <span className="field w-11 h-11 rounded-xl flex items-center justify-center text-fg-dim shrink-0">
          <IconPlus size={18} />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold">צלם תמונת התקדמות ראשונה</span>
          <span className="block text-2xs text-fg-muted">חזית, צד וגב. נשמר רק במכשיר שלך.</span>
        </span>
      </button>
    );
  }

  const single = dated.length === 1;
  const sides: { m: BodyMeasurement; tag: string }[] = single
    ? [{ m: after!, tag: '' }]
    : [
        { m: before!, tag: 'לפני' },
        { m: after!, tag: 'אחרי' },
      ];
  const weightDelta =
    !single && before && after ? Math.round((after.bodyWeight - before.bodyWeight) * 10) / 10 : null;

  return (
    <div className="card p-3">
      {posesAvailable.length > 1 && (
        <div className="seg !flex w-full mb-3" role="tablist" aria-label="תנוחה">
          {posesAvailable.map((p) => (
            <button
              key={p.key}
              type="button"
              role="tab"
              aria-selected={p.key === pose}
              data-active={p.key === pose}
              className="pill-tab flex-1"
              onClick={() => setPose(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      <div className={`grid gap-2 ${single ? 'grid-cols-1' : 'grid-cols-2'}`}>
        {sides.map(({ m, tag }) => {
          const photo = m.photos?.find((x) => x.pose === pose);
          const title = `${tag ? `${tag} · ` : ''}${formatHebDate(m.date)}`;
          return (
            <figure key={tag || m.id} className="min-w-0">
              {photo ? (
                <button
                  type="button"
                  className="field block w-full aspect-[3/4] rounded-xl overflow-hidden"
                  aria-label={`הגדל תמונה ${title}`}
                  onClick={() => setZoom({ src: photo.dataUrl, title })}
                >
                  <img src={photo.dataUrl} alt={title} className="w-full h-full object-cover" />
                </button>
              ) : (
                <div className="field w-full aspect-[3/4] rounded-xl flex items-center justify-center text-2xs text-fg-dim p-2 text-center">
                  אין תמונה בתנוחה הזו
                </div>
              )}
              <figcaption className="mt-1.5 px-0.5">
                {tag && <p className="eyebrow">{tag}</p>}
                <p className="text-2xs text-fg-muted truncate">
                  {formatHebDate(m.date)} · <span className="num">{m.bodyWeight.toFixed(1)} kg</span>
                  {m.waistCm !== undefined && (
                    <>
                      {' · '}מותניים <span className="num">{m.waistCm}</span>
                    </>
                  )}
                </p>
              </figcaption>
            </figure>
          );
        })}
      </div>

      {!single && (
        <div className="grid grid-cols-2 gap-2 mt-3">
          <select
            className="input text-xs"
            aria-label="תמונה לפני"
            value={before?.id}
            onChange={(e) => setBeforeId(e.target.value)}
          >
            {dated.map((m) => (
              <option key={m.id} value={m.id}>
                {formatHebDate(m.date)}
              </option>
            ))}
          </select>
          <select
            className="input text-xs"
            aria-label="תמונה אחרי"
            value={after?.id}
            onChange={(e) => setAfterId(e.target.value)}
          >
            {dated.map((m) => (
              <option key={m.id} value={m.id}>
                {formatHebDate(m.date)}
              </option>
            ))}
          </select>
        </div>
      )}

      {weightDelta !== null && weightDelta !== 0 && (
        <p className="text-2xs text-fg-dim mt-2 px-0.5">
          שינוי במשקל בין התמונות:{' '}
          <bdi dir="ltr" className="num text-fg-muted">
            {weightDelta > 0 ? '+' : ''}
            {weightDelta} kg
          </bdi>
        </p>
      )}

      <Modal open={zoom !== null} onClose={() => setZoom(null)} title={zoom?.title} size="lg">
        {zoom && <img src={zoom.src} alt={zoom.title} className="w-full rounded-xl" />}
      </Modal>
    </div>
  );
}
