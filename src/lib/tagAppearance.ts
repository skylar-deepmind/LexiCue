import type {TagInfo, TagSelection} from './types';

export const TAG_TONES=['blue','green','pink','purple','amber','slate'] as const;
export type TagTone=typeof TAG_TONES[number];
export type TagColors=Record<string,TagTone>;
export const tagNameKey=(name:string)=>name.trim().toLowerCase();
export function normalizeTagColors(value:unknown):TagColors {
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  return Object.fromEntries(Object.entries(value).filter(([name,tone])=>tagNameKey(name)&&TAG_TONES.includes(tone as TagTone)).map(([name,tone])=>[tagNameKey(name),tone as TagTone]));
}
export function libraryTagColors(tags: TagInfo[]):TagColors {
  return normalizeTagColors(Object.fromEntries(tags.map(tag=>[tag.name,tag.tone])));
}
export function tagTone(name:string,colors:TagColors):TagTone {
  return colors[tagNameKey(name)]??TAG_TONES[Array.from(name).reduce((sum,char)=>sum+char.codePointAt(0)!,0)%3];
}
/** Saving a visible pending name must not require an extra Enter. */
export function includeTagQuery(value:TagSelection,query:string,tags:TagInfo[]):TagSelection {
  const name=query.trim();if(!name)return value;
  const existing=tags.find(tag=>tagNameKey(tag.name)===tagNameKey(name));
  if(existing)return {...value,tagIds:[...new Set([...value.tagIds,existing.id])]};
  if(value.newTagNames.some(item=>tagNameKey(item)===tagNameKey(name)))return value;
  return {...value,newTagNames:[...value.newTagNames,name]};
}
