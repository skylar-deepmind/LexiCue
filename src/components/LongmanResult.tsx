import { useTranslation } from 'react-i18next';
import { accentPronunciations, dictionaryOverview, formatIpa } from '../lib/dictionaryResult';
import type { DictionaryExample, DictionaryGroup, DictionaryLabel, DictionaryNote, DictionaryResult, DictionarySense } from '../lib/dictionaryResult';
import { usePreferencesStore } from '../stores/preferencesStore';
import DictionarySource from './DictionarySource';

function Labels({ labels }: { labels: DictionaryLabel[] }) {
  return <>{labels.map((label, i) => <span className="longman-tag longman-tag--usage" key={`${label.kind}:${i}`}>{label.text}</span>)}</>;
}
function Examples({ examples }: { examples: DictionaryExample[] }) {
  const { t } = useTranslation();
  const render = (example: DictionaryExample) => <div className="longman-example" key={example.id}><p lang="en">{example.english}</p>{example.chinese && <p lang="zh">{example.chinese}</p>}</div>;
  return <>{examples.slice(0, 2).map(render)}{examples.length > 2 && <details className="longman-more"><summary>{t('longman.moreExamples', { count: examples.length - 2 })}</summary>{examples.slice(2).map(render)}</details>}</>;
}
function Notes({ notes }: { notes: DictionaryNote[] }) {
  const { t } = useTranslation();
  if (!notes.length) return null;
  return <details className="longman-more longman-notes"><summary>{t('longman.notes', { count: notes.length })}</summary>{notes.map(note => <section key={note.id}><span className="longman-tag longman-tag--usage">{t(`longman.noteKinds.${note.kind}`, { defaultValue: note.kind })}</span><p>{note.content.zh ?? note.content.en}</p>{note.content.zh && note.content.en && <details><summary>{t('longman.english')}</summary><p lang="en">{note.content.en}</p></details>}<Examples examples={note.examples}/></section>)}</details>;
}
function PartOfSpeech({ group }: { group: DictionaryGroup }) {
  const { t } = useTranslation();
  const part = group.part_of_speech ?? group.source_part_of_speech;
  return part ? <span className="longman-tag longman-tag--pos dictionary-overview-pos">{t(`dictionaryFlow.pos.${part}`, { defaultValue: group.source_part_of_speech ?? part })}</span> : null;
}
function Pronunciations({ group, compact = false }: { group: DictionaryGroup; compact?: boolean }) {
  const { t } = useTranslation();
  const accent = usePreferencesStore(state => state.speech.accent);
  const formLabel = (label: string) => label.startsWith('source US variant of ')
    ? t('longman.usVariant', { ipa: label.slice('source US variant of '.length) })
    : label.startsWith('source variant: ') ? t('longman.variant', { form: label.slice('source variant: '.length) }) : label;
  return <>{accentPronunciations(group, accent, !compact).filter(pronunciation => !compact || !pronunciation.form_label?.trim()).map((pronunciation, index) => <span key={index} className={compact ? 'dictionary-overview-ipa' : 'longman-pronunciations'}>
    <span className="sr-only">{t(`longman.regions.${accent === 'gb' ? 'uk' : 'us'}`)} </span><span className="longman-ipa">{formatIpa(pronunciation.ipa!)}</span>{!compact && pronunciation.form_label && <small>{formLabel(pronunciation.form_label)}</small>}
  </span>)}</>;
}
function Sense({ sense, number }: { sense: DictionarySense; number: number }) {
  const { t } = useTranslation();
  return <section className="longman-sense" data-sense-id={sense.id}>
    {sense.ancestors?.map(parent => <p className="dictionary-parent-meaning" key={parent.source_path} lang="en"><Labels labels={parent.labels}/>{parent.meaning.en}</p>)}
    <p className="longman-definition"><span className="longman-sense-number">{number}.</span> <span className="longman-meaning" lang={sense.meaning.zh ? 'zh' : 'en'}>{sense.meaning.zh ?? sense.meaning.en}</span>{!sense.meaning.zh && <span className="longman-tag longman-tag--usage">{t('longman.englishOnly')}</span>}</p>
    <div className="longman-sense-content"><div className="longman-labels"><Labels labels={sense.labels}/></div>
      {sense.meaning.zh && sense.meaning.en && <details className="longman-english"><summary>{t('longman.english')}</summary><p lang="en">{sense.meaning.en}</p></details>}
      <Examples examples={sense.examples}/>
      {!!sense.patterns.length && <details className="longman-more longman-patterns"><summary>{t('longman.patterns', { count: sense.patterns.length })}</summary>{sense.patterns.map(pattern => <section key={pattern.id}><p className="longman-tag longman-tag--pattern" lang="en">{pattern.text}</p><Labels labels={pattern.labels}/>{pattern.explanation && <p>{pattern.explanation.zh ?? pattern.explanation.en}</p>}{pattern.explanation?.zh && pattern.explanation.en && <details><summary>{t('longman.english')}</summary><p lang="en">{pattern.explanation.en}</p></details>}<Examples examples={pattern.examples}/><Notes notes={pattern.notes}/></section>)}</details>}
      <Notes notes={sense.notes}/>
    </div>
  </section>;
}
function Group({ group }: { group: DictionaryGroup }) {
  const { t } = useTranslation();
  const formLabel = (label: string) => {
    if (label.startsWith('source US variant of ')) return t('longman.usVariant', { ipa: label.slice('source US variant of '.length) });
    if (label.startsWith('source variant: ')) return t('longman.variant', { form: label.slice('source variant: '.length) });
    const [kind, ...form] = label.split(': ');
    const key = kind.replace(' (source table)', '').replace('source spelling variant', 'spelling variant').replaceAll(' ', '_').replaceAll(';', '');
    const translated = t(`longman.formLabels.${key}`, { defaultValue: kind.replace(' (source table)', '').replace('source ', '') });
    return form.length ? `${translated}: ${form.join(': ')}` : translated;
  };
  return <section className="longman-group" data-group-id={group.id}>
    <div className="longman-labels"><PartOfSpeech group={group}/><Labels labels={group.labels}/></div>
    <div className="longman-pronunciations"><Pronunciations group={group}/></div>
    {group.senses.map((sense, index) => <Sense key={sense.id} sense={sense} number={index + 1}/>)}
    {!!group.forms.length && <details className="longman-more"><summary>{t('longman.forms', { count: group.forms.length })}</summary>{group.forms.map((form, index) => <p key={index}><span className="longman-tag longman-tag--pattern">{formLabel(form.label)}</span> {form.text}</p>)}</details>}
    <Notes notes={group.notes}/>
  </section>;
}
export default function LongmanResult({ result, onInteract }: { result: DictionaryResult; onInteract?: () => void }) {
  const { t } = useTranslation();
  const overview = dictionaryOverview(result);
  const wiktionary = result.entries[0]?.source.provider === 'wiktionary';
  const groupsShown = new Set<string>();
  const differentHeadwords = new Set(result.entries.map(entry => entry.headword)).size > 1;
  let previousHeadword: string | undefined;
  return <div className="longman-result" data-result-status={result.status} onPointerDownCapture={onInteract} onKeyDownCapture={onInteract} onWheelCapture={onInteract}>
    {!!overview.length && <section className="dictionary-overview" aria-label={t('dictionaryFlow.overview')}>
      <h3>{t('dictionaryFlow.overview')}</h3>
      {wiktionary && <DictionarySource source={result.entries[0].source} compact/>}
      <ul className="dictionary-overview-list">{overview.map(({ entry, group, sense }) => {
        const showPronunciation = !groupsShown.has(group.id); groupsShown.add(group.id);
        const relatedForm = entry.match.type === 'inflection' && entry.headword !== result.query.text;
        const showHeadword = differentHeadwords && previousHeadword !== entry.headword; previousHeadword = entry.headword;
        return <li className="dictionary-overview-line" key={sense.id} data-overview-sense={sense.id} data-overview-headword={entry.headword}><div>{showHeadword && <span className="dictionary-overview-headword" lang="en">{relatedForm ? `${result.query.text} → ${entry.headword}` : entry.headword}</span>}<PartOfSpeech group={group}/>{entry.source.provider === 'wiktionary' && <Labels labels={[...group.labels, ...sense.labels]}/>} {showPronunciation && <Pronunciations group={group} compact/>}</div>{sense.ancestors?.map(parent => <p className="dictionary-parent-meaning" key={parent.source_path} lang="en"><Labels labels={parent.labels}/>{parent.meaning.en}</p>)}<p className="longman-meaning" lang={sense.meaning.zh ? 'zh' : 'en'}>{sense.meaning.zh ?? sense.meaning.en}{!sense.meaning.zh && <small className="longman-tag longman-tag--usage">{t('longman.englishOnly')}</small>}</p></li>;
      })}</ul>
      {!wiktionary && <small className="lookup-provider">{t(`dictionary.${result.entries[0].source.provider}`)}</small>}
    </section>}
    {result.status === 'partial' && !wiktionary && <p className="longman-notice" role="status">{t('longman.partial')}</p>}
    {result.notices.filter(notice => notice.code !== 'online_free_english_only').map((notice, index) => <p className="longman-notice" role="status" key={index}>{t(`longman.notices.${notice.code}`, { defaultValue: notice.text })}</p>)}
    {!!result.entries.length && <details className="dictionary-more"><summary>{t('dictionaryFlow.more')}</summary>
      {result.entries.map(entry => <article className="longman-entry" data-entry-id={entry.id} key={entry.id}>
        <DictionarySource source={entry.source}/>
        <div className="longman-entry-heading"><h3 lang="en">{entry.headword}</h3>{entry.kind === 'expression' && <span className="longman-tag longman-tag--expression">{t(`longman.types.${entry.expression_type ?? 'expression'}`)}</span>}</div>
        {entry.match.type === 'inflection' && entry.headword !== result.query.text && <p className="dictionary-inflection-relation" lang="en">{result.query.text} → {entry.headword}</p>}
        {entry.match.pattern && <p className="longman-match-pattern"><span className="longman-tag longman-tag--pattern">{entry.match.pattern}</span></p>}
        {entry.parent_headword && <p className="lookup-provider">{t('longman.parent', { word: entry.parent_headword })}</p>}
        {entry.groups.map(group => <Group key={group.id} group={group}/>)}
        <Notes notes={entry.notes}/>
        {!!entry.related_expressions.length && <details className="longman-more"><summary>{t('longman.related', { count: entry.related_expressions.length })}</summary>{entry.related_expressions.map((item, i) => <p key={i} lang="en">{item.text}</p>)}</details>}
      </article>)}
    </details>}
  </div>;
}
