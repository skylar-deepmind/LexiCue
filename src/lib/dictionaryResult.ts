import { invoke } from '@tauri-apps/api/core';
import type { DictionaryReference, DictionarySnapshot } from './savedRecords';
import type { SpeechAccent } from './speechPreferences';

export const FREE_DICTIONARY_ADAPTER = 'freedictionaryapi-v1.0.0';
export const WIKTIONARY_ATTRIBUTION = 'Wiktionary contributors via FreeDictionaryAPI.com';
export const WIKTIONARY_MODIFICATIONS = 'Adapted English definitions and ordinary examples; translations, quotations and audio omitted.';
export const CURRENT_PUBLIC_CAMBRIDGE_ADAPTER = 'cambridge-public-v1.1.0';
export const PUBLIC_CAMBRIDGE_ADAPTERS = ['cambridge-public-v1.0.0', CURRENT_PUBLIC_CAMBRIDGE_ADAPTER] as const;

export interface Bilingual { en: string | null; zh: string | null }
export interface DictionaryLabel { kind: string; text: string }
export interface DictionaryAudio { kind: 'local_file' | 'remote_url'; location: string }
export interface DictionaryExample { id: string; english: string; chinese: string | null; audio: DictionaryAudio | null }
export interface DictionaryNote { id: string; kind: string; content: Bilingual; examples: DictionaryExample[] }
export interface DictionaryPattern { id: string; text: string; explanation: Bilingual | null; labels: DictionaryLabel[]; examples: DictionaryExample[]; notes: DictionaryNote[] }
export interface DictionaryAncestor { source_path: string; meaning: Bilingual; labels: DictionaryLabel[] }
export interface DictionarySense { source_path?: string; ancestors?: DictionaryAncestor[]; content_kind?: 'definition' | 'relation'; id: string; meaning: Bilingual; labels: DictionaryLabel[]; patterns: DictionaryPattern[]; examples: DictionaryExample[]; notes: DictionaryNote[] }
export interface DictionaryGroup { id: string; part_of_speech: string | null; source_part_of_speech: string | null; pronunciations: { region: string; ipa: string | null; audio: DictionaryAudio | null; form_label: string | null }[]; forms: { text: string; label: string }[]; labels: DictionaryLabel[]; senses: DictionarySense[]; notes: DictionaryNote[] }
export interface DictionarySourceMetadata {
  provider: 'longman' | 'cambridge' | 'wiktionary'; dataset: string; edition: string | null; release: string | null; adapter_version: string; entry_key: string; locator: string | null; delivery: string; entry_url: string | null; retrieved_at: string | null;
  access_channel?: 'author_public_api' | 'freedictionaryapi'; service_url?: string; received_at?: string; content_hash?: string; license?: { name: string; url: string }; attribution?: string; modifications?: string;
}
export interface DictionaryEntry {
  id: string; headword: string; kind: 'word' | 'expression'; expression_type: string | null; origin: string; parent_headword: string | null;
  source: DictionarySourceMetadata;
  match: { type: string; pattern: string | null; note: string | null; sense_ids: string[] };
  groups: DictionaryGroup[]; notes: DictionaryNote[];
  related_expressions: { text: string; expression_type: string | null; scope_id: string; target_query: string }[];
}
export interface DictionaryResult { schema_version: 1; query: { text: string; language: 'en'; context: string | null }; status: 'found' | 'partial' | 'not_found' | 'unavailable'; default_entry_id: string | null; entries: DictionaryEntry[]; notices: { code: string; text: string; entry_id: string | null }[] }
export interface SenseSelection { entry: DictionaryEntry; group: DictionaryGroup; sense: DictionarySense }
export function senseSelections(result: DictionaryResult | null): SenseSelection[] {
  return result?.entries.flatMap(entry => entry.groups.flatMap(group => group.senses.map(sense => ({ entry, group, sense })))) ?? [];
}
export function defaultSense(result: DictionaryResult | null, savedSense?: string): string {
  const choices = senseSelections(result);
  return choices.find(item => item.sense.id === savedSense)?.sense.id ?? choices.find(item => item.entry.id === result?.default_entry_id)?.sense.id ?? choices[0]?.sense.id ?? '';
}
export function selectedSnapshot({ entry, group, sense }: SenseSelection): DictionarySnapshot {
  const { provider, dataset, edition, release, adapter_version, entry_key, locator, entry_url, retrieved_at, access_channel, service_url, received_at, content_hash, license, attribution, modifications } = entry.source;
  const examples = [...sense.examples, ...sense.patterns.flatMap(pattern => pattern.examples)].filter((example, index, all) => all.findIndex(other => other.id === example.id) === index).slice(0, 2);
  return structuredClone<DictionarySnapshot>({ schema_version: 1, headword: entry.headword, source: { provider, dataset, edition, release, adapter_version, entry_key, locator, ...(entry_url ? { entry_url } : {}), ...(retrieved_at ? { retrieved_at } : {}), ...(access_channel ? { access_channel, service_url, received_at } : {}), ...(provider === 'wiktionary' ? { content_hash, license, attribution, modifications } : {}) }, ...(sense.source_path ? { source_path: sense.source_path, content_kind: sense.content_kind, ancestors: sense.ancestors ? structuredClone(sense.ancestors) : [] } : {}), entry_id: entry.id, group_id: group.id, sense_id: sense.id, part_of_speech: group.part_of_speech, meaning: { ...sense.meaning }, labels: [...group.labels, ...sense.labels].filter((label, index, all) => all.findIndex(other => other.kind === label.kind && other.text === label.text) === index).slice(0, 30), examples: examples.map(({ id, english, chinese }) => ({ id, english, chinese })), patterns: sense.patterns.slice(0, 4).map(item => item.text) });
}
/** Browse a small sample across the applicable POS groups, without selecting a
 * meaning for this sentence. Full entry data remains untouched. */
export function dictionaryOverview(result: DictionaryResult | null, limit = 3): SenseSelection[] {
  const byHeadword = new Map<string, { entry: DictionaryEntry; group: DictionaryGroup; senses: DictionarySense[] }[]>();
  for (const entry of result?.entries ?? []) {
    const groups = byHeadword.get(entry.headword) ?? [];
    groups.push(...entry.groups.map(group => ({ entry, group,
    senses: group.senses.filter(sense => !entry.match.sense_ids.length || entry.match.sense_ids.includes(sense.id)).sort((a, b) => Number(a.content_kind === 'relation') - Number(b.content_kind === 'relation')),
    })));
    byHeadword.set(entry.headword, groups);
  }
  // Give every related headword a place before a second POS group of the
  // direct entry. Otherwise a lexicalized form can hide its parent again.
  const headwordGroups = [...byHeadword.values()];
  const groups = Array.from({ length: Math.max(0, ...headwordGroups.map(items => items.length)) }, (_, index) =>
    headwordGroups.flatMap(items => items[index] ? [items[index]] : [])).flat();
  const overview: SenseSelection[] = [];
  for (let index = 0; overview.length < limit; index++) {
    let found = false;
    for (const { entry, group, senses } of groups) {
      if (senses[index]) { overview.push({ entry, group, sense: senses[index] }); found = true; }
      if (overview.length === limit) break;
    }
    if (!found) break;
  }
  return overview;
}
/** Never substitute a different accent or synthesize phrase pronunciations. */
export function accentPronunciations(group: DictionaryGroup, accent: SpeechAccent, includeFragments = false): DictionaryGroup['pronunciations'] {
  const region = accent === 'gb' ? 'uk' : 'us';
  return group.pronunciations.filter(item => {
    if (item.region.toLowerCase() !== region || !item.ipa?.trim()) return false;
    const ipa = item.ipa.trim().replace(/^\//u, '').replace(/\/$/u, '').trim();
    // Some source US variants contain only the changed ending (e.g. -ɔrd).
    // It is a source relationship, not a complete word pronunciation.
    return includeFragments || !/^[-‐‑‒–—−…]|[-‐‑‒–—−…]$/u.test(ipa);
  });
}
/** Freeze only the excerpt actually visible at save time. Oversized optional
 * reference data is omitted so it can never block saving valid original text. */
export function dictionaryReference(result: DictionaryResult | null): DictionaryReference | null {
  const headword = result?.entries.find(entry => entry.id === result.default_entry_id)?.headword;
  if (!headword || Array.from(headword).length > 256) return null;
  const senses: DictionarySnapshot[] = [];
  for (const selection of dictionaryOverview(result)) {
    if (selection.entry.headword !== headword) continue;
    if (selection.entry.source.provider === 'wiktionary') {
      const labels = [...selection.group.labels, ...selection.sense.labels];
      if (new Set(labels.map(label => `${label.kind}\u0000${label.text}`)).size > 30 || selection.sense.ancestors?.some(parent => parent.labels.length > 30)) return null;
    }
    const snapshot = selectedSnapshot(selection);
    if (snapshot.source.provider !== 'wiktionary') snapshot.labels = [];
    snapshot.examples = []; snapshot.patterns = [];
    if ([snapshot.meaning.en, snapshot.meaning.zh, ...(snapshot.ancestors ?? []).flatMap(parent => [parent.meaning.en, parent.meaning.zh])].some(text => text && Array.from(text).length > 2000)) return null;
    const candidate: DictionaryReference = { schema_version: 1, kind: 'dictionary_excerpt', headword, senses: [...senses, snapshot] };
    if (new TextEncoder().encode(JSON.stringify(candidate)).length > 16_384) return null;
    senses.push(snapshot);
  }
  // Deep-copy: later cache/online changes must not alter a saved reference.
  return senses.length ? JSON.parse(JSON.stringify({ schema_version: 1, kind: 'dictionary_excerpt', headword, senses })) as DictionaryReference : null;
}
/** Source adapters and existing caches may include the IPA delimiters already. */
export function formatIpa(value: string): string {
  let ipa = value.trim();
  if (ipa.startsWith('/')) ipa = ipa.slice(1);
  if (ipa.endsWith('/')) ipa = ipa.slice(0, -1);
  return `/${ipa.trim()}/`;
}
/** Identity checks at the UI save boundary complement native JSON Schema validation. */
export function validateDictionaryResult(value: DictionaryResult, expression: string, provider?: DictionaryEntry['source']['provider']): DictionaryResult {
  if (value?.schema_version !== 1 || value.query?.text !== expression || value.query?.language !== 'en' || !['found', 'partial', 'not_found', 'unavailable'].includes(value.status) || !Array.isArray(value.entries) || !Array.isArray(value.notices)) throw new Error('dictionary_invalid_result');
  const ids = new Set<string>();
  const addId = (id: string, code: string) => { if (!id || ids.has(id)) throw new Error(code); ids.add(id); };
  for (const entry of value.entries) {
    const source = entry.source;
    if (!entry.id || !entry.headword || !source || !['longman', 'cambridge', 'wiktionary'].includes(source.provider) || (provider && source.provider !== provider) || !source.dataset || !source.adapter_version || !source.entry_key || (source.provider === 'longman' && !source.release) || !Array.isArray(entry.groups) || !entry.groups.length || !Array.isArray(entry.match?.sense_ids)) throw new Error('dictionary_invalid_entry');
    const publicMetadata = source.provider !== 'wiktionary' && (source.access_channel !== undefined || source.service_url !== undefined || source.received_at !== undefined || PUBLIC_CAMBRIDGE_ADAPTERS.some(version => source.adapter_version === version));
    if (source.provider === 'wiktionary' && (!isWiktionarySource(source, entry.headword) || !['online', 'cache'].includes(source.delivery) || !entry.id.startsWith(`wiktionary:${FREE_DICTIONARY_ADAPTER}:`) || source.entry_key !== entry.id || entry.headword !== expression || entry.match.type !== 'exact' || entry.match.sense_ids.length > 0)) throw new Error('dictionary_invalid_source');
    if (source.provider !== 'wiktionary' && (source.content_hash !== undefined || source.license !== undefined || source.attribution !== undefined || source.modifications !== undefined)) throw new Error('dictionary_invalid_source');
    if (publicMetadata && (!isAuthorPublicSource(source) || source.adapter_version !== CURRENT_PUBLIC_CAMBRIDGE_ADAPTER || source.entry_url !== null || source.retrieved_at !== null || source.edition !== null || source.release !== null || !['online', 'cache'].includes(source.delivery))) throw new Error('dictionary_invalid_source');
    if (publicMetadata) {
      const checkPublicIds = (item: unknown): void => {
        if (!item || typeof item !== 'object') return;
        if (Array.isArray(item)) { item.forEach(checkPublicIds); return; }
        const object = item as Record<string, unknown>;
        if ('id' in object && (typeof object.id !== 'string' || !object.id.startsWith(`cambridge:public:${CURRENT_PUBLIC_CAMBRIDGE_ADAPTER}:`))) throw new Error('dictionary_invalid_identity');
        Object.values(object).forEach(checkPublicIds);
      };
      checkPublicIds(entry);
    }
    if (source.provider === 'wiktionary') {
      const seen = new Set<string>();
      const scan = (item: unknown): void => {
        if (!item || typeof item !== 'object') return;
        if (Array.isArray(item)) { item.forEach(scan); return; }
        const object = item as Record<string, unknown>;
        if ('id' in object) {
          if (typeof object.id !== 'string' || !object.id.startsWith(`wiktionary:${FREE_DICTIONARY_ADAPTER}:`) || seen.has(object.id)) throw new Error('dictionary_invalid_identity');
          seen.add(object.id);
        }
        if (('zh' in object && object.zh !== null) || ('chinese' in object && object.chinese !== null) || ('audio' in object && object.audio !== null)) throw new Error('dictionary_invalid_source_content');
        Object.values(object).forEach(scan);
      };
      scan(entry);
    }
    if (source.provider === 'cambridge' && ((!publicMetadata && (!isCambridgeEntryUrl(source.entry_url) || !source.retrieved_at || !Number.isFinite(Date.parse(source.retrieved_at)))) || !entry.id.startsWith('cambridge:'))) throw new Error('dictionary_invalid_source');
    addId(entry.id, 'dictionary_invalid_entry');
    const senseIds = new Set<string>();
    for (const group of entry.groups) {
      addId(group.id, 'dictionary_invalid_group');
      if (!Array.isArray(group.senses) || !group.senses.length || !Array.isArray(group.pronunciations)) throw new Error('dictionary_invalid_group');
      if (source.provider === 'wiktionary' && (!group.id.startsWith(`wiktionary:${FREE_DICTIONARY_ADAPTER}:`) || group.pronunciations.some(item => item.audio !== null))) throw new Error('dictionary_invalid_group');
      for (const sense of group.senses) {
        if (source.provider === 'wiktionary') validateWiktionarySense(sense, source.locator!);
        if (!sense.id || ids.has(sense.id) || !(sense.meaning?.zh?.trim() || sense.meaning?.en?.trim()) || !Array.isArray(sense.examples) || !Array.isArray(sense.patterns) || !Array.isArray(sense.notes)) throw new Error('dictionary_invalid_sense');
        addId(sense.id, 'dictionary_invalid_sense'); senseIds.add(sense.id);
        for (const example of sense.examples) { addId(example.id, 'dictionary_invalid_example'); if (!example.english?.trim() || (source.provider === 'wiktionary' && (!example.id.startsWith(`wiktionary:${FREE_DICTIONARY_ADAPTER}:`) || example.chinese !== null || example.audio !== null))) throw new Error('dictionary_invalid_example'); }
      }
    }
    if (entry.match.sense_ids.length && (new Set(entry.match.sense_ids).size !== entry.match.sense_ids.length || entry.match.sense_ids.some(id => !senseIds.has(id)) || [...senseIds].some(id => !entry.match.sense_ids.includes(id)))) throw new Error('dictionary_invalid_scope');
  }
  const publicSenses = value.entries.filter(entry => isAuthorPublicSource(entry.source)).flatMap(entry => entry.groups.flatMap(group => group.senses));
  // Flat public JSON cannot prove that translated and English-only content
  // shares the requested headword scope. Reject the whole payload; never prune
  // meanings by keywords or present an extracted phrase as a word meaning.
  if (publicSenses.some(sense => !!sense.meaning.zh?.trim()) && publicSenses.some(sense => !sense.meaning.zh?.trim() && !!sense.meaning.en?.trim())) throw new Error('dictionary_unconfirmed_scope');
  if (['found', 'partial'].includes(value.status) && (!value.entries.length || !value.entries.some(entry => entry.id === value.default_entry_id))) throw new Error('dictionary_invalid_default');
  if (['not_found', 'unavailable'].includes(value.status) && (value.entries.length || value.default_entry_id !== null)) throw new Error('dictionary_invalid_status');
  return value;
}
/** Public provenance is deliberately separate from the unknown original page metadata. */
export function isAuthorPublicSource(source: DictionarySnapshot['source']): boolean {
  return source.provider === 'cambridge' && source.access_channel === 'author_public_api' && PUBLIC_CAMBRIDGE_ADAPTERS.some(version => source.adapter_version === version) && source.dataset === 'Cambridge Dictionary (author public API)' && source.service_url === 'https://dictionary-api.eliaschen.dev' && typeof source.received_at === 'string' && Number.isFinite(Date.parse(source.received_at));
}
export function isCambridgeEntryUrl(value: string | null | undefined): boolean {
  try { const url = new URL(value ?? ''); return url.protocol === 'https:' && url.hostname === 'dictionary.cambridge.org' && !url.username && !url.password && !url.port && /^\/(?:us\/)?dictionary\//.test(url.pathname); } catch { return false; }
}
/** Validate the reported original locator; this is not an independent original-site fetch. */
export function isWiktionaryEntryUrl(value: string | null | undefined, headword?: string): boolean {
  try {
    const url = new URL(value ?? '');
    if (url.protocol !== 'https:' || url.hostname !== 'en.wiktionary.org' || url.username || url.password || url.port || url.search || url.hash || !url.pathname.startsWith('/wiki/')) return false;
    const path = url.pathname.slice('/wiki/'.length);
    if (!path || path.includes('/') || /%(?![0-9a-fA-F]{2})/u.test(path)) return false;
    const decoded = decodeURIComponent(path).replaceAll('_', ' ');
    return !Array.from(decoded).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) && (headword === undefined || decoded === headword.replaceAll('_', ' '));
  } catch { return false; }
}
export function isWiktionarySource(source: DictionarySnapshot['source'], headword?: string): boolean {
  return source.provider === 'wiktionary' && source.dataset === 'Wiktionary' && source.adapter_version === FREE_DICTIONARY_ADAPTER
    && source.entry_key.startsWith(`wiktionary:${FREE_DICTIONARY_ADAPTER}:entry:`) && /^\/entries\/\d+$/u.test(source.locator ?? '')
    && source.access_channel === 'freedictionaryapi' && source.service_url === 'https://freedictionaryapi.com'
    && source.edition === null && source.release === null && !!source.locator && !!source.entry_key
    && isWiktionaryEntryUrl(source.entry_url, headword) && typeof source.retrieved_at === 'string' && Number.isFinite(Date.parse(source.retrieved_at))
    && typeof source.received_at === 'string' && source.received_at === source.retrieved_at && Number.isFinite(Date.parse(source.received_at)) && /^[a-f0-9]{64}$/u.test(source.content_hash ?? '')
    && source.license?.name === 'CC BY-SA 4.0' && source.license.url === 'https://creativecommons.org/licenses/by-sa/4.0/'
    && source.attribution === WIKTIONARY_ATTRIBUTION && source.modifications === WIKTIONARY_MODIFICATIONS;
}
function validateWiktionarySense(sense: DictionarySense, locator: string): void {
  const path = /^\/entries\/\d+\/senses\/\d+(?:\/subsenses\/\d+)*$/u;
  if (!sense.id.startsWith(`wiktionary:${FREE_DICTIONARY_ADAPTER}:`) || sense.meaning.zh !== null || !sense.meaning.en?.trim()
    || !path.test(sense.source_path ?? '') || !sense.source_path!.startsWith(`${locator}/senses/`) || !['definition', 'relation'].includes(sense.content_kind ?? '') || !Array.isArray(sense.ancestors)
    || sense.ancestors.length > 8 || sense.ancestors.length !== sense.source_path!.split('/subsenses/').length - 1 || sense.ancestors.some((ancestor, index, ancestors) => ancestor.source_path !== sense.source_path!.split('/subsenses/').slice(0, index + 1).join('/subsenses/') || !path.test(ancestor.source_path) || !ancestor.meaning.en?.trim() || ancestor.meaning.zh !== null || !Array.isArray(ancestor.labels) || !sense.source_path!.startsWith(`${ancestor.source_path}/subsenses/`) || (index > 0 && !ancestor.source_path.startsWith(`${ancestors[index - 1].source_path}/subsenses/`)))) throw new Error('dictionary_invalid_sense');
}
export async function lookupLongman(expression: string, context: string): Promise<DictionaryResult> {
  return validateDictionaryResult(await invoke<DictionaryResult>('lookup_longman_expression', { expression, context }), expression, 'longman');
}
export async function lookupCambridge(expression: string, context: string): Promise<DictionaryResult> {
  return validateDictionaryResult(await invoke<DictionaryResult>('lookup_cambridge_expression', { expression, context }), expression, 'cambridge');
}
export async function lookupFreeDictionary(expression: string, context: string, timeoutMs = 8000): Promise<DictionaryResult> {
  return validateDictionaryResult(await invoke<DictionaryResult>('lookup_free_dictionary_expression', { expression, context, timeoutMs }), expression, 'wiktionary');
}
export interface DictionaryContentAssessment { kind: 'substantive' | 'relation_only' | 'unconfirmed' | 'unavailable'; hasEnglish: boolean; hasChinese: boolean; reason: string }
/** Complete relationship clauses are not definitions of the referenced target. Short
 * synonym definitions and full abbreviation expansions remain valid. */
export function isRelationOnlyMeaning(meaning: Bilingual): boolean {
  const en = meaning.en?.trim() ?? '';
  const zh = meaning.zh?.trim() ?? '';
  return /^(?:(?:the )?(?:plural|singular|past tense|past participle|present participle|gerund|misspelling|alternative (?:form|spelling)|alternate (?:form|spelling)|nonstandard (?:form|spelling)|clipping|contraction|inflection|comparative|superlative)(?: form)? of\s+[^.!?]+[.!?]?|a way of (?:saying|writing)\s+[^.!?]+[.!?]?|(?:informal|spoken|colloquial|nonstandard) (?:for|(?:form|variant|spelling) of)\s+[^.!?]+[.!?]?|the act of [\p{L}’'-]+ing[.!?]?)$/iu.test(en)
    || (!en && /^(?:〔|\[)?[^。；;]+的(?:复数|过去式|过去分词|现在分词|变体|另一种拼写|一种说法)(?:〕|\])?[。.]?$/u.test(zh));
}
export function dictionaryContentAssessment(result: DictionaryResult | null): DictionaryContentAssessment {
  if (!result || !['found', 'partial'].includes(result.status)) return { kind: 'unavailable', hasEnglish: false, hasChinese: false, reason: result?.status ?? 'unavailable' };
  let relation = false; let unconfirmed = false; let hasEnglish = false; let hasChinese = false;
  for (const entry of result.entries) {
    // A bare reference to another headword does not establish applicable target
    // POS. Source-attested inflections and exact references keep their scope.
    if (entry.match.type === 'reference' && entry.headword !== result.query.text && !entry.groups.some(group => group.forms.some(form => form.text === result.query.text && /past|plural|participle|comparative|superlative|inflection|verb form/iu.test(form.label)))) { unconfirmed = true; continue; }
    for (const group of entry.groups) for (const sense of group.senses) {
      if (entry.match.sense_ids.length && !entry.match.sense_ids.includes(sense.id)) continue;
      if (sense.content_kind === 'relation' || (sense.content_kind !== 'definition' && isRelationOnlyMeaning(sense.meaning))) { relation = true; continue; }
      hasEnglish ||= !!sense.meaning.en?.trim(); hasChinese ||= !!sense.meaning.zh?.trim();
    }
  }
  return { kind: hasEnglish || hasChinese ? 'substantive' : unconfirmed ? 'unconfirmed' : relation ? 'relation_only' : 'unavailable', hasEnglish, hasChinese, reason: hasEnglish || hasChinese ? 'target_definition' : unconfirmed ? 'unexpanded_reference' : relation ? 'form_relation_only' : 'no_target_definition' };
}
export function hasSubstantiveTargetContent(result: DictionaryResult | null): boolean { return dictionaryContentAssessment(result).kind === 'substantive'; }
/** Missing optional examples or recordings never trigger a network lookup. */
export function shouldLookupCambridge(local: DictionaryResult | null): boolean {
  const content = dictionaryContentAssessment(local);
  return content.kind !== 'substantive' || !content.hasChinese || !!local?.notices.some(notice => ['unexpanded_inflection', 'necessary_content_missing'].includes(notice.code));
}
/** Both providers remain independent. The active source alone determines default/status. */
export function combineDictionaryResults(local: DictionaryResult | null, online: DictionaryResult | null, provider: DictionaryEntry['source']['provider']): DictionaryResult | null {
  const current = [local, online].find(value => value?.entries.some(entry => entry.source.provider === provider)) ?? (provider === 'longman' ? local : online);
  const usable = (value: DictionaryResult | null) => value && ['found', 'partial'].includes(value.status);
  const preferred = usable(current) ? current : usable(local) ? local : usable(online) ? online : current ?? local ?? online;
  if (!preferred) return null;
  if (!usable(preferred)) return preferred;
  return { ...preferred, entries: [local, online].flatMap(value => usable(value) ? value!.entries : []), notices: preferred.notices };
}
export function dictionarySourceResult(result: DictionaryResult | null, provider: DictionaryEntry['source']['provider']): DictionaryResult | null {
  if (!result) return null;
  const entries = result.entries.filter(entry => entry.source.provider === provider);
  if (!entries.length) return result.entries.length ? null : result;
  const defaultEntry = entries.find(entry => entry.id === result.default_entry_id) ?? entries[0];
  const hasChinese = defaultEntry.groups.some(group => group.senses.some(sense => !!sense.meaning.zh?.trim()));
  const status = defaultEntry.id === result.default_entry_id && (result.status === 'found' || result.status === 'partial') ? result.status : hasChinese ? 'found' : 'partial';
  return { ...result, entries, default_entry_id: defaultEntry.id, status, notices: result.notices.filter(notice => !notice.entry_id || entries.some(entry => entry.id === notice.entry_id)) };
}
