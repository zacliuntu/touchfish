# Changelog

All notable changes to TouchFish are documented here. This project follows Semantic Versioning.

## [0.1.0] - 2026-08-19

### Added

- Cross-platform Electron tray application for Ubuntu X11 and Windows 10/11 x64.
- `Ctrl+Alt+Z` scene execution with configurable shortcut and start-at-login support.
- Adaptive one-, two-, and multi-display placement for a web target and an external application.
- Foreground-window capture, external launch/matching, bounded diagnostics, and bilingual settings.
- Explicit-confirmation migration for the exact legacy Ubuntu screen-scene binding.
- Deterministic TouchFish branding, Ubuntu `.deb`, and Windows NSIS packaging configuration.

### Known limitations

- Ubuntu Wayland is unsupported.
- Windows installers are unsigned and require a post-release real-hardware dual-display smoke test.
- Only x64 installers are produced.

[0.1.0]: https://github.com/zacliuntu/touchfish/releases/tag/v0.1.0
