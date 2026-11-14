import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirmationStore } from '../lib/confirmAction';
import Overlay from './Overlay';
import './notifications.css';

export default function ConfirmationHost() {
  const { t } = useTranslation();
  const request = useConfirmationStore(state => state.requests[0]);
  const cancel = useRef<HTMLButtonElement>(null);
  if (!request) return null;
  const finish = (accepted: boolean) => useConfirmationStore.getState().finish(request.id, accepted);
  const title = request.options.title ?? t('common.confirm');
  return <Overlay key={request.id} label={title} className="confirm-popup" layerClassName="confirm-popup-layer" initialFocus={() => cancel.current} onClose={() => {finish(false);return true;}}>
    <h2>{title}</h2><p>{request.message}</p>
    <div className="confirm-popup-actions">
      <button type="button" className="ui-button" ref={cancel} onClick={() => finish(false)}>{request.options.cancelLabel ?? t('common.cancel')}</button>
      <button type="button" className="ui-button ui-button--danger" onClick={() => finish(true)}>{request.options.okLabel ?? t('common.confirm')}</button>
    </div>
  </Overlay>;
}
