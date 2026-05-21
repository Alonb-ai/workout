import { Modal } from '@/components/Modal';
import { useSettings } from '@/hooks/useSettings';
import { computePlateLayout } from '@/utils/plateMath';

interface Props {
  open: boolean;
  onClose: () => void;
  netWeight: number;
  barWeight: number;
  isMachine: boolean;
  exerciseName: string;
}

export function PlateCalcModal({
  open,
  onClose,
  netWeight,
  barWeight,
  isMachine,
  exerciseName,
}: Props) {
  const settings = useSettings();
  const layout = computePlateLayout({
    requestedNet: netWeight,
    barWeight,
    inventory: settings.plateInventory,
    isMachine,
  });

  return (
    <Modal open={open} onClose={onClose} title={`חישוב פלטות — ${exerciseName}`}>
      <div className="space-y-3">
        <div className="card-flat p-3 flex items-center gap-3">
          <div>
            <p className="text-2xs text-fg-muted">משקל נטו (ללא מוט)</p>
            <p className="num text-2xl font-bold">{netWeight.toFixed(2)} kg</p>
          </div>
          <div className="text-fg-ghost">·</div>
          <div>
            <p className="text-2xs text-fg-muted">משקל המוט/ידית</p>
            <p className="num text-2xl font-bold">{barWeight.toFixed(2)} kg</p>
          </div>
        </div>

        {isMachine || barWeight === 0 ? (
          <div className="card-flat p-4 text-center">
            <p className="text-sm text-fg-muted">
              {isMachine ? 'תרגיל מכונה/סטאק — אין פלטות לחישוב.' : 'אין מוט מוגדר לתרגיל זה.'}
            </p>
            <p className="num text-3xl font-extrabold mt-2">{netWeight.toFixed(2)} kg</p>
            <p className="text-2xs text-fg-muted mt-1">
              המשקל הנשמר הוא נטו, ללא תוספת של מוט/ידית.
            </p>
          </div>
        ) : layout.perSide.length === 0 && netWeight > 0 ? (
          <div className="card-flat p-4 text-center border-bad/30">
            <p className="text-sm text-bad font-semibold">לא נמצאו פלטות מתאימות</p>
            <p className="text-xs text-fg-muted mt-1">
              עדכנו את מלאי הפלטות בהגדרות, או הזינו משקל ניתן לטעינה.
            </p>
          </div>
        ) : (
          <>
            <div className="card-flat p-3">
              <p className="text-2xs text-fg-muted mb-2">פלטות בכל צד (מהגדולה לקטנה)</p>
              <div className="flex flex-wrap gap-1.5">
                {layout.perSide.map((w, i) => (
                  <span
                    key={i}
                    className="num inline-flex items-center justify-center px-2.5 py-1.5 rounded-lg bg-accent-soft text-accent border border-accent/30 text-sm font-bold"
                  >
                    {w}
                  </span>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Stat label="נטו לצד" value={`${layout.perSideNet.toFixed(2)}`} unit="kg" />
              <Stat label="סה״כ במוט" value={`${layout.achievedTotal.toFixed(2)}`} unit="kg" />
              <Stat
                label={layout.exact ? 'התאמה' : 'הפרש'}
                value={
                  layout.exact
                    ? '✓ מדויק'
                    : `${layout.remainderNet > 0 ? '+' : ''}${layout.remainderNet.toFixed(2)} kg`
                }
                unit=""
                tone={layout.exact ? 'good' : 'warn'}
              />
            </div>

            {!layout.exact && (
              <p className="text-2xs text-fg-muted text-center">
                לא ניתן להגיע בדיוק למשקל המבוקש עם המלאי הקיים. מוצגת ההתאמה הקרובה ביותר.
              </p>
            )}
          </>
        )}

        <p className="text-2xs text-fg-muted text-center pt-2">
          הערה: כל המשקלים נשמרים <strong className="text-fg">נטו</strong> (פלטות/סטאק
          בלבד) — משקל המוט משמש רק לחישוב הפלטות.
        </p>
      </div>
    </Modal>
  );
}

function Stat({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: string;
  unit: string;
  tone?: 'good' | 'warn';
}) {
  const cls =
    tone === 'good'
      ? 'border-good/40 bg-good-soft text-good'
      : tone === 'warn'
        ? 'border-warn/40 bg-warn-soft text-warn'
        : 'border-line bg-ink-900 text-fg';
  return (
    <div className={`card-flat p-2.5 text-center border ${cls}`}>
      <p className="text-2xs text-fg-muted">{label}</p>
      <p className="num text-base font-bold">
        {value}{' '}
        {unit && <span className="text-2xs text-fg-muted">{unit}</span>}
      </p>
    </div>
  );
}
