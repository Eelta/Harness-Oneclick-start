import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { bindTurnRewindSettingsForm, repairTurnRewindClient } from './repair-turn-rewind-compat.mjs'

const client = `exports.inject = ['slots', 'sessions', 'conversation', 'settingsScope'];
exports.apply = apply;
function apply(ctx) {
    ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
        name: 'conversation.session.header.actions',
        id: 'turn-rewind-portals',
    }, 'rewind-actions'));
    ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
        name: 'settings.plugin.item',
        key: 'turn-rewind',
        inject: () => ({
            scope: ctx.settingsScope?.bind({ namespace: 'turn-rewind' }),
        }),
    }, 'settings-card'));
};`

test('activates on current services and preserves the settings form and rewind action', () => {
  const exports = {}
  runInNewContext(repairTurnRewindClient(client), { exports })
  assert.deepEqual(Array.from(exports.inject), ['slots', 'sessions', 'conversation', 'configForms'])
  const snapshot = {}
  const form = { getSnapshot() { return snapshot }, subscribe() {}, set() {}, unset() {} }
  const registrations = []
  exports.apply({
    get settingsScope() { assert.fail('retired service must never be read') },
    configForms: { get(id) { assert.equal(id, 'turn-rewind'); return form } },
    slots: {
      inject(name, install) {
        assert.ok(['conversation.session.header.actions', 'plugins.bundle.config'].includes(name))
        install()
      },
      register(options, component) { registrations.push({ options, component }) },
    },
  })
  assert.equal(registrations[0].options.id, 'turn-rewind-portals')
  assert.equal(registrations[0].component, 'rewind-actions')
  assert.equal(registrations[1].options.key, '@anionex/dsh-turn-rewind')
  assert.equal(registrations[1].options.inject().scope.getSnapshot(), snapshot)
  assert.equal(registrations[1].options.inject().scope, registrations[1].options.inject().scope)
  assert.equal(registrations[1].component, 'settings-card')
})

test('migration is repeatable and leaves already modern clients unchanged', () => {
  const patched = repairTurnRewindClient(client)
  assert.equal(repairTurnRewindClient(patched), patched)
  const modern = "exports.inject = ['slots', 'configForms'];"
  assert.equal(repairTurnRewindClient(modern), modern)
})

test('refuses changed or ambiguous old clients instead of partially migrating them', () => {
  assert.throws(() => repairTurnRewindClient(client.replace('namespace:', 'entry:')), /client changed/)
  assert.throws(() => repairTurnRewindClient(client + client), /client changed/)
})


test('settings writes report host refusals and preserve accepted edits and subscriptions', async () => {
  const snapshot = { status: 'ready', value: { maxFiles: 10 } }
  const calls = []
  let accepted = true
  let listener
  const form = bindTurnRewindSettingsForm({
    getSnapshot: () => snapshot,
    subscribe(callback) { listener = callback; return () => { listener = undefined } },
    async set(...args) { calls.push(['set', ...args]); return accepted },
    async unset(...args) { calls.push(['unset', ...args]); return accepted },
  })
  assert.equal(form.getSnapshot(), snapshot)
  const notify = () => {}
  const unsubscribe = form.subscribe(notify)
  assert.equal(listener, notify)
  unsubscribe()
  assert.equal(listener, undefined)
  await form.set('maxFiles', 20)
  await form.unset('maxFiles')
  assert.deepEqual(calls, [['set', 'maxFiles', 20], ['unset', 'maxFiles']])
  accepted = false
  await assert.rejects(form.set('maxFiles', 30), /设置未保存/)
  await assert.rejects(form.unset('maxFiles'), /设置未保存/)
})

test('settings transport errors propagate to the existing card error display', async () => {
  const failure = new Error('connection lost')
  const form = bindTurnRewindSettingsForm({
    async set() { throw failure },
    async unset() { throw failure },
  })
  await assert.rejects(form.set('maxFiles', 20), error => error === failure)
  await assert.rejects(form.unset('maxFiles'), error => error === failure)
})
