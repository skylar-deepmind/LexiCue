import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { collectionPage } from '../lib/collectionPage';
import './collection-browser.css';

export default function CollectionPager({ total, page, size, busy = false, onChange, label }: {
  total: number; page: number; size: number; busy?: boolean; onChange: (page: number) => void; label: string;
}) {
  const { t } = useTranslation();
  const window = collectionPage(total, page, size);
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const value = Number(draft);
    setDraft(null);
    if (draft !== null && draft.trim() && Number.isSafeInteger(value)) onChange(collectionPage(total, value, size).page);
  };
  if (window.pages <= 1) return null;
  return <nav className="collection-pager" aria-label={label} aria-busy={busy}>
    {window.pages > 1 && <div className="collection-page-controls">
      <button type="button" className="desk-text-button" aria-label={t('history.previous')} disabled={busy || window.page === 1} onClick={() => onChange(window.page - 1)}><ChevronLeft size={18} aria-hidden="true" /></button>
      <form onSubmit={event => { event.preventDefault(); commit(); }}>
        <input type="text" inputMode="numeric" pattern="[0-9]*" aria-label={t('collection.goToPage')} disabled={busy}
          value={draft ?? window.page} onChange={event => setDraft(event.target.value)} onFocus={event => event.target.select()}
          onBlur={commit} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setDraft(null); } }} />
        <span aria-label={t('collection.pageCount', { count: window.pages })}>/ {window.pages}</span>
      </form>
      <button type="button" className="desk-text-button" aria-label={t('history.next')} disabled={busy || window.page === window.pages} onClick={() => onChange(window.page + 1)}><ChevronRight size={18} aria-hidden="true" /></button>
    </div>}
  </nav>;
}
