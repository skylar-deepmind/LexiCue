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
            "Use the file button to choose a document, or the clipboard button for copied English text or a link.",
            "Check the extracted text and range, then choose one tag or leave it untagged and confirm. Click the card image to read."
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
            "Use the clipboard button for English text, webpage links or YouTube links. Empty content shows a notice near the top; recognition uses a full-page loading state and then a preview before confirmation. The separate file button opens the system picker directly."
          ],
          "steps": []
        },
        {
          "id": "tags",
          "title": "Desk, library and tags",
          "body": [
            "Click a material’s image to resume reading. Click its tag to choose one category from the strip above the card; imports use the same strip. In the library, category artwork opens the poster wall; hold its caption to rename it in place. Its cover combines the materials inside; hold the cover and drag it to the basket to remove just the category, keeping its materials. Older multi-tag records stay intact until you explicitly choose a category.",
            "To delete a material, hold its card, drag it over the trash basket and release when the lid opens. Release elsewhere to cancel. Saved sentences, meanings and notes remain available; a deleted source can no longer be opened."
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
            "Edit your personal explanation on the relevant context. Search Saved by expression or narrow it with the date chart, then browse the expression’s contexts.",
            "To remove one saved sentence, hold the sentence and drag it to the trash basket. Release when the lid opens; release elsewhere to cancel. Undo restores that context. Other contexts and the original material remain. You can also hold and then tap the basket, or focus the sentence and press Delete followed by Enter; Escape cancels."
          ],
          "steps": []
        },
        {
          "id": "source",
          "title": "Return to the source",
          "body": [
            "Open a context’s source to read the matching sentence. The icon-only back button restores the prior page, search, page number, scroll position and expanded contexts. A missing or deleted source cannot be opened; its saved context remains available."
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
            "Choose English, Chinese, Japanese or German directly in Preferences; English remains the learning language. Pick ocean, sage, amber, twilight or midnight on the settings home.",
            "The Preferences group also contains speech and dictionary preferences."
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
            "Backup offers export, restore and History. Dictionary includes Wiktionary Everyday & General (60.69 MB of dictionary data), with optional Extended Reading and Specialist Reference packs. Install a verified pack file or remove an optional pack here; saved references remain available. Direct downloads appear when package hosting is published. Online lookup sources may require internet."
          ],
          "steps": []
        },
        {
          "id": "dictionary",
          "title": "Dictionary meanings",
          "body": [
            "Lookup can retain a reference to the current dictionary result. It is a reference, not a confirmed sentence meaning. You can save your own explanation even when no dictionary entry is available.",
            "Lookup starts locally. Tap Online to query the selected service; results never switch sources for you. Settings → Online dictionary offers English–Chinese (Cambridge author public API, unofficial) or English-only (FreeDictionaryAPI.com / Wiktionary). Tap Local to return to an available local result.",
            "Pronunciation shows loading feedback and animated sound waves while playing. Tap again to restart immediately."
          ],
          "steps": []
        },
        {
          "id": "youtube",
          "title": "Tools: subtitles",
          "body": [
            "Desktop uses system-installed yt-dlp, not a bundled copy. Settings → Tools → YouTube subtitles shows missing tools even when browser sessions are off. Open Install and diagnose for official instructions, copy the install command where offered, then check again. iPhone uses public English subtitles without installing yt-dlp."
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
            "使用文件按钮选择文档，或使用剪贴板按钮识别复制的英文正文或链接。",
            "核对提取内容和范围，选择一个标签或保留未打标签，再确认导入。点击卡片的图片进入阅读。"
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
            "剪贴板按钮识别英文正文、网页或 YouTube 链接；空内容在中上方提示，识别时显示整页加载状态，完成后核对预览并确认。独立的文件按钮直接打开系统文件管理。"
          ],
          "steps": []
        },
        {
          "id": "tags",
          "title": "桌面、材料库与标签",
          "body": [
            "点击材料图片接着上次位置阅读；点击现有标签，在卡片上方选择一个分类，导入时也使用同样的标签条。材料库中，点击分类图片进入海报墙，长按下方文字原地改名；封面由分类内材料拼成，长按封面下拖到纸篓可移除分类，材料保留；旧资料的多个标签保留到明确选择分类时才改变。",
            "长按材料卡片，拖到垃圾篓，盖子打开后松手即删除；在其他位置松手则取消。已保存的原句、释义和笔记仍保留，但无法再打开已删除的来源。"
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
            "点击个人解释，在原处直接编辑并保存。可搜索表达或用日期图缩小范围，再翻阅同一表达的各条语境。",
            "长按原句并拖到垃圾篓，盖子打开后松手即可移除这一句；在其他位置松手则取消。“撤销”可恢复这条语境，其他语境和原材料仍保留。也可长按后点击垃圾篓；键盘聚焦原句后，按 Delete 再按 Enter 确认，Esc 取消。"
          ],
          "steps": []
        },
        {
          "id": "source",
          "title": "返回来源",
          "body": [
            "点击语境的来源打开原材料和对应句子。使用纯图标返回按钮回到此前页面，保留搜索、页码、滚动位置和展开例句。来源缺失或已删除时无法打开，已保存的语境仍可查看。"
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
            "在“偏好”中直接切换英语、中文、日语或德语，学习目标仍为英语。设置首页可选海湾蓝、鼠尾草绿、琥珀暖光、暮光紫、深夜墨色。",
            "“偏好”组还包含朗读与词典设置。"
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
            "“备份”提供导出、恢复与历史记录；“词典”内置 Wiktionary「日常通识」（词典数据 60.69 MB），并提供可选的「进阶阅读」「专业参考」包。可从文件安装或移除扩展包，已保存的词典参考仍保留。词典包公开发布后提供直接下载。在线查词来源需要联网。"
          ],
          "steps": []
        },
        {
          "id": "dictionary",
          "title": "词典义项",
          "body": [
            "查词可保留当前词典结果的参考，它不代表已确认当前句子的含义。没有可用词条时，也能保存自己的解释。",
            "查词先显示本地；点击“在线”才请求所选服务，结果返回不会替你切换来源。“设置 → 在线词典”可选英汉释义（剑桥作者公共接口，非官方）或英英释义（FreeDictionaryAPI.com / Wiktionary）。本地有结果时，点击“本地”即可返回。",
            "读音按钮在加载时显示进度，播放时声量图标动态变化；再次点击会立即从头播放。"
          ],
          "steps": []
        },
        {
          "id": "youtube",
          "title": "工具：字幕",
          "body": [
            "桌面使用系统安装的 yt-dlp，应用不内置该工具。“设置 → 工具 → YouTube 字幕”会提示缺失的工具，不需要先开启浏览器会话。打开“安装与诊断”查看官方说明、复制可用的安装命令，完成后点“重新检测”。iPhone 使用公开英文字幕，无需安装 yt-dlp。"
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
            "ファイルボタンで文書を選ぶか、クリップボードボタンでコピーした英語やリンクを読み込みます。",
            "抽出した内容と範囲を確認し、タグを1つ選ぶか未分類のまま取り込みます。カードの画像を押すと読書を再開できます。"
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
            "クリップボードは英語の本文、Webページ、YouTubeリンクを読み込みます。空の場合は画面上部に通知し、解析中は画面全体に進行状態を表示します。プレビューを確認して取り込みます。別のファイルボタンはシステムのファイル選択を直接開きます。"
          ],
          "steps": []
        },
        {
          "id": "tags",
          "title": "デスク・ライブラリ・タグ",
          "body": [
            "資料の画像で前回の位置から読み、タグを押すとカード上の選択欄で分類を1つ選べます。取り込み時も同じ選択欄を使います。ライブラリの分類画像でポスター一覧を開き、その下の文字を長押しするとその場で名前を変更できます。表紙は分類内の素材を組み合わせます。表紙を長押ししてごみ箱へ下にドラッグすると分類だけを削除し、素材は残ります。既存の複数タグは分類を明示的に選ぶまで保持します。",
            "素材のカードを長押ししてごみ箱へドラッグし、ふたが開いたら離すと削除します。それ以外の場所で離すとキャンセルします。保存した文・意味・メモは残りますが、削除した出典は開けなくなります。"
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
            "該当する文脈の個人説明を編集できます。表現の検索や日付グラフで絞り込み、同じ表現の各文脈を確認します。",
            "原文を長押ししてごみ箱へドラッグし、ふたが開いたら離すと、その1文を削除します。それ以外の場所で離すとキャンセルします。「取り消し」で復元でき、他の文脈と元の素材は残ります。長押し後にごみ箱をタップする方法もあります。キーボードでは文にフォーカスしてDelete、Enterで確定、Escapeでキャンセルします。"
          ],
          "steps": []
        },
        {
          "id": "source",
          "title": "出典に戻る",
          "body": [
            "文脈の出典を開くと、元の素材の該当文へ移動します。アイコンのみの戻るボタンで、前の画面の検索、ページ、スクロール位置と展開した例文を復元します。出典が見つからない場合や削除済みの場合も、保存した文脈は閲覧できます。"
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
            "環境設定で英語・中国語・日本語・ドイツ語を直接切り替えます。学習対象は英語のままです。設定の最初の画面で5つのテーマを選べます。",
            "環境設定には、読み上げと辞書の設定もあります。"
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
            "バックアップから書き出し・復元・履歴へ進めます。辞書にはWiktionaryの日常・一般知識（辞書データ60.69 MB）を内蔵し、発展的な読書・専門用語パックを追加できます。検証済みファイルからインストール、または追加パックを削除できます。保存済みの辞書参考は残ります。パックの公開後に直接ダウンロードが利用できます。オンライン辞書には通信が必要です。"
          ],
          "steps": []
        },
        {
          "id": "dictionary",
          "title": "辞書の語義",
          "body": [
            "現在の辞書結果への参照を残せます。参照であり、この文の意味を確定するものではありません。辞書項目がなくても、自分の説明を保存できます。",
            "最初はローカル辞書を表示します。「オンライン」を押した時だけ選択したサービスを照会し、結果が届いても表示元を自動変更しません。「設定 → オンライン辞書」で英中（Cambridge作者の非公式公開API）または英英（FreeDictionaryAPI.com / Wiktionary）を選べます。ローカル結果があれば「ローカル」で戻れます。",
            "発音ボタンは読み込み中と再生中を表示します。もう一度押すとすぐ最初から再生します。"
          ],
          "steps": []
        },
        {
          "id": "youtube",
          "title": "ツール：字幕",
          "body": [
            "デスクトップ版はシステムの yt-dlp を使用し、同梱していません。「設定 → ツール → YouTube 字幕」ではブラウザセッションを有効にせず不足ツールを確認できます。「インストールと診断」の公式手順やコマンドを利用し、完了後に再確認してください。iPhone は公開英語字幕を使用し、yt-dlp のインストールは不要です。"
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
            "Ein Dokument über die Datei-Schaltfläche wählen oder kopierten englischen Text bzw. einen Link über die Zwischenablage erkennen lassen.",
            "Inhalt und Bereich prüfen, ein Tag wählen oder ohne Tag bestätigen. Das Kartenbild öffnet den Lesetext."
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
            "Die Zwischenablage erkennt englischen Text, Webseiten- und YouTube-Links. Bei leerem Inhalt erscheint oben ein Hinweis; während der Erkennung zeigt die ganze Seite den Ladezustand. Danach die Vorschau prüfen und bestätigen. Die separate Datei-Schaltfläche öffnet direkt die Systemauswahl."
          ],
          "steps": []
        },
        {
          "id": "tags",
          "title": "Lesetisch, Bibliothek und Tags",
          "body": [
            "Das Materialbild setzt das Lesen fort. Ein Klick auf den Tag zeigt die Kategorien über der Karte; beim Import erscheint dieselbe Auswahl. In der Bibliothek öffnet das Kategorienbild die Posterwand. Halte die Beschriftung darunter gedrückt, um sie direkt umzubenennen. Das Cover kombiniert die enthaltenen Materialien. Halte es gedrückt und ziehe es zum Papierkorb, um nur die Kategorie zu löschen; die Materialien bleiben erhalten. Bestehende Mehrfach-Tags bleiben erhalten, bis du ausdrücklich eine Kategorie wählst.",
            "Halte eine Materialkarte gedrückt, ziehe sie zum Papierkorb und lasse los, sobald sich der Deckel öffnet. Loslassen an anderer Stelle bricht ab. Gespeicherte Sätze, Bedeutungen und Notizen bleiben erhalten; die gelöschte Quelle lässt sich nicht mehr öffnen."
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
            "Bearbeite die persönliche Erklärung direkt im jeweiligen Kontext. Suche nach Ausdrücken oder grenze sie über das Datumsdiagramm ein und blättere durch ihre Kontexte.",
            "Halte einen Satz gedrückt und ziehe ihn zum Papierkorb. Lasse bei geöffnetem Deckel los, um nur diesen Kontext zu entfernen; an anderer Stelle wird abgebrochen. Rückgängig stellt ihn wieder her. Andere Kontexte und das Originalmaterial bleiben erhalten. Alternativ kannst du nach dem Gedrückthalten den Papierkorb antippen. Per Tastatur: Satz fokussieren, Delete und dann Enter; Escape bricht ab."
          ],
          "steps": []
        },
        {
          "id": "source",
          "title": "Zur Quelle zurückkehren",
          "body": [
            "Öffne die Quelle eines Kontexts an der passenden Textstelle. Die Zurück-Schaltfläche mit Pfeilsymbol stellt die vorige Seite samt Suche, Seitenzahl, Scrollposition und ausgeklappten Kontexten wieder her. Fehlende oder gelöschte Quellen lassen sich nicht öffnen; der gespeicherte Kontext bleibt lesbar."
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
            "Wähle Englisch, Chinesisch, Japanisch oder Deutsch direkt in den Einstellungen. Gelernt wird Englisch. Fünf Themen stehen auf der Einstellungsstartseite.",
            "Die Einstellungsgruppe enthält außerdem Sprachausgabe und Wörterbuchoptionen."
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
            "Sicherung bietet Export, Wiederherstellung und Verlauf. Das Wörterbuch enthält Wiktionary Alltag & Allgemeinwissen (60,69 MB Wörterbuchdaten). Zusätzliche Lektüre- und Fachpakete lassen sich aus einer geprüften Datei installieren oder entfernen; gespeicherte Referenzen bleiben erhalten. Direkte Downloads stehen nach Veröffentlichung der Pakete bereit. Online-Quellen benötigen Internet."
          ],
          "steps": []
        },
        {
          "id": "dictionary",
          "title": "Wörterbuchbedeutungen",
          "body": [
            "Die Suche kann eine Referenz zum aktuellen Wörterbuchergebnis behalten. Diese bestätigt keine Satzbedeutung. Auch ohne Eintrag kannst du deine eigene Erklärung speichern.",
            "Die Suche beginnt lokal. Online fragt erst nach Antippen den gewählten Dienst ab; eintreffende Ergebnisse ändern die Auswahl nicht. Einstellungen → Online-Wörterbuch bietet Englisch–Chinesisch (inoffizielle öffentliche Cambridge-API) oder Englisch–Englisch (FreeDictionaryAPI.com / Wiktionary). Mit Lokal kehrst du zu einem verfügbaren lokalen Ergebnis zurück.",
            "Die Aussprache zeigt Laden und animierte Schallwellen während der Wiedergabe. Erneutes Antippen startet sofort von vorn."
          ],
          "steps": []
        },
        {
          "id": "youtube",
          "title": "Werkzeuge: Untertitel",
          "body": [
            "Die Desktop-App nutzt das systemweit installierte yt-dlp, keine mitgelieferte Kopie. Einstellungen → Werkzeuge → YouTube-Untertitel zeigt fehlende Werkzeuge auch ohne Browsersitzung. Unter Installation und Diagnose stehen offizielle Anleitungen und gegebenenfalls ein kopierbarer Installationsbefehl; danach erneut prüfen. Auf dem iPhone sind für öffentliche englische Untertitel keine yt-dlp-Installationen nötig."
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
