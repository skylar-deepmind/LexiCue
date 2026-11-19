import type { SavedRecord } from '../lib/savedRecords';
export default function SavedExcerpt({ record, fallback = '' }: { record: SavedRecord; fallback?: string }) {
  const sentence=record.sentence??fallback,start=record.source?.start_offset,end=record.source?.end_offset;
  const valid=start!=null&&end!=null&&start>=0&&end>start&&end<=sentence.length;
  return valid?<>{sentence.slice(0,start)}<strong>{sentence.slice(start,end)}</strong>{sentence.slice(end)}</>:<>{sentence}</>;
}
