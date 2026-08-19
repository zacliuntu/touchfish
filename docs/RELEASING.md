# Releasing TouchFish

## Local prerequisites

- Node.js and Corepack
- pnpm version pinned by `packageManager` in `package.json`
- Ubuntu X11 host for Linux live acceptance and `.deb` inspection
- Windows 10/11 x64 host for the NSIS build and real dual-display acceptance

Install exactly the lockfile dependencies and run the complete gate:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm verify` checks formatting, lint, types, tests, and the Electron/Vite production build.

## Package builds

Generate and verify committed icons, then build on the matching operating system:

```bash
pnpm icons
pnpm package:linux
```

```powershell
pnpm icons
pnpm package:win
```

Expected v0.1.0 artifacts are `TouchFish-0.1.0-amd64.deb` and `TouchFish-Setup-0.1.0.exe`. Inspect Debian metadata/dependencies with `dpkg-deb --info` and `dpkg-deb --contents`. Install each artifact in a clean test user or VM.

## CI and release automation

Pull-request and branch CI must run the frozen install and `pnpm verify` on Ubuntu and Windows, then exercise the guarded Electron smoke contract for the host adapter. Release automation must trigger only for a version tag, rebuild artifacts on the two native runners, generate SHA-256 checksums, and attach installers plus the checksums file to the matching GitHub Release.

Treat CI as a reproducibility check, not hardware acceptance. Never place signing secrets in source or logs. v0.1.0 is unsigned.

## Acceptance checklist

- Ubuntu X11: install `.deb`; launch from the application grid; manually use **Add to Favorites**; confirm tray, settings, start-at-login, `Ctrl+Alt+Z`, one-display behavior, two-display behavior, external capture, and uninstall.
- Legacy migration: verify detection is read-only and that the old binding changes only after explicit confirmation. Confirm the old script and config files are never deleted.
- Windows 10/11: install/uninstall NSIS package; confirm SmartScreen guidance and checksum; confirm tray, settings, start-at-login, shortcut, capture, and one-display behavior.
- **Windows dual-display post-release smoke test**: on real hardware, verify primary/secondary placement and the swap option using the exact published installer. Record the Windows build, display topology, result, and artifact SHA-256 in the release notes.
- Three or more displays, when hardware is available: verify distinct selectors and fallback after disconnecting a selected display.
- Confirm no `config.json`, `.invalid` files, logs, web-session data, cookies, caches, screenshots with credentials, or local environment files are tracked.

## Tag and publish

1. Update `CHANGELOG.md` and ensure `package.json` has the intended semantic version.
2. Complete `pnpm verify`, package inspection, installer smoke tests, and the sensitive-data scan.
3. Commit a clean tree and push the release branch.
4. Create and push an annotated `v<version>` tag pointing at the reviewed commit.
5. Let release automation build and draft/publish the GitHub Release; do not upload an unrelated local build under the same name.
6. Download the published assets, independently recompute SHA-256 values, and compare them with the published checksums.
7. Complete the required post-release hardware checks and add results/known gaps to the release notes.

## Rollback

Git tags and released binaries are immutable. If validation fails:

1. Mark the affected GitHub Release as problematic and clearly describe the impact; do not silently replace assets.
2. If exposure is serious, remove affected assets from general availability while retaining an audit note.
3. Revert the offending source change in a new commit, increment the patch version, rerun every gate, and publish a new tag/release.
4. Tell users how to uninstall/downgrade and whether per-user data is compatible. Back up `config.json` before downgrade; schema compatibility is not guaranteed across future versions.
