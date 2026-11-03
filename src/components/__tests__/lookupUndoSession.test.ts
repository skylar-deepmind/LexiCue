import { describe, expect, it, vi } from 'vitest';
import { recoverLookupUndo, startLookupUndo, type LookupUndoSession } from '../lookupUndoSession';
import type { SavedRecord } from '../../lib/savedRecords';

describe('lookup undo session', () => {
  it('reattaches after a card closes and clears only the matching receipt', async () => {
    const session: LookupUndoSession = { receipts: new Map([['first','op-1'],['other','op-2']]), undos: new Map() };
    let resolve!: (record: SavedRecord) => void;
    const run = vi.fn(() => new Promise<SavedRecord>(done => { resolve=done; }));
    const first = startLookupUndo(session,'first','op-1',run);
    const reopened = startLookupUndo(session,'first','op-1',run);
    expect(reopened).toBe(first); expect(run).toHaveBeenCalledTimes(1);
    resolve({ deleted_at: 1 } as SavedRecord); await reopened;
    expect(session.receipts.has('first')).toBe(false);
    expect(session.receipts.get('other')).toBe('op-2');
    expect(session.undos.size).toBe(0);
  });
  it('keeps the receipt on failure so the same undo can be retried', async () => {
    const session: LookupUndoSession = { receipts:new Map([['first','op-1']]), undos:new Map() };
    const run = vi.fn().mockRejectedValueOnce(new Error('conflict')).mockResolvedValueOnce({deleted_at:1});
    await expect(startLookupUndo(session,'first','op-1',run)).rejects.toThrow('conflict');
    expect(session.receipts.get('first')).toBe('op-1');
    await startLookupUndo(session,'first','op-1',run);
    expect(run).toHaveBeenCalledTimes(2); expect(session.receipts.size).toBe(0);
  });
  it('reloads the saved selection and receipt after a reopened pending undo rejects', async () => {
    const session: LookupUndoSession = { receipts:new Map([['first','op-1']]), undos:new Map() };
    const saved = { record_id:'record-1', deleted_at:null } as SavedRecord;
    let reject!: (error: Error) => void;
    const pending = startLookupUndo(session,'first','op-1',() => new Promise((_resolve, fail) => { reject=fail; }));
    const reopened = session.undos.get('first')!.promise;
    reject(new Error('offline'));
    await expect(pending).rejects.toThrow('offline');
    await expect(reopened).rejects.toThrow('offline');
    const recovered = await recoverLookupUndo(session,'first',async () => saved);
    expect(recovered).toEqual({record:saved,receipt:'op-1'});
    expect(session.undos.size).toBe(0);
  });

});
