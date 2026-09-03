/** Give external session actions a stable identity instead of matching titles. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

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
