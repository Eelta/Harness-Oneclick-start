import assert from 'node:assert/strict'
import { test } from 'node:test'
import { needsPresetRepair, repairBlankPreset } from './repair-retired-presets.mjs'

const missing = new Set(['router-standard', 'router-spec'])
const header = { agentPreset: 'router-standard' }
const selected = preset => ({ type: 'agent-preset/selected', data: { agentPreset: preset } })

test('uses the latest selection and repairs only missing Router presets', () => {
  assert.equal(needsPresetRepair(header, [], missing), true)
  assert.equal(needsPresetRepair({ agentPreset: 'standard' }, [selected('router-spec')], missing), true)
  assert.equal(needsPresetRepair(header, [selected('standard')], missing), false)
  assert.equal(needsPresetRepair(header, [], new Set()), false)
  assert.equal(needsPresetRepair({ agentPreset: 'custom' }, [], missing), false)
})

test('preserves started sessions, user messages and subagents', () => {
  for (const type of ['turn/start', 'user/message']) {
    assert.equal(needsPresetRepair(header, [{ type }], missing), false)
  }
  assert.equal(needsPresetRepair({ ...header, origin: 'subagent' }, [], missing), false)
})

test('backs up before append, preserves existing events and is idempotent', async () => {
  const first = { seq: 0, type: 'permission/preset', time: 1, data: { id: 'unchanged' } }
  const events = [first]
  const calls = []
  const persistence = {
    open: async (_id, access) => ({
      header,
      read: async () => ({ events: [...events] }),
      append: async batch => { calls.push('append'); events.push(...batch) },
      flush: async () => { calls.push('flush') },
      close: async () => { calls.push(`close-${access}`) },
    }),
  }
  const backup = async () => { calls.push('backup') }
  assert.equal(await repairBlankPreset(persistence, 'session', missing, backup), true)
  assert.equal(events[0], first)
  assert.equal(events.length, 2)
  assert.deepEqual(events[1], { ...selected('standard'), seq: 1, time: events[1].time })
  assert.deepEqual(calls, ['close-read', 'backup', 'append', 'flush', 'close-write'])
  assert.equal(await repairBlankPreset(persistence, 'session', missing, backup), false)
  assert.equal(events.length, 2)
})

test('rechecks eligibility after acquiring the write lease', async () => {
  const persistence = {
    open: async (_id, access) => ({
      header,
      read: async () => ({ events: access === 'write' ? [{ type: 'turn/start' }] : [] }),
      close: async () => {},
      append: async () => assert.fail('must not append after a conversation starts'),
    }),
  }
  assert.equal(await repairBlankPreset(persistence, 'session', missing, async () => assert.fail('must not back up')), false)
})
