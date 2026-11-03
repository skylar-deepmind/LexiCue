/** Included only in the explicitly built, isolated native slice preview. */
import { getIdentifier } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useOnboardingStore } from '../stores/onboardingStore';
import { useReadingDeskStore } from '../stores/readingDeskStore';
import type { Material, MaterialImportResult, ReadingMaterial } from '../lib/materials';
import type { SavedMutationResult } from '../lib/savedRecords';

const REFINEMENT = import.meta.env.VITE_SLICE_MAC_REFINEMENT === '1';
const MAC_RELEASE = import.meta.env.VITE_SLICE_MAC_RELEASE === '1';
const P4 = import.meta.env.VITE_SLICE_P4 === '1';
const P3 = P4 || import.meta.env.VITE_SLICE_P3 === '1';
const P2 = P3 || import.meta.env.VITE_SLICE_P2 === '1';
export const PREVIEW_ID = REFINEMENT ? (import.meta.env.VITE_SLICE_QA === '1' ? 'com.lexicue.mac-refinement-qa' : 'com.lexicue.mac-refinement-candidate') : MAC_RELEASE ? (import.meta.env.VITE_SLICE_QA === '1' ? 'com.lexicue.mac-release-qa' : 'com.lexicue.mac-release-candidate') : P4 ? (import.meta.env.VITE_SLICE_QA === '1' ? 'com.lexicue.slice-p4-qa' : 'com.lexicue.slice-p4-candidate') : P3 ? (import.meta.env.VITE_SLICE_QA === '1' ? 'com.lexicue.slice-p3-qa' : 'com.lexicue.slice-p3-preview') : P2 ? 'com.lexicue.slice-p2-preview' : 'com.lexicue.slice-preview';
const KEY = REFINEMENT ? 'lexicue-mac-refinement:seed-v1' : MAC_RELEASE ? 'lexicue-mac-release:seed-v1' : P4 ? 'lexicue-slice-p4-preview:seed-v1' : P3 ? 'lexicue-slice-p3-preview:seed-v1' : P2 ? 'lexicue-slice-p2-preview:seed-v1' : 'lexicue-slice-preview:seed-v1';
export async function assertSlicePreview() {
  if (import.meta.env.VITE_SLICE_PREVIEW !== '1' || await getIdentifier() !== PREVIEW_ID) {
    throw new Error('Preview fixtures require the isolated application identifier');
  }
}
export async function prepareSlicePreview() {
  await assertSlicePreview();
  if (localStorage.getItem(KEY)) return;
  // Stable operation IDs make an interrupted first launch safe to retry. User
  // changes after a successful first launch are never reset by this bootstrap.
  const stories = [
    { name: 'A quiet morning', lines: [
      'The morning light fell softly across the kitchen table.',
      'She opened the window and listened to the birds outside.',
      'I put on my coat and stepped into the quiet street.',
      'A small cafe near the station was already open.',
      'We ordered coffee and talked about our plans for the day.',
      'Our plane will take off at nine, so we should leave soon.',
      'I looked at the sky and felt ready for a new beginning.',
      'Sometimes a quiet morning is all we need to feel at home.',
    ] },
    { name: 'A new journey', lines: [
      'We watched the plane take off into the bright blue sky.',
      'My coat was warm enough for the early morning air.',
      'Every journey begins with one small step into the unknown.',
      'She took a closer look at the map before we left the station.',
      'There was time to slow down and enjoy the view.',
    ] },
    { name: 'Small discoveries', lines: [
      'Curiosity helps us notice the small details around us.',
      'A good question can open the door to a new idea.',
      'Learning takes time, but each new discovery makes a difference.',
    ] },
  ];
  if (P2) stories.push(
    {name:'Across the city',lines:['We took the train across the city.', 'A quiet place gives us time to think.']},
    {name:'The afternoon walk',lines:['I put on my coat before the afternoon walk.', 'The sun was warm and the street was quiet.']},
    {name:'A fresh page',lines:['She opened a book and began a new chapter.', 'Every page brought a new discovery.']},
    {name:'Keeping a journal',lines:['Writing helps us understand our own thoughts.', 'I saved a small memory from the journey.']},
  );
  const chinese = ['晨光轻柔地洒在厨房的桌面上。','她打开窗户，听着外面的鸟鸣。','我穿上外套，走进安静的街道。','车站附近的一家小咖啡馆已经开门了。','我们点了咖啡，聊起当天的计划。','我们的飞机九点起飞，所以我们应该早点出发。','我望着天空，觉得已经准备好迎接新的开始。','有时，一个宁静的早晨就能让我们感到安心。'];
  const imported: number[] = [];
  for (const [index, story] of stories.entries()) {
    const result = await invoke<MaterialImportResult>('import_reading_material', { input: {
      operation_id: `slice-preview-seed-v1-material-${index}`,
      name: `${story.name}.txt`, content: story.lines.join('\n'), normalized_kind: 'txt',
      segments: story.lines.map((en_text, segmentIndex) => ({ index: segmentIndex, en_text, zh_text: P3 && index === 0 ? chinese[segmentIndex] : null, start_time: null, end_time: null })),
    } });
    imported.push(result.file_id);
  }
  const previous = await invoke<ReadingMaterial>('open_reading_material', { fileId: imported[1] });
  const sentence = previous.segments[0];
  const expression = 'take off';
  const start = sentence.en_text.indexOf(expression);
  await invoke<SavedMutationResult>('mutate_saved_record', { operationId: 'slice-preview-seed-v1-existing-context', mutation: {
    kind: 'save', input: { segment_id: sentence.id, expression, start_offset: start, end_offset: start + expression.length,
      explanation: '旅行中记下的原句。', explanation_source: 'personal' },
  } });
  if (P2) {
    const { lookupLongman, dictionaryReference } = await import('../lib/dictionaryResult');
    const current = await invoke<ReadingMaterial>('open_reading_material', {fileId:imported[0]});
    const examples = [{data:current,index:5,expression:'take off'},{data:current,index:2,expression:'coat'},{data:previous,index:2,expression:'journey'}];
    for (const item of examples) {
      const segment = item.data.segments[item.index], start = segment.en_text.indexOf(item.expression);
      const result = await lookupLongman(item.expression, segment.en_text).catch(() => null);
      await invoke('mutate_saved_record', {operationId:`slice-p2-seed-${item.expression}`,mutation:{kind:'save',input:{segment_id:segment.id,expression:item.expression,start_offset:start,end_offset:start+item.expression.length,explanation:null,explanation_source:'unknown',dictionary_reference:result?dictionaryReference(result):null}}});
    }
  }
  const materials = await invoke<Material[]>('list_materials', { tagIds: [], untagged: false });
  const desk = useReadingDeskStore.getState();
  desk.reconcile(materials);
  for (const id of [...imported.slice(0, P2 ? 5 : 3)].reverse()) {
    const material = materials.find(item => item.id === id);
    if (material) useReadingDeskStore.getState().keep(material);
  }
  useReadingDeskStore.getState().clearNotice();
  const first = materials.find(item => item.id === imported[0])!;
  localStorage.setItem(`lexicue-reader-state:${first.content_hash}`, JSON.stringify({ segment: 0, offset: 0 }));
  usePreferencesStore.getState().setUiLanguage('zh');
  useOnboardingStore.getState().finish('skipped');
  localStorage.setItem(KEY, JSON.stringify({ version: 1, materialIds: imported }));
}
