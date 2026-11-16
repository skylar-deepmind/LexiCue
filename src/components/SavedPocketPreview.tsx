import type { SavedRecord } from '../lib/savedRecords';
import { savedCover } from '../lib/materialCover';
import { bookmarkTitle } from '../lib/bookmarkDesk';
import MaterialCover from './MaterialCover';
import SavedExcerpt from './SavedExcerpt';
export default function SavedPocketPreview({ record }: { record: SavedRecord | null }) {
  return <span className="approved-pocket-sheet" data-pocket-record={record?.record_id}>
    {record ? <span className="approved-pocket-preview"><span className="pocket-preview-source"><MaterialCover src={savedCover(record)} identity={record.source?.content_hash??record.source_key}/><span>{bookmarkTitle(record.source?.file_name??'')}</span></span><span className="pocket-preview-sentence" lang="en"><SavedExcerpt record={record}/></span>{record.sentence_translation&&<span className="pocket-preview-translation">{record.sentence_translation}</span>}{record.explanation_source==='personal'&&record.explanation&&<span className="pocket-preview-note">{record.explanation}</span>}</span> : <span className="pocket-empty-lines"/>}
    <em/>
  </span>;
}
