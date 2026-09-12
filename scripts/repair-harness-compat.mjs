/** Repair sidebar identity and provider session headers after upstream updates. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Forward conversation identity even when the provider SDK ignores sessionId. */
export function repairPiSessionHeaders(source) {
  const call = 'headers: requestHeaders(profile.headers)'
  const repairedCall = 'headers: requestHeaders(profile.headers, options.sessionId)'
  if (source.includes(repairedCall) && source.includes("'x-opencode-session': String(sessionId)")) return source
  const signature = 'function requestHeaders(headers: Readonly<Record<string, string>> | undefined): Record<string, string> {'
  const attribution = '  const attribution = attributionHeaders()'
  for (const anchor of [call, signature, attribution]) {
    if (source.split(anchor).length !== 2) throw new Error('pi-ai request headers changed; cannot apply session routing compatibility')
  }
  return source
    .replace(call, repairedCall)
    .replace(signature, 'function requestHeaders(headers: Readonly<Record<string, string>> | undefined, sessionId: string | undefined): Record<string, string> {')
    .replace(attribution, `  const attribution = {
    ...attributionHeaders(),
    ...sessionId === undefined ? {} : {
      'x-deepseek-harness-session-id': String(sessionId),
      'x-opencode-session': String(sessionId),
    },
  }`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [checkout] = process.argv.slice(2)
  if (!checkout) throw new Error('usage: repair-harness-compat.mjs <checkout>')
  const path = join(checkout, 'packages/client/ui-workspace/src/client/rows/Rows.tsx')
  const source = await readFile(path, 'utf8')
  if (!source.includes('data-session-id={node.id}')) {
    const anchor = 'role="treeitem"\n      aria-selected={selected}\n      onClick={() => { onOpen(node.id) }}'
    if (source.split(anchor).length !== 2) throw new Error('Session row markup changed; cannot apply stable session identity')
    await writeFile(path, source.replace(anchor, 'data-session-id={node.id}\n      ' + anchor))
    console.log('Added stable session IDs to sidebar rows')
  }
  const adapterPath = join(checkout, 'packages/llm/llm-pi-ai/src/adapter.ts')
  const adapterSource = await readFile(adapterPath, 'utf8')
  const repairedAdapter = repairPiSessionHeaders(adapterSource)
  if (repairedAdapter !== adapterSource) {
    await writeFile(adapterPath, repairedAdapter)
    console.log('Added conversation session headers to pi-ai model requests')
  }
}
