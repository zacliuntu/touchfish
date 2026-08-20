#!/bin/sh
set -e

sandbox_path='/opt/TouchFish/chrome-sandbox'
if [ -f "$sandbox_path" ]; then
  chown root:root "$sandbox_path"
  chmod 4755 "$sandbox_path"
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
fi

if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q -t /usr/share/icons/hicolor >/dev/null 2>&1 || true
fi

exit 0
