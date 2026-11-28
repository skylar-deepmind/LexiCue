# LexiCue 项目交接

核对于 2026-11-28。最近一次应用基线为 `2898e94d4ac4b8d28aa19899f9b06bd120d6503e`。接手时对照当前分支、远端 `main` 和任务 PR；日常安装版本从本机回执核对。

## 当前范围与决策依据

- 英语学习是当前产品范围。核心流程是导入材料、按需理解、保存语境、重逢回顾。支持中文界面和释义，保留旧非英语资料的查看、备份和导出。新增功能按核心流程、可靠性、数据保护和无障碍衡量。见 [产品规则](../AGENTS.md#product-scope-and-minimalist-design)。
- 阅读和收藏的设计来源与历史验收见 [双端交接](implementation/approved-ui.md)。较新的改动以相应 PR 和目标版本为准，例如 [确认导入后立即在首页落卡（#35）](https://github.com/skylar-deepmind/LexiCue/pull/35) 和 [手机查词时保持正文选词可见（#36）](https://github.com/skylar-deepmind/LexiCue/pull/36)。
- 局域网同步的配对范围是 Mac 与 iPhone。正文、收藏等学习资料及封面、原音频、已保留的导入原件可在两端同步，旧云同步维持停用。整份材料的删除会跨端应用，保留已收藏的语境。见 [同步实施与验证](implementation/lan-device-sync-v1.md#16-材料附件与整份删除)。
- 对外说明和下载入口见 [中文 README](../README.zh-CN.md) 与 [安装指南](../DISTRIBUTION.md)。网站和四语 README 的内容来源与检查见 [Marketing 工作流](../marketing/README.md)。

## 最近完成的开发与验证

| 事项 | 版本、结果与证据 |
| --- | --- |
| YouTube 自动字幕滚动重复（#39） | 2026-11-27 合入 `2898e94d`。人工英文字幕优先，自动字幕优先读取 JSON3 原始事件，保留 VTT 回退及 429 停止行为。修复适用于新导入。同一视频在 Mac 日常版复测至预览，报告中的两种错拼合计由 4 处降至 0。PR 另记录五个公开样本、87 项前端相关测试和启用 `lan-sync` 的 430 项 macOS Rust 库测试，以及 34 项按默认设置跳过的测试。 [PR #39](https://github.com/skylar-deepmind/LexiCue/pull/39) |
| 合并后的 CI 与 Pages | `2898e94d` 的前端、Rust、同步服务及 Linux、Windows、macOS 构建通过。Pages 部署工作流通过。 [CI](https://github.com/skylar-deepmind/LexiCue/actions/runs/46005796374) · [Pages](https://github.com/skylar-deepmind/LexiCue/actions/runs/46005795285) |
| 日常安装 | 2026-11-27 从同一提交原位更新 Mac 0.4.7 和 iPhone 0.4.7（构建 21），已验证启动和原有资料。Android 按用户确认跳过本批。主 Git common dir 下的 `lexicue-workflow/reports/pr-39-2898e94d/安装回执.md` 保留逐端结果。 |
| 整库局域网同步（#38） | 2026-11-27 合入 `407585eb`。双库检查覆盖断线续传、附件共用和完整备份恢复，签名验收版在 Mac 与 iPhone 真机核对原音、双向整份删除和收藏保留。见 [实施与复跑入口](implementation/lan-device-sync-v1.md#16-材料附件与整份删除) 和 [PR #38](https://github.com/skylar-deepmind/LexiCue/pull/38)。 |

## 待接续事项

- 2026-11-28 核对仓库时无开放的功能 PR 或 issue。功能工作继续用已有 PR、issue 或获授权访问的开发看板确认验收项与下一步。官网重构的 [#33](https://github.com/skylar-deepmind/LexiCue/pull/33) 和 [#37](https://github.com/skylar-deepmind/LexiCue/pull/37) 均已关闭，且没有合入 `main`。如恢复该工作，先确认采用的稿件。
- Android 缺少 `2898e94d` 的日常安装和行为验证。后续补装时，从当时同步并核对的 `main` 开始并逐端记录结果。该轮 iPhone 回执覆盖安装、启动和资料检查，YouTube 样本预览结果来自 Mac。
- 公开 macOS 0.4.7 的 Apple Silicon 和 Intel 安装包已发布，构建来源为 `3160d1f5`。PR #34 记录 iOS TestFlight 0.4.7（构建 19）进入外测。Windows 和 Android 的通用公开版本在本次核对时为 0.4.5，跨平台 0.4.7 仍为草稿。下一次正式发布需按 [发布验证](release-validation-policy.md) 核对当时的发布授权、构建来源和目标平台。 [macOS Release](https://github.com/skylar-deepmind/LexiCue/releases/tag/v0.4.7-macos) · [PR #34](https://github.com/skylar-deepmind/LexiCue/pull/34) · [通用 Release](https://github.com/skylar-deepmind/LexiCue/releases/tag/v0.4.5)

## 复跑与更新

- 常规命令见 [开发检查](development-testing.md)。YouTube JSON3 回归在 Mac 从仓库根目录运行 `cargo test --manifest-path src-tauri/Cargo.toml --locked --features lan-sync --lib original_json3`，入口见 [原生测试](../src-tauri/src/commands/youtube_import/tests.rs)。公开视频和实际安装版预览需单独走应用入口。
- 复跑用独立测试资料。记录浏览器、双库、模拟器和真机各自实际通过的范围。已有 PR 保存具体的验收和复跑过程。本页在基线、最近验证结果或待接续事项变化时更新，早期记录可从相关 PR 或 Git 历史查阅。
- 本机安装回执可用 `git rev-parse --git-common-dir` 定位到 `lexicue-workflow/reports/`。没有该机器的回执时，使用公开 PR 核对已披露的结果，将其他安装状态标为待核验。
