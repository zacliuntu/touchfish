# TouchFish v0.1.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, package, verify, and publish TouchFish v0.1.0 as a configurable tray application that places a secure built-in web target and an external application across one or more displays on Ubuntu X11 and Windows.

**Architecture:** Electron owns the tray, secure settings/web windows, global shortcut, configuration, and scene orchestration. Pure TypeScript policy and orchestration code depend on a typed platform adapter; Ubuntu X11 uses `xrandr`/`wmctrl`, while Windows uses a bundled PowerShell/User32 JSON helper. React provides an isolated bilingual settings UI through a narrow preload bridge.

**Tech Stack:** Electron 43.4.0, Electron Vite 5.0.0, TypeScript 7.0.2, React 19.2.8, Zod 4.4.3, i18next 26.3.6, Vitest 4.1.10, Testing Library 16.3.2, electron-builder 26.15.3, pnpm 10.33.0, PowerShell/User32, `xrandr`, `wmctrl`.

---

## File map

```text
package.json                         scripts, dependencies, package metadata
pnpm-lock.yaml                       reproducible dependency graph
electron.vite.config.ts              main/preload/renderer build configuration
electron-builder.yml                 deb and NSIS packaging configuration
eslint.config.mjs                    lint rules
tsconfig.json                        shared TypeScript constraints
src/shared/models.ts                 configuration and platform-neutral types
src/shared/ipc.ts                    typed preload contract and IPC channel names
src/shared/i18n/{en,zh-CN}.ts         all user-facing strings
src/main/config/schema.ts            defaults and runtime validation
src/main/config/store.ts             atomic persistence, recovery, migration
src/main/core/scene-plan.ts           pure display-count placement policy
src/main/core/scene-orchestrator.ts   lock, launch/wait/place workflow
src/main/platform/adapter.ts          platform interface
src/main/platform/command.ts          argument-array child process runner
src/main/platform/linux-x11/*.ts      xrandr/wmctrl parsing and placement
src/main/platform/windows/*.ts        PowerShell helper wrapper and parsing
resources/windows/window-helper.ps1   User32 implementation and JSON contract
src/main/windows/settings-window.ts   secure settings window
src/main/windows/web-window.ts        isolated persistent remote web window
src/main/services/*.ts                tray, shortcut, autostart, migration, logs
src/main/ipc.ts                       validated IPC handlers
src/main/index.ts                     application composition root
src/preload/index.ts                  minimal contextBridge surface
src/renderer/src/*.tsx                settings UI
src/renderer/src/styles.css           settings UI layout and states
tests/fixtures/*                      deterministic xrandr/wmctrl/helper samples
scripts/generate-icons.mjs            SVG to PNG/ICO asset pipeline
resources/icon.svg                    original TouchFish source icon
build/icons/*                         generated installer and desktop icons
docs/*.md                             bilingual user and maintainer docs
.github/workflows/ci.yml              Linux/Windows checks and build artifacts
.github/workflows/release.yml         tagged GitHub Release publication
```

## Task 1: Bootstrap the reproducible Electron project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `electron.vite.config.ts`
- Create: `vitest.config.ts`
- Create: `eslint.config.mjs`
- Create: `.prettierrc.json`
- Create: `.gitignore`
- Create: `src/main/index.ts`
- Create: `src/preload/index.ts`
- Create: `src/renderer/index.html`
- Create: `src/renderer/src/main.tsx`
- Create: `src/renderer/src/App.tsx`

- [ ] **Step 1: Add exact package metadata and scripts**

Create `package.json` with `name: "touchfish"`, `productName: "TouchFish"`, `version: "0.1.0"`, `type: "module"`, `main: "out/main/index.js"`, `packageManager: "pnpm@10.33.0"`, and these scripts:

```json
{
  "start": "electron-vite preview",
  "dev": "electron-vite dev",
  "build": "electron-vite build",
  "typecheck": "tsc --noEmit",
  "lint": "eslint .",
  "format:check": "prettier --check .",
  "test": "vitest run",
  "test:watch": "vitest",
  "icons": "node scripts/generate-icons.mjs",
  "package:linux": "pnpm build && electron-builder --linux deb --x64",
  "package:win": "pnpm build && electron-builder --win nsis --x64",
  "verify": "pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build"
}
```

Pin the versions from the plan header. Add runtime dependencies `i18next`, `react`, `react-dom`, `react-i18next`, and `zod`. Add development dependencies for Electron, Electron Vite, electron-builder, Vite, TypeScript, Vitest, ESLint, TypeScript ESLint, React testing, jsdom, Prettier, Sharp, and `png-to-ico`.

- [ ] **Step 2: Add strict build configuration**

Set `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`, `noFallthroughCasesInSwitch`, and `noImplicitOverride` in `tsconfig.json`. Configure Electron Vite with main, preload, and React renderer entries. Configure `vitest.config.ts` for Node by default, jsdom for renderer tests through per-file annotations, coverage of `src`, and exclusion of generated output. Configure ESLint for TypeScript/React and exclude `out`, `dist`, and `release`.

- [ ] **Step 3: Add the smallest secure boot shell**

Use this main-process baseline:

```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

function createSettingsWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 960,
    height: 720,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
  return window
}

void app.whenReady().then(createSettingsWindow)
app.on('window-all-closed', () => undefined)
```

Keep the preload empty and render a literal `TouchFish` heading in React. This is only a buildable shell; later tasks replace composition details.

- [ ] **Step 4: Install and verify the baseline**

Run:

```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
```

Expected: every command exits 0 and Electron Vite creates `out/main`, `out/preload`, and `out/renderer`.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json electron.vite.config.ts vitest.config.ts eslint.config.mjs .prettierrc.json .gitignore src
git commit -m "chore: bootstrap TouchFish Electron app"
```

## Task 2: Define configuration and platform-neutral contracts

**Files:**
- Create: `src/shared/models.ts`
- Create: `src/main/config/schema.ts`
- Create: `src/main/config/schema.test.ts`
- Create: `src/main/platform/adapter.ts`

- [ ] **Step 1: Write failing schema tests**

Cover the defaults and rejections explicitly:

```ts
import { describe, expect, it } from 'vitest'
import { configSchema, defaultConfig } from './schema'

describe('config schema', () => {
  it('defaults to the approved first-run values', () => {
    expect(defaultConfig.web.url).toBe('https://e.gitee.com/fairlandgroup/repos/fairlandgroup/localization_module/tree/master')
    expect(defaultConfig.shortcut).toBe('CommandOrControl+Alt+Z')
    expect(defaultConfig.singleDisplayTarget).toBe('web')
    expect(defaultConfig.startAtLogin).toBe(true)
    expect(defaultConfig.timeoutSeconds).toBe(15)
  })

  it.each(['file:///tmp/a', 'javascript:alert(1)', ''])('rejects unsafe URL %s', (url) => {
    expect(configSchema.safeParse({ ...defaultConfig, web: { url } }).success).toBe(false)
  })

  it('rejects shell-shaped arguments only when they are not an array', () => {
    const value = { ...defaultConfig, external: { ...defaultConfig.external, args: '--unsafe' } }
    expect(configSchema.safeParse(value).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests and confirm RED**

Run `pnpm test src/main/config/schema.test.ts`.

Expected: FAIL because `schema.ts` does not exist.

- [ ] **Step 3: Implement the complete shared model**

Define these stable types in `src/shared/models.ts`:

```ts
export type TargetKind = 'web' | 'external'
export type AppLanguage = 'system' | 'zh-CN' | 'en'

export interface Rect { x: number; y: number; width: number; height: number }
export interface DisplayInfo { id: string; label: string; primary: boolean; bounds: Rect; workArea: Rect }
export interface WindowMatcher { executablePath: string; processName: string; nativeClass?: string; titleHint?: string }
export interface NativeWindow { id: string; pid: number; title: string; nativeClass?: string; executablePath?: string; bounds: Rect; visible: boolean }
export interface ExternalTarget { executablePath: string; args: string[]; matcher: WindowMatcher | null }
export interface TouchFishConfig {
  schemaVersion: 1
  web: { url: string }
  external: ExternalTarget
  shortcut: string
  startAtLogin: boolean
  timeoutSeconds: number
  language: AppLanguage
  singleDisplayTarget: TargetKind
  swapOnTwoDisplays: boolean
  multiDisplayTargets: { webDisplayId: string | null; externalDisplayId: string | null }
  firstRunComplete: boolean
}

export interface PlatformAdapter {
  readonly kind: 'linux-x11' | 'windows'
  listDisplays(): Promise<DisplayInfo[]>
  listWindows(): Promise<NativeWindow[]>
  captureForegroundWindow(): Promise<NativeWindow | null>
  launchExternal(target: ExternalTarget): Promise<void>
  moveAndMaximize(windowId: string, display: DisplayInfo): Promise<void>
  notify(title: string, body: string): void
}
```

Implement the Zod schema with URL refinement using `new URL(value)` and an exact `http:`/`https:` protocol check. Validate timeout as an integer from 1 through 120 and export a deeply immutable `defaultConfig` matching the approved defaults.

- [ ] **Step 4: Run tests and type checking**

Run:

```bash
pnpm test src/main/config/schema.test.ts
pnpm typecheck
```

Expected: schema tests pass and TypeScript exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/shared/models.ts src/main/config src/main/platform/adapter.ts
git commit -m "feat: define TouchFish configuration contracts"
```

## Task 3: Implement the pure display-count scene policy

**Files:**
- Create: `src/main/core/scene-plan.ts`
- Create: `src/main/core/scene-plan.test.ts`

- [ ] **Step 1: Write failing policy tests**

Create fixtures for one primary display, a primary plus secondary, and three displays. Assert:

```ts
expect(planScene(oneDisplay, config).placements).toEqual([{ target: 'web', displayId: 'primary' }])
expect(planScene(oneDisplay, { ...config, singleDisplayTarget: 'external' }).placements).toEqual([{ target: 'external', displayId: 'primary' }])
expect(planScene(twoDisplays, config).placements).toEqual([
  { target: 'web', displayId: 'primary' },
  { target: 'external', displayId: 'secondary' }
])
expect(planScene(twoDisplays, { ...config, swapOnTwoDisplays: true }).placements).toEqual([
  { target: 'web', displayId: 'secondary' },
  { target: 'external', displayId: 'primary' }
])
```

For three displays, assert saved IDs are honored. For a disconnected saved display, assert fallback to primary plus first non-primary and `usedFallback: true`. Assert zero displays throws `NoActiveDisplayError`.

- [ ] **Step 2: Run the tests and confirm RED**

Run `pnpm test src/main/core/scene-plan.test.ts`.

Expected: FAIL because `planScene` is missing.

- [ ] **Step 3: Implement the minimal total policy**

Export:

```ts
export interface Placement { target: TargetKind; displayId: string }
export interface ScenePlan { placements: Placement[]; usedFallback: boolean }
export class NoActiveDisplayError extends Error {}
export function planScene(displays: DisplayInfo[], config: TouchFishConfig): ScenePlan
```

Sort displays deterministically with primary first and then by `bounds.x`, `bounds.y`, and `id`. Implement the one-, two-, and multi-display rules exactly as approved. Never produce duplicate display IDs in a multi-display plan.

- [ ] **Step 4: Run the focused and complete tests**

Run `pnpm test src/main/core/scene-plan.test.ts` and then `pnpm test`.

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/core/scene-plan.ts src/main/core/scene-plan.test.ts
git commit -m "feat: plan adaptive display scenes"
```

## Task 4: Build the locked scene orchestrator

**Files:**
- Create: `src/main/core/scene-orchestrator.ts`
- Create: `src/main/core/scene-orchestrator.test.ts`

- [ ] **Step 1: Write failing orchestration tests**

Use an in-memory adapter and fake web-target controller. Cover:

- one-display web mode never calls `launchExternal`;
- one-display external mode never creates or moves the web window;
- a missing external window is launched, polled, and moved;
- a timeout reports the external failure but preserves any successful web placement;
- two overlapping `run()` calls produce one execution and one `busy` result;
- exact executable path is preferred, then native class, then largest visible matching window;
- fallback plans emit a notification.

Use fake timers so the timeout test completes immediately.

- [ ] **Step 2: Run the tests and confirm RED**

Run `pnpm test src/main/core/scene-orchestrator.test.ts`.

Expected: FAIL because the orchestrator is missing.

- [ ] **Step 3: Implement the orchestrator**

Use these dependencies and result contract:

```ts
export interface WebTargetController {
  ensureWindow(url: string): Promise<void>
  moveAndMaximize(display: DisplayInfo): Promise<void>
}
export interface SceneLogger { info(event: string, data?: object): void; error(event: string, data?: object): void }
export type SceneRunResult = { status: 'success' | 'partial' | 'failed' | 'busy'; errors: string[] }
```

Implement `SceneOrchestrator.run(config)` with a `try/finally` boolean lock. Use `planScene`, create only planned targets, launch the external executable with the adapter, poll once per second until `timeoutSeconds`, and aggregate errors rather than swallowing them. Pass only sanitized event names and identifiers to the logger.

- [ ] **Step 4: Verify orchestration**

Run:

```bash
pnpm test src/main/core/scene-orchestrator.test.ts
pnpm typecheck
```

Expected: all focused tests pass and no type errors remain.

- [ ] **Step 5: Commit**

```bash
git add src/main/core/scene-orchestrator.ts src/main/core/scene-orchestrator.test.ts
git commit -m "feat: orchestrate window scenes safely"
```

## Task 5: Add atomic configuration storage and migration

**Files:**
- Create: `src/main/config/store.ts`
- Create: `src/main/config/store.test.ts`
- Create: `src/main/services/log-store.ts`
- Create: `src/main/services/log-store.test.ts`

- [ ] **Step 1: Write failing filesystem tests**

Use a temporary directory. Assert that:

- a missing config returns defaults;
- `save()` writes valid schema-versioned JSON and leaves no `.tmp` file;
- invalid JSON is renamed using the injected clock, for example `config.json.2026-08-18T114500000Z.invalid`, and defaults are returned;
- invalid semantic values are preserved the same way;
- a version-0 fixture is migrated to version 1;
- logs redact keys matching `/cookie|password|authorization|token/i` and rotate after the configured byte limit.

- [ ] **Step 2: Run the tests and confirm RED**

Run `pnpm test src/main/config/store.test.ts src/main/services/log-store.test.ts`.

Expected: FAIL because the stores do not exist.

- [ ] **Step 3: Implement atomic persistence**

`ConfigStore` accepts the config directory and clock as constructor dependencies. Save with `open(tmp, 'w', 0o600)`, `writeFile`, `sync`, `close`, and `rename`. Parse through `configSchema`; preserve invalid input before returning defaults. Define the only migration as a pure `migrateUnknownConfig(value: unknown): unknown` function.

`LogStore` writes one JSON object per line, recursively redacts forbidden key names, and keeps at most five 1 MiB files. It exposes `recent(limit)` for the diagnostic UI.

- [ ] **Step 4: Verify persistence and logging**

Run focused tests, `pnpm typecheck`, and `pnpm lint`.

Expected: all exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/config/store* src/main/services/log-store*
git commit -m "feat: persist and recover TouchFish settings"
```

## Task 6: Parse Ubuntu X11 display and window data

**Files:**
- Create: `src/main/platform/command.ts`
- Create: `src/main/platform/linux-x11/parse-xrandr.ts`
- Create: `src/main/platform/linux-x11/parse-xrandr.test.ts`
- Create: `src/main/platform/linux-x11/parse-wmctrl.ts`
- Create: `src/main/platform/linux-x11/parse-wmctrl.test.ts`
- Create: `tests/fixtures/xrandr-two.txt`
- Create: `tests/fixtures/xrandr-three-negative.txt`
- Create: `tests/fixtures/wmctrl-windows.txt`

- [ ] **Step 1: Record sanitized fixtures and write failing parser tests**

The xrandr fixtures must cover a primary display, a negative X coordinate, rotation tokens, and three displays. The wmctrl fixture must cover spaces in titles, duplicate WM_CLASS values, a hidden/zero-area window, and multiple DingTalk windows.

Assert parsed displays contain stable connector IDs, primary status, geometry, and sorted order. Assert parsed windows preserve the complete title after fixed columns and parse hexadecimal IDs, PIDs, geometry, and class.

- [ ] **Step 2: Run the tests and confirm RED**

Run `pnpm test src/main/platform/linux-x11`.

Expected: FAIL because parsers are missing.

- [ ] **Step 3: Implement parsers and command runner**

`runCommand(file, args, options)` must use `execFile`, a bounded output buffer, timeout, UTF-8, and return `{ stdout, stderr }`; non-zero status throws a typed error containing only command basename, status, and sanitized stderr.

Parse `xrandr --query` connected-output lines with a geometry token matching `/^(\d+)x(\d+)([+-]\d+)([+-]\d+)$/`. Parse `wmctrl -lpGx` by consuming the first nine whitespace-separated fields and joining the remainder as the title.

- [ ] **Step 4: Verify parser coverage**

Run focused tests and inspect branch coverage for both parser files. Add explicit malformed-line assertions until every error branch is exercised.

- [ ] **Step 5: Commit**

```bash
git add src/main/platform/command.ts src/main/platform/linux-x11 tests/fixtures
git commit -m "feat: parse Linux display and window state"
```

## Task 7: Implement the Ubuntu X11 adapter

**Files:**
- Create: `src/main/platform/linux-x11/adapter.ts`
- Create: `src/main/platform/linux-x11/adapter.test.ts`

- [ ] **Step 1: Write failing adapter command tests**

Inject `runCommand`, filesystem executable resolution, and notification functions. Assert exact argument arrays:

```ts
['--query']
['-lpGx']
['-ia', windowId]
['-ir', windowId, '-b', 'remove,maximized_vert,maximized_horz']
['-ir', windowId, '-e', `0,${x},${y},${width},${height}`]
['-ir', windowId, '-b', 'add,maximized_vert,maximized_horz']
```

Assert all four placement commands are attempted, but any failure makes `moveAndMaximize` reject. Assert launch uses `spawn(executablePath, args, { detached: true, shell: false, stdio: 'ignore' })` and calls `unref()`.

- [ ] **Step 2: Run the tests and confirm RED**

Run `pnpm test src/main/platform/linux-x11/adapter.test.ts`.

Expected: FAIL because the adapter is missing.

- [ ] **Step 3: Implement LinuxX11Adapter**

Reject construction when `XDG_SESSION_TYPE` is not `x11` or when `DISPLAY` is empty. Use the Task 6 parsers, resolve `/proc/<pid>/exe` without failing the entire listing, obtain foreground window from `xprop -root _NET_ACTIVE_WINDOW`, and show notifications through Electron's `Notification` dependency.

Never build a shell string. Aggregate placement failures and throw one typed `WindowPlacementError` after attempting activation, unmaximize, geometry, and maximize.

- [ ] **Step 4: Run focused and full verification**

Run `pnpm test src/main/platform/linux-x11/adapter.test.ts`, `pnpm typecheck`, and `pnpm lint`.

Expected: all exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/platform/linux-x11/adapter*
git commit -m "feat: control external windows on Ubuntu X11"
```

## Task 8: Implement the Windows User32 helper and adapter

**Files:**
- Create: `resources/windows/window-helper.ps1`
- Create: `src/main/platform/windows/contracts.ts`
- Create: `src/main/platform/windows/adapter.ts`
- Create: `src/main/platform/windows/adapter.test.ts`
- Create: `tests/fixtures/windows-helper-windows.json`

- [ ] **Step 1: Write failing JSON-contract adapter tests**

Mock `powershell.exe` and assert it is called with:

```ts
['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperPath, command, '--payload-base64', payload]
```

Cover `list-windows`, `foreground-window`, and `move-maximize`. Reject a helper response whose `protocolVersion` is not `1`. Assert stderr and PowerShell source never include user arguments. Assert launch uses `shell: false`.

- [ ] **Step 2: Run the tests and confirm RED**

Run `pnpm test src/main/platform/windows/adapter.test.ts`.

Expected: FAIL because the Windows adapter is missing.

- [ ] **Step 3: Implement the versioned PowerShell helper**

The helper accepts only a fixed command enum and a base64-encoded UTF-8 JSON payload. Add a C# type through `Add-Type` that declares `EnumWindows`, `IsWindowVisible`, `GetWindowText`, `GetClassName`, `GetWindowThreadProcessId`, `GetWindowRect`, `GetForegroundWindow`, `ShowWindowAsync`, and `SetWindowPos`.

Emit exactly one compressed JSON object:

```json
{"protocolVersion":1,"ok":true,"result":{}}
```

or:

```json
{"protocolVersion":1,"ok":false,"error":{"code":"WINDOW_NOT_FOUND","message":"..."}}
```

Filter invisible, owner/tool, and zero-area windows. Read executable paths through `System.Diagnostics.Process`. Move into the provided work area and maximize with `ShowWindowAsync(SW_MAXIMIZE)`.

- [ ] **Step 4: Implement and verify WindowsAdapter**

Parse helper JSON with Zod. Map it into shared `NativeWindow` values, use Electron `screen.getAllDisplays()` for display data, and call the helper for native windows. Run the focused tests, `pnpm typecheck`, and a PowerShell syntax/parser check on a Windows CI shell.

- [ ] **Step 5: Commit**

```bash
git add resources/windows src/main/platform/windows tests/fixtures/windows-helper-windows.json
git commit -m "feat: control external windows on Windows"
```

## Task 9: Create secure settings and web windows

**Files:**
- Create: `src/main/windows/settings-window.ts`
- Create: `src/main/windows/settings-window.test.ts`
- Create: `src/main/windows/web-window.ts`
- Create: `src/main/windows/web-window.test.ts`

- [ ] **Step 1: Write failing BrowserWindow option tests**

Mock Electron. Assert the settings window uses `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and only the settings preload. Assert the web window uses the same isolation with no preload and a persistent partition `persist:touchfish-web`.

Assert unsafe protocols are blocked, `window.open` uses `shell.openExternal` only for allowed `https:` links, and clearing web data clears only the TouchFish web partition.

- [ ] **Step 2: Run the tests and confirm RED**

Run `pnpm test src/main/windows`.

Expected: FAIL because window factories are missing.

- [ ] **Step 3: Implement window controllers**

`SettingsWindowController` lazily creates, shows, focuses, hides, and destroys the settings window. `WebWindowController` implements the Task 4 interface, reuses one BrowserWindow, validates the URL through the config schema, loads only when the URL changed, and places using the selected Electron display work area before maximizing.

Handle `will-navigate`, `setWindowOpenHandler`, downloads, and permission requests with default-deny behavior. Do not expose preload APIs to remote content.

- [ ] **Step 4: Verify security assertions**

Run focused tests, lint, and type checking.

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/windows
git commit -m "feat: add isolated settings and web windows"
```

## Task 10: Add shortcuts, tray, autostart, and legacy migration

**Files:**
- Create: `src/main/services/shortcut-service.ts`
- Create: `src/main/services/shortcut-service.test.ts`
- Create: `src/main/services/tray-service.ts`
- Create: `src/main/services/autostart-service.ts`
- Create: `src/main/services/legacy-linux-migration.ts`
- Create: `src/main/services/legacy-linux-migration.test.ts`

- [ ] **Step 1: Write failing service tests**

Assert shortcut registration failure returns `{ ok: false, reason: 'conflict' }` without replacing the old shortcut. Assert reconfiguration unregisters only the previous TouchFish shortcut. Assert tray actions expose Open Settings, Run Scene, Start at Login, and Quit in the active language.

For migration, feed a dconf dump containing the exact path, name, command, and binding from the approved spec. Assert it offers import. Feed a binding with any different command or name and assert no mutation is proposed.

- [ ] **Step 2: Run the tests and confirm RED**

Run `pnpm test src/main/services`.

Expected: FAIL because services are missing.

- [ ] **Step 3: Implement shortcut, tray, and autostart services**

Wrap Electron `globalShortcut` and `Tray`. Use `app.setLoginItemSettings` on Windows. On Linux, atomically create or remove `~/.config/autostart/touchfish.desktop` using the packaged executable path and `--hidden`; do not write system-wide files.

Tray language changes rebuild the menu immediately. Quit explicitly destroys the tray and unregisters shortcuts; closing settings only hides it.

- [ ] **Step 4: Implement exact legacy migration**

Read only the GNOME media-key custom binding path. Offer migration only when all of these match:

```text
name=双屏场景
binding=<Primary><Alt>z
command=/home/zac/.local/bin/switch-dual-screen-scene
```

After explicit renderer confirmation, import the installed config URL, remove only this path from the `custom-keybindings` array, and preserve the old script/config. If any write fails, restore the original array and report failure.

- [ ] **Step 5: Verify and commit**

Run service tests, lint, and type checking, then commit:

```bash
git add src/main/services
git commit -m "feat: integrate TouchFish with the desktop"
```

## Task 11: Define validated IPC and the preload bridge

**Files:**
- Create: `src/shared/ipc.ts`
- Create: `src/main/ipc.ts`
- Create: `src/main/ipc.test.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Write failing IPC allowlist tests**

Assert the exposed renderer API contains only:

```ts
loadConfig, saveConfig, listDisplays, listWindows, beginWindowCapture,
runScene, chooseExecutable, setShortcut, setStartAtLogin,
getDiagnostics, clearWebData, getLegacyMigration, applyLegacyMigration
```

Pass invalid payloads to every mutating handler and assert rejection before services are called. Assert no generic `send`, `invoke`, filesystem, process, or shell object is exposed.

- [ ] **Step 2: Run the tests and confirm RED**

Run `pnpm test src/main/ipc.test.ts`.

Expected: FAIL because the IPC contract is missing.

- [ ] **Step 3: Implement shared channel schemas and handlers**

Define literal channel constants and Zod request/response schemas. Register one handler per channel and inject services for testing. The renderer shows a visible three-second countdown before invoking `beginWindowCapture`; the handler then hides settings, waits 500 ms for focus to settle, captures the foreground external window, rejects TouchFish-owned windows, and always restores settings in `finally`.

- [ ] **Step 4: Implement the frozen preload API**

Use `contextBridge.exposeInMainWorld('touchfish', Object.freeze(api))`. Add a renderer global `.d.ts` generated from the shared interface, not hand-written duplicate types.

- [ ] **Step 5: Verify and commit**

Run focused tests, type checking, and lint, then commit:

```bash
git add src/shared/ipc.ts src/main/ipc* src/preload
git commit -m "feat: expose a constrained settings API"
```

## Task 12: Build the bilingual settings UI

**Files:**
- Create: `src/shared/i18n/en.ts`
- Create: `src/shared/i18n/zh-CN.ts`
- Create: `src/shared/i18n/i18n.test.ts`
- Modify: `src/renderer/src/App.tsx`
- Create: `src/renderer/src/App.test.tsx`
- Create: `src/renderer/src/components/*.tsx`
- Create: `src/renderer/src/styles.css`

- [ ] **Step 1: Write failing localization and UI tests**

Assert both locale objects have identical recursive keys. Render the settings app with a fake preload API and cover:

- approved defaults shown on first run;
- URL and timeout validation;
- program selection and capture countdown/result;
- single-display target selection;
- two-display swap;
- multi-display selectors shown only with three or more displays;
- shortcut conflict feedback;
- language switch updates all visible text;
- legacy migration confirmation;
- Run Scene and diagnostic result states.

- [ ] **Step 2: Run the tests and confirm RED**

Run `pnpm test src/shared/i18n src/renderer/src`.

Expected: FAIL because translations/components are missing.

- [ ] **Step 3: Implement translations and focused components**

Create separate components `WebTargetSection`, `ExternalTargetSection`, `DisplayRulesSection`, `ShortcutSection`, `GeneralSection`, `DiagnosticsSection`, and `FirstRunWizard`. Each accepts typed values/callbacks and contains no direct Electron access.

Use semantic labels, keyboard-focus styles, inline validation, and a single primary Save action. Use system fonts, a restrained blue/teal palette, no animation required for function, and responsive layout down to 720 px width.

- [ ] **Step 4: Implement app state and IPC calls**

Load the config and diagnostics once, keep an editable draft, validate before saving, and display explicit saved/error states. During capture, show the countdown instructions before the main process hides the window. Do not render raw HTML or remote page content.

- [ ] **Step 5: Verify UI and commit**

Run renderer tests, full tests, lint, type checking, and build. Then commit:

```bash
git add src/shared/i18n src/renderer
git commit -m "feat: add bilingual TouchFish settings"
```

## Task 13: Compose the production main process

**Files:**
- Modify: `src/main/index.ts`
- Create: `src/main/index.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Mock Electron and assert:

- second instances focus settings and exit;
- app readiness constructs exactly one adapter for the active platform;
- unsupported Linux Wayland shows a clear error state;
- startup loads config, applies autostart, creates tray, registers shortcut, and shows first-run settings;
- `--hidden` starts only the tray;
- `--run-scene` triggers one scene after readiness;
- quit unregisters shortcuts and disposes services.

- [ ] **Step 2: Run the tests and confirm RED**

Run `pnpm test src/main/index.test.ts`.

Expected: FAIL against the bootstrap shell.

- [ ] **Step 3: Replace bootstrap code with composition root**

Request the single-instance lock before `whenReady`. Instantiate config/log stores from `app.getPath('userData')`, select `WindowsAdapter` for `win32` and `LinuxX11Adapter` for Linux X11, compose window controllers/orchestrator/services/IPC, and route all user-facing errors through translations and notifications.

Do not import platform-specific helper code on the wrong operating system. Do not quit on normal settings-window close.

- [ ] **Step 4: Run full verification**

Run `pnpm verify`.

Expected: formatting, lint, types, tests, and build all pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts src/main/index.test.ts
git commit -m "feat: compose the TouchFish desktop application"
```

## Task 14: Create original branding and installers

**Files:**
- Create: `resources/icon.svg`
- Create: `scripts/generate-icons.mjs`
- Create: `scripts/generate-icons.test.ts`
- Create: `electron-builder.yml`
- Create: `build/after-install.sh`
- Create: `build/after-remove.sh`
- Create: generated `build/icons/*`

- [ ] **Step 1: Write a failing deterministic icon test**

Run the generator into a temporary directory and assert PNG files exist at 16, 24, 32, 48, 64, 72, 96, 128, 256, and 512 px, each has the exact dimensions, and `icon.ico` contains multiple sizes. Run twice and assert identical SHA-256 outputs.

- [ ] **Step 2: Run the test and confirm RED**

Run `pnpm test scripts/generate-icons.test.ts`.

Expected: FAIL because the icon and generator do not exist.

- [ ] **Step 3: Add the source icon and deterministic generator**

Create an original square SVG with two rounded display panels and a centered turquoise fish silhouette. Do not use text or third-party marks. Use Sharp with fixed options to generate PNGs and `png-to-ico` for ICO. Strip timestamps and nondeterministic metadata.

- [ ] **Step 4: Configure exact artifacts**

Configure `electron-builder.yml` with:

```yaml
appId: io.github.zacliuntu.touchfish
productName: TouchFish
asar: true
files:
  - out/**
extraResources:
  - from: resources/windows/window-helper.ps1
    to: windows/window-helper.ps1
linux:
  target: [deb]
  category: Utility
  icon: build/icons
  artifactName: TouchFish-${version}-${arch}.deb
deb:
  depends: [wmctrl, x11-xserver-utils, libgtk-3-0, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0, libuuid1, libsecret-1-0]
win:
  target: [nsis]
  icon: build/icons/icon.ico
  artifactName: TouchFish-Setup-${version}.${ext}
nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: false
  createStartMenuShortcut: true
```

Add only idempotent desktop-cache package hooks; per-user autostart remains application-managed.

- [ ] **Step 5: Build the Linux installer and commit**

Run `pnpm icons`, `pnpm package:linux`, inspect with `dpkg-deb --info`, and confirm the exact artifact name and declared dependencies. Commit source and generated installer assets:

```bash
git add resources scripts build electron-builder.yml package.json pnpm-lock.yaml
git commit -m "build: package TouchFish for Linux and Windows"
```

## Task 15: Write user, security, and maintainer documentation

**Files:**
- Create: `README.md`
- Create: `README.zh-CN.md`
- Create: `LICENSE`
- Create: `docs/INSTALL.md`
- Create: `docs/INSTALL.zh-CN.md`
- Create: `docs/CONFIGURATION.md`
- Create: `docs/CONFIGURATION.zh-CN.md`
- Create: `docs/TROUBLESHOOTING.md`
- Create: `docs/TROUBLESHOOTING.zh-CN.md`
- Create: `docs/SECURITY.md`
- Create: `docs/ARCHITECTURE.md`
- Create: `docs/RELEASING.md`
- Create: `CHANGELOG.md`

- [ ] **Step 1: Write a failing documentation-link test**

Create a test that scans both READMEs, verifies every relative Markdown link resolves, asserts reciprocal language links, and asserts the exact support matrix and warning phrases are present: Ubuntu X11 only, Windows 10/11, unsigned installer, SmartScreen, and Windows dual-display post-release smoke test.

- [ ] **Step 2: Run the test and confirm RED**

Run `pnpm test tests/docs.test.ts`.

Expected: FAIL because documentation is missing.

- [ ] **Step 3: Write complete bilingual user docs**

Document installation/uninstallation, tray operation, one/two/multi-display behavior, external target capture, legacy shortcut migration, configuration paths, reset/recovery, logs, X11 selection, SmartScreen steps, SHA-256 verification, and known v0.1.0 limits.

- [ ] **Step 4: Write maintainer docs and license**

Add the standard MIT License with copyright `2026 zacliuntu`. Document the adapter boundary, secure IPC/web-window model, local development, package commands, CI, release tagging, rollback, and the requirement never to commit local config/web data.

- [ ] **Step 5: Verify and commit**

Run the docs test and link checker, then commit:

```bash
git add README* LICENSE CHANGELOG.md docs tests/docs.test.ts
git commit -m "docs: document TouchFish installation and operation"
```

## Task 16: Add cross-platform CI and release automation

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`
- Create: `scripts/smoke-electron.mjs`
- Create: `scripts/checksums.mjs`

- [ ] **Step 1: Add a local failing smoke test contract**

The smoke script starts the built Electron app with `TOUCHFISH_SMOKE_TEST=1`, waits for a structured readiness file in a temporary directory, asserts security flags and platform adapter selection, requests clean exit, and times out after 30 seconds. Run before wiring the main-process smoke hook and confirm failure.

- [ ] **Step 2: Implement the guarded smoke hook**

When and only when `TOUCHFISH_SMOKE_TEST=1`, main writes `{ ready: true, platform, contextIsolation: true, nodeIntegration: false }` to the provided path and exits on a command file. This path must not be reachable from normal IPC or configuration.

- [ ] **Step 3: Add CI workflow**

On pushes and pull requests, use a Linux and Windows matrix with Node 22 and pnpm 10.33.0. Run `pnpm install --frozen-lockfile`, `pnpm verify`, package the native target, run the packaged smoke script, and upload `.deb`/`Setup.exe` artifacts. On Linux install `xvfb`, `wmctrl`, and required Electron libraries; run smoke under `xvfb-run`.

- [ ] **Step 4: Add release workflow**

Trigger only on `v*` tags. Re-run all checks/builds, download both build artifacts, run `scripts/checksums.mjs` to produce `SHA256SUMS.txt`, and use GitHub's official artifact actions plus a maintained release action with `contents: write`. Create bilingual release notes containing the X11 and unsigned-Windows limitations.

- [ ] **Step 5: Validate workflow syntax and commit**

Run a YAML parser, the smoke script locally, and the checksum script against sample artifacts. Commit:

```bash
git add .github scripts package.json
git commit -m "ci: build and release TouchFish installers"
```

## Task 17: Perform full local verification and code review

**Files:**
- Modify only files required by discovered defects

- [ ] **Step 1: Run the complete clean verification**

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm package:linux
```

Expected: all commands exit 0 from a clean checkout and the `.deb` exists with the exact name.

- [ ] **Step 2: Audit requirements against the approved spec**

Create a requirement-to-evidence checklist covering every section of `docs/superpowers/specs/2026-08-18-touchfish-cross-platform-design.md`. Treat missing or indirect evidence as incomplete.

- [ ] **Step 3: Request code review**

Use the requesting-code-review skill. Resolve every Critical and Important finding with a failing test first, then re-run `pnpm verify` and package again. Do not bundle unrelated cleanup.

- [ ] **Step 4: Commit verification fixes**

Commit only if review found issues. Because the worktree must be clean before review, stage only tracked review edits with:

```bash
git add --update
git commit -m "fix: address TouchFish release review"
```

- [ ] **Step 5: Confirm clean state**

Run `git status --short`, `git diff --check`, and `git log --oneline --decorate -15`.

Expected: no uncommitted changes and a focused history.

## Task 18: Install and verify the Ubuntu package on real X11

**Files/state:**
- Install: generated `TouchFish-0.1.0-amd64.deb`
- Modify with explicit confirmation: exact legacy GNOME shortcut binding only
- Preserve: `/home/zac/.local/bin/switch-dual-screen-scene` and `/home/zac/.config/screen-scene/config`

- [ ] **Step 1: Record pre-install state**

Capture the package absence/presence, current display topology, current GNOME custom shortcut dump, legacy script/config hashes, and current TouchFish config paths. Do not change displays.

- [ ] **Step 2: Install the generated package**

Use `apt install ./TouchFish-0.1.0-amd64.deb` so dependencies are resolved. Verify package version, installed desktop entry, icons, executable, and uninstall metadata.

- [ ] **Step 3: Verify tray, settings, and migration**

Launch TouchFish, confirm the tray and bilingual settings render, verify the first-run defaults, explicitly approve exact legacy migration, and prove the old script/config hashes remain unchanged while the old GNOME binding no longer owns `Ctrl+Alt+Z`.

- [ ] **Step 4: Verify the real two-display scene**

Use `Ctrl+Alt+Z`. Confirm with window geometry and a screenshot that the built-in Gitee web window is maximized on the primary display and DingTalk is maximized on the non-primary display. Verify a second quick trigger returns busy or completes without duplicate windows.

- [ ] **Step 5: Verify persistence and uninstall path**

Restart TouchFish and confirm web login/session and settings persist. Verify start-at-login entry. Exercise package removal in a recoverable test if it will not interrupt the user's workflow, then reinstall for final handoff; otherwise inspect and document the uninstall metadata without removing the active app.

## Task 19: Push, observe CI, and publish v0.1.0

**Files/state:**
- Push: `main`
- Create and push: annotated tag `v0.1.0`
- Create: GitHub Release via workflow

- [ ] **Step 1: Push reviewed commits to main**

Run `git push origin main`. Read the remote hash back with `git ls-remote` and verify it matches local HEAD.

- [ ] **Step 2: Observe main CI to completion**

Use GitHub's checks/API or web UI. Require Linux and Windows verification/build jobs to be green and inspect uploaded artifacts. If a job fails, diagnose from logs, add a reproducing local/fixture test, fix, re-run locally, commit, and push.

- [ ] **Step 3: Create and push the release tag**

After main CI is green:

```bash
git tag -a v0.1.0 -m "TouchFish v0.1.0"
git push origin v0.1.0
```

- [ ] **Step 4: Observe the release workflow and audit artifacts**

Require the release workflow to be green. Download `.deb`, `Setup.exe`, and `SHA256SUMS.txt`; recompute both hashes and compare. Inspect the GitHub Release notes for bilingual content, X11 scope, SmartScreen warning, and Windows real-hardware caveat.

- [ ] **Step 5: Final completion audit**

Verify every criterion in spec section 14 against current files, CI jobs, installed runtime behavior, and release artifacts. Only then report completion. Explicitly state that Windows automated verification/build passed and Windows dual-display real-hardware smoke testing remains for the user.
