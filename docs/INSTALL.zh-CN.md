# 安装与卸载

[English](INSTALL.md) · [返回说明](../README.zh-CN.md)

## 系统要求

- 64 位 Ubuntu X11 会话。v0.1.0 依赖 `xrandr`、`wmctrl` 和 `xprop`，因此会拒绝在 Wayland 下启动。具体 Ubuntu 发行版只有在发布说明中留有对应真机验收记录时，才视为已经验证。
- 64 位 Windows 10/11。

## 校验下载文件

只从本仓库的 GitHub Release 下载安装包。运行前将 SHA-256 与发布页的校验文件逐字核对。

Ubuntu：

```bash
sha256sum TouchFish-0.1.0-amd64.deb
```

Windows PowerShell：

```powershell
Get-FileHash .\TouchFish-Setup-0.1.0.exe -Algorithm SHA256
```

## Ubuntu

安装前检查当前会话：

```bash
echo "$XDG_SESSION_TYPE"
```

输出必须是 `x11`。如果是 `wayland`，请注销，在登录界面选中账号后通过齿轮菜单选择“Ubuntu on Xorg”，再登录。

安装软件及依赖：

```bash
sudo apt install ./TouchFish-0.1.0-amd64.deb
```

从应用列表启动 TouchFish。软件包提供 `touchfish.desktop` 应用关联。需要固定到 Ubuntu 收藏栏时，请右键正在运行的图标或应用列表图标，选择“添加到收藏夹（Add to Favorites）”。安装程序不会替用户修改收藏栏。

卸载：

```bash
sudo apt remove touchfish
```

卸载不会删除当前用户的配置、日志和网页登录数据。需要清理时参见[重置与恢复](CONFIGURATION.zh-CN.md#重置与恢复)。

## Windows

运行 `TouchFish-Setup-0.1.0.exe`。安装程序按当前用户安装，可选择目录，创建开始菜单快捷方式，不创建桌面快捷方式。

v0.1.0 没有代码签名。如果 SmartScreen 拦截，请先核对 GitHub Release 中的 SHA-256，再选择“更多信息 → 仍要运行”。来源不明或校验不一致时不要绕过警告。

从“设置 → 应用 → 已安装的应用 → TouchFish → 卸载”移除程序。为便于升级或重装，用户配置、日志和网页登录数据可能保留。

## 首次启动

首次启动会打开设置页。请配置 URL、外部目标、屏幕规则、快捷键、语言、等待时间和开机启动。关闭设置窗口只会隐藏它；要彻底停止 TouchFish，请在托盘菜单选择“退出”。
