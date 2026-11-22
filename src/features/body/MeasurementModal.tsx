import { useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { NumberInput } from '@/components/NumberInput';
import { db, newId, now } from '@/db/db';
import { todayISO } from '@/utils/dates';
import { format } from 'date-fns';
import { toast } from '@/store/toast';
import { IconPlus, IconX } from '@/components/Icon';
import { compressImage } from '@/utils/image';
import type { BodyMeasurement, PhotoPose, ProgressPhoto } from '@/types';
import { CIRCUMFERENCES, CIRCUMFERENCE_RANGE, POSES, type CircumferenceKey } from './bodyMetrics';

type CircState = Record<CircumferenceKey, number | ''>;
const circFrom = (m?: BodyMeasurement): CircState => ({
  waistCm: m?.waistCm ?? '',
  chestCm: m?.chestCm ?? '',
  armCm: m?.armCm ?? '',
  thighCm: m?.thighCm ?? '',
  hipsCm: m?.hipsCm ?? '',
});

interface Props {
  open: boolean;
  onClose: () => void;
  /** Existing row when editing; absent → create new. */
  editing?: BodyMeasurement;
}

/**
 * Single-purpose modal for entering or editing a body measurement.
 * Weight is the only required field — the rest match InBody output but stay
 * optional so weight-only days don't slow the user down.
 */
export function MeasurementModal({ open, onClose, editing }: Props) {
  const [date, setDate] = useState(editing?.date ?? todayISO());
  const [bodyWeight, setBodyWeight] = useState<number | ''>(editing?.bodyWeight ?? '');
  const [fatPct, setFatPct] = useState<number | ''>(editing?.fatPct ?? '');
  const [muscleMass, setMuscleMass] = useState<number | ''>(editing?.muscleMass ?? '');
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [circ, setCirc] = useState<CircState>(circFrom(editing));
  const [photos, setPhotos] = useState<ProgressPhoto[]>(editing?.photos ?? []);
  const [busyPose, setBusyPose] = useState<PhotoPose | null>(null);

  // Reset when the modal opens for a different row (or fresh insert).
  useEffect(() => {
    if (!open) return;
    setDate(editing?.date ?? todayISO());
    setBodyWeight(editing?.bodyWeight ?? '');
    setFatPct(editing?.fatPct ?? '');
    setMuscleMass(editing?.muscleMass ?? '');
    setNotes(editing?.notes ?? '');
    setCirc(circFrom(editing));
    setPhotos(editing?.photos ?? []);
    setBusyPose(null);
  }, [open, editing]);

  const onPick = async (pose: PhotoPose, file: File | undefined) => {
    if (!file) return;
    setBusyPose(pose);
    try {
      const dataUrl = await compressImage(file);
      setPhotos((cur) => [
        ...cur.filter((p) => p.pose !== pose),
        { id: newId(), pose, dataUrl },
      ]);
    } catch (err) {
      toast.warn(err instanceof Error ? err.message : 'לא ניתן לטעון את התמונה');
    } finally {
      setBusyPose(null);
    }
  };

  /**
   * Range checks live here, not as `min`/`max` on the inputs. NumberInput
   * clamps to those on blur — and pressing שמור blurs first — so a typed 0
   * arrived here already rewritten to 20 and got saved as a real measurement,
   * silently, with a success toast. A body measurement is a fact about the
   * user; refusing a wrong one is the only honest answer, and the same applies
   * at the top of the range (a typo'd 500 became a stored 300).
   */
  const save = async () => {
    const num = (v: number | '') => (v === '' ? undefined : Number(v));
    const weight = num(bodyWeight);
    if (weight === undefined || weight < 20 || weight > 300) {
      toast.warn('משקל גוף חייב להיות בין 20 ל-300 ק״ג');
      return;
    }
    const fat = num(fatPct);
    if (fat !== undefined && (fat < 3 || fat > 60)) {
      toast.warn('אחוז שומן חייב להיות בין 3 ל-60');
      return;
    }
    const muscle = num(muscleMass);
    if (muscle !== undefined && (muscle < 10 || muscle > 150)) {
      toast.warn('מסת שריר חייבת להיות בין 10 ל-150 ק״ג');
      return;
    }
    const circOut: Partial<Record<CircumferenceKey, number>> = {};
    for (const c of CIRCUMFERENCES) {
      const v = num(circ[c.key]);
      if (v === undefined) continue;
      const [lo, hi] = CIRCUMFERENCE_RANGE[c.key];
      if (v < lo || v > hi) {
        toast.warn(`היקף ${c.label} חייב להיות בין ${lo} ל-${hi} ס״מ`);
        return;
      }
      circOut[c.key] = v;
    }
    if (busyPose) {
      toast.warn('התמונה עדיין בעיבוד');
      return;
    }
    const t = now();
    const row: BodyMeasurement = {
      id: editing?.id ?? newId(),
      date,
      bodyWeight: Number(bodyWeight),
      ...(fatPct !== '' ? { fatPct: Number(fatPct) } : {}),
      ...(muscleMass !== '' ? { muscleMass: Number(muscleMass) } : {}),
      ...circOut,
      ...(photos.length > 0 ? { photos: POSES.flatMap((p) => photos.filter((x) => x.pose === p.key)) } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      createdAt: editing?.createdAt ?? t,
      updatedAt: t,
    };
    await db.bodyMeasurements.put(row);
    toast.success(editing ? 'מדידה עודכנה' : 'מדידה נשמרה');
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'עריכת מדידה' : 'מדידה חדשה'}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            ביטול
          </button>
          <button className="btn-primary" onClick={save}>
            שמור
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Weight is the measurement; everything else is optional colour. It
            gets the size, and the date rides alongside it rather than above. */}
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="bm-date">תאריך</label>
            <input
              id="bm-date"
              type="date"
              className="input num"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              max={format(new Date(), 'yyyy-MM-dd')}
            />
          </div>
          <div>
            <label className="label">משקל גוף (kg) *</label>
            <NumberInput
              ariaLabel="משקל גוף (kg)"
              value={bodyWeight}
              onChange={setBodyWeight}
              decimals={1}
              step={0.1}
              withSteppers
              placeholder="—"
              suffix="kg"
              inputClassName="!text-2xl font-semibold tracking-tight !py-3"
            />
          </div>
        </div>

        <div>
          <p className="eyebrow mb-2">נתוני InBody · אופציונלי</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">% שומן</label>
              <NumberInput
                ariaLabel="אחוז שומן"
                value={fatPct}
                onChange={setFatPct}
                decimals={1}
                step={0.1}
                placeholder="—"
                suffix="%"
              />
            </div>
            <div>
              <label className="label">מסת שריר (kg)</label>
              <NumberInput
                ariaLabel="מסת שריר (kg)"
                value={muscleMass}
                onChange={setMuscleMass}
                decimals={1}
                step={0.1}
                placeholder="—"
                suffix="kg"
              />
            </div>
          </div>
          <p className="text-2xs text-fg-dim mt-2">
            ימים שאין לך את אלה — רק משקל מספיק.
          </p>
        </div>

        <div>
          <p className="eyebrow mb-2">היקפים (ס״מ) · אופציונלי</p>
          <div className="grid grid-cols-2 gap-3">
            {CIRCUMFERENCES.map((c) => (
              <div key={c.key}>
                <label className="label">{c.label}</label>
                <NumberInput
                  ariaLabel={`היקף ${c.label} (ס״מ)`}
                  value={circ[c.key]}
                  onChange={(v) => setCirc((cur) => ({ ...cur, [c.key]: v }))}
                  decimals={1}
                  step={0.5}
                  placeholder={c.hint}
                  suffix="cm"
                />
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="eyebrow mb-2">תמונות התקדמות · אופציונלי</p>
          <div className="grid grid-cols-3 gap-2">
            {POSES.map((pose) => {
              const photo = photos.find((p) => p.pose === pose.key);
              return (
                <div key={pose.key} className="relative">
                  <label
                    className="field aspect-[3/4] rounded-xl overflow-hidden flex flex-col items-center justify-center gap-1 cursor-pointer text-fg-dim"
                    aria-label={`תמונת ${pose.label}`}
                  >
                    {photo ? (
                      <img src={photo.dataUrl} alt={`תמונת ${pose.label}`} className="w-full h-full object-cover" />
                    ) : busyPose === pose.key ? (
                      <span className="text-2xs">מעבד…</span>
                    ) : (
                      <>
                        <IconPlus size={18} />
                        <span className="text-2xs">{pose.label}</span>
                      </>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(e) => {
                        void onPick(pose.key, e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {photo && (
                    <button
                      type="button"
                      className="absolute top-0 end-0 w-11 h-11 flex items-start justify-end p-1"
                      aria-label={`הסר תמונת ${pose.label}`}
                      onClick={() => setPhotos((cur) => cur.filter((p) => p.pose !== pose.key))}
                    >
                      <span className="w-7 h-7 rounded-full bg-ink-950/80 text-fg flex items-center justify-center">
                        <IconX size={14} />
                      </span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-2xs text-fg-dim mt-2">
            התמונות נשמרות רק במכשיר ובקובץ הגיבוי. אותה תאורה ואותה תנוחה כל פעם — כך ההשוואה אמינה.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="bm-notes">הערות</label>
          <textarea
            id="bm-notes"
            className="input min-h-16 text-sm leading-relaxed"
            placeholder="איך הרגשת? צום/לא צום? אחרי אימון?"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}
