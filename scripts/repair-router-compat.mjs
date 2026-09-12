#!/usr/bin/env node

/** Preserve legacy Router persona text under Harness's new prefix field. */
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export function migratePersonaText(source) {
  // Edit only the persona config key. Reserializing the complete preset
  // would disturb its !!js expressions, comments and multiline prose.
  const lines = source.split('\n')
  for (let index = 0; index < lines.length; index++) {
    const name = lines[index].match(/^( *)name: ['"]?@deepseek-ai\/dsh-persona['"]?\s*(?:#.*)?$/)
    if (!name) continue
    const indent = name[1]
    if (lines[index + 1]?.trim() !== 'config:') continue
    const fieldIndent = `${indent}  `
    let textIndex = -1
    let hasPrefix = false
    for (let cursor = index + 2; cursor < lines.length; cursor++) {
      const line = lines[cursor]
      if (!line.trim() || line.trimStart().startsWith('#')) continue
      if (!line.startsWith(fieldIndent)) break
      const field = line.slice(fieldIndent.length)
      if (/^text:/.test(field)) textIndex = cursor
      if (/^prefix:/.test(field)) hasPrefix = true
    }
    if (textIndex >= 0 && !hasPrefix) {
      lines[textIndex] = fieldIndent + lines[textIndex].slice(fieldIndent.length).replace(/^text:/, 'prefix:')
    }
  }
  return lines.join('\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [configPath] = process.argv.slice(2)
  if (!configPath) throw new Error('usage: repair-router-compat.mjs <agent.cordis.yml>')
  const source = await readFile(configPath, 'utf8')
  const repaired = migratePersonaText(source)
  if (repaired !== source) {
    await writeFile(configPath, repaired)
    console.log('Repaired Router preset compatibility: persona.text -> persona.prefix')
  }
}
