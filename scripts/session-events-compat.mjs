/** Read-only compatibility for plugins written before Session.snapshotEvents(). */
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtime = process.env.DSH_RUNTIME_ROOT || join(project, '.runtime')
const { Session } = await import(pathToFileURL(join(
  runtime, 'checkouts/deepseek-harness/packages/core/session/lib/index.js',
)).href)

// Preserve the native API on older releases. A getter keeps every read fresh
// while retaining the new API's immutable snapshot semantics.
if (!('events' in Session.prototype) && typeof Session.prototype.snapshotEvents === 'function') {
  Object.defineProperty(Session.prototype, 'events', {
    configurable: true,
    get() { return this.snapshotEvents() },
  })
}
