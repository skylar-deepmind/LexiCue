import { create } from 'zustand';

interface ReadingToolsState {
  available: boolean;
  listening: boolean;
  translation: boolean;
  hasTranslation: boolean;
  showRecall: boolean;
  onListen: () => void;
  onTranslation: () => void;
}
/** ReadingPage owns the actions; the existing navigation only hosts their controls. */
export const useReadingToolsStore = create<ReadingToolsState>(() => ({
  available: false, listening: false, translation: false, hasTranslation: false,
  showRecall: true, onListen: () => {}, onTranslation: () => {},
}));
