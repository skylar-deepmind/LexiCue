import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useFeedbackStore } from '../feedbackStore';
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('window',globalThis);});
afterEach(()=>{for(const message of useFeedbackStore.getState().messages)useFeedbackStore.getState().dismiss(message.id);vi.useRealTimers();vi.unstubAllGlobals();});
it('keeps undo available while focused and expires only the remaining time after leaving',()=>{
  const feedback=useFeedbackStore.getState();const id=feedback.show('Removed','success',10000,{label:'Undo',onClick:()=>{}});
  vi.advanceTimersByTime(2000);feedback.pause(id);vi.advanceTimersByTime(60000);
  expect(useFeedbackStore.getState().messages).toHaveLength(1);
  feedback.resume(id);vi.advanceTimersByTime(7999);expect(useFeedbackStore.getState().messages).toHaveLength(1);
  vi.advanceTimersByTime(1);expect(useFeedbackStore.getState().messages).toHaveLength(0);
});
it('dismissing a paused notice cannot resurface it or affect a newer notice',()=>{
  const feedback=useFeedbackStore.getState();const id=feedback.show('Old');feedback.pause(id);feedback.dismiss(id);
  feedback.show('New','info',10000);feedback.resume(id);vi.advanceTimersByTime(1000);
  expect(useFeedbackStore.getState().messages.map(message=>message.message)).toEqual(['New']);
});
