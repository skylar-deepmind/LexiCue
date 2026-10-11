// Video-only copy. The approved website, guide and existing masters are independent.
export const author = {
 name:'Skylar', role:'LexiCue 作者', url:'https://github.com/skylar-deepmind',
 handle:'github.com/skylar-deepmind', invitation:'欢迎关注我的 GitHub，发现更多开源项目',
 avatar:'author/skylar-github.png',
};
const scene=(start,end,id,title,description,subtitle)=>({start,end,id,title,description,subtitle});
export const horizontalRevision=[
 scene(0,3,'intro','喜欢的内容，记得住的词汇。','','喜欢的内容，也能成为你的词汇库。'),
 scene(3,10,'import','从一份字幕开始。','导入 SRT 字幕，确认语言，预览内容。','导入 SRT 字幕，从你真正感兴趣的内容开始。'),
 scene(10,15,'tags','内容多了，也能有条理。','用标签整理文件，快速找到想读的内容。','给文件加上标签，再按标签筛选。'),
 scene(15,25,'lookup','遇到生词，点一下。','查词抽屉按需展开，读完释义，继续阅读。','在原句里查词，标记学习状态，再继续读。'),
 scene(25,35,'phrases','不止单词，也读懂表达。','可选 AI 发现词组，解释它在原句中的用法。','开启可选 AI 分析，理解词组与语境。结果为固定样例。'),
 scene(35,41,'collect','遇到的词，都有来处。','单词与词组统一管理，随时查看来源。','搜索、筛选、标注；每个词都能追溯到原句。'),
 scene(41,50,'review','带着原句，再遇见一次。','揭示答案，选择评分，继续下一张。','用原句复习，再根据记忆情况评分。安排为样例演示。'),
 scene(50,54,'progress','每一步，都看得见。','词汇状态、近期复习与文件进度，放在一起看。','看看词汇状态、复习记录和文件学习进度。'),
 scene(54,56,'privacy','学习记录，留在本地。','默认本地学习，支持备份与恢复。','默认本地，数据由你掌握。'),
 scene(56,60,'sync','换个设备，继续学。','可选加密同步，让学习状态接续。','电脑与手机保持一致。同步原理示意。'),
 scene(60,68,'languages','喜欢怎样读，就怎样读。','英语、日语、德语、中文；海洋、鼠尾草、琥珀、暮紫与午夜主题。','四种学习语言，从彩色主题到午夜主题。'),
 scene(68,76,'outro','从喜欢的内容，开始。','','LexiCue 免费开源。欢迎关注作者的 GitHub。'),
];
export const verticalRevision=[
 scene(0,1.6,'intro','喜欢的内容，记得住的词汇。','','喜欢的内容，就是你的词汇库。'),
 scene(1.6,4.3,'import','从一份 SRT 字幕开始。','','导入 SRT 字幕，开始阅读。'),
 scene(4.3,6,'tags','给内容一点秩序。','','用标签找到想读的内容。'),
 scene(6,9,'lookup','遇到生词，点一下。','','点词查词，随手标记。'),
 scene(9,12.7,'phrases','读懂词组与语境。','','AI 可选。分析结果为固定样例。'),
 scene(12.7,15,'collect','词汇都有来处。','','单词与词组，统一管理。'),
 scene(15,18.1,'review','在原句里，再复习一次。','','揭示答案，再按记忆情况评分。'),
 scene(18.1,19,'progress','每一步，都看得见。','','学习进度看得见。'),
 scene(19,20,'sync','本地优先，随时接续。','','可选加密同步 · 原理示意。'),
 scene(20,24,'languages','四种语言，多彩主题。','','从彩色主题，到午夜主题。'),
 scene(24,28,'outro','从喜欢的内容，开始。','','LexiCue 免费开源，欢迎关注作者。'),
];
export function revisionAt(frame,portrait=false){const timeline=portrait?verticalRevision:horizontalRevision;return timeline.find(s=>frame>=s.start*30&&frame<s.end*30)||timeline.at(-1);}

export const videoThemes=['ocean','sage','amber','twilight','midnight'];
export const themeLabels={ocean:'海洋',sage:'鼠尾草',amber:'琥珀',twilight:'暮紫',midnight:'午夜'};
export function themeAt(frame,seconds){const p=Math.max(0,Math.min(1,frame/(seconds*30)));return videoThemes[p<.16?0:p<.32?1:p<.48?2:p<.64?3:4];}
export function closingBoundary(frame,portrait=false){
 const t=frame/30,entry=Math.min(1,t/1.5),eased=1-(1-entry)**3;
 const center=1.02-.52*eased+(t>1.5?.008*Math.sin((t-1.5)*.55):0);
 const amplitude=.016*eased,points=[];
 for(let i=0;i<=20;i++){const along=i/20,boundary=center+amplitude*Math.sin(along*Math.PI*2+t*.5);points.push(portrait?`${along*100}% ${boundary*100}%`:`${boundary*100}% ${along*100}%`);}
 return {center,clip:`polygon(${points.join(',')},${portrait?'100% 100%,0% 100%':'100% 100%,100% 0%'})`};
}

export const videoDuration=portrait=>(portrait?verticalRevision:horizontalRevision).at(-1).end;
export const videoFrames=portrait=>Math.round(videoDuration(portrait)*30);
