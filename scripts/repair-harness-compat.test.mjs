import assert from 'node:assert/strict'
import { stripTypeScriptTypes } from 'node:module'
import { test } from 'node:test'
import { repairPiSessionHeaders, repairSessionRowIdentity } from './repair-harness-compat.mjs'

const rows = `<div
      role="treeitem"
      onClick={onToggle}
    />
    <div
      role="treeitem"
      aria-selected={selected}
      onClick={() => { onOpen(result.id) }}
    />
    <div
      role="treeitem"
      aria-selected={selected}
      onClick={() => { onOpen(node.id) }}
    />
`

for (const description of ['', "      aria-description={row.archived ? t('toast.archivedNotOpenable') : undefined}\n"]) {
  for (const newline of ['\n', '\r\n']) {
    test(`session identity supports ${description ? 'new' : 'old'} rows with ${newline === '\n' ? 'LF' : 'CRLF'}`, () => {
      const source = rows.replace('      onClick={() => { onOpen(node.id) }}', `${description}      onClick={() => { onOpen(node.id) }}`).replaceAll('\n', newline)
      const patched = repairSessionRowIdentity(source)
      assert.equal(patched.split('data-session-id=').length, 2)
      assert.ok(patched.includes(`data-session-id={node.id}${newline}      onClick={() => { onOpen(node.id) }}`))
      assert.equal(patched.replace(`      data-session-id={node.id}${newline}`, ''), source)
      assert.equal(repairSessionRowIdentity(patched), patched)
    })
  }
}

test('session identity preserves indentation and rejects missing or ambiguous session rows', () => {
  const source = rows.replace('      onClick={() => { onOpen(node.id) }}', '\tonClick={() => { onOpen(node.id) }}')
  assert.ok(repairSessionRowIdentity(source).includes('\tdata-session-id={node.id}\n\tonClick='))
  assert.throws(() => repairSessionRowIdentity(rows.replace('onOpen(node.id)', 'onOpen(other.id)')), /Session row markup changed/)
  assert.throws(() => repairSessionRowIdentity(rows + rows), /Session row markup changed/)
})

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
