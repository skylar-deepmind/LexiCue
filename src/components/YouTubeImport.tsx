import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useYoutubeStore, type TrackSelection, type VideoSubInfo } from '../stores/youtubeStore';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useImportStore } from '../stores/importStore';
import { EMPTY_BROWSER_SESSION } from '../lib/youtubeDownload';
import { trackLanguage } from '../lib/youtubeSelection';
import { inspectImportLink, type ImportLinkError } from '../lib/importLink';

interface Props { initialUrl?: string; autoSearch?: boolean; initialError?: ImportLinkError | 'clipboardFailed'; active?: boolean }

export default function YouTubeImport({ initialUrl = '', autoSearch = false, initialError, active = true }: Props) {
    const { t } = useTranslation();
    const [url, setUrl] = useState(initialUrl);
    const [info, setInfo] = useState<VideoSubInfo | null>(null);
    const [primary, setPrimary] = useState<TrackSelection | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(initialError ? t(`materials.importDialog.${initialError}`) : '');
    const request = useRef(0);
    const listing = useRef(false);
    const enabled = useRef(active);
    const invalidateRequest = useCallback(() => {
        enabled.current = false; request.current++; listing.current = false;
    }, []);
    const english = info ? [...info.manual, ...info.automatic].filter(track => /^en(?:-|$)/i.test(trackLanguage(track)) && track.source !== 'translated') : [];
    const search = useCallback(async (input: string) => {
        if (listing.current || !enabled.current) return;
        const link = inspectImportLink(input);
        if (link.error) { setError(t(`materials.importDialog.${link.error}`)); return; }
        const token = ++request.current;
        listing.current = true;
        setBusy(true); setError(''); setInfo(null); setPrimary(null);
        try {
            const result = await useYoutubeStore.getState().listSubs(link.url, usePreferencesStore.getState().youtube.browserSession ?? EMPTY_BROWSER_SESSION);
            if (token !== request.current) return;
            const track = [...result.manual, ...result.automatic].find(track => /^en(?:-|$)/i.test(trackLanguage(track)) && track.source !== 'translated') ?? null;
            setInfo(result); setPrimary(track);
            if (!track) setError(t('materials.noEnglishSubtitles'));
        } catch {
            if (token === request.current) setError(t('materials.youtubeFailed'));
        } finally { if (token === request.current) { listing.current = false; setBusy(false); } }
    }, [t]);
    useEffect(() => {
        let cancelled = false;
        enabled.current = active;
        if (active && autoSearch && initialUrl) queueMicrotask(() => { if (!cancelled) void search(initialUrl); });
        return () => { cancelled = true; invalidateRequest(); };
    }, [active, autoSearch, initialUrl, search, invalidateRequest]);
    return <div className="lc-import-youtube">
        <form onSubmit={event => { event.preventDefault(); void search(url); }}>
            <label htmlFor="reading-youtube-url">{t('materials.importDialog.linkLabel')}</label>
            <input id="reading-youtube-url" type="url" value={url} onChange={event => {
                request.current++; listing.current = false; setBusy(false); setUrl(event.target.value); setInfo(null); setPrimary(null); setError('');
            }} required placeholder="https://…" autoComplete="off" aria-describedby="lc-import-url-status" />
            <button className={`ui-button${!info ? ' lc-import-primary' : ''}`} disabled={busy || !url.trim()}>{t(busy ? 'common.loading' : 'materials.findSubtitles')}</button>
        </form>
        <div id="lc-import-url-status" role="status">{busy && <p className="lc-import-hint">{t('materials.importDialog.finding')}</p>}</div>
        {error && <p className="lc-import-error" role="alert">{error}</p>}
        {info && <section className="lc-import-tracks"><h3>{info.title}</h3>
            {english.length > 1 && <><label htmlFor="lc-import-english-track">{t('materials.englishSubtitle')}</label><select id="lc-import-english-track" value={english.findIndex(track => track.lang === primary?.lang && track.is_auto === primary?.is_auto)} onChange={event => setPrimary(english[Number(event.target.value)])}>
                {english.map((track, index) => <option key={`${track.lang}-${track.is_auto}`} value={index}>{track.lang} · {t(track.is_auto ? 'materials.automaticSubtitle' : 'materials.manualSubtitle')}</option>)}
            </select></>}
            {primary && <><p className="lc-import-hint">{t('materials.importDialog.translationHint')}</p><button className="ui-button lc-import-primary" onClick={() => void useImportStore.getState().fromYouTube({ url: url.trim(), title: info.title, primary, secondary: null })}>{t('materials.importDialog.generatePreview')}</button></>}
        </section>}
    </div>;
}
