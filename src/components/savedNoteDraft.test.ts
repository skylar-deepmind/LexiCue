import { describe, expect, it } from 'vitest';
import { updateSavedNoteDraft } from './savedNoteDraft';

describe('saved note draft receipts', () => {
  it('keeps an uncertain operation through dismiss and reopen when payload is unchanged', () => {
    const pending = {text:'note', revision:'r1', operationId:'op', editing:true};
    const dismissed = updateSavedNoteDraft(pending, 'note', 'r1', false);
    expect(updateSavedNoteDraft(dismissed, 'note', 'r1', true)).toEqual(pending);
  });
  it('drops the receipt if text or revision changes', () => {
    const pending = {text:'note', revision:'r1', operationId:'op'};
    expect(updateSavedNoteDraft(pending, 'changed', 'r1', true).operationId).toBeUndefined();
    expect(updateSavedNoteDraft(pending, 'note', 'r2', true).operationId).toBeUndefined();
  });
});
