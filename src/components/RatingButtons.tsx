import { useTranslation } from 'react-i18next';
import { type ReviewRating, RATINGS } from '../lib/fsrs';

const COLOR_MAP: Record<string, { bg: string; hover: string; ring: string }> = {
  Again: { bg: 'bg-[#cf6b6f]', hover: 'hover:bg-[#bd5a5e]', ring: 'focus:ring-[#e0a3a6]' },
  Hard: { bg: 'bg-[#d18f45]', hover: 'hover:bg-[#bf7d37]', ring: 'focus:ring-[#e2bc8f]' },
  Good: { bg: 'bg-[#5f9d75]', hover: 'hover:bg-[#4f8a63]', ring: 'focus:ring-[#a9cbb6]' },
  Easy: { bg: 'bg-[#5d84b8]', hover: 'hover:bg-[#4d6fa0]', ring: 'focus:ring-[#a9bcdc]' },
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
        const colors = COLOR_MAP[r.key];
        return (
          <button
            key={r.key}
            onClick={() => onRate(r.value)}
            disabled={disabled}
            className={`min-h-12 px-4 py-3 rounded-xl text-white font-medium text-sm transition-all sm:px-6 ${colors.bg} ${colors.hover} focus:outline-none focus:ring-2 ${colors.ring} disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            <span className="inline-flex items-center justify-center gap-1.5">{t(r.labelKey)}</span>
            {hints[r.key] && <span className="block text-[11px] font-normal opacity-80">{hints[r.key]}</span>}
          </button>
        );
      })}
    </div>
  );
}
