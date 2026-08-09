# 安装与常见问题

LexiCue 的预编译安装包由 [GitHub Actions](.github/workflows/build-installers.yml) 手动触发构建。由于目前尚未购买 Apple Developer / Windows 代码签名证书 / Google Play 开发者账号，安装包暂时为**未签名版本**，各平台系统会给出安全拦截提示，属预期行为。

以下按平台说明正确的安装方法。**每个安装包副本只需处理一次**，之后可正常使用。

---

## macOS

### 现象

打开 App 或 DMG 时出现：

- 「“LexiCue”已损坏，无法打开。你应该将它移到废纸篓。」
- 「无法打开“LexiCue”，因为 Apple 无法检查其是否包含恶意软件。」

### 原因

通过浏览器/Safari/邮件下载的文件会被 macOS 打上隔离标记（`com.apple.quarantine`）。系统校验发现 App 未签名、未公证，便拦截打开并提示“已损坏”。

### 安装步骤

1. 双击 DMG，将 **LexiCue.app** 拖入「应用程序」（Applications）文件夹。
2. 用任一方式移除隔离标记（**任选其一即可**，每个副本只需一次）：

   **方式 A：一键脚本（推荐）**

   ```bash
   bash scripts/fix-macos-quarantine.sh
   ```

   > 脚本默认修复 `/Applications/LexiCue.app`；若 App 在其他位置，可传入路径：
   > `bash scripts/fix-macos-quarantine.sh /path/to/LexiCue.app`

   **方式 B：命令行**

   ```bash
   xattr -dr com.apple.quarantine "/Applications/LexiCue.app"
   ```

   **方式 C：右键打开**

   在「应用程序」中按住 **Control** 并点击 **LexiCue**，选择「打开」，然后在弹窗中点击「打开」。

3. 首次启动后即可正常使用。之后每次打开不会再提示。

> 若系统设置里仍拦截，可前往 **系统设置 → 隐私与安全性**，在「安全性」区块点击 **仍要打开**。

> 什么时候需要再次处理？只有在你**重新下载、换新电脑、或删除后再次从 DMG 拖出新副本**时，新副本会重新被打上隔离标记，届时需再执行一次上面的命令。

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
