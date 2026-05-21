import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'error' | 'warn';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  // optional action label & callback
  actionLabel?: string;
  onAction?: () => void;
  timeoutMs: number;
}

interface ToastStore {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id' | 'timeoutMs'> & { timeoutMs?: number }) => string;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (t) => {
    const id = Math.random().toString(36).slice(2);
    const item: Toast = { id, timeoutMs: 3200, ...t };
    set((s) => ({ toasts: [...s.toasts, item] }));
    if (item.timeoutMs > 0) {
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
      }, item.timeoutMs);
    }
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export const toast = {
  info: (message: string) => useToastStore.getState().push({ kind: 'info', message }),
  success: (message: string) => useToastStore.getState().push({ kind: 'success', message }),
  error: (message: string) => useToastStore.getState().push({ kind: 'error', message, timeoutMs: 5000 }),
  warn: (message: string) => useToastStore.getState().push({ kind: 'warn', message, timeoutMs: 4500 }),
};
