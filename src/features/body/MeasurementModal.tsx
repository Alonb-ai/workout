import { useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { NumberInput } from '@/components/NumberInput';
import { db, newId, now } from '@/db/db';
import { todayISO } from '@/utils/dates';
import { format } from 'date-fns';
import { toast } from '@/store/toast';
import type { BodyMeasurement } from '@/types';

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

  // Reset when the modal opens for a different row (or fresh insert).
  useEffect(() => {
    if (!open) return;
    setDate(editing?.date ?? todayISO());
    setBodyWeight(editing?.bodyWeight ?? '');
    setFatPct(editing?.fatPct ?? '');
    setMuscleMass(editing?.muscleMass ?? '');
    setNotes(editing?.notes ?? '');
  }, [open, editing]);

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
    const t = now();
    const row: BodyMeasurement = {
      id: editing?.id ?? newId(),
      date,
      bodyWeight: Number(bodyWeight),
      ...(fatPct !== '' ? { fatPct: Number(fatPct) } : {}),
      ...(muscleMass !== '' ? { muscleMass: Number(muscleMass) } : {}),
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
