import { create } from 'zustand';

export type FeedbackType = 'success' | 'error' | 'info';

interface FeedbackMessage {
  id: number;
  message: string;
  type: FeedbackType;
}

interface FeedbackStore {
  messages: FeedbackMessage[];
  show: (message: string, type?: FeedbackType, duration?: number) => number;
  dismiss: (id: number) => void;
}

let nextId = 1;
const timers = new Map<number, number>();

export const useFeedbackStore = create<FeedbackStore>((set) => ({
  messages: [],
  show: (message, type = 'info', duration?) => {
    const id = nextId++;
    set((state) => ({ messages: [...state.messages, { id, message, type }] }));
    const effectiveDuration = type === 'error' ? (duration ?? 10000) : (duration ?? 1000);
    const timerId = window.setTimeout(() => {
      timers.delete(id);
      set((state) => ({ messages: state.messages.filter((item) => item.id !== id) }));
    }, effectiveDuration);
    timers.set(id, timerId);
    return id;
  },
  dismiss: (id) => {
    const timerId = timers.get(id);
    if (timerId) {
      window.clearTimeout(timerId);
      timers.delete(id);
    }
    set((state) => ({
      messages: state.messages.filter((item) => item.id !== id),
    }));
  },
}));
