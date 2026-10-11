import type { RefObject } from 'react';
import type { CloseAction } from '../lib/backNavigation';
import { useOverlay } from './useOverlay';

export function useDialogFocus(ref: RefObject<HTMLElement | null>, onClose: CloseAction) {
  useOverlay(ref, onClose);
}
