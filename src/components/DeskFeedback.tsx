import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useReadingDeskStore } from '../stores/readingDeskStore';
import { useFeedbackStore } from '../stores/feedbackStore';

let lastNotice: unknown;
let noticeToast: number | null = null;
let failureShown=false;
export default function DeskFeedback({ beforeUndo }: { beforeUndo?: () => void }) {
  const { t } = useTranslation();
  const { notice, undo, persistenceFailed } = useReadingDeskStore();
  const callback=useRef(beforeUndo);callback.current=beforeUndo;
  useEffect(()=>{
    if(!notice || lastNotice===notice)return;
    lastNotice=notice;
    const feedback=useFeedbackStore.getState();
    if(noticeToast!==null)feedback.dismiss(noticeToast);
    const expected=undo;
    noticeToast=feedback.show(t(`readingDesk.feedback.${notice.kind}`,{name:notice.name}),'info',undo?10000:3000,undo?{
      label:t('readingDesk.undo'),ariaLabel:t('readingDesk.undoLabel'),onClick:()=>{
        if(useReadingDeskStore.getState().undo!==expected){useFeedbackStore.getState().show(t('readingDesk.feedback.undoUnavailable'),'info');return;}
        callback.current?.();useReadingDeskStore.getState().undoChange();
      },
    }:undefined);
  },[notice,undo,t]);
  useEffect(()=>{if(persistenceFailed&&!failureShown)useFeedbackStore.getState().show(t('readingDesk.saveFailed'),'error');failureShown=persistenceFailed;},[persistenceFailed,t]);
  return null;
}
