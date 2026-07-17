#!/usr/bin/env bash
# Native Wayland + fcitx5 IME for Grok Build desktop.
# Usage: ./scripts/run-wayland.sh [dev|preview]
set -euo pipefail
cd "$(dirname "$0")/.."

export ELECTRON_OZONE_PLATFORM_HINT="${ELECTRON_OZONE_PLATFORM_HINT:-wayland}"
export GROK_DESKTOP_OZONE="${GROK_DESKTOP_OZONE:-wayland}"
export XMODIFIERS="${XMODIFIERS:-@im=fcitx}"
export GTK_IM_MODULE="${GTK_IM_MODULE:-fcitx}"
export QT_IM_MODULE="${QT_IM_MODULE:-fcitx}"
export SDL_IM_MODULE="${SDL_IM_MODULE:-fcitx}"

# Ensure fcitx5 is up (no-op if already running).
if command -v fcitx5 >/dev/null 2>&1; then
  if ! pgrep -x fcitx5 >/dev/null 2>&1; then
    fcitx5 -d >/dev/null 2>&1 || true
  fi
fi

mode="${1:-dev}"
case "$mode" in
  dev) exec pnpm dev:wayland ;;
  preview) exec env ELECTRON_OZONE_PLATFORM_HINT=wayland pnpm preview ;;
  *)
    echo "usage: $0 [dev|preview]" >&2
    exit 2
    ;;
esac
