# LexiCue 3.1 / 纯 B v3：第四批交付

2026-10-25 后续：[Windows 工具链与原生补充回归已完成](lexicue-v31-windows.md)。下文保留第四批交付当时的验证状态；Windows 的现状以该补充报告为准。

日期：2026-10-24—25。应用工程版本仍为 0.4.5，尚未制作正式发行版。分支：`codex/lexicue-v31-pure-b`。承接前三批提交，未推送。

本批工程实现已完成，Windows 原生验收、真实用户试用及真实账号混合版本同步仍是发布门槛，不能据此宣布 PRD 全部验收完成。

## 已实现与可操作入口

- 首次从应用根入口启动，直接打开英语示例。最多三次实操：点词／选连续短语看解释 → 真实保存 → 收起继续。每个阶段、加载失败和保存等待期间都能跳过；也可直接使用功能坞导入。
- 完成或跳过状态以独立版本键 `lexicue-onboarding-v1` 保存在本机。普通重启进入材料；设置 → 实操引导 → 重新体验，开启全新的示例。回放不会先抹掉已有完成状态；离开未完成回放记为跳过。
- 示例显式说明临时保存。使用每窗口独立的内存 SQLite，复用正式材料导入、选区定位、保存事务、去重和撤销；词义来自正式英语词典。它不写真实材料、保存、同步队列、复习记录或“继续上次阅读”。示例也不读取用户真实再遇索引和旧原句。
- 没有预置用户收藏、注册／AI／模型下载或学习语言选择前置流程。保存成功仍只显示绿色“已保存”和“撤销”。引导完成后不添加下一任务按钮。
- 状态写入失败有反馈，仍可继续导入和阅读；保存回执丢失保留草稿并沿用操作 ID 重试。跳过后晚到的查询、保存和初始化回执不会重新打开引导或改变结果。
- 设置保留外观、界面语言、备份／历史、同步、词典、YouTube 和更新；增加一个重新体验入口。旧词频配置、标记及抽查记录补入可选备份字段与只读历史，旧分析模型记录也能查看。它们不再驱动新的学习任务；旧偏好和模型配置没有被清空。
- Android 文件选择后的名称通过系统内容提供器读取，支持不含文件名的内容 URI。选区读取仍走原有 fs 插件与系统授权；未新增存储权限。Android 选择器不依赖各提供器的 MIME 映射，选中后仍严格验证 `.srt` 文件名和英语 SRT 内容。单个文件的名称读取失败按该文件失败处理，不阻断其余选择。
- 补齐短屏卡片和鼠标点词的焦点恢复：320 像素高视口使用全高紧凑卡片；macOS 点词后收起返回原词焦点。

## 数据保护与兼容

- 修改前记录了本批工作区快照。原有 1574 个已修改／未跟踪文件的 SHA-256 全部一致，未纳入本批提交。没有 reset、清理或覆盖已有改动。
- 从未用真实学习库执行迁移、恢复、删除等破坏性验收。迁移回归只读取既有隔离副本，并另建临时恢复库。
- 副本迁移与恢复：保存 998 条、缺失来源 27 条、合并重复 5 条；原有十张学习表计数保持 `[27,17621,7246,89015,2027,3579,216,80,27,6]`，重复迁移不增生。
- 新增备份字段沿用 schema 9 的 `serde(default)` 兼容方式。缺少这些字段的旧备份仍可恢复。词频配置、个人旧记录和跨语言历史按原值保留；没有激活旧熟练度／频率基线任务。
- 示例实操前后，测试库全部备份表保持一致。Android 原生示例保存后，QA 库的 files、segments、saved_records、reviews、phrase_reviews 均为 0；macOS 示例结束再导入一份材料后为 `1/2/0/0/0`。
- 用户体验版继续使用原 `com.lexicue.preview.v31` 副本；本批原生测试使用独立的 macOS QA 标识和 Android QA 包名，未覆盖正式应用或用户体验库。
- 最终体验窗口已重开：11 张学习表逐表指纹与重开前相同，原 27 份材料、998 条保存保持不变；当前停留在可操作的英语示例。

## 自动化验证

最终代码执行：

| 检查 | 结果 |
| --- | --- |
| `npm run build` | 通过 |
| `npm run lint` | 通过；保留原有 marketing／YouTube 等警告，无本批新增警告 |
| `npm test` | 37 个文件、280 项通过 |
| `cargo test` | 246 项单元测试、4 项集成测试通过；13 项需显式环境的测试保持 ignored |
| 隔离旧库迁移／恢复审计 | 通过，未使用真实学习库 |
| `npm run test:ui` | 838 项通过：阅读 167、保存 132、再遇 302、引导 237 |
| `git diff --check` | 通过 |

UI 回归为 Chrome → 正式 Rust 命令核心 → 临时真实 SQLite，解析与再遇使用正式 Worker；原生文件、启动检查等边界使用 fixture。它不能替代下面单列的原生测试。

双主题覆盖 `ocean` 和 `midnight`，宽度 360、390、430、768、1024、1280、1440，并额外检查 390×320 短屏。验证默认、hover、selected、disabled、键盘 focus 可读性，以及 Skip 可达、Esc／返回、焦点、无横向溢出和 reduced-motion。已检查的文字状态对比度达到 4.5:1。

引导新增回归包括三阶段跳过、加载失败重试、保存丢回执重试、撤销后不误判完成、保存中跳过、晚到回执隔离、连续短语保存、设置重体验、重启记忆、直接导入、真实继续阅读位置保护、真实备份／保存／再遇索引隔离。前三批断言保持通过。

## 性能

同一本机 Apple M4／32 GiB，macOS 15.6.1 arm64，Chrome 156.0.8078.47。此次浏览器回归与 Android 模拟器并行运行。

- 1 万条有效保存，接近 1 万种不同表达；固定 20 条应匹配、20 条不应匹配、10 条同形异义全部通过。
- 最终 40 次冷加载：从正文可见到轻标记稳定显示，p95 **144.4 ms**，最大值见原始报告；标记窗口内未观察到主线程 long task。
- 100 次当前查询，从用户点击到解释节点可见并两次绘制后的 p95 **81.4 ms**；不等待卡片开合动画结束。
- 常规阅读 100 次已缓存命令 p95 **4.04 ms**，从点词到两次绘制后释义可见 p95 **64.9 ms**。

这些是本机浏览器连接真实临时库的工程数据，不是 Android、Windows 原生性能结果，也不证明记忆提升。

## 原生平台情况

| 平台 | 实际环境与结果 |
| --- | --- |
| macOS | 15.6.1／arm64，独立 `com.lexicue.qa.v31.phase4`。实际验证默认／午夜示例查询、保存、收起、设置重体验、重启不重复引导；原生文件选择器导入两份 SRT，真实查询、保存、收起及第二份材料中的旧原句回顾通过。朗读／停止状态切换已检查；可听输出仍需人工确认。 |
| Android | Android 16／API 36.1，`Medium_Phone_API_36.1` arm64-v8a 模拟器；独立 `com.lexicue.app.qa.phase4`。实际验证默认／午夜示例查询、保存／撤销、系统侧边返回手势、跳过、设置重体验及更新重启后不重复引导；原生系统存储提供器成功导入 SRT 并保留真实文件名。真实查询、保存、收起继续阅读及跨进程重启通过；只读核对为 1 份材料、2 句、1 条真实保存，原句和 `first.srt` 出处齐全，复习记录为 0。无英语声音时的原生回退提示已验证。 |
| Windows | 名为 Windows 11 的 ARM 虚拟机，build 26200。已恢复并尝试隔离目录构建，但只有 rustup 启动器，没有已安装／默认 Rust 工具链；原生构建与四步流程未通过验收。虚拟机已恢复到原来的挂起状态。 |

Android 的“下载”快捷页没有列出由 adb 直接放入的测试文件，因此使用“设备存储 → Download → 专属测试目录”完成选择。仅验证了系统存储提供器；不能据此声称所有厂商下载、云盘或文档提供器均通过。

## 未完成项与发布风险

1. Windows 配齐 Rust／目标工具链后，需跑原生完整四步流程、再遇、备份恢复、主题、键盘和语音。
2. Android 尚非实体手机验收，仍需在真实设备补软键盘、连续文本选择、批量选择、不同文档提供器、离线及语音可听性检查；macOS 连续短语的实体键盘操作和三端可听输出也需人工确认。浏览器的键盘／短语／缺声回退测试已通过。
3. 真实测试账号的多端同步、混合版本导入／删除／撤销、个人修改冲突仍需联调；Rust 离线冲突测试不能代替真实服务验收。旧客户端不理解新增备份字段，仍不建议用旧版覆盖新版本数据。
4. PRD 的 10 位用户中至少 8 位五分钟完成、以及 8–12 人的一周试用尚未开展；不宣称已达到产品有效性或记忆效果门槛。
5. 构建仍有既存大 chunk、退役词典初始化未使用及 Gradle/JDK 弃用提示；不影响当前验证，但发行包优化和工具链升级尚未处理。

## 证据

- [总验证记录](evidence/phase4/verification.json)、[引导 237 项](evidence/phase4/onboarding.json)、[阅读](evidence/phase4/reading.json)、[保存](evidence/phase4/saved.json)、[再遇与性能](evidence/phase4/recall.json)
- [完整 UI 日志](evidence/phase4/ui-full.txt)、[旧库副本审计](evidence/phase4/copy-audit.txt)、[已有工作保护审计](evidence/phase4/protection.json)、[体验副本保留核对](evidence/phase4/preview-preservation.json)
- [默认主题窄屏](evidence/phase4/ocean-390-saved.png)、[午夜主题窄屏](evidence/phase4/midnight-390-saved.png)、[午夜短屏](evidence/phase4/midnight-390-short.png)
- [macOS 默认示例](evidence/phase4/macos-ocean-example-saved.png)、[macOS 午夜示例](evidence/phase4/macos-midnight-example-saved.png)、[macOS 真实保存](evidence/phase4/macos-midnight-real-save.png)、[macOS 真实再遇](evidence/phase4/macos-midnight-recall.png)
- [Android 默认示例](evidence/phase4/android-ocean-example-saved.png)、[Android 午夜示例](evidence/phase4/android-midnight-example-saved.png)、[Android 真实保存](evidence/phase4/android-midnight-real-save.png)、[Android 收起继续](evidence/phase4/android-midnight-continue.png)、[Android 缺声回退](evidence/phase4/android-midnight-no-voice.png)、[Android 重启后保存](evidence/phase4/android-midnight-restarted-saved.png)
