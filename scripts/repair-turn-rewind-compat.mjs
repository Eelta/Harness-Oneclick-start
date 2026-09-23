/** Adapt Turn Rewind's old settings services to schema-backed Harness forms. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { repairTurnRewindHost } from './repair-turn-rewind-host.mjs'

/** Translate refused writes into the rejection handled by the legacy card. */
export function bindTurnRewindSettingsForm(form) {
  const save = async (operation, args) => {
    if (await form[operation](...args) === false) {
      throw new Error('设置未保存：可能存在配置冲突，请刷新后重试。')
    }
  }
  return {
    getSnapshot: () => form.getSnapshot(),
    subscribe: listener => form.subscribe(listener),
    set: (field, value) => save('set', [field, value]),
    unset: field => save('unset', [field]),
  }
}

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) {
    throw new Error('Turn Rewind client changed; cannot migrate its settings service')
  }
  return source.replace(before, after)
}

/** Preserve rewind actions while moving the settings card to its plugin page. */
export function repairTurnRewindClient(source) {
  if (source.includes("'settingsScope'")) {
    for (const [before, after] of [
      ["exports.inject = ['slots', 'sessions', 'conversation', 'settingsScope'];",
        "exports.inject = ['slots', 'sessions', 'conversation', 'configForms'];"],
      ["ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({",
        "ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({"],
      ["name: 'settings.plugin.item',", "name: 'plugins.bundle.config',"],
      ["key: 'turn-rewind',", "key: '@anionex/dsh-turn-rewind',"],
      ["ctx.settingsScope?.bind({ namespace: 'turn-rewind' })", "ctx.configForms.get('turn-rewind')"],
    ]) source = replaceOnce(source, before, after)
  }
  const binding = "scope: ctx.configForms.get('turn-rewind')"
  if (!source.includes(binding)) return source
  source = replaceOnce(source, 'function apply(ctx) {', `${bindTurnRewindSettingsForm.toString()}
function apply(ctx) {
    const turnRewindSettingsForm = bindTurnRewindSettingsForm(ctx.configForms.get('turn-rewind'));`)
  return replaceOnce(source, binding, 'scope: turnRewindSettingsForm')
}

async function readOptional(path) {
  try { return await readFile(path, 'utf8') }
  catch (error) { if (error.code === 'ENOENT') return; throw error }
}

/** Patch installed files only on Harness releases providing configForms. */
export async function repairTurnRewindCompatibility(profile, checkout = join(
  process.env.DSH_RUNTIME_ROOT || fileURLToPath(new URL('../.runtime/', import.meta.url)),
  'checkouts/deepseek-harness',
)) {
  const forms = await readOptional(join(checkout, 'packages/client/ui-settings/src/client/config-form.ts'))
  if (!forms?.includes("super(ctx, 'configForms')")) return
  const directory = join(profile, 'node_modules/@anionex/dsh-turn-rewind/lib')
  const clientPath = join(directory, 'client.js')
  const hostPath = join(directory, 'index.js')
  const [client, host] = await Promise.all([readOptional(clientPath), readOptional(hostPath)])
  if (client === undefined || host === undefined) return
  // Validate both transformations before changing either side of the plugin.
  const repairedClient = repairTurnRewindClient(client)
  const schema = pathToFileURL(join(checkout, 'vendor/schemastery/lib/index.mjs')).href
  const repairedHost = repairTurnRewindHost(host, schema)
  if (repairedClient !== client) await writeFile(clientPath, repairedClient)
  if (repairedHost !== host) await writeFile(hostPath, repairedHost)
  if (repairedClient !== client || repairedHost !== host) {
    console.log('Migrated Turn Rewind to Harness configuration forms and plugin settings page')
  }
}
