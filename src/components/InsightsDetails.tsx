import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Overlay from './Overlay';
import { vocabularyProgress, fileLearningIndex } from '../lib/insightsPresentation';
import type { FileProgress, LearningStats } from '../stores/insightsStore';

export type InsightsDetail = { kind: 'summary'; section: 'vocabulary' | 'reviews' } | { kind: 'file'; id: number };

export default function InsightsDetails({ stats, file, languageLabel, section, onClose }: {
  stats: LearningStats; file?: FileProgress; languageLabel: string; section: 'vocabulary' | 'reviews'; onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const reviewSection = useRef<HTMLElement>(null);
  useEffect(() => { if (section === 'reviews') reviewSection.current?.scrollIntoView({ block: 'start' }); }, [section]);
  const source = file ?? stats;
  const [words, phrases] = vocabularyProgress(source);
  const format = (value: number) => value.toLocaleString(i18n.resolvedLanguage);
  const title = t(file ? 'insights.fileStatistics' : 'insights.detailedStatistics');
  const rows: [string, number, number][] = [
    ['insights.total', words.total, phrases.total],
    ['status.known', words.known, phrases.known],
    ['status.learning', words.learning, phrases.learning],
    ['status.unprocessed', words.unprocessed, phrases.unprocessed],
    ['status.ignored', words.ignored, phrases.ignored],
  ];
  if (!file) rows.push(['insights.due', stats.due_cards, stats.due_phrase_cards]);
  const index = file ? fileLearningIndex(file) : null;
  const knownRatio = words.total ? Math.round(words.known / words.total * 100) : null;
  return <Overlay variant="detail" label={title} className="insights-detail-panel" onClose={onClose}>
    <header className="insights-detail-header"><div><h2>{title}</h2><p>{languageLabel}</p></div>
      <button type="button" className="ui-button ui-button--icon" onClick={onClose} aria-label={t('common.close')}><X size={20} aria-hidden="true" /></button>
    </header>
    <div className="insights-detail-body">
      {file && <><h3 className="insights-detail-filename">{file.name}</h3><dl className="insights-file-metrics">
        <div><dt>{t('insights.learningIndex')}</dt><dd>{index === null ? '—' : `${index}%`}</dd></div>
        <div><dt>{t('insights.knownWordRatio')}</dt><dd>{knownRatio === null ? '—' : `${knownRatio}%`}</dd></div>
      </dl><p className="insights-note">{t('learningRing.calculation')}</p></>}
      <table className="insights-table"><caption className="sr-only">{title}</caption><thead><tr>
        <th scope="col">{t('insights.metric')}</th><th scope="col">{t('insights.words')}</th><th scope="col">{t('insights.totalPhrases')}</th>
      </tr></thead><tbody>{rows.map(([label, wordCount, phraseCount]) => <tr key={label}>
        <th scope="row">{t(label)}</th><td>{format(wordCount)}</td><td>{file && !file.phrase_analyzed ? '—' : format(phraseCount)}</td>
      </tr>)}</tbody></table>
      {file && !file.phrase_analyzed && <p className="insights-note">{t('fileCard.wordsOnlyPending')}</p>}
      <p className="insights-note">{t('insights.knownNote')}</p>
      <p className="insights-note">{t(file ? 'insights.fileCoverageHint' : 'insights.dueNote')}</p>
      {!file && <section ref={reviewSection} className="insights-review-details"><h3>{t('insights.reviewStatistics')}</h3>
        <dl><div><dt>{t('insights.last7Days')}</dt><dd>{t('insights.reviewCount', { count: stats.daily_reviews.reduce((sum, item) => sum + item.count, 0) })}</dd></div>
          <div><dt>{t('insights.lifetimeReviews')}</dt><dd>{t('insights.reviewCount', { count: stats.total_reviews + stats.total_phrase_reviews })}</dd></div></dl>
        {stats.daily_reviews.length > 0 && <ul>{stats.daily_reviews.map(day => <li key={day.day_start}><span>{new Date(day.day_start).toLocaleDateString(i18n.resolvedLanguage, { month: 'short', day: 'numeric', weekday: 'short' })}</span><strong>{format(day.count)}</strong></li>)}</ul>}
      </section>}
    </div>
  </Overlay>;
}
