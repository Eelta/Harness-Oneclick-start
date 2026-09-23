/** Repair sidebar identity and provider session headers after upstream updates. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Add session identity without depending on adjacent accessibility attributes. */
export function repairSessionRowIdentity(source) {
  if (source.includes('data-session-id={node.id}')) return source
  // The session click target distinguishes this row from workspace/search rows.
  const anchor = /^([ \t]*)onClick=\{\(\) => \{ onOpen\(node\.id\) \}\}(?=\r?$)/gm
  if ([...source.matchAll(anchor)].length !== 1) {
    throw new Error('Session row markup changed; cannot apply stable session identity')
  }
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  return source.replace(anchor, (match, indent) => `${indent}data-session-id={node.id}${newline}${match}`)
}

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
  const repairedRows = repairSessionRowIdentity(source)
  if (repairedRows !== source) {
    await writeFile(path, repairedRows)
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
