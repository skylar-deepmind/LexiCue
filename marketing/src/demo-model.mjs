export const SESSION_KEY='lexicue-demo-session-v1';
const def=(en,zh,ja,de)=>({en,zh,ja,de});
/** @type {Array<any[]>} */
const terms=[
['small','small','en',def('Not large in size or amount.','小的；少量的。','小さい、少量の。','Klein; von geringer Größe.')],
['habit','habits','en',def('Something you do regularly.','习惯，经常做的事。','習慣、繰り返し行うこと。','Eine regelmäßig ausgeführte Handlung.')],
['meaningful','meaningful','en',def('Having real importance or value.','有意义的；重要的；有价值的。','意味のある、価値のある。','Bedeutsam; sinnvoll; von echtem Wert.')],
['difference','difference','en',def('A change or a way things are unlike each other.','差别；变化。','違い、変化。','Ein Unterschied oder eine Veränderung.')],
['word','word','en',def('A unit of language with a meaning.','具有含义的语言单位：词。','意味を持つ言語の単位。','Eine sprachliche Einheit mit Bedeutung.')],
['come','comes','en',def('To arrive or appear; comes is a form of come.','来；出现。comes 是 come 的变形。','来る、現れる。comes は come の活用形。','Kommen, erscheinen; comes ist eine Form von come.')],
['reading','reading','en',def('The activity of understanding written words.','阅读，理解书面内容。','読むこと、書かれた内容を理解すること。','Das Lesen und Verstehen geschriebener Wörter.')],
['little','Little','en',def('Small in amount; little by little means gradually.','少量；little by little 表示逐渐。','少し。little by little は少しずつ。','Wenig; little by little bedeutet allmählich.')],
['story','story','en',def('An account of connected events.','故事，对一系列事件的叙述。','物語、出来事をつなげた話。','Eine Erzählung zusammenhängender Ereignisse.')],
['sense','sense','en',def('Meaning or understanding.','含义；理解。','意味、理解。','Sinn oder Verständnis.')],
['morning','morning','en',def('The early part of a day.','早晨，一天较早的时段。','朝、一日の早い時間帯。','Der frühe Teil des Tages.')],
['notice','notice','en',def('To become aware of something.','注意到；觉察到。','気づく、認識する。','Etwas wahrnehmen oder bemerken.')],
['garden','garden','en',def('A place where plants are grown.','种植植物的地方：花园。','植物を育てる場所、庭。','Ein Ort, an dem Pflanzen wachsen.')],
['quiet','quiet','en',def('Making very little noise.','安静的，声音很小的。','静かな、音の少ない。','Leise, mit wenig Geräusch.')],
['water','water','en',def('The liquid people and plants need.','人和植物需要的液体：水。','人や植物に必要な液体、水。','Die Flüssigkeit, die Menschen und Pflanzen brauchen.')],
['grow','grow','en',def('To become larger or develop.','成长；增大。','育つ、大きくなる。','Wachsen oder sich entwickeln.')],
['物語','物語','ja',def('A story or narrative.','故事；物语。','出来事を語る話。','Eine Geschichte oder Erzählung.'),'ものがたり'],
['毎日','毎日','ja',def('Every day.','每天。','一日ごと、日々。','Jeden Tag.'),'まいにち'],
['読む','読みます','ja',def('To read; 読みます is a polite form.','阅读；読みます 是礼貌形式。','文章を読む。読みますは丁寧な形。','Lesen; 読みます ist die höfliche Form.'),'よむ'],
['Seite','Seiten','de',def('A page; Seiten is the plural form of Seite.','页；Seiten 是 Seite 的复数。','ページ。Seiten は Seite の複数形。','Eine Seite; Seiten ist der Plural.')],
['lesen','lese','de',def('To read; lese is the first-person form.','阅读；lese 是第一人称形式。','読む。lese は一人称の形。','Lesen; lese ist die Form der ersten Person.')],
['Tag','Tag','de',def('A day.','一天；日。','日、一日。','Ein Zeitraum von einem Tag.')],
['每天','每天','zh',def('Every day.','每一天。','毎日。','Jeden Tag.'),'měi tiān'],
['学习','学习','zh',def('To learn or study.','获取知识或技能。','学ぶ、勉強する。','Lernen oder studieren.'),'xué xí'],
['习惯','习惯','zh',def('A habit or routine.','经常重复的行为。','習慣、日常の行動。','Eine Gewohnheit.'),'xí guàn'],
['come up','comes up','en',def('To appear or be mentioned.','出现；被提及。','現れる、話題に出る。','Auftauchen oder erwähnt werden.'),null,'phrase'],
['make sense','make sense','en',def('To become clear or understandable.','变得清楚；能够理解。','意味が通る、理解できる。','Sinn ergeben oder verständlich werden.'),null,'phrase']
];
export const TERMS=terms.map((x,i)=>({id:i+1,lemma:x[0],surface:x[1],language:x[2],definitions:x[3],reading:x[4]||null,kind:x[5]||'word'}));
export const FILES=[
{id:1,name:'Reading habits.srt',language:'en',tags:[1,3,4],lines:['Small habits make a meaningful difference.','When a new word comes up, I look it up and keep reading.','Little by little, the story starts to make sense.']},
{id:2,name:'A quiet morning.srt',language:'en',tags:[1,2],lines:['In the quiet morning, I notice a small difference.','Each story becomes meaningful when I keep reading.']},
{id:3,name:'The garden.srt',language:'en',tags:[2,3],lines:['In the garden, water helps small plants grow.','I notice the quiet changes every morning.']},
{id:4,name:'物語の時間.srt',language:'ja',tags:[1,4],lines:['好きな物語を、毎日少しずつ読みます。']},
{id:5,name:'Ein paar Seiten.srt',language:'de',tags:[2],lines:['Ich lese jeden Tag ein paar Seiten.']},
{id:6,name:'每天一点.srt',language:'zh',tags:[],lines:['每天读一点，让学习成为习惯。']}
];
export const IMPORT_SAMPLE={id:7,name:'One more story.srt',language:'en',tags:[],lines:['A small story can make a meaningful difference.','In the quiet morning, I keep reading.']};
export const TERM_STATUSES=['unprocessed','learning','known','ignored'];
export function surfaceSpans(line,t){const lower=line.toLowerCase(),surface=t.surface.toLowerCase();const spans=[];let cursor=0;while(cursor<line.length){const start=lower.indexOf(surface,cursor);if(start<0)break;const end=start+surface.length;const alphabetic=t.language==='en'||t.language==='de';if(!alphabetic||(!/[\p{L}\p{N}]/u.test(lower[start-1]||'')&&!/[\p{L}\p{N}]/u.test(lower[end]||'')))spans.push({start,end});cursor=end;}return spans;}
export const termsForFile=(file,includePhrases=true)=>TERMS.filter(t=>t.language===file.language&&(includePhrases||t.kind==='word')&&file.lines.some(line=>surfaceSpans(line,t).length));
export function initialSession(){return {version:1,module:'files',fileId:1,selectedTerm:3,language:'en',uiLocale:null,theme:null,kind:'word',selectedTags:[],untagged:false,tags:[{id:1,key:'daily'},{id:2,key:'podcast'},{id:3,key:'short'},{id:4,key:'favorite'}],files:structuredClone(FILES),statuses:Object.fromEntries(TERMS.map(t=>[t.id,[3,26,27].includes(t.id)?'learning':[2,11].includes(t.id)?'known':'unprocessed'])),reviews:[],reviewQueue:null,reviewIndex:0,revealed:false,seen:[],analyzed:[],aiEnabled:false,aiProvider:'gemma',aiModel:'E2B',baseline:{en:null,zh:null},baselinePrevious:{},simulations:{}};}
export function validSession(s){
 const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 if(!object(s)||s.version!==1||!['files','reading','vocabulary','review','insights','settings'].includes(s.module))return false;
 if(!['en','ja','de','zh'].includes(s.language)||(s.uiLocale!==null&&!['en','ja','de','zh'].includes(s.uiLocale))||(s.theme!==null&&!['ocean','sage','twilight','amber','midnight'].includes(s.theme))||!['word','phrase'].includes(s.kind))return false;
 if(!Array.isArray(s.files)||s.files.length<6||s.files.length>7||!FILES.every(original=>s.files.some(f=>f.id===original.id)))return false;
 if(!s.files.every(f=>object(f)&&[...FILES,IMPORT_SAMPLE].some(original=>original.id===f.id&&original.name===f.name&&original.language===f.language&&JSON.stringify(original.lines)===JSON.stringify(f.lines))&&Array.isArray(f.tags))||new Set(s.files.map(f=>f.id)).size!==s.files.length)return false;
 if(!Array.isArray(s.tags)||s.tags.length>30||!s.tags.every(t=>object(t)&&Number.isInteger(t.id)&&t.id>0&&(typeof t.name==='string'&&t.name.trim().length>0&&t.name.length<=40||['daily','podcast','short','favorite'].includes(t.key)))||new Set(s.tags.map(t=>t.id)).size!==s.tags.length)return false;
 if(!s.files.every(f=>f.tags.every(id=>s.tags.some(t=>t.id===id)))||!Array.isArray(s.selectedTags)||!s.selectedTags.every(id=>s.tags.some(t=>t.id===id))||typeof s.untagged!=='boolean')return false;
 if(!object(s.statuses)||!TERMS.every(t=>TERM_STATUSES.includes(s.statuses[t.id]))||!Array.isArray(s.reviews)||!s.reviews.every(r=>object(r)&&TERMS.some(t=>t.id===r.id)&&[1,2,3,4].includes(r.rating)))return false;
 if((s.reviewQueue!==null&&(!Array.isArray(s.reviewQueue)||!s.reviewQueue.every(id=>TERMS.some(t=>t.id===id))))||!Number.isInteger(s.reviewIndex)||s.reviewIndex<0||typeof s.revealed!=='boolean'||!['E2B','E4B'].includes(s.aiModel))return false;
 if(!Array.isArray(s.seen)||!s.seen.every(key=>['files','reading','words','phrases','review','insights','settings'].includes(key))||!Array.isArray(s.analyzed)||!s.analyzed.every(id=>s.files.some(f=>f.id===id)))return false;
 if(typeof s.aiEnabled!=='boolean'||!['gemma','openai'].includes(s.aiProvider)||!object(s.baseline)||!['en','zh'].every(l=>s.baseline[l]===null||[1000,3000,5000,10000].includes(s.baseline[l]))||!object(s.baselinePrevious)||!Object.values(s.baselinePrevious).every(values=>object(values)&&Object.values(values).every(v=>TERM_STATUSES.includes(v)))||!object(s.simulations))return false;
 return true;
}
export function migrateSession(value){
 if(!value||value.version!==1||!Array.isArray(value.files))return value;
 const legacyNames={2:'A quiet morning.txt',3:'The garden.vtt',5:'Ein paar Seiten.txt',6:'每天一点.txt'};
 return {...value,files:value.files.map(file=>legacyNames[file.id]===file.name?{...file,name:FILES.find(original=>original.id===file.id).name}:file)};
}
export function loadSession(storage){try{const s=migrateSession(JSON.parse(storage.getItem(SESSION_KEY)));return validSession(s)?s:initialSession();}catch{return initialSession();}}
export function saveSession(storage,s){try{storage.setItem(SESSION_KEY,JSON.stringify(s));}catch{/* The in-memory experience stays usable. */}}
export function filteredFiles(s){return s.files.filter(f=>f.language===s.language&&(s.untagged?f.tags.length===0:s.selectedTags.every(id=>f.tags.includes(id))));}
export function groupProgress(s,items){if(!items.length)return null;return Math.round(items.reduce((sum,t)=>sum+(s.statuses[t.id]==='known'||s.statuses[t.id]==='ignored'?1:s.statuses[t.id]==='learning'?.5:0),0)/items.length*100);}
export function fileProgress(s,file){return groupProgress(s,termsForFile(file,s.analyzed.includes(file.id)));}
export function applyBaseline(s,language,tier){const next=structuredClone(s);const available=TERMS.filter(t=>t.language===language&&t.kind==='word').slice(0,tier===1000?2:tier===3000?4:tier===5000?6:8);next.baselinePrevious[language]??={};for(const t of available){if(next.statuses[t.id]==='unprocessed'){next.baselinePrevious[language][t.id]='unprocessed';next.statuses[t.id]='known';}}next.baseline[language]=tier;return next;}
export function revokeBaseline(s,language){const next=structuredClone(s);for(const [id,old] of Object.entries(next.baselinePrevious[language]||{})){if(next.statuses[id]==='known')next.statuses[id]=old;}next.baselinePrevious[language]={};next.baseline[language]=null;return next;}
export function deleteTag(s,id){return {...s,tags:s.tags.filter(t=>t.id!==id),selectedTags:s.selectedTags.filter(t=>t!==id),files:s.files.map(f=>({...f,tags:f.tags.filter(t=>t!==id)}))};}
