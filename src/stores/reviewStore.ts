import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { DueCard, DuePhraseCard, RatingPayload, PhraseRatingPayload } from '../lib/types';
import { deserializeCard, scheduleReview, RATINGS, type ReviewRating } from '../lib/fsrs';
import { useFeedbackStore } from './feedbackStore';
import { usePreferencesStore } from './preferencesStore';
import i18n from '../i18n';

type ReviewType = 'word' | 'phrase';

interface ReviewStore {
  queue: (DueCard | DuePhraseCard)[];
  currentIndex: number;
  reviewType: ReviewType;
  loading: boolean;
  submitting: boolean;
  sessionStats: {
    reviewed: number;
    ratings: Record<string, number>;
  };
  loadedFor: { reviewType: ReviewType; language: string | null } | null;
  setReviewType: (t: ReviewType) => void;
  loadDueCards: (force?: boolean) => Promise<void>;
  submitRating: (rating: ReviewRating) => Promise<void>;
  nextCard: () => void;
}

function isWordCard(card: DueCard | DuePhraseCard): card is DueCard {
  return 'word_id' in card;
}

function isPhraseCard(card: DueCard | DuePhraseCard): card is DuePhraseCard {
  return 'phrase_id' in card;
}

export function hasActiveSession(state: Pick<ReviewStore, 'queue' | 'sessionStats'>): boolean {
  return state.queue.length > 0 || state.sessionStats.reviewed > 0;
}

export const useReviewStore = create<ReviewStore>((set, get) => ({
  queue: [],
  currentIndex: 0,
  reviewType: 'word',
  loading: false,
  submitting: false,
  sessionStats: {
    reviewed: 0,
    ratings: { Again: 0, Hard: 0, Good: 0, Easy: 0 },
  },
  loadedFor: null,

  setReviewType: (reviewType) => {
    set({ reviewType });
    get().loadDueCards();
  },

  loadDueCards: async (force = false) => {
    const { reviewType } = get();
    const language = usePreferencesStore.getState().language;
    const selectedLanguage = language === 'all' ? null : language;
    const { loadedFor } = get();
    const sameIdentity = loadedFor !== null
      && loadedFor.reviewType === reviewType
      && loadedFor.language === selectedLanguage;
    if (!force && sameIdentity && hasActiveSession(get())) return;

    set({ loading: true });
    try {
      if (reviewType === 'word') {
         const cards: DueCard[] = await invoke('get_due_cards', { language: selectedLanguage });
        set({
          queue: cards,
          currentIndex: 0,
          sessionStats: { reviewed: 0, ratings: { Again: 0, Hard: 0, Good: 0, Easy: 0 } },
          loadedFor: { reviewType, language: selectedLanguage },
        });
      } else {
         const cards: DuePhraseCard[] = await invoke('get_due_phrase_cards', { language: selectedLanguage });
        set({
          queue: cards,
          currentIndex: 0,
          sessionStats: { reviewed: 0, ratings: { Again: 0, Hard: 0, Good: 0, Easy: 0 } },
          loadedFor: { reviewType, language: selectedLanguage },
        });
      }
    } catch (e) {
      console.error('Failed to load due cards:', e);
    } finally {
      set({ loading: false });
    }
  },

  submitRating: async (ratingValue: ReviewRating) => {
    const { queue, currentIndex, reviewType } = get();
    if (currentIndex >= queue.length || get().submitting) return;

    const card = queue[currentIndex];
    const ratingEntry = RATINGS.find(r => r.value === ratingValue);
    if (!ratingEntry) return;

    set({ submitting: true });
    try {
      const currentCard = deserializeCard({
        due_at: Date.now(),
        stability: card.stability,
        difficulty: card.difficulty,
        elapsed_days: card.elapsed_days,
        scheduled_days: card.scheduled_days,
        reps: card.reps,
        lapses: card.lapses,
        state: card.state,
      });

      const result = scheduleReview(currentCard, ratingEntry.grade);

      if (reviewType === 'word' && isWordCard(card)) {
        const payload: RatingPayload = {
          word_id: card.word_id,
          rating: ratingValue,
          card_state: card.state,
          stability: card.stability,
          difficulty: card.difficulty,
          elapsed_days: card.elapsed_days,
          scheduled_days: card.scheduled_days,
          reps: card.reps,
          lapses: card.lapses,
          new_state: result.state,
          new_stability: result.stability,
          new_difficulty: result.difficulty,
          new_elapsed_days: result.elapsed_days,
          new_scheduled_days: result.scheduled_days,
          new_due_at: result.due_at,
        };
        await invoke('submit_rating', { payload });
      } else if (reviewType === 'phrase' && isPhraseCard(card)) {
        const payload: PhraseRatingPayload = {
          phrase_id: card.phrase_id,
          rating: ratingValue,
          card_state: card.state,
          stability: card.stability,
          difficulty: card.difficulty,
          elapsed_days: card.elapsed_days,
          scheduled_days: card.scheduled_days,
          reps: card.reps,
          lapses: card.lapses,
          new_state: result.state,
          new_stability: result.stability,
          new_difficulty: result.difficulty,
          new_elapsed_days: result.elapsed_days,
          new_scheduled_days: result.scheduled_days,
          new_due_at: result.due_at,
        };
        await invoke('submit_phrase_rating', { payload });
      }

      set((state) => ({
        sessionStats: {
          reviewed: state.sessionStats.reviewed + 1,
          ratings: {
            ...state.sessionStats.ratings,
            [ratingEntry.key]: (state.sessionStats.ratings[ratingEntry.key] ?? 0) + 1,
          },
        },
      }));

      const nextIndex = currentIndex + 1;
      if (nextIndex >= queue.length) {
        set({ queue: [], currentIndex: 0 });
      } else {
        set({ currentIndex: nextIndex });
      }
    } catch (e) {
      console.error('Failed to submit rating:', e);
      useFeedbackStore.getState().show(i18n.t('reviewStore.submitFailed'), 'error');
      throw e;
    } finally {
      set({ submitting: false });
    }
  },

  nextCard: () => {
    const { queue, currentIndex } = get();
    const next = currentIndex + 1;
    if (next >= queue.length) {
      set({ queue: [], currentIndex: 0 });
    } else {
      set({ currentIndex: next });
    }
  },
}));

usePreferencesStore.subscribe(
  (state) => state.language,
  () => {
    useReviewStore.getState().loadDueCards();
  },
);

export { RATINGS };
