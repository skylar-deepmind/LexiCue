import { BusyRing } from './LoadingFeedback';
import { BadgeInfo, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getIdentifier, getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useTranslation } from 'react-i18next';
import { isIOSPlatform, isMobilePlatform } from '../lib/platform';
import { useUpdateStore } from '../stores/updateStore';
import { useFeedbackStore } from '../stores/feedbackStore';

export default function SoftwareUpdateSettings() {
  const { t } = useTranslation();
  const updates = useUpdateStore();
  const notice = useRef<number | undefined>(undefined);
  const [version, setVersion] = useState('');
  const [identifier, setIdentifier] = useState('');
  useEffect(() => {
    void getVersion().then(setVersion).catch(() => {});
    if (isIOSPlatform()) void getIdentifier().then(setIdentifier).catch(() => {});
  }, []);
  const mobile = isMobilePlatform();
  const localInstall = isIOSPlatform() && identifier === 'com.lexicue.dev.lansyncqa';
  const busy = updates.status === 'checking' || updates.status === 'downloading';
  const canInstall = updates.status === 'available' || updates.status === 'error' && !!updates.update;
  const notify = (message: string, type: 'success' | 'info' | 'error') => {
    const { dismiss, show } = useFeedbackStore.getState();
    if (notice.current !== undefined) dismiss(notice.current);
    notice.current = show(message, type, type === 'success' ? 3200 : 4800, undefined, 'top', { passive: true });
  };
  const check = async () => {
    const store = useUpdateStore.getState();
    if (store.status === 'checking' || store.status === 'downloading') return;
    await store.check();
    const result = useUpdateStore.getState();
    if (result.status === 'upToDate') notify(t('settings.updates.upToDate'), 'success');
    if (result.status === 'available') notify(t('settings.updates.available', { version: result.version }), 'info');
    if (result.status === 'error') notify(t('settings.updates.checkFailed'), 'error');
  };
  const install = async () => {
    try {
      if (updates.downloadUrl) await openUrl(updates.downloadUrl);
      else {
        await updates.install();
        if (useUpdateStore.getState().status === 'error') notify(t('settings.updates.installFailed'), 'error');
      }
    } catch {
      notify(t('settings.updates.installFailed'), 'error');
    }
  };
  return <div className="update-settings">
    <div className="update-settings-line">
      <dl className="settings-facts">
        <div><dt><BadgeInfo size={20} aria-hidden="true"/>{t('settings.directory.version')}</dt><dd>{version || '—'}</dd></div>
        {localInstall && <div><dt>{t('settings.directory.method')}</dt><dd>{t('settings.directory.local')}</dd></div>}
      </dl>
      {!mobile && <div className="update-settings-actions">
        {canInstall && <button type="button" className="ui-button" onClick={() => void install()}>
          {t(updates.downloadUrl ? 'settings.updates.downloadPage' : 'settings.updates.install')}
        </button>}
        <button type="button" className="approved-icon" disabled={busy} onClick={() => void check()}
          aria-label={t('settings.updates.check')} title={t('settings.updates.check')} aria-busy={updates.status === 'checking'}>
          {updates.status === 'checking' ? <BusyRing/> : <RefreshCw size={19} aria-hidden="true"/>}
        </button>
      </div>}
    </div>
    {mobile && <p className="update-settings-hint">{t(localInstall ? 'settings.directory.localHint' : 'settings.directory.channelHint')}</p>}
    {updates.status === 'downloading' && <progress aria-label={t('settings.updates.downloading')} max={100} value={updates.progress}/>}
  </div>;
}
