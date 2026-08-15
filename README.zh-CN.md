# LexiCue

**把你正在读的内容，变成真正记得住的词汇。**

LexiCue 是一款免费、开源、本地优先的阅读学习工具。导入一篇文章、一本书或影视字幕——读到不懂的单词随手点一下就有释义，再用智能复习把它们真正记下来。

> [English Version](README.md) · 日本語版（[README.ja.md](README.ja.md)）

## LexiCue 适合你吗？

- 你在学**英语、日语、德语或中文**
- 你更喜欢从**真实内容**里学——文章、书、字幕——而不是背词表
- 你看剧、看电影时想顺便学会出现过的单词
- 你在意**隐私**，不想注册账号、不想上传数据
- 你想要一个**免费、开源**、**离线可用**的工具

以上只要有一条符合，LexiCue 就是为你做的。犹豫不决的话，试试就知道——无需安装、无需账号，不会有什么损失。

## 怎么用

1. **导入** — 放入 `.txt` / `.srt` / `.vtt` 文件，或直接抓取 YouTube 字幕
2. **阅读** — 逐句阅读，点一下单词就能看到释义和读音
3. **积累** — 生词和常用搭配自动收进你的词库
4. **复习** — LexiCue 在合适的时候轻轻提醒你，每天几分钟

## 功能一览

- **学你真正喜欢的内容** — 自己的文章、书、字幕，而不是预设词表
- **点词即查** — 释义、读音、例句一步到位，不打断阅读
- **智能复习** — 间隔重复，赶在你忘记之前提醒
- **内置离线词典** — 英、日、德、中四种语言，断网也能查
- **数据留在你的电脑上** — 所有记录保存在本机，无需账号、默认不联网
- **AI 可选** — 需要段落解释或翻译时再打开，默认关闭

## 隐私

所有学习数据都保存在你设备上的本地数据库里。除非你主动操作（比如开启 AI、下载 YouTube 字幕），否则不会有任何内容上传。

## 下载与安装

从 [Releases 页面](https://github.com/skylar-deepmind/LexiCue/releases/latest) 下载 **macOS / Windows / Android** 安装包。

> 安装包目前为**未签名**构建，首次安装系统可能给出安全提示，属于正常现象。各平台处理方法见 [DISTRIBUTION.md](DISTRIBUTION.md)。

## 支持这个项目

LexiCue 免费且开源。如果它对你有所帮助，欢迎在**爱发电**上支持作者：

👉 [https://www.ifdian.net/a/skylar-lexicue](https://www.ifdian.net/a/skylar-lexicue)

在 GitHub 上点个 Star 也是莫大的鼓励：[github.com/skylar-deepmind/LexiCue](https://github.com/skylar-deepmind/LexiCue)

## 开发

面向贡献者。需要 Node.js 20+ 与 Rust 1.77.2+。

```bash
npm install        # 安装前端依赖
npm run tauri dev  # 以桌面应用方式运行
npm run build      # 类型检查 + 前端构建
npm test           # 前端测试
cd src-tauri && cargo test   # Rust 测试
```

打包安装包：`npm run tauri build`（产物在 `src-tauri/target/release/bundle/`）。

## 许可证

MIT License，见 [LICENSE](LICENSE)。内置词典数据的第三方授权声明见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。自定义词典包格式见 [DICTIONARY_PACK.md](DICTIONARY_PACK.md)。
