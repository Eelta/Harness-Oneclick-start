# Harness-Oneclick-start

![pic](pic.jpeg)

[中文](README.cn.md)

A minimal one-click launcher for the **official** [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) on WSL2/Linux, using the official DeepSeek API (`DEEPSEEK_API_KEY`).

The repository contains **no downloaded or installed content** — it is only the first-run entry point. Every start downloads (or updates) the two upstream repos into the current directory's `.runtime/`, builds and installs what changed, then boots the official Harness web GUI.

## What gets installed (in order)

1. **deepseek-harness** — the official Harness (cloned into `.runtime/checkouts/deepseek-harness`, built with pnpm)
2. **dsh-market** — the visual plugin market (`.runtime/checkouts/dsh-market`, installed as the `dshmarket` plugin)

Every start **checks and updates** both repos (`git fetch` + reset to the latest upstream commit). Rebuilds happen when a repo or its compatibility fixes change, so consecutive starts are fast.

The launcher no longer fetches, builds, or installs `dsh-routing-suite` and uninstalls the `dsh-super-injector` plugin installed by older launcher versions. Existing Router presets and sessions are retained; Router presets are no longer installed or updated automatically.

If a Router preset has been deleted, blank sessions still referencing it are switched to the official `standard` preset so mode selection works again. The migration recognizes both the current Web bundle's declarative preset and the older preset directory. Session logs are backed up under `$DSH_HOME/backups/` before appending a preset-selection event; existing records are preserved. Sessions containing user messages or started turns are not migrated automatically.

The launcher provides a read-only session-event compatibility API for plugins that still use `session.events`. It also repairs the session-delete plugin to use each sidebar row's actual session ID, including untitled or duplicate-title sessions. The sidebar patch tolerates additional accessibility attributes such as `aria-description`. These compatibility fixes are reapplied after upstream updates. On current Harness releases, Turn Rewind is also migrated from the removed settingsScope service to configuration forms, with its settings and checkpoint management card on the plugin page.

For older `dsh-better-sidebar` releases, the launcher removes the obsolete `turnTail` takeover while retaining native sidebar file previews. It also updates current-session subscriptions and side-chat/subagent navigation. File and tab opens wait for their target session's sidebar to mount. Renamed icons in the main UI and lazy-loaded editor/viewer modules keep their original sizes. Plugin compatibility repairs modify the installed JavaScript directly; no manual build is needed.

The known merge conflicts shipped in dsh-market commit `f1779d5` are repaired while retaining both features, then rebuilt. Already-fixed upstream sources pass through unchanged. If an update restores conflicted client artifacts, the launcher rebuilds them too.

Before the GUI starts, the launcher also repairs stale session bookkeeping left by older web versions. It permanently deletes orphaned blank sessions that otherwise appear under **Ungrouped** without a row menu. Non-blank and workspace-owned sessions are never changed.

## Requirements

The launcher adds `x-opencode-session` and the native Harness session header to third-party model requests, using the current conversation ID to fix OpenCode Go's `MissingSessionID` error. The patch is reapplied after updates. For existing installations, rerun `./Harness.sh` to build and load the fix.

- WSL2 or Linux
- `git` inside WSL
- Node.js, pnpm, and npm do **not** need to be preinstalled — the launcher installs Node.js 24 and, after updating the repos, activates the pnpm version declared in DeepSeek Harness's `package.json`, keeping both inside `.runtime/`

## Usage

```bash
cd /path/to/Harness-Oneclick-start
chmod +x Harness.sh
./Harness.sh
```

On the first run it asks for your DeepSeek API key (it is saved to `.runtime/dsh-home/.env`, never committed), downloads the two repos, builds them, installs the market plugin, and starts the GUI:

```text
Harness GUI: http://127.0.0.1:13080
```

After startup, open a new session. Stop with `Ctrl+C`.

Only one launcher may use a runtime directory at a time. A duplicate launch or occupied web port stops before updates and builds; use the existing window, or stop its terminal with `Ctrl+C` before restarting.

## Environment overrides

| Variable | Default | Meaning |
|---|---|---|
| `DEEPSEEK_API_KEY` | — | DeepSeek API key (asked once, stored in `$DSH_HOME/.env`) |
| `DSH_WORKSPACE` | launch directory | agent working directory |
| `DSH_WEB_HOST` | `127.0.0.1` | web bind host |
| `DSH_WEB_PORT` | `13080` | web bind port |
| `DSH_HOME` | `.runtime/dsh-home` | harness home (profiles, sessions, presets) |
| `DSH_RUNTIME_ROOT` | `<project>/.runtime` | runtime root |
| `OUROBOROS_AGENT_RUNTIME` | `codex` when the Codex CLI is available | executable agent runtime used by the Ouroboros MCP server |

Example:

```bash
DSH_WORKSPACE=/mnt/e/my-project ./Harness.sh
```

## Data and cleanup

Everything downloaded or generated stays under `.runtime/`:

```text
.runtime/checkouts/    the two upstream repos (older checkouts are retained)
.runtime/dsh-home/     harness home: profiles, sessions, presets, API key
.runtime/nvm/          Node.js toolchain
.runtime/pnpm-*/       pnpm store and home
```

`.runtime/` is git-ignored. Delete it to fully reset the generated environment (it is recreated on the next start). It contains your API key and session data — never commit or share it.

## License

MIT
