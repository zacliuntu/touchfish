# TouchFish Cross-Platform Design

**Date:** 2026-08-18
**Status:** Approved in conversation; awaiting review of this written specification
**Target release:** v0.1.0

## 1. Goal

Build TouchFish as an installable, configurable tray application for Ubuntu X11 and Windows. A global shortcut arranges one or two user-selected targets according to the number of active displays:

- one display: launch, reuse, and maximize only the configured single-display target;
- two displays: place the built-in web target and the external application on separate displays;
- three or more displays: place both targets on user-selected displays, with a safe fallback if a display is disconnected.

The first release must be published to `https://github.com/zacliuntu/touchfish` with source, documentation, automated checks, an Ubuntu `.deb`, a Windows `Setup.exe`, checksums, and a GitHub Release.

## 2. Explicit Scope

### Included

- Electron and TypeScript desktop application named **TouchFish**.
- System tray operation and settings window.
- Configurable global shortcut, defaulting to `Ctrl+Alt+Z`.
- Start-at-login support.
- A secure built-in Chromium web window.
- User selection of an external executable or capture of a currently open window.
- A DingTalk preset and the existing Gitee URL as initial defaults.
- Adaptive one-, two-, and multi-display behavior.
- Simplified Chinese and English UI and documentation.
- Ubuntu 20.04, 22.04, and 24.04 when logged into an Xorg/X11 session.
- Windows 10 and Windows 11.
- MIT License.
- Unsigned Windows installer with a documented SmartScreen warning and SHA-256 checksums.

### Not included in v0.1.0

- GNOME Wayland external-window control.
- Changing the operating system's mirror/extend display mode.
- Changing which monitor is the operating system's primary display.
- macOS support.
- Cloud configuration sync, accounts, telemetry, or automatic updates.
- Signed Windows binaries.

## 3. Chosen Technology

Use Electron, TypeScript, React, and `electron-builder`.

Electron is selected because it provides the same bundled Chromium engine on Ubuntu 20.04 and Windows, and includes maintained APIs for the tray, global shortcuts, application lifecycle, secure web windows, and monitor discovery. Its larger package size, expected to be roughly 100–180 MB, is accepted in exchange for consistent behavior and lower platform risk.

Use `pnpm` for dependency management, Vitest for unit and integration tests, React Testing Library for settings UI behavior, and an Electron smoke-test harness for packaged startup checks.

## 4. Architecture

### 4.1 Main process

The Electron main process owns:

- tray creation and menu actions;
- application single-instance enforcement;
- global shortcut registration and conflict reporting;
- start-at-login configuration;
- settings and web-window lifecycle;
- display discovery;
- scene orchestration and non-overlapping execution;
- configuration persistence and migrations;
- structured diagnostic logging;
- calls into the active platform adapter.

Only the main process may access the filesystem, spawn applications, inspect native windows, or change window placement.

### 4.2 Settings renderer

The settings renderer is an isolated React UI. It communicates through a narrow, typed preload API. It has no direct Node.js access.

The settings page contains:

- web URL, open-test action, and clear-login-data action;
- external executable path, argument list, Select Program, and Capture Current Window actions;
- single-display target selection;
- two-display swap control;
- per-target display selectors when three or more displays are present;
- shortcut recorder and conflict state;
- start-at-login, language, and launch timeout settings;
- current display/window diagnostics and recent execution logs.

### 4.3 Built-in web window

The web target is a dedicated Electron `BrowserWindow` with a persistent, TouchFish-specific session partition. The window reuses its login state across restarts but does not share cookies with the settings UI or external browsers.

It uses:

- `nodeIntegration: false`;
- `contextIsolation: true`;
- sandboxing where supported;
- no preload bridge;
- an allowlist limited to `http:` and `https:` top-level navigation;
- confirmation or external-browser handling for downloads and external protocols.

### 4.4 Scene orchestrator

The orchestrator depends only on typed interfaces for displays, native windows, application launching, notifications, and configuration. It does not contain shell commands or Win32 details.

A trigger is ignored with a user-visible notice while another scene run is active. Every run records a concise result without cookies, credentials, or page contents.

### 4.5 Platform adapters

`LinuxX11Adapter` and `WindowsAdapter` implement the same interface:

- `listDisplays()`;
- `listWindows()`;
- `captureForegroundWindow()`;
- `launchExternalTarget()`;
- `waitForExternalWindow()`;
- `activateMoveAndMaximize()`;
- `notify()`.

The adapter boundary allows the orchestration tests to run against deterministic fixtures.

## 5. Platform Implementation

### 5.1 Ubuntu X11

The `.deb` declares runtime dependencies on `wmctrl` and `x11-xserver-utils`. The adapter uses argument-array process execution, never shell interpolation.

- `xrandr` supplies connected display names, geometry, and primary-display status.
- `wmctrl -lpGx` supplies window IDs, PIDs, geometry, and WM_CLASS.
- `/proc/<pid>/exe` is used when available to confirm the executable path.
- The preferred external window is the largest visible window matching the captured executable and WM_CLASS.
- Placement performs activate, remove maximization, move/resize into the target display working bounds, and restore maximization. Every failure is propagated.

At startup, the application checks `XDG_SESSION_TYPE`. A Wayland session is reported as unsupported for external-window placement instead of attempting unreliable commands.

### 5.2 Windows 10/11

A bundled, versioned PowerShell helper uses .NET P/Invoke for User32 operations:

- `EnumWindows` and `GetWindowThreadProcessId` for enumeration;
- `GetForegroundWindow` for capture;
- process executable path plus visible, non-tool-window attributes for matching;
- `ShowWindowAsync`, `SetWindowPos`, and monitor working bounds for activation, movement, and maximization.

Electron starts the helper with an explicit argument array and consumes versioned JSON on stdout. The helper never evaluates user-provided PowerShell source. The largest matching visible top-level window is preferred.

## 6. Runtime Behavior

### 6.1 First run

The first-run wizard supplies these defaults:

- web URL: `https://e.gitee.com/fairlandgroup/repos/fairlandgroup/localization_module/tree/master`;
- external application: auto-detected DingTalk preset when present;
- shortcut: `Ctrl+Alt+Z`;
- single-display target: built-in web;
- start at login: enabled;
- timeout: 15 seconds;
- language: follow the operating system.

The user may change every default before completing the wizard.

### 6.2 Trigger algorithm

1. Acquire the in-process scene lock.
2. Validate the active configuration and enumerate active displays.
3. Select the behavior for the current display count.
4. Create or reuse only the targets required by that behavior.
5. Launch a missing external target without a shell and wait up to the configured timeout.
6. Match the intended top-level window deterministically.
7. Move and maximize each required target.
8. Emit success or a precise partial/failure notification and record a sanitized log.
9. Release the lock.

### 6.3 One display

Only the configured single-display target is created, reused, moved, and maximized on the sole active display. The other target is not started or moved. If it was already running, TouchFish does not close or hide it.

### 6.4 Two displays

By default, the built-in web window is maximized on the operating system's primary display and the external application is maximized on the non-primary display. A setting swaps the assignments.

### 6.5 Three or more displays

The user selects a target display for each target. Display choices are stored using the most stable platform identifier available together with a readable label and geometry fingerprint.

If a saved display is absent, the web target falls back to the primary display and the external target falls back to the first available non-primary display. TouchFish notifies the user of the fallback. It never places both targets on the same display unless only one display is active and the configured single-display rule applies.

## 7. External Target Configuration

The user can configure an external target in two ways:

1. Select an executable with the native file picker. TouchFish stores the executable path and derives a safe initial process matcher.
2. Capture the currently foreground window. TouchFish stores the executable path, process identity, native class where available, and a non-secret title hint.

For foreground capture, TouchFish displays a short countdown, temporarily hides the settings window, asks the user to focus the desired target, captures that foreground window, and then restores the settings window. Cancelling or capturing a TouchFish-owned window changes no configuration.

The DingTalk preset supplies known launch locations and matchers for supported Linux and Windows installations, but the user can replace them. Launch arguments are stored as a string array and passed directly to process-spawn APIs.

## 8. Configuration and Data

Configuration locations:

- Linux: `${XDG_CONFIG_HOME:-~/.config}/TouchFish/config.json`;
- Windows: `%APPDATA%\TouchFish\config.json`.

The JSON document includes a schema version and contains only settings, matchers, display choices, and UI preferences. Writes use a temporary file, flush, and atomic rename. On parse or validation failure, TouchFish preserves the bad file with a timestamped `.invalid` suffix and loads safe defaults.

The web session, logs, and configuration are stored separately. Logs rotate by size and count and never record cookies, passwords, authorization headers, or page content.

## 9. Legacy Ubuntu Migration

The current machine has a GNOME custom shortcut named `双屏场景` bound to `Ctrl+Alt+Z` and executing `/home/zac/.local/bin/switch-dual-screen-scene`. This binding would prevent Electron from registering the same shortcut.

On Ubuntu, TouchFish detects this exact legacy binding. It offers to import the current Gitee URL and DingTalk defaults, then disables only that exact binding after explicit confirmation. It does not delete the old script or configuration. Unrelated custom shortcuts are never changed.

If any other application owns the requested shortcut, TouchFish reports the conflict and asks the user to choose another combination.

## 10. Localization and Branding

The UI follows the operating-system locale and allows explicit Simplified Chinese or English selection. All user-facing strings are keyed and tested so no mixed-language fallback appears in normal flows.

The product name is **TouchFish** everywhere: app title, tray tooltip, package names, installer, documentation, and release artifacts.

The app uses an original icon depicting a simple turquoise fish between two rounded display panels. SVG is the source asset; deterministic build tooling produces Linux PNG sizes and a Windows ICO. No third-party logo is embedded.

## 11. Packaging and Installation

### Ubuntu

`electron-builder` produces an amd64 `.deb` named like `TouchFish-0.1.0-amd64.deb`. The package:

- installs the application and desktop entry;
- installs icon sizes and refreshes normal desktop caches through package hooks;
- declares `wmctrl` and `x11-xserver-utils` dependencies;
- does not require root after package installation;
- uses the per-user autostart setting managed from TouchFish.

### Windows

`electron-builder` and NSIS produce `TouchFish-Setup-0.1.0.exe`. The default is a per-user install without administrator rights. It creates Start Menu and uninstall entries and configures start-at-login only when enabled by the user.

The installer is unsigned for v0.1.0. Documentation and release notes explicitly describe the expected SmartScreen warning and provide SHA-256 verification instructions.

## 12. Repository and CI/CD

The repository uses a focused structure:

```text
src/
  main/
  preload/
  renderer/
  core/
  platform/linux-x11/
  platform/windows/
tests/
assets/
build/
docs/
.github/workflows/
```

The repository includes:

- MIT `LICENSE`;
- bilingual README and installation instructions;
- contributor/build documentation;
- architecture, security, troubleshooting, and release documentation;
- lockfile and reproducible scripts;
- no credentials, cookies, or local configuration.

GitHub Actions runs linting, type checking, tests, and builds on Linux and Windows. Pull-request and branch workflows retain build artifacts for inspection. A `v*` tag runs the release workflow, creates the GitHub Release, uploads the `.deb`, `Setup.exe`, a checksums file, and bilingual release notes.

## 13. Test Strategy

### Core tests

- one-, two-, and multi-display decisions;
- single-display target choice;
- two-display swap;
- multi-display saved mapping and disconnected-display fallback;
- scene locking and repeated triggers;
- partial failures and timeout behavior;
- configuration validation, atomic writes, invalid-file recovery, and migration;
- URL protocol restrictions and safe argument passing;
- localization completeness.

### Platform adapter tests

- Linux parsers use recorded `xrandr` and `wmctrl` fixtures covering negative coordinates, primary detection, duplicate classes, missing PIDs, and command failures.
- Windows helper tests cover JSON contracts, foreground capture, process matching, largest-window selection, working-area geometry, and Win32 failure propagation.
- Command execution is mocked in unit tests; no test success depends on the developer's current desktop layout.

### UI and Electron tests

- settings fields, validation, capture flow, language switching, and conflict states;
- preload API allowlist;
- settings and web windows start with required security preferences;
- packaged application smoke-start on both CI operating systems.

### Live acceptance

- On the current Ubuntu X11 machine, install the generated `.deb` and verify tray presence, settings, autostart entry, shortcut registration, legacy shortcut migration, web login persistence, and real two-display placement.
- Verify single- and multi-display behavior through adapter integration fixtures; do not disable the current display and risk breaking the desktop or remote connection.
- On Windows CI, run all automated tests and build the installer. Windows dual-display GUI behavior remains an explicit post-release smoke test because no Windows test machine is currently available.

## 14. Verifiable Completion Criteria

The v0.1.0 task is complete only when all of the following evidence exists:

1. The full source and reviewed documentation are on the default branch of `zacliuntu/touchfish`.
2. The MIT license, bilingual README, installation, uninstallation, configuration, security, and troubleshooting documentation are present.
3. Linux and Windows CI jobs pass linting, type checking, tests, and packaged startup smoke checks.
4. The release workflow creates both `TouchFish-0.1.0-amd64.deb` and `TouchFish-Setup-0.1.0.exe` plus SHA-256 checksums.
5. The `.deb` installs on the current Ubuntu X11 machine and the real tray, settings, shortcut, migration, and two-display workflow are observed working.
6. Automated tests prove the one-display and three-or-more-display decision paths without changing the current live display topology.
7. The GitHub `v0.1.0` Release exposes both installers, checksums, SmartScreen disclosure, X11 limitation, and bilingual release notes.
8. The handoff explicitly states that Windows automated verification and packaging passed but Windows dual-display real-hardware verification remains for the user's post-release smoke test.

Passing a narrower unit test, producing source without installers, or uploading files without a green release workflow does not satisfy the task.
