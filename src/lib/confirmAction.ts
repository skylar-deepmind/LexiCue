import { create } from 'zustand';
import { useFeedbackStore } from '../stores/feedbackStore';

export interface ConfirmOptions { title?: string; kind?: string; okLabel?: string; cancelLabel?: string }
interface Confirmation { id: number; message: string; options: ConfirmOptions; resolve: (accepted: boolean) => void }
let nextId = 0;
export const useConfirmationStore = create<{ requests: Confirmation[]; finish: (id: number, accepted: boolean) => void }>((set, get) => ({
  requests: [],
  finish: (id, accepted) => {
    const request = get().requests.find(item => item.id === id);
    if (!request) return;
    set(state => ({requests: state.requests.filter(item => item.id !== id)}));
    request.resolve(accepted);
  },
}));
/** A compact app confirmation, shared by native and browser layouts. */
export function confirmAction(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  return new Promise(resolve => useConfirmationStore.setState(state => ({requests: [...state.requests, {id: ++nextId, message, options, resolve}]})));
}
export async function notifyMessage(message: string, options: ConfirmOptions = {}): Promise<void> {
  useFeedbackStore.getState().show(message, options.kind === 'error' ? 'error' : 'info');
}
