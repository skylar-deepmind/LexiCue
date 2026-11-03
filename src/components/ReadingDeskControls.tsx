import { useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Archive, ArrowLeft, Pin } from 'lucide-react';
import type { Material } from '../lib/materials';
import { matchesMaterial } from '../lib/readingDesk';
import { useReadingDeskStore } from '../stores/readingDeskStore';
import { requestBackNavigation } from '../lib/backNavigation';
import DeskFeedback from './DeskFeedback';
import '../pages/reading-stage.css';

export default function ReadingDeskControls({ material }: { material: Material }) {
    const { t } = useTranslation();
    const { state } = useLocation();
    const store = useReadingDeskStore();
    const lastChange=useRef(-Infinity);
    const onDesk = store.desk.items.some(ref => matchesMaterial(ref, material));
    return <div className="reader-desk-controls">
        <div className="reader-desk-toolbar">
            <button className="desk-text-button" onClick={requestBackNavigation}><ArrowLeft size={16} aria-hidden="true"/>{t(state?.readingOrigin === 'library' ? 'readingDesk.backLibrary' : state?.readingOrigin === 'desk' ? 'readingDesk.backDesk' : 'readingDesk.backMaterials')}</button>
            <div><span className="desk-membership">{t(onDesk ? 'readingDesk.onDesk' : 'readingDesk.stored')}</span><button className="desk-text-button" onClick={event => {
                const now=performance.now();
                if (event.detail>1 || now-lastChange.current<300) return;
                lastChange.current=now;
                if (onDesk) store.archive(material); else store.keep(material);
            }}>{onDesk ? <Archive size={16} aria-hidden="true"/> : <Pin size={16} aria-hidden="true"/>}{t(onDesk ? 'readingDesk.archive' : 'readingDesk.keep')}</button></div>
        </div>
        <DeskFeedback beforeUndo={()=>{lastChange.current=-Infinity;}}/>
    </div>;
}
