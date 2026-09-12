import assert from 'node:assert/strict'
import { test } from 'node:test'
import { migratePersonaText } from './repair-router-compat.mjs'

const legacy = `- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: >-
      Persona using {{model}} and {{cwd}}.

      Keep this prose unchanged.
    complete: false
- id: other
  name: another-plugin
  config:
    text: leave alone
    enabled: !!js process.platform !== 'win32'
`

test('migrates only the persona field while preserving prose and expressions', () => {
  assert.equal(migratePersonaText(legacy), legacy.replace('    text: >-', '    prefix: >-'))
})

test('is idempotent and respects an upstream prefix', () => {
  const migrated = migratePersonaText(legacy)
  assert.equal(migratePersonaText(migrated), migrated)
  const explicit = legacy.replace('    text: >-', '    prefix: custom\n    text: >-')
  assert.equal(migratePersonaText(explicit), explicit)
})

test('handles nested rows, CRLF and unquoted package names', () => {
  const nested = legacy.replaceAll("'@deepseek-ai/dsh-persona'", '@deepseek-ai/dsh-persona')
    .split('\n').map(line => `    ${line}`).join('\r\n')
  assert.equal(migratePersonaText(nested), nested.replace('        text: >-', '        prefix: >-'))
})

test('leaves unrelated text and presets without a persona unchanged', () => {
  const unrelated = legacy.replace('@deepseek-ai/dsh-persona', 'another-persona')
  assert.equal(migratePersonaText(unrelated), unrelated)
})
