# Harness-Oneclick-start

![pic](pic.jpeg)

[English](README.md)

面向 WSL2/Linux 的**官方** [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 一键启动器，直接使用官方 DeepSeek API（`DEEPSEEK_API_KEY`）。

本仓库**不包含任何下载或安装的内容**，只是首次运行的入口代码。每次启动都会把两个上游仓库下载（或更新）到当前目录的 `.runtime/` 下，构建并安装有变更的部分，然后启动官方 Harness 网页版。

## 依次自动安装的内容

1. **deepseek-harness** —— 官方 Harness（克隆到 `.runtime/checkouts/deepseek-harness`，用 pnpm 构建）
2. **dsh-market** —— 可视化插件市场（`.runtime/checkouts/dsh-market`，以 `dshmarket` 插件装配）

每次启动都会**自动检查并更新**以上 2 个库（`git fetch` 并重置到上游最新提交）；库内容或相关兼容修复变化时才重新构建，因此连续启动很快。

启动器已取消 `dsh-routing-suite` 的拉取、构建和安装，并会卸载旧版启动器安装的 `dsh-super-injector` 注入器。已有 Router 预设和会话保留；Router 预设不再自动安装或更新。

若 Router 预设已被删除，启动器会将仍引用它的空白会话切换为官方 `standard`，恢复模式选择。修复前备份会话日志到 `$DSH_HOME/backups/`，通过追加预设选择记录完成迁移，保留原日志；已有消息或已开始对话的会话不自动迁移。

启动器为尚未适配新版 Harness 的插件提供只读会话事件兼容接口，避免旧版 `session.events` 调用导致对话失败。会话删除插件通过侧边栏记录的实际 ID 定位会话，兼容未命名及同名会话；相关修复会在更新后自动重新应用。

针对 dsh-market 提交 `f1779d5` 遗留的已知合并冲突，启动器会保留双方功能并重新构建；上游修复后自动跳过。更新恢复了带冲突的前端产物时，也会重新构建。

GUI 启动前还会修复旧版网页端遗留的会话记账问题：永久删除没有归属工作区、且从未收到用户消息的空白会话，避免它们显示在“未分组”下却没有行菜单。非空白会话和工作区内会话不会被改动。

## 环境要求

启动器会为第三方模型适配器补齐 `x-opencode-session` 和 Harness 原生会话请求头，使用当前对话的真实 ID，修复 OpenCode Go 的 `MissingSessionID` 错误；每次更新后自动重新应用。已有安装需重新运行 `./Harness.sh` 以构建并加载修复。

- WSL2 或 Linux
- WSL 内有 `git`
- 不需要预装 Node.js、pnpm、npm——启动器会把 Node.js 24 安装到 `.runtime/`，并在每次更新仓库后激活 DeepSeek Harness 的 `package.json` 指定的 pnpm 版本

## 使用方法

```bash
cd /path/to/Harness-Oneclick-start
chmod +x Harness.sh
./Harness.sh
```

首次运行会询问你的 DeepSeek API Key（保存在 `.runtime/dsh-home/.env`，不会提交），随后下载两个仓库、构建、安装市场插件，最后启动：

```text
Harness GUI: http://127.0.0.1:13080
```

启动后即可新建会话。`Ctrl+C` 停止。

同一运行目录只允许一个启动器实例。重复启动或网页端口被占用时，会在更新、构建前退出并提示；请使用已运行的窗口，或先在原终端按 `Ctrl+C` 再重新启动。

## 环境变量

| 变量 | 默认值 | 含义 |
|---|---|---|
| `DEEPSEEK_API_KEY` | — | DeepSeek API Key（首次询问，存入 `$DSH_HOME/.env`） |
| `DSH_WORKSPACE` | 启动时所在目录 | 智能体工作目录 |
| `DSH_WEB_HOST` | `127.0.0.1` | 网页绑定地址 |
| `DSH_WEB_PORT` | `13080` | 网页端口 |
| `DSH_HOME` | `.runtime/dsh-home` | Harness 家目录（profile、会话、预设） |
| `DSH_RUNTIME_ROOT` | `<项目>/.runtime` | 运行时根目录 |
| `OUROBOROS_AGENT_RUNTIME` | 检测到 Codex CLI 时为 `codex` | Ouroboros MCP 使用的可执行 Agent runtime |

示例：

```bash
DSH_WORKSPACE=/mnt/e/my-project ./Harness.sh
```

## 数据与清理

所有下载与生成的内容都在 `.runtime/` 下：

```text
.runtime/checkouts/    两个上游仓库（旧版下载的仓库保留）
.runtime/dsh-home/     Harness 家目录：profile、会话、预设、API Key
.runtime/nvm/          Node.js 工具链
.runtime/pnpm-*/       pnpm store 与 home
```

`.runtime/` 已被 git 忽略。删除它即可完全重置生成的环境（下次启动自动重建）。其中包含你的 API Key 与会话数据，请勿提交或分享。

## 许可

MIT
