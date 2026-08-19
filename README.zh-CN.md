# TouchFish

[English](README.md)

TouchFish 是一个常驻托盘的小工具：打开一个网页目标和一个外部程序，再根据当前连接的屏幕数量摆放所需窗口。默认全局快捷键为 `Ctrl+Alt+Z`（配置中写作 `CommandOrControl+Alt+Z`）。

## 支持平台

| 平台    | v0.1.0 支持情况                     |
| ------- | ----------------------------------- |
| Ubuntu  | 仅支持 Ubuntu X11；不支持 Wayland。 |
| Windows | 支持 64 位 Windows 10/11。          |

Windows 安装包目前没有代码签名，SmartScreen 可能提示风险。请先核对发布页提供的 SHA-256，再选择“更多信息 → 仍要运行”。每次发布后还必须在 Windows 双屏真机上做冒烟测试，才算完成 Windows 验证。

## 功能

- 一个屏幕：只把配置中选定的网页目标或外部程序放到该屏幕。
- 两个屏幕：默认网页放主屏、外部程序放另一屏，也可以交换。
- 三个及以上屏幕：可分别指定网页和外部程序的目标屏幕；已保存屏幕缺失时，回退到主屏和首个可用非主屏。
- 捕获当前前台外部窗口，保存用于后续匹配的窗口特征。
- 支持托盘操作、开机启动和可配置的全局快捷键。

## 快速开始

1. Ubuntu 安装 `.deb`；Windows 从 GitHub Release 运行 NSIS 安装程序。
2. 首次启动时设置网页 URL，并选择或捕获外部程序。
3. 检查屏幕规则和快捷键，然后保存。
4. 按 `Ctrl+Alt+Z`，或从托盘/设置页选择“运行场景”。

Ubuntu 软件包提供 `touchfish.desktop` 应用关联。要固定到收藏栏，请先启动 TouchFish，或在应用列表中找到它，然后右键图标选择“添加到收藏夹（Add to Favorites）”。TouchFish 不会自动修改收藏栏。

## 文档

- [安装与卸载](docs/INSTALL.zh-CN.md)
- [配置与使用](docs/CONFIGURATION.zh-CN.md)
- [故障排除](docs/TROUBLESHOOTING.zh-CN.md)
- [安全模型（英文）](docs/SECURITY.md)
- [架构（英文）](docs/ARCHITECTURE.md)
- [发布流程（英文）](docs/RELEASING.md)
- [更新记录](CHANGELOG.md)
- [许可证](LICENSE)

## 本地开发

需要 Node.js、Corepack，以及 `package.json` 中固定的 pnpm 版本。

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
pnpm verify
```

在 Ubuntu 上用 `pnpm package:linux` 构建 Linux 包，在 Windows 上用 `pnpm package:win` 构建 Windows 包。完整验证和发布步骤见[发布流程](docs/RELEASING.md)。
