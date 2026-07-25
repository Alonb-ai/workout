import { AnimatePresence, motion } from 'framer-motion';
import { useToastStore } from '@/store/toast';
import type { ToastKind } from '@/store/toast';
import { IconCheck, IconInfo, IconWarn, IconX } from './Icon';
import { cn } from '@/utils/cn';

/**
 * Status colour arrives as a 3px rule plus a barely-there tint, not as a filled
 * slab — the message has to stay the loudest thing in the toast. (The old
 * version put `bg-good-soft` and `bg-ink-850/95` on the same element, so which
 * background actually won depended on Tailwind's output order.)
 */
const KIND_STYLES: Record<ToastKind, { rule: string; tint: string; text: string; icon: React.ReactNode }> = {
  success: { rule: 'bg-good', tint: 'bg-good/[0.07]', text: 'text-good', icon: <IconCheck size={18} /> },
  info: { rule: 'bg-info', tint: 'bg-info/[0.07]', text: 'text-info', icon: <IconInfo size={18} /> },
  warn: { rule: 'bg-warn', tint: 'bg-warn/[0.08]', text: 'text-warn', icon: <IconWarn size={18} /> },
  error: { rule: 'bg-bad', tint: 'bg-bad/[0.08]', text: 'text-bad', icon: <IconX size={18} /> },
};

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div
      className="fixed z-[60] inset-x-0 top-0 flex flex-col items-center gap-1.5 px-3 pointer-events-none"
      style={{
        paddingTop: 'calc(0.5rem + var(--safe-top))',
        paddingInlineStart: 'calc(0.75rem + var(--safe-left))',
        paddingInlineEnd: 'calc(0.75rem + var(--safe-right))',
      }}
    >
      <AnimatePresence>
        {toasts.map((t, i) => {
          const style = KIND_STYLES[t.kind];
          // Newest is pushed last and sits at the bottom of the column; older
          // ones step back so a burst reads as one stack, not four banners.
          const depth = Math.min(toasts.length - 1 - i, 2);
          return (
            <motion.div
              key={t.id}
              initial={{ y: -20, opacity: 0, scale: 0.97 }}
              animate={{ y: 0, opacity: 1 - depth * 0.15, scale: 1 - depth * 0.03 }}
              exit={{ y: -14, opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="pointer-events-auto relative w-full max-w-sm overflow-hidden rounded-2xl border border-line bg-ink-850/90 shadow-raised backdrop-blur-xl"
              role="status"
            >
              <span aria-hidden className={cn('absolute inset-y-0 start-0 w-[3px]', style.rule)} />
              <span aria-hidden className={cn('absolute inset-0', style.tint)} />
              <div className="relative flex items-center gap-2.5 ps-3.5 pe-1 py-1.5">
                <span className={cn('shrink-0', style.text)}>{style.icon}</span>
                <span className="flex-1 text-sm leading-snug">{t.message}</span>
                <button
                  onClick={() => dismiss(t.id)}
                  className="btn-icon shrink-0 text-fg-ghost hover:text-fg"
                  aria-label="סגור"
                >
                  <IconX size={16} />
                </button>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
