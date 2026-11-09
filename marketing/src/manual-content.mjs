// Current main-branch guide. Stable chapter and section IDs preserve incoming URLs.
export const manualContent={
  "en": {
    "quick-start": {
      "intro": "Read English with your own materials: import, understand on demand, save context and recall it on re-encounter.",
      "sections": [
        {
          "id": "install",
          "title": "Version and installation",
          "body": [
            "This guide describes current main. Public v0.4.5 downloads for macOS, Windows and Android predate this workspace and Mac–iPhone sync. Use a newer release when available or build from source. iPhone has a locally tested signed build, but no public installer."
          ],
          "steps": [],
          "links": [
            [
              "release"
            ],
            [
              "installation"
            ]
          ]
        },
        {
          "id": "first-file",
          "title": "Import and open a material",
          "body": [],
          "steps": [
            "Open Import from Materials. Choose a file, or paste English text, a webpage link or a YouTube link.",
            "Check the extracted text and selected pages or chapters where available, then confirm. Open the material card to read."
          ],
          "related": [
            "files"
          ]
        },
        {
          "id": "first-review",
          "title": "Save an encounter",
          "body": [],
          "steps": [
            "Select an unfamiliar word or passage. Read the meaning and save it with its original sentence; add a personal note if useful.",
            "Open Saved to find the record. When the expression appears in later reading, its highlight opens previous contexts."
          ],
          "related": [
            "reading",
            "vocabulary",
            "review"
          ]
        }
      ]
    },
    "files": {
      "intro": "Bring English text, documents or subtitles into one reading library.",
      "sections": [
        {
          "id": "import",
          "title": "Supported materials",
          "body": [
            "File import supports PDF, DOCX, EPUB, Markdown, TXT, SRT and VTT. Scanned PDFs without extractable text, encrypted files and protected books may not import; inspect the preview before saving.",
            "Paste English text or a webpage link through the same import entry. If a webpage cannot be extracted, copy its visible English text and paste that instead. Learning is English only; interface language is a separate setting."
          ],
          "steps": []
        },
        {
          "id": "tags",
          "title": "Desk, library and tags",
          "body": [
            "Keep current reading on the desk. Put a material away to the library, bring it back later, search by title or filter with tags. Tag colors help identify groups; removing a tag does not remove its materials."
          ],
          "steps": [],
          "image": "files"
        },
        {
          "id": "youtube",
          "title": "YouTube subtitles",
          "body": [
            "Paste a YouTube link, inspect the available English subtitles and confirm the import. Availability depends on the video and platform. iPhone uses public English subtitles; desktop can use browser-session options and tool diagnostics in Settings → Subtitles."
          ],
          "steps": [],
          "related": [
            "settings#youtube"
          ]
        },
        {
          "id": "backup",
          "title": "Backups",
          "body": [
            "Use Settings → Backup to export or restore your learning data. Read the restore confirmation and keep an independent copy before replacing data."
          ],
          "steps": [],
          "related": [
            "settings#backup"
          ]
        }
      ]
    },
    "reading": {
      "intro": "Understand English without losing your place.",
      "sections": [
        {
          "id": "lookup",
          "title": "Words and passages",
          "body": [],
          "steps": [
            "Select a word for dictionary lookup, or select a passage to understand it in context. Switch among available dictionary sources and write your own explanation when useful.",
            "The lookup panel opens beside the text on desktop and as a bottom sheet on a small screen. Close it to continue reading."
          ],
          "image": "reading",
          "related": [
            "settings#dictionary"
          ]
        },
        {
          "id": "analysis",
          "title": "Chinese translation and listening",
          "body": [
            "Use the translation control to show or hide Chinese text. Existing translations are preserved; missing translations can be fetched online. If fetching fails, you can continue reading English and retry later.",
            "Enter listening mode to follow the reading. Play source audio when available or use speech; adjust playback speed. Speech and source playback depend on network, media availability and platform support."
          ],
          "steps": []
        },
        {
          "id": "status",
          "title": "Save your understanding",
          "body": [
            "Save the expression, source sentence and available dictionary reference. Write your own explanation or note for this sentence. The current workspace uses saved contexts and re-encounters; older learning records remain in History."
          ],
          "steps": [],
          "related": [
            "vocabulary",
            "review"
          ]
        }
      ]
    },
    "vocabulary": {
      "intro": "Saved keeps expressions and dictionary references together with the places where you met them.",
      "sections": [
        {
          "id": "find",
          "title": "Find a saved expression",
          "body": [
            "Open Saved and search an expression. Expand it to inspect each saved context; the same expression can keep several original sentences."
          ],
          "steps": [],
          "image": "vocabulary"
        },
        {
          "id": "organize",
          "title": "Edit a context",
          "body": [
            "Update your note or explanation on the relevant saved record. Remove only that context when needed, and use Undo if offered. Other contexts for the same expression remain separate."
          ],
          "steps": []
        },
        {
          "id": "source",
          "title": "Return to the source",
          "body": [
            "Choose the source on a saved context to open its original material and sentence. Return to continue where you came from. A missing or deleted source cannot be reopened; the saved context remains readable."
          ],
          "steps": []
        }
      ]
    },
    "review": {
      "intro": "Let a new encounter bring back the sentences you saved before.",
      "sections": [
        {
          "id": "session",
          "title": "Recognize a saved expression",
          "body": [
            "Saved expressions are highlighted in later reading when matched. Open the highlight and switch to previous records to see earlier sentences, translations, meanings and notes. These are past contexts, not the meaning of the new sentence."
          ],
          "steps": [],
          "image": "review"
        },
        {
          "id": "ratings",
          "title": "Choose how to continue",
          "body": [
            "Compare the earlier use with today’s sentence, revise your note or return to the old source. Current reading has no due-card queue or rating step. Earlier scheduled-review records remain in History."
          ],
          "steps": [],
          "related": [
            "vocabulary",
            "insights"
          ]
        }
      ]
    },
    "insights": {
      "intro": "Resume reading and preserve your earlier records.",
      "sections": [
        {
          "id": "files",
          "title": "Reading position",
          "body": [
            "The app saves your material’s reading position. Reopen it from the desk or library to continue. Synced position changes take effect when you next open the material, without moving a page you are currently reading."
          ],
          "steps": []
        },
        {
          "id": "history",
          "title": "Earlier learning history",
          "body": [
            "Settings → Backup → History keeps earlier words, phrases and review records available for viewing and export. They are not automatically treated as active saved contexts in the new reading flow."
          ],
          "steps": [],
          "related": [
            "settings#backup"
          ]
        }
      ]
    },
    "settings": {
      "intro": "Mac and iPhone share four settings groups, with platform-specific actions where needed.",
      "sections": [
        {
          "id": "language",
          "title": "Preferences and appearance",
          "body": [
            "Choose English, Chinese, Japanese or German for the interface; English remains the learning language. Pick ocean, sage, amber, twilight or midnight on the settings home. Reading font controls stay in the reader.",
            "The Preferences group also contains speech preferences and replaying the first-use guide."
          ],
          "steps": [],
          "image": "settings"
        },
        {
          "id": "device-sync",
          "title": "Pair Mac and iPhone",
          "body": [],
          "steps": [
            "Connect one Mac and one iPhone to a mutually reachable local network and open Settings → Device sync on both. Allow local-network access; the iPhone needs camera permission for scanning.",
            "Show the temporary QR code on Mac, scan it with iPhone, then compare the device names and code on both. Confirm on each device to trust the pairing and merge the two local libraries."
          ]
        },
        {
          "id": "sync-scope",
          "title": "Sync and recovery limits",
          "body": [
            "Paired apps exchange material text, sentence timing, existing Chinese translations, saved contexts, notes, tags and reading positions, including edits and deletions. Original media files and device preferences stay on their devices. Windows and Android do not support this Apple-device sync.",
            "Both sides create a recoverable backup before the first merge. Offline edits wait for reconnection; keep iPhone in the foreground. Mac can optionally keep receiving after its window closes. Sleep or an isolated guest network can interrupt reachability.",
            "Review preserved alternate edits in Device sync if needed. Removing the device revokes its trust and keeps local data. Restore a pre-merge backup from device management when necessary; sync is not a substitute for your own backup."
          ],
          "steps": []
        },
        {
          "id": "backup",
          "title": "Data: backup and dictionary",
          "body": [
            "Backup offers export, restore and History. Dictionary shows local Longman availability and its audio status; retry if unavailable. Online lookup sources may require internet."
          ],
          "steps": []
        },
        {
          "id": "dictionary",
          "title": "Dictionary meanings",
          "body": [
            "Lookup can retain a reference to the current dictionary result. It is a reference, not a confirmed sentence meaning. You can save your own explanation even when no dictionary entry is available."
          ],
          "steps": []
        },
        {
          "id": "youtube",
          "title": "Tools: subtitles",
          "body": [
            "Desktop includes browser-session preferences and dependency diagnostics. iPhone uses public English tracks and offers subtitle-cache clearing. An old desktop session preference does not enable authenticated iPhone downloads."
          ],
          "steps": []
        },
        {
          "id": "updates",
          "title": "App: software updates",
          "body": [
            "Open App → Software updates. Mac can check for an available update; a locally installed iPhone build shows version, installation method and update information. This does not imply App Store or public iPhone distribution."
          ],
          "steps": []
        }
      ]
    },
    "faq": {
      "intro": "Answers about current reading, downloads, connectivity and your data.",
      "sections": [
        {
          "id": "installation",
          "title": "Which version can I download?",
          "body": [
            "The latest public release checked for this update is v0.4.5, published 12 October 2026, with macOS, Windows and Android packages. The current main features shown here came later. No public iPhone installer is available."
          ],
          "steps": [],
          "links": [
            [
              "release"
            ],
            [
              "installation"
            ]
          ]
        },
        {
          "id": "srt",
          "title": "Which material can I use?",
          "body": [
            "Import English documents, subtitles, copied text or accessible webpages. SRT and VTT keep subtitle timing. PDF extraction requires text; protected or unreadable documents may fail. Inspect extracted content, and paste text manually when needed."
          ],
          "steps": [],
          "related": [
            "files#import"
          ]
        },
        {
          "id": "offline",
          "title": "What works offline?",
          "body": [
            "Read local materials and saved contexts, write notes and use an available local dictionary offline. Webpage/YouTube retrieval, online lookup, missing translations and network speech require a connection. Synced devices each retain a local library; exchanges wait until they can reconnect."
          ],
          "steps": []
        },
        {
          "id": "review",
          "title": "Where did the old review and statistics go?",
          "body": [
            "The current workspace focuses on reading and Saved, with recall when expressions appear again. Existing older records remain available in Settings → Backup → History for viewing and export; they have not been silently deleted."
          ],
          "steps": [],
          "related": [
            "review",
            "insights"
          ]
        },
        {
          "id": "backup",
          "title": "Does sync replace a backup?",
          "body": [
            "No. Sync carries edits and deletions between the paired Mac and iPhone. Keep your own exported backups. Device sync also offers pre-merge recovery backups; removing a device keeps its local data while revoking trust."
          ],
          "steps": [],
          "related": [
            "settings#device-sync",
            "settings#backup"
          ]
        }
      ]
    }
  },
  "zh": {
    "quick-start": {
      "intro": "用自己的材料读英语：导入、按需理解、保存语境、重遇回顾。",
      "sections": [
        {
          "id": "install",
          "title": "版本与安装",
          "body": [
            "本手册介绍当前 main。公开 v0.4.5 的 macOS、Windows、Android 下载早于本次工作区和 Mac–iPhone 同步；请等待后续版本或从源码构建。iPhone 已有本地签名实测构建，尚无公开安装包。"
          ],
          "steps": [],
          "links": [
            [
              "release"
            ],
            [
              "installation"
            ]
          ]
        },
        {
          "id": "first-file",
          "title": "导入并打开材料",
          "body": [],
          "steps": [
            "在“材料”页打开导入，选择文件，或粘贴英文正文、网页链接、YouTube 链接。",
            "检查提取的正文；若提供页码或章节选择，按需调整后确认。点击材料卡开始阅读。"
          ],
          "related": [
            "files"
          ]
        },
        {
          "id": "first-review",
          "title": "保存一次相遇",
          "body": [],
          "steps": [
            "选中不懂的单词或表达，查看含义，连同原句保存；按需添加自己的注释。",
            "在“已保存”中查找记录；当表达在后续阅读中出现时，点击高亮查看过去的语境。"
          ],
          "related": [
            "reading",
            "vocabulary",
            "review"
          ]
        }
      ]
    },
    "files": {
      "intro": "把英文正文、文档与字幕放进自己的阅读材料库。",
      "sections": [
        {
          "id": "import",
          "title": "支持的材料",
          "body": [
            "支持 PDF、DOCX、EPUB、Markdown、TXT、SRT、VTT。无可提取文字的扫描 PDF、加密文件和受保护书籍可能无法导入，保存前请检查预览。",
            "同一导入入口可粘贴英文正文或网页链接；网页无法提取时，可复制可见英文正文再粘贴。学习目标仅为英语，界面语言另行设置。"
          ],
          "steps": []
        },
        {
          "id": "tags",
          "title": "桌面、材料库与标签",
          "body": [
            "正在读的材料留在桌面，暂时不读的收进材料库，之后可以重新放回。按标题搜索或用标签筛选，颜色帮助区分材料组；删除标签不会删除材料。"
          ],
          "steps": [],
          "image": "files"
        },
        {
          "id": "youtube",
          "title": "YouTube 字幕",
          "body": [
            "粘贴 YouTube 链接，检查可用英文字幕后确认导入。可用性取决于视频和平台；iPhone 使用公开英文字幕，桌面可在“设置 → 字幕”配置浏览器会话、查看工具诊断。"
          ],
          "steps": [],
          "related": [
            "settings#youtube"
          ]
        },
        {
          "id": "backup",
          "title": "备份",
          "body": [
            "在“设置 → 备份”导出或恢复学习资料。恢复前阅读确认提示，并保存一份独立副本。"
          ],
          "steps": [],
          "related": [
            "settings#backup"
          ]
        }
      ]
    },
    "reading": {
      "intro": "理解英文，同时留在原来的阅读位置。",
      "sections": [
        {
          "id": "lookup",
          "title": "单词与一段表达",
          "body": [],
          "steps": [
            "点选单词查词，或选择一段表达按语境理解。可切换可用词典来源，按需填写自己的解释。",
            "桌面在原文旁打开查词面板，小屏使用底部弹层；关闭后继续阅读。"
          ],
          "image": "reading",
          "related": [
            "settings#dictionary"
          ]
        },
        {
          "id": "analysis",
          "title": "中文译文与听读",
          "body": [
            "用译文控件显示或隐藏中文。保留已有译文，缺失部分可联网补译；获取失败时仍可继续读英文，稍后重试。",
            "进入听读模式跟随阅读；有来源音频时播放来源，也可使用朗读并调节倍速。朗读与来源播放受网络、媒体可用性和平台支持限制。"
          ],
          "steps": []
        },
        {
          "id": "status",
          "title": "保存理解",
          "body": [
            "保存表达、来源原句与可用词典参考，并为当前句子填写自己的解释或注释。当前工作区围绕语境收藏与重遇展开，旧学习记录在历史记录中保留。"
          ],
          "steps": [],
          "related": [
            "vocabulary",
            "review"
          ]
        }
      ]
    },
    "vocabulary": {
      "intro": "“已保存”将表达、词典参考与遇见它的地方放在一起。",
      "sections": [
        {
          "id": "find",
          "title": "查找已保存的表达",
          "body": [
            "打开“已保存”搜索表达，展开查看各次保存的语境。同一表达可以保留多个来源原句。"
          ],
          "steps": [],
          "image": "vocabulary"
        },
        {
          "id": "organize",
          "title": "编辑一条语境",
          "body": [
            "在对应收藏记录修改注释或解释；按需移除这一条语境，提供撤销时可撤回。同一表达的其他语境各自独立。"
          ],
          "steps": []
        },
        {
          "id": "source",
          "title": "返回来源",
          "body": [
            "点击语境的来源打开原材料和对应句子，再返回此前的位置。来源缺失或已删除时无法打开，已保存的语境仍可查看。"
          ],
          "steps": []
        }
      ]
    },
    "review": {
      "intro": "让新的相遇，唤回以前保存的原句。",
      "sections": [
        {
          "id": "session",
          "title": "遇见已保存的表达",
          "body": [
            "已保存的表达匹配到后续阅读时会高亮。点开并查看过往记录，回顾原句、译文、释义和注释；它们来自过去的语境，不代表当前句子的含义。"
          ],
          "steps": [],
          "image": "review"
        },
        {
          "id": "ratings",
          "title": "自选回顾方式",
          "body": [
            "对照过去与现在的用法，修改注释或返回旧来源。当前阅读流程没有到期卡片队列与评分步骤，早期定时复习记录仍保留在历史记录中。"
          ],
          "steps": [],
          "related": [
            "vocabulary",
            "insights"
          ]
        }
      ]
    },
    "insights": {
      "intro": "接续阅读，并保留以前的学习记录。",
      "sections": [
        {
          "id": "files",
          "title": "阅读位置",
          "body": [
            "应用保存材料的阅读位置，从桌面或材料库再次打开即可接着读。同步收到的位置在下次打开材料时使用，不会把正在阅读的页面挪走。"
          ],
          "steps": []
        },
        {
          "id": "history",
          "title": "旧学习历史",
          "body": [
            "“设置 → 备份 → 历史记录”保留旧单词、词组与复习记录，可查看和导出；它们不会自动作为新阅读流程的活跃语境收藏。"
          ],
          "steps": [],
          "related": [
            "settings#backup"
          ]
        }
      ]
    },
    "settings": {
      "intro": "Mac 与 iPhone 共用四组设置，具体操作随平台能力调整。",
      "sections": [
        {
          "id": "language",
          "title": "偏好与外观",
          "body": [
            "界面可选英语、中文、日语或德语，学习目标仍为英语。设置首页可选海湾蓝、鼠尾草绿、琥珀暖光、暮光紫、深夜墨色；字号控制放在阅读页。",
            "“偏好”组还包含朗读偏好与重新查看首次引导。"
          ],
          "steps": [],
          "image": "settings"
        },
        {
          "id": "device-sync",
          "title": "配对 Mac 与 iPhone",
          "body": [],
          "steps": [
            "将一台 Mac 与一台 iPhone 接入可互通的局域网，在两端打开“设置 → 设备同步”。允许本地网络访问，iPhone 扫码还需相机权限。",
            "Mac 显示临时二维码，iPhone 扫描；核对两端设备名和验证码，再分别确认，建立信任并合并两份本地资料库。"
          ]
        },
        {
          "id": "sync-scope",
          "title": "同步范围与恢复",
          "body": [
            "同步正文、分句与时间轴、已有中文译文、语境收藏、注释、标签、阅读位置，以及相应修改和删除。媒体原件与设备偏好留在各自设备；Windows 与 Android 不支持本次 Apple 设备同步。",
            "首次合并前两端分别创建可恢复备份。离线修改在重新连接后补齐，iPhone 需保持前台；Mac 可选择关闭窗口后继续接收。睡眠或隔离访客网络会影响连接。",
            "需要时在设备同步中查看保留的其他编辑。移除设备会撤销信任，保留本地资料；可从设备管理恢复合并前备份。同步不能代替自己保存的备份。"
          ],
          "steps": []
        },
        {
          "id": "backup",
          "title": "资料：备份与词典",
          "body": [
            "“备份”提供导出、恢复与历史记录；“词典”显示本地朗文及音频可用状态，不可用时可重试。在线查词来源需要联网。"
          ],
          "steps": []
        },
        {
          "id": "dictionary",
          "title": "词典义项",
          "body": [
            "查词可保留当前词典结果的参考，它不代表已确认当前句子的含义。没有可用词条时，也能保存自己的解释。"
          ],
          "steps": []
        },
        {
          "id": "youtube",
          "title": "工具：字幕",
          "body": [
            "桌面提供浏览器会话偏好与依赖诊断；iPhone 使用公开英文字幕并提供清缓存。旧桌面会话偏好不会让 iPhone 获得登录态下载能力。"
          ],
          "steps": []
        },
        {
          "id": "updates",
          "title": "应用：软件更新",
          "body": [
            "打开“应用 → 软件更新”。Mac 可检查可用更新，本地安装的 iPhone 构建显示版本、安装方式和更新说明；这不代表已在 App Store 或公开提供 iPhone 版本。"
          ],
          "steps": []
        }
      ]
    },
    "faq": {
      "intro": "关于当前阅读、下载、联网与资料的说明。",
      "sections": [
        {
          "id": "installation",
          "title": "可以下载哪个版本？",
          "body": [
            "本次更新核对的最新公开版本为 2026 年 10 月 12 日发布的 v0.4.5，提供 macOS、Windows、Android 安装包；本文展示的当前 main 功能晚于该版本。尚无公开 iPhone 安装包。"
          ],
          "steps": [],
          "links": [
            [
              "release"
            ],
            [
              "installation"
            ]
          ]
        },
        {
          "id": "srt",
          "title": "可以用哪些材料？",
          "body": [
            "可导入英文文档、字幕、复制的正文或可访问网页。SRT、VTT 保留时间轴；PDF 需要可提取文字。受保护或无法读取的文件可能失败，请检查提取内容，必要时手动粘贴正文。"
          ],
          "steps": [],
          "related": [
            "files#import"
          ]
        },
        {
          "id": "offline",
          "title": "哪些操作可离线使用？",
          "body": [
            "本地材料、已保存语境、注释和可用本地词典可离线使用；网页与 YouTube 获取、在线查词、补译和联网朗读需要连接。同步两端各保留本地资料库，交换等待重新连接。"
          ],
          "steps": []
        },
        {
          "id": "review",
          "title": "旧复习与统计去了哪里？",
          "body": [
            "当前工作区以阅读和“已保存”为主，在重遇表达时回顾。原有旧记录仍可在“设置 → 备份 → 历史记录”查看与导出，没有被静默删除。"
          ],
          "steps": [],
          "related": [
            "review",
            "insights"
          ]
        },
        {
          "id": "backup",
          "title": "同步能替代备份吗？",
          "body": [
            "不能。同步会在配对的 Mac 与 iPhone 之间传递修改和删除，仍需自己保存导出备份。设备同步另外提供合并前恢复备份，移除设备保留本地资料并撤销信任。"
          ],
          "steps": [],
          "related": [
            "settings#device-sync",
            "settings#backup"
          ]
        }
      ]
    }
  },
  "ja": {
    "quick-start": {
      "intro": "自分の素材で英語を読む：取り込み、必要なときに調べ、文脈を保存して再会時に思い出します。",
      "sections": [
        {
          "id": "install",
          "title": "バージョンと導入",
          "body": [
            "このガイドは現在の main の説明です。公開版 v0.4.5（macOS・Windows・Android）には、このワークスペースと Mac–iPhone 同期は含まれません。今後のリリースまたはソースビルドを利用してください。iPhone はローカル署名で実機確認済みですが、公開パッケージはありません。"
          ],
          "steps": [],
          "links": [
            [
              "release"
            ],
            [
              "installation"
            ]
          ]
        },
        {
          "id": "first-file",
          "title": "素材を取り込んで開く",
          "body": [],
          "steps": [
            "「素材」から取り込みを開き、ファイル、英語の本文、WebページやYouTubeのリンクを指定します。",
            "抽出された本文を確認し、必要ならページや章を選んで確定します。素材カードから読み始めます。"
          ],
          "related": [
            "files"
          ]
        },
        {
          "id": "first-review",
          "title": "出会いを保存する",
          "body": [],
          "steps": [
            "分からない単語や表現を選び、意味を確認して元の文と一緒に保存します。必要ならメモを添えます。",
            "「保存済み」で記録を確認できます。後の読書で同じ表現が強調表示されたら、以前の文脈を開けます。"
          ],
          "related": [
            "reading",
            "vocabulary",
            "review"
          ]
        }
      ]
    },
    "files": {
      "intro": "英語の本文・文書・字幕を、読書ライブラリにまとめます。",
      "sections": [
        {
          "id": "import",
          "title": "対応する素材",
          "body": [
            "PDF、DOCX、EPUB、Markdown、TXT、SRT、VTTに対応。文字抽出できないスキャンPDF、暗号化ファイル、保護された書籍は取り込めない場合があります。保存前にプレビューを確認してください。",
            "同じ入口から英語の本文やWebリンクを貼り付けられます。抽出できないページは、表示された英文をコピーして取り込みます。学習対象は英語で、表示言語は別設定です。"
          ],
          "steps": []
        },
        {
          "id": "tags",
          "title": "デスク・ライブラリ・タグ",
          "body": [
            "今読む素材はデスクに置き、後で読むものはライブラリにしまいます。タイトル検索や色付きタグで探せます。タグを削除しても素材は残ります。"
          ],
          "steps": [],
          "image": "files"
        },
        {
          "id": "youtube",
          "title": "YouTube字幕",
          "body": [
            "YouTubeリンクを貼り、利用できる英語字幕を確認して取り込みます。動画と環境によって利用可否が異なります。iPhoneは公開英語字幕を利用し、デスクトップでは設定の字幕でブラウザセッションや診断を確認できます。"
          ],
          "steps": [],
          "related": [
            "settings#youtube"
          ]
        },
        {
          "id": "backup",
          "title": "バックアップ",
          "body": [
            "設定のバックアップから学習データを入出力します。復元の確認を読み、置き換え前に別のコピーを残してください。"
          ],
          "steps": [],
          "related": [
            "settings#backup"
          ]
        }
      ]
    },
    "reading": {
      "intro": "読書の位置を保ちながら英語を理解します。",
      "sections": [
        {
          "id": "lookup",
          "title": "単語と文章",
          "body": [],
          "steps": [
            "単語を選んで辞書を引くか、文章の一部を選んで文脈から理解します。利用可能な辞書を切り替え、必要なら自分の説明を書きます。",
            "デスクトップでは原文の横、小さい画面では下からパネルが開きます。閉じて読み続けられます。"
          ],
          "image": "reading",
          "related": [
            "settings#dictionary"
          ]
        },
        {
          "id": "analysis",
          "title": "中国語訳と聴読",
          "body": [
            "翻訳ボタンで中国語訳を切り替えます。既存の訳は残し、不足分はオンラインで取得できます。失敗しても英文を読み続け、後で再試行できます。",
            "聴読モードで読み進められます。元の音声があれば再生し、読み上げと速度調整も利用できます。通信・音声の有無・環境により制限があります。"
          ],
          "steps": []
        },
        {
          "id": "status",
          "title": "理解を保存する",
          "body": [
            "表現、元の文、利用可能な辞書の参照を保存し、この文に対する自分の説明やメモを添えます。現在は文脈の保存と再会が中心で、旧学習記録は履歴に残ります。"
          ],
          "steps": [],
          "related": [
            "vocabulary",
            "review"
          ]
        }
      ]
    },
    "vocabulary": {
      "intro": "「保存済み」は、表現、辞書の参照、出会った場所を一緒に保管します。",
      "sections": [
        {
          "id": "find",
          "title": "保存した表現を探す",
          "body": [
            "「保存済み」で表現を検索し、各文脈を開きます。同じ表現に複数の元の文を残せます。"
          ],
          "steps": [],
          "image": "vocabulary"
        },
        {
          "id": "organize",
          "title": "文脈を編集する",
          "body": [
            "該当する記録のメモや説明を編集します。必要な文脈だけを削除し、表示された取り消しで戻せます。同じ表現の別の文脈は独立しています。"
          ],
          "steps": []
        },
        {
          "id": "source",
          "title": "出典に戻る",
          "body": [
            "文脈の出典から元の素材と文を開き、前の位置へ戻れます。元の素材がない場合も、保存された文脈は読めます。"
          ],
          "steps": []
        }
      ]
    },
    "review": {
      "intro": "新しい出会いから、以前保存した文を思い出します。",
      "sections": [
        {
          "id": "session",
          "title": "保存済みの表現に再会する",
          "body": [
            "保存した表現が後の読書で一致すると強調されます。過去の記録で原文、訳、意味、メモを確認します。これは以前の文脈であり、新しい文の意味とは限りません。"
          ],
          "steps": [],
          "image": "review"
        },
        {
          "id": "ratings",
          "title": "続け方を選ぶ",
          "body": [
            "以前と今の用法を比べ、メモを直したり過去の出典へ戻ったりできます。現在の読書に期限付きカードや評価手順はなく、以前の復習記録は履歴に残ります。"
          ],
          "steps": [],
          "related": [
            "vocabulary",
            "insights"
          ]
        }
      ]
    },
    "insights": {
      "intro": "読書を再開し、以前の記録も残します。",
      "sections": [
        {
          "id": "files",
          "title": "読書位置",
          "body": [
            "素材の読書位置を保存し、デスクやライブラリから再開できます。同期された位置は次に素材を開くときに反映され、今読んでいるページは動きません。"
          ],
          "steps": []
        },
        {
          "id": "history",
          "title": "以前の学習履歴",
          "body": [
            "設定 → バックアップ → 履歴に以前の単語・フレーズ・復習記録を残し、閲覧・書き出しできます。新しい読書の保存文脈には自動で入りません。"
          ],
          "steps": [],
          "related": [
            "settings#backup"
          ]
        }
      ]
    },
    "settings": {
      "intro": "Mac と iPhone は4つの設定グループを共有し、操作は環境に応じて変わります。",
      "sections": [
        {
          "id": "language",
          "title": "表示と環境設定",
          "body": [
            "表示言語は英語・中国語・日本語・ドイツ語。学習対象は英語のままです。設定の最初の画面で5つのテーマを選び、文字サイズは読書画面で調整します。",
            "環境設定には、読み上げの設定と初回ガイドの再表示もあります。"
          ],
          "steps": [],
          "image": "settings"
        },
        {
          "id": "device-sync",
          "title": "Mac と iPhone をペアリング",
          "body": [],
          "steps": [
            "Mac 1台と iPhone 1台を互いに通信できるローカルネットワークに接続し、両方で設定のデバイス同期を開きます。ローカルネットワークと、iPhoneのカメラを許可します。",
            "Macの期限付きQRコードをiPhoneで読み、両方の端末名とコードを照合します。両方で確認すると信頼が確立され、2つのローカルライブラリを統合します。"
          ]
        },
        {
          "id": "sync-scope",
          "title": "同期範囲と復元",
          "body": [
            "本文、文分割と時刻、既存の中国語訳、保存文脈、メモ、タグ、読書位置とその編集・削除を交換します。元のメディアと端末設定は各端末に残り、Windows・Androidはこの同期に非対応です。",
            "初回統合前に両端末で復元用バックアップを作成します。オフライン編集は再接続後に交換し、iPhoneは前面で使います。Macはウィンドウを閉じた後も受信できます。スリープや分離ネットワークは接続を妨げます。",
            "必要ならデバイス同期で保管された別の編集を確認します。端末を削除すると信頼を取り消しますが、ローカルデータは残ります。端末管理から統合前バックアップを復元でき、同期は自分のバックアップの代わりにはなりません。"
          ],
          "steps": []
        },
        {
          "id": "backup",
          "title": "データ：バックアップと辞書",
          "body": [
            "バックアップから書き出し・復元・履歴へ進めます。辞書ではローカルLongmanと音声の状態を確認し、利用できないときに再試行できます。オンライン辞書には通信が必要です。"
          ],
          "steps": []
        },
        {
          "id": "dictionary",
          "title": "辞書の語義",
          "body": [
            "現在の辞書結果への参照を残せます。参照であり、この文の意味を確定するものではありません。辞書項目がなくても、自分の説明を保存できます。"
          ],
          "steps": []
        },
        {
          "id": "youtube",
          "title": "ツール：字幕",
          "body": [
            "デスクトップはブラウザセッションと依存ツール診断、iPhoneは公開英語字幕とキャッシュ削除を提供します。以前のデスクトップ設定でiPhoneが認証付き取得をできるわけではありません。"
          ],
          "steps": []
        },
        {
          "id": "updates",
          "title": "アプリ：ソフトウェア更新",
          "body": [
            "アプリのソフトウェア更新を開きます。Macは更新を確認でき、ローカル導入のiPhoneはバージョン・導入方法・更新案内を表示します。App Storeや一般公開を意味しません。"
          ],
          "steps": []
        }
      ]
    },
    "faq": {
      "intro": "現在の読書、ダウンロード、通信、データに関する説明です。",
      "sections": [
        {
          "id": "installation",
          "title": "どのバージョンを取得できますか？",
          "body": [
            "今回確認した公開最新版は2026年10月12日のv0.4.5で、macOS・Windows・Android向けです。ここに示すmainの機能は後の追加です。公開iPhoneインストーラーはありません。"
          ],
          "steps": [],
          "links": [
            [
              "release"
            ],
            [
              "installation"
            ]
          ]
        },
        {
          "id": "srt",
          "title": "どんな素材を使えますか？",
          "body": [
            "英文書・字幕・コピーした本文・取得可能なWebページを使えます。SRT/VTTは時刻を保持し、PDFには抽出できる文字が必要です。保護や読み取り不能な文書は失敗する場合があるため、内容を確認して必要なら本文を貼り付けます。"
          ],
          "steps": [],
          "related": [
            "files#import"
          ]
        },
        {
          "id": "offline",
          "title": "オフラインで何ができますか？",
          "body": [
            "ローカル素材・保存文脈・メモ・利用可能なローカル辞書はオフラインで使えます。Web/YouTube取得、オンライン検索、翻訳補完、通信する読み上げには接続が必要です。同期端末は各自ライブラリを持ち、再接続後に交換します。"
          ],
          "steps": []
        },
        {
          "id": "review",
          "title": "以前の復習と統計はどこへ？",
          "body": [
            "現在は読書と「保存済み」を中心に、表現との再会で振り返ります。既存の旧記録は設定 → バックアップ → 履歴から閲覧・書き出しでき、削除されていません。"
          ],
          "steps": [],
          "related": [
            "review",
            "insights"
          ]
        },
        {
          "id": "backup",
          "title": "同期はバックアップの代わりですか？",
          "body": [
            "いいえ。同期はペアのMacとiPhone間で編集も削除も伝えるため、自分の書き出しバックアップが必要です。統合前の復元用バックアップもあり、端末削除ではローカルデータを残して信頼を取り消します。"
          ],
          "steps": [],
          "related": [
            "settings#device-sync",
            "settings#backup"
          ]
        }
      ]
    }
  },
  "de": {
    "quick-start": {
      "intro": "Lies Englisch mit eigenen Materialien: importieren, bei Bedarf verstehen, Kontext speichern und beim Wiedersehen erinnern.",
      "sections": [
        {
          "id": "install",
          "title": "Version und Installation",
          "body": [
            "Dieses Handbuch beschreibt main. Die öffentlichen v0.4.5-Pakete für macOS, Windows und Android enthalten diesen Arbeitsplatz und die Mac–iPhone-Synchronisierung noch nicht. Nutze einen künftigen Release oder baue aus dem Quellcode. Das iPhone wurde lokal signiert geprüft; ein öffentlicher Installer fehlt."
          ],
          "steps": [],
          "links": [
            [
              "release"
            ],
            [
              "installation"
            ]
          ]
        },
        {
          "id": "first-file",
          "title": "Ein Material importieren und öffnen",
          "body": [],
          "steps": [
            "Öffne den Import unter Materialien. Wähle eine Datei oder füge englischen Text, einen Webseiten- oder YouTube-Link ein.",
            "Prüfe den extrahierten Text und gegebenenfalls die Seiten- oder Kapitelauswahl. Bestätige und öffne die Materialkarte."
          ],
          "related": [
            "files"
          ]
        },
        {
          "id": "first-review",
          "title": "Eine Begegnung speichern",
          "body": [],
          "steps": [
            "Wähle ein unbekanntes Wort oder eine Passage. Speichere die Bedeutung mit dem Originalsatz und bei Bedarf einer eigenen Notiz.",
            "Finde den Eintrag unter Gespeichert. Taucht der Ausdruck später im Lesen auf, öffnet die Hervorhebung frühere Kontexte."
          ],
          "related": [
            "reading",
            "vocabulary",
            "review"
          ]
        }
      ]
    },
    "files": {
      "intro": "Sammle englische Texte, Dokumente und Untertitel in einer Lesebibliothek.",
      "sections": [
        {
          "id": "import",
          "title": "Unterstützte Materialien",
          "body": [
            "Unterstützt werden PDF, DOCX, EPUB, Markdown, TXT, SRT und VTT. Gescannte PDFs ohne auslesbaren Text, verschlüsselte Dateien und geschützte Bücher lassen sich unter Umständen nicht importieren. Prüfe die Vorschau.",
            "Über denselben Import kannst du englischen Text oder einen Weblink einfügen. Scheitert die Extraktion, kopiere den sichtbaren englischen Text. Gelernt wird Englisch; die Oberflächensprache ist unabhängig."
          ],
          "steps": []
        },
        {
          "id": "tags",
          "title": "Lesetisch, Bibliothek und Tags",
          "body": [
            "Lass aktuelle Lektüre auf dem Lesetisch und lege andere Materialien in der Bibliothek ab. Suche nach Titel oder farbigen Tags. Das Entfernen eines Tags löscht die Materialien nicht."
          ],
          "steps": [],
          "image": "files"
        },
        {
          "id": "youtube",
          "title": "YouTube-Untertitel",
          "body": [
            "Füge einen YouTube-Link ein und prüfe die verfügbaren englischen Untertitel. Die Verfügbarkeit hängt von Video und Plattform ab. Das iPhone nutzt öffentliche englische Untertitel; Desktop-Einstellungen bieten Browser-Sitzungen und Werkzeugdiagnosen."
          ],
          "steps": [],
          "related": [
            "settings#youtube"
          ]
        },
        {
          "id": "backup",
          "title": "Sicherungen",
          "body": [
            "Exportiere oder stelle Lerndaten unter Einstellungen → Sicherung wieder her. Lies die Bestätigung und behalte vor dem Ersetzen eine unabhängige Kopie."
          ],
          "steps": [],
          "related": [
            "settings#backup"
          ]
        }
      ]
    },
    "reading": {
      "intro": "Verstehe Englisch, ohne deine Lesestelle zu verlieren.",
      "sections": [
        {
          "id": "lookup",
          "title": "Wörter und Passagen",
          "body": [],
          "steps": [
            "Wähle ein Wort für die Wörterbuchsuche oder eine Passage zum Verstehen im Kontext. Wechsle verfügbare Wörterbuchquellen und ergänze bei Bedarf deine eigene Erklärung.",
            "Auf dem Desktop öffnet sich die Suche neben dem Text, auf kleinen Bildschirmen von unten. Schließe sie zum Weiterlesen."
          ],
          "image": "reading",
          "related": [
            "settings#dictionary"
          ]
        },
        {
          "id": "analysis",
          "title": "Chinesische Übersetzung und Hörmodus",
          "body": [
            "Blende chinesischen Text mit der Übersetzungssteuerung ein oder aus. Vorhandene Übersetzungen bleiben erhalten; fehlende lassen sich online abrufen. Bei Fehlern kannst du Englisch weiterlesen und später erneut versuchen.",
            "Starte den Hörmodus, verwende verfügbares Quellaudio oder Sprachausgabe und passe das Tempo an. Netzwerk, verfügbare Medien und Plattform bestimmen die Möglichkeiten."
          ],
          "steps": []
        },
        {
          "id": "status",
          "title": "Verständnis speichern",
          "body": [
            "Speichere Ausdruck, Originalsatz und verfügbare Wörterbuchreferenz mit eigener Erklärung oder Notiz für den Satz. Der aktuelle Arbeitsplatz setzt auf Kontexte und Wiederbegegnungen; frühere Lernaufzeichnungen bleiben im Verlauf."
          ],
          "steps": [],
          "related": [
            "vocabulary",
            "review"
          ]
        }
      ]
    },
    "vocabulary": {
      "intro": "Gespeichert verbindet Ausdrücke und Wörterbuchreferenzen mit ihren Fundstellen.",
      "sections": [
        {
          "id": "find",
          "title": "Einen gespeicherten Ausdruck finden",
          "body": [
            "Öffne Gespeichert und suche einen Ausdruck. Öffne die einzelnen Kontexte; ein Ausdruck kann mehrere Originalsätze behalten."
          ],
          "steps": [],
          "image": "vocabulary"
        },
        {
          "id": "organize",
          "title": "Einen Kontext bearbeiten",
          "body": [
            "Bearbeite Notiz oder Erklärung des betreffenden Eintrags. Entferne bei Bedarf nur diesen Kontext und nutze, falls angeboten, Rückgängig. Andere Kontexte desselben Ausdrucks bleiben getrennt."
          ],
          "steps": []
        },
        {
          "id": "source",
          "title": "Zur Quelle zurückkehren",
          "body": [
            "Öffne über die Quelle das ursprüngliche Material und den Satz und kehre danach zurück. Fehlt die Quelle oder wurde sie gelöscht, bleibt der gespeicherte Kontext lesbar."
          ],
          "steps": []
        }
      ]
    },
    "review": {
      "intro": "Eine neue Begegnung bringt frühere Originalsätze zurück.",
      "sections": [
        {
          "id": "session",
          "title": "Einen gespeicherten Ausdruck wiedererkennen",
          "body": [
            "Gespeicherte Ausdrücke werden bei passenden späteren Fundstellen hervorgehoben. Öffne frühere Sätze, Übersetzungen, Bedeutungen und Notizen. Es sind frühere Kontexte, keine Erklärung des neuen Satzes."
          ],
          "steps": [],
          "image": "review"
        },
        {
          "id": "ratings",
          "title": "Selbst entscheiden, wie es weitergeht",
          "body": [
            "Vergleiche die frühere und heutige Verwendung, ändere deine Notiz oder öffne die alte Quelle. Der aktuelle Lesefluss hat keine fälligen Karten oder Bewertungen. Frühere Wiederholungsaufzeichnungen bleiben im Verlauf."
          ],
          "steps": [],
          "related": [
            "vocabulary",
            "insights"
          ]
        }
      ]
    },
    "insights": {
      "intro": "Lies weiter und behalte frühere Aufzeichnungen.",
      "sections": [
        {
          "id": "files",
          "title": "Leseposition",
          "body": [
            "Die App speichert die Leseposition. Öffne das Material vom Lesetisch oder aus der Bibliothek erneut. Synchronisierte Positionen gelten beim nächsten Öffnen und verschieben keine gerade gelesene Seite."
          ],
          "steps": []
        },
        {
          "id": "history",
          "title": "Früherer Lernverlauf",
          "body": [
            "Einstellungen → Sicherung → Verlauf bewahrt frühere Wörter, Wendungen und Wiederholungen zum Ansehen und Exportieren. Sie werden nicht automatisch aktive gespeicherte Kontexte."
          ],
          "steps": [],
          "related": [
            "settings#backup"
          ]
        }
      ]
    },
    "settings": {
      "intro": "Mac und iPhone teilen vier Einstellungsgruppen; einzelne Aktionen richten sich nach der Plattform.",
      "sections": [
        {
          "id": "language",
          "title": "Darstellung und Einstellungen",
          "body": [
            "Wähle Englisch, Chinesisch, Japanisch oder Deutsch als Oberflächensprache. Gelernt wird Englisch. Fünf Themen stehen auf der Einstellungsstartseite; Schriftgrößen stellst du beim Lesen ein.",
            "Die Einstellungsgruppe enthält außerdem Sprachausgabe und das erneute Öffnen der Einführung."
          ],
          "steps": [],
          "image": "settings"
        },
        {
          "id": "device-sync",
          "title": "Mac und iPhone koppeln",
          "body": [],
          "steps": [
            "Verbinde einen Mac und ein iPhone mit einem gegenseitig erreichbaren lokalen Netzwerk und öffne auf beiden die Gerätesynchronisierung. Erlaube den lokalen Netzwerkzugriff und am iPhone die Kamera.",
            "Zeige den zeitlich begrenzten QR-Code am Mac und scanne ihn am iPhone. Vergleiche Gerätenamen und Code auf beiden und bestätige dort jeweils. So werden die lokalen Bibliotheken zusammengeführt."
          ]
        },
        {
          "id": "sync-scope",
          "title": "Synchronisierung und Wiederherstellung",
          "body": [
            "Synchronisiert werden Texte, Satzzeiten, vorhandene chinesische Übersetzungen, Kontexte, Notizen, Tags und Lesepositionen samt Änderungen und Löschungen. Originalmedien und Geräteeinstellungen bleiben vor Ort. Windows und Android unterstützen diese Apple-Synchronisierung nicht.",
            "Vor der ersten Zusammenführung erstellen beide Seiten eine wiederherstellbare Sicherung. Offline-Änderungen folgen nach Wiederverbindung; das iPhone muss im Vordergrund bleiben. Der Mac kann nach Schließen des Fensters weiter empfangen. Schlafmodus oder getrennte Gastnetze können Verbindungen unterbrechen.",
            "Prüfe bei Bedarf erhaltene alternative Bearbeitungen in der Gerätesynchronisierung. Das Entfernen eines Geräts widerruft Vertrauen und behält lokale Daten. Gerätemanagement bietet Sicherungen vor der Zusammenführung; Synchronisierung ersetzt keine eigene Sicherung."
          ],
          "steps": []
        },
        {
          "id": "backup",
          "title": "Daten: Sicherung und Wörterbuch",
          "body": [
            "Sicherung bietet Export, Wiederherstellung und Verlauf. Wörterbuch zeigt die Verfügbarkeit von lokalem Longman und Audio. Bei Fehlern kannst du erneut versuchen. Online-Quellen benötigen Internet."
          ],
          "steps": []
        },
        {
          "id": "dictionary",
          "title": "Wörterbuchbedeutungen",
          "body": [
            "Die Suche kann eine Referenz zum aktuellen Wörterbuchergebnis behalten. Diese bestätigt keine Satzbedeutung. Auch ohne Eintrag kannst du deine eigene Erklärung speichern."
          ],
          "steps": []
        },
        {
          "id": "youtube",
          "title": "Werkzeuge: Untertitel",
          "body": [
            "Desktop bietet Browser-Sitzungen und Abhängigkeitsdiagnosen. Das iPhone nutzt öffentliche englische Spuren und kann den Untertitelcache leeren. Alte Desktop-Einstellungen ermöglichen keine authentifizierten iPhone-Downloads."
          ],
          "steps": []
        },
        {
          "id": "updates",
          "title": "App: Software-Updates",
          "body": [
            "Öffne App → Software-Updates. Der Mac kann Updates prüfen; ein lokal installiertes iPhone zeigt Version, Installationsart und Hinweise. Dies bedeutet keine App-Store- oder öffentliche iPhone-Verteilung."
          ],
          "steps": []
        }
      ]
    },
    "faq": {
      "intro": "Antworten zum aktuellen Lesen, zu Downloads, Verbindungen und Daten.",
      "sections": [
        {
          "id": "installation",
          "title": "Welche Version kann ich herunterladen?",
          "body": [
            "Der für diese Aktualisierung geprüfte öffentliche Release ist v0.4.5 vom 12. Oktober 2026 mit Paketen für macOS, Windows und Android. Die gezeigten main-Funktionen kamen später. Ein öffentlicher iPhone-Installer fehlt."
          ],
          "steps": [],
          "links": [
            [
              "release"
            ],
            [
              "installation"
            ]
          ]
        },
        {
          "id": "srt",
          "title": "Welche Materialien kann ich nutzen?",
          "body": [
            "Nutze englische Dokumente, Untertitel, kopierten Text oder zugängliche Webseiten. SRT/VTT behalten Zeitangaben. PDFs benötigen auslesbaren Text. Geschützte oder unlesbare Dokumente können scheitern; prüfe den Text und füge ihn bei Bedarf manuell ein."
          ],
          "steps": [],
          "related": [
            "files#import"
          ]
        },
        {
          "id": "offline",
          "title": "Was funktioniert offline?",
          "body": [
            "Lokale Materialien, gespeicherte Kontexte, Notizen und verfügbare lokale Wörterbücher funktionieren offline. Webseiten/YouTube, Online-Suche, fehlende Übersetzungen und Netzwerk-Sprachausgabe benötigen Verbindung. Beide Geräte behalten ihre Bibliothek; der Austausch wartet auf Wiederverbindung."
          ],
          "steps": []
        },
        {
          "id": "review",
          "title": "Wo sind frühere Wiederholungen und Statistiken?",
          "body": [
            "Der aktuelle Arbeitsplatz konzentriert sich auf Lesen und Gespeichert mit Erinnerung beim Wiedersehen. Vorhandene ältere Daten bleiben unter Einstellungen → Sicherung → Verlauf zum Ansehen und Exportieren erhalten."
          ],
          "steps": [],
          "related": [
            "review",
            "insights"
          ]
        },
        {
          "id": "backup",
          "title": "Ersetzt Synchronisierung eine Sicherung?",
          "body": [
            "Nein. Synchronisierung überträgt Änderungen und Löschungen zwischen Mac und iPhone. Behalte eigene exportierte Sicherungen. Zusätzlich gibt es Sicherungen vor der Zusammenführung. Das Entfernen eines Geräts behält lokale Daten und widerruft Vertrauen."
          ],
          "steps": [],
          "related": [
            "settings#device-sync",
            "settings#backup"
          ]
        }
      ]
    }
  }
};
export const manualLabels={
  "en": {
    "menu": "Navigation",
    "toc": "On this page",
    "enlarge": "Enlarge screenshot",
    "close": "Close image",
    "screenshot": "Product interface · sample data",
    "related": "See also",
    "groups": [
      "Getting started",
      "Learning and organizing",
      "Configuration and help"
    ]
  },
  "zh": {
    "menu": "导航菜单",
    "toc": "本页目录",
    "enlarge": "放大截图",
    "close": "关闭图片",
    "screenshot": "产品界面 · 样例数据",
    "related": "相关操作",
    "groups": [
      "开始使用",
      "学习与整理",
      "配置与帮助"
    ]
  },
  "ja": {
    "menu": "ナビゲーション",
    "toc": "このページの目次",
    "enlarge": "画面を拡大",
    "close": "画像を閉じる",
    "screenshot": "製品画面 · サンプルデータ",
    "related": "関連する操作",
    "groups": [
      "はじめに",
      "学習と整理",
      "設定とヘルプ"
    ]
  },
  "de": {
    "menu": "Navigation",
    "toc": "Auf dieser Seite",
    "enlarge": "Screenshot vergrößern",
    "close": "Bild schließen",
    "screenshot": "Produktoberfläche · Beispieldaten",
    "related": "Siehe auch",
    "groups": [
      "Einstieg",
      "Lernen und ordnen",
      "Konfiguration und Hilfe"
    ]
  }
};
