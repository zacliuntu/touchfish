# Architecture

## Process layout

TouchFish is an Electron application with three layers:

1. The React settings renderer displays configuration and diagnostics. It can call only the typed API exposed by preload.
2. The main process owns configuration, tray, shortcut, autostart, migration, logging, windows, and IPC. It is the composition root and selects one platform adapter after Electron is ready.
3. Platform adapters implement display enumeration, native-window discovery/capture, external launch, move/maximize, and notifications.

The web target is a separate main-process-controlled `BrowserWindow`, not content embedded in settings.

## Platform adapter boundary

`src/main/platform/adapter.ts` defines the shared `PlatformAdapter`. `linux-x11/adapter.ts` translates it to `xrandr`, `wmctrl`, `/proc`, and `xprop`; `windows/adapter.ts` combines Electron display data with the packaged PowerShell/Win32 helper. Platform modules are dynamically imported so code for the wrong operating system is not initialized.

`scene-plan.ts` is pure policy: one display yields one placement, two yield the default/swapped pair, and three or more use valid saved distinct IDs or a deterministic fallback. `scene-orchestrator.ts` executes that plan, starts/matches the external application, tolerates partial failure, and emits structured outcomes.

## State and lifecycle

`ConfigStore` validates schema version 1 and atomically replaces `config.json`. Invalid data is backed up. `LogStore` writes redacted JSON lines with bounded rotation. The web window uses the persistent `persist:touchfish-web` partition.

Only one application instance is allowed. A second launch focuses settings. `--hidden` starts tray-only; `--run-scene` runs once after readiness. Closing settings hides it, while tray **Quit** disposes shortcuts, IPC, windows, and tray resources.

Autostart state is coordinated between configuration and the OS. Ubuntu uses a per-user XDG autostart desktop entry; Windows uses Electron login-item settings.

## IPC and web security

`src/shared/ipc.ts` is the single IPC contract. Preload validates responses, and main handlers validate requests and responses. Renderers receive no raw Electron or Node API. Both settings and web windows use `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.

The web controller accepts only HTTP(S), denies child windows and downloads, denies permission requests/checks, and opens only HTTPS child-window requests in the system browser. See [Security](SECURITY.md).

## Repository map

- `src/main/core`: display policy and orchestration
- `src/main/platform`: OS adapters and command boundary
- `src/main/services`: shortcut, tray, autostart, logs, and legacy migration
- `src/main/windows`: hardened settings and web windows
- `src/preload`: typed renderer bridge
- `src/renderer`: bilingual settings UI
- `src/shared`: models, IPC schemas, and translations
- `resources`: source icon and packaged Windows helper
- `build`: generated icons and package hooks
- `scripts`: deterministic build/release helpers
