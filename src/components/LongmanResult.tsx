import { ChevronDown, CornerDownRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { dictionaryOverview, dictionaryPrototypeGroups, isAuthorPublicSource, senseSelections, type DictionaryEntry, type DictionaryResult, type DictionarySense, type SenseSelection } from '../lib/dictionaryResult';
import DictionarySource from './DictionarySource';

function MeaningList({ meanings, query, showHeadwords = false, start = 1, overview = false, sentenceOverview }: {
  meanings: SenseSelection[];
  query: string;
  showHeadwords?: boolean;
  start?: number;
  overview?: boolean;
  sentenceOverview?: ReadonlySet<DictionarySense>;
}) {
  const { t } = useTranslation();
  const single = sentenceOverview && meanings.length === 1;
  return <ol className={single ? 'dictionary-meanings dictionary-meanings--single' : 'dictionary-meanings'} start={start} role={single ? 'list' : undefined}>
    {meanings.map(({ entry, group, sense }, index) => {
      const related = ['inflection', 'source_relation'].includes(entry.match.type) && entry.headword !== query;
      const headword = !sentenceOverview && (showHeadwords || related) && entry.headword !== meanings[index - 1]?.entry.headword;
      const part = group.part_of_speech ?? group.source_part_of_speech;
      const labels = [...new Set([...group.labels, ...sense.labels].map(label => label.text))];
      const inOverview = overview || sentenceOverview?.has(sense);
      return <li key={`${entry.id}:${group.id}:${sense.id}`} className={inOverview ? 'dictionary-meaning dictionary-overview-line' : 'dictionary-meaning'} data-sense-id={sense.id}
        data-overview-sense={inOverview ? sense.id : undefined} data-overview-headword={inOverview ? entry.headword : undefined}>
        {headword && <strong className="dictionary-overview-headword" lang="en">{related ? `${query} → ${entry.headword}` : entry.headword}</strong>}
        <div className="dictionary-meaning-line">
          {part && !sentenceOverview && <span className="dictionary-meaning-pos">{t(`dictionaryFlow.pos.${part}`, { defaultValue: group.source_part_of_speech ?? part })}</span>}
          <p className="longman-meaning" lang={sense.meaning.zh ? 'zh' : 'en'}>
            {sense.meaning.zh ?? sense.meaning.en}{!!labels.length && <small className="dictionary-meaning-labels" lang="en"> {labels.join(' · ')}</small>}
          </p>
        </div>
        {sentenceOverview && sense.patterns.length > 0 && <SenseCollocations patterns={sense.patterns}/>}
      </li>;
    })}
  </ol>;
}

function SenseCollocations({ patterns }: { patterns: DictionarySense['patterns'] }) {
  const items = new Map<string, DictionarySense['patterns'][number]>();
  for (const pattern of patterns) {
    const existing = items.get(pattern.text);
    if (!existing || (!existing.explanation?.zh && pattern.explanation?.zh)
      || (!existing.explanation?.en && !existing.explanation?.zh && pattern.explanation?.en)) {
      items.set(pattern.text, pattern);
    }
  }
  return <div className="dictionary-sense-collocations">
    <CornerDownRight size={14} strokeWidth={1.85} aria-hidden="true"/>
    <dl>
      {[...items.values()].map(({ text, explanation }) => <div key={text}>
        <dt lang="en">{text}</dt>
        {(explanation?.zh || explanation?.en) && <dd lang={explanation.zh ? 'zh' : 'en'}>{explanation.zh ?? explanation.en}</dd>}
      </div>)}
    </dl>
  </div>;
}

function collocations(entries: DictionaryEntry[]) {
  const items = new Map<string, { text: string; gloss?: string; chinese?: boolean }>();
  for (const entry of entries) {
    for (const pattern of entry.groups.flatMap(group => group.senses.flatMap(sense => sense.patterns))) {
      if (items.get(pattern.text)?.gloss) continue;
      items.set(pattern.text, { text: pattern.text, gloss: pattern.explanation?.zh ?? pattern.explanation?.en ?? undefined, chinese: !!pattern.explanation?.zh });
    }
    for (const text of [entry.match.pattern, ...entry.related_expressions.map(item => item.text)]) {
      if (text && !items.has(text)) items.set(text, { text });
    }
  }
  return [...items.values()];
}

function sentenceHeadwords(entries: DictionaryEntry[]) {
  const headwords = new Map<string, DictionaryEntry[]>();
  for (const entry of entries) {
    const headword = normalizedHeadword(entry.headword);
    headwords.set(headword, [...(headwords.get(headword) ?? []), entry]);
  }
  return [...headwords];
}

function sentenceParts(entries: DictionaryEntry[]) {
  const parts = new Map<string, { part: string; sourcePart: string | null; senses: SenseSelection[]; forms: Set<string> }>();
  for (const entry of entries) {
    for (const group of entry.groups) {
      if (!group.senses.length) continue;
      const part = group.part_of_speech ?? group.source_part_of_speech ?? '';
      const section = parts.get(part) ?? { part, sourcePart: group.source_part_of_speech, senses: [], forms: new Set<string>() };
      section.senses.push(...group.senses.map(sense => ({ entry, group, sense })));
      for (const form of group.forms) section.forms.add(form.text);
      parts.set(part, section);
    }
  }
  return [...parts.values()];
}

const inflectionQualifier = /^(?:inflected|inflection|past(?: tense)?|present(?: tense)?|participle|(?:past|present) participle|gerund|singular|plural|comparative|superlative|third-person singular)$/iu;
const alternateQualifier = /^(?:alt-of|alternative|alternate|abbreviation|clipping|contraction|misspelling|spelling variant)$/iu;

function normalizedHeadword(text: string) {
  return text.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

function hasBaseForm(entry: DictionaryEntry, query: string) {
  if (normalizedHeadword(entry.headword) === query) return false;
  if (entry.match.type === 'inflection') return true;
  if (!['source_relation', 'casefold_candidate', 'reference'].includes(entry.match.type)) return false;
  // The local pack uses source_relation for spelling variants as well as inflections.
  const qualifiers = entry.match.note?.split(' · ').flatMap(relation => {
    const prefix = ` → ${entry.headword}: `;
    const at = relation.indexOf(prefix);
    return at !== -1 && normalizedHeadword(relation.slice(0, at)) === query
      ? relation.slice(at + prefix.length).split(', ').map(label => label.trim())
      : [];
  }) ?? [];
  if (qualifiers.some(label => alternateQualifier.test(label))) return false;
  return qualifiers.some(label => inflectionQualifier.test(label))
    || entry.groups.some(group => group.forms.some(form =>
      normalizedHeadword(form.text) === query && form.label.split(',').some(label => inflectionQualifier.test(label.trim()))));
}

function SentenceDictionary({ result, attribution, onInteract }: {
  result: DictionaryResult;
  attribution: ReactNode;
  onInteract?: () => void;
}) {
  const { t } = useTranslation();
  const query = normalizedHeadword(result.query.text);
  const heads = sentenceHeadwords(result.entries);
  const overview = new Set(dictionaryOverview(result).map(item => item.sense));
  const baseForms = heads.flatMap(([, entries]) => entries.some(entry => hasBaseForm(entry, query)) ? [entries[0].headword] : []);
  return <div className="longman-result word-families" data-result-status={result.status} onPointerDownCapture={onInteract} onKeyDownCapture={onInteract}>
    {!!baseForms.length && <p className="dictionary-base-form">
      <small className="dictionary-plain-label">{t('dictionaryFlow.baseForm', { count: baseForms.length })}</small>
      <strong lang="en">{baseForms.join(' · ')}</strong>
    </p>}
    {heads.map(([headword, entries]) => {
      const showHead = heads.length > 1 || (headword !== query && !baseForms.length);
      const expressions = [...new Set(entries.flatMap(entry => entry.related_expressions.map(item => item.text)))];
      return <div className="dictionary-entry" key={headword}>
        {showHead && <strong className="dictionary-overview-headword" lang="en">{entries[0].headword}</strong>}
        {sentenceParts(entries).map(({ part, sourcePart, senses, forms }) => <section className="dictionary-pos-group" key={part}>
          <h3 className="dictionary-pos-heading">
            {part
              ? <span className="dictionary-meaning-pos dictionary-marker" data-pos={part}>{t(`dictionaryFlow.pos.${part}`, { defaultValue: sourcePart ?? part })}</span>
              : <span className="dictionary-plain-label">{t('annotation.meaning')}</span>}
          </h3>
          <MeaningList meanings={senses} query={result.query.text} sentenceOverview={overview}/>
          {forms.size > 0 && <div className="dictionary-pos-forms">
            <h4><span className="dictionary-meaning-pos dictionary-marker">{t('dictionaryFlow.forms')}</span></h4>
            <p lang="en">{[...forms].join(' · ')}</p>
          </div>}
        </section>)}
        {!!expressions.length && <div className="dictionary-related-expressions">
          <h3 className="dictionary-plain-label">{t('dictionaryFlow.relatedExpressions')}</h3>
          <p lang="en">{expressions.join(' · ')}</p>
        </div>}
      </div>;
    })}
    {result.status==='partial' && result.entries[0]?.source.provider!=='wiktionary' && <p role="status">{t('longman.partial')}</p>}
    {result.notices.filter(n=>n.code!=='online_free_english_only').map((n,i)=><p key={i} role="status">{t(`longman.notices.${n.code}`,{defaultValue:n.text})}</p>)}
    {attribution}
  </div>;
}

export default function LongmanResult({ result, onInteract, sentenceView=false }: { sentenceView?: boolean; result: DictionaryResult; onInteract?: () => void }) {
  const { t } = useTranslation();
  const query = result.query.text;
  const sources = new Map(result.entries.filter(entry => !isAuthorPublicSource(entry.source))
    .map(({ source }) => [source.entry_url ?? source.dataset, source]));
  const attribution = sources.size > 0 && <details className="dictionary-attribution">
    <summary>{t('dictionaryFlow.source')}</summary>
    {[...sources].map(([key, source]) => <DictionarySource key={key} source={source}/>)}
  </details>;
  if (sentenceView) return <SentenceDictionary result={result} attribution={attribution} onInteract={onInteract}/>;

  const overview = dictionaryOverview(result);
  const prototypes = dictionaryPrototypeGroups(result);
  const visible = new Set((prototypes.length ? prototypes.flatMap(prototype => prototype.senses) : overview).map(item => item.sense));
  const remaining = senseSelections(result).filter(item => !visible.has(item.sense));
  const patterns = collocations(result.entries);
  const formsByHeadword = new Map<string, Set<string>>();
  for (const entry of result.entries) {
    const forms = entry.groups.flatMap(group => group.forms.map(form => form.text));
    if (!forms.length) continue;
    const uniqueForms = formsByHeadword.get(entry.headword) ?? new Set<string>();
    for (const form of forms) uniqueForms.add(form);
    formsByHeadword.set(entry.headword, uniqueForms);
  }
  const overviewHasMultipleHeadwords = new Set(overview.map(item => item.entry.headword)).size > 1;
  const multipleHeadwords = new Set(result.entries.map(entry => entry.headword)).size > 1;
  const hasDetails = remaining.length > 0 || patterns.length > 0 || formsByHeadword.size > 0;
  return <div className="longman-result" data-result-status={result.status} onPointerDownCapture={onInteract} onKeyDownCapture={onInteract} onWheelCapture={onInteract}>
    {!!overview.length && <section className="dictionary-overview" aria-label={t('dictionaryFlow.overview')}>
      {prototypes.length ? <div className="dictionary-prototypes">{prototypes.map(prototype => <section key={prototype.headword} className="dictionary-prototype" data-prototype={prototype.headword}>
        <h3 className="dictionary-prototype-heading"><small>{t('dictionaryFlow.prototype')}</small><strong lang="en">{prototype.headword}</strong></h3>
        <MeaningList meanings={prototype.senses} query={query} overview/>
      </section>)}</div> : <MeaningList meanings={overview} query={query} showHeadwords={overviewHasMultipleHeadwords} overview/>}
    </section>}
    {result.status === 'partial' && result.entries[0]?.source.provider !== 'wiktionary' && <p className="longman-notice" role="status">{t('longman.partial')}</p>}
    {result.notices.filter(notice => notice.code !== 'online_free_english_only').map((notice, index) => <p className="longman-notice" role="status" key={index}>{t(`longman.notices.${notice.code}`, { defaultValue: notice.text })}</p>)}
    {hasDetails ? <details className="dictionary-more"><summary>{t('dictionaryFlow.more')}<ChevronDown size={16} aria-hidden="true"/></summary>
      {!!remaining.length && <MeaningList meanings={remaining} query={query} showHeadwords={multipleHeadwords} start={prototypes.length ? 1 : overview.length + 1}/>}
      {!!patterns.length && <section className="dictionary-extra">
        <h3>{t('dictionaryFlow.collocations')}</h3>
        <dl className="dictionary-collocations">{patterns.map(({ text, gloss, chinese }) => <div key={text}>
          <dt lang="en">{text}</dt><dd lang={chinese ? 'zh' : 'en'}>{gloss}</dd>
        </div>)}</dl>
      </section>}
      {!!formsByHeadword.size && <section className="dictionary-extra dictionary-forms">
        <h3>{t('dictionaryFlow.forms')}</h3>
        <div>{[...formsByHeadword].map(([headword, forms]) => <p key={headword} lang="en">{multipleHeadwords && <strong>{headword} </strong>}{[...forms].join(' · ')}</p>)}</div>
      </section>}
      {attribution}
    </details> : attribution}
  </div>;
}
