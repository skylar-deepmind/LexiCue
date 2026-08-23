import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import EmptyState from '../components/EmptyState';
import Pagination from '../components/Pagination';
import { learningIndex, learningStage } from '../lib/fileProgress';
import { LANGUAGES, type Language } from '../lib/languages';
import { useInsightsStore } from '../stores/insightsStore';
import { usePreferencesStore } from '../stores/preferencesStore';

const FILE_COVERAGE_PAGE_SIZE = 20;

const STAT_CARDS = [
  { key: 'total_words', labelKey: 'insights.totalWords', color: 'text-gray-900' },
  { key: 'known', labelKey: 'insights.known', color: 'text-green-700' },
  { key: 'learning', labelKey: 'insights.learning', color: 'text-blue-700' },
  { key: 'due_cards', labelKey: 'insights.due', color: 'text-orange-700' },
] as const;

const PHRASE_STAT_CARDS = [
  { key: 'total_phrases', labelKey: 'insights.totalPhrases', color: 'text-gray-900' },
  { key: 'phrases_known', labelKey: 'insights.known', color: 'text-green-700' },
  { key: 'phrases_learning', labelKey: 'insights.learning', color: 'text-purple-700' },
  { key: 'due_phrase_cards', labelKey: 'insights.due', color: 'text-orange-700' },
] as const;

export default function InsightsPage() {
  const { t, i18n } = useTranslation();
  const stats = useInsightsStore((state) => state.stats);
  const loading = useInsightsStore((state) => state.loading);
  const error = useInsightsStore((state) => state.error);
  const load = useInsightsStore((state) => state.load);
  const selectedLanguage = usePreferencesStore((state) => state.language);
  const [insightsLanguage, setInsightsLanguage] = useState<Language | 'all'>(selectedLanguage);
  const [fileCoveragePage, setFileCoveragePage] = useState(1);

  useEffect(() => {
    setInsightsLanguage(selectedLanguage);
  }, [selectedLanguage]);

  useEffect(() => {
    void load(insightsLanguage);
    setFileCoveragePage(1);
  }, [insightsLanguage, load]);

  const totalFiles = stats?.files.length ?? 0;
  const totalFileCoveragePages = Math.max(1, Math.ceil(totalFiles / FILE_COVERAGE_PAGE_SIZE));
  const fileCoverageFiles = useMemo(
    () => stats?.files.slice(
      (fileCoveragePage - 1) * FILE_COVERAGE_PAGE_SIZE,
      fileCoveragePage * FILE_COVERAGE_PAGE_SIZE,
    ) ?? [],
    [fileCoveragePage, stats],
  );

  useEffect(() => {
    if (fileCoveragePage > totalFileCoveragePages) setFileCoveragePage(totalFileCoveragePages);
  }, [fileCoveragePage, totalFileCoveragePages]);

  if (loading) return <div className="flex h-full items-center justify-center text-gray-400">{t('insights.loading')}</div>;
  if (error || !stats) return <EmptyState icon="📊" title={t('insights.errorTitle')} description={t('insights.errorDescription')} />;

  const locale = i18n.resolvedLanguage ?? 'zh';
  const masteredRatio = stats.total_words ? Math.round((stats.known / stats.total_words) * 100) : 0;
  const maxDailyReviews = Math.max(1, ...stats.daily_reviews.map((item) => item.count));

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{t('insights.title')}</h1>
            <p className="mt-1 text-sm text-gray-500">{t('insights.subtitle')}</p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-gray-500">
              <span>{t('insights.viewLanguage')}</span>
              <select
                value={insightsLanguage}
                onChange={(event) => setInsightsLanguage(event.target.value as Language | 'all')}
                className="rounded-md border border-gray-200 bg-white px-2 py-1 text-sm text-gray-700 focus:border-blue-500 focus:outline-none"
              >
                <option value="all">{t('common.all')}</option>
                {LANGUAGES.map((language) => <option key={language.id} value={language.id}>{language.label}</option>)}
              </select>
            </label>
            <span className="text-xs text-gray-400">{t('insights.reviewed', { count: stats.total_reviews + stats.total_phrase_reviews })}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {STAT_CARDS.map((card) => (
            <div key={card.key} className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-xs text-gray-500">{t(card.labelKey)}</p>
              <p className={`mt-2 text-2xl font-semibold ${card.color}`}>{stats[card.key]}</p>
            </div>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {PHRASE_STAT_CARDS.map((card) => (
            <div key={card.key} className="rounded-xl border border-purple-200 bg-purple-50/30 p-4">
              <p className="text-xs text-gray-500">{t(card.labelKey)}</p>
              <p className={`mt-2 text-2xl font-semibold ${card.color}`}>{stats[card.key]}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-gray-900">{t('insights.wordDistribution')}</h2>
              <span className="text-sm text-green-700">{masteredRatio}%</span>
            </div>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-gray-100">
              <div className="h-full bg-green-500" style={{ width: `${masteredRatio}%` }} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <div className="text-gray-500">{t('status.unprocessed')} <strong className="float-right text-gray-800">{stats.unprocessed}</strong></div>
              <div className="text-gray-500">{t('status.learning')} <strong className="float-right text-blue-700">{stats.learning}</strong></div>
              <div className="text-gray-500">{t('status.known')} <strong className="float-right text-green-700">{stats.known}</strong></div>
              <div className="text-gray-500">{t('status.ignored')} <strong className="float-right text-gray-800">{stats.ignored}</strong></div>
            </div>
            <p className="mt-4 text-xs text-gray-400">{t('insights.knownNote')}</p>
          </section>

          <section className="rounded-xl border border-purple-200 bg-purple-50/30 p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-gray-900">{t('insights.phraseDistribution')}</h2>
              <span className="text-sm text-purple-700">{Math.round((stats.phrases_known / Math.max(1, stats.total_phrases)) * 100)}%</span>
            </div>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-gray-100">
              <div className="h-full bg-purple-500" style={{ width: `${Math.round((stats.phrases_known / Math.max(1, stats.total_phrases)) * 100)}%` }} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <div className="text-gray-500">{t('status.unprocessed')} <strong className="float-right text-gray-800">{stats.phrases_unprocessed}</strong></div>
              <div className="text-gray-500">{t('status.learning')} <strong className="float-right text-purple-700">{stats.phrases_learning}</strong></div>
              <div className="text-gray-500">{t('status.known')} <strong className="float-right text-green-700">{stats.phrases_known}</strong></div>
              <div className="text-gray-500">{t('status.ignored')} <strong className="float-right text-gray-800">{stats.phrases_ignored}</strong></div>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="font-medium text-gray-900">{t('insights.last7Days')}</h2>
            <div className="mt-4 flex h-36 items-end gap-2">
              {stats.daily_reviews.map((item) => (
                <div key={item.day_start} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                  <span className="text-xs text-gray-500">{item.count || ''}</span>
                  <div className="w-full rounded-t bg-blue-500" style={{ height: `${Math.max(4, (item.count / maxDailyReviews) * 100)}%` }} />
                  <span className="text-[10px] text-gray-400">{new Date(item.day_start).toLocaleDateString(locale, { weekday: 'short' })}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="font-medium text-gray-900">{t('insights.fileCoverage')}</h2>
          <p className="mt-1 text-xs text-gray-500">{t('insights.fileCoverageHint')}</p>
          <div className="mt-4 space-y-4">
            {totalFiles === 0 ? <p className="text-sm text-gray-400">{t('insights.noFilesYet')}</p> : fileCoverageFiles.map((file) => {
              const knownRatio = file.total_words ? Math.round((file.known / file.total_words) * 100) : 0;
              const index = learningIndex(
                {
                  total: file.total_words,
                  unprocessed: file.unprocessed,
                  learning: file.learning,
                  known: file.known,
                  ignored: file.ignored,
                },
                {
                  total: file.total_phrases,
                  unprocessed: file.phrases_unprocessed,
                  learning: file.phrases_learning,
                  known: file.phrases_known,
                  ignored: file.phrases_ignored,
                },
                file.phrase_analyzed,
              );
              const stage = learningStage(index);
              return (
                <div key={file.id}>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate text-gray-800">{file.name} <span className="text-xs text-gray-400">({file.language})</span></span>
                    {stage === null ? (
                      <span className="shrink-0 text-xs text-gray-400">{t('fileCard.noLearningContent')}</span>
                    ) : (
                      <span className={`learning-stage learning-stage-${stage} shrink-0 flex items-center gap-1.5 text-xs font-medium`}>
                        <span className="learning-stage-dot" aria-hidden="true" />
                        <span>{t(`fileCard.stage.${stage}`)}</span>
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full rounded-full bg-green-500" style={{ width: `${knownRatio}%` }} />
                  </div>
                  <div className="mt-1 text-xs text-gray-400">{t('insights.fileStatusSummary', { unprocessed: file.unprocessed, learning: file.learning, ignored: file.ignored })}</div>
                  {!file.phrase_analyzed && <div className="mt-1 text-xs text-gray-400">{t('fileCard.wordsOnlyPending')}</div>}
                </div>
              );
            })}
          </div>
          {totalFiles > FILE_COVERAGE_PAGE_SIZE && (
            <div className="-mx-4 -mb-4 mt-4">
              <Pagination
                page={fileCoveragePage}
                pageSize={FILE_COVERAGE_PAGE_SIZE}
                total={totalFiles}
                onPageChange={setFileCoveragePage}
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
