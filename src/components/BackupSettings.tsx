import { useEffect, useRef, useState } from 'react';
import VisitLink from './VisitLink';
import { useTranslation } from 'react-i18next';
import { useFileStore } from '../stores/fileStore';

export default function BackupSettings() {
    const { t } = useTranslation();
    const [busy, setBusy] = useState(false);
    const restoreButton = useRef<HTMLButtonElement>(null);
    const returnRestoreFocus = useRef(false);
    useEffect(() => {
        if (busy || !returnRestoreFocus.current) return;
        returnRestoreFocus.current = false;
        const frame = requestAnimationFrame(() => {
            const button = restoreButton.current;
            const active = document.activeElement;
            // A native dialog or the busy overlay can leave focus on the body.
            // Do not override a deliberate focus change made in the meantime.
            if (button?.isConnected && !button.disabled && (active === document.body || active === document.documentElement || active === button)) button.focus({ preventScroll: true });
        });
        return () => cancelAnimationFrame(frame);
    }, [busy]);
    const backup = async (restore = false) => {
        if (restore) returnRestoreFocus.current = true;
        setBusy(true);
        try {
            if (restore) {
                await useFileStore.getState().restoreAll();
            }
            else
                await useFileStore.getState().exportAll();
        }
        finally {
            setBusy(false);
        }
    };
    return <><p>{t('fileStore.backupScope')}</p><div className="settings-options"><button className="ui-button settings-quiet-action" disabled={busy} onClick={() => void backup()}>{t('history.export')}</button><button ref={restoreButton} className="ui-button settings-quiet-action" disabled={busy} onClick={() => void backup(true)}>{t('history.restore')}</button><VisitLink className="ui-button" to="/legacy">{t('materials.history')}</VisitLink></div></>;
}
