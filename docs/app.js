(function () {
  var I18N = {
    zh: {
      metaTitle: "LexiCue — 从真实阅读中记住词汇",
      metaDesc: "LexiCue — Local-first 词汇学习与阅读工具。把你正在读的内容，变成真正记得住的词汇。",
      themeToggle: "切换明暗主题",
      nav: { features: "产品亮点", workflow: "怎么用", privacy: "隐私", languages: "支持语言" },
      hero: {
        eyebrow: "Local-first · 开源 · 离线优先",
        title: "把你正在读的内容，<br><span class=\"gradient-text\">变成真正记得住的词汇。</span>",
        sub: "LexiCue 是一款本地优先的阅读学习工具。导入文章、字幕或自己的文本，边读边查、随手积累生词，再用智能复习把它们真正记下来。",
        ctaDownload: "免费下载",
        ctaGithub: "查看 GitHub",
        hint: "点击左侧标签，预览每个功能"
      },
      mock: {
        windowTitle: "LexiCue · 阅读",
        sidebar: { read: "阅读", files: "文件", words: "单词", phrases: "词组", review: "复习", stats: "统计" },
        pill: "逐句阅读",
        detailLabel: "单词详情",
        pron: "/ɪˈfektɪv/ · 形容词",
        tagA: "新词",
        tagB: "形容词",
        def: "<strong>有效的；起作用的</strong><br>successful in producing the intended result.",
        contextLabel: "原文语境",
        addButton: "加入学习",
        files: { import: "导入文件", processed: "已处理" },
        words: { search: "搜索单词…", count: "1,284 个单词", t0: "全部", t1: "未处理", t2: "学习中", t3: "已掌握", t4: "已跳过", sort: "排序" },
        phrases: { search: "搜索词组…", count: "86 个词组", auto: "自动识别", manual: "手动添加" },
        status: { unprocessed: "未处理", learning: "学习中", known: "已掌握", ignored: "已跳过" },
        review: {
          hint: "点击显示答案",
          answer: "答案",
          again: "忘记", hard: "困难", good: "记得", easy: "简单",
          hAgain: "10 分钟", hHard: "1 天", hGood: "3 天", hEasy: "6 天"
        },
        insights: {
          total: "单词总数", known: "已掌握", learning: "学习中", due: "待复习",
          mastery: "掌握进度", last7: "近 7 天复习",
          d0: "周一", d1: "周二", d2: "周三", d3: "周四", d4: "周五", d5: "周六", d6: "周日"
        }
      },
      features: {
        kicker: "为什么选择 LexiCue",
        title: "不把阅读打断成查词，<br>而是把阅读连接成学习。",
        sub: "围绕你真正在读的内容展开：边读边懂、随手积累，复习交给 LexiCue。"
      },
      f1: {
        title: "从你喜欢的内容开始，而不是从词表开始",
        desc: "导入 TXT、SRT、VTT，或直接抓取 YouTube 字幕——学你真正想读的东西。",
        youtube: "YouTube 字幕"
      },
      f2: { title: "边读边查，不打断思路", desc: "点一下任何单词，释义、读音、例句立刻出现，读完还自动收进你的词库。" },
      f3: { title: "复习很会挑时间", desc: "在你想不起来之前轻轻提醒你——把「忘了」变成「记住了」。" },
      f4: { title: "词典装进应用里", desc: "英、日、德、中四种语言的离线词典随应用内置，断网也能查。" },
      f5: { title: "数据留在你的电脑上", desc: "学习记录保存在本机，不用注册账号，也不需要把内容上传。" },
      f6: {
        title: "AI 可以帮忙，但真的可选",
        desc: "需要时打开 AI，让它解释段落或翻译句子；不开也完全不影响使用。默认关闭，你的文本默认不会发给任何服务。"
      },
      workflow: {
        kicker: "怎么用",
        title: "四步，完成一次学习闭环。",
        sub: "不用研究设置项，打开就能跟着走。"
      },
      s1: { title: "导入", desc: "把文章、字幕或 YouTube 字幕放进 LexiCue。" },
      s2: { title: "阅读", desc: "逐句阅读，点词即查，看不懂的句子有翻译。" },
      s3: { title: "积累", desc: "生词和常用搭配自动收进你的词库。" },
      s4: { title: "复习", desc: "到时间轻轻提醒，几个单词、几分钟搞定。" },
      privacy: {
        kicker: "默认本地优先",
        title: "你的阅读材料，默认留在你的电脑里。",
        body: "所有数据都存在本机，不强制联网、不用注册账号。AI 想用的话，可以连本机模型，也可以填自己的云端接口。",
        list: ["学习记录保存在本机数据库", "词典导入后离线可用", "支持随时导出与恢复", "AI 可选，默认关闭"]
      },
      local: {
        title: "本地数据",
        status: "在本机",
        d1: "英语词典",
        d2: "日 / 中 / 德词典",
        d3: "复习记录"
      },
      lang: {
        kicker: "支持语言",
        title: "四种语言，一套操作。",
        sub: "选语言，自动配词典；阅读、查词、复习的体验完全一致。",
        h: { language: "学习语言", dict: "离线词典", proc: "自动处理" },
        dictLabel: "词典",
        procLabel: "处理",
        en: { name: "English · 英语", dict: "ECDICT、词组词典", proc: "词形还原（books → book）" },
        ja: { name: "日本語 · 日语", dict: "JMdict", proc: "分词 + 假名读音" },
        de: { name: "Deutsch · 德语", dict: "kaikki 词典数据", proc: "词形还原" },
        zh: { name: "中文 · 中文", dict: "CC-CEDICT", proc: "分词 + 拼音标注" }
      },
      cta: {
        kicker: "开源 · MIT",
        title: "让每一次真实阅读，<br>都顺手变成一次词汇积累。",
        body: "免费、开源，还在快速迭代。到 GitHub 看看，或直接下载体验。",
        download: "免费下载",
        github: "在 GitHub 查看",
        star: "在 GitHub 留下 Star ⭐",
        starAsk: "喜欢 LexiCue？点个 Star 支持一下吧",
        notice: "安装包目前为未签名构建，首次安装可能触发系统安全提示，<a href=\"https://github.com/skylar-deepmind/LexiCue/blob/main/DISTRIBUTION.md\" target=\"_blank\" rel=\"noreferrer\">按安装说明操作即可</a>。"
      },
      footer: { tagline: "LexiCue · 本地优先的阅读学习工具", github: "GitHub", license: "MIT License" }
    },

    en: {
      metaTitle: "LexiCue — Learn vocabulary from real reading",
      metaDesc: "LexiCue — a local-first reading tool that turns what you read into vocabulary you remember.",
      themeToggle: "Toggle light / dark theme",
      nav: { features: "Features", workflow: "How it works", privacy: "Privacy", languages: "Languages" },
      hero: {
        eyebrow: "Local-first · Open source · Works offline",
        title: "Read what you love.<br><span class=\"gradient-text\">Remember the words.</span>",
        sub: "LexiCue is a local-first reading tool that builds vocabulary as you read. Import an article or subtitles, look words up on the spot, and let smart review make them stick.",
        ctaDownload: "Download free",
        ctaGithub: "View on GitHub",
        hint: "Click the tabs on the left to preview each feature"
      },
      mock: {
        windowTitle: "LexiCue · Reading",
        sidebar: { read: "Reading", files: "Files", words: "Words", phrases: "Phrases", review: "Review", stats: "Stats" },
        pill: "Read line by line",
        detailLabel: "Word detail",
        pron: "/ɪˈfektɪv/ · adjective",
        tagA: "new",
        tagB: "adjective",
        def: "<strong>有效的；起作用的</strong><br>successful in producing the intended result.",
        contextLabel: "In context",
        addButton: "Add to review",
        files: { import: "Import file", processed: "Processed" },
        words: { search: "Search words…", count: "1,284 words", t0: "All", t1: "New", t2: "Learning", t3: "Known", t4: "Ignored", sort: "Sort" },
        phrases: { search: "Search phrases…", count: "86 phrases", auto: "Auto", manual: "Manual" },
        status: { unprocessed: "New", learning: "Learning", known: "Known", ignored: "Ignored" },
        review: {
          hint: "Click to reveal",
          answer: "Answer",
          again: "Again", hard: "Hard", good: "Good", easy: "Easy",
          hAgain: "10 min", hHard: "1 day", hGood: "3 days", hEasy: "6 days"
        },
        insights: {
          total: "Total words", known: "Mastered", learning: "Learning", due: "Due",
          mastery: "Mastery", last7: "Last 7 days",
          d0: "Mon", d1: "Tue", d2: "Wed", d3: "Thu", d4: "Fri", d5: "Sat", d6: "Sun"
        }
      },
      features: {
        kicker: "Why LexiCue",
        title: "Learn while you read,<br>not while you stop to look up.",
        sub: "Everything revolves around the content you actually read: understand on the fly, collect as you go, and let LexiCue handle the review."
      },
      f1: {
        title: "Start with content you love, not a word list",
        desc: "Import TXT, SRT or VTT files, or pull YouTube subtitles — learn from what you actually want to read.",
        youtube: "YouTube subtitles"
      },
      f2: { title: "Look things up without losing your place", desc: "Tap any word for its meaning, reading and example sentence. It lands in your word list automatically." },
      f3: { title: "Review that picks the perfect moment", desc: "A smart algorithm nudges you right before you forget — turning “forgot” into “got it”." },
      f4: { title: "Dictionaries built into the app", desc: "Offline dictionaries for English, Japanese, German and Chinese. Look words up with no internet at all." },
      f5: { title: "Your data stays on your computer", desc: "Everything is saved locally. No account, no sign-up, nothing uploaded unless you say so." },
      f6: {
        title: "AI can help — but it's optional",
        desc: "Turn on AI if you want paragraph explanations or translations. It's off by default, so your text never leaves your device unless you ask."
      },
      workflow: {
        kicker: "How it works",
        title: "Four steps, one simple loop.",
        sub: "No settings to study. Just open it and follow along."
      },
      s1: { title: "Import", desc: "Drop in an article, subtitles, or YouTube captions." },
      s2: { title: "Read", desc: "Read line by line, tap any word, glance at translations." },
      s3: { title: "Collect", desc: "New words and phrases pile up in your list automatically." },
      s4: { title: "Review", desc: "A gentle nudge at the right time — a few words, a few minutes." },
      privacy: {
        kicker: "Local-first by default",
        title: "Your reading stays on your computer.",
        body: "All data lives on your device — no forced sign-ups, no mandatory cloud. If you want AI, point it at local Ollama or your own API.",
        list: ["Study records saved in a local database", "Dictionaries work offline once imported", "Export and restore whenever you like", "AI optional, off by default"]
      },
      local: {
        title: "Local data",
        status: "On device",
        d1: "English dictionary",
        d2: "JA / ZH / DE dictionaries",
        d3: "Review history"
      },
      lang: {
        kicker: "Languages",
        title: "Four languages, one workflow.",
        sub: "Pick a language and get its dictionary; reading, lookup and review all feel the same.",
        h: { language: "Language", dict: "Offline dictionary", proc: "Processing" },
        dictLabel: "Dictionary",
        procLabel: "Processing",
        en: { name: "English · 英语", dict: "ECDICT + phrase dict", proc: "Word forms (books → book)" },
        ja: { name: "日本語 · 日语", dict: "JMdict", proc: "Tokenizing + kana readings" },
        de: { name: "Deutsch · 德语", dict: "kaikki data", proc: "Word forms" },
        zh: { name: "中文 · 中文", dict: "CC-CEDICT", proc: "Tokenizing + pinyin" }
      },
      cta: {
        kicker: "Open source · MIT",
        title: "Make every real read<br>a small vocabulary win.",
        body: "Free and open source, still growing fast. Take a look on GitHub, or just download it.",
        download: "Download free",
        github: "View on GitHub",
        star: "Star on GitHub ⭐",
        starAsk: "Enjoying LexiCue? Give it a star on GitHub",
        notice: "Installers are currently unsigned — your system may show a security warning on first install. <a href=\"https://github.com/skylar-deepmind/LexiCue/blob/main/DISTRIBUTION.md\" target=\"_blank\" rel=\"noreferrer\">See the install guide</a>."
      },
      footer: { tagline: "LexiCue · Local-first reading & vocabulary tool", github: "GitHub", license: "MIT License" }
    }
  };

  function getValue(dict, key) {
    var parts = key.split(".");
    var value = dict;
    for (var i = 0; i < parts.length; i++) {
      if (value == null) return null;
      value = value[parts[i]];
    }
    return typeof value === "string" ? value : null;
  }

  var currentView = "reading";
  var VIEW_LABEL_KEY = {
    reading: "mock.sidebar.read",
    files: "mock.sidebar.files",
    words: "mock.sidebar.words",
    phrases: "mock.sidebar.phrases",
    review: "mock.sidebar.review",
    insights: "mock.sidebar.stats"
  };

  function updateWindowTitle(dict) {
    var label = getValue(dict, VIEW_LABEL_KEY[currentView]) || "LexiCue";
    var title = document.querySelector(".window-title");
    if (title) title.textContent = "LexiCue · " + label;
  }

  function applyLanguage(lang) {
    var dict = I18N[lang] || I18N.zh;
    document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
    document.title = dict.metaTitle;
    document.querySelector('meta[name="description"]').content = dict.metaDesc;

    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var text = getValue(dict, el.getAttribute("data-i18n"));
      if (text != null) el.innerHTML = text;
    });
    document.querySelectorAll("[data-i18n-label]").forEach(function (el) {
      var label = getValue(dict, el.getAttribute("data-i18n-label"));
      if (label != null) el.dataset.label = label;
    });

    document.querySelectorAll(".lang-btn").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.lang === lang);
    });
    document.querySelectorAll(".lang-btn").forEach(function (btn) {
      btn.setAttribute("aria-pressed", btn.dataset.lang === lang ? "true" : "false");
    });

    var toggle = document.querySelector("[data-theme-toggle]");
    if (toggle) toggle.setAttribute("aria-label", dict.themeToggle);

    updateWindowTitle(dict);
  }

  function currentLang() {
    try {
      var saved = localStorage.getItem("lexicue-lang");
      if (saved === "zh" || saved === "en") return saved;
    } catch (e) {}
    return /^zh/i.test(navigator.language || "") ? "zh" : "en";
  }

  function setView(view) {
    currentView = view;
    document.querySelectorAll(".side-item").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.view === view);
    });
    document.querySelectorAll(".view").forEach(function (v) {
      v.classList.toggle("active", v.dataset.view === view);
    });
    updateWindowTitle(I18N[lang]);
  }

  function currentTheme() {
    try {
      var saved = localStorage.getItem("lexicue-theme");
      if (saved === "light" || saved === "dark") return saved;
    } catch (e) {}
    return (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === "dark" ? "#0b1220" : "#2563eb";
    var toggle = document.querySelector("[data-theme-toggle]");
    if (toggle) toggle.setAttribute("aria-label", I18N[lang].themeToggle);
  }

  var lang = currentLang();
  applyLanguage(lang);
  applyTheme(currentTheme());

  document.querySelector("[data-theme-toggle]").addEventListener("click", function () {
    var next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("lexicue-theme", next); } catch (e) {}
    applyTheme(next);
  });

  document.querySelectorAll(".side-item").forEach(function (btn) {
    btn.addEventListener("click", function () {
      setView(btn.dataset.view);
    });
  });

  document.querySelectorAll(".lang-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      lang = btn.dataset.lang;
      try { localStorage.setItem("lexicue-lang", lang); } catch (e) {}
      applyLanguage(lang);
    });
  });

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) { entry.target.classList.add("visible"); io.unobserve(entry.target); }
    });
  }, { threshold: .12 });
  document.querySelectorAll(".reveal").forEach(function (el) { io.observe(el); });
})();
