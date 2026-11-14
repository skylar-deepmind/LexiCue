# v0.4.7 发布准备

应用基线：`d2f415dd9a19700a13dadae0c92234f9d57a7eac`，PR #12 已合入 main。本文件记录准备状态，不能作为公开发布证明。

| 范围 | 状态 |
| --- | --- |
| main 合并与同步 | GitHub 和 Local 均为上述 SHA；合并后的 CI 全绿 |
| 发布回归 | 640 前端、430 原生通过；42 原有忽略；lint、生产构建通过 |
| macOS 日常版 | 从上述 main 重建、原位更新、启动并核对查词居中与设置返回；75 张数据表一致 |
| iPhone 本地签名版 | 从同一 main 重建并原位更新；设置返回保持展开词条和原句位置；74 张数据表一致 |
| Android | 同源正式签名 APK 已构建并原位更新，签名/UID 保留，安装 APK 哈希一致；31 张导出表全表一致 |
| Windows | 同源 NSIS 安装包与 updater 签名已构建并上传 Draft；本机无 Windows 真机验收 |
| GitHub Release | v0.4.7 Draft，尚未公开；发布说明见 [0.4.7.md](0.4.7.md) |
| macOS 公开分发 | 就绪检查未通过：Developer ID team / identity 和 Apple API 公证配置未提供；未上传开发签名包充当公开包 |
| 宣发 | 四语 README、手册与 48 张当前组件截图已更新在独立准备分支；中文文案见 marketing/releases/0.4.7.zh-CN.md |
| 页面验收 | 1,084 项浏览器检查通过，覆盖四语、390/1440 宽度及 ocean/midnight；包括无 JavaScript 手册、主题/语言切换和保存演示 |
| 演示可靠性 | 修复重置后就绪消息早于 iframe load、导致重置按钮保持禁用的竞争；同步维护截图与键盘操作回归 |
| 当前公开下载 | 仍为 v0.4.5；iPhone 暂无公开安装包 |

## 公开发布前

1. 将宣发准备 PR 审核合入，核对新 main 与应用构建输入。纯文档和截图变化可按现有回执证明复用；涉及应用输入则重建。
2. 核对 Windows、Android 草稿产物的提交、签名、哈希与验收结果，确认 Draft 未被提前发布。
3. 补齐 macOS Developer ID 签名与公证配置，执行 scripts/macos-release.mjs 的 build / verify，核对 Gatekeeper、staple、包内容及实际启动。
4. 在用户明确要求发布后，按已验证的平台产物发布 Release 并复核 updater feed；随后更新四语下载页中的公开版本状态并验证 Pages 部署。

设备备份、回滚包、安装回执、构建与数据对比记录保存在主 Git common dir 的 lexicue-workflow/reports/main-d2f415dd-release-prep，包含本机资料，不进入仓库或公开 Release。
