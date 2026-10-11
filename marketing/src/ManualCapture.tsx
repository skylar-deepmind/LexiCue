import {useLayoutEffect,useState} from 'react';
import {MemoryRouter} from 'react-router-dom';
import SettingsPage from '../../src/pages/SettingsPage';
import FileCard from '../../src/components/FileCard';
import TagFilterBar from '../../src/components/TagFilterBar';
import {ThemeContext} from '../../src/components/themeContext';
import {DemoI18n} from './i18n';
import {Sandbox} from './Sandbox';
import {FILES} from './demo-model.mjs';
import {experienceCopy} from './experience-copy.mjs';
import {useFileStore} from './capture-adapter';
const noop=()=>{};
export function ManualCapture(){
 const params=new URLSearchParams(location.search),locale=params.get('lang')||'en',chapter=params.get('doc-capture')||'files';
 const [theme,setTheme]=useState<any>(params.get('theme')==='midnight'?'midnight':'ocean');
 const c=experienceCopy[locale],tags=['daily','podcast','short','favorite'].map((key,i)=>({id:i+1,name:c[key],created_at:1791580800000}));
 useLayoutEffect(()=>{document.documentElement.dataset.theme=theme;useFileStore.setState({tags,selectedTagIds:[2],untaggedOnly:false});},[theme,locale]);
 if(chapter==='settings')return <DemoI18n locale={locale}><MemoryRouter><ThemeContext.Provider value={{theme,setTheme}}><div inert className="product-capture" data-theme={theme}><SettingsPage/></div></ThemeContext.Provider></MemoryRouter></DemoI18n>;
 if(chapter==='files')return <DemoI18n locale={locale}><div inert className="product-capture" data-theme={theme}><header className="product-capture-heading"><h1>{c.files}</h1><span>English</span></header><TagFilterBar onManage={noop}/><div className="product-capture-files">{FILES.filter(file=>file.language==='en'&&file.tags.includes(2)).map(file=><FileCard key={file.id} file={{...file,language:'en',type:'srt',imported_at:1791580800000,segment_count:file.lines.length,phrase_analyzed:false,phrase_analysis_at:null,phrase_skipped_items:0,tags:file.tags.map(id=>tags[id-1]),word_progress:{total:12,unprocessed:4,learning:4,known:4,ignored:0},phrase_progress:{total:0,unprocessed:0,learning:0,known:0,ignored:0}}} onDelete={noop} onAnalyze={noop} onCancel={noop} onEditTags={noop} onClick={noop} aiEnabled={false} analysisCompleted={false}/>)}</div></div></DemoI18n>;
 return <Sandbox locale={locale} theme={theme} isolated initialModule={chapter==='quick-start'?'reading':chapter} animationActive={false}/>;
}
