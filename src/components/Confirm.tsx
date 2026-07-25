import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Modal } from './Modal';

interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  open: boolean;
  resolve?: (v: boolean) => void;
}

let externalConfirm: ((opts: ConfirmOptions) => Promise<boolean>) | null = null;

/** Imperative API (drop-in alternative to `confirm`). */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  if (!externalConfirm) {
    return Promise.resolve(false);
  }
  return externalConfirm(opts);
}

export function ConfirmProvider() {
  const [state, setState] = useState<ConfirmState>({
    open: false,
    title: '',
  });

  const open = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setState({ ...opts, open: true, resolve });
    });
  }, []);

  // Register the singleton on mount.
  externalConfirm = open;

  const close = (val: boolean) => {
    state.resolve?.(val);
    setState((s) => ({ ...s, open: false, resolve: undefined as never }));
  };

  // This provider lives outside <Routes>, so a navigation (tab tap / edge-swipe
  // back) would otherwise leave the dialog on top of the new screen — and
  // confirming would act on the screen the user already left.
  const loc = useLocation();
  useEffect(() => {
    if (state.open) close(false);
  }, [loc.key]);

  return (
    <Modal
      open={state.open}
      onClose={() => close(false)}
      title={state.title}
      size="sm"
      footer={
        <>
          <button className="btn-ghost" onClick={() => close(false)}>
            {state.cancelLabel ?? 'ביטול'}
          </button>
          <button
            className={
              state.destructive
                ? 'btn bg-bad text-ink-950 hover:bg-bad/90 shadow-[0_6px_20px_-8px_#ff5c6c66]'
                : 'btn-primary'
            }
            onClick={() => close(true)}
          >
            {state.confirmLabel ?? 'אישור'}
          </button>
        </>
      }
    >
      {state.body &&
        (state.destructive ? (
          <div className="relative overflow-hidden rounded-xl bg-bad/[0.06] py-2.5 pe-3 ps-4">
            <span aria-hidden className="absolute inset-y-0 start-0 w-[3px] bg-bad" />
            <p className="text-sm leading-relaxed text-fg-muted">{state.body}</p>
          </div>
        ) : (
          <p className="text-sm text-fg-muted leading-relaxed">{state.body}</p>
        ))}
    </Modal>
  );
}
