import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { dictionaryOverview, dictionaryPrototypeGroups, isAuthorPublicSource, senseSelections, type DictionaryEntry, type DictionaryResult, type SenseSelection } from '../lib/dictionaryResult';
import DictionarySource from './DictionarySource';

function MeaningList({ meanings, query, showHeadwords = false, start = 1, overview = false }: {
  meanings: SenseSelection[];
  query: string;
  showHeadwords?: boolean;
  start?: number;
  overview?: boolean;
}) {
  const { t } = useTranslation();
  return <ol className="dictionary-meanings" start={start}>
    {meanings.map(({ entry, group, sense }, index) => {
      const related = ['inflection', 'source_relation'].includes(entry.match.type) && entry.headword !== query;
      const headword = (showHeadwords || related) && entry.headword !== meanings[index - 1]?.entry.headword;
      const part = group.part_of_speech ?? group.source_part_of_speech;
      const labels = [...new Set([...group.labels, ...sense.labels].map(label => label.text))];
      return <li key={sense.id} className={overview ? 'dictionary-meaning dictionary-overview-line' : 'dictionary-meaning'} data-sense-id={sense.id}
        data-overview-sense={overview ? sense.id : undefined} data-overview-headword={overview ? entry.headword : undefined}>
        {headword && <strong className="dictionary-overview-headword" lang="en">{related ? `${query} → ${entry.headword}` : entry.headword}</strong>}
        <div className="dictionary-meaning-line">
          {part && <span className="dictionary-meaning-pos">{t(`dictionaryFlow.pos.${part}`, { defaultValue: group.source_part_of_speech ?? part })}</span>}
          <p className="longman-meaning" lang={sense.meaning.zh ? 'zh' : 'en'}>
            {sense.meaning.zh ?? sense.meaning.en}{!!labels.length && <small className="dictionary-meaning-labels" lang="en"> {labels.join(' · ')}</small>}
          </p>
        </div>
      </li>;
    })}
  </ol>;
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

export default function LongmanResult({ result, onInteract, sentenceView=false }: { sentenceView?: boolean; result: DictionaryResult; onInteract?: () => void }) {
  const { t } = useTranslation();
  const query = result.query.text;
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
  const sources = new Map(result.entries.filter(entry => !isAuthorPublicSource(entry.source))
    .map(({ source }) => [source.entry_url ?? source.dataset, source]));
  const hasDetails = remaining.length > 0 || patterns.length > 0 || formsByHeadword.size > 0;
  const attribution = sources.size > 0 && <details className="dictionary-attribution">
    <summary>{t('dictionaryFlow.source')}</summary>
    {[...sources].map(([key, source]) => <DictionarySource key={key} source={source}/>)}
  </details>;
  if (sentenceView) {

    return <div className="longman-result word-families" data-result-status={result.status} onPointerDownCapture={onInteract} onKeyDownCapture={onInteract}>
      {result.entries.map(entry => <div className="dictionary-entry" key={entry.id}>
        {(multipleHeadwords || entry.headword!==query) && <strong lang="en">{entry.headword}</strong>}
        {entry.groups.map(group => {
          const senses = group.senses.map(sense => ({entry,group,sense}));
          if (!senses.length) return null;
          const uses = collocations([{...entry,match:{...entry.match,pattern:null},related_expressions:[],groups:[group]}]);
          const more = senses.length>1 || uses.length>0 || group.forms.length>0;
          const meaning = <MeaningList meanings={senses.slice(0,1)} query={query} overview/>;
          if (!more) return <section key={group.id}>{meaning}</section>;
          return <details className="pos-group" key={group.id}><summary>{meaning}
            <small>{t('reader.senseCount',{count:senses.length})}{uses.length>0 && ' · '+t('dictionaryFlow.collocations')}</small>
            {uses.length>0 && <em lang="en">{uses.slice(0,2).map(row=>row.text).join('　·　')}</em>}
          </summary><div className="pos-rest">
            {senses.length>1 && <MeaningList meanings={senses.slice(1)} query={query} start={2}/>}
            {uses.length>0 && <dl>{uses.map(use=><div key={use.text}><dt lang="en">{use.text}</dt><dd>{use.gloss}</dd></div>)}</dl>}
            {group.forms.length>0 && <p lang="en">{group.forms.map(form=>form.text).join(' · ')}</p>}
          </div></details>;
        })}
        {entry.related_expressions.length>0 && <p lang="en">{entry.related_expressions.map(item=>item.text).join(' · ')}</p>}
      </div>)}
      {result.status==='partial' && result.entries[0]?.source.provider!=='wiktionary' && <p role="status">{t('longman.partial')}</p>}
      {result.notices.filter(n=>n.code!=='online_free_english_only').map((n,i)=><p key={i} role="status">{t(`longman.notices.${n.code}`,{defaultValue:n.text})}</p>)}
      {attribution}
    </div>;
  }
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
