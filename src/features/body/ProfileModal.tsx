import { useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { NumberInput } from '@/components/NumberInput';
import { updateSettings } from '@/hooks/useSettings';
import { toast } from '@/store/toast';
import type { BodyProfile } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
  initial: BodyProfile | undefined;
}

/**
 * One-shot profile editor used to enable benchmarks (FFMI + strength
 * standards). All fields are optional — the body page just won't show
 * any benchmark that depends on a missing one.
 */
export function ProfileModal({ open, onClose, initial }: Props) {
  const [sex, setSex] = useState<'male' | 'female' | ''>(initial?.sex ?? '');
  const [birthYear, setBirthYear] = useState<number | ''>(initial?.birthYear ?? '');
  const [heightCm, setHeightCm] = useState<number | ''>(initial?.heightCm ?? '');

  useEffect(() => {
    if (!open) return;
    setSex(initial?.sex ?? '');
    setBirthYear(initial?.birthYear ?? '');
    setHeightCm(initial?.heightCm ?? '');
  }, [open, initial]);

  const save = async () => {
    const next: BodyProfile = {
      ...(sex !== '' ? { sex } : {}),
      ...(birthYear !== '' ? { birthYear: Number(birthYear) } : {}),
      ...(heightCm !== '' ? { heightCm: Number(heightCm) } : {}),
    };
    await updateSettings({ bodyProfile: next });
    toast.success('הפרופיל נשמר');
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="פרופיל אישי"
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
          <label className="label">מין</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setSex('male')}
              className={`btn !min-h-10 ${sex === 'male' ? 'bg-accent text-ink-950' : 'bg-ink-800 text-fg border border-line'}`}
            >
              זכר
            </button>
            <button
              type="button"
              onClick={() => setSex('female')}
              className={`btn !min-h-10 ${sex === 'female' ? 'bg-accent text-ink-950' : 'bg-ink-800 text-fg border border-line'}`}
            >
              נקבה
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">גובה (cm)</label>
            <NumberInput
              value={heightCm}
              onChange={setHeightCm}
              min={120}
              max={230}
              decimals={0}
              step={1}
              placeholder="—"
            />
          </div>
          <div>
            <label className="label">שנת לידה</label>
            <NumberInput
              value={birthYear}
              onChange={setBirthYear}
              min={1900}
              max={new Date().getFullYear()}
              decimals={0}
              step={1}
              placeholder="—"
            />
          </div>
        </div>
        <p className="text-2xs text-fg-muted">
          המידע ישמש לחישוב FFMI, סטנדרטי כוח ויחסי גוף. נשמר רק במכשיר שלך,
          אופציונלי לחלוטין — אפשר לדלג.
        </p>
      </div>
    </Modal>
  );
}
