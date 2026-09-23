/**
 * Restore the icon names used by Better Sidebar 0.19 without changing Harness's
 * shared module table. Current icons retain the same glyph names, with explicit
 * stroke weights replacing their old size suffixes.
 */
const primitiveNamespace = '_deepseek_ai_dsh_client_ui_primitives'
const marker = '// Harness-Oneclick-start: Better Sidebar icon compatibility.'
const iconNames = {
  IconApiOutline14: 'IconApiOutlineRegular',
  IconBrowseOutline16: 'IconBrowseOutlineRegular',
  IconCheckOutline16: 'IconCheckOutlineRegular',
  IconChevronDownOutline14: 'IconChevronDownOutlineRegular',
  IconChevronLeftOutline14: 'IconChevronLeftOutlineRegular',
  IconChevronRightOutline14: 'IconChevronRightOutlineRegular',
  IconCloseFill14: 'IconCloseFillRegular',
  IconCloseOutline16: 'IconCloseOutlineRegular',
  IconCodeOutline16: 'IconCodeOutlineRegular',
  IconCopyOutline16: 'IconCopyOutlineRegular',
  IconDownloadOutline16: 'IconDownloadOutlineRegular',
  IconEditOutline16: 'IconEditOutlineRegular',
  IconFolderOpen16: 'IconFolderOpenRegular',
  IconLinkOutline14: 'IconLinkOutlineRegular',
  IconLinkOutline16: 'IconLinkOutlineRegular',
  IconListPenOutline16: 'IconListPenOutlineRegular',
  IconNewChatOutline16: 'IconNewChatOutlineRegular',
  IconPanelLeftOutline16: 'IconPanelLeftOutlineRegular',
  IconPlusOutline16: 'IconPlusOutlineRegular',
  IconRefreshOutline14: 'IconRefreshOutlineRegular',
  IconRefreshOutline16: 'IconRefreshOutlineRegular',
  IconRightUpOutline16: 'IconRightUpOutlineRegular',
  IconSearchOutline16: 'IconSearchOutlineRegular',
  IconSendOutline16: 'IconSendOutlineRegular',
  IconSettingsOutline16: 'IconSettingsOutlineRegular',
  IconSparkle16: 'IconSparkleRegular',
  IconStopFill16: 'IconStopFillRegular',
  IconTrashOutline16: 'IconTrashOutlineRegular',
  IconWarningOutline16: 'IconWarningOutlineRegular',
}

/** Repair one generated main bundle or lazy chunk; modern bundles are unchanged. */
export function repairBetterSidebarIcons(input) {
  if (input.includes(marker)) return input
  const entries = Object.entries(iconNames).filter(([legacy]) =>
    new RegExp(`${primitiveNamespace}\\.${legacy}\\b`).test(input))
  if (!entries.length) return input

  const newline = input.includes('\r\n') ? '\r\n' : '\n'
  let source = input.replaceAll('\r\n', '\n')
  const imports = [...source.matchAll(/^([\t ]*)let _deepseek_ai_dsh_client_ui_primitives = require\(["']@deepseek-ai\/dsh-client-ui-primitives["']\);$/gm)]
  if (imports.length !== 1) {
    throw new Error('Better Sidebar client changed; cannot safely locate its UI primitive import for icon compatibility')
  }
  const indent = imports[0][1]
  const mappings = entries.map(([legacy, current]) => [legacy, current, Number(legacy.match(/\d+$/)[0])])
  const shim = [
    marker,
    `${primitiveNamespace} = ((primitives, createElement) => {`,
    '\tconst local = { ...primitives };',
    `\tfor (const [legacy, current, size] of ${JSON.stringify(mappings)}) {`,
    '\t\tif (local[legacy] != null) continue;',
    '\t\tconst Icon = primitives[current];',
    '\t\tif (Icon == null) throw new Error("Better Sidebar icon compatibility: missing " + current);',
    '\t\tlocal[legacy] = (props = {}) => createElement(Icon, {',
    '\t\t\t...props,',
    '\t\t\tsize: props.size === undefined ? size : props.size,',
    '\t\t});',
    '\t}',
    '\treturn local;',
    `})(${primitiveNamespace}, require("react").createElement);`,
  ].map(line => indent + line).join('\n')
  source = source.replace(imports[0][0], imports[0][0] + '\n' + shim)
  return newline === '\r\n' ? source.replaceAll('\n', '\r\n') : source
}
