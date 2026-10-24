import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useYoutubeStore, type TrackSelection, type VideoSubInfo } from '../stores/youtubeStore';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useImportStore } from '../stores/importStore';
import { EMPTY_BROWSER_SESSION } from '../lib/youtubeDownload';
import { trackLanguage } from '../lib/youtubeSelection';
export default function YouTubeImport({ onBack }: {
    onBack: () => void;
}) {
    const { t } = useTranslation();
    const draft = useYoutubeStore.getState().dialogDraft;
    const [url, setUrl] = useState(draft?.url ?? '');
    const [info, setInfo] = useState<VideoSubInfo | null>(draft?.info ?? null);
    const firstEnglish = draft?.info ? [...draft.info.manual, ...draft.info.automatic].find(track => /^en(?:-|$)/i.test(trackLanguage(track))) ?? null : null;
    const [primary, setPrimary] = useState<TrackSelection | null>(draft?.selection.primary && /^en(?:-|$)/i.test(trackLanguage(draft.selection.primary)) ? draft.selection.primary : firstEnglish);
    const [chinese, setChinese] = useState(!!draft?.selection.secondary && /^zh(?:-|$)/i.test(trackLanguage(draft.selection.secondary)));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const english = info ? [...info.manual, ...info.automatic].filter(track => /^en(?:-|$)/i.test(trackLanguage(track))) : [];
    const chineseTrack = info ? [...info.manual, ...info.automatic].find(track => /^zh(?:-|$)/i.test(trackLanguage(track))) ?? null : null;
    const remember = (nextInfo = info, nextPrimary = primary) => useYoutubeStore.setState({ dialogDraft: { url, info: nextInfo, selection: { primary: nextPrimary, secondary: chinese ? chineseTrack : null }, language: 'en', query: '', aiTranslate: false } });
    const search = async () => {
        setBusy(true);
        setError('');
        try {
            const result = await useYoutubeStore.getState().listSubs(url.trim(), usePreferencesStore.getState().youtube.browserSession ?? EMPTY_BROWSER_SESSION);
            const track = [...result.manual, ...result.automatic].find(track => /^en(?:-|$)/i.test(trackLanguage(track))) ?? null;
            setInfo(result);
            setPrimary(track);
            remember(result, track);
            if (!track)
                setError(t('materials.noEnglishSubtitles'));
        }
        catch {
            setError(t('materials.youtubeFailed'));
        }
        finally {
            setBusy(false);
        }
    };
    return <div className="youtube-reading-import"><button className="ui-button" onClick={() => { remember(); onBack(); }}>{t('common.back')}</button>
    <form onSubmit={event => { event.preventDefault(); remember(); void search(); }}><label htmlFor="reading-youtube-url">YouTube URL</label><input id="reading-youtube-url" type="url" value={url} onChange={event => { setUrl(event.target.value); setInfo(null); setPrimary(null); setError(''); }} required placeholder="https://www.youtube.com/watch?v=…" disabled={busy}/><button className="ui-button" disabled={busy}>{t(busy ? 'common.loading' : 'materials.findSubtitles')}</button></form>
    {error && <p className="saved-error" role="alert">{error}</p>}
    {info && <><h3>{info.title}</h3>{english.length > 1 && <label>{t('materials.englishSubtitle')}<select value={english.findIndex(track => track.lang === primary?.lang && track.is_auto === primary?.is_auto)} onChange={event => { const track = english[Number(event.target.value)]; setPrimary(track); remember(info, track); }}>{english.map((track, index) => <option key={`${track.lang}-${track.is_auto}`} value={index}>{track.lang} · {t(track.is_auto ? 'materials.automaticSubtitle' : 'materials.manualSubtitle')}</option>)}</select></label>}
      {chineseTrack && <label className="import-translation"><input type="checkbox" checked={chinese} onChange={event => setChinese(event.target.checked)}/>{t('materials.includeChinese')}</label>}
      {primary && <button className="ui-button saved-primary" onClick={() => { remember(); void useImportStore.getState().fromYouTube({ url: url.trim(), title: info.title, primary, secondary: chinese ? chineseTrack : null }); onBack(); }}>{t('materials.importEnglish')}</button>}</>}
  </div>;
}
