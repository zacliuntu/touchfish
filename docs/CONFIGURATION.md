# Configuration and operation

[中文](CONFIGURATION.zh-CN.md) · [Back to README](../README.md)

## Running a scene

Save settings before running a scene. Trigger it with the configured global shortcut (default `Ctrl+Alt+Z`), **Run Scene** in settings, or **Run Scene** in the tray menu. TouchFish ignores a second trigger while a scene is already running and reports success, partial completion, or failure through a system notification and diagnostics log.

The tray menu contains **Open Settings**, **Run Scene**, **Start at Login**, and **Quit**. Closing settings only hides the window.

## Targets

The web URL must use `http://` or `https://`. The web window keeps a dedicated persistent login session. Pop-up windows and downloads are blocked; HTTPS links that request a new window are sent to the system browser.

For the external target, either choose an executable or enter its path and argument list. **Capture foreground window** starts a visible 3-2-1 countdown, temporarily hides settings, then records the foreground window's executable/process identity. Switch to the desired window before the countdown ends. TouchFish refuses to capture one of its own windows.

On the first run, TouchFish fills a DingTalk preset when the external target is still empty and it finds a known installed launcher or a currently visible DingTalk window. You can replace that preset with any executable supported by the operating system.

If no matching external window exists when a scene runs, TouchFish launches the configured executable without a shell and polls for the matching window until the configured timeout (1–120 seconds).

## Display rules

- One display: exactly one target is placed. Choose **Web** or **External app** under **Single-display target**.
- Two displays: web defaults to the primary display and the external app to the other display. Enable **Swap display assignments** to reverse them.
- Three or more displays: choose distinct display IDs for web and external targets. If a saved display has disappeared or both saved IDs are unusable, TouchFish uses the primary display for web and the first available non-primary display for the external app, and reports the fallback.

TouchFish uses each display's work area, so desktop panels/taskbars are excluded. It activates, moves, and maximizes the target windows; it does not change monitor resolution, orientation, or which monitor is primary.

## Legacy `Ctrl+Alt+Z` migration on Ubuntu

On first run, TouchFish can recognize only the exact previous setup:

- GNOME binding path `/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/screen-scene/`
- name `双屏场景`
- command `/home/zac/.local/bin/switch-dual-screen-scene`
- binding `<Primary><Alt>z`
- URL source `/home/zac/.config/screen-scene/config`

Detection is read-only. The old binding is disabled and its URL imported **only after the user explicitly confirms the migration prompt**. Dismissing or declining the prompt leaves the old script, config, and binding unchanged. The migration removes only the exact legacy binding from GNOME's binding array; it does not delete the legacy script or config. Failed writes are rolled back when possible.

## Configuration and data paths

TouchFish stores `config.json`, logs, and the persistent `touchfish-web` session below Electron's per-user data directory:

- Ubuntu default: `~/.config/TouchFish/`
- Windows default: `%APPDATA%\TouchFish\`

On Linux, setting `XDG_CONFIG_HOME` changes Electron's user-data base. Start-at-login uses `~/.config/autostart/touchfish.desktop` by default, or `$XDG_CONFIG_HOME/autostart/touchfish.desktop` when set. Windows uses the current user's login-item registration.

The configuration schema includes the web URL, external executable/arguments/window matcher, shortcut, start-at-login state, timeout, language, one-display target, two-display swap flag, multi-display IDs, and first-run state. Edit it through the settings UI. Direct edits made while TouchFish is running may be overwritten.

## Reset and recovery

1. Choose **Quit** from the tray.
2. Make a backup of the user-data directory.
3. Rename `config.json` to `config.json.backup` to reset settings, then restart TouchFish.

Missing configuration is recreated with defaults. Malformed or schema-invalid configuration is renamed automatically to `config.json.<timestamp>.invalid`, and defaults are loaded. Use the settings page's **Clear web and login data** action to clear the dedicated web session without resetting other settings.

For a full local reset, uninstall or quit TouchFish, retain a backup if needed, and remove only the TouchFish user-data directory shown above. This deletes configuration, logs, cookies, and web login state and cannot be undone without the backup.

## Logs

Recent structured JSON-lines logs appear under **Diagnostics** and on disk at `<user-data>/logs/touchfish.log`. Logs rotate at approximately 1 MiB and retain up to five files (`touchfish.log` through `.4`). Fields whose names contain `cookie`, `password`, `authorization`, or `token` are replaced with `[REDACTED]`, but logs can still contain display IDs, paths, and window titles; review them before sharing.

## v0.1.0 limits

- Ubuntu Wayland and other Linux desktops are unsupported; Ubuntu X11 is required.
- Only 64-bit Ubuntu `.deb` and Windows NSIS artifacts are produced.
- Windows packages are unsigned, and real Windows dual-display behavior needs a post-release hardware smoke test.
- TouchFish does not switch mirror/extend mode, change the operating system's primary display, or change display resolution/orientation.
- TouchFish arranges one web target and one external target; it is not a general multi-window layout editor.
- External-window discovery depends on operating-system window metadata and can be ambiguous when several visible windows share the same identity.
- macOS, cloud sync, telemetry, automatic updates, and code-signed binaries are not included.
