import { Copy, X, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useFeedbackStore, type FeedbackMessage } from '../stores/feedbackStore';
import './notifications.css';

function Notice({ item }: { item: FeedbackMessage }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const busyRef=useRef(false);
  const action = useRef<HTMLButtonElement>(null);
  const Icon = item.type === 'error' ? AlertCircle : item.type === 'success' ? CheckCircle2 : Info;
  const store = useFeedbackStore.getState;
  useEffect(() => { if (item.action?.focus) action.current?.focus({preventScroll:true}); }, [item.action]);
  return <div className="toast-card" data-type={item.type} role="status"
    onMouseEnter={() => store().pause(item.id)} onMouseLeave={() => store().resume(item.id)}
    onFocusCapture={() => store().pause(item.id)} onBlurCapture={event => { if(!busyRef.current&&!event.currentTarget.contains(event.relatedTarget as Node))store().resume(item.id); }}>
    <Icon size={18} aria-hidden="true"/><span className="toast-message">{item.message}</span>
    {item.action && <button type="button" ref={action} className="ui-button toast-action" aria-label={item.action.ariaLabel} disabled={busy} onClick={async () => {
      if(busyRef.current)return;busyRef.current=true;store().pause(item.id);setBusy(true);
      try { if(await item.action!.onClick() !== false)store().dismiss(item.id); }
      catch { store().show(t('shell.saveFailed'),'error'); }
      finally { busyRef.current=false;setBusy(false);requestAnimationFrame(()=>{if(item.action?.focus)action.current?.focus({preventScroll:true});else store().resume(item.id);}); }
    }}>{item.action.label}</button>}
    {item.type === 'error' && <button type="button" className="toast-icon" aria-label={t('toast.copyErrorAria')} onClick={() => { void navigator.clipboard.writeText(item.message).catch(()=>{}); }}><Copy size={16} aria-hidden="true"/></button>}
    <button type="button" className="toast-icon" disabled={busy} aria-label={t('toast.closeAria')} onClick={() => store().dismiss(item.id)}><X size={16} aria-hidden="true"/></button>
  </div>;
}
export default function ToastHost() {
  const messages = useFeedbackStore(state => state.messages);
  return createPortal(<div className="notification-host" data-notification-host="">{messages.map(item => <Notice key={item.id} item={item}/>)}</div>,document.body);
}
