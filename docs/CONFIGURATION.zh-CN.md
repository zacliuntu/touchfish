# 配置与使用

[English](CONFIGURATION.md) · [返回说明](../README.zh-CN.md)

## 运行场景

运行前先保存设置。可按全局快捷键（默认 `Ctrl+Alt+Z`）、点击设置页“运行场景”，或选择托盘菜单“运行场景”。场景正在执行时会忽略重复触发，并通过系统通知与诊断日志报告成功、部分成功或失败。

托盘菜单包含“打开设置”“运行场景”“开机启动”和“退出”。关闭设置窗口只会隐藏窗口。

## 目标

网页 URL 必须使用 `http://` 或 `https://`。网页窗口使用独立的持久登录会话。弹窗和下载会被拦截；请求新窗口的 HTTPS 链接会交给系统浏览器。

外部目标可以选择可执行文件，也可以输入路径和参数列表。“捕获当前窗口”会显示 3-2-1 倒计时，暂时隐藏设置页，然后记录前台窗口的可执行文件/进程特征。倒计时结束前请切换到目标窗口。TouchFish 不允许捕获自己的窗口。

首次运行且外部目标仍为空时，TouchFish 会从已知钉钉启动程序或当前可见的钉钉窗口识别并填写预设；之后可以换成系统支持的任意可执行程序。

运行场景时若找不到匹配窗口，TouchFish 会在不使用 shell 的情况下启动该程序，并在设定的 1–120 秒超时时间内轮询窗口。

## 屏幕规则

- 一个屏幕：只摆放一个目标，可在“单屏目标”中选择网页或外部程序。
- 两个屏幕：默认网页放主屏、外部程序放另一屏；启用“交换屏幕分配”后反转。
- 三个及以上屏幕：分别为网页和外部程序选择不同屏幕。如果保存的屏幕消失或两个 ID 不可用，则网页回退到主屏，外部程序回退到首个可用非主屏，并给出提示。

TouchFish 使用屏幕工作区，因此会避开面板/任务栏。它激活、移动并最大化窗口，不修改分辨率、方向或主屏设置。

## Ubuntu 旧 `Ctrl+Alt+Z` 迁移

首次运行时，TouchFish 只识别下面这个完全一致的旧配置：

- GNOME 绑定路径 `/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/screen-scene/`
- 名称 `双屏场景`
- 命令 `/home/zac/.local/bin/switch-dual-screen-scene`
- 按键 `<Primary><Alt>z`
- URL 来源 `/home/zac/.config/screen-scene/config`

检测阶段只读。**只有用户在迁移提示中明确确认后**，TouchFish 才会禁用旧绑定并导入 URL。关闭或拒绝提示不会修改旧脚本、配置或绑定。迁移只从 GNOME 绑定数组移除精确匹配项，不删除旧脚本和配置；写入失败时会尽可能回滚。

## 配置和数据路径

`config.json`、日志和持久化的 `touchfish-web` 网页会话都位于 Electron 的当前用户数据目录：

- Ubuntu 默认：`~/.config/TouchFish/`
- Windows 默认：`%APPDATA%\TouchFish\`

Linux 设置 `XDG_CONFIG_HOME` 时会改变 Electron 用户数据的基础位置。开机启动文件默认是 `~/.config/autostart/touchfish.desktop`，设置该变量后为 `$XDG_CONFIG_HOME/autostart/touchfish.desktop`。Windows 使用当前用户的登录项。

配置包含网页 URL、外部程序路径/参数/窗口匹配信息、快捷键、开机启动、超时、语言、单屏目标、双屏交换、多屏 ID 和首次运行状态。请优先通过设置页修改；程序运行中直接编辑文件可能被覆盖。

## 重置与恢复

1. 在托盘菜单选择“退出”。
2. 备份用户数据目录。
3. 将 `config.json` 改名为 `config.json.backup`，再启动 TouchFish，即可重置设置。

配置缺失时会重新生成默认值。JSON 损坏或不符合结构时，原文件会自动改名为 `config.json.<时间戳>.invalid`，然后加载默认值。要仅清理网页会话，可在设置页点击“清除网页和登录数据”。

如需完整本地重置，请先卸载或退出 TouchFish，在必要时保留备份，然后只删除上面列出的 TouchFish 用户数据目录。这会清除配置、日志、Cookie 和网页登录状态，没有备份时无法恢复。

## 日志

“诊断”页显示最近的结构化日志；磁盘路径为 `<用户数据>/logs/touchfish.log`。日志约 1 MiB 轮转，最多保留五个文件（`touchfish.log` 到 `.4`）。键名含 `cookie`、`password`、`authorization` 或 `token` 的字段会替换成 `[REDACTED]`，但日志仍可能含屏幕 ID、路径和窗口标题，分享前请检查。

## v0.1.0 限制

- 不支持 Ubuntu Wayland 和其他 Linux 桌面，仅支持 Ubuntu X11。
- 只构建 64 位 Ubuntu `.deb` 和 Windows NSIS 安装包。
- Windows 包没有代码签名；Windows 双屏行为仍需每次发布后真机冒烟测试。
- 不切换镜像/扩展模式，不改变系统主屏，也不修改分辨率或屏幕方向。
- 只摆放一个网页目标和一个外部目标，不是通用多窗口布局工具。
- 多个可见窗口具有相同特征时，系统窗口元数据可能导致匹配不唯一。
- 不包含 macOS、云同步、遥测、自动更新和代码签名。
