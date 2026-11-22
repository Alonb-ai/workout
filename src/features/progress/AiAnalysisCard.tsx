import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { IconCopy, IconTarget } from '@/components/Icon';
import { toast } from '@/store/toast';
import { copyText, shareText } from '@/utils/shareText';

/**
 * AI analysis without an API key, a server, or a bill: the app writes a
 * compact brief of the training numbers and hands it to the share sheet, where
 * the user picks Claude (or anything else). Nothing leaves the device until
 * they choose where it goes.
 */
export function AiAnalysisCard({
  buildPrompt,
  sessionCount,
  periodLabel,
}: {
  /** Built on tap, not on render: it walks every set in the window. */
  buildPrompt: () => string;
  sessionCount: number;
  periodLabel: string;
}) {
  const [preview, setPreview] = useState<string | null>(null);

  async function onShare() {
    const text = buildPrompt();
    const res = await shareText('ניתוח אימונים', text);
    if (res === 'copied') toast.success('הסיכום הועתק. הדבק אותו בשיחה עם Claude');
    else if (res === 'failed') setPreview(text);
  }

  async function onCopy(text: string) {
    if (await copyText(text)) toast.success('הועתק');
    else toast.warn('ההעתקה נחסמה. סמן את הטקסט והעתק ידנית');
  }

  return (
    <section className="card relative overflow-hidden p-3.5 mb-5">
      <span className="absolute inset-y-0 start-0 w-[3px] bg-accent" aria-hidden />
      <div className="flex items-start gap-2.5">
        <span className="text-accent-text mt-0.5 shrink-0">
          <IconTarget />
        </span>
        <div className="min-w-0 flex-1">
          <p className="eyebrow text-accent-text">ניתוח AI</p>
          <p className="text-sm mt-1">
            שלח ל-Claude סיכום של {sessionCount} אימונים {periodLabel}, וקבל ניתוח: איפה אתה מתקדם, איפה
            תקוע, ומה לעשות באימון הבא.
          </p>
          <p className="text-2xs text-fg-dim mt-1">
            נשלחים רק משקלים וחזרות, ורק לאפליקציה שתבחר בתפריט השיתוף.
          </p>
        </div>
      </div>
      <div className="flex gap-2 mt-3">
        <button type="button" className="btn-primary flex-1" onClick={onShare} disabled={sessionCount === 0}>
          שלח לניתוח AI
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setPreview(buildPrompt())}
          disabled={sessionCount === 0}
        >
          הצג טקסט
        </button>
      </div>

      <Modal
        open={preview !== null}
        onClose={() => setPreview(null)}
        title="הסיכום שיישלח"
        footer={
          <button type="button" className="btn-primary w-full" onClick={() => preview && onCopy(preview)}>
            <IconCopy /> העתק
          </button>
        }
      >
        <textarea
          readOnly
          aria-label="טקסט הניתוח"
          className="field w-full h-[50vh] p-2.5 text-xs leading-relaxed"
          value={preview ?? ''}
        />
      </Modal>
    </section>
  );
}
