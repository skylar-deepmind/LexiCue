import { useTranslation } from 'react-i18next';

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}

function getPageNumbers(page: number, totalPages: number): (number | '…')[] {
  if (totalPages <= 7) return range(1, totalPages);
  const pages = new Set<number>([1, totalPages, page - 1, page, page + 1]);
  const sorted = Array.from(pages).filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) out.push('…');
    out.push(p);
    prev = p;
  }
  return out;
}

const btnCls =
  'min-w-8 px-2 h-8 rounded-md text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

export default function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  const { t } = useTranslation();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-between gap-3 flex-wrap">
      <span className="text-xs text-gray-400">
        {t('pagination.range', { start, end, total })}
      </span>
      <div className="flex items-center gap-1">
        <button
          className={`${btnCls} text-gray-500 hover:text-gray-700 hover:bg-gray-50`}
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          {t('pagination.prev')}
        </button>
        {getPageNumbers(page, totalPages).map((p, i) =>
          p === '…' ? (
            <span key={`e-${i}`} className="px-1 h-8 flex items-center text-gray-400 text-sm">
              …
            </span>
          ) : (
            <button
              key={p}
              className={`${btnCls} ${
                p === page
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
              onClick={() => onPageChange(p)}
            >
              {p}
            </button>
          ),
        )}
        <button
          className={`${btnCls} text-gray-500 hover:text-gray-700 hover:bg-gray-50`}
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          {t('pagination.next')}
        </button>
      </div>
    </div>
  );
}
