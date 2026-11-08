import {describe,expect,it} from 'vitest';
import {bookmarkExcerpt,bookmarkTitle,fitBookmarkShelf} from '../bookmarkDesk';
describe('bookmarks use source content',()=>{
    it('keeps a one-sentence material short without inventing context',()=>{
        expect(bookmarkExcerpt('  Small steps matter.  ')).toEqual({quote:'Small steps matter.',context:''});
    });
    it('keeps abbreviations within their sentence and includes nearby context',()=>{
        expect(bookmarkExcerpt('Dr. Smith opened a book. We started reading. Another sentence.')).toEqual({quote:'Dr. Smith opened a book.',context:'We started reading.'});
    });
    it('uses a run-on subtitle as one excerpt and normalizes line breaks',()=>{
        expect(bookmarkExcerpt('we learn\nfrom small steps')).toEqual({quote:'we learn from small steps',context:''});
    });
    it('removes supported import suffixes only from the display title',()=>{
        expect(bookmarkTitle('Morning Walk.txt')).toBe('Morning Walk');
        expect(bookmarkTitle('A lesson in .NET')).toBe('A lesson in .NET');
    });
});
describe('shelf fits complete rows',()=>{
    it('provides four spacious rows for short cards and two compact rows for long cards',()=>{
        expect(fitBookmarkShelf(352,8)).toEqual({count:4,rowHeight:72,height:348});
        expect(fitBookmarkShelf(190,8)).toEqual({count:2,rowHeight:60,height:180});
    });
    it('never makes fake rows to fill an empty or small library',()=>{
        expect(fitBookmarkShelf(500,0).count).toBe(0);
        expect(fitBookmarkShelf(500,1).count).toBe(1);
        for(let available=60;available<600;available++)expect(fitBookmarkShelf(available,8).height).toBeLessThanOrEqual(available);
    });
});
