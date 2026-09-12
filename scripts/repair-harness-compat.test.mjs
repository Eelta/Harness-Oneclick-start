import assert from 'node:assert/strict'
import { stripTypeScriptTypes } from 'node:module'
import { test } from 'node:test'
import { repairPiSessionHeaders } from './repair-harness-compat.mjs'

const original = `function requestHeaders(headers: Readonly<Record<string, string>> | undefined): Record<string, string> {
  const attribution = attributionHeaders()
  const reserved = new Set(Object.keys(attribution).map(name => name.toLowerCase()))
  return {
    ...Object.fromEntries(Object.entries(headers ?? {}).filter(([name]) => !reserved.has(name.toLowerCase()))),
    ...attribution,
  }
}
const options = { headers: requestHeaders(profile.headers) }
`

test('patch is idempotent and rejects changed upstream code', () => {
  const patched = repairPiSessionHeaders(original)
  assert.equal(repairPiSessionHeaders(patched), patched)
  assert.ok(patched.includes('headers: requestHeaders(profile.headers, options.sessionId)'))
  assert.throws(() => repairPiSessionHeaders(original.replace('profile.headers', 'other.headers')), /changed/)
})

test('headers remain stable within conversations and distinct between conversations', () => {
  const patched = repairPiSessionHeaders(original).split('\nconst options =')[0]
  const headers = new Function('attributionHeaders', `${stripTypeScriptTypes(patched)}; return requestHeaders`)(
    () => ({ 'user-agent': 'deepseek-harness/test' }),
  )
  const profile = { 'X-OpenCode-Session': 'stale', 'X-DeepSeek-Harness-Session-ID': 'stale', 'User-Agent': 'wrong', 'x-company': 'keep' }
  for (const id of ['conversation-a', 'conversation-a', 'conversation-b']) {
    assert.deepEqual(headers(profile, id), {
      'user-agent': 'deepseek-harness/test',
      'x-company': 'keep',
      'x-opencode-session': id,
      'x-deepseek-harness-session-id': id,
    })
  }
  assert.equal(profile['X-OpenCode-Session'], 'stale')
  assert.deepEqual(headers(undefined, undefined), { 'user-agent': 'deepseek-harness/test' })
})
