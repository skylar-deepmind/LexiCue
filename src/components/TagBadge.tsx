import {usePreferencesStore} from '../stores/preferencesStore';
import {tagTone} from '../lib/tagAppearance';
export default function TagBadge({name,tone}:{name:string;tone?:string|null}) {
  const colors=usePreferencesStore(s=>s.tagColors);
  return <span className={`file-tag tag-colored tag-tone-${tone ?? tagTone(name,colors)}`}>{name}</span>;
}
