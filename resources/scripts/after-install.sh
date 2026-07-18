#!/usr/bin/env bash
# post-install hook for .deb packages
# Runs as root after files are unpacked into ${DPKG_ROOT:-/}.

set -euo pipefail

# Refresh desktop / icon caches so the launcher shows up immediately
# after install without logging out and back in.
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database -q /usr/share/applications || true
fi

if command -v update-mime-database >/dev/null 2>&1; then
    update-mime-database /usr/share/mime || true
fi

if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
fi

exit 0