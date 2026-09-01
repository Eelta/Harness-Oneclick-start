#!/usr/bin/env bash
#
# Harness-Oneclick-start — one-click launcher for the official DeepSeek Harness.
#
# Every start does the same four steps:
#   1. ensure Linux Node.js 24 + the latest pnpm (kept inside .runtime/)
#   2. download or update the three upstream repos into .runtime/checkouts/
#        deepseek-harness   https://github.com/deepseek-ai/deepseek-harness.git
#        dsh-routing-suite  https://github.com/yjh051108/dsh-routing-suite.git
#        dsh-market         https://github.com/dsh-market/dsh-market.git
#   3. rebuild whatever changed and install it into the managed harness home:
#        dsh-super-injector (routing suite), dshmarket (market),
#        router-standard / router-spec presets (routing suite)
#   4. boot the official `dsh web` GUI with the official DeepSeek API
#
# Everything downloaded or generated lives under .runtime/, so the repository
# itself stays minimal and can be uploaded to GitHub as-is.
#
# Environment overrides:
#   DEEPSEEK_API_KEY   API key (asked once on first run, saved to $DSH_HOME/.env)
#   DSH_WORKSPACE      agent working directory (default: the launch directory)
#   DSH_WEB_HOST       web bind host (default 127.0.0.1)
#   DSH_WEB_PORT       web bind port (default 13080)
#   DSH_HOME           harness home (default .runtime/dsh-home)
#   DSH_RUNTIME_ROOT   runtime root (default <project>/.runtime)
#   OUROBOROS_AGENT_RUNTIME
#                      executable Ouroboros agent runtime; when unset, use
#                      codex automatically if the Codex CLI is available
#
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_ROOT="${DSH_RUNTIME_ROOT:-$PROJECT_ROOT/.runtime}"
CHECKOUTS_DIR="$RUNTIME_ROOT/checkouts"
STATE_DIR="$RUNTIME_ROOT/state"
HARNESS_CHECKOUT="$CHECKOUTS_DIR/deepseek-harness"
ROUTING_CHECKOUT="$CHECKOUTS_DIR/dsh-routing-suite"
MARKET_CHECKOUT="$CHECKOUTS_DIR/dsh-market"
INJECTOR_CHECKOUT="$ROUTING_CHECKOUT/injector"
DSH_HOME="${DSH_HOME:-$RUNTIME_ROOT/dsh-home}"
export DSH_HOME

# Confine every toolchain artifact and cache inside the disposable runtime
# root so nothing leaks into the user home or the repository.
export NVM_DIR="${DSH_NVM_DIR:-$RUNTIME_ROOT/nvm}"
export COREPACK_HOME="${DSH_COREPACK_HOME:-$RUNTIME_ROOT/corepack}"
export npm_config_cache="${DSH_NPM_CACHE:-$RUNTIME_ROOT/npm-cache}"
export PNPM_HOME="${DSH_PNPM_HOME:-$RUNTIME_ROOT/pnpm-home}"
export pnpm_config_store_dir="${DSH_PNPM_STORE:-$RUNTIME_ROOT/pnpm-store}"
export XDG_CACHE_HOME="${DSH_XDG_CACHE_HOME:-$RUNTIME_ROOT/cache}"
export TMPDIR="${DSH_TMPDIR:-$RUNTIME_ROOT/tmp}"
export PATH="$PNPM_HOME:$PATH"

say() { printf '==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

# ── toolchain ────────────────────────────────────────────────────────────────

linux_node_is_supported() {
  command -v node >/dev/null 2>&1 || return 1
  [[ "$(node -p 'process.platform' 2>/dev/null)" == linux ]] || return 1
  node -e 'const [major,minor]=process.versions.node.split(".").map(Number); process.exit((major===22&&minor>=19)||major>=24 ? 0 : 1)' >/dev/null 2>&1
}

activate_nvm_node() {
  [[ -s "$NVM_DIR/nvm.sh" ]] || return 1
  # shellcheck source=/dev/null
  source "$NVM_DIR/nvm.sh"
  nvm use --silent 24 >/dev/null 2>&1 || return 1
  linux_node_is_supported
}

ensure_linux_node() {
  [[ "$(uname -s)" == Linux ]] || die "this launcher must run inside WSL/Linux"
  linux_node_is_supported && return
  activate_nvm_node && return
  command -v git >/dev/null 2>&1 || die "git is required"
  mkdir -p "$RUNTIME_ROOT"
  if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
    [[ -e "$NVM_DIR" ]] && die "cannot install nvm: $NVM_DIR exists but is incomplete"
    say "Installing nvm in $NVM_DIR"
    git clone --depth 1 https://github.com/nvm-sh/nvm.git "$NVM_DIR"
  fi
  # shellcheck source=/dev/null
  source "$NVM_DIR/nvm.sh"
  say "Installing Linux Node.js 24"
  nvm install 24
  nvm alias default 24
  nvm use 24
  linux_node_is_supported || die "automatic Node.js installation failed"
}

ensure_pnpm() {
  local had_usable_pnpm=false
  if command -v pnpm >/dev/null 2>&1 && [[ "$(command -v pnpm)" != /mnt/* ]] \
    && [[ -n "$(pnpm --version 2>/dev/null || true)" ]]; then
    had_usable_pnpm=true
  fi
  command -v corepack >/dev/null 2>&1 || die "corepack is unavailable in the selected Node.js"
  say "Checking for the latest pnpm with Corepack"
  if corepack enable && corepack prepare pnpm@latest --activate; then
    hash -r
    command -v pnpm >/dev/null 2>&1 && [[ "$(command -v pnpm)" != /mnt/* ]] \
      && [[ -n "$(pnpm --version 2>/dev/null || true)" ]] && return
  fi
  if [[ "$had_usable_pnpm" == true ]]; then
    printf 'warning: could not update pnpm; using cached pnpm %s\n' "$(pnpm --version)" >&2
    return
  fi
  die "automatic pnpm installation failed"
}

configure_optional_plugin_env() {
  # Ouroboros' in-process `claude` SDK runtime cannot run inside an MCP
  # subprocess. Prefer the executable Codex CLI when this launcher can see it,
  # while preserving an explicit runtime selected by the user.
  if [[ -z "${OUROBOROS_AGENT_RUNTIME:-}" ]] && command -v codex >/dev/null 2>&1; then
    export OUROBOROS_AGENT_RUNTIME=codex
  fi
}

# ── repo sync (every start: check and update) ───────────────────────────────

sync_repo() {
  local name="$1" url="$2" with_submodules="$3" marker="$4"
  local path="$CHECKOUTS_DIR/$name"
  mkdir -p "$CHECKOUTS_DIR"
  if [[ ! -d "$path/.git" && ! -f "$path/.git" ]]; then
    say "Downloading $name ($url)"
    if [[ "$with_submodules" == true ]]; then
      git clone --recurse-submodules "$url" "$path"
      git -C "$path" submodule update --init --recursive
    else
      git clone --depth 1 "$url" "$path"
    fi
  else
    say "Updating $name"
    if git -C "$path" fetch --depth 1 origin HEAD; then
      git -C "$path" reset --hard FETCH_HEAD
      if [[ "$with_submodules" == true ]]; then
        git -C "$path" submodule sync --recursive
        git -C "$path" submodule update --init --recursive
      fi
    else
      printf 'warning: could not update %s; using the existing checkout\n' "$name" >&2
    fi
  fi
  [[ -e "$path/$marker" ]] || die "$name checkout is incomplete: $path"
}

repo_head() { git -C "$1" rev-parse HEAD; }

was_built() {
  local name="$1" head="$2"
  [[ -f "$STATE_DIR/built-$name" ]] && [[ "$(cat "$STATE_DIR/built-$name")" == "$head" ]]
}

mark_built() {
  local name="$1" head="$2"
  mkdir -p "$STATE_DIR"
  printf '%s\n' "$head" > "$STATE_DIR/built-$name"
}

# ── builds (only what changed since the last successful build) ───────────────

build_harness() {
  local head
  head="$(repo_head "$HARNESS_CHECKOUT")"
  if was_built harness "$head" && [[ -f "$HARNESS_CHECKOUT/apps/cli/lib/bin.js" ]]; then
    say "DeepSeek Harness is up to date ($head)"
    return
  fi
  say "Building DeepSeek Harness ($head)"
  pnpm --dir "$HARNESS_CHECKOUT" install --frozen-lockfile
  # Upstream upgrades can remove or rename packages. Their ignored build
  # outputs survive git reset --hard and tsdown would otherwise discover those
  # stale entries alongside the new source tree.
  pnpm --dir "$HARNESS_CHECKOUT" run clean
  pnpm --dir "$HARNESS_CHECKOUT" run build
  [[ -f "$HARNESS_CHECKOUT/apps/cli/lib/bin.js" ]] || die "harness build produced no apps/cli/lib/bin.js"
  mark_built harness "$head"
}

build_injector() {
  local head harness_head
  # the injector is vendored into the suite repo (upstream flattened its
  # submodules), so key the build on the suite checkout's HEAD; a leftover
  # submodule .git pointer inside injector/ would otherwise go stale
  head="$(repo_head "$ROUTING_CHECKOUT")"
  harness_head="$(repo_head "$HARNESS_CHECKOUT")"
  if was_built injector "$head" \
    && [[ "$(cat "$STATE_DIR/built-injector-harness" 2>/dev/null || true)" == "$harness_head" ]] \
    && [[ -f "$INJECTOR_CHECKOUT/lib/index.js" ]] && [[ -s "$INJECTOR_CHECKOUT/lib/client.js" ]]; then
    say "dsh-super-injector is up to date"
    return
  fi
  say "Building dsh-super-injector"
  mkdir -p "$INJECTOR_CHECKOUT/node_modules/@types"
  node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const link = path.resolve(process.argv[1]);
    const target = path.resolve(process.argv[2]);
    fs.rmSync(link, { recursive: true, force: true });
    fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
  ' "$INJECTOR_CHECKOUT/node_modules/@types/node" "$HARNESS_CHECKOUT/node_modules/@types/node"
  DSH_CHECKOUT="$HARNESS_CHECKOUT" bash "$INJECTOR_CHECKOUT/scripts/build.sh"
  (cd "$INJECTOR_CHECKOUT" && "$HARNESS_CHECKOUT/node_modules/.bin/tsdown")
  [[ -s "$INJECTOR_CHECKOUT/lib/client.js" ]] || die "injector client bundle was not produced"
  mark_built injector "$head"
  printf '%s\n' "$harness_head" > "$STATE_DIR/built-injector-harness"
}

build_market() {
  local head
  head="$(repo_head "$MARKET_CHECKOUT")"
  if was_built market "$head" && [[ -f "$MARKET_CHECKOUT/lib/index.js" ]]; then
    say "dsh-market is up to date"
    return
  fi
  say "Building dsh-market"
  (cd "$MARKET_CHECKOUT" && npm install --no-audit --no-fund)
  [[ -f "$MARKET_CHECKOUT/lib/index.js" ]] || (cd "$MARKET_CHECKOUT" && npm run build)
  [[ -f "$MARKET_CHECKOUT/lib/index.js" ]] || die "market build produced no lib/index.js"
  mark_built market "$head"
}

# ── installation into the managed harness home ───────────────────────────────

dsh_plugin() {
  DSH_HOME="$DSH_HOME" node "$HARNESS_CHECKOUT/apps/cli/lib/bin.js" plugin --profile web "$@"
}

plugin_is_installed() {
  local package_name="$1" checkout="$2"
  local profile_dir="$DSH_HOME/profiles/web"
  [[ -e "$profile_dir/node_modules/$package_name" ]] || return 1
  [[ "$(readlink -f "$profile_dir/node_modules/$package_name")" == "$(readlink -f "$checkout")" ]] || return 1
  node -e '
    const fs = require("node:fs");
    const [profile, name, checkout] = process.argv.slice(1);
    const manifest = JSON.parse(fs.readFileSync(profile, "utf8"));
    const linked = manifest.dependencies?.[name] === `link:${checkout}`;
    const bundled = manifest.dsh?.profile?.bundles?.includes(name);
    process.exit(linked && bundled ? 0 : 1);
  ' "$profile_dir/package.json" "$package_name" "$checkout"
}

repair_relocated_profile() {
  local profile_dir="$DSH_HOME/profiles/web"
  local manifest="$profile_dir/package.json"
  local modules_state="$profile_dir/node_modules/.modules.yaml"
  local expected_store
  local repair_needed
  [[ -f "$manifest" ]] || return
  expected_store="$(pnpm store path)"

  # Profiles and their pnpm metadata contain absolute paths. If the launcher
  # directory is renamed or copied, rewrite our managed link dependencies and
  # rebuild node_modules against this runtime's store before `dsh plugin add`.
  repair_needed="$(node -e '
    const fs = require("node:fs");
    const [manifestPath, modulesPath, expectedStore, injector, market] = process.argv.slice(1);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const desiredLinks = new Map([
      ["@dsh-external/dsh-super-injector", `link:${injector}`],
      ["dshmarket", `link:${market}`],
    ]);
    let changed = false;
    for (const [name, desired] of desiredLinks) {
      const current = manifest.dependencies?.[name];
      if (typeof current === "string" && current.startsWith("link:") && current !== desired) {
        manifest.dependencies[name] = desired;
        changed = true;
      }
    }
    if (changed) fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    let wrongStore = false;
    if (fs.existsSync(modulesPath)) {
      const state = fs.readFileSync(modulesPath, "utf8");
      const match = state.match(/^\s*"storeDir":\s*"([^"]+)",?\s*$/m);
      wrongStore = Boolean(match && match[1] !== expectedStore);
    }
    process.stdout.write(changed || wrongStore ? "yes" : "no");
  ' "$manifest" "$modules_state" "$expected_store" "$INJECTOR_CHECKOUT" "$MARKET_CHECKOUT")"

  if [[ "$repair_needed" == yes ]]; then
    say "Repairing relocated web profile dependencies"
    pnpm --dir "$profile_dir" install --force --no-frozen-lockfile
  fi
}

install_plugins() {
  if plugin_is_installed @dsh-external/dsh-super-injector "$INJECTOR_CHECKOUT"; then
    say "dsh-super-injector is already installed"
  else
    say "Installing dsh-super-injector into the web profile"
    dsh_plugin add "$INJECTOR_CHECKOUT"
  fi
  if plugin_is_installed dshmarket "$MARKET_CHECKOUT"; then
    say "dshmarket is already installed"
  else
    say "Installing dshmarket into the web profile"
    dsh_plugin add "$MARKET_CHECKOUT"
  fi
}

remove_unwanted_plugins() {
  local profile_manifest="$DSH_HOME/profiles/web/package.json"
  [[ -f "$profile_manifest" ]] || return
  if node -e '
    const manifest = require(process.argv[1]);
    process.exit(Object.hasOwn(manifest.dependencies ?? {}, process.argv[2]) ? 0 : 1);
  ' "$profile_manifest" dsh-vscode-mode; then
    say "Removing unneeded dsh-vscode-mode plugin from the web profile"
    dsh_plugin remove dsh-vscode-mode
  fi
}

install_presets() {
  local dest="$DSH_HOME/.agent-presets" preset router_standard_config
  say "Installing router presets into $dest"
  mkdir -p "$dest"
  for preset in router-standard router-spec; do
    if [[ -d "$ROUTING_CHECKOUT/preset/$preset" ]]; then
      rm -rf "$dest/$preset"
      cp -a "$ROUTING_CHECKOUT/preset/$preset" "$dest/"
    else
      printf 'warning: preset %s not found upstream; skipping\n' "$preset" >&2
    fi
  done
  router_standard_config="$dest/router-standard/agent.cordis.yml"
  if [[ -f "$router_standard_config" ]]; then
    node "$PROJECT_ROOT/scripts/configure-router-preset.mjs" "$router_standard_config" 0.7
  fi
}

repair_runtime_state() {
  say "Repairing stale session bookkeeping"
  node "$PROJECT_ROOT/scripts/repair-runtime.mjs" "$DSH_HOME"
}

repair_plugin_compat() {
  say "Repairing third-party plugin compatibility"
  node "$PROJECT_ROOT/scripts/repair-plugin-compat.mjs" "$DSH_HOME/profiles/web"
}

# ── API key ──────────────────────────────────────────────────────────────────

ensure_api_key() {
  local env_file="$DSH_HOME/.env"
  if [[ -z "${DEEPSEEK_API_KEY:-}" ]] && [[ -f "$env_file" ]] \
    && grep -q '^DEEPSEEK_API_KEY=.\+' "$env_file"; then
    DEEPSEEK_API_KEY="$(grep -m1 '^DEEPSEEK_API_KEY=.\+' "$env_file" | cut -d= -f2-)"
  fi
  if [[ -z "${DEEPSEEK_API_KEY:-}" ]]; then
    local key=""
    if [[ -t 0 ]]; then
      read -r -p "Enter your DeepSeek API key (sk-..., empty to skip): " key || true
    fi
    if [[ -n "$key" ]]; then
      mkdir -p "$DSH_HOME"
      umask 077
      printf 'DEEPSEEK_API_KEY=%s\n' "$key" >> "$env_file"
      chmod 600 "$env_file" 2>/dev/null || true
      DEEPSEEK_API_KEY="$key"
    else
      printf 'warning: DEEPSEEK_API_KEY is not set; model requests will fail until a key is provided\n' >&2
      printf '         set DEEPSEEK_API_KEY or add it to %s\n' "$env_file" >&2
    fi
  fi
  if [[ -n "${DEEPSEEK_API_KEY:-}" ]]; then
    export DEEPSEEK_API_KEY
  fi
}

# ── launch ───────────────────────────────────────────────────────────────────

start_web() {
  local workspace="${DSH_WORKSPACE:-$PWD}"
  local host="${DSH_WEB_HOST:-127.0.0.1}"
  local port="${DSH_WEB_PORT:-13080}"
  mkdir -p "$workspace"
  cd "$workspace"
  say "Starting Harness web GUI at http://$host:$port (workspace: $workspace)"
  exec node "$HARNESS_CHECKOUT/apps/cli/lib/bin.js" web --host "$host" --port "$port"
}

show_help() {
  cat <<'EOF'
Harness-Oneclick-start — official DeepSeek Harness one-click launcher

Usage:
  ./Harness.sh          download/update, build, install, and start
  ./Harness.sh --help   show this help

On every start it:
  1. ensures Linux Node.js 24 + the latest pnpm (inside .runtime/)
  2. downloads or updates into .runtime/checkouts/:
       deepseek-harness   https://github.com/deepseek-ai/deepseek-harness.git
       dsh-routing-suite  https://github.com/yjh051108/dsh-routing-suite.git
       dsh-market         https://github.com/dsh-market/dsh-market.git
  3. rebuilds whatever changed and installs it into the managed harness home:
       dsh-super-injector plugin, dshmarket plugin,
       router-standard / router-spec presets
  4. starts the official Harness web GUI (default http://127.0.0.1:13080)

Environment:
  DEEPSEEK_API_KEY   DeepSeek API key (asked once, saved to $DSH_HOME/.env)
  DSH_WORKSPACE      agent working directory (default: the launch directory)
  DSH_WEB_HOST       web bind host (default 127.0.0.1)
  DSH_WEB_PORT       web bind port (default 13080)
  DSH_HOME           harness home (default .runtime/dsh-home)
  DSH_RUNTIME_ROOT   runtime root (default <project>/.runtime)
EOF
}

main() {
  case "${1:-}" in
    "") ;;
    -h|--help) show_help; exit 0 ;;
    *) printf 'unknown option: %s (see ./Harness.sh --help)\n' "$1" >&2; exit 1 ;;
  esac
  mkdir -p "$RUNTIME_ROOT" "$STATE_DIR" "$TMPDIR"
  ensure_linux_node
  ensure_pnpm
  configure_optional_plugin_env
  command -v npm >/dev/null 2>&1 || die "Linux npm is required (missing from the selected Node.js)"
  ensure_api_key
  sync_repo deepseek-harness https://github.com/deepseek-ai/deepseek-harness.git false package.json
  # upstream flattened its submodules into the main repo (no .gitmodules at root
  # anymore); marker is a file guaranteed to exist in the suite checkout
  sync_repo dsh-routing-suite https://github.com/yjh051108/dsh-routing-suite.git false injector/package.json
  sync_repo dsh-market https://github.com/dsh-market/dsh-market.git false package.json
  build_harness
  build_injector
  build_market
  repair_relocated_profile
  install_plugins
  remove_unwanted_plugins
  install_presets
  repair_plugin_compat
  repair_runtime_state
  start_web
}

main "$@"
