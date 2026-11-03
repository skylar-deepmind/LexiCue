import type { SavedNoteDraft } from '../lib/readerNavigation';
/** Keep an uncertain write receipt only while its exact payload is unchanged. */
export function updateSavedNoteDraft(previous: SavedNoteDraft | undefined, text: string, revision: string, editing: boolean): SavedNoteDraft {
  return {text, revision, editing, ...(previous?.text === text && previous.revision === revision && previous.operationId ? {operationId: previous.operationId} : {})};
}
