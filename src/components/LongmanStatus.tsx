import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';

interface Status { state: 'ready' | 'unavailable'; release: string | null; error: string | null; audio_available: boolean; audio_error: string | null }
export default function LongmanStatus() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { let active = true; setBusy(true); void invoke<Status>('longman_dictionary_status').then(value => { if (active) setStatus(value); }).catch(() => { if (active) setStatus({ state: 'unavailable', release: null, error: 'unavailable', audio_available: false, audio_error: null }); }).finally(() => { if (active) setBusy(false); }); return () => { active = false; }; }, [attempt]);
  return <details><summary>{t('settings.dictionary.title')}</summary><p role="status">{t('longman.source')} · {t(busy ? 'common.loading' : status?.state === 'ready' ? 'systemSettings.dictionaryReady' : 'longman.unavailable')}</p>{status?.release && <small>{status.release}</small>}{status?.state === 'ready' && !status.audio_available && <p>{t('longman.notices.audio_unavailable')}</p>}{!busy && status?.state !== 'ready' && <button className="ui-button" onClick={() => setAttempt(value => value + 1)}>{t('common.retry')}</button>}</details>;
}
