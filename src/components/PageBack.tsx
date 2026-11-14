import { ChevronLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePageReturn } from '../lib/pageNavigation';

export default function PageBack({ fallback = '/files', className = '' }: { fallback?: string; className?: string }) {
  const { t } = useTranslation(), { back } = usePageReturn(fallback);
  return <button type="button" className={`page-back ${className}`} aria-label={t('common.back')} onClick={back}><ChevronLeft size={22} aria-hidden="true" /></button>;
}
