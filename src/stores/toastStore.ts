import { create } from 'zustand';

/** Transient UI feedback ("Account created"). Not persisted. */
export interface ToastMessage {
  id: number;
  text: string;
  tone: 'success' | 'neutral';
}

interface ToastState {
  current: ToastMessage | null;
  show: (text: string, tone?: ToastMessage['tone']) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>()((set, get) => ({
  current: null,
  show: (text, tone = 'success') => set({ current: { id: nextId++, text, tone } }),
  dismiss: (id) => {
    if (get().current?.id === id) set({ current: null });
  },
}));

export const showToast = (text: string, tone?: ToastMessage['tone']) =>
  useToastStore.getState().show(text, tone);
