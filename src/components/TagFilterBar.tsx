import { useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Tags } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useFileStore } from '../stores/fileStore';
import {usePreferencesStore} from '../stores/preferencesStore';
import {tagTone} from '../lib/tagAppearance';

export default function TagFilterBar({ onManage }: { onManage: () => void }) {
  const { t } = useTranslation();
  const tags = useFileStore(state => state.tags);
  const colors=usePreferencesStore(state=>state.tagColors);
  const selected = useFileStore(state => state.selectedTagIds);
  const untagged = useFileStore(state => state.untaggedOnly);
  const loading = useFileStore(state => state.loadingTags);
  const error = useFileStore(state => state.tagsError);
  const filter = useFileStore(state => state.setTagFilter);
  const scroll = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ overflow: false, start: true, end: true });
  const measure = () => {
    const node = scroll.current;
    if (!node) return;
    // Selection adds a checkmark. Measure the chips after that change, against
    // the space available without arrows so the arrows cannot keep themselves
    // mounted merely by narrowing the scroll area.
    const style=getComputedStyle(node),row=node.parentElement!;
    const chips=Array.from(node.children);
    const content=chips.reduce((width,chip)=>width+chip.getBoundingClientRect().width,0)
      +Math.max(0,chips.length-1)*parseFloat(style.columnGap)+parseFloat(style.paddingLeft)+parseFloat(style.paddingRight);
    const rowGap=parseFloat(getComputedStyle(row).columnGap);
    const available=node.clientWidth+Array.from(row.querySelectorAll('.tag-scroll')).reduce((width,button)=>width+button.getBoundingClientRect().width+rowGap,0);
    const next={overflow:content>available+1,start:node.scrollLeft<=1,end:node.scrollLeft+node.clientWidth>=node.scrollWidth-1};
    setEdges(previous=>previous.overflow===next.overflow&&previous.start===next.start&&previous.end===next.end?previous:next);
  };
  useLayoutEffect(() => {
    const node = scroll.current;
    if (!node) return;
    const observer = new ResizeObserver(measure);
    observer.observe(node); measure();
    return () => observer.disconnect();
  }, [tags,selected,untagged]);
  const move = (direction: number) => scroll.current?.scrollBy({ left: direction * (scroll.current.clientWidth * .7), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  return <div className="tag-filter">
    <div className="tag-filter__row" role="group" aria-label={t('tags.filter')}>
      {edges.overflow && <button type="button" className="ui-button ui-button--icon tag-scroll" aria-label={t('tags.scrollLeft')} disabled={edges.start} onClick={() => move(-1)}><ChevronLeft size={18} aria-hidden="true" /></button>}
      <div className="tag-filter__scroll" ref={scroll} onScroll={measure} onFocus={event => {
        if (event.target !== event.currentTarget) event.target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }}>
      <button type="button" className="tag-chip" aria-pressed={!untagged && selected.length === 0} onClick={() => filter([])}>{t('tags.all')}</button>
      <button type="button" className="tag-chip" aria-pressed={untagged} onClick={() => filter([], !untagged)}>{t('tags.untagged')}</button>
        {tags.map(tag => <button type="button" key={tag.id} className={`tag-chip tag-colored tag-tone-${tag.tone ?? tagTone(tag.name,colors)}`} aria-pressed={selected.includes(tag.id)}
          onClick={() => filter(selected.includes(tag.id) ? selected.filter(id => id !== tag.id) : [...selected, tag.id])}>
          {selected.includes(tag.id) && <Check size={15} aria-hidden="true" />}<span>{tag.name}</span>
        </button>)}
      </div>
      {edges.overflow && <button type="button" className="ui-button ui-button--icon tag-scroll" aria-label={t('tags.scrollRight')} disabled={edges.end} onClick={() => move(1)}><ChevronRight size={18} aria-hidden="true" /></button>}
      <button type="button" className="ui-button tag-manage" onClick={onManage} aria-label={t('tags.manage')}><Tags size={18} aria-hidden="true" /><span>{t('tags.manage')}</span></button>
    </div>
    {selected.length > 1 && <p className="tag-hint">{t('tags.matchAll')}</p>}
    {loading && <p className="tag-hint" role="status">{t('common.loading')}</p>}
    {error && <p className="tag-error" role="alert">{t('tags.loadFailed')} <button className="ui-button" onClick={() => void useFileStore.getState().loadTags(true)} disabled={loading}>{t('common.retry')}</button></p>}
  </div>;
}
