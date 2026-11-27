# 安装与常见问题

从 [GitHub Releases](https://github.com/skylar-deepmind/LexiCue/releases) 下载 LexiCue。

本地 AI 使用内置 Gemma 引擎，默认关闭。安装后在设置中单独下载 E2B/E4B，
或导入清单匹配的模型文件。权重不随安装包捆绑，也无需另装 Ollama。
Android 需要 arm64、Android 9/API 28 或更新版本；模型还需约 2.6–3.7 GB 私有存储及足够可用内存。
各平台构建与实机验证状态见 [内置 Gemma 验收](docs/embedded-gemma.md)。

---

## macOS

从 [macOS v0.4.7](https://github.com/skylar-deepmind/LexiCue/releases/tag/v0.4.7-macos) 下载对应的 DMG。安装包已使用 Developer ID 签名，并通过 Apple 公证。

1. 在「关于本机」查看芯片或处理器。Apple 芯片选 `aarch64.dmg`，Intel 处理器选 `x64.dmg`。
2. 双击 DMG，把 LexiCue 拖到「应用程序」。已有应用可以直接覆盖更新。
3. 从「应用程序」打开 LexiCue。

---

## Windows

### 现象

双击安装包时出现：

- 「Windows 已保护你的电脑」（SmartScreen）
- 「已阻止此应用，因为无法验证发布者。」

### 原因

安装包尚未使用受信任的代码签名证书，SmartScreen 无法确认发布者身份。

### 安装步骤

1. 双击安装包 `LexiCue_*_x64-setup.exe`。
2. 若出现 SmartScreen 蓝窗，点击 **更多信息（More info）** → **仍要运行（Run anyway）**。
3. 若提示「无法验证发布者」，选择 **是 / 运行** 继续安装。

> 提示仅针对未签名安装包，属于正常安全拦截，不表示文件有问题。建议通过官方 GitHub Actions 产出的安装包安装，避免使用来源不明的文件。

---

## Android

### 现象

安装 APK 时出现：

- 「为了安全起见，你的设备目前禁止安装未知来源的应用」
- 「Google Play Protect 已阻止」/「未检测到有害内容，但仍然要安装吗？」

### 原因

APK 未经 Google Play 签名发布，需开启“未知来源”安装权限。

### 安装步骤

1. 将 APK 传到手机（浏览器下载、USB、或第三方传输工具均可）。
2. 打开 APK 时按提示前往设置，允许 **该来源安装应用**（不同品牌手机路径略有差异，一般在 **设置 → 安全/应用** 中）。
3. 若 Play Protect 提示，点击 **仍要安装 / Install anyway**；若要求“扫描”后可选择「不发送到 Google」。

> 仅第一次从该来源安装时需要授权，之后安装更新包不再重复询问。

---

## 常见疑问

### 这些拦截是否意味着软件不安全？

不是。提示仅表示“无法验证发布者身份”，并非检测到病毒或恶意行为。建议从本仓库 GitHub Actions 产出的安装包安装，并可在首次使用后自行检查文件校验值。
