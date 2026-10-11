// These aliases replace native I/O and persisted stores ONLY in marketing builds.
// No imports from the application's store initializers, no account or disk access.
import {screenshotCommand} from './capture-adapter';
import { copy } from './catalogue.mjs';
let locale = 'en';
export function setDemoLocale(value: string) { locale = value; }
export function usePreferencesStore(selector: (state: any) => any) {
  return selector({learningTextFontSize:'lg',definitionFontSize:'md',auxiliaryFontSize:'md',readingLineHeight:'normal',uiLanguage:locale,setUiLanguage:()=>{},youtube:{browserSession:{enabled:false,browser:'chrome',profile:''}},setYouTubeBrowserSession:()=>{}});
}
export function useDictionaryStore(selector: (state: any) => any) { return selector({}); }
export function dictionaryLanguageState() { return 'demo-ready'; }
export async function invoke(command: string, args: any = {}) {
  if(typeof location!=='undefined'&&new URLSearchParams(location.search).has('doc-capture'))return screenshotCommand(command);
  const ui = copy[locale].ui;
  if (command === 'lookup_dictionary') return {
    language:args.language || 'en',lemma:args.lemma,requested_form:args.lemma,matched_headword:args.lemma,
    match_kind:'exact',provider:'LexiCue · original demo definition',phonetic:'/ˈmiːnɪŋfəl/',audio_url:null,local_audio_path:null,fetched_at:0,
    definitions:[{part_of_speech:'adjective',definition:ui.definition,translation:null,example:'Small habits make a meaningful difference.'}]
  };
  if (command === 'lookup_phrase_dictionary') return {text:'come up',translation:ui.phraseMeaning,meaning_en:null,usage_zh:ui.phraseUsage,usage_en:null,pinyin:null,other_senses:[],other_senses_en:[],collins_senses:[]};
  throw new Error(`Marketing adapter blocks native command: ${command}`);
}
export function speakText() { /* All demonstrations stay silent. */ }
export async function playPronunciation() { /* No online audio or speech service. */ }
