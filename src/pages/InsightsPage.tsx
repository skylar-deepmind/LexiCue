import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import EmptyState from '../components/EmptyState';

interface DailyReviewStat {
  day_start: number;
  count: number;
}

interface FileProgress {
  id: number;
  name: string;
  language: string;
  total_words: number;
  unprocessed: number;
  learning: number;
  known: number;
  ignored: number;
}

interface LearningStats {
  total_words: number;
  unprocessed: number;
  learning: number;
  known: number;
  ignored: number;
  due_cards: number;
  total_reviews: number;
  total_phrases: number;
  phrases_unprocessed: number;
  phrases_learning: number;
  phrases_known: number;
  phrases_ignored: number;
  due_phrase_cards: number;
  total_phrase_reviews: number;
  daily_reviews: DailyReviewStat[];
  files: FileProgress[];
}

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
  const [stats, setStats] = useState<LearningStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    invoke<LearningStats>('get_learning_stats')
      .then(setStats)
      .catch((reason) => {
        console.error('Failed to load learning stats:', reason);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, []);

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
          <span className="text-xs text-gray-400">{t('insights.reviewed', { count: stats.total_reviews + stats.total_phrase_reviews })}</span>
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
            {stats.files.length === 0 ? <p className="text-sm text-gray-400">{t('insights.noFilesYet')}</p> : stats.files.map((file) => {
              const knownRatio = file.total_words ? Math.round((file.known / file.total_words) * 100) : 0;
              return (
                <div key={file.id}>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate text-gray-800">{file.name} <span className="text-xs text-gray-400">({file.language})</span></span>
                    <span className="shrink-0 text-xs text-gray-500">{t('insights.masteredInFile', { known: file.known, total: file.total_words })}</span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full rounded-full bg-green-500" style={{ width: `${knownRatio}%` }} />
                  </div>
                  <div className="mt-1 text-xs text-gray-400">{t('insights.fileStatusSummary', { unprocessed: file.unprocessed, learning: file.learning, ignored: file.ignored })}</div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
