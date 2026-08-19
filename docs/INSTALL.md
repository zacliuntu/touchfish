# Install and uninstall

[中文](INSTALL.zh-CN.md) · [Back to README](../README.md)

## Requirements

- x64 Ubuntu in an X11 session. Wayland is rejected at startup because v0.1.0 uses `xrandr`, `wmctrl`, and `xprop`. Treat a specific Ubuntu release as validated only when the release notes contain its real-machine acceptance record.
- Windows 10/11, 64-bit.

## Verify a download

Download installers only from the repository's GitHub Release. Compare the published SHA-256 value before running an installer.

Ubuntu:

```bash
sha256sum TouchFish-0.1.0-amd64.deb
```

Windows PowerShell:

```powershell
Get-FileHash .\TouchFish-Setup-0.1.0.exe -Algorithm SHA256
```

The output must exactly match the corresponding entry in the release checksums file.

## Ubuntu

Confirm the current session before installation:

```bash
echo "$XDG_SESSION_TYPE"
```

It must print `x11`. If it prints `wayland`, sign out, select your account, use the gear menu to choose **Ubuntu on Xorg**, then sign in again.

Install the package and dependencies:

```bash
sudo apt install ./TouchFish-0.1.0-amd64.deb
```

Launch **TouchFish** from the application grid. The package provides the `touchfish.desktop` application association. To pin it to the Ubuntu dock, right-click the running icon or its application-grid icon and choose **Add to Favorites**. The installer intentionally does not edit the user's favorites.

Uninstall the application:

```bash
sudo apt remove touchfish
```

Uninstallation does not remove per-user configuration, logs, or web login data. See [reset and recovery](CONFIGURATION.md#reset-and-recovery) if those must also be removed.

## Windows

Run `TouchFish-Setup-0.1.0.exe`. The installer is per-user, lets you change the installation directory, and creates a Start menu shortcut but no desktop shortcut.

The v0.1.0 installer is unsigned. If SmartScreen blocks it, first verify the SHA-256 from the GitHub Release, then choose **More info → Run anyway**. Do not bypass the warning for a file from another source or with a mismatched checksum.

Uninstall from **Settings → Apps → Installed apps → TouchFish → Uninstall**. Per-user configuration, logs, and web login data may remain so an upgrade or reinstall can retain settings.

## First launch

The first launch opens settings. Configure the URL, external target, screen rules, shortcut, language, timeout, and start-at-login option. Closing the settings window hides it; use **Quit** in the tray menu to stop TouchFish completely.
