import { Headphones, Languages, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import DisplaySettingsMenu from './DisplaySettingsMenu';
import { useReadingToolsStore } from '../stores/readingToolsStore';
import { useSpeechStore } from '../stores/speechStore';
import DockPresence from './DockPresence';

export default function ReadingTools() {
  const { t } = useTranslation();
  const tools = useReadingToolsStore();
  const loading = useSpeechStore(s => s.loading && s.key?.startsWith('reader:'));
  const listenLabel = t(tools.listening ? 'reader.exitListening' : 'reader.startListening');
  return <DockPresence visible={tools.available} className="dock-reading-presence"><div className="dock-reading-tools" aria-label={t('reader.tools')}>
    <span className="b-dock-divider" aria-hidden="true"/>
    <button type="button" className="b-dock-control" aria-label={listenLabel} title={listenLabel} aria-pressed={tools.listening} aria-busy={!!loading} onClick={tools.onListen}>
      {loading ? <LoaderCircle size={22} className="speech-spinner" aria-hidden="true"/> : <Headphones size={22} aria-hidden="true"/>}
    </button>
    <button type="button" className="b-dock-control" aria-label={t(tools.translation ? 'reader.hideTranslation' : 'reader.showTranslation')} title={t(!tools.hasTranslation ? 'reader.noTranslation' : tools.translation ? 'reader.hideTranslation' : 'reader.showTranslation')} aria-pressed={tools.hasTranslation && tools.translation} disabled={!tools.hasTranslation} onClick={tools.onTranslation}>
      <Languages size={22} aria-hidden="true"/>
    </button>
    <DisplaySettingsMenu dock active={tools.available} showRecall={tools.showRecall}/>
  </div></DockPresence>;
}
