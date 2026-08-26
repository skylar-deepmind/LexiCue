import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useReviewStore } from '../stores/reviewStore';
import type { ReviewRating } from '../lib/fsrs';
import { deserializeCard, scheduleReview, RATINGS } from '../lib/fsrs';
import FlashCard from '../components/FlashCard';
import RatingButtons from '../components/RatingButtons';
import EmptyState from '../components/EmptyState';
import DisplaySettingsMenu from '../components/DisplaySettingsMenu';
import { usePreferencesStore } from '../stores/preferencesStore';
import { CheckCircle2 } from 'lucide-react';
import { Button, Progress } from '../components/ui';
import { LoadingSpinner } from '../components/Skeleton';

export default function ReviewPage() {
  const { t } = useTranslation();
  const {
    queue,
    currentIndex,
    reviewType,
    loading,
    submitting,
    sessionStats,
    loadDueCards,
    submitRating,
    setReviewType,
  } = useReviewStore();
  const [revealed, setRevealed] = useState(false);
  const navigate = useNavigate();
  const selectedLanguage = usePreferencesStore((state) => state.language);

  useEffect(() => {
    void loadDueCards();
  }, [loadDueCards, selectedLanguage]);

  const currentCard = queue[currentIndex] ?? null;

  const formatNextReview = (dueAt: number) => {
    const minutes = Math.max(1, Math.round((dueAt - Date.now()) / 60000));
    if (minutes < 60) return t('review.inMinutes', { count: minutes });
    const hours = Math.round(minutes / 60);
    if (hours < 24) return t('review.inHours', { count: hours });
    return t('review.inDays', { count: Math.round(hours / 24) });
  };

  const ratingHints = currentCard && !('baseline_pending' in currentCard && currentCard.baseline_pending)
    ? Object.fromEntries(RATINGS.map((rating) => {
      const scheduled = scheduleReview(deserializeCard({
        due_at: Date.now(),
        stability: currentCard.stability,
        difficulty: currentCard.difficulty,
        elapsed_days: currentCard.elapsed_days,
        scheduled_days: currentCard.scheduled_days,
        reps: currentCard.reps,
        lapses: currentCard.lapses,
        state: currentCard.state,
      }), rating.grade);
      return [rating.key, formatNextReview(scheduled.due_at)];
    }))
    : {};

  const handleRate = async (rating: ReviewRating) => {
    await submitRating(rating);
    setRevealed(false);
  };

  useEffect(() => {
    setRevealed(false);
  }, [reviewType]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      if (!revealed && event.code === 'Space') {
        event.preventDefault();
        setRevealed(true);
        return;
      }
      if (!revealed || submitting) return;
      const rating = ({ '1': 1, '2': 2, '3': 3, '4': 4 } as const)[event.key];
      if (rating) {
        event.preventDefault();
        void submitRating(rating).then(() => setRevealed(false));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [revealed, submitting, currentCard, submitRating]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex items-center gap-2 text-gray-500" role="status" aria-label={t('common.loading')}><LoadingSpinner />{t('common.loading')}</div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto p-4 pb-10 sm:p-6 sm:pb-12">
      <div className="flex min-h-full flex-col items-center justify-start gap-6 pt-2 sm:justify-center sm:pt-0">
        <div className="flex w-full max-w-lg items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1" role="group" aria-label={t('review.title', 'Review')}>
          <button
            onClick={() => setReviewType('word')}
            aria-pressed={reviewType === 'word'}
            className={`min-h-10 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              reviewType === 'word' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t('review.wordReview')}
          </button>
          <button
            onClick={() => setReviewType('phrase')}
            aria-pressed={reviewType === 'phrase'}
            className={`min-h-10 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              reviewType === 'phrase' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t('review.phraseReview')}
          </button>
        </div>
        <DisplaySettingsMenu />
        </div>

        {!currentCard ? (
          sessionStats.reviewed > 0 ? (
            <div className="ui-card mx-auto flex max-w-lg flex-col items-center p-8 text-center">
              <div className="grid size-16 place-items-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 size={32} aria-hidden="true" /></div>
              <h2 className="mt-4 text-xl font-semibold text-gray-900">{t('review.completedTitle')}</h2>
              <p className="mt-1 text-sm text-gray-500">{t('review.reviewed', { count: sessionStats.reviewed })}</p>
              <div className="mt-6 grid w-full grid-cols-4 gap-2 text-sm">
                {[
                  ['ratings.again', sessionStats.ratings.Again, 'text-red-600'],
                  ['ratings.hard', sessionStats.ratings.Hard, 'text-orange-600'],
                  ['ratings.good', sessionStats.ratings.Good, 'text-green-600'],
                  ['ratings.easy', sessionStats.ratings.Easy, 'text-blue-600'],
                ].map(([labelKey, count, color]) => (
                  <div key={labelKey} className="rounded-lg bg-gray-50 p-2">
                    <div className={`font-semibold ${color}`}>{count}</div>
                    <div className="mt-1 text-xs text-gray-500">{t(labelKey as string)}</div>
                  </div>
                ))}
              </div>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                <Button onClick={() => void loadDueCards(true)}>{t('review.reload')}</Button>
                <Button variant="secondary" onClick={() => navigate('/files')}>{t('review.backToFiles')}</Button>
              </div>
            </div>
          ) : (
            <EmptyState
              icon="✅"
              title={t('review.noDueTitle')}
              description={t('review.noDueDescription')}
            />
          )
        ) : (
          <>
            <div className="w-full max-w-lg">
              <div className="flex items-center justify-between text-sm text-gray-400">
                <span>{t('review.progress', { current: currentIndex + 1, total: queue.length })}</span>
                <span>{Math.round(((currentIndex + 1) / queue.length) * 100)}%</span>
              </div>
              <div className="mt-1.5 h-2"><Progress value={((currentIndex + 1) / queue.length) * 100} label={t('review.progress', { current: currentIndex + 1, total: queue.length })} /></div>
            </div>

            <FlashCard
              card={currentCard}
              revealed={revealed}
              onReveal={() => setRevealed(true)}
            />

            {revealed && (
              <RatingButtons onRate={handleRate} disabled={submitting} hints={ratingHints} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
