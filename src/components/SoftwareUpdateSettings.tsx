import { useEffect, useState } from 'react';
import { getIdentifier, getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useTranslation } from 'react-i18next';
import { isIOSPlatform, isMobilePlatform } from '../lib/platform';
import { useUpdateStore } from '../stores/updateStore';

export default function SoftwareUpdateSettings() {
  const { t } = useTranslation();
  const updates = useUpdateStore();
  const [version, setVersion] = useState('');
  const [identifier, setIdentifier] = useState('');
  useEffect(() => {
    void getVersion().then(setVersion).catch(() => {});
    if (isIOSPlatform()) void getIdentifier().then(setIdentifier).catch(() => {});
  }, []);
  const localInstall = isIOSPlatform() && identifier === 'com.lexicue.dev.lansyncqa';
  return <>
    <h2>{t('settings.directory.versionInfo')}</h2>
    <dl className="settings-facts">
      <div><dt>{t('settings.directory.version')}</dt><dd>{version || '—'}</dd></div>
      {localInstall && <div><dt>{t('settings.directory.method')}</dt><dd>{t('settings.directory.local')}</dd></div>}
    </dl>
    {isMobilePlatform()
      ? <p>{t(localInstall ? 'settings.directory.localHint' : 'settings.directory.channelHint')}</p>
      : <>
        <button className="ui-button" disabled={updates.status === 'checking' || updates.status === 'downloading'} onClick={() => void updates.check()}>{t('settings.updates.check')}</button>
        <div role="status">
          {updates.status === 'checking' && t('common.loading')}
          {updates.status === 'upToDate' && t('settings.updates.upToDate')}
          {updates.status === 'available' && <>
            <p>{t('settings.updates.available', { version: updates.version })}</p>
            <button className="ui-button" onClick={() => void (updates.downloadUrl ? openUrl(updates.downloadUrl) : updates.install())}>
              {t(updates.downloadUrl ? 'settings.updates.downloadPage' : 'settings.updates.install')}
            </button>
          </>}
          {updates.status === 'downloading' && <progress aria-label={t('settings.updates.install')} max={100} value={updates.progress}/>}
        </div>
        {updates.error && <p role="alert">{updates.error}</p>}
      </>}
  </>;
}
