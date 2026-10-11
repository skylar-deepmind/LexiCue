import { useSyncExternalStore } from 'react';

export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    listener => { const media = matchMedia(query); media.addEventListener('change', listener); return () => media.removeEventListener('change', listener); },
    () => matchMedia(query).matches,
    () => false,
  );
}
