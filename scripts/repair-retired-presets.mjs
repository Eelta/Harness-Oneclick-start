/** Recover blank sessions stranded on removed launcher-owned Router presets. */
import { access, cp, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function needsPresetRepair(header, events, missing) {
  if (header.origin === 'subagent') return false
  let preset = header.agentPreset
  for (const event of events) {
    // Preserve the composition of sessions that already contain conversation.
    if (event.type === 'turn/start' || event.type === 'user/message') return false
    if (event.type === 'agent-preset/selected') preset = event.data.agentPreset
  }
  return missing.has(preset)
}

export async function repairBlankPreset(persistence, id, missing, beforeWrite) {
  const reader = await persistence.open(id, 'read')
  try {
    if (!needsPresetRepair(reader.header, (await reader.read()).events, missing)) return false
  } finally { await reader.close() }

  // Use the official backend's writer lease, format migration and append API.
  const writer = await persistence.open(id, 'write')
  try {
    const { events } = await writer.read()
    if (!needsPresetRepair(writer.header, events, missing)) return false
    await beforeWrite()
    await writer.append([{
      type: 'agent-preset/selected',
      seq: (events.at(-1)?.seq ?? -1) + 1,
      time: Date.now(),
      data: { agentPreset: 'standard' },
    }])
    await writer.flush()
    return true
  } finally { await writer.close() }
}

async function exists(path) {
  try { await access(path); return true }
  catch (error) { if (error.code === 'ENOENT') return false; throw error }
}

/** Accept both the declarative Web bundle and the older preset directory. */
export async function assertStandardPresetAvailable(checkout) {
  for (const path of [
    'packages/bundle/web-app/presets/standard.patch.yml',
    'packages/preset/agent-presets/presets/standard/agent.cordis.yml',
  ]) {
    if (await exists(join(checkout, path))) return
  }
  throw new Error('Cannot repair retired presets: the official standard preset is missing')
}

export async function repairRetiredPresets(checkout, home) {
  const missing = new Set()
  for (const id of ['router-standard', 'router-spec']) {
    if (!await exists(join(home, '.agent-presets', id, 'agent.cordis.yml'))) missing.add(id)
  }
  const sessions = join(home, 'sessions')
  if (!missing.size || !await exists(sessions)) return
  await assertStandardPresetAvailable(checkout)
  const { Context } = await import(pathToFileURL(join(checkout, 'vendor/cordis/lib/index.js')))
  const { default: Persistence } = await import(pathToFileURL(join(checkout, 'packages/session/session-persistence-jsonl/lib/index.js')))
  const ctx = new Context()
  let backup
  const beforeWrite = async () => {
    if (backup) return
    backup = join(home, 'backups', `retired-presets-${Date.now()}`)
    await mkdir(backup, { recursive: true, mode: 0o700 })
    await cp(sessions, join(backup, 'sessions'), { recursive: true, force: false, errorOnExist: true })
    console.log(`Backed up session logs to ${backup}`)
  }
  try {
    await ctx.plugin(Persistence, { root: sessions, compression: 'zstd' })
    for (const { header } of await ctx.sessionPersistence.list()) {
      try {
        if (await repairBlankPreset(ctx.sessionPersistence, header.id, missing, beforeWrite)) {
          console.log(`Repaired blank session ${header.id}: retired Router preset -> standard`)
        }
      } catch (error) {
        // Unreadable historical formats must not block other sessions' repair.
        // Writer/backup failures remain fatal so startup never claims success.
        if (error.name !== 'SessionFormatUnsupportedError') throw error
        console.warn(`Skipped preset repair for ${header.id}: unsupported historical session format`)
      }
    }
  } finally { await ctx.fiber.dispose() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [checkout, home] = process.argv.slice(2)
  if (!checkout || !home) throw new Error('usage: repair-retired-presets.mjs <harness-checkout> <DSH_HOME>')
  await repairRetiredPresets(resolve(checkout), resolve(home))
}
