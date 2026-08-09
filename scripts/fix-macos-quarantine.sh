#!/usr/bin/env bash
set -euo pipefail

# Fix macOS Gatekeeper quarantine on the (unsigned) LexiCue app bundle.
#
# Unsigned apps downloaded from the internet get the com.apple.quarantine
# extended attribute, which makes macOS report them as "damaged" or "from an
# unidentified developer". Removing the attribute is safe and only needs to be
# done once per downloaded copy of the app.

APP_PATH="${1:-/Applications/LexiCue.app}"

if [ ! -d "$APP_PATH" ]; then
  echo "错误：未找到应用 $APP_PATH" >&2
  echo "请确认已将 LexiCue.app 拖入「应用程序」文件夹，或指定正确路径：" >&2
  echo "  bash $0 /path/to/LexiCue.app" >&2
  exit 1
fi

echo "正在移除隔离标记：$APP_PATH"

if command -v xattr >/dev/null 2>&1; then
  xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null || true
else
  echo "错误：未找到 xattr 命令，请使用右键「打开」方式安装。" >&2
  exit 1
fi

if xattr -r "$APP_PATH" 2>/dev/null | grep -q com.apple.quarantine; then
  echo "警告：仍有隔离属性残留，建议右键 →「打开」一次以完成授权。" >&2
  exit 1
fi

echo "完成！现在可以正常打开 LexiCue 了。"
