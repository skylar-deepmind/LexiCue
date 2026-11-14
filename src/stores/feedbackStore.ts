import { create } from 'zustand';

export type FeedbackType = 'success' | 'error' | 'info';

export interface FeedbackAction { label: string; onClick: () => void | boolean | Promise<void | boolean>; focus?: boolean; ariaLabel?: string; }

export interface FeedbackMessage {
  id: number;
  message: string;
  type: FeedbackType;
  action?: FeedbackAction;
}

interface FeedbackStore {
  messages: FeedbackMessage[];
  show: (message: string, type?: FeedbackType, duration?: number, action?: FeedbackAction) => number;
  dismiss: (id: number) => void;
  pause: (id: number) => void;
  resume: (id: number) => void;
}

let nextId = 1;
const timers = new Map<number, {timer?:number;remaining:number;started:number}>();

export const useFeedbackStore = create<FeedbackStore>((set) => ({
  messages: [],
  show: (message, type = 'info', duration?, action?) => {
    const id = nextId++;
    set((state) => ({ messages: [...state.messages, { id, message, type, action }] }));
    const effectiveDuration = type === 'error' ? (duration ?? 10000) : (duration ?? 1000);
    const timerId = window.setTimeout(() => {
      timers.delete(id);
      set((state) => ({ messages: state.messages.filter((item) => item.id !== id) }));
    }, effectiveDuration);
    timers.set(id, {timer:timerId, remaining:effectiveDuration, started:Date.now()});
    return id;
  },
  pause: id => {
    const timer=timers.get(id);if(!timer || timer.timer===undefined)return;
    window.clearTimeout(timer.timer);timer.remaining=Math.max(0,timer.remaining-(Date.now()-timer.started));timer.timer=undefined;
  },
  resume: id => {
    const timer=timers.get(id);if(!timer || timer.timer!==undefined)return;
    timer.started=Date.now();timer.timer=window.setTimeout(()=>{timers.delete(id);set(state=>({messages:state.messages.filter(item=>item.id!==id)}));},timer.remaining);
  },
  dismiss: (id) => {
    const timer = timers.get(id);
    if (timer) {
      window.clearTimeout(timer.timer);
      timers.delete(id);
    }
    set((state) => ({
      messages: state.messages.filter((item) => item.id !== id),
    }));
  },
}));
