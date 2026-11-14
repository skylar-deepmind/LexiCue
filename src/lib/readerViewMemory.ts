import type { ReadingMaterial } from './materials';
import type { ReaderViewSnapshot } from './readerNavigation';
import type { LookupDraft, LookupSession } from '../components/ReadingLookup';
import type { ReadingTranslationSnapshot } from './readingTranslationSession';
import { createViewCache } from './pageNavigation';

export interface ReaderMemory {
  data: ReadingMaterial; view: ReaderViewSnapshot;
  drafts: Map<string, LookupDraft>; session: LookupSession;
  translation: ReadingTranslationSnapshot; listening: boolean; playbackIndex?: number;
}
export const readerViews = createViewCache<ReaderMemory>(12);
