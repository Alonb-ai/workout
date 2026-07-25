import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconX } from './Icon';
import { cn } from '@/utils/cn';

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
 *
 * The sheet is a flex column capped at the viewport: header and footer never
 * scroll away, only the body does. Capping the *body* instead (the old
 * `max-h-[70vh]`) let a tall header push the footer — and its save button —
 * off the bottom of the screen.
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
          transition={{ duration: 0.18, ease: 'easeOut' }}
        >
          <div
            className="absolute inset-0 bg-ink-950/80 backdrop-blur-[6px]"
            onClick={hideClose ? undefined : onClose}
            aria-hidden="true"
          />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            className={cn(
              'relative flex w-full flex-col overflow-hidden outline-none',
              'max-h-[92dvh] sm:max-h-[85dvh]',
              'rounded-t-3xl border border-b-0 border-line bg-ink-850 shadow-raised',
              'sm:rounded-3xl sm:border-b',
              maxW,
            )}
            style={{ paddingBottom: 'var(--safe-bottom)' }}
            initial={{ y: 32, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <div className="shrink-0 border-b border-line/70">
              {/* Grab handle: says "this sheet came from the bottom edge". */}
              <div className="flex justify-center pt-2 sm:hidden" aria-hidden="true">
                <span className="h-1 w-9 rounded-full bg-ink-600" />
              </div>
              <div className="flex items-center gap-2 px-4 py-3">
                <div className="min-w-0 flex-1 text-base font-bold leading-tight">{title}</div>
                {!hideClose && (
                  <button
                    onClick={onClose}
                    className="btn-icon -me-2 shrink-0 text-fg-dim"
                    aria-label="סגור"
                  >
                    <IconX size={18} />
                  </button>
                )}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
              {children}
            </div>

            {footer && (
              // On a phone the footer is an action rail: the buttons split the
              // full width so either one is reachable with a thumb. On a wide
              // screen they collapse back to their natural size.
              <div className="shrink-0 flex items-center justify-end gap-2 border-t border-line/70 bg-ink-900/60 px-4 py-3 [&>button]:flex-1 sm:[&>button]:flex-none">
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
