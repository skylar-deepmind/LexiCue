import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLibraryNames } from './useLibraryNames';
import { Plus } from 'lucide-react';
import type { TagInfo, TagSelection } from '../lib/types';
import type { Material } from '../lib/materials';
import { tagNameKey } from '../lib/tagAppearance';
import { useMaterialStore } from '../stores/materialStore';
import LibraryCover from './LibraryCover';
import { bindEdgePicker } from './edgePickerMotion';
import './card-tags.css';
import './lower-rail.css';
import './edge-picker.css';

interface Props {
  tags: TagInfo[];
  current: string;
  loading: boolean;
  disabled: boolean;
  error?: string;
  retry?: () => void;
  choose: (value: TagSelection) => Promise<boolean>;
}
export default function EdgePicker(props: Props) {
  const { t, i18n } = useTranslation(),
    library = useLibraryNames();
  const { current: currentTag, tags } = props;
  const root = useRef<HTMLElement>(null),
    input = useRef<HTMLInputElement>(null);
  const [writing, setWriting] = useState(false),
    [name, setName] = useState('');
  const files = useMaterialStore((s) => s.files);
  const names = useMemo(() => {
    const result = tags.map((t) => t.name);
    if (currentTag && !result.includes(currentTag)) result.push(currentTag);
    return [...result.sort((a, b) => a.localeCompare(b, i18n.language)), ''];
  }, [tags, currentTag, i18n.language]);
  const groups = useMemo(() => {
    const groups = new Map<string, Material[]>();
    for (const file of files) {
      for (const tag of file.tags.length ? file.tags.map((t) => t.name) : ['']) {
        const bucket = groups.get(tag) ?? [];
        if (bucket.length < 4) bucket.push(file);
        groups.set(tag, bucket);
      }
    }
    return groups;
  }, [files]);
  const stop = useRef<() => void>(() => {});
  async function save(text: string) {
    if (props.disabled || props.loading || props.retry) return;
    const value = text.trim(),
      tag = tags.find((t) => tagNameKey(t.name) === tagNameKey(value));
    if (await props.choose({ tagIds: tag ? [tag.id] : [], newTagNames: !tag && value ? [value] : [] }))
      stop.current();
  }
  function pick(i: number) {
    if (i === names.length) {
      setName('');
      setWriting(true);
    } else if (i >= 0 && i < names.length) void save(names[i]);
  }
  const latest = useRef({ pick, disabled: false });
  latest.current = { pick, disabled: props.disabled || props.loading };
  useLayoutEffect(() => {
    const session = bindEdgePicker(
      root.current!,
      names.indexOf(currentTag),
      (i) => latest.current.pick(i),
      () => latest.current.disabled,
      () => setWriting(false),
    );
    stop.current = session.close;
    return () => {
      stop.current = () => {};
      session.destroy();
    };
  }, [names, currentTag]);
  useLayoutEffect(() => {
    if (writing) input.current?.focus({ preventScroll: true });
  }, [writing]);
  return (
    <section className="draw-dock edge-choice" ref={root} aria-label={t('tags.edit')} data-writing={writing}>
      <div
        className="draw-rail"
        onKeyDown={(e) => {
          const by = (
            { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity } as Record<string, number>
          )[e.key];
          if (by === undefined) return;
          e.preventDefault();
          const track = e.currentTarget.firstElementChild!.children;
          const i = Number((e.target as HTMLElement).closest<HTMLElement>('[data-choice]')?.dataset.choice);
          (track[Math.max(0, Math.min(track.length - 1, i + by))] as HTMLElement)?.focus();
        }}
      >
        <div className="draw-track">
          {names.map((n, i) => (
            <button
              type="button"
              key={n}
              data-choice={i}
              className="approved-tag-stack"
              aria-pressed={currentTag === n}
              disabled={props.disabled || props.loading || !!props.retry}
              onClick={() => pick(i)}
            >
              <span className="approved-tag-open">
                <LibraryCover files={groups.get(n) ?? []} />
              </span>
              <span className="approved-tag-name">
                <strong>{n || library.untagged}</strong>
              </span>
            </button>
          ))}
          <button
            type="button"
            data-choice={names.length}
            data-add=""
            disabled={props.disabled || props.loading || !!props.retry}
            className="new-outline"
            aria-label={t('tags.create')}
            onClick={() => pick(names.length)}
          >
            <Plus size={22} strokeWidth={1.4} />
          </button>
        </div>
      </div>
      {writing && (
        <form
          className="write-name"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void save(name);
          }}
        >
          <input
            ref={input}
            aria-label={t('tags.namePlaceholder')}
            placeholder={t('tags.namePlaceholder')}
            maxLength={64}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.keyCode === 229 || e.nativeEvent.isComposing)) e.preventDefault();
            }}
          />
          <button disabled={!name.trim() || props.disabled}>{t('tags.create')}</button>
        </form>
      )}
      {props.error && (
        <span role="alert">
          {props.error} {props.retry && <button onClick={props.retry}>{t('common.retry')}</button>}
        </span>
      )}
    </section>
  );
}
