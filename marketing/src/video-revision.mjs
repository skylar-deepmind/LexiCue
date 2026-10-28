// Video-only copy. The approved website, guide and existing masters are independent.
export const author = {
 name:'Skylar', role:'LexiCue 作者', url:'https://github.com/skylar-deepmind',
 handle:'github.com/skylar-deepmind', invitation:'欢迎关注我的 GitHub，发现更多开源项目',
 avatar:'author/skylar-github.png',
};
const scene=(start,end,id,title,description,subtitle)=>({start,end,id,title,description,subtitle});
export const videoFps=60;
export const horizontalRevision=[
 scene(0,3,'intro','喜欢的内容，记得住的词汇。','','喜欢的内容，也能成为你的词汇库。'),
 scene(3,8,'sources','常看的内容，都能用来学习。','从 YouTube 获取可用字幕，或导入自己的 SRT。','从 YouTube 获取字幕，或导入自己收藏的 SRT，学习常看的视频内容。'),
 scene(8,15,'import','从一份字幕开始。','导入 SRT 字幕，确认语言，预览内容。','导入 SRT 字幕，从你真正感兴趣的内容开始。'),
 scene(15,20,'tags','内容多了，也能有条理。','用标签整理文件，快速找到想读的内容。','给文件加上标签，再按标签筛选。'),
 scene(20,30,'lookup','遇到生词，点一下。','查词抽屉按需展开，读完释义，继续阅读。','在原句里查词，标记学习状态，再继续读。'),
 scene(30,40,'phrases','不止单词，也读懂表达。','可选 AI 发现词组，解释它在原句中的用法。','开启可选 AI 分析，理解词组与语境。结果为固定样例。'),
 scene(40,46,'collect','遇到的词，都有来处。','单词与词组统一管理，随时查看来源。','搜索、筛选、标注；每个词都能追溯到原句。'),
 scene(46,55,'review','带着原句，再遇见一次。','揭示答案，选择评分，继续下一张。','用原句复习，再根据记忆情况评分。安排为样例演示。'),
 scene(55,59,'progress','每一步，都看得见。','词汇状态、近期复习与文件进度，放在一起看。','看看词汇状态、复习记录和文件学习进度。'),
 scene(59,61,'privacy','学习记录，留在本地。','默认本地学习，支持备份与恢复。','默认本地，数据由你掌握。'),
 scene(61,65,'sync','换个设备，继续学。','可选加密同步，让学习状态接续。','电脑与手机保持一致。同步原理示意。'),
 scene(65,73,'languages','喜欢怎样读，就怎样读。','英语、日语、德语、中文；海洋、鼠尾草、琥珀、暮紫与午夜主题。','四种学习语言，从彩色主题到午夜主题。'),
 scene(73,81,'outro','从喜欢的内容，开始。','','LexiCue 免费开源。欢迎关注作者的 GitHub。'),
];
export const verticalRevision=[
 scene(0,2,'intro','喜欢的内容，记得住的词汇。','','喜欢的内容，就是你的词汇库。'),
 scene(2,6,'sources','YouTube 或自己的 SRT。','从常看的视频开始学习。','YouTube 获取字幕，也可以导入自己的 SRT。'),
 scene(6,9.5,'import','导入字幕，开始阅读。','','确认语言，预览 SRT 内容。'),
 scene(9.5,12,'tags','给内容一点秩序。','','用标签找到想读的内容。'),
 scene(12,16,'lookup','遇到生词，点一下。','','点词查词，随手标记。'),
 scene(16,20,'phrases','读懂词组与语境。','','AI 可选。分析结果为固定样例。'),
 scene(20,23,'collect','词汇都有来处。','','单词与词组，统一管理。'),
 scene(23,27,'review','在原句里，再复习一次。','','揭示答案，再按记忆情况评分。'),
 scene(27,29,'progress','每一步，都看得见。','','学习进度看得见。'),
 scene(29,32,'sync','本地优先，随时接续。','','可选加密同步 · 原理示意。'),
 scene(32,36,'languages','四种语言，多彩主题。','','从彩色主题，到午夜主题。'),
 scene(36,40,'outro','从喜欢的内容，开始。','','LexiCue 免费开源，欢迎关注作者。'),
];
export function revisionAt(frame,portrait=false){const timeline=portrait?verticalRevision:horizontalRevision;return timeline.find(s=>frame>=s.start*videoFps&&frame<s.end*videoFps)||timeline.at(-1);}

export const videoThemes=['ocean','sage','amber','twilight','midnight'];
export const themeLabels={ocean:'海洋',sage:'鼠尾草',amber:'琥珀',twilight:'暮紫',midnight:'午夜'};
export function themeAt(frame,seconds){const p=Math.max(0,Math.min(1,frame/(seconds*videoFps)));return videoThemes[p<.16?0:p<.32?1:p<.48?2:p<.64?3:4];}
export function closingBoundary(frame,portrait=false){
 const t=frame/videoFps,entry=Math.min(1,t/1.5),eased=1-(1-entry)**3;
 const center=1.02-.52*eased+(t>1.5?.008*Math.sin((t-1.5)*.55):0);
 const amplitude=.016*eased,points=[];
 for(let i=0;i<=20;i++){const along=i/20,boundary=center+amplitude*Math.sin(along*Math.PI*2+t*.5);points.push(portrait?`${along*100}% ${boundary*100}%`:`${boundary*100}% ${along*100}%`);}
 return {center,clip:`polygon(${points.join(',')},${portrait?'100% 100%,0% 100%':'100% 100%,100% 0%'})`};
}

export const videoDuration=portrait=>(portrait?verticalRevision:horizontalRevision).at(-1).end;
export const videoFrames=portrait=>Math.round(videoDuration(portrait)*videoFps);
