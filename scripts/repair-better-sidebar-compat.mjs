/** Keep Better Sidebar's native file viewer working with current Harness. */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { repairBetterSidebarIcons } from './repair-better-sidebar-icons.mjs'

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) {
    throw new Error('Better Sidebar client changed; cannot safely migrate its session binding')
  }
  return source.replace(before, after)
}

/** The renderer's main binding changes even when the session list is unchanged. */
export function betterSidebarSession(ctx) {
  return ctx.uiSession.adapter.current.getSnapshot().key
}

export function repairBetterSidebarClient(input) {
  const newline = input.includes('\r\n') ? '\r\n' : '\n'
  let source = input.replaceAll('\r\n', '\n')
  const original = source
  const legacy = source.match(/^([\t ]*)function registerTurnTailInterception\(ctx, store\) \{\n[\s\S]*?^\1\}/m)
  if (legacy?.[0].includes('select: (owner) =>')) {
    // The existing native editor claims file addresses at extension priority.
    // Official deliverables and inline file links already use that route. The
    // old chain takeover cannot become a list entry: select/matched no longer
    // exist, and a second entry would duplicate the official deliverables.
    if (!source.includes('patterns: ["dsh-resource://file/**"]')
      || !source.includes('priority: "extension"')
      || !legacy[0].includes('}, SidebarProducedFiles));')) {
      throw new Error('Better Sidebar client changed; native file routing was not found')
    }
    const indent = legacy[1]
    source = source.replace(legacy[0], `${indent}function registerTurnTailInterception() {\n${indent}\t// Harness list slots use the native file viewer registered by registerNativeSurface.\n${indent}\treturn () => {};\n${indent}}`)
  }

  if (source.includes('sessionList.current') || source.includes('ctx.sessions.list.getSnapshot().current')) {
    source = replaceOnce(source, 'const inject = [\n', 'const inject = [\n\t\t\t"uiSession",\n\t\t\t"uiWorkspace",\n\t\t\t"sidebarRight",\n')
    source = replaceOnce(source, 'function activeSessionId(ctx) {', `${betterSidebarSession.toString()}\n\t\tfunction activeSessionId(ctx) {`)
    source = replaceOnce(source, 'const current = sessionList.current;',
      'const current = (0, react.useSyncExternalStore)((0, react.useCallback)((listener) => ctx.uiSession.adapter.current.subscribe(listener), [ctx]), (0, react.useCallback)(() => betterSidebarSession(ctx), [ctx]));')
    // Native actions require the mounted seat, which can lag behind selection.
    source = source.replaceAll('ctx.sessions.list.getSnapshot().current', 'ctx.sidebarRight.mounted.getSnapshot()')
    source = replaceOnce(source, 'const unsubscribe = ctx.sessions.list.subscribe(flushPending);',
      'const unsubscribe = ctx.sidebarRight.mounted.subscribe(flushPending);')
    // The private *In methods silently drop opens for a seat not yet adopted.
    // Keep background requests queued for their target seat instead.
    for (const kind of ['Tab', 'Resource']) {
      const call = kind === 'Tab' ? 'entry.tabKind' : 'entry.address'
      const indent = kind === 'Tab' ? '\t\t\t\t\t' : '\t\t\t\t'
      source = replaceOnce(source,
        `${indent}if (api.open${kind}In !== void 0) {\n${indent}\tapi.open${kind}In(entry.sessionId, ${call}, options);\n${indent}\treturn true;\n${indent}}\n`, '')
    }
    source = replaceOnce(source, 'for (let index = pending.length - 1; index >= 0; index--) {',
      'for (let index = 0; index < pending.length;) {')
    source = replaceOnce(source, 'if (entry !== void 0 && place(entry)) pending.splice(index, 1);',
      'if (entry !== void 0 && place(entry)) pending.splice(index, 1); else index++;')
    for (const [before, after] of [
      ['sessions.openSubagent?.(address)', 'ctx.uiWorkspace.openSession(address)'],
      ['sessions.open?.(rootId)', 'ctx.uiWorkspace.openSession(rootId)'],
      ['ctx.sessions.open?.(newId)', 'ctx.uiWorkspace.openSession(newId)'],
      ['[sessions, onOpenChild]', '[ctx, sessions, onOpenChild]'],
      ['[sessions, rootId]', '[ctx, sessions, rootId]'],
    ]) source = replaceOnce(source, before, after)
  }
  return source === original ? input : source.replaceAll('\n', newline)
}

async function readOptional(path) {
  try { return await readFile(path, 'utf8') }
  catch (error) { if (error.code === 'ENOENT') return; throw error }
}

/** Do not rewrite older Harness releases or an absent plugin. */
export async function repairBetterSidebarCompatibility(profile, checkout = join(
  process.env.DSH_RUNTIME_ROOT || fileURLToPath(new URL('../.runtime/', import.meta.url)),
  'checkouts/deepseek-harness',
)) {
  const [slots, session] = await Promise.all([
    readOptional(join(checkout, 'packages/client/ui-chat/src/client/chat/register-node-renderers.ts')),
    readOptional(join(checkout, 'packages/client/ui-session/src/client/index.ts')),
  ])
  if (!/'conversation\.chat\.turnTail':\s*\{\s*kind:\s*'list'/.test(slots ?? '')
    || !session?.includes('current: this.current')) return
  const directory = join(profile, 'node_modules/dsh-better-sidebar/lib')
  let files
  try { files = await readdir(directory) }
  catch (error) { if (error.code === 'ENOENT') return; throw error }
  const pending = []
  for (const file of files.filter(file => /^client(?:-.+)?\.js$/.test(file))) {
    const path = join(directory, file)
    const source = await readFile(path, 'utf8')
    const repaired = repairBetterSidebarIcons(file === 'client.js' ? repairBetterSidebarClient(source) : source)
    if (repaired !== source) pending.push({ path, repaired })
  }
  // Validate the main bundle and lazy chunks before modifying any of them.
  for (const { path, repaired } of pending) await writeFile(path, repaired)
  if (pending.length > 0) {
    console.log('Migrated Better Sidebar file previews, session binding, and renamed icons')
  }
}
