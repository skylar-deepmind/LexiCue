import { describe, expect, it } from 'vitest';
import { legacyContent } from '../savedRecords';

describe('readable legacy copies', () => {
  it('keeps notes, English edits and both duplicate-position explanations visible', () => {
    const notes = legacyContent({ definition: '个人注释', occurrence: { meaning_en: 'My correction', usage_zh: '用法' },
      same_position_records: [{ occurrence: { meaning_zh: '另一个个人解释' } }],
      dictionary: { other_senses_json: '[{"meaning_zh":"学会","example_en":"She picked it up."}]' } });
    expect(notes.map(note => note.text)).toEqual(['个人注释', '用法', 'My correction', '学会', 'She picked it up.', '另一个个人解释']);
  });
  it('reads missing or older metadata without throwing away remaining valid content', () => {
    expect(legacyContent(null)).toEqual([]);
    expect(legacyContent({ definition: 'still here', dictionary: { other_senses_json: 'legacy invalid JSON' } })).toEqual([{ label: 'savedRecords.legacyNote', text: 'still here' }]);
  });
});
