# 内置 Gemma：实现与验收

## 使用方式与安装包

本地 AI 的提供方为 `gemma`，云端继续使用 OpenAI 兼容 API。AI 默认关闭。
在设置中开启 AI、下载或导入当前目录中的 Gemma 4 E2B/E4B，再选择模型。
本地生成、token 计数和导入校验均不请求 HTTP；只有主动下载模型需要联网。
不需要安装 Ollama，也不会自动回退云端。

引擎随应用分发，权重不进入安装包。相同格式、修订和 SHA-256 的文件可以复用；
`.litertlm` 与 GGUF 不互换，原始训练权重不受支持。

| 格式 | E2B 下载大小 | E4B 下载大小 | 目标平台 |
| --- | ---: | ---: | --- |
| LiteRT-LM | 2.59 GB | 3.66 GB | macOS arm64、Windows x64、Android arm64 |
| GGUF Q4_0 | 2.84 GB | 4.59 GB | macOS Intel |

当前原生库的未压缩大小约为 macOS arm64 68.5 MB、Windows x64 48.4 MB、
Android arm64 40.4 MB（含 C++ 运行库）、Intel macOS 8 MB。这些不是安装包总大小。
本次 Android release APK 约 313 MB，其中约 268 MB 来自 Rust 主库和内嵌词典等应用数据。
模型另占应用私有存储；导入会复制文件，源文件仍保留。
LiteRT 还会生成 GPU 权重/程序或 CPU XNNPACK 缓存，按资产独立保存。
空间预检为 E2B 另预留 1.8 GB、E4B 另预留 4.8 GB，再留 256 MiB 余量；
已有缓存会抵扣预留。这是兼顾 GPU 和 CPU 的保守容量要求，不是固定实际占用。
删除模型会在卸载后一起删除它的缓存，不影响其他模型或学习数据。

## 固定资产与构建

资产清单在 `src-tauri/native/gemma/models.json`：来源仓库、固定提交、字节数、
SHA-256、格式、量化和目标架构。资产 ID 包含格式与权重身份，并参与结果缓存。
更新权重必须更换身份，不能复用旧缓存。

引擎锁文件为 `src-tauri/native/gemma/runtimes.json`：

- LiteRT-LM v0.16.0 / C API 0.1.0，官方归档 SHA-256 校验后编译薄 C++ 桥。
- llama.cpp b9568，源码归档 SHA-256 校验后静态链接到 Intel 桥；Metal shader 内嵌。
- 运行时 ABI 为 1，产物附带版本与原生文件哈希、许可和 `NOTICE.md`。

构建需要 CMake 3.22+、C++17 工具链、curl、tar 和原有 Tauri 前置依赖。
首次准备引擎需要网络；缓存位于已忽略的 `scripts/cache/gemma-native`。
不需要下载模型才能构建应用。

```sh
npm run prepare:gemma
npm run tauri build
# 单独准备 Intel 桥，不覆盖当前桌面应用资源：
node scripts/prepare-gemma.mjs --target x86_64-apple-darwin --cache-only
```

桌面 `beforeDevCommand` / `beforeBuildCommand` 自动准备当前目标的原生库。
跨编译时应设置正确的 `TAURI_ENV_TARGET_TRIPLE`，每个目标使用独立构建工作区。
本地 Gemma 要求 macOS 14+；较早系统仍保留云端入口。
Windows 桥使用静态 MSVC 运行库；官方引擎 DLL 与桥放在同一资源目录。
macOS 修正官方 dylib 的安装名，并为嵌入库进行 ad-hoc 签名。

Android 配置来自受版本控制的 `tauri.android.conf.json`、`prepare-android.mjs` 和
`android-template/MainActivity.kt`。最低 API 28，仅 arm64。
原生库放在 `jniLibs/arm64-v8a`，许可放在 assets，不复制桌面 dylib 或权重。
桥和官方引擎支持 16 KB ELF 页对齐。正常 release 构建仍需要各平台的发布签名配置。

## 推理与数据规则

Rust 专用线程按队列独占模型。模型按需加载，GPU 初始化失败后尝试 CPU，
设置显示实际后端；初始化都失败时明确报错。空闲五分钟卸载。
Android `onPause` 使正在执行及已经排队的本地任务取消，完成 native 回调后释放模型；
`onResume` 允许新任务，不恢复旧请求。

使用模型聊天模板、关闭思考、确定性采样和 JSON Schema 约束。
LiteRT v0.16 的 CPU 预编译 executor 只实现 TopP，因此配置 TopP / top-k=1 / seed=0；
Intel 使用 greedy + schema grammar。最终仍需 JSON、词典编号和原文定位校验。
无效输出不会通过“修正高亮”被强行接受。
日语/中文固定表达复用现有词典校验：原文匹配且同一句仅有一个已验证表达时，
采用词典的表达边界；多个候选有歧义时不强行保存。中文拼音及英文译义在另一次
约束生成中补充，不能改变已校验的原文定位。

上下文为 8,192 tokens，预留 2,048 输出和 128 余量。按实际模板 tokenizer 计数；
超限分批，单条仍超限明确报错。输出达到上限或无效 JSON 可拆分较大批次；
重试有上限，流式预览回滚后再生成，最终校验通过才保存。
E2B 的英语提取逐句执行，以减少多句任务漏检；E4B 每批至多八句，仍检查 token 上限。
错误重试可提供原文中每个 canonical 单词允许的位置，结果仍经过完整定位校验。

私有模型目录为 app data 下的 `gemma-models`。下载使用固定 URL、Range 和 `.part`，
检查 Content-Range、剩余空间、完整长度和 SHA-256，校验后原子安装并写收据。
断网、取消和空间不足保留部分文件，损坏文件删除后重新下载。
导入同样验证当前清单，只接受相同文件；加载前再次完整校验。
生成或下载期间禁止删除；删除先卸载，只移除应用管理的资产。
可用内存和存储检查只是预检，实际加载仍可能因 GPU 或内存不足失败。
LiteRT E2B/E4B 的可用内存预检分别为 2.6/4.4 GB；GPU 失败后 CPU 分别要求
6.3/9.5 GB，避免把 CPU 回退当作低内存设备的保证。阈值来自当前测试和保守余量，
仍须在 Android/Windows 设备上核验；macOS 可用内存采用可回收页面估计。

旧 `ollama` 配置迁移为 Gemma 待安装，保留 AI 开关、云端配置及密钥，
不下载、不删除 Ollama 权重、不修改数据库。重新分析保留用户编辑、原有 occurrence
身份及学习记录；取消和保存失败不会提交部分学习数据。

## 验收状态（2026-10-05）

构建通过与设备验收通过分别记录。当前没有 Windows、Android 或 Intel 实机，
不能宣称四种架构全部支持验收完成，正式发布前必须补齐下表。

| 平台 | 原生集成 / 构建 | 设备与业务验收 |
| --- | --- | --- |
| macOS arm64 | 桥和 Tauri release `.app` 已构建 | Apple M4 / 32 GiB 实测；记录见下方 |
| macOS Intel | x86_64 桥编译，Rosetta 下 E2B 加载、schema 输出、流式、取消、卸载通过 | Intel 实机、完整业务、E4B、CPU/GPU性能待验收 |
| Android arm64 | Rust、Kotlin、原生库及 release APK 构建通过，16 KB ELF 对齐检查通过 | 真机离线、GPU 回退、内存、前后台、content URI 导入待验收 |
| Windows x64 | 固定库与构建脚本已接入 Actions | Windows 原生构建、无外部服务安装、E2B/E4B 和 GPU/CPU 待验收 |

原生业务测试使用独立临时词典 fixture，不读写用户数据库或学习记录，不使用云端回退。
英语提取测试记录如下，完整机器可读结果见 `gemma-native-validation.json`。

| 配置 | 引擎加载 | 含校验加载请求 | 首个有效预览 | 三句提取总耗时 | 峰值进程 RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| E2B / GPU | 3.73 s | 11.13 s | 6.25 s | 35.96 s | 2.18 GB |
| E4B / GPU | 6.13 s | 19.59 s | 11.91 s | 13.58 s | 3.54 GB |
| E2B / CPU 回退 | 3.94 s | 11.18 s | 8.03 s | 29.06 s | 5.16 GB |

以上 GPU 测试同时运行，期间还有构建任务；CPU 测试随后运行。可证明流程与小样本校验通过，不能作为正式性能比较。
指标来自开发测试进程，
冷加载请求包含权重校验，engine load 单独计时；峰值 RSS 包含整个测试进程，
不等于 GPU 驱动全部内存。测试缓存与实际 release 启动条件可能不同。
这些小样本不是完整字幕质量基准，也不保证普通手机的速度或内存表现。

可手动运行严格业务验收，失败退出码会保持为失败：

```sh
cd src-tauri
LEXICUE_GEMMA_SMOKE_MODEL=/absolute/path/to/gemma-4-E2B-it.litertlm \
LEXICUE_GEMMA_SMOKE_LIBRARY=/absolute/path/to/prepared/runtime \
cargo test gemma4_local_streaming_smoke -- --ignored --nocapture
# E4B 另设置 LEXICUE_GEMMA_SMOKE_ASSET=gemma4-e4b-litert-0b2a8980ce15
```

测试覆盖英语 pick up / run into / break the ice、UTF-16 原文范围、英日德字幕中文翻译、
日德中固定表达、本句银行义与有效 Collins 编号、取消、排队取消、超限、空闲卸载。
同一工作线程的 E2B → E4B → E2B 原生切换测试也已通过：每次检查模型身份、
实际 tokenizer 和 schema 生成，最后显式卸载；采用生产五分钟空闲超时。
其他业务测试使用加速空闲超时，生产仍为五分钟。还需较长字幕、多样正负例、连续运行、
模型切换及占用删除、损坏与下载中断/恢复、空间不足、内存不足及真实系统前后台验证。

UI 检查由 `scripts/gemma-ui-smoke.mjs` 使用 fixture 执行，覆盖默认与 midnight、
桌面和手机尺寸、普通/悬停/选中/禁用/键盘焦点及删除对话框。
它不替代原生下载、导入或真实设备操作验收。

历史 Ollama 12B 的记录保留在 `gemma4-validation.md`，不能作为内置 E2B/E4B 的证据。
模型使用受 [Gemma 条款](https://ai.google.dev/gemma/terms) 约束；
来源与许可详见 `THIRD-PARTY-NOTICES.md` 和随包附带的 notices。

前端 175 项测试通过；Rust 181 项常规测试通过（另有 7 项需要外部条件的 ignored 测试）；
Gemma UI 18 项主题/尺寸检查通过。前端构建、macOS `.app` 和 Android release APK
构建结果另记录于机器可读报告。仓库全局 `cargo fmt --check` 与严格零警告 Clippy
仍有改造前的格式/警告基线问题；新增 Gemma Rust 模块已格式化，未批量改写无关文件。

独立引擎验收也可运行 `python3 scripts/gemma-native-smoke.py --runtime /absolute/runtime
--model /absolute/model --backend cpu`；`--abi-only` 用于构建 CI，不要求模型。
这项检查验证 ABI/加载/schema/流式/取消/卸载，不能替代真实业务和设备质量验收。

在独立测试进程中运行模型切换验收：

```sh
cd src-tauri
LEXICUE_GEMMA_SMOKE_MODEL=/absolute/path/to/E2B.litertlm \
LEXICUE_GEMMA_SMOKE_E4B_MODEL=/absolute/path/to/E4B.litertlm \
LEXICUE_GEMMA_SMOKE_LIBRARY=/absolute/path/to/prepared/runtime \
cargo test gemma4_local_model_switch_smoke -- --ignored --nocapture
```

Intel 使用对应清单的两个 GGUF 文件；需在对应架构的进程运行。
上面的 Mac arm64 结果不能作为 Windows、Android 或物理 Intel 的切换验收结果。
