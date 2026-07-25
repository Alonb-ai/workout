import { Modal } from '@/components/Modal';
import { useSettings } from '@/hooks/useSettings';
import { computePlateLayout } from '@/utils/plateMath';
import { cn } from '@/utils/cn';

interface Props {
  open: boolean;
  onClose: () => void;
  netWeight: number;
  barWeight: number;
  isMachine: boolean;
  exerciseName: string;
}

/** Plate column geometry. The biggest plate owned sets the top of the scale. */
const PLATE_MAX_H = 92;
const PLATE_MIN_H = 32;
const PLATE_MAX_W = 20;
const PLATE_MIN_W = 11;

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

  // Scale against the heaviest plate the user owns, not the heaviest one loaded,
  // so a 10 kg plate looks the same size in every calculation.
  const heaviestOwned = settings.plateInventory.reduce((m, p) => Math.max(m, p.weight), 0);
  const scaleTop = Math.max(heaviestOwned, ...layout.perSide, 1);

  const plateSize = (w: number) => {
    const t = Math.min(1, Math.max(0, w / scaleTop));
    // Square root: a 1.25 next to a 25 is legible instead of a sliver.
    const k = Math.sqrt(t);
    return {
      height: Math.round(PLATE_MIN_H + k * (PLATE_MAX_H - PLATE_MIN_H)),
      width: Math.round(PLATE_MIN_W + k * (PLATE_MAX_W - PLATE_MIN_W)),
    };
  };

  return (
    <Modal open={open} onClose={onClose} title={`חישוב פלטות — ${exerciseName}`}>
      <div className="space-y-3">
        {isMachine || barWeight === 0 ? (
          <div className="card p-4 text-center">
            <p className="eyebrow">{isMachine ? 'מכונה / סטאק' : 'ללא מוט'}</p>
            <p className="num-display text-4xl mt-2">
              {netWeight.toFixed(2)} <span className="text-base text-fg-muted">kg</span>
            </p>
            <p className="text-xs text-fg-muted mt-2">
              {isMachine ? 'תרגיל מכונה/סטאק — אין פלטות לחישוב.' : 'אין מוט מוגדר לתרגיל זה.'}
            </p>
          </div>
        ) : layout.perSide.length === 0 && netWeight > 0 ? (
          <div className="card relative overflow-hidden p-4 ps-5 bg-bad/[0.06]">
            <span className="absolute inset-y-0 start-0 w-[3px] bg-bad" aria-hidden />
            <p className="text-sm font-semibold text-bad">לא נמצאו פלטות מתאימות</p>
            <p className="text-xs text-fg-muted mt-1">
              עדכנו את מלאי הפלטות בהגדרות, או הזינו משקל ניתן לטעינה.
            </p>
          </div>
        ) : (
          <>
            {/* The one thing on this screen: what the bar looks like loaded.
                Plates run from the collar outwards, biggest first, sized by
                weight so the stack can be matched against the rack at a glance. */}
            <div className="card p-3">
              <div className="flex items-end justify-between gap-2">
                <div>
                  <p className="eyebrow">משקל נטו (ללא מוט)</p>
                  <p className="num-display text-3xl leading-none mt-1">
                    {netWeight.toFixed(2)} <span className="text-sm text-fg-muted">kg</span>
                  </p>
                </div>
                <p className="text-2xs text-fg-dim">
                  משקל המוט/ידית <span className="num text-fg-muted">{barWeight.toFixed(2)}</span> kg
                </p>
              </div>

              <p className="eyebrow mt-3">פלטות בכל צד (מהגדולה לקטנה)</p>

              <div className="field mt-1.5 px-3 py-2 overflow-x-auto no-scrollbar">
                <div className="relative flex items-start gap-1.5 min-w-max pe-5">
                  {/* The sleeve, running behind the plates at their centre line. */}
                  <span
                    className="absolute start-0 end-0 h-2 rounded-full bg-ink-600 border border-line"
                    style={{ top: PLATE_MAX_H / 2 - 4 }}
                    aria-hidden
                  />
                  <span
                    className="absolute end-1 w-2 h-6 rounded-sm bg-ink-500 border border-line"
                    style={{ top: PLATE_MAX_H / 2 - 12 }}
                    aria-hidden
                  />
                  {layout.perSide.map((w, i) => {
                    const { height, width } = plateSize(w);
                    return (
                      <div key={i} className="relative flex flex-col items-center">
                        <span
                          className="flex items-center"
                          style={{ height: PLATE_MAX_H }}
                          aria-hidden
                        >
                          <span
                            className="block rounded-[3px] bg-gradient-to-b from-accent-hover to-accent shadow-[0_4px_12px_-4px_#ff7a1aaa]"
                            style={{ height, width }}
                          />
                        </span>
                        <span className="num text-2xs text-accent-text mt-1.5">{w}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="card-flat grid grid-cols-3 divide-x divide-x-reverse divide-line">
              <Stat label="נטו לצד" value={layout.perSideNet.toFixed(2)} unit="kg" />
              <Stat label="סה״כ במוט" value={layout.achievedTotal.toFixed(2)} unit="kg" />
              <Stat
                label={layout.exact ? 'התאמה' : 'הפרש'}
                value={
                  layout.exact
                    ? '✓ מדויק'
                    : `${layout.remainderNet > 0 ? '+' : ''}${layout.remainderNet.toFixed(2)}`
                }
                unit={layout.exact ? '' : 'kg'}
                tone={layout.exact ? 'good' : 'warn'}
                mono={!layout.exact}
              />
            </div>

            {!layout.exact && (
              <p className="text-2xs text-warn text-center">
                לא ניתן להגיע בדיוק למשקל המבוקש עם המלאי הקיים. מוצגת ההתאמה הקרובה ביותר.
              </p>
            )}
          </>
        )}

        <p className="text-2xs text-fg-dim text-center pt-1">
          הערה: כל המשקלים נשמרים <strong className="text-fg-muted">נטו</strong> (פלטות/סטאק
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
  mono = true,
}: {
  label: string;
  value: string;
  unit: string;
  tone?: 'good' | 'warn';
  /** Off for the "✓ מדויק" verdict — Hebrew words do not belong in the mono face. */
  mono?: boolean;
}) {
  return (
    <div className="px-2 py-2.5 text-center">
      <p className="eyebrow">{label}</p>
      <p
        className={cn(
          'text-base mt-1 whitespace-nowrap',
          mono ? 'num-display' : 'font-semibold',
          tone === 'good' && 'text-good',
          tone === 'warn' && 'text-warn',
        )}
      >
        {value}
        {unit && <span className="text-2xs font-normal text-fg-muted"> {unit}</span>}
      </p>
    </div>
  );
}
