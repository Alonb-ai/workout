import { useCallback, useState } from 'react';
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

  return (
    <Modal
      open={state.open}
      onClose={() => close(false)}
      title={state.title}
      footer={
        <>
          <button className="btn-ghost" onClick={() => close(false)}>
            {state.cancelLabel ?? 'ביטול'}
          </button>
          <button
            className={state.destructive ? 'btn bg-bad text-white' : 'btn-primary'}
            onClick={() => close(true)}
          >
            {state.confirmLabel ?? 'אישור'}
          </button>
        </>
      }
    >
      {state.body && <p className="text-sm text-fg-muted leading-relaxed">{state.body}</p>}
    </Modal>
  );
}
