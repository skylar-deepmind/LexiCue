(function () {
  var I18N = {
    zh: {
      metaTitle: "LexiCue — 从真实阅读中记住词汇",
      metaDesc: "LexiCue — Local-first 词汇学习与阅读工具。把你正在读的内容，变成真正记得住的词汇。",
      themeToggle: "切换明暗主题",
      nav: { features: "产品亮点", workflow: "怎么用", privacy: "隐私", languages: "支持语言", support: "支持作者" },
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
        def: "<strong>有效的；起作用的</strong><br>successful in producing the intended result.",
        contextLabel: "原文语境",
        files: { import: "导入文件", processed: "已处理", folderName: "学习笔记", folderFiles: "12 个文件" },
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
          totalPhrases: "词组总数", phraseMastery: "词组掌握度",
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
        support: "喜欢 LexiCue？欢迎在爱发电（Aifadian）上支持作者 ❤",
        notice: "安装包目前为未签名构建，首次安装可能触发系统安全提示，<a href=\"https://github.com/skylar-deepmind/LexiCue/blob/main/DISTRIBUTION.md\" target=\"_blank\" rel=\"noreferrer\">按安装说明操作即可</a>。"
      },
      footer: { tagline: "LexiCue · 本地优先的阅读学习工具", github: "GitHub", license: "MIT License", support: "支持作者" },
      dl: {
        kicker: "下载",
        title: "选择你要安装的设备",
        sub: "不同设备对应不同的安装包，选错可能装不上。",
        close: "关闭",
        detected: "检测到你的设备",
        go: "前往下载 →",
        mac: {
          name: "macOS",
          desc: "Mac 电脑 · DMG 安装包",
          arm: "Apple 芯片",
          intel: "Intel 芯片",
          file: {
            arm: "在最新版本页选择文件名以 <span class=\"dl-tag\">_aarch64.dmg</span> 结尾的文件。",
            intel: "在最新版本页选择文件名以 <span class=\"dl-tag\">_x64.dmg</span> 结尾的文件。"
          },
          help: "不确定芯片？点左上角苹果菜单 → 关于本机，看「芯片」一栏。"
        },
        win: {
          name: "Windows",
          desc: "PC 电脑 · 安装程序",
          file: "在最新版本页选择文件名以 <span class=\"dl-tag\">-setup.exe</span> 结尾的文件。"
        },
        and: {
          name: "Android",
          desc: "安卓手机 · APK 安装包",
          file: "在最新版本页选择文件名以 <span class=\"dl-tag\">.apk</span> 结尾的文件。"
        },
        note: "安装包为未签名构建，首次安装系统会给出安全提示，属于正常现象。<a href=\"https://github.com/skylar-deepmind/LexiCue/blob/main/DISTRIBUTION.md\" target=\"_blank\" rel=\"noreferrer\">按安装说明处理即可</a>。",
        all: "不确定？查看全部版本 →"
      }
    },

    en: {
      metaTitle: "LexiCue — Learn vocabulary from real reading",
      metaDesc: "LexiCue — a local-first reading tool that turns what you read into vocabulary you remember.",
      themeToggle: "Toggle light / dark theme",
      nav: { features: "Features", workflow: "How it works", privacy: "Privacy", languages: "Languages", support: "Support" },
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
        def: "<strong>有效的；起作用的</strong><br>successful in producing the intended result.",
        contextLabel: "In context",
        files: { import: "Import file", processed: "Processed", folderName: "Study Notes", folderFiles: "12 files" },
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
          totalPhrases: "Total phrases", phraseMastery: "Phrase mastery",
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
        support: "Enjoying LexiCue? Support the author on 爱发电 (Aifadian) ❤",
        notice: "Installers are currently unsigned — your system may show a security warning on first install. <a href=\"https://github.com/skylar-deepmind/LexiCue/blob/main/DISTRIBUTION.md\" target=\"_blank\" rel=\"noreferrer\">See the install guide</a>."
      },
      footer: { tagline: "LexiCue · Local-first reading & vocabulary tool", github: "GitHub", license: "MIT License", support: "Support" },
      dl: {
        kicker: "Download",
        title: "Choose your device",
        sub: "Each device needs a different installer — pick the right one.",
        close: "Close",
        detected: "Detected your device",
        go: "Go download →",
        mac: {
          name: "macOS",
          desc: "Mac · DMG installer",
          arm: "Apple Silicon",
          intel: "Intel",
          file: {
            arm: "On the latest release, pick the file ending in <span class=\"dl-tag\">_aarch64.dmg</span>.",
            intel: "On the latest release, pick the file ending in <span class=\"dl-tag\">_x64.dmg</span>."
          },
          help: "Not sure? Click the Apple menu (top-left) → About This Mac → check the “Chip” line."
        },
        win: {
          name: "Windows",
          desc: "PC · installer",
          file: "On the latest release, pick the file ending in <span class=\"dl-tag\">-setup.exe</span>."
        },
        and: {
          name: "Android",
          desc: "Android phone · APK",
          file: "On the latest release, pick the file ending in <span class=\"dl-tag\">.apk</span>."
        },
        note: "Installers are unsigned — your system may warn you on first install. That's expected. <a href=\"https://github.com/skylar-deepmind/LexiCue/blob/main/DISTRIBUTION.md\" target=\"_blank\" rel=\"noreferrer\">See the install guide</a>.",
        all: "Not sure? View all releases →"
      }
    },

    ja: {
      metaTitle: "LexiCue — 好きなものを読んで、単語を覚える",
      metaDesc: "LexiCue — ローカルファーストのリーディング学習ツール。読んでいる内容が、本当に覚えられる単語になります。",
      themeToggle: "ライト/ダークテーマを切り替え",
      nav: { features: "特長", workflow: "使い方", privacy: "プライバシー", languages: "対応言語", support: "支援する" },
      hero: {
        eyebrow: "ローカルファースト · オープンソース · オフライン対応",
        title: "好きなものを読もう。<br><span class=\"gradient-text\">言葉はそのまま覚えられる。</span>",
        sub: "LexiCue は、読んでいる内容から語彙を育てるローカルファーストのリーディングツールです。記事や字幕を読みながら、わからない単語をその場で調べ、スマートな復習で定着させましょう。",
        ctaDownload: "無料ダウンロード",
        ctaGithub: "GitHub で見る",
        hint: "左のタブをクリックして各機能をプレビュー"
      },
      mock: {
        windowTitle: "LexiCue · 読書",
        sidebar: { read: "読書", files: "ファイル", words: "単語", phrases: "フレーズ", review: "復習", stats: "統計" },
        pill: "一文ずつ読む",
        detailLabel: "単語の詳細",
        pron: "/ɪˈfektɪv/ · 形容詞",
        def: "<strong>効果的な；有効な</strong><br>successful in producing the intended result.",
        contextLabel: "文脈の中での用例",
        files: { import: "ファイルをインポート", processed: "処理済み", folderName: "学習ノート", folderFiles: "12 ファイル" },
        words: { search: "単語を検索…", count: "1,284 単語", t0: "すべて", t1: "未処理", t2: "学習中", t3: "既知", t4: "スキップ", sort: "並べ替え" },
        phrases: { search: "フレーズを検索…", count: "86 フレーズ", auto: "自動検出", manual: "手動追加" },
        status: { unprocessed: "未処理", learning: "学習中", known: "既知", ignored: "スキップ" },
        review: {
          hint: "クリックで答えを表示",
          answer: "答え",
          again: "忘れた", hard: "難しい", good: "覚えている", easy: "簡単",
          hAgain: "10 分", hHard: "1 日", hGood: "3 日", hEasy: "6 日"
        },
        insights: {
          total: "総単語数", known: "習得済み", learning: "学習中", due: "復習待ち",
          totalPhrases: "総フレーズ数", phraseMastery: "フレーズ習得度",
          mastery: "習得度", last7: "直近 7 日間",
          d0: "月", d1: "火", d2: "水", d3: "木", d4: "金", d5: "土", d6: "日"
        }
      },
      features: {
        kicker: "LexiCue を選ぶ理由",
        title: "調べるために読書をやめるのではなく、<br>読書がそのまま学びになる。",
        sub: "実際に読んでいる内容が中心。その場で理解し、読みながら蓄積し、復習は LexiCue に任せましょう。"
      },
      f1: {
        title: "単語帳ではなく、好きな内容から始める",
        desc: "TXT・SRT・VTT ファイルを取り込むか、YouTube の字幕を取得。本当に読みたいものを学べます。",
        youtube: "YouTube 字幕"
      },
      f2: { title: "読書の流れを止めずに調べられる", desc: "単語をタップすると意味・読み・例文がすぐ表示され、自動的に単語リストへ追加されます。" },
      f3: { title: "ちょうどいいタイミングで復習", desc: "忘れかけた瞬間を狙うスマートなリマインドで、「忘れた」を「覚えた」に変えます。" },
      f4: { title: "辞書はアプリに内蔵", desc: "英語・日本語・ドイツ語・中国語のオフライン辞書を内蔵。インターネットなしでも調べられます。" },
      f5: { title: "データは自分のコンピューターに", desc: "すべてローカルに保存。アカウント不要、許可なくアップロードされることもありません。" },
      f6: {
        title: "AI も使えるけど、使うかはあなた次第",
        desc: "段落の説明や翻訳が欲しければ AI を有効化。デフォルトではオフなので、明示しない限りテキストが端末の外に出ることはありません。"
      },
      workflow: {
        kicker: "使い方",
        title: "4 つのステップで、シンプルな学習ループ。",
        sub: "設定を調べる必要はありません。開いて、流れに沿うだけ。"
      },
      s1: { title: "インポート", desc: "記事・字幕・YouTube キャプションを取り込みます。" },
      s2: { title: "読む", desc: "一文ずつ読み、単語をタップ、訳もちらりと確認。" },
      s3: { title: "蓄積", desc: "新しい単語とフレーズが自動でリストにたまります。" },
      s4: { title: "復習", desc: "いいタイミングでそっとリマインド。数単語、数分だけ。" },
      privacy: {
        kicker: "デフォルトでローカルファースト",
        title: "読んでいる内容は、自分のコンピューターに残ります。",
        body: "すべてのデータは端末内に保存。強制サインアップもクラウド必須もありません。AI を使いたい場合は、ローカルの Ollama か自分の API に接続できます。",
        list: ["学習記録はローカルデータベースに保存", "辞書は一度取り込めばオフラインで利用可能", "いつでもエクスポート・リストア可能", "AI はオプション、デフォルトでオフ"]
      },
      local: {
        title: "ローカルデータ",
        status: "端末内",
        d1: "英語辞書",
        d2: "日 / 中 / 独辞書",
        d3: "復習履歴"
      },
      lang: {
        kicker: "対応言語",
        title: "4 つの言語、同じ使い心地。",
        sub: "言語を選べば辞書も付いてきます。読む・調べる・復習する、すべて同じ操作感。",
        h: { language: "学習言語", dict: "オフライン辞書", proc: "自動処理" },
        dictLabel: "辞書",
        procLabel: "処理",
        en: { name: "English · 英語", dict: "ECDICT + フレーズ辞書", proc: "語形の正規化（books → book）" },
        ja: { name: "日本語 · 日本語", dict: "JMdict", proc: "分かち書き + かな読み" },
        de: { name: "Deutsch · ドイツ語", dict: "kaikki データ", proc: "語形の正規化" },
        zh: { name: "中文 · 中国語", dict: "CC-CEDICT", proc: "分かち書き + ピンイン" }
      },
      cta: {
        kicker: "オープンソース · MIT",
        title: "読んだものが、<br>そのまま小さな語彙の勝利になる。",
        body: "無料・オープンソースで、まだまだ進化中。GitHub で見るか、さっそくダウンロードしてみましょう。",
        download: "無料ダウンロード",
        github: "GitHub で見る",
        star: "GitHub で Star ⭐",
        starAsk: "LexiCue が気に入ったら、GitHub で Star を",
        support: "気に入っていただけたら、愛発電（Aifadian）で作者を支援できます ❤",
        notice: "インストーラーは現在未署名のため、初回インストール時にセキュリティ警告が表示される場合があります。<a href=\"https://github.com/skylar-deepmind/LexiCue/blob/main/DISTRIBUTION.md\" target=\"_blank\" rel=\"noreferrer\">インストールガイドを見る</a>。"
      },
      footer: { tagline: "LexiCue · ローカルファーストのリーディング＆語彙学習ツール", github: "GitHub", license: "MIT License", support: "支援する" },
      dl: {
        kicker: "ダウンロード",
        title: "インストールするデバイスを選択",
        sub: "デバイスごとに必要なインストーラーが異なります。正しいものを選んでください。",
        close: "閉じる",
        detected: "お使いのデバイスを検出",
        go: "ダウンロードへ →",
        mac: {
          name: "macOS",
          desc: "Mac · DMG インストーラー",
          arm: "Apple Silicon",
          intel: "Intel",
          file: {
            arm: "最新リリースから、末尾が <span class=\"dl-tag\">_aarch64.dmg</span> のファイルを選んでください。",
            intel: "最新リリースから、末尾が <span class=\"dl-tag\">_x64.dmg</span> のファイルを選んでください。"
          },
          help: "わからない場合は、左上の Apple メニュー → この Mac について → 「チップ」の項目を確認。"
        },
        win: {
          name: "Windows",
          desc: "PC · インストーラー",
          file: "最新リリースから、末尾が <span class=\"dl-tag\">-setup.exe</span> のファイルを選んでください。"
        },
        and: {
          name: "Android",
          desc: "Android スマホ · APK",
          file: "最新リリースから、末尾が <span class=\"dl-tag\">.apk</span> のファイルを選んでください。"
        },
        note: "インストーラーは未署名のため、初回インストール時にシステムから警告が出る場合がありますが正常です。<a href=\"https://github.com/skylar-deepmind/LexiCue/blob/main/DISTRIBUTION.md\" target=\"_blank\" rel=\"noreferrer\">インストールガイドを見る</a>。",
        all: "迷ったら？全リリースを見る →"
      }
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
    document.documentElement.lang = lang === "en" ? "en" : (lang === "ja" ? "ja" : "zh-CN");
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
    var dlClose = document.querySelector("[data-dl-close]");
    if (dlClose) dlClose.setAttribute("aria-label", dict.dl.close);

    updateWindowTitle(dict);
  }

  function currentLang() {
    try {
      var saved = localStorage.getItem("lexicue-lang");
      if (saved === "zh" || saved === "en" || saved === "ja") return saved;
    } catch (e) {}
    return "en";
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

  var dlOverlay = document.querySelector("[data-dl-overlay]");
  var lastTrigger = null;

  function openDownload(trigger) {
    lastTrigger = trigger || null;
    dlOverlay.classList.add("open");
    document.body.classList.add("no-scroll");
    var closeBtn = dlOverlay.querySelector("[data-dl-close]");
    if (closeBtn) closeBtn.focus();
  }

  function closeDownload() {
    dlOverlay.classList.remove("open");
    document.body.classList.remove("no-scroll");
    if (lastTrigger) lastTrigger.focus();
  }

  document.querySelectorAll("[data-open-download]").forEach(function (el) {
    el.addEventListener("click", function (e) {
      e.preventDefault();
      openDownload(el);
    });
  });

  dlOverlay.querySelector("[data-dl-close]").addEventListener("click", closeDownload);
  dlOverlay.addEventListener("click", function (e) {
    if (e.target === dlOverlay) closeDownload();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && dlOverlay.classList.contains("open")) closeDownload();
  });

  dlOverlay.querySelectorAll(".dl-chip").forEach(function (chip) {
    chip.addEventListener("click", function () {
      var card = chip.closest(".dl-card");
      var arch = chip.dataset.arch;
      card.querySelectorAll(".dl-chip").forEach(function (c) {
        c.classList.toggle("active", c === chip);
      });
      card.querySelectorAll(".dl-file").forEach(function (f) {
        f.hidden = f.dataset.arch ? f.dataset.arch !== arch : arch !== "arm";
      });
    });
  });

  var ua = (navigator.userAgent || "").toLowerCase();
  var detectedOs = null;
  if (/android/.test(ua)) detectedOs = "android";
  else if (/mac os x|macintosh/.test(ua)) detectedOs = "mac";
  else if (/windows/.test(ua)) detectedOs = "win";
  if (detectedOs) {
    var detectedCard = dlOverlay.querySelector('[data-os="' + detectedOs + '"]');
    if (detectedCard) detectedCard.classList.add("recommended");
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) { entry.target.classList.add("visible"); io.unobserve(entry.target); }
    });
  }, { threshold: .12 });
  document.querySelectorAll(".reveal").forEach(function (el) { io.observe(el); });
})();
