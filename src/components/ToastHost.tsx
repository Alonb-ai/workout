import { AnimatePresence, motion } from 'framer-motion';
import { useToastStore } from '@/store/toast';
import { IconCheck, IconInfo, IconWarn, IconX } from './Icon';

const KIND_STYLES: Record<string, { cls: string; icon: React.ReactNode }> = {
  success: { cls: 'border-good/40 bg-good-soft', icon: <IconCheck className="text-good" /> },
  info: { cls: 'border-info/40 bg-info-soft', icon: <IconInfo className="text-info" /> },
  warn: { cls: 'border-warn/40 bg-warn-soft', icon: <IconWarn className="text-warn" /> },
  error: { cls: 'border-bad/40 bg-bad-soft', icon: <IconX className="text-bad" /> },
};

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div
      className="fixed z-[60] inset-x-0 top-0 flex flex-col items-center gap-2 px-3 pointer-events-none"
      style={{ paddingTop: 'calc(0.5rem + env(safe-area-inset-top))' }}
    >
      <AnimatePresence>
        {toasts.map((t) => {
          const style = KIND_STYLES[t.kind] ?? KIND_STYLES.info!;
          return (
            <motion.div
              key={t.id}
              initial={{ y: -30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -30, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              className={`pointer-events-auto w-full max-w-sm rounded-2xl border ${style.cls} bg-ink-850/95 backdrop-blur px-3 py-2.5 flex items-center gap-3 shadow-card`}
              role="status"
            >
              <span className="shrink-0">{style.icon}</span>
              <span className="text-sm flex-1">{t.message}</span>
              {t.actionLabel && t.onAction && (
                <button
                  className="text-sm font-semibold text-accent"
                  onClick={() => {
                    t.onAction?.();
                    dismiss(t.id);
                  }}
                >
                  {t.actionLabel}
                </button>
              )}
              <button onClick={() => dismiss(t.id)} className="btn-icon" aria-label="סגור">
                <IconX size={16} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
