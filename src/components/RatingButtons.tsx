import { useTranslation } from 'react-i18next';
import { type ReviewRating, RATINGS } from '../lib/fsrs';

const COLOR_MAP: Record<string, string> = {
  Again: 'rating-again',
  Hard: 'rating-hard',
  Good: 'rating-good',
  Easy: 'rating-easy',
};

interface RatingButtonsProps {
  onRate: (rating: ReviewRating) => void;
  disabled?: boolean;
  hints?: Partial<Record<string, string>>;
}

export default function RatingButtons({ onRate, disabled, hints = {} }: RatingButtonsProps) {
  const { t } = useTranslation();
  return (
    <div className="grid w-full max-w-lg grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
      {RATINGS.map((r) => {
        const colorClass = COLOR_MAP[r.key];
        return (
          <button
            key={r.key}
            onClick={() => onRate(r.value)}
            disabled={disabled}
            className={`min-h-12 rounded-xl px-4 py-3 text-sm font-semibold text-white transition-all sm:px-6 ${colorClass} focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-40`}
          >
            <span className="inline-flex items-center justify-center gap-1.5">{t(r.labelKey)}</span>
            {hints[r.key] && <span className="mt-1 block text-xs font-normal opacity-90">{hints[r.key]}</span>}
          </button>
        );
      })}
    </div>
  );
}
