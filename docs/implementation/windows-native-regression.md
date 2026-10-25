# Windows 原生回归运行方式

此运行器连接实际 Windows EXE 的 WebView2，使用真实 Tauri IPC、SQLite、系统文件选择与备份对话框。没有替换 `__TAURI_INTERNALS__`，也没有浏览器命令 fixture。仅使用合成英语材料和独立 QA 标识；不连接真实同步账号。

## 工具链

2026-10-25 验证环境：Parallels Desktop 中的 Windows 11 ARM64，Rust/Cargo 1.97.1、Visual Studio 2022 17.14、Windows SDK 10.0.26100.0、Clang 23.1.4、Node 22.20.0、WebView2/Edge WebDriver 155.0.4283.62。

ARM64 上的 `ring` 与 `aws-lc-sys` 需要 Clang，参见 [AWS 官方 Windows 要求](https://aws.github.io/aws-lc-rs/requirements/windows)。本次将已核对官方 SHA-256 的 LLVM ARM64 编译器、链接器、资源头文件和许可证安装到用户目录 `.lexicue-tools/llvm-23.1.4`，没有修改全局 PATH。

在 Windows 构建终端为当前进程设置：

```powershell
$env:Path="$env:USERPROFILE\.lexicue-tools\llvm-23.1.4\bin;$env:Path"
$env:CC_aarch64_pc_windows_msvc='clang-cl'
$env:CXX_aarch64_pc_windows_msvc='clang-cl'
$env:CARGO_BUILD_JOBS='3'
```

Windows MSVC 测试程序也需要 Common Controls 6。`src-tauri/build.rs` 采用 [Tauri 官方示例](https://github.com/tauri-apps/tauri/blob/dev/examples/api/src-tauri/build.rs) 的清单嵌入方式：让应用及测试程序获得相同的 Common Controls 依赖，避免测试启动前的 `TaskDialogIndirect` / `0xc0000139` 错误。其他平台沿用原构建路径。

## 隔离副本与执行

1. 使用 `%TEMP%\lexicue-v31-windows-<唯一后缀>\repo` 作为源码副本。只复制本次确认的源码；保留原工作区改动。不要复制正式学习数据库、同步配置或凭据。
2. 在副本的 `src-tauri/tauri.conf.json` 固定 `identifier` 为 `com.lexicue.qa.v31.windows<唯一后缀>`。QA 窗口设为 1440×1000、最小 360×320，关闭打包。较小最小尺寸仅用于响应式验收。
3. 在副本执行 `npm ci`、`npm run build`、`npm run lint`、`npm test`，随后在 `src-tauri` 执行 `cargo test --locked`。如已有完整 vendor/cache，可添加 `--offline`。
4. 最后执行 `cargo build --locked --features tauri/custom-protocol`，将 `target/debug/lexicue.exe` 复制为同目录的 `lexicue-qa.exe`。运行器记录并核对该副本的 SHA-256，避免其他 Cargo 命令覆盖正在验收的 EXE。
5. 将与 WebView2 版本一致的微软 Edge WebDriver 放到临时根目录的 `driver/msedgedriver.exe`。核对微软 Authenticode 签名。
6. 在已登录的 Windows 交互会话运行：

```powershell
$env:LEXICUE_WINDOWS_QA_ROOT="$env:TEMP\lexicue-v31-windows-<唯一后缀>"
# 在源码副本中运行
npm run test:windows:native
```

结果写入临时根目录 `native-evidence`。运行器自行启动原生 EXE，并以微软文档中的 attach 方式连接 Edge WebDriver。`WEBVIEW2_USER_DATA_FOLDER` 固定到临时根目录的 `webview2-native-profile`；重启先发送正常 `WM_CLOSE`，记录关闭前后的偏好，再清理驱动会话。它不依赖驱动启动模式的浏览器目录来证明持久化。

运行器与原生对话框辅助脚本都会拒绝正常应用标识或非 QA 路径。文件对话框只操作此 QA EXE 的窗口。原生按钮使用 WebDriver 的实际点击，等待卡片动画与可操作状态；窗口和控件先通过 Windows UI Automation 定位；当 Windows 11 将标准控件暴露成通用 Pane 时，辅助脚本再次核对原生控件类及进程归属，使用标准 Win32 输入／按钮消息完成操作。

保存快照按稳定的 `record_id`、规范快照及全部业务字段比较；恢复时 SQLite 内部自增 `id` 可以重分配，不作为记录身份。

每个阶段先保留测试库备份和该 QA WebView 的偏好。失败后可设置 `LEXICUE_WINDOWS_RESUME=1` 继续；运行器只恢复此测试库的阶段检查点，保留先前失败证据，不会操作正式资料库。不要在其他程序使用该 QA 标识时运行。

从 macOS 传送 vendor 或工具归档时，创建 tar 使用 `COPYFILE_DISABLE=1`，避免 AppleDouble `._*.c` 被 Windows 编译器当作源码。

## 覆盖与边界

- 实际示例查询、保存、撤销、三步跳过、重启与重新体验；通过备份表指纹核对示例隔离。
- 系统多选导入，空／无效／非英语 SRT，部分失败、修复重试、重复、取消；画廊与列表。
- 双主题保存、编辑、移除／撤销、来源返回与删除后副本；实际 JSON 文件备份恢复及重启。
- 使用生产导入和保存 IPC 创建一万条保存记录；固定再遇语料、多个旧原句、独立当前解释、提示开关与持久化。
- 默认／午夜，360、390、430、768、1024、1280、1440 逻辑像素宽度；原生窗口大小、焦点、键盘连续短语、短高度、大字体与 reduced-motion。
- 本地词典、实际系统语音接口与停止控制、缺声故障注入、WebView 网络离线模拟；保留系统语音列表和实际结果。
- 真实旧备份结构恢复、缺失新字段、重复迁移及其他语言只读保留／导出；结束后恢复合成测试集。

性能计时包含原生 IPC 与真实匹配 Worker。冷加载从正文首次 DOM 出现计至轻标记 ready 后两帧；缓存查询从原生点击事件计至当前解释 DOM 出现后两帧，不包含卡片入场动画。结果仅代表记录的设备、构建和数据集。

真实账号跨端同步、Windows x64 硬件和安装包／更新器、实体 Android、目标用户试用与学习效果不由此运行器证明。语音接口有活动状态也不等于人工确认音质或扬声器输出。
