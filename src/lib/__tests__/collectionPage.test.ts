import { expect, it } from 'vitest';
import { collectionPage } from '../collectionPage';
it('keeps a fixed window across ten thousand items, including the final partial page', () => {
  expect(collectionPage(10003,501,20)).toEqual({page:501,pages:501,offset:10000,start:10001,end:10003});
});
it('clamps a removed last page and empty search without inventing items', () => {
  expect(collectionPage(20,501,20)).toEqual({page:1,pages:1,offset:0,start:1,end:20});
  expect(collectionPage(0,9,20)).toEqual({page:1,pages:1,offset:0,start:0,end:0});
  expect(collectionPage(80,-1,20).page).toBe(1);
});
