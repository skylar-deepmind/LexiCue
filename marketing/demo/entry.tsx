// Install isolated storage before evaluating any product store.
import {engine,firstSession,persist,resetDemo} from './runtime';
import './demo.css';
import {configureBrowserSpeechPreferences} from './speech';
async function start(){
 const [{default:App},{createRoot},{initI18n},{usePreferencesStore},{useReadingDeskStore},{useMaterialStore}]=await Promise.all([
  import('../../src/App'),import('react-dom/client'),import('../../src/i18n'),import('../../src/stores/preferencesStore'),import('../../src/stores/readingDeskStore'),import('../../src/stores/materialStore'),import('../../src/index.css'),
 ]);
 configureBrowserSpeechPreferences(()=>usePreferencesStore.getState().speech);
 const allowedLocales=['en','zh','ja','de'],allowedThemes=['ocean','sage','amber','twilight','midnight'];
 const params=new URLSearchParams(location.search),locale=params.get('locale')||'en',theme=params.get('theme')||'ocean';
 usePreferencesStore.getState().setUiLanguage((allowedLocales.includes(locale)?locale:'en') as any);
 if(firstSession){localStorage.setItem('lexicue-theme',allowedThemes.includes(theme)?theme:'ocean');localStorage.setItem('lexicue-onboarding-v1',JSON.stringify({version:1,status:'skipped'}));}
 // onboardingStore is already evaluated by App; suppress only the automatic first-run overlay.
 const {useOnboardingStore}=await import('../../src/stores/onboardingStore');if(firstSession)useOnboardingStore.getState().finish('skipped');
 initI18n();
 const {default:i18n}=await import('../../src/i18n');
 for(const [l,label]of Object.entries({en:'particle',zh:'小品词',ja:'不変化詞',de:'Partikel'}))i18n.addResource(l,'translation','dictionaryFlow.pos.particle',label);
 for(const [l,label]of Object.entries({en:'Original sample dictionary',zh:'原创样例词典',ja:'オリジナルの例示辞書',de:'Eigenes Beispielwörterbuch'})){i18n.addResource(l,'translation','longman.source',label);i18n.addResource(l,'translation','dictionary.sourceKinds.local',label);}
 const boundaries={
  en:{sync:'Device pairing is available in the installed Mac and iPhone apps. This browser demo stays separate.',online:'Online dictionaries are unavailable in this demo. You can save your own explanation.',translation:'New translations are unavailable in this demo. Continue in English or import existing bilingual text.'},
  zh:{sync:'请在 Mac 和 iPhone 安装版中配对设备。浏览器演示使用独立的临时资料。',online:'演示不连接在线词典，可以添加并保存自己的解释。',translation:'演示不生成新译文。可以继续阅读英文，或导入已有双语内容。'},
  ja:{sync:'端末のペア設定はMacとiPhoneのインストール版で行います。このブラウザ体験は独立した一時データです。',online:'この体験ではオンライン辞書に接続しません。自分の説明を保存できます。',translation:'この体験では新しい翻訳を生成しません。英語で続けるか、既存の対訳を取り込めます。'},
  de:{sync:'Geräte werden in den installierten Mac- und iPhone-Apps gekoppelt. Diese Browser-Demo nutzt getrennte temporäre Daten.',online:'Online-Wörterbücher sind in der Demo nicht verbunden. Du kannst eine eigene Erklärung speichern.',translation:'Die Demo erzeugt keine neuen Übersetzungen. Lies Englisch weiter oder importiere vorhandene zweisprachige Inhalte.'},
 };
 for(const [l,c]of Object.entries(boundaries)){i18n.addResource(l,'translation','settings.deviceSync.unsupported',c.sync);i18n.addResource(l,'translation','dictionary.issues.unavailable',c.online);i18n.addResource(l,'translation','documents.translationFailed',c.translation);i18n.addResource(l,'translation','materials.errors.translation_partial',c.translation);}
 const speechCopy={
  en:{description:'The demo uses available browser voices. Installed-app named voices are not used here. Accent and speed apply to your next playback.',voice:'Browser voice',automatic:'Available English voice · automatic',boundary:'Voice availability and any network use are controlled by your browser. This demo does not connect to Edge speech or the installed-app audio cache.'},
  zh:{description:'演示使用浏览器可用声音，不使用安装版的命名音色。口音与速度在下次朗读时生效。',voice:'浏览器声音',automatic:'可用英语声音 · 自动选择',boundary:'声音可用性与是否联网由浏览器决定。演示不连接 Edge 朗读或安装版音频缓存。'},
  ja:{description:'このデモはブラウザで利用できる音声を使います。インストール版の名前付き音声は使用しません。アクセントと速度は次の読み上げに反映されます。',voice:'ブラウザの音声',automatic:'利用可能な英語音声 · 自動選択',boundary:'利用できる音声と通信の有無はブラウザが決定します。Edge読み上げやインストール版の音声キャッシュには接続しません。'},
  de:{description:'Die Demo nutzt verfügbare Browserstimmen statt der benannten Stimmen der installierten App. Akzent und Tempo gelten für die nächste Wiedergabe.',voice:'Browserstimme',automatic:'Verfügbare englische Stimme · automatisch',boundary:'Verfügbare Stimmen und mögliche Netzwerkzugriffe bestimmt der Browser. Die Demo verbindet weder Edge-Sprachausgabe noch den Audiocache der installierten App.'},
 };
 for(const [l,c]of Object.entries(speechCopy)){for(const [key,value]of Object.entries({description:c.description,voice:c.voice,browserVoice:c.automatic,browserBoundary:c.boundary}))i18n.addResource(l,'translation','speech.'+key,value);}
 await useMaterialStore.getState().load();
 if(firstSession){for(const data of [...engine.materials].reverse())useReadingDeskStore.getState().keep(data.material);useReadingDeskStore.getState().select(engine.materials[0].material);useReadingDeskStore.getState().clearNotice();persist();}
 createRoot(document.getElementById('root')!).render(<App/>);
 const apply=(data:any)=>{
  if(allowedLocales.includes(data.locale))usePreferencesStore.getState().setUiLanguage(data.locale);
  if(allowedThemes.includes(data.theme)){localStorage.setItem('lexicue-theme',data.theme);window.dispatchEvent(new CustomEvent('lexicue-demo-theme',{detail:data.theme}));}
 };
 window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==window.parent)return;if(event.data?.type==='lexicue-demo-preferences')apply(event.data);if(event.data?.type==='lexicue-demo-reset')resetDemo();});
 if(window.parent!==window)requestAnimationFrame(()=>window.parent.postMessage({type:'lexicue-demo-ready'},location.origin));
}
void start().catch(error=>{console.error(error);const root=document.getElementById('root');if(root)root.textContent='Demo could not start. Reload to try again.';});
