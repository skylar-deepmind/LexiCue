import { afterEach, expect, it } from 'vitest';
import { confirmAction, useConfirmationStore } from '../confirmAction';
afterEach(()=>{for(const request of useConfirmationStore.getState().requests)useConfirmationStore.getState().finish(request.id,false);});
it('keeps distinct confirmations queued and never approves a cancelled operation',async()=>{
  const first=confirmAction('Delete material?',{title:'Delete'}),second=confirmAction('Restore?');
  const [a,b]=useConfirmationStore.getState().requests;
  useConfirmationStore.getState().finish(a.id,false);expect(await first).toBe(false);
  expect(useConfirmationStore.getState().requests.map(item=>item.id)).toEqual([b.id]);
  useConfirmationStore.getState().finish(a.id,true);
  useConfirmationStore.getState().finish(b.id,true);expect(await second).toBe(true);
});
