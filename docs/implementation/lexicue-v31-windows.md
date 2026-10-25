# LexiCue 3.1 / 纯 B v3：Windows 原生补充交付

日期：2026-10-25。沿用 `codex/lexicue-v31-pure-b`；以第四批提交 `9cfc66b` 加本次修改完成验收，工程版本仍为 0.4.5，未制作正式发行包、未推送。

**本机 Parallels Desktop 的 Windows 11 ARM64 已补齐工具链，九个原生回归阶段、393 项检查全部通过。** 使用实际 Windows EXE、正式前端、真实 Tauri IPC / SQLite 与系统文件对话框。所有学习材料、保存和迁移输入均为隔离的合成测试数据。Windows 工程回归门槛已补齐；真实用户试用和真实账号多端同步仍未验收。

## 环境与本次修复

| 项目 | 实际结果 |
| --- | --- |
| 虚拟机 | 本机 Parallels Desktop 20.2.1；`Windows 11`，Windows 11 专业工作站版 ARM64 build 26200，4 vCPU / 12 GiB；宿主 Apple M4 / 32 GiB |
| 编译工具 | Rust / Cargo 1.97.1，`aarch64-pc-windows-msvc`；rustfmt / Clippy 已安装；现有 Visual Studio 2022 17.14.36408.4、SDK 10.0.26100.0 |
| ARM64 原生依赖 | 官方 LLVM / Clang 23.1.4 安装至 Windows 用户目录 `.lexicue-tools/llvm-23.1.4`；官方 SHA-256 匹配；仅构建进程使用，未改全局 PATH |
| 前端与驱动 | Node 22.20.0；WebView2 / Edge WebDriver 155.0.4283.62 ARM64，驱动微软签名有效 |
| 英语语音 | 经用户授权安装微软 `Language.TextToSpeech~~~en-US~0.0.1.0`，正常重启后状态为 Installed；WebView2 可见 Mark / Zira / David 的 en-US 本地声音；未改系统界面语言或输入法 |

修复两项实际发现的问题：

- Windows 测试程序启动前报 `0xc0000139` / `TaskDialogIndirect`。`build.rs` 采用 Tauri 官方示例的 MSVC 清单链接方式，把相同的 Common Controls 6 依赖嵌入应用和 Rust 测试程序；其他平台保持原构建路径。之后全部 Windows Rust 测试能正常启动、执行和退出。
- 首轮固定词典抽样为单词 50/50、短语 14/20。给 PhraseDict 增补 `by the way`、`at first`、`in fact`、`as soon as`、`a little`、`a lot of` 六条 LexiCue 原创中文解释，补充许可证说明；原有 4,869 行内容逐字节保留。初始化收据从 2.0 升至 2.1，使已有缓存也能补齐；测试验证保留已有缓存行、升级和重复初始化幂等。最终相同原生抽样为 **50/50、20/20**。这是固定词义抽样，不代表用户研究中的理解有效性。

新增 `npm run test:windows:native` 和 Windows 对话框辅助脚本，可按[运行说明](windows-native-regression.md)复现。它们只接受专属临时 QA 目录、QA 应用标识及匹配的 EXE，拒绝正式配置；不替换 Tauri 命令。实际执行的两份脚本与提交源码的 SHA-256 一致。

## 原生覆盖与双主题证据

| 阶段 | 通过内容 |
| --- | --- |
| 实操引导 | 默认 / 午夜的实际查询、保存、撤销、收起；三步分别跳过，完成 / 跳过后正常关闭重启、设置重新体验，原生 Shift+Arrow 连续短语。备份全表指纹及继续阅读位置不变；已有 42 条合成保存时回放仍不污染记录。 |
| 本地词典 | 正式离线词典初始化、固定 50 单词 / 20 短语中文词义检查；未知短语不编造解释。 |
| 导入与材料 | 系统多选 5 份 SRT：2 成功、空 / 无效 / 非英语 3 失败；修复重试、重复导入、系统取消均正确；4 份各 5,001 句的取消 / 重试不增生。实际进度、画廊 / 列表可操作。此阶段的错误分支集中在默认主题验收。 |
| 保存 | 每主题 20 次 UI 保存，原句 / 来源 / 位置完整；每主题 10 个并发原生重复请求保持同一记录。无词义保存、个人编辑、搜索、移除 / 撤销、返回原文、删除来源后副本及重启持久化通过；不新增旧复习任务。 |
| 备份恢复 | 经实际 Windows 保存 / 打开 / 恢复确认对话框，导出约 7.3 MB schema 9 JSON；11 份材料、42 条保存的业务字段与稳定 `record_id` 往返一致，并经重启核对。SQLite 内部自增 `id` 不作为记录身份。 |
| 一万条再遇 | 通过正式导入 / 保存命令生成 10,000 条有效保存、9,964 种表达。双主题各 20 应匹配 / 20 不应匹配 / 10 同形异义通过；点击前不弹解释，默认一条旧原句，展开 13 条不同旧上下文；本句与旧句含义分开，新上下文独立保存，提示关闭及重启不丢记录。 |
| 布局与可访问性 | 双主题宽度 360 / 390 / 430 / 768 / 1024 / 1280 / 1440，390×320 编辑、大字体；无横向溢出，正文不因卡片重排，底部保存可达。默认 / hover / selected / disabled 文字状态检查、键盘 focus、Esc / 空白返回、reduced-motion 通过；所检查文字对比度不低于 4.5:1。 |
| 语音与离线 | 两主题的单词 `bank`、短语 `take off`、整句均观察到真实 Windows synthesis start；停止及连续 10 次操作不遗留队列。仅缺声回退用显式 API 故障注入，离线使用 WebView 网络模拟；不是关闭整台虚拟机网络。 |
| 旧数据迁移 | schema 6 缺新字段的合成备份恢复：5 条新英语保存，2 条缺失来源如实保留未知，旧保存时间不伪造；中英文个人短语解释保留；5 条跨语言旧词、复习 / 日志 / 标签及退休词频偏好仍可导出。双主题只读历史可查看日语旧记录，新画廊只纳入英语；重复迁移身份不变；结束恢复一万条测试集。 |

代表截图：[默认桌面](evidence/windows-native/native/ocean-1440-native-recall.png)、[午夜桌面](evidence/windows-native/native/midnight-1440-native-recall.png)、[默认窄屏](evidence/windows-native/native/ocean-390-native-recall.png)、[午夜窄屏](evidence/windows-native/native/midnight-390-native-recall.png)、[午夜短屏编辑](evidence/windows-native/native/midnight-390-short-editor.png)、[多条旧原句](evidence/windows-native/native/midnight-native-recall-expanded.png)、[真实部分导入失败](evidence/windows-native/native/ocean-native-import-partial.png)。已抽查双主题桌面与短屏编辑截图；全部尺寸和状态另有自动断言。

## 性能与工程验证

在上述 ARM64 虚拟机、debug 原生 EXE、1440×900 逻辑像素及中等字体下，双主题合并结果：

| 计时 | 次数 | p50 | p95 | 最大 |
| --- | ---: | ---: | ---: | ---: |
| 冷加载再遇标记 | 40 | 57.5 ms | **63.4 ms** | 78.7 ms |
| 缓存词义点击查询 | 100 | 33.3 ms | **40.5 ms** | 80.7 ms |

冷加载为每次完整页面导航，正文首次 DOM 出现 → 真实索引 IPC、匹配 Worker → 标记 ready 后两帧；不等于进程或操作系统冷启动。缓存查询为原生点击 → 当前查询词义 DOM 出现后两帧，不包含卡片入场动画。冷匹配区间没有观察到起始于该区间的主线程 long task；一万条已保存列表首屏有界、搜索通过。保留全部样本及定义，结果不外推到实体手机、x64 硬件或学习效果。

| 检查 | 结果 |
| --- | --- |
| Windows `cargo test --locked --offline` | 244 单元 + 4 集成通过，13 项既有 ignored；退出码 0 |
| Windows `cargo build --locked --offline --features tauri/custom-protocol` | 通过；冻结验收 EXE，避免被测试构建覆盖 |
| Windows build / lint / test | 通过；37 文件 / 280 测试，保留既有 YouTube lint 警告 |
| macOS build / lint / test | 通过；37 文件 / 280 测试，保留原有 marketing / YouTube 警告 |
| macOS Rust | 本次修改后重跑，246 单元 + 4 集成通过，13 项既有 ignored；平台条件导致与 Windows 数量不同 |
| 新运行器语法 / lint、Rust 构建脚本格式、改动空白检查 | 通过 |

原生 EXE SHA-256 为 `4c61d0faa63852f8d89fb4db53e59af2bff5764222922e0a0520bb8be36ee22e`。第四批已有 838 项浏览器回归结果继续作为历史证据，本次没有重跑该浏览器套件。

## 保护与结束状态

- 原分支未切换；初始已有改动的 **1,600 个路径全部 SHA-256 不变**，未纳入本次提交。没有 reset、清理或覆盖原有修改。
- 真实 Windows `com.lexicue.app` 的数据库、WAL、SHM 三个文件在全部验收前后 **SHA-256 完全一致**。只读文件核对，不用真实库执行恢复、迁移或破坏性测试；证据不含学习内容。
- Windows 使用 `com.lexicue.qa.v31.windows20261025`、临时源码副本与独立 WebView2 浏览器目录；示例继续使用内存库。没有登录、连接、断开或改写真实同步账号。
- QA 应用与驱动已退出。恢复 PD 原有闲置暂停设置，Windows 11 已恢复原先挂起状态；Rust、LLVM 和获授权的英语声音保留。Mac 原体验窗口及原开发服务仍在运行，没有重建或替换其体验库。

## 三端现状、未完成项与风险

| 平台 | 当前证据与边界 |
| --- | --- |
| Windows | 本次 ARM64 / Parallels 原生完整自动化回归通过；真实英语语音开始 / 停止通过。尚无 x64 实机、正式安装包 / 更新器验收；扬声器可听性及音质需人工确认。 |
| macOS | 第四批独立 QA 原生双主题引导、导入、查询 / 保存 / 再遇及重启通过；本次补跑全部 Rust 和前端工程测试。Mac 体验窗口继续运行，未为本次词典补丁重建；实体键盘短语选择和可听输出仍待人工确认。 |
| Android | 沿用第四批 Android 16 / API 36.1 ARM64 模拟器的原生双主题引导、系统内容 URI 选择导入、查询 / 保存 / 重启及缺声回退证据；本次未重跑。尚需实体手机的软键盘、连续选区、批量选择、其他文档提供器、离线和语音可听性。 |

真实测试账号多端同步、混合版本编辑 / 删除 / 撤销及冲突仍需联调；旧客户端不理解全部新增字段，不能以本地恢复与离线冲突测试代替真实服务验收。PRD 的 10 位目标用户中至少 8 位五分钟完成，以及 8–12 人一周试用尚未开展。保留既有大 chunk、退役词典初始化未使用等构建警告；本次不包含发行包优化或学习效果结论。

## 可复核记录

- [验证总表](evidence/windows-native/verification.json)、[原生 393 项与逐次性能样本](evidence/windows-native/native/report.json)、[运行方式](windows-native-regression.md)
- [环境](evidence/windows-native/environment.json)、[原生二进制](evidence/windows-native/native-binary.json)、[源码及执行脚本指纹](evidence/windows-native/source-hashes.json)、[词典增量保护](evidence/windows-native/dictionary-patch.json)
- [Windows Rust](evidence/windows-native/cargo-test-out.txt)、[Windows 前端](evidence/windows-native/frontend-test-out.txt)、[macOS Rust](evidence/windows-native/macos-cargo-test.txt)、[macOS 前端](evidence/windows-native/host-test.txt)
- [真实 Windows 数据保护](evidence/windows-native/real-data-verification.json)、[原工作区保护](evidence/windows-native/workspace-protection.json)、[英语语音安装完成](evidence/windows-native/voice-after-reboot.json)、[PD 结束状态](evidence/windows-native/pd-restored-state.txt)
