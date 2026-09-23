import test from 'node:test'
import assert from 'node:assert/strict'
import { repairBetterSidebarIcons } from './repair-better-sidebar-icons.mjs'

// Names read from Better Sidebar 0.19.1's main, editor and mermaid bundles.
// Keep this fixture independent of .runtime so upgrades cannot hide regressions.
const legacyNames = [
  'IconApiOutline14', 'IconBrowseOutline16', 'IconCheckOutline16',
  'IconChevronDownOutline14', 'IconChevronLeftOutline14', 'IconChevronRightOutline14',
  'IconCloseFill14', 'IconCloseOutline16', 'IconCodeOutline16', 'IconCopyOutline16',
  'IconDownloadOutline16', 'IconEditOutline16', 'IconFolderOpen16', 'IconLinkOutline14',
  'IconLinkOutline16', 'IconListPenOutline16', 'IconNewChatOutline16',
  'IconPanelLeftOutline16', 'IconPlusOutline16', 'IconRefreshOutline14',
  'IconRefreshOutline16', 'IconRightUpOutline16', 'IconSearchOutline16',
  'IconSendOutline16', 'IconSettingsOutline16', 'IconSparkle16', 'IconStopFill16',
  'IconTrashOutline16', 'IconWarningOutline16',
]
const namespace = '_deepseek_ai_dsh_client_ui_primitives'
function fixture(names = legacyNames) {
  return [
    '\tlet react = require("react");',
    '\tlet _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");',
    '\tlet react_jsx_runtime = require("react/jsx-runtime");',
    `\treturn { ${names.map(name => `${name}: ${namespace}.${name}`).join(', ')} };`,
  ].join('\n')
}
function evaluate(source, primitives) {
  const createElement = (type, props) => ({ type, props })
  const require = (id) => {
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    if (id === 'react') return { createElement }
    if (id === 'react/jsx-runtime') return { jsx: createElement }
    throw new Error('Unexpected dependency: ' + id)
  }
  return new Function('require', source)(require)
}
function currentPrimitives() {
  return Object.fromEntries(legacyNames.map(name => [
    name.replace(/(?:14|16)$/, 'Regular'), function CurrentIcon() {},
  ]))
}

test('every removed icon resolves to its matching glyph and keeps the old default size', () => {
  const primitives = Object.freeze(currentPrimitives())
  const aliases = evaluate(repairBetterSidebarIcons(fixture()), primitives)
  assert.equal(Object.keys(aliases).length, 29)
  for (const name of legacyNames) {
    const icon = aliases[name]()
    assert.equal(icon.type, primitives[name.replace(/(?:14|16)$/, 'Regular')], name)
    assert.equal(icon.props.size, Number(name.match(/\d+$/)[0]), name)
    assert.equal(primitives[name], undefined, 'the shared module must stay untouched')
  }
  // Both names now share a 16px-default glyph; the old 14px affordances must stay small.
  assert.equal(aliases.IconRefreshOutline14({ size: undefined }).props.size, 14)
  assert.equal(aliases.IconLinkOutline14({ size: undefined }).props.size, 14)
})

test('icon wrappers preserve explicit sizing and all other props', () => {
  const primitives = currentPrimitives()
  const { IconCloseFill14, IconSendOutline16 } = evaluate(repairBetterSidebarIcons(fixture()), primitives)
  assert.deepEqual(IconCloseFill14({ size: 12, className: 'tab-close', 'aria-label': 'Close' }), {
    type: primitives.IconCloseFillRegular,
    props: { size: 12, className: 'tab-close', 'aria-label': 'Close' },
  })
  assert.equal(IconSendOutline16({ size: 0 }).props.size, 0)
  assert.equal(IconSendOutline16({}).props.size, 16)
})

test('an older Harness with valid legacy exports keeps their original identity', () => {
  const legacyIcon = function LegacyIcon() {}
  const primitives = Object.freeze({ IconCloseFill14: legacyIcon })
  const aliases = evaluate(repairBetterSidebarIcons(fixture(['IconCloseFill14'])), primitives)
  assert.equal(aliases.IconCloseFill14, legacyIcon)
})

test('main and lazy chunks remain idempotent with LF and CRLF', () => {
  const chunkCases = [
    fixture(),
    'globalThis.__dshChunks__["editor"] = (require) => {\n' +
      fixture(['IconCheckOutline16', 'IconListPenOutline16']) + '\n};',
    'globalThis.__dshChunks__["mermaid"] = (require) => {\n' +
      fixture(['IconCopyOutline16']) + '\n};',
  ]
  for (const original of chunkCases) {
    for (const newline of ['\n', '\r\n']) {
      const input = original.replaceAll('\n', newline)
      const repaired = repairBetterSidebarIcons(input)
      assert.notEqual(repaired, input)
      assert.equal(repairBetterSidebarIcons(repaired), repaired)
      assert.equal(repaired.replaceAll(newline, '').includes('\n'), false)
      new Function(repaired)
    }
  }
})

test('modern names, unrelated modules, and non-icon primitive consumers stay unchanged', () => {
  for (const input of [
    fixture(['IconCloseFillRegular']),
    fixture(['writeClipboard']),
    'const otherModule = require("other-icons");\notherModule.IconCloseFill14;',
    'function IconCloseFill14() { return "local icon"; }',
  ]) assert.equal(repairBetterSidebarIcons(input), input)
  const original = fixture(['IconCloseFill14']) + '\notherModule.IconCloseFill14;'
  assert.ok(repairBetterSidebarIcons(original).endsWith('otherModule.IconCloseFill14;'))
})

test('ambiguous imports and missing replacement exports fail descriptively', () => {
  const input = fixture(['IconCloseFill14'])
  assert.throws(() => repairBetterSidebarIcons(input.replace(
    'let _deepseek_ai_dsh_client_ui_primitives = require',
    'const _deepseek_ai_dsh_client_ui_primitives = require',
  )), /cannot safely locate.*UI primitive import/)
  assert.throws(() => repairBetterSidebarIcons(input + '\n' + input),
    /cannot safely locate.*UI primitive import/)
  assert.throws(() => evaluate(repairBetterSidebarIcons(input), {}),
    /Better Sidebar icon compatibility: missing IconCloseFillRegular/)
})
