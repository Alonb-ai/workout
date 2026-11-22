import { useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { db } from '@/db/db';
import { formatHebDate } from '@/utils/dates';
import type { DraftExercise } from './types';

interface Props {
  open: boolean;
  onClose: () => void;
  draft: DraftExercise;
  onChange: (next: DraftExercise) => void;
}

/**
 * Two notes, two lifetimes:
 *  - the PINNED note belongs to the exercise ("seat on 4, narrow grip"). It is
 *    written straight to the exercise row on every keystroke, so it is kept
 *    whether or not this session is ever saved.
 *  - the SESSION note belongs to today ("stay at 70 until 8×6"). It rides in
 *    the autosaved draft, is stored on the session's log, and is shown on the
 *    card next time.
 */
export function ExerciseNotesModal({ open, onClose, draft, onChange }: Props) {
  const [pinned, setPinned] = useState(draft.notes ?? '');

  useEffect(() => {
    if (open) setPinned(draft.notes ?? '');
    // Only on open: while typing, local state is the source of truth.
  }, [open]);

  const savePinned = (text: string) => {
    setPinned(text);
    const value = text.trim() ? text : undefined;
    void db.exercises.update(draft.exerciseId, { notes: value, updatedAt: Date.now() });
    const { notes: _drop, ...rest } = draft;
    void _drop;
    onChange(value ? { ...rest, notes: value } : rest);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`הערות — ${draft.exerciseName}`}
      footer={
        <button className="btn-primary" onClick={onClose}>
          סיום
        </button>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor={`pinned-${draft.exerciseId}`}>
            הערה קבועה לתרגיל
          </label>
          <textarea
            id={`pinned-${draft.exerciseId}`}
            className="input min-h-20 text-sm"
            placeholder="גובה כיסא, אחיזה, הגדרות מכונה…"
            value={pinned}
            onChange={(e) => savePinned(e.target.value)}
          />
          <p className="text-2xs text-fg-muted mt-1">מופיעה בכל אימון. נשמרת מיד.</p>
        </div>

        <div>
          <label className="label" htmlFor={`session-${draft.exerciseId}`}>
            הערה לאימון הזה
          </label>
          <textarea
            id={`session-${draft.exerciseId}`}
            className="input min-h-20 text-sm"
            placeholder="מה לזכור לפעם הבאה בתרגיל הזה?"
            value={draft.sessionNote ?? ''}
            onChange={(e) => onChange({ ...draft, sessionNote: e.target.value })}
          />
          <p className="text-2xs text-fg-muted mt-1">
            נשמרת עם האימון ותופיע על התרגיל באימון הבא.
          </p>
        </div>

        {draft.lastNote && (
          <div className="field px-3 py-2 rounded-xl">
            <p className="eyebrow">באימון הקודם · {formatHebDate(draft.lastNote.date)}</p>
            <p className="text-sm mt-1 whitespace-pre-wrap">{draft.lastNote.text}</p>
            <button
              type="button"
              className="mt-1 text-2xs text-accent-text underline underline-offset-2 min-h-9"
              onClick={() =>
                savePinned(pinned.trim() ? `${pinned.trim()}\n${draft.lastNote!.text}` : draft.lastNote!.text)
              }
            >
              הוסף להערה הקבועה
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
