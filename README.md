# TouchFish

[简体中文](README.zh-CN.md)

TouchFish is a small tray application that opens one web target and one external application, then arranges the requested target or targets across the displays currently connected. The default global shortcut is `Ctrl+Alt+Z` (`CommandOrControl+Alt+Z` in the configuration).

## Platform support

| Platform | v0.1.0 support                                 |
| -------- | ---------------------------------------------- |
| Ubuntu   | **Ubuntu X11 only**. Wayland is not supported. |
| Windows  | **Windows 10/11**, 64-bit.                     |

The Windows package is currently an **unsigned installer**. Windows may show a **SmartScreen** warning; verify the release checksum before choosing **More info → Run anyway**. A real-hardware **Windows dual-display post-release smoke test** is required before calling a release fully validated on Windows.

## What it does

- One display: puts only the configured web target or only the configured external target on that display.
- Two displays: puts the web target on the primary display and the external target on the other display; the assignment can be swapped.
- Three or more displays: lets you choose separate displays for the web and external targets. If saved displays are unavailable, TouchFish falls back to the primary and first available non-primary display.
- Captures the foreground external window so matching remains useful after a restart.
- Runs from the tray, supports start at login, and uses a configurable global shortcut.

## Quick start

1. Install the `.deb` on Ubuntu or run the Windows NSIS installer from the GitHub Release.
2. On first launch, set the web URL and choose or capture the external application.
3. Check the display rules and shortcut, then save.
4. Press `Ctrl+Alt+Z`, choose **Run Scene** from the tray, or use **Run Scene** in settings.

On Ubuntu, the package supplies the `touchfish.desktop` application association. To pin it, launch TouchFish or find it in the application grid, right-click its icon, and choose **Add to Favorites**. TouchFish does not alter the favorites list automatically.

## Documentation

- [Install and uninstall](docs/INSTALL.md)
- [Configuration and operation](docs/CONFIGURATION.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Security model](docs/SECURITY.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Release process](docs/RELEASING.md)
- [Changelog](CHANGELOG.md)
- [License](LICENSE)

## Development

Requires Node.js, Corepack, and the pinned pnpm version from `package.json`.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
pnpm verify
```

Build installers with `pnpm package:linux` on Ubuntu and `pnpm package:win` on Windows. See the [release guide](docs/RELEASING.md) for the full validation and publishing procedure.
