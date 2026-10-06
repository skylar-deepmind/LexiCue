import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ChevronRight, ChartNoAxesColumn } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import LearningProgressRing from '../components/LearningProgressRing';
import AppSelect from '../components/AppSelect';
import EmptyState from '../components/EmptyState';
import Pagination from '../components/Pagination';
import InsightsDetails, { type InsightsDetail } from '../components/InsightsDetails';
import { vocabularyProgress, fileLearningIndex } from '../lib/insightsPresentation';
import { LANGUAGES, type Language } from '../lib/languages';
import type { LearningProgress } from '../lib/types';
import { useInsightsStore } from '../stores/insightsStore';
import { usePreferencesStore } from '../stores/preferencesStore';

const FILE_COVERAGE_PAGE_SIZE = 20;
const statuses = ['known', 'learning', 'unprocessed', 'ignored'] as const;

function MasteryRing({ progress, label }: { progress: LearningProgress; label: string }) {
  const { t } = useTranslation();
  const percent = progress.total ? Math.round(progress.known / progress.total * 100) : null;
  let end = 0;
  const stops = statuses.map(status => {
    const start = end;
    end += progress.total ? progress[status] / progress.total * 100 : 0;
    return `var(--insights-${status}) ${start}% ${end}%`;
  });
  const style: CSSProperties = { background: progress.total ? `conic-gradient(${stops.join(', ')})` : 'var(--border)' };
  const description = progress.total ? t('insights.distributionAria', { label, percent, ...progress }) : t('insights.noVocabulary', { label });
  return <div className="insights-mastery-item"><div className="insights-mastery-ring" role="img" aria-label={description} style={style}>
    <div className="insights-mastery-center" aria-hidden="true"><strong>{percent === null ? '—' : `${percent}%`}</strong><span>{t(percent === null ? 'insights.noData' : 'insights.known')}</span></div>
  </div><h3>{label}</h3></div>;
}

export default function InsightsPage() {
  const { t, i18n } = useTranslation();
  const { stats, loading, error, load } = useInsightsStore();
  const selectedLanguage = usePreferencesStore(state => state.language);
  const [insightsLanguage, setInsightsLanguage] = useState<Language | 'all'>(selectedLanguage);
  const [fileCoveragePage, setFileCoveragePage] = useState(1);
  const [detail, setDetail] = useState<InsightsDetail | null>(null);
  const [activeDay, setActiveDay] = useState<number | null>(null);

  useEffect(() => { setInsightsLanguage(selectedLanguage); }, [selectedLanguage]);
  useEffect(() => { void load(insightsLanguage); setFileCoveragePage(1); setDetail(null); setActiveDay(null); }, [insightsLanguage, load]);
  const totalFiles = stats?.files.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalFiles / FILE_COVERAGE_PAGE_SIZE));
  const files = useMemo(() => stats?.files.slice((fileCoveragePage - 1) * FILE_COVERAGE_PAGE_SIZE, fileCoveragePage * FILE_COVERAGE_PAGE_SIZE) ?? [], [fileCoveragePage, stats]);
  useEffect(() => { if (fileCoveragePage > totalPages) setFileCoveragePage(totalPages); }, [fileCoveragePage, totalPages]);

  if (loading) return <div className="insights-loading" role="status">{t('insights.loading')}</div>;
  if (error || !stats) return <EmptyState icon="📊" title={t('insights.errorTitle')} description={t('insights.errorDescription')} />;

  const locale = i18n.resolvedLanguage ?? 'zh';
  const [words, phrases] = vocabularyProgress(stats);
  const maxReviews = Math.max(0, ...stats.daily_reviews.map(day => day.count));
  const recentTotal = stats.daily_reviews.reduce((sum, day) => sum + day.count, 0);
  const day = stats.daily_reviews.find(item => item.day_start === activeDay);
  const dayDescription = day ? t('insights.dailyReview', { date: new Date(day.day_start).toLocaleDateString(locale, { month: 'short', day: 'numeric', weekday: 'short' }), count: day.count }) : null;
  const detailFile = detail?.kind === 'file' ? stats.files.find(file => file.id === detail.id) : undefined;
  const languageLabel = insightsLanguage === 'all' ? t('common.all') : LANGUAGES.find(language => language.id === insightsLanguage)?.label ?? insightsLanguage;
  const showSummary = (section: 'vocabulary' | 'reviews') => setDetail({ kind: 'summary', section });

  return <div className="insights-page"><div className="insights-content">
    <header className="insights-header"><div><h1>{t('insights.title')}</h1><p>{t('insights.subtitle')}</p></div>
      <label className="insights-language"><span>{t('insights.viewLanguage')}</span><AppSelect value={insightsLanguage}
        onChange={value => { setDetail(null); setInsightsLanguage(value as Language | 'all'); }} aria-label={t('insights.viewLanguage')}
        options={[{ value: 'all', label: t('common.all') }, ...LANGUAGES.map(language => ({ value: language.id, label: language.label }))]} /></label>
    </header>
    <section className="insights-dashboard" aria-label={t('insights.overview')}>
      <div className="insights-overview"><div className="insights-section-heading"><h2>{t('insights.overview')}</h2>
        <button type="button" className="insights-detail-link" onClick={() => showSummary('vocabulary')}>{t('insights.viewStatistics')}<ChevronRight size={14} aria-hidden="true" /></button></div>
        <div className="insights-ring-pair"><MasteryRing label={t('insights.words')} progress={words} /><MasteryRing label={t('insights.totalPhrases')} progress={phrases} /></div>
        <ul className="insights-legend">{statuses.map(status => <li key={status}><i className={`insights-dot insights-dot--${status}`} aria-hidden="true" />{t(`status.${status}`)}</li>)}</ul>
      </div>
      <div className="insights-review"><div className="insights-section-heading"><h2>{t('insights.last7Days')}</h2><span className="insights-due">{t('insights.dueCount', { count: stats.due_cards + stats.due_phrase_cards })}</span></div>
        {maxReviews > 0 ? <div className="insights-chart" role="group" aria-label={t('insights.last7Days')}>
          {stats.daily_reviews.map(item => <button type="button" key={item.day_start} className="insights-chart-day"
            aria-label={t('insights.dailyReview', { date: new Date(item.day_start).toLocaleDateString(locale, { month: 'short', day: 'numeric', weekday: 'short' }), count: item.count })}
            aria-pressed={activeDay === item.day_start} onMouseEnter={() => setActiveDay(item.day_start)} onFocus={() => setActiveDay(item.day_start)} onClick={() => setActiveDay(item.day_start)}>
            <span className="insights-chart-plot" aria-hidden="true"><span className="insights-chart-bar" style={{ height: `${item.count / maxReviews * 100}%` }} /></span>
            <span className="insights-chart-label" aria-hidden="true">{new Date(item.day_start).toLocaleDateString(locale, { weekday: 'short' })}</span>
          </button>)}
        </div> : <div className="insights-review-empty"><ChartNoAxesColumn size={26} aria-hidden="true" /><p>{t('insights.noRecentReviews')}</p></div>}
        <div className="insights-review-footer"><span role="status">{dayDescription ?? (recentTotal ? t('insights.recentReviews', { count: recentTotal }) : t('insights.combinedReviews'))}</span>
          <button type="button" className="insights-detail-link" onClick={() => showSummary('reviews')}>{t('insights.details')}<ChevronRight size={14} aria-hidden="true" /></button></div>
      </div>
    </section>
    <section className="insights-files"><div className="insights-section-heading"><h2>{t('insights.fileProgress')}</h2><span>{t('insights.fileCount', { count: totalFiles })}</span></div>
      <p className="insights-files-hint">{t('insights.ringHint')}</p>
      {totalFiles === 0 ? <p className="insights-no-files">{t('insights.noFilesYet')}</p> : <ul className="insights-file-list">{files.map(file => <li key={file.id} className="insights-file-row">
        <div className="insights-file-name"><h3>{file.name}</h3><p>{LANGUAGES.find(language => language.id === file.language)?.label ?? file.language} · {t(file.phrase_analyzed ? 'fileCard.wordsAndPhrases' : 'fileCard.wordsOnly')}</p></div>
        <LearningProgressRing value={fileLearningIndex(file)} />
        <button type="button" className="insights-detail-link" aria-label={t('insights.fileDetailsAria', { name: file.name })} onClick={() => setDetail({ kind: 'file', id: file.id })}>{t('insights.details')}<ChevronRight size={14} aria-hidden="true" /></button>
      </li>)}</ul>}
      <Pagination page={fileCoveragePage} pageSize={FILE_COVERAGE_PAGE_SIZE} total={totalFiles} onPageChange={setFileCoveragePage} />
    </section>
  </div>
    {detail && (detail.kind === 'summary' || detailFile) && <InsightsDetails stats={stats} file={detailFile}
      languageLabel={detailFile ? LANGUAGES.find(language => language.id === detailFile.language)?.label ?? detailFile.language : languageLabel}
      section={detail.kind === 'summary' ? detail.section : 'vocabulary'} onClose={() => setDetail(null)} />}
  </div>;
}
