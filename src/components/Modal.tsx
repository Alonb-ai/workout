import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconX } from './Icon';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Hide the close button (use for confirm-required modals). */
  hideClose?: boolean;
  /** Match content height; otherwise constrains to viewport. */
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Bottom-sheet style modal on mobile (slides up); centered card on larger viewports.
 * Replaces native alert/confirm/prompt across the app.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  hideClose = false,
  size = 'md',
}: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Body-scroll lock — depends only on `open` so it doesn't churn on parent re-render.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // ESC-to-close. The handler reads the latest `onClose`/`hideClose` via a ref
  // so we can keep this effect dependent only on `open` — otherwise every
  // inline-arrow `onClose` from the parent would re-bind keydown AND retrigger
  // the focus effect below, stealing focus from any open <input> on every
  // keystroke (mobile keyboard would close after each letter).
  const closeRef = useRef(onClose);
  const hideRef = useRef(hideClose);
  closeRef.current = onClose;
  hideRef.current = hideClose;
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !hideRef.current) closeRef.current();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  // Initial focus — only when the dialog actually opens, and only if focus
  // isn't already inside the dialog. This protects any focused <input>.
  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      const node = ref.current;
      if (!node) return;
      const active = document.activeElement;
      if (active && node.contains(active)) return;
      node.focus();
    });
  }, [open]);

  const maxW = size === 'sm' ? 'max-w-sm' : size === 'lg' ? 'max-w-2xl' : 'max-w-lg';

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={hideClose ? undefined : onClose}
            aria-hidden="true"
          />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            className={`relative w-full ${maxW} bg-ink-850 border border-line rounded-t-3xl sm:rounded-2xl shadow-card outline-none`}
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
            initial={{ y: 40, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 30, opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-line">
              <div className="text-base font-semibold flex-1">{title}</div>
              {!hideClose && (
                <button onClick={onClose} className="btn-icon" aria-label="סגור">
                  <IconX />
                </button>
              )}
            </div>
            <div className="px-4 py-4 max-h-[70vh] overflow-y-auto">{children}</div>
            {footer && (
              <div className="px-4 py-3 border-t border-line flex items-center justify-end gap-2">
                {footer}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
