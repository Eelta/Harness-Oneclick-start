#!/usr/bin/env node

/**
 * Apply launcher-owned policy overrides to a copied Router Standard preset.
 *
 * Runs on every launch after install_presets copies the preset from the
 * checkout (which sync_repo resets to upstream HEAD), so upstream changes
 * never eat these overrides:
 *
 *  1. compaction-basic thresholdRatio  (existing, argument-driven)
 *  2. POSIX tool-bash row              (launcher fix: router-standard drops the
 *     shell rows on POSIX — the web-app overlay disables the host rows, so
 *     without a preset-mounted row the phase-3 bash unlock is a no-op)
 *
 * Both patches are idempotent: they apply only when the target is missing or
 * differs, so an upstream version that already carries the fix is left alone.
 */

import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'

const [configPath, thresholdText] = process.argv.slice(2)
const threshold = Number(thresholdText)
if (!configPath || !Number.isFinite(threshold) || threshold <= 0 || threshold >= 1) {
  console.error('usage: configure-router-preset.mjs <agent.cordis.yml> <threshold-ratio>')
  process.exitCode = 2
} else {
  const source = await readFile(configPath, 'utf8')
  let configured = source

  // 1) compaction threshold override (unchanged behaviour).
  const compactionBlock = /(\n\s*- id: compaction-basic\b[\s\S]*?\n\s*config:\s*\n)([\s\S]*?)(?=\n\s*- id:|$)/
  const match = configured.match(compactionBlock)
  if (!match) throw new Error(`cannot locate compaction-basic config in ${configPath}`)
  const thresholdLine = /^(\s*thresholdRatio:\s*)[^\s#]+/m
  if (!thresholdLine.test(match[2])) {
    throw new Error(`cannot locate compaction-basic thresholdRatio in ${configPath}`)
  }
  configured = configured.replace(compactionBlock, match[0].replace(thresholdLine, `$1${threshold}`))

  // 2) POSIX shell row (launcher fix, idempotent). The preset only mounts
  //    tool-bash inside the win32-only gitbash-shell group, while the web-app
  //    overlay disables the host tool-bash row — POSIX ends up with no shell
  //    tool at all. Mirror the official standard preset's platform-gated row.
  if (!configured.includes('- id: tool-bash-posix')) {
    const anchor = /(- id: tool-pwsh\n  name: '@deepseek-ai\/dsh-tool-pwsh'\n  disabled: !!js process\.platform !== 'win32'\n)/
    const anchorMatch = configured.match(anchor)
    if (!anchorMatch) throw new Error(`cannot locate tool-pwsh row in ${configPath}`)
    configured = configured.replace(anchor, `$1\n# POSIX：web-app overlay 已禁用宿主 tool-bash 行，shell 工具必须由预设自挂\n# （官方 standard 预设同款行）。router-standard v1.20 缺此行走 POSIX 无 shell，\n# 阶段 3 解锁空承诺；此处补回平台门控行（win32 由上方 gitbash-shell 组提供 Git Bash，\n# id 取 tool-bash-posix 避免与组内行撞名）。\n- id: tool-bash-posix\n  name: '@deepseek-ai/dsh-tool-bash'\n  disabled: !!js process.platform === 'win32'\n`)
  }

  if (configured !== source) {
    await writeFile(configPath, configured)
    const insertedBash = configured.includes('- id: tool-bash-posix') && !source.includes('- id: tool-bash-posix')
    console.log(
      `Configured Router Standard preset: compaction thresholdRatio=${threshold}`
      + (insertedBash ? ', tool-bash-posix row inserted (POSIX shell fix)' : '')
    )
  }
}