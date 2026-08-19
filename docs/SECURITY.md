# Security

## Reporting a vulnerability

Do not open a public issue containing credentials, cookies, or an exploitable proof of concept. Report the problem privately to the repository owner through GitHub's private vulnerability reporting when available. Include the affected version, platform, impact, and minimal reproduction. Remove local paths, account details, and web-session data.

## Trust boundaries

- The settings renderer has context isolation and Chromium sandboxing enabled, with Node integration disabled.
- The preload exposes a narrow API. Main-process IPC handlers validate every request and response with explicit schemas.
- The target web page runs in a separate persistent `touchfish-web` partition with context isolation, no Node integration, and sandboxing.
- Target web pages cannot open an in-app child window, download files, or obtain Chromium permissions. Only HTTPS new-window links may be passed to the external browser; non-HTTP(S) navigation is blocked.
- External executables are launched with argument arrays, `shell: false`, and no inherited standard streams. Windows helper requests use fixed PowerShell arguments and base64-encoded, schema-validated JSON rather than interpolated commands.
- Linux window operations use fixed `wmctrl`, `xrandr`, and `xprop` argument arrays.

## Local data

Configuration, diagnostic logs, cookies, and login state remain in Electron's per-user data directory. Configuration files are written atomically with user-only modes where the platform supports them. Logs redact values under keys matching cookie/password/authorization/token, but can still disclose window titles, executable paths, and display IDs.

Never commit or attach `config.json`, timestamped `.invalid` files, logs, Chromium web data, cookies, cache, or local environment files. Review every diagnostic excerpt manually before sharing it.

Clearing web/login data removes storage for the dedicated web partition. It does not clear the default browser or reset TouchFish configuration.

## Package trust

v0.1.0 installers are not code-signed. Publish installers only through the repository's GitHub Release and publish SHA-256 checksums alongside them. Users should not bypass SmartScreen until the checksum matches. Release automation and pinned dependencies reduce accidental variance but do not replace signing; future releases should add platform signing when credentials are available.

## Scope and limitations

TouchFish necessarily observes top-level window metadata and moves windows on the current desktop. It does not attempt privilege escalation. On Windows it may be unable to control elevated applications. Ubuntu support is intentionally restricted to X11; attempting to weaken the Wayland boundary is not a supported workaround.
