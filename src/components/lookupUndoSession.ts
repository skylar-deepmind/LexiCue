import type { SavedRecord } from '../lib/savedRecords';

export interface LookupUndoSession {
  receipts: Map<string, string>;
  undos: Map<string, { receipt: string; promise: Promise<SavedRecord> }>;
}

/** A reopened card observes the same transaction, never issues a second undo. */
export function startLookupUndo(session: LookupUndoSession, key: string, receipt: string, run: (receipt: string) => Promise<SavedRecord>): Promise<SavedRecord> {
  const existing = session.undos.get(key);
  if (existing) return existing.promise;
  const promise = run(receipt).then(record => {
    if (session.receipts.get(key) === receipt) session.receipts.delete(key);
    return record;
  });
  const entry = { receipt, promise };
  session.undos.set(key, entry);
  void promise.then(() => { if (session.undos.get(key) === entry) session.undos.delete(key); }, () => { if (session.undos.get(key) === entry) session.undos.delete(key); });
  return promise;
}

/** Reload authoritative state after an undo fails while its original card is gone. */
export async function recoverLookupUndo(session: LookupUndoSession, key: string, read: () => Promise<SavedRecord | null>) {
  const record = await read();
  return { record, receipt: session.receipts.get(key) ?? null };
}
