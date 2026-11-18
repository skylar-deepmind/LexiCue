import { create } from 'zustand';

export type PlaybackTarget = { y: number } | { step: -1 | 1 };

interface ReadingToolsState {
  available: boolean;
  listening: boolean;
  translation: boolean;
  translationProgress: {done: number; total: number} | null;
  hasTranslation: boolean;
  showRecall: boolean;
  playing: boolean;
  loading: boolean;
  disabled: boolean;
  rate: number;
  onPlay: () => void;
  onPause: () => void;
  onRate: () => void;
  onListen: () => void;
  onTranslation: () => void;
  onPlaybackTarget: (target: PlaybackTarget) => boolean;
  onPlaybackTargetEnd: (commit: boolean) => void;
}
/** ReadingPage owns the actions; the existing navigation only hosts their controls. */
export const useReadingToolsStore = create<ReadingToolsState>(() => ({
  available: false, listening: false, translation: false, translationProgress: null, hasTranslation: false,
  showRecall: true, playing:false, loading:false, disabled:false, rate:1,
  onPlay:()=>{},onPause:()=>{},onRate:()=>{},onListen: () => {}, onTranslation: () => {},
  onPlaybackTarget: () => false, onPlaybackTargetEnd: () => {},
}));
