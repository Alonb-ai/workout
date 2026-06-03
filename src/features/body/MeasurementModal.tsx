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

  const save = async () => {
    if (bodyWeight === '' || Number(bodyWeight) <= 0) {
      toast.warn('הזן משקל גוף תקין');
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
      <div className="space-y-3">
        <div>
          <label className="label">תאריך</label>
          <input
            type="date"
            className="input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            max={format(new Date(), 'yyyy-MM-dd')}
          />
        </div>
        <div>
          <label className="label">משקל גוף (kg) *</label>
          <NumberInput
            value={bodyWeight}
            onChange={setBodyWeight}
            min={20}
            max={300}
            decimals={1}
            step={0.1}
            withSteppers
            placeholder="—"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">% שומן</label>
            <NumberInput
              value={fatPct}
              onChange={setFatPct}
              min={3}
              max={60}
              decimals={1}
              step={0.1}
              placeholder="—"
            />
          </div>
          <div>
            <label className="label">מסת שריר (kg)</label>
            <NumberInput
              value={muscleMass}
              onChange={setMuscleMass}
              min={10}
              max={150}
              decimals={1}
              step={0.1}
              placeholder="—"
            />
          </div>
        </div>
        <div>
          <label className="label">הערות</label>
          <textarea
            className="input min-h-16 text-sm"
            placeholder="איך הרגשת? צום/לא צום? אחרי אימון?"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <p className="text-2xs text-fg-muted text-center">
          % שומן ומסת שריר אופציונליים — מתאימים לנתוני InBody. ימים שאין לך
          את אלה — רק משקל מספיק.
        </p>
      </div>
    </Modal>
  );
}
