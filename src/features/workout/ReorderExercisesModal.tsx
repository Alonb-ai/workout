import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Modal } from '@/components/Modal';
import { IconChevronDown, IconChevronUp, IconGrip } from '@/components/Icon';
import { cn } from '@/utils/cn';
import { doneWorkSets } from './ExerciseCard';
import { moveDraft } from './reorder';
import type { DraftExercise } from './types';

interface Props {
  open: boolean;
  onClose: () => void;
  drafts: DraftExercise[];
  onChange: (next: DraftExercise[]) => void;
}

/**
 * Reorder today's exercises. Drag by the handle, or use the arrows (one tap
 * per step, which is easier than a drag with sweaty hands). Changes apply
 * live and are session-only: the plan and past sessions are not touched.
 */
export function ReorderExercisesModal({ open, onClose, drafts, onChange }: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = drafts.findIndex((d) => d.exerciseId === e.active.id);
    const to = drafts.findIndex((d) => d.exerciseId === e.over!.id);
    onChange(moveDraft(drafts, from, to));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="סדר התרגילים באימון"
      footer={
        <button className="btn-primary" onClick={onClose}>
          סיום
        </button>
      }
    >
      <p className="text-xs text-fg-dim mb-3">
        גרור או השתמש בחצים. הסדר משתנה רק באימון הזה. התכנית וההיסטוריה לא משתנות.
      </p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={drafts.map((d) => d.exerciseId)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-1.5" aria-label="רשימת תרגילים לסידור">
            {drafts.map((d, i) => (
              <ReorderRow
                key={d.exerciseId}
                draft={d}
                isFirst={i === 0}
                isLast={i === drafts.length - 1}
                onUp={() => onChange(moveDraft(drafts, i, i - 1))}
                onDown={() => onChange(moveDraft(drafts, i, i + 1))}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </Modal>
  );
}

function ReorderRow({
  draft,
  isFirst,
  isLast,
  onUp,
  onDown,
}: {
  draft: DraftExercise;
  isFirst: boolean;
  isLast: boolean;
  onUp: () => void;
  onDown: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: draft.exerciseId,
  });
  const done = doneWorkSets(draft);
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'card-flat flex items-center gap-1 p-1',
        isDragging && 'relative z-10 shadow-raised opacity-90',
      )}
    >
      <button
        type="button"
        className="btn-icon text-fg-ghost hover:text-fg-muted touch-none"
        aria-label={`גרור ${draft.exerciseName}`}
        {...attributes}
        {...listeners}
      >
        <IconGrip size={17} />
      </button>
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-semibold">{draft.exerciseName}</p>
        <p className="text-2xs text-fg-dim">
          <span className="num">
            {done}/{draft.targetSets}
          </span>{' '}
          סטים
        </p>
      </div>
      <button
        type="button"
        className="btn-icon text-fg-muted hover:text-accent-text disabled:opacity-30"
        aria-label={`הזז למעלה ${draft.exerciseName}`}
        disabled={isFirst}
        onClick={onUp}
      >
        <IconChevronUp size={18} />
      </button>
      <button
        type="button"
        className="btn-icon text-fg-muted hover:text-accent-text disabled:opacity-30"
        aria-label={`הזז למטה ${draft.exerciseName}`}
        disabled={isLast}
        onClick={onDown}
      >
        <IconChevronDown size={18} />
      </button>
    </li>
  );
}
