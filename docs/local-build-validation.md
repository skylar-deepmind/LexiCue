# 推送前安装包检查

## 检查目标

在本地提前发现前端、宿主平台 Rust、Android Rust、Kotlin 和 Android 资源的编译问题。宿主平台会实际构建 release 程序，Android 会实际构建 release APK。Windows 的原生安装包仍由 Windows Actions 验证，签名和上传产物也由 Actions 完成。网络、托管 runner、签名配置和 Windows 工具链问题不能由一台 Mac 完全保证。

## Android 工具链

内置 Gemma 构建另需 CMake 3.22+ 和 C++17 工具链。`prepare-gemma.mjs` 下载固定版本引擎并检查 SHA-256；不会下载模型权重。Android 的最低 API 为 28、ABI 为 arm64。原生库与许可复制由受版本控制的 `prepare-android.mjs` 完成；前后台取消由 Activity 模板和 Rust JNI 接口衔接。验收状态见 [embedded-gemma.md](embedded-gemma.md)。

版本集中保存在 `scripts/android-toolchain.json`：Java 17、SDK 36、Build Tools 36.0.0、NDK 29.0.14206865。本地和 Actions 都读取该文件，并明确设置 `NDK_HOME`，避免自动选取其他已安装版本。SDK 36 与当前 Tauri Android 模块的 `compileSdk` 一致。

macOS 默认使用 `~/Library/Android/sdk`，自动选择 Java 17；其他位置可以设置 `ANDROID_HOME`。Linux、Windows 还需设置 `JAVA_HOME`。首次安装需要 Android 官方命令行工具，然后运行：

```sh
sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;29.0.14206865"
rustup target add aarch64-linux-android
```

按 Android SDK 工具的要求接受 SDK 许可。工具安装说明见 [Android sdkmanager](https://developer.android.com/tools/sdkmanager) 和 [Tauri 前置要求](https://v2.tauri.app/start/prerequisites/)。

## 日常检查

先设置与仓库 Actions 相同的 HTTPS 同步服务地址（仓库变量 `LEXICUE_SYNC_ENDPOINT`），然后运行。也可以把该变量存入已忽略的 `.env.local`，以后直接执行 `npm run check:release`；当前终端的环境变量优先于文件。

```sh
export LEXICUE_SYNC_ENDPOINT="https://你的同步服务地址"
npm run check:release
```

检查顺序：工具链预检 → `npm ci` 按锁文件安装依赖 → lint → 前端测试 → 前端构建 → 宿主平台 Rust 单元测试和 Tauri release 程序构建 → 生成 Android 工程 → 安装原生模板及图标 → Android arm64 release APK 构建。任一环节失败立即退出，修复后重新检查，再提交和推送。

仅 Android 代码变化、其余检查已通过时，可以运行：

```sh
npm run check:release -- --android-only
```

Android release 构建仍会重新构建前端。`scripts/prepare-android.mjs` 同时用于本地和 Actions，确保修改的 `MainActivity.kt`、凭据初始化和应用图标真正参与编译。生成目录 `src-tauri/gen/android` 属于本地构建产物，不提交；本地 APK 不需要 GitHub 的 release 签名密钥。

日语分词词典缓存默认保存在已忽略的 `scripts/cache/lindera`，使用 Lindera 官方支持的 `LINDERA_DICTIONARIES_PATH`，避免每次切换编译目标都重新下载。首次仍需要获取完整词典；可通过该环境变量指定自己的缓存目录。

若终端设置了不带认证信息的 HTTP 代理，检查脚本也会传递给 Gradle，用于下载 Android 构建依赖；已有的 Gradle 代理设置保留。脚本不会修改全局 Gradle 配置。

## 已修复的跨平台问题

`get_local_ai_environment` 在 Android 上没有桌面平台的 CPU 查询分支，未注明类型的 `None` 无法推断为 `Option<String>`，导致 Rust E0282。为 CPU 和内存变量明确类型；本地 Android release 编译用于覆盖这条条件编译路径。

## 本次验证（2026-10-04）

- 完整 `npm run check:release` 已通过，含 macOS release 原生程序及 Android release APK。
- 前端 25 个测试文件、176 项测试通过；Rust 177 项测试通过，7 项外部资源或联网测试按原有配置忽略。
- lint 无错误，保留已有 30 条警告；前端构建保留已有体积提示，Android 依赖保留弃用 API 等提示。
- APK 包名 `com.lexicue.app`、版本 `0.4.1`、versionCode `4001`，ABI 为 `arm64-v8a`。APK ZIP 和原生 ELF LOAD 段的 16 KB 对齐通过。
- Windows 及 macOS Intel 安装包由对应 Actions runner 验证；本机没有执行 Android 手势、键盘、旋转的设备交互验收。

## 0.4.3 推送前验证（2026-10-06）

- 完整 `npm run check:release` 通过：按锁文件安装依赖、lint、前端构建、macOS release 程序与 Android arm64 release APK 均成功。
- 前端 186 项测试通过；Rust 196 项测试通过、7 项外部资源测试按已有配置忽略。
- 内置 Gemma 的 macOS arm64 原生库 ABI 检查通过，接口版本 1、动态库成功加载。
- npm、Tauri、Cargo 及锁文件的应用版本统一为 0.4.3；沿用 Java 17、SDK 36、Build Tools 36.0.0、NDK 29.0.14206865。
- 保留已有的前端体积、3 条 lint 警告及 Gradle 弃用提示，未出现构建错误。
- 本地 Android APK 不签 release 密钥；签名以及 Windows、macOS Intel 安装包由 Build Installers Actions 执行。Release 使用草稿形式。
- 首次 Actions 暴露了 ZIP 解压的宿主平台差异：GNU tar 无法处理 LiteRT SDK ZIP。原生准备脚本已统一采用 CMake/libarchive，失败时移除不完整目录；真实 SDK ZIP 从零解压、macOS 原生库准备及 Android release APK 重建均通过。
