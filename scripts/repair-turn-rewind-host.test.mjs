import assert from 'node:assert/strict'
import { test } from 'node:test'
import { repairTurnRewindHost } from './repair-turn-rewind-host.mjs'

const original = `import { ChangeLedgerEngine } from './engine.js';
import { installTurnRewindSettings } from './settings.js';
export class ChangeLedgerService {
    engine;
    constructor(ctx, config = {}) {
        ctx.provide('changeLedger', this);
        this.engine = new ChangeLedgerEngine(config);
        installTurnRewindSettings(ctx, config, this.engine);
    }
    updateConfig(config) {
        this.engine.updateConfig(config);
    }
}
export default ChangeLedgerService;
`

function evaluate(source) {
  // The installed plugin's older schema has serialization but no volatile method.
  const schema = { toJSON() { return { type: 'number' } } }
  const settingsSchema = { dict: { maxFiles: schema, turnCheckpointMode: schema } }
  function z(serialized) { this.volatile = () => ({ ...serialized, live: true }) }
  z.object = dict => ({ dict })
  z.string = () => ({ type: 'string' })
  class Engine {
    constructor(config) { this.config = config; this.history = [config] }
    updateConfig(config) {
      assert.equal(config.storageDir, this.config.storageDir, 'live edits must preserve the storage root')
      this.config = config
      this.history.push(config)
    }
  }
  const executable = source
    .replace(/^import .*;\r?\n/gm, '')
    .replace('export class ChangeLedgerService', 'class ChangeLedgerService')
    .replace('export default ChangeLedgerService;', 'return ChangeLedgerService;')
  return new Function('z', 'TurnRewindSettingsSchema', 'ChangeLedgerEngine', executable)(z, settingsSchema, Engine)
}

test('live config starts and updates the same engine with plain values and a fixed storage root', () => {
  const Plugin = evaluate(repairTurnRewindHost(original))
  assert.equal(Plugin.Config.dict.maxFiles.live, true)
  assert.equal(Plugin.Config.dict.turnCheckpointMode.live, true)
  assert.deepEqual(Plugin.Config.dict.storageDir, { type: 'string' })
  const listeners = new Map()
  let maxFiles = 12
  let mode = 'auto'
  const config = {
    storageDir: '/persistent/checkpoints',
    maxFiles: { get: () => maxFiles },
    turnCheckpointMode: { get: () => mode },
  }
  const provided = new Map()
  const plugin = new Plugin({
    provide: (key, value) => provided.set(key, value),
    on: (event, listener) => listeners.set(event, listener),
  }, config)
  const engine = plugin.engine
  assert.equal(provided.get('changeLedger'), plugin)
  assert.deepEqual(engine.config, { storageDir: '/persistent/checkpoints', maxFiles: 12, turnCheckpointMode: 'auto' })
  assert.equal(listeners.size, 1)
  maxFiles = 27
  mode = 'off'
  listeners.get('loader/volatile-update')()
  assert.equal(plugin.engine, engine)
  assert.deepEqual(engine.config, { storageDir: '/persistent/checkpoints', maxFiles: 27, turnCheckpointMode: 'off' })
  assert.equal(engine.history.length, 2)
  assert.equal(config.maxFiles.get(), 27, 'Cordis live references remain intact')
  plugin.updateConfig({ storageDir: '/persistent/checkpoints', maxFiles: 9 })
  assert.equal(engine.config.maxFiles, 9, 'public engine configuration passthrough is unchanged')
})

test('direct class construction still accepts ordinary config values', () => {
  const Plugin = evaluate(repairTurnRewindHost(original))
  const plugin = new Plugin({ provide() {}, on() {} }, { storageDir: '/existing', maxFiles: 7, turnCheckpointMode: 'off' })
  assert.deepEqual(plugin.engine.config, { storageDir: '/existing', maxFiles: 7, turnCheckpointMode: 'off' })
})

test('host repair is idempotent and preserves LF or CRLF formatting', () => {
  for (const newline of ['\n', '\r\n']) {
    const source = original.replaceAll('\n', newline)
    const repaired = repairTurnRewindHost(source)
    assert.equal(repairTurnRewindHost(repaired), repaired)
    assert.ok(!repaired.includes('installTurnRewindSettings'))
    if (newline === '\r\n') assert.ok(!/(?<!\r)\n/.test(repaired))
  }
})

test('hosts already migrated upstream pass through without changes', () => {
  const future = "export class ChangeLedgerService { static Config = newConfig; }\n"
  assert.equal(repairTurnRewindHost(future), future)
})

test('ambiguous or changed legacy implementations fail before any partial repair', () => {
  for (const source of [
    original + original,
    original.replace('installTurnRewindSettings(ctx, config, this.engine);', 'installTurnRewindSettings(ctx, changed, this.engine);'),
    original.replace('new ChangeLedgerEngine(config)', 'new ChangeLedgerEngine(otherConfig)'),
    original.replace('engine;', 'static Config = existing;\n    engine;'),
  ]) assert.throws(() => repairTurnRewindHost(source), /Turn Rewind host/)
})

test('explicit schema runtime is retained and upgrades the previous local repair', () => {
  const specifier = 'file:///runtime/vendor/schemastery/lib/index.mjs'
  const repaired = repairTurnRewindHost(original, specifier)
  assert.ok(repaired.includes(`import z from ${JSON.stringify(specifier)};`))
  assert.equal(repairTurnRewindHost(repaired, specifier), repaired)
  const initialRepair = repaired
    .replace(JSON.stringify(specifier), "'@deepseek-ai/schemastery'")
    .replace('new z(schema.toJSON()).volatile()', 'schema.volatile()')
  assert.equal(repairTurnRewindHost(initialRepair, specifier), repaired)
})
