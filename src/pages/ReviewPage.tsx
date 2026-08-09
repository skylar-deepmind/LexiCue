import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useReviewStore } from '../stores/reviewStore';
import type { ReviewRating } from '../lib/fsrs';
import { deserializeCard, scheduleReview, RATINGS } from '../lib/fsrs';
import FlashCard from '../components/FlashCard';
import RatingButtons from '../components/RatingButtons';
import EmptyState from '../components/EmptyState';

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

  useEffect(() => {
    void loadDueCards();
  }, [loadDueCards]);

  const currentCard = queue[currentIndex] ?? null;

  const formatNextReview = (dueAt: number) => {
    const minutes = Math.max(1, Math.round((dueAt - Date.now()) / 60000));
    if (minutes < 60) return t('review.inMinutes', { count: minutes });
    const hours = Math.round(minutes / 60);
    if (hours < 24) return t('review.inHours', { count: hours });
    return t('review.inDays', { count: Math.round(hours / 24) });
  };

  const ratingHints = currentCard
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
        <div className="text-gray-400">{t('common.loading')}</div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto p-4 pb-10 sm:p-6 sm:pb-12">
      <div className="flex min-h-full flex-col items-center justify-start gap-6 pt-2 sm:justify-center sm:pt-0">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setReviewType('word')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              reviewType === 'word' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t('review.wordReview')}
          </button>
          <button
            onClick={() => setReviewType('phrase')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              reviewType === 'phrase' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t('review.phraseReview')}
          </button>
        </div>

        {!currentCard ? (
          sessionStats.reviewed > 0 ? (
            <div className="mx-auto flex max-w-lg flex-col items-center rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
              <div className="text-5xl">🎉</div>
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
              <div className="mt-6 flex gap-2">
                <button onClick={() => void loadDueCards(true)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">{t('review.reload')}</button>
                <button onClick={() => navigate('/files')} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">{t('review.backToFiles')}</button>
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
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full bg-blue-500 transition-[width] duration-300"
                  style={{ width: `${((currentIndex + 1) / queue.length) * 100}%` }}
                />
              </div>
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
