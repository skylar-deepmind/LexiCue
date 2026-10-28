const englishCopy={
 intro:{title:'Learn vocabulary from what you love.',subtitle:'Turn the content you enjoy into words worth remembering.'},
 sources:{title:'Learn from the videos you already watch.',description:'Get available subtitles from YouTube or import your own SRT.',subtitle:'Use YouTube subtitles or bring your own SRT files.'},
 import:{title:'Start with a subtitle.',description:'Import an SRT, confirm the language, and preview it.',subtitle:'Import an SRT and start learning from the lines you love.',eyebrow:'Start reading',headingLines:['Start with a','subtitle.']},
 tags:{title:'Keep your learning library organized.',description:'Use tags to organize files and find what you want to read.',subtitle:'Add tags to your files, then filter the library in seconds.',eyebrow:'Organize your library',headingLines:['A library that','stays organized.']},
 lookup:{title:'Tap a word. Keep reading.',description:'Open the lookup drawer when you need it, then return to the sentence.',subtitle:'Look up a word in context, update its status, and keep reading.',eyebrow:'Look up words offline',headingLines:['Tap a word.','Keep reading.']},
 phrases:{title:'Understand the phrases behind the words.',description:'Optional AI finds phrases and explains how they work in context.',subtitle:'Turn on optional AI to explore phrases and context. Results are fixed examples.',eyebrow:'Understand the context',headingLines:['Understand the phrase,','not just the word.']},
 collect:{title:'Every word, connected to its source.',description:'Manage words and phrases together, with the original line always close by.',subtitle:'Search, filter, and organize vocabulary with its original context.',eyebrow:'Build your vocabulary',headingLines:['Every word,','backed by context.']},
 review:{title:'Meet useful words again—in context.',description:'Reveal the answer, rate how well you remembered it, and continue.',subtitle:'Review words in their original sentences, then rate your recall. Sample schedule shown.',eyebrow:'Review in context',headingLines:['Meet useful words,','one sentence at a time.']},
 progress:{title:'See how far you have come.',description:'View vocabulary status, recent reviews, and file progress together.',subtitle:'Track vocabulary, review history, and progress through each file.',eyebrow:'Track your progress',headingLines:['See how far','you have come.']},
 privacy:{title:'Your learning data stays on your device.',description:'Learn locally by default. Back up or restore your data when you choose.',subtitle:'Local by default. Your learning data stays in your hands.',eyebrow:'Local first',headingLines:['Your learning data,','kept local.']},
 sync:{title:'Pick up where you left off.',description:'Optional encrypted sync keeps your learning status in step across devices.',subtitle:'Continue on another device with optional encrypted sync. Process illustrated.',eyebrow:'Optional sync',headingLines:['Pick up learning,','on another device.']},
 languages:{title:'Learn your way, in your language.',description:'English, Japanese, German, and Chinese—plus five interface themes.',subtitle:'Four learning languages, from colorful themes to Midnight.',eyebrow:'Languages & themes',headingLines:['Learn your way,','in your language.']},
 outro:{title:'Start with what you love.',description:'Free and open source. Follow the maker on GitHub.',subtitle:'LexiCue is free and open source. Follow the maker on GitHub.',eyebrow:'Read what you love.'},
};

const englishUi={
 brand:'Free · Open source · Local first',
 source:{eyebrow:'START WITH WHAT YOU LOVE',title:'The videos you watch can become learning material.',description:'Get subtitles from YouTube or import your own SRT files.',youtubeLabel:'YOUTUBE · GET SUBTITLES',youtubeTitle:'Get subtitles from YouTube',youtubeDescription:'Choose a video and an available subtitle, then add it to your library.',browserNote:'Sample page',videoTitle:'A Day in the City',videoMeta:'English listening · Sample video',videoHint:'Choose a video with subtitles',chooseVideo:'Choose video',chooseCaptions:'Choose subtitles',addToLibrary:'Add to library',captionHeading:'Available subtitles',captionHint:'Choose a language to download',original:'Original',available:'Available',alternate:'Japanese · SRT',download:'Download',added:'English.srt added to your library',fileLabel:'YOUR FILE · SRT',fileTitle:'Bring your own favorite shows',fileDescription:'Import SRT subtitle files from videos you own or enjoy.',fileName:'stranger-things.S01E01.srt',fileNote:'Your local SRT · Bring your own subtitles',importable:'Ready to import',subtitle:'A small choice can change the whole day.',sourceNote:'Original sample artwork · Import subtitles you have the right to use',bridge:'Choose familiar content',bridgeAction:'Read, look up, and learn in context'},
 sync:{computer:'Computer',phone:'Phone',known:'Known',learning:'Learning',transfer:'Encrypted transfer',result:'Both devices are in sync. Pick up where you left off.',changing:'Your learning status updates across devices.',note:'Sync is optional · Principle illustrated'},
 privacy:{title:'Saved on your device by default',items:['Reading · Dictionary · Reviews'],export:'Export backup',restore:'Restore learning data',note:'Cloud AI and sync are opt-in.'},
 themes:{heading:'Theme',labels:{ocean:'Ocean',sage:'Sage',amber:'Amber',twilight:'Twilight',midnight:'Midnight'}},
 footer:'Original sample data',
 music:'Music: Carefree / Kevin MacLeod · CC BY 4.0',
 outro:{eyebrow:'READ WHAT YOU LOVE.',titleFirst:'Learn with the',titleSecond:'stories you love.',tagline:'Free · Open source · Local first',download:'Download free',authorEyebrow:'MEET THE MAKER',role:'Creator of LexiCue',invitation:['Follow me on GitHub to','find more open-source projects.']},
 intro:{titleFirst:'Learn with the',titleSecond:'stories you love.',description:'Import SRT subtitles to look up, collect, and review words in context.',tags:['SRT subtitles','Learn in context','Review vocabulary']},
};

export function videoTimeline(locale,portrait,source){
 const timeline=portrait?source.vertical:source.horizontal;
 if(locale!=='en')return timeline;
 return timeline.map(scene=>({...scene,...englishCopy[scene.id]}));
}

export function videoText(locale){return locale==='en'?englishUi:null;}
