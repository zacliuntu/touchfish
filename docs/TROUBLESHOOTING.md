# Troubleshooting

[中文](TROUBLESHOOTING.zh-CN.md) · [Back to README](../README.md)

## TouchFish says X11 is required

Run `echo "$XDG_SESSION_TYPE"`. If it is not `x11`, sign out and select **Ubuntu on Xorg** from the login-screen gear menu. Remote-desktop and nested sessions must also expose a valid `DISPLAY`.

## The shortcut does nothing

- Open settings from the tray and save the shortcut again. TouchFish reports a conflict if another application already owns it.
- On Ubuntu, inspect the system keyboard-shortcut settings for another `Ctrl+Alt+Z` binding.
- If the old screen-scene binding exists, complete the offered migration only if you want TouchFish to disable that exact old binding. No change occurs without explicit confirmation.
- Make sure TouchFish is still present in the tray; closing settings does not quit it, but choosing **Quit** does.

## The external app is not found or moved

Use **Capture foreground window**, switch to the desired application during the 3-2-1 countdown, save, and try again. Increase the launch timeout if the app starts slowly. If several visible windows belong to the same executable, close unrelated ones and capture the intended window again.

On Ubuntu, `wmctrl -lx` can confirm whether the window manager exposes the target. On Windows, run the installed application as the same user/elevation level as the target; Windows can prevent a non-elevated process from controlling an elevated window.

## Displays are assigned incorrectly

After connecting, disconnecting, or changing displays, Quit TouchFish from the tray and restart it, then open settings from the tray so the renderer loads the current IDs. Reopening the hidden settings window without restarting does not refresh that initial list. For two displays, verify the operating system's primary-display setting and the **Swap display assignments** option. For three or more displays, select two distinct current IDs. Disconnecting/reconnecting hardware can change IDs and cause the documented fallback.

## Web login or page behavior is broken

Only HTTP(S) pages are accepted. Downloads, permission requests, and in-app popups are intentionally blocked. Use **Clear web and login data**, sign in again, and retry. Links opened in a new window work only for HTTPS and are handed to the default browser.

## Start at login does not work

Toggle **Start at Login** off and on from settings or the tray. Ubuntu writes `$XDG_CONFIG_HOME/autostart/touchfish.desktop` or `~/.config/autostart/touchfish.desktop`; check that the current user can read it. Windows uses a per-user login item, so check Task Manager's Startup apps.

## Recover a broken configuration

Quit from the tray and follow [Reset and recovery](CONFIGURATION.md#reset-and-recovery). TouchFish automatically renames invalid configuration to a timestamped `.invalid` file. Do not publish that file without reviewing executable paths and other local details.

## Collect diagnostics

To refresh the in-app list, reproduce the scene, quit TouchFish from the tray, restart it, and then open **Diagnostics** from the tray settings. Wait for the scene's final notification before quitting. The renderer loads diagnostics only when it initializes. Logs are at `<user-data>/logs/touchfish.log` and rotate through `.4`. Include the app version, OS version, session type, display count, the final scene status, and sanitized relevant log lines in a bug report. Never include cookies, passwords, tokens, local configuration, or the web-session directory.

For release and installer problems, also record the installer's SHA-256. Windows dual-display results must say whether they came from the required post-release real-hardware smoke test.
