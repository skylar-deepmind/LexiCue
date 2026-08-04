# LexiCue

Local-first 词汇学习与阅读工具。通过阅读自己导入的文本，自动识别生词、词组与短语，并配合间隔重复复习（FSRS）巩固记忆。

支持英语、日语、德语、中文四种学习语言，内置对应语言的离线词典数据。

> 当前以源码形式发布，尚未提供预编译安装包。

## 功能

- **文本导入**：支持 `.txt` / `.srt` / `.vtt` 等文本格式，从 YouTube 字幕导入（需本机安装 [yt-dlp](https://github.com/yt-dlp/yt-dlp)）
- **阅读辅助**：逐句阅读、点击查词、逐段对照译文
- **词汇提取**：自动分词并标注原形（德语 `ging → gehen`）、读音（日语假名、中文拼音）与词性
- **词组识别**：内置常用词组词典，自动识别固定搭配与短语
- **间隔重复**：基于 [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) 的 FSRS 算法安排单词与词组复习
- **数据统计**：学习进度、复习量、掌握情况一目了然
- **多语言界面**：中文、English、日本語、Deutsch
- **暗色模式**
- **内置离线词典**：ECDICT、CC-CEDICT、JMdict、德语 Wiktionary 派生数据等（详见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)）
- **可选 AI 辅助**：段落解释、词组自动识别（默认关闭，详见下文）

## 支持的语言

| 语言 | 词典 | 分词/形变 |
| ---- | ---- | ---- |
| 英语 English | ECDICT、PhraseDict | 正则分词、词组识别 |
| 日语 日本語 | JMdict | lindera（嵌入式 UniDic） |
| 德语 Deutsch | kaikki.org 派生数据 | 词形还原（词频过滤） |
| 中文 中文 | CC-CEDICT | jieba 分词、拼音标注 |

## 环境要求

- Node.js 20+
- Rust 1.77.2+
- 平台支持：macOS / Windows / Linux

## 开发

```bash
# 安装前端依赖
npm install

# 启动前端开发服务器（http://localhost:5173）
npm run dev

# 以桌面应用方式运行（Tauri）
npm run tauri dev

# 类型检查 + 前端构建
npm run build

# 运行前端测试
npm test

# 运行 Rust 测试
cd src-tauri && cargo test
```

## 打包桌面应用

```bash
npm run tauri build
```

生成物位于 `src-tauri/target/release/bundle/`。当前仓库不提供 GitHub Actions 自动构建发布流程，如需自动构建可参考 `tauri.conf.json` 自行配置。

## AI 辅助功能（可选）

AI 相关功能默认关闭，可在「设置 → AI 分析」中启用。支持两种提供方：

- **本地 Ollama**（推荐）：连接 `http://localhost:11434`，学习文本不会离开你的电脑
- **云端 API**：使用 OpenAI 兼容接口（如 OpenAI、DeepSeek、自定义地址），需要填入自己的 API Key

启用后可用：段落解释、词组自动识别、段落翻译。

> 注意：使用云端 API 时，你主动请求分析/翻译的文本内容会发送给对应的 AI 服务商。请确认所选服务的数据处理政策后再使用。API Key 保存在本机应用的 localStorage 中，不会上传到 GitHub。

## YouTube 字幕导入

从 YouTube 导入字幕需要本机安装 [yt-dlp](https://github.com/yt-dlp/yt-dlp)。

```bash
# macOS (Homebrew)
brew install yt-dlp

# 其他安装方式见 https://github.com/yt-dlp/yt-dlp#installation
```

未安装时仍可列出视频的字幕轨道，但下载会失败。请遵守 YouTube 服务条款与内容创作者的权利。

## 数据与隐私

- 所有学习数据默认保存在本机 SQLite 数据库（应用数据目录下的 `lexicue.db`），**不会自动上传**
- 词典数据在首次启动时导入本地数据库，之后离线可用
- 内置离线词典数据由第三方开源数据派生，授权与来源详见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)
- 支持数据导出与恢复（应用内「设置」页）
- 除你主动触发的 AI 请求与 YouTube 字幕下载外，应用不会联网

## 导入第三方词典包

LexiCue 支持从「文件」页导入 JSON 格式的离线词典包，导入后可在本地离线查询。格式说明见 [DICTIONARY_PACK.md](DICTIONARY_PACK.md)。

## 路线图

- 确定应用图标与品牌 Logo
- 产品宣传页
- 自动更新推送
- 提供预编译安装包与自动构建发布

## 许可证

MIT License，见 [LICENSE](LICENSE)。内置词典数据的第三方授权声明见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
