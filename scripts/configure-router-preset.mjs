#!/usr/bin/env node

/** Apply launcher-owned policy overrides to a copied Router Standard preset. */

import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'

const [configPath, thresholdText] = process.argv.slice(2)
const threshold = Number(thresholdText)
if (!configPath || !Number.isFinite(threshold) || threshold <= 0 || threshold >= 1) {
  console.error('usage: configure-router-preset.mjs <agent.cordis.yml> <threshold-ratio>')
  process.exitCode = 2
} else {
  const source = await readFile(configPath, 'utf8')
  const compactionBlock = /(\n\s*- id: compaction-basic\b[\s\S]*?\n\s*config:\s*\n)([\s\S]*?)(?=\n\s*- id:|$)/
  const match = source.match(compactionBlock)
  if (!match) throw new Error(`cannot locate compaction-basic config in ${configPath}`)

  const thresholdLine = /^(\s*thresholdRatio:\s*)[^\s#]+/m
  if (!thresholdLine.test(match[2])) {
    throw new Error(`cannot locate compaction-basic thresholdRatio in ${configPath}`)
  }
  const configuredBlock = match[0].replace(thresholdLine, `$1${threshold}`)
  const configured = source.replace(compactionBlock, configuredBlock)
  if (configured !== source) {
    await writeFile(configPath, configured)
    console.log(`Configured Router Standard compaction thresholdRatio=${threshold}`)
  }
}
