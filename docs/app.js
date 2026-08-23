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

  I18N.de = Object.assign({}, I18N.en, {
    metaTitle: "LexiCue — Vokabeln aus echtem Lesen lernen",
    metaDesc: "LexiCue ist ein lokales Lese- und Vokabeltool. Lies echte Inhalte, schlage Wörter nach und wiederhole sie intelligent.",
    themeToggle: "Helles / dunkles Design wechseln",
    nav: { features: "Funktionen", workflow: "Ablauf", privacy: "Datenschutz", languages: "Sprachen", support: "Unterstützen" },
    hero: { eyebrow: "Lokal · Open Source · Offline", title: "Lies, was du liebst.<br><span class=\"gradient-text\">Merk dir die Wörter.</span>", sub: "LexiCue verwandelt das Lesen echter Inhalte in nachhaltiges Vokabellernen.", ctaDownload: "Kostenlos laden", ctaGithub: "GitHub ansehen", hint: "Probiere den interaktiven Ablauf aus" },
    features: { kicker:"Warum LexiCue", title:"Lerne beim Lesen,<br>ohne den Lesefluss zu verlieren.", sub:"Verstehe im Kontext, sammle unterwegs und überlasse LexiCue die Wiederholung." },
    f1:{title:"Beginne mit Inhalten, die du magst",desc:"Importiere TXT-, SRT- oder VTT-Dateien oder hole YouTube-Untertitel.",youtube:"YouTube-Untertitel"}, f2:{title:"Nachschlagen ohne Unterbrechung",desc:"Tippe ein Wort an und sieh Bedeutung, Aussprache und Beispiel sofort."}, f3:{title:"Wiederholen zum richtigen Zeitpunkt",desc:"Der Lernplan erinnert dich kurz vor dem Vergessen."}, f4:{title:"Wörterbücher direkt in der App",desc:"Offline-Wörterbücher für Englisch, Japanisch, Deutsch und Chinesisch."}, f5:{title:"Deine Daten bleiben bei dir",desc:"Alles wird lokal gespeichert – ohne Konto und ohne Upload."}, f6:{title:"KI hilft nur, wenn du willst",desc:"Erklärungen und Übersetzungen sind optional und standardmäßig aus."},
    workflow:{kicker:"So funktioniert es",title:"Vier Schritte, ein Lernkreislauf.",sub:"Öffne die App und folge einfach dem Ablauf."}, s1:{title:"Importieren",desc:"Artikel, Untertitel oder YouTube-Untertitel hinzufügen."},s2:{title:"Lesen",desc:"Satzweise lesen und Wörter direkt nachschlagen."},s3:{title:"Sammeln",desc:"Neue Wörter und Phrasen landen automatisch in deiner Liste."},s4:{title:"Wiederholen",desc:"Ein paar Minuten zur passenden Zeit genügen."},
    privacy:{kicker:"Lokal zuerst",title:"Deine Texte bleiben auf deinem Gerät.",body:"Alle Lerninformationen liegen lokal. KI ist optional und kann mit deinem eigenen Dienst verbunden werden.",list:["Lernfortschritt in einer lokalen Datenbank","Wörterbücher funktionieren offline","Jederzeit exportieren und wiederherstellen","KI ist standardmäßig deaktiviert"]}, local:{title:"Lokale Daten",status:"Auf diesem Gerät",d1:"Englisches Wörterbuch",d2:"JA / ZH / DE Wörterbücher",d3:"Wiederholungsverlauf"},
    lang:{kicker:"Sprachen",title:"Vier Sprachen, ein Ablauf.",sub:"Wähle eine Sprache – Lesen, Nachschlagen und Wiederholen funktionieren gleich.",h:{language:"Lernsprache",dict:"Offline-Wörterbuch",proc:"Verarbeitung"},dictLabel:"Wörterbuch",procLabel:"Verarbeitung",en:{name:"English · Englisch",dict:"ECDICT + Phrasen",proc:"Wortformen"},ja:{name:"日本語 · Japanisch",dict:"JMdict",proc:"Tokenisierung + Kana"},de:{name:"Deutsch",dict:"kaikki-Daten",proc:"Wortformen"},zh:{name:"中文 · Chinesisch",dict:"CC-CEDICT",proc:"Tokenisierung + Pinyin"}},
    cta:{kicker:"Open Source · MIT",title:"Mach aus jedem echten Text<br>einen kleinen Vokabelerfolg.",body:"Kostenlos, Open Source und ständig in Entwicklung.",download:"Kostenlos laden",github:"Auf GitHub ansehen",star:"Auf GitHub markieren ⭐",starAsk:"Gefällt dir LexiCue? Gib dem Projekt einen Stern.",support:"Unterstütze den Autor auf Aifadian ❤",notice:"Installationspakete sind derzeit nicht signiert. Beim ersten Start kann eine Sicherheitswarnung erscheinen."}, footer:{tagline:"LexiCue · Lokales Lese- und Vokabeltool",github:"GitHub",license:"MIT-Lizenz",support:"Unterstützen"}
  });

  var MARKETING_COPY = {
    en: { metaTitle:'LexiCue — Build vocabulary from your own content', metaDesc:'LexiCue is a local-first vocabulary learning tool. Import text or subtitles, organize words and phrases, review them on schedule, and track your progress.', hero:{eyebrow:'Local-first · Open source · Offline-ready',title:'Import your content.<br><span class="gradient-text">Own the vocabulary.</span>',sub:'LexiCue is a local-first vocabulary learning tool. Import text or subtitles, organize words and phrases, then review them on a schedule that fits.',ctaDownload:'Download free',ctaGithub:'View on GitHub',hint:'Try the vocabulary workflow'}, features:{kicker:'Why LexiCue',title:'Turn your content<br>into a vocabulary system.',sub:'Import material you care about, keep its words and phrases organized, and let LexiCue handle the review schedule.'}, f1:{title:'Import the material you already use',desc:'Bring in TXT, SRT or VTT files, or YouTube subtitles. Your files become the source for a focused vocabulary library.',youtube:'YouTube subtitles'},f2:{title:'Keep words and phrases organized',desc:'Filter, search and update learning states in dedicated word and phrase libraries. Open an imported file whenever you need to check its contents.'},f3:{title:'Review at the right time',desc:'A smart schedule brings back vocabulary before it fades.'},f4:{title:'Offline dictionaries built in',desc:'Use dictionaries for English, Japanese, German and Chinese without an internet connection.'},f5:{title:'Your data stays on your computer',desc:'Files and learning records are stored locally. No account or upload required.'},f6:{title:'AI is optional',desc:'Enable AI only when you want extra explanations or translations. It is off by default.'},workflow:{kicker:'How it works',title:'Four steps, one vocabulary loop.',sub:'Import once, then keep learning data organized.'},s1:{title:'Import',desc:'Add text, subtitles or YouTube captions.'},s2:{title:'Organize',desc:'Manage extracted words and phrases by learning status.'},s3:{title:'Review',desc:'Use short, scheduled reviews to move vocabulary forward.'},s4:{title:'Track',desc:'See vocabulary, phrase and review progress at a glance.'},privacy:{kicker:'Local-first by default',title:'Your learning data stays on your computer.',body:'Files, vocabulary and learning records remain on your device. AI is optional and can use a local model or your own API.',list:['Learning records stored in a local database','Dictionaries work offline once imported','Export and restore whenever you like','AI optional, off by default']},lang:{kicker:'Languages',title:'Four languages, one workflow.',sub:'Pick a language and get its dictionary; importing, organizing and reviewing work the same way.',h:{language:'Learning language',dict:'Offline dictionary',proc:'Processing'},dictLabel:'Dictionary',procLabel:'Processing',en:{name:'English · 英语',dict:'ECDICT + phrase dict',proc:'Word forms (books → book)'},ja:{name:'日本語 · 日语',dict:'JMdict',proc:'Tokenizing + kana readings'},de:{name:'Deutsch · 德语',dict:'kaikki data',proc:'Word forms'},zh:{name:'中文 · 中文',dict:'CC-CEDICT',proc:'Tokenizing + pinyin'}},cta:{kicker:'Open source · MIT',title:'Build a vocabulary library<br>from content that matters to you.',body:'Free and open source, and still growing fast. Take a look on GitHub or download it.',download:'Download free',github:'View on GitHub',star:'Star on GitHub ⭐',starAsk:'Enjoying LexiCue? Give it a star on GitHub',support:'Enjoying LexiCue? Support the author on 爱发电 (Aifadian) ❤',notice:'Installers are currently unsigned — your system may show a security warning on first install. <a href="https://github.com/skylar-deepmind/LexiCue/blob/main/DISTRIBUTION.md" target="_blank" rel="noreferrer">See the install guide</a>.'},footer:{tagline:'LexiCue · Local-first vocabulary learning tool',github:'GitHub',license:'MIT License',support:'Support'} },
    zh: { metaTitle:'LexiCue — 从自己的内容建立词汇库',metaDesc:'LexiCue 是本地优先的词汇学习工具：导入文本或字幕，整理单词和词组，按计划复习并追踪进度。',hero:{eyebrow:'本地优先 · 开源 · 离线可用',title:'导入你的内容，<br><span class="gradient-text">建立自己的词汇库。</span>',sub:'LexiCue 是一款本地优先的词汇学习工具。导入文本或字幕，整理单词和词组，再按适合你的节奏复习。',ctaDownload:'免费下载',ctaGithub:'查看 GitHub',hint:'体验词汇学习流程'},features:{kicker:'为什么选择 LexiCue',title:'把你的内容<br>变成一套词汇学习系统。',sub:'导入你在意的材料，整理其中的单词和词组，复习计划交给 LexiCue。'},f1:{title:'导入你正在使用的材料',desc:'导入 TXT、SRT、VTT 或 YouTube 字幕，让文件成为专注词汇库的来源。',youtube:'YouTube 字幕'},f2:{title:'有条理地管理单词和词组',desc:'在独立的单词和词组库中筛选、搜索并更新学习状态；需要时可打开已导入文件查看内容。'},f3:{title:'在合适的时间复习',desc:'智能计划会在词汇淡忘前提醒你复习。'},f4:{title:'内置离线词典',desc:'英、日、德、中词典离线可用。'},f5:{title:'数据留在你的电脑上',desc:'文件和学习记录都保存在本机，无需账号或上传。'},f6:{title:'AI 完全可选',desc:'仅在你需要补充解释或翻译时启用 AI，默认关闭。'},workflow:{kicker:'怎么用',title:'四步，完成词汇学习闭环。',sub:'导入一次，持续整理你的学习数据。'},s1:{title:'导入',desc:'加入文本、字幕或 YouTube 字幕。'},s2:{title:'整理',desc:'按学习状态管理提取出的单词和词组。'},s3:{title:'复习',desc:'用短时、按计划的复习推动词汇进度。'},s4:{title:'追踪',desc:'一眼查看单词、词组与复习进度。'},privacy:{kicker:'默认本地优先',title:'你的学习数据留在电脑上。',body:'文件、词汇和学习记录都保存在设备上。AI 可选，可连接本机模型或你自己的 API。',list:['学习记录保存在本机数据库','词典导入后离线可用','支持随时导出与恢复','AI 可选，默认关闭']},lang:{kicker:'支持语言',title:'四种语言，一套流程。',sub:'选定语言即可获得对应词典；导入、整理和复习的操作保持一致。',h:{language:'学习语言',dict:'离线词典',proc:'自动处理'},dictLabel:'词典',procLabel:'处理',en:{name:'English · 英语',dict:'ECDICT、词组词典',proc:'词形还原（books → book）'},ja:{name:'日本語 · 日语',dict:'JMdict',proc:'分词 + 假名读音'},de:{name:'Deutsch · 德语',dict:'kaikki 词典数据',proc:'词形还原'},zh:{name:'中文 · 中文',dict:'CC-CEDICT',proc:'分词 + 拼音标注'}},cta:{kicker:'开源 · MIT',title:'从对你重要的内容中<br>建立自己的词汇库。',body:'免费、开源，还在快速迭代。到 GitHub 看看，或直接下载体验。',download:'免费下载',github:'在 GitHub 查看',star:'在 GitHub 留下 Star ⭐',starAsk:'喜欢 LexiCue？点个 Star 支持一下吧',support:'喜欢 LexiCue？欢迎在爱发电（Aifadian）上支持作者 ❤',notice:'安装包目前为未签名构建，首次安装可能触发系统安全提示，<a href="https://github.com/skylar-deepmind/LexiCue/blob/main/DISTRIBUTION.md" target="_blank" rel="noreferrer">按安装说明操作即可</a>。'},footer:{tagline:'LexiCue · 本地优先的词汇学习工具',github:'GitHub',license:'MIT License',support:'支持作者'} },
    ja: { metaTitle:'LexiCue — 自分のコンテンツから語彙を育てる',metaDesc:'LexiCue はローカルファーストの語彙学習ツールです。テキストや字幕を取り込み、単語とフレーズを整理して計画的に復習できます。',hero:{eyebrow:'ローカルファースト · オープンソース · オフライン対応',title:'自分のコンテンツを取り込み、<br><span class="gradient-text">自分だけの語彙庫へ。</span>',sub:'LexiCue はローカルファーストの語彙学習ツールです。テキストや字幕を取り込み、単語とフレーズを整理して、自分のペースで復習できます。',ctaDownload:'無料でダウンロード',ctaGithub:'GitHub で見る',hint:'語彙学習の流れを試す'},features:{kicker:'LexiCue を選ぶ理由',title:'あなたのコンテンツを<br>語彙学習の仕組みに。',sub:'大切な素材を取り込み、単語とフレーズを整理し、復習計画は LexiCue に任せましょう。'},f1:{title:'普段使う素材を取り込む',desc:'TXT、SRT、VTT、YouTube 字幕を追加して、集中できる語彙ライブラリの元にします。',youtube:'YouTube 字幕'},f2:{title:'単語とフレーズを整理する',desc:'専用ライブラリで検索・絞り込み・学習状態の変更ができます。必要なときは取り込んだファイルの内容も確認できます。'},f3:{title:'適切なタイミングで復習',desc:'忘れる前に、学習計画が語彙を再提示します。'},f4:{title:'オフライン辞書を内蔵',desc:'英語、日本語、ドイツ語、中国語の辞書をオフラインで利用できます。'},f5:{title:'データは自分のコンピューターに',desc:'ファイルと学習記録はローカル保存。アカウントやアップロードは不要です。'},f6:{title:'AI は任意',desc:'補足説明や翻訳が必要なときだけ AI を有効にできます。初期設定ではオフです。'},workflow:{kicker:'使い方',title:'4 ステップで語彙学習を続ける。',sub:'一度取り込んだら、学習データを整理し続けられます。'},s1:{title:'取り込む',desc:'テキスト、字幕、YouTube 字幕を追加。'},s2:{title:'整理する',desc:'抽出された単語とフレーズを学習状態ごとに管理。'},s3:{title:'復習する',desc:'短時間の計画的な復習で語彙を進める。'},s4:{title:'追跡する',desc:'単語、フレーズ、復習の進捗をひと目で確認。'},privacy:{kicker:'ローカルファースト',title:'学習データはコンピューターに残ります。',body:'ファイル、語彙、学習記録は端末に保存されます。AI は任意で、ローカルモデルや自分の API に接続できます。',list:['学習記録はローカルデータベースに保存','辞書は取り込み後オフラインで利用可能','いつでも書き出しと復元が可能','AI は任意で初期設定はオフ']},lang:{kicker:'対応言語',title:'4 言語、1 つの流れ。',sub:'言語を選ぶと対応辞書を利用でき、取り込み・整理・復習の操作は同じです。',h:{language:'学習言語',dict:'オフライン辞書',proc:'処理'},dictLabel:'辞書',procLabel:'処理',en:{name:'English · 英語',dict:'ECDICT + フレーズ辞書',proc:'語形変化'},ja:{name:'日本語 · 日本語',dict:'JMdict',proc:'形態素解析 + かな'},de:{name:'Deutsch · ドイツ語',dict:'kaikki データ',proc:'語形変化'},zh:{name:'中文 · 中国語',dict:'CC-CEDICT',proc:'分かち書き + ピンイン'}},cta:{kicker:'オープンソース · MIT',title:'大切なコンテンツから<br>自分の語彙ライブラリを育てよう。',body:'無料・オープンソースで、今も進化中。GitHub を見るか、すぐにダウンロードできます。',download:'無料でダウンロード',github:'GitHub で見る',star:'GitHub で Star ⭐',starAsk:'LexiCue が気に入ったら、GitHub で Star を',support:'LexiCue が気に入ったら愛発電（Aifadian）で作者を支援 ❤',notice:'インストーラーは現在未署名のため、初回インストール時にセキュリティ警告が表示される場合があります。<a href="https://github.com/skylar-deepmind/LexiCue/blob/main/DISTRIBUTION.md" target="_blank" rel="noreferrer">インストールガイドを見る</a>。'},footer:{tagline:'LexiCue · ローカルファーストの語彙学習ツール',github:'GitHub',license:'MIT License',support:'支援する'} },
    de: { metaTitle:'LexiCue — Baue Vokabeln aus deinen Inhalten auf',metaDesc:'LexiCue ist ein lokales Vokabellernwerkzeug. Importiere Texte oder Untertitel, ordne Wörter und Phrasen und wiederhole sie nach Plan.',hero:{eyebrow:'Lokal · Open Source · Offline',title:'Importiere deine Inhalte.<br><span class="gradient-text">Baue deinen Wortschatz auf.</span>',sub:'LexiCue ist ein lokales Vokabellernwerkzeug. Importiere Texte oder Untertitel, ordne Wörter und Phrasen und wiederhole sie in deinem Rhythmus.',ctaDownload:'Kostenlos laden',ctaGithub:'GitHub ansehen',hint:'Vokabelablauf ausprobieren'},features:{kicker:'Warum LexiCue',title:'Mach aus deinen Inhalten<br>ein Vokabelsystem.',sub:'Importiere wichtige Materialien, halte Wörter und Phrasen geordnet und überlasse LexiCue den Wiederholungsplan.'},f1:{title:'Importiere deine vorhandenen Materialien',desc:'Füge TXT-, SRT-, VTT-Dateien oder YouTube-Untertitel hinzu und erstelle daraus eine fokussierte Vokabelbibliothek.',youtube:'YouTube-Untertitel'},f2:{title:'Wörter und Phrasen ordentlich verwalten',desc:'Filtere, suche und ändere Lernstatus in eigenen Listen. Öffne importierte Dateien, wenn du ihren Inhalt prüfen möchtest.'},f3:{title:'Zum richtigen Zeitpunkt wiederholen',desc:'Ein Lernplan bringt Vokabeln zurück, bevor sie verblassen.'},f4:{title:'Offline-Wörterbücher integriert',desc:'Nutze Wörterbücher für Englisch, Japanisch, Deutsch und Chinesisch ohne Internet.'},f5:{title:'Deine Daten bleiben auf deinem Computer',desc:'Dateien und Lernaufzeichnungen werden lokal gespeichert. Kein Konto und kein Upload nötig.'},f6:{title:'KI ist optional',desc:'Aktiviere KI nur für zusätzliche Erklärungen oder Übersetzungen. Standardmäßig ist sie aus.'},workflow:{kicker:'So funktioniert es',title:'Vier Schritte, ein Vokabelkreislauf.',sub:'Einmal importieren, Lerninhalte dauerhaft geordnet halten.'},s1:{title:'Importieren',desc:'Texte, Untertitel oder YouTube-Untertitel hinzufügen.'},s2:{title:'Ordnen',desc:'Extrahierte Wörter und Phrasen nach Lernstatus verwalten.'},s3:{title:'Wiederholen',desc:'Kurze, geplante Wiederholungen bringen Vokabeln voran.'},s4:{title:'Verfolgen',desc:'Wort-, Phrasen- und Wiederholungsfortschritt auf einen Blick.'},privacy:{kicker:'Lokal zuerst',title:'Deine Lerndaten bleiben auf deinem Computer.',body:'Dateien, Vokabeln und Lernverlauf bleiben auf deinem Gerät. KI ist optional und kann dein lokales Modell oder deine API nutzen.',list:['Lernverlauf in einer lokalen Datenbank','Wörterbücher funktionieren nach dem Import offline','Jederzeit exportieren und wiederherstellen','KI ist optional und standardmäßig deaktiviert']},lang:{kicker:'Sprachen',title:'Vier Sprachen, ein Ablauf.',sub:'Wähle eine Sprache mit passendem Wörterbuch; Importieren, Ordnen und Wiederholen funktionieren gleich.',h:{language:'Lernsprache',dict:'Offline-Wörterbuch',proc:'Verarbeitung'},dictLabel:'Wörterbuch',procLabel:'Verarbeitung',en:{name:'English · Englisch',dict:'ECDICT + Phrasen',proc:'Wortformen'},ja:{name:'日本語 · Japanisch',dict:'JMdict',proc:'Tokenisierung + Kana'},de:{name:'Deutsch',dict:'kaikki-Daten',proc:'Wortformen'},zh:{name:'中文 · Chinesisch',dict:'CC-CEDICT',proc:'Tokenisierung + Pinyin'}},cta:{kicker:'Open Source · MIT',title:'Baue eine Vokabelbibliothek<br>aus den Inhalten, die dir wichtig sind.',body:'Kostenlos, Open Source und ständig in Entwicklung. Sieh auf GitHub vorbei oder lade LexiCue herunter.',download:'Kostenlos laden',github:'Auf GitHub ansehen',star:'Auf GitHub markieren ⭐',starAsk:'Gefällt dir LexiCue? Gib dem Projekt einen Stern.',support:'Unterstütze den Autor auf Aifadian ❤',notice:'Installationspakete sind derzeit nicht signiert. Beim ersten Start kann eine Sicherheitswarnung erscheinen.'},footer:{tagline:'LexiCue · Lokales Vokabellernwerkzeug',github:'GitHub',license:'MIT-Lizenz',support:'Unterstützen'} }
  };
  Object.keys(MARKETING_COPY).forEach(function (locale) { Object.assign(I18N[locale], MARKETING_COPY[locale]); });

  var DEMO_I18N = {
    en:{files:'Files',content:'File contents',words:'Words',phrases:'Phrases',review:'Review',insights:'Insights',settings:'Settings',more:'More',reset:'Reset demo',import:'Import',youtube:'YouTube subtitles',folder:'Study notes',back:'All files',preview:'Import preview',choose:'Choose a source',confirm:'Add to library',cancel:'Cancel',viewContent:'View contents',source:'Imported file',new:'New',learning:'Learning',known:'Known',all:'All',search:'Search…',reviewWord:'Word review',reviewPhrase:'Phrase review',reveal:'Click to reveal',answer:'Answer',again:'Again',hard:'Hard',good:'Good',easy:'Easy',due:'Due',total:'Total words',mastered:'Mastered',today:'Due today',coverage:'File coverage',language:'English',offline:'Offline dictionaries',baseline:'Frequency baseline',backup:'Backup & restore',ai:'Optional AI',done:'Added to your library'},
    zh:{files:'文件',content:'文件内容',words:'单词',phrases:'词组',review:'复习',insights:'统计',settings:'设置',more:'更多',reset:'重置演示',import:'导入文件',youtube:'YouTube 字幕',folder:'学习笔记',back:'全部文件',preview:'导入预览',choose:'选择来源',confirm:'加入资料库',cancel:'取消',viewContent:'查看内容',source:'已导入文件',new:'未处理',learning:'学习中',known:'已掌握',all:'全部',search:'搜索…',reviewWord:'单词复习',reviewPhrase:'词组复习',reveal:'点击显示答案',answer:'答案',again:'忘记',hard:'困难',good:'记得',easy:'简单',due:'待复习',total:'单词总数',mastered:'已掌握',today:'今日待复习',coverage:'文件学习覆盖度',language:'英语',offline:'离线词典',baseline:'词频基线',backup:'备份与恢复',ai:'可选 AI',done:'已加入资料库'},
    ja:{files:'ファイル',content:'ファイル内容',words:'単語',phrases:'フレーズ',review:'復習',insights:'統計',settings:'設定',more:'その他',reset:'デモをリセット',import:'ファイルを追加',youtube:'YouTube 字幕',folder:'学習ノート',back:'すべてのファイル',preview:'インポートの確認',choose:'ソースを選択',confirm:'ライブラリに追加',cancel:'キャンセル',viewContent:'内容を見る',source:'取り込み済みファイル',new:'新規',learning:'学習中',known:'習得済み',all:'すべて',search:'検索…',reviewWord:'単語の復習',reviewPhrase:'フレーズの復習',reveal:'クリックして答えを見る',answer:'答え',again:'もう一度',hard:'難しい',good:'覚えた',easy:'簡単',due:'要復習',total:'単語数',mastered:'習得済み',today:'今日の復習',coverage:'ファイルの学習状況',language:'英語',offline:'オフライン辞書',baseline:'頻度ベースライン',backup:'バックアップと復元',ai:'任意の AI',done:'ライブラリに追加しました'},
    de:{files:'Dateien',content:'Dateiinhalt',words:'Wörter',phrases:'Phrasen',review:'Wiederholen',insights:'Statistik',settings:'Einstellungen',more:'Mehr',reset:'Demo zurücksetzen',import:'Datei importieren',youtube:'YouTube-Untertitel',folder:'Lernnotizen',back:'Alle Dateien',preview:'Importvorschau',choose:'Quelle wählen',confirm:'Zur Bibliothek',cancel:'Abbrechen',viewContent:'Inhalt ansehen',source:'Importierte Datei',new:'Neu',learning:'In Bearbeitung',known:'Beherrscht',all:'Alle',search:'Suchen…',reviewWord:'Wörter wiederholen',reviewPhrase:'Phrasen wiederholen',reveal:'Klicken zum Aufdecken',answer:'Antwort',again:'Nochmal',hard:'Schwer',good:'Gut',easy:'Leicht',due:'Fällig',total:'Wörter gesamt',mastered:'Beherrscht',today:'Heute fällig',coverage:'Dateiabdeckung',language:'Englisch',offline:'Offline-Wörterbücher',baseline:'Häufigkeitsbasis',backup:'Sichern & Wiederherstellen',ai:'Optionale KI',done:'Zur Bibliothek hinzugefügt'}
  };
  var demoInitial = { view:'files', folder:false, modal:false, source:'TXT', wordStatus:'new', phraseStatus:'new', filter:'all', query:'', cardType:'word', revealed:false, reviewed:0, more:false, imported:false };
  var demo = JSON.parse(JSON.stringify(demoInitial));
  function demoText(key) { return (DEMO_I18N[lang] || DEMO_I18N.en)[key] || key; }
  function demoStatusLabel(status) { return demoText(status === 'new' ? 'new' : status); }
  function demoNavButton(view, icon) { return '<button type="button" data-demo-view="'+view+'" class="'+(demo.view===view?'active':'')+'"><span>'+icon+'</span><span>'+demoText(view)+'</span></button>'; }
  function renderDemo() {
    var root = document.getElementById('interactive-demo'); if (!root) return;
    var content = demo.view === 'files' ? demoFiles() : demo.view === 'content' ? demoContent() : demo.view === 'words' || demo.view === 'phrases' ? demoList(demo.view) : demo.view === 'review' ? demoReview() : demo.view === 'insights' ? demoInsights() : demoSettings();
    root.innerHTML = '<div class="glow"></div><div class="app-window"><div class="window-bar"><span class="window-dot"></span><span class="window-dot"></span><span class="window-dot"></span><span class="window-title">LexiCue · '+demoText(demo.view)+'</span></div><div class="demo-shell"><aside class="demo-sidebar"><div class="demo-brand"><img src="lexicue-icon.png" alt=""/>LexiCue</div><div class="demo-nav">'+demoNavButton('files','▤')+demoNavButton('words','Aa')+demoNavButton('phrases','◌')+demoNavButton('review','↻')+demoNavButton('insights','▦')+demoNavButton('settings','⚙')+'</div><div class="demo-sidebar-foot"><button type="button" class="demo-reset" data-demo-action="reset">↺ '+demoText('reset')+'</button></div></aside><main class="demo-content">'+content+'</main><nav class="demo-mobile-nav">'+demoNavButton('files','▤')+demoNavButton('words','Aa')+demoNavButton('review','↻')+'<button type="button" data-demo-action="more" class="'+(demo.more?'active':'')+'">•••<span>'+demoText('more')+'</span></button>'+(demo.more?'<div class="more-menu">'+demoNavButton('phrases','◌')+demoNavButton('insights','▦')+demoNavButton('settings','⚙')+'<button type="button" data-demo-action="reset">↺ '+demoText('reset')+'</button></div>':'')+'</nav></div>'+(demo.modal?demoModal():'')+'</div><div class="stage-hint">'+demoText('files')+' → '+demoText('words')+' / '+demoText('phrases')+' → '+demoText('review')+' → '+demoText('insights')+'</div>';
  }
  function demoFiles(){ var imported = demo.imported ? '<article class="demo-file"><strong>How We Remember.txt</strong><span>TXT · 1,284 words</span><button class="demo-button" data-demo-view="content">'+demoText('viewContent')+'</button></article>':''; return '<div class="demo-top"><div><h3>'+demoText('files')+'</h3><p>'+demoText('folder')+'</p></div><div class="demo-actions"><button class="demo-button" data-demo-action="youtube">'+demoText('youtube')+'</button><button class="demo-button primary" data-demo-action="import">'+demoText('import')+'</button></div></div><div class="demo-folder">'+(demo.folder?'<button data-demo-action="folder">← '+demoText('back')+'</button>':'<span>⌂ / '+demoText('back')+'</span>')+'</div><div class="demo-files"><article class="demo-file folder" data-demo-action="folder"><strong>📁 '+demoText('folder')+'</strong><span>3 files</span></article><article class="demo-file"><strong>🎬 The Power of Habit.srt</strong><span>SRT · 486 segments</span><button class="demo-button" data-demo-view="content">'+demoText('viewContent')+'</button></article>'+imported+'</div>'; }
  function demoContent(){ return '<div class="demo-top"><div><h3>'+demoText('content')+'</h3><p>'+demoText('source')+' · The Power of Habit.srt</p></div><button class="demo-button" data-demo-view="files">← '+demoText('files')+'</button></div><div class="demo-preview-content"><p>Small choices, repeated over time, shape the routines that guide our lives.</p><p>Habits are not fixed. They can be adjusted by changing the cues and rewards around them.</p><p>This preview helps you check an imported file. Vocabulary learning continues in the word and phrase libraries.</p></div>'; }
  function demoList(type){ var isPhrase=type==='phrases', items=isPhrase?[['in isolation',5,demo.phraseStatus],['in context',4,'learning'],['pick up',3,'known']]:[['effective',12,demo.wordStatus],['meaningful',6,'known'],['revisit',4,'new']]; var rows=items.filter(function(x){return demo.filter==='all'||x[2]===demo.filter;}).filter(function(x){return x[0].indexOf(demo.query.toLowerCase())>=0;}).map(function(x){return '<button data-demo-cycle="'+(isPhrase?'phrase':'word')+'"><span>'+x[0]+'</span><small>×'+x[1]+'</small><span class="demo-badge '+x[2]+'">'+demoStatusLabel(x[2])+'</span></button>';}).join('') || '<p>'+demoText('search')+'</p>'; return '<div class="demo-top"><div><h3>'+demoText(type)+'</h3><p>'+demoText('search')+'</p></div><input class="mock-search" data-demo-search placeholder="'+demoText('search')+'" value="'+demo.query+'"></div><div class="demo-tabs">'+['all','new','learning','known'].map(function(s){return '<button class="demo-chip '+(demo.filter===s?'active':'')+'" data-demo-filter="'+s+'">'+demoText(s)+'</button>';}).join('')+'</div><div class="demo-list">'+rows+'</div>'; }
  function demoReview(){ var item=demo.cardType==='phrase'?'in isolation':'effective', pct=Math.min(100,demo.reviewed*33+8); return '<div class="demo-tabs"><button class="demo-chip '+(demo.cardType==='word'?'active':'')+'" data-demo-card="word">'+demoText('reviewWord')+'</button><button class="demo-chip '+(demo.cardType==='phrase'?'active':'')+'" data-demo-card="phrase">'+demoText('reviewPhrase')+'</button></div><div class="demo-review"><div class="demo-progress"><span>'+(demo.reviewed+1)+' / 3</span><span>'+demoText('due')+'</span><i style="--progress:'+pct+'%"></i></div><div class="demo-card" data-demo-action="reveal"><h4>'+item+'</h4><p>'+demoText('reveal')+'</p>'+(demo.revealed?'<div class="demo-answer"><b>'+demoText('answer')+'</b><br>'+ (demo.cardType==='phrase'?'separately; without connection':'successful in producing the intended result')+'</div>':'')+'</div>'+(demo.revealed?'<div class="demo-ratings">'+['again','hard','good','easy'].map(function(x){return '<button class="'+x+'" data-demo-rate="'+x+'">'+demoText(x)+'</button>';}).join('')+'</div>':'')+'</div>'; }
  function demoInsights(){ var learned=(demo.wordStatus==='known'?1:0)+(demo.phraseStatus==='known'?1:0), due=Math.max(0,3-demo.reviewed); return '<div class="demo-top"><div><h3>'+demoText('insights')+'</h3><p>'+demoText('language')+'</p></div><button class="demo-button" data-demo-view="settings">'+demoText('settings')+'</button></div><div class="demo-stats"><div class="demo-stat"><span>'+demoText('total')+'</span><strong>1,284</strong></div><div class="demo-stat"><span>'+demoText('mastered')+'</span><strong>'+ (356+learned)+'</strong></div><div class="demo-stat"><span>'+demoText('today')+'</span><strong>'+due+'</strong></div><div class="demo-stat"><span>'+demoText('phrases')+'</span><strong>86</strong></div></div><div class="demo-insights"><section class="demo-panel"><h4>'+demoText('coverage')+'</h4><div class="demo-bar"><i style="width:'+(28+learned*5)+'%"></i></div><p>How We Remember.txt · '+(28+learned*5)+'%</p></section><section class="demo-panel"><h4>Last 7 days</h4><div class="chart"><div class="chart-col"><i style="height:35%"></i></div><div class="chart-col"><i style="height:65%"></i></div><div class="chart-col"><i style="height:45%"></i></div><div class="chart-col"><i style="height:90%"></i></div><div class="chart-col"><i style="height:55%"></i></div></div></section></div>'; }
  function demoSettings(){ return '<div class="demo-top"><div><h3>'+demoText('settings')+'</h3><p>Local-first</p></div></div><div class="demo-setting"><div><b>'+demoText('offline')+'</b>English · Japanese · German · Chinese</div><div><b>'+demoText('baseline')+'</b>Top 3,000 words</div><div><b>'+demoText('backup')+'</b>Export and restore locally</div><div><b>'+demoText('ai')+'</b>Off by default</div></div>'; }
  function demoModal(){ return '<div class="demo-modal" role="dialog" aria-modal="true"><div class="demo-dialog"><h4>'+demoText('preview')+'</h4><p>'+demoText('choose')+'</p><div class="demo-sources">'+['TXT','SRT','VTT','YouTube'].map(function(s){return '<button data-demo-source="'+s+'" class="'+(demo.source===s?'active':'')+'">'+s+(s==='YouTube'?' · '+demoText('youtube'):'')+'</button>';}).join('')+'</div><p>How We Remember What We Read · 12 segments · 1284 words</p><div class="demo-dialog-foot"><button class="demo-button" data-demo-action="cancel">'+demoText('cancel')+'</button><button class="demo-button primary" data-demo-action="confirm">'+demoText('confirm')+'</button></div></div></div>'; }

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
    document.documentElement.lang = lang === "en" ? "en" : (lang === "ja" ? "ja" : (lang === "de" ? "de" : "zh-CN"));
    document.title = dict.metaTitle;
    document.querySelector('meta[name="description"]').content = dict.metaDesc;
    document.querySelectorAll('meta[property="og:title"], meta[name="twitter:title"]').forEach(function (meta) { meta.content = dict.metaTitle; });
    document.querySelectorAll('meta[property="og:description"], meta[name="twitter:description"]').forEach(function (meta) { meta.content = dict.metaDesc; });

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
    renderDemo();
  }

  function currentLang() {
    try {
      var saved = localStorage.getItem("lexicue-lang");
      if (saved === "zh" || saved === "en" || saved === "ja" || saved === "de") return saved;
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

  document.addEventListener('click', function (event) {
    var target = event.target.closest('[data-demo-view], [data-demo-action], [data-demo-filter], [data-demo-card], [data-demo-rate], [data-demo-source], [data-demo-cycle]');
    if (!target) return;
    if (target.dataset.demoView) { demo.view = target.dataset.demoView; demo.more = false; }
    if (target.dataset.demoCycle) {
      var statusKey = target.dataset.demoCycle === 'phrase' ? 'phraseStatus' : 'wordStatus';
      demo[statusKey] = demo[statusKey] === 'new' ? 'learning' : (demo[statusKey] === 'learning' ? 'known' : 'new');
    }
    if (target.dataset.demoFilter) demo.filter = target.dataset.demoFilter;
    if (target.dataset.demoCard) { demo.cardType = target.dataset.demoCard; demo.revealed = false; }
    if (target.dataset.demoRate) { demo.reviewed = Math.min(3, demo.reviewed + 1); demo.revealed = false; }
    if (target.dataset.demoSource) demo.source = target.dataset.demoSource;
    var action = target.dataset.demoAction;
    if (action === 'reset') demo = JSON.parse(JSON.stringify(demoInitial));
    if (action === 'import' || action === 'youtube') { demo.modal = true; if (action === 'youtube') demo.source = 'YouTube'; }
    if (action === 'cancel') demo.modal = false;
    if (action === 'confirm') { demo.modal = false; demo.imported = true; }
    if (action === 'folder') demo.folder = !demo.folder;
    if (action === 'reveal') demo.revealed = true;
    if (action === 'more') demo.more = !demo.more;
    renderDemo();
  });
  document.addEventListener('input', function (event) {
    if (event.target.matches('[data-demo-search]')) { demo.query = event.target.value; renderDemo(); }
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && demo.modal) { demo.modal = false; renderDemo(); }
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
