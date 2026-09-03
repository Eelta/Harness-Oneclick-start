#!/usr/bin/env node

/** Repair known third-party client compatibility issues before web boot. */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

const profile = process.argv[2]
if (!profile) {
  console.error('usage: repair-plugin-compat.mjs <profile-directory>')
  process.exitCode = 2
} else {
  await migrateRemovedClientRuntime(profile)
  await migrateRemovedSettingsNamespace(profile)
  await migrateSessionDeleteIdentity(profile)
}

async function migrateSessionDeleteIdentity(profileDirectory) {
  const path = join(profileDirectory, 'node_modules/@huanlin/dsh-plugin-session-delete/src/client.js')
  let source
  try { source = await readFile(path, 'utf8') } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  // Current list snapshots expose items, replacing the old byId/ids maps.
  const original = source
  source = source.replace(
    'const summary = sessions && sessions.byId ? sessions.byId[sessionId] : undefined',
    'const summary = sessions?.items?.find(item => item.sessionId === sessionId) ?? sessions?.byId?.[sessionId]',
  ).replace(
    '(snap && snap.ids || []).find((id) => id !== target.sessionId)',
    '(snap?.items?.map(item => item.sessionId) ?? snap?.ids ?? []).find((id) => id !== target.sessionId)',
  )
  if (source.includes("row.getAttribute('data-session-id')")) {
    if (source !== original) await writeFile(path, source)
    return
  }
  const start = source.indexOf('    function openDeleteFlow(row) {')
  const end = source.indexOf('\n    function ensureSidebarDeleteItem()', start)
  if (start < 0 || end < 0) throw new Error('Session delete plugin changed; cannot repair sidebar identity')
  const replacement = `    function openDeleteFlow(row) {
      if (!row) return
      const sessionId = row.getAttribute('data-session-id')
      if (!sessionId) return
      const titleEl = row.querySelector('[class*=title]')
      const title = titleEl ? String(titleEl.innerText || '').trim() : ''
      window.dispatchEvent(new CustomEvent(EVENT, { detail: { sessionId, title } }))
    }
`
  await writeFile(path, source.slice(0, start) + replacement + source.slice(end))
  console.log('Repaired session deletion: sidebar actions now use the exact session ID')
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function installedPackageDirectories(profileDirectory) {
  const manifest = await readJson(join(profileDirectory, 'package.json'))
  return Object.keys(manifest.dependencies ?? {}).map(name => join(profileDirectory, 'node_modules', name))
}

async function javascriptFiles(root) {
  const files = []
  const pending = [root]
  while (pending.length > 0) {
    const directory = pending.pop()
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) pending.push(path)
      else if (entry.isFile() && entry.name.endsWith('.js')) files.push(path)
    }
  }
  return files
}

async function migrateRemovedClientRuntime(profileDirectory) {
  const oldPackage = '@deepseek-ai/dsh-client-runtime'
  const oldClient = `${oldPackage}/client`
  const replacement = '@deepseek-ai/dsh-client-store'
  let repairedManifests = 0
  let repairedBundles = 0

  for (const packageDirectory of await installedPackageDirectories(profileDirectory)) {
    const manifestPath = join(packageDirectory, 'package.json')
    let manifest
    try {
      manifest = await readJson(manifestPath)
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }

    const inject = manifest.dsh?.client?.inject
    if (Array.isArray(inject) && inject.includes(oldPackage)) {
      manifest.dsh.client.inject = inject.filter(name => name !== oldPackage)
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
      repairedManifests++
    }

    for (const path of await javascriptFiles(join(packageDirectory, 'lib'))) {
      const source = await readFile(path, 'utf8')
      if (!source.includes(oldClient)) continue
      await writeFile(path, source.replaceAll(oldClient, replacement))
      repairedBundles++
    }
  }

  if (repairedManifests > 0 || repairedBundles > 0) {
    console.log(
      `Migrated removed dsh-client-runtime references in ${repairedManifests} manifest(s) and ${repairedBundles} bundle(s)`,
    )
  }
}

async function migrateRemovedSettingsNamespace(profileDirectory) {
  const settingsPackage = '@deepseek-ai/dsh-settings'
  const removedExports = new Set(['installSettingsSection', 'settingsNamespace'])
  let repairedBundles = 0

  for (const packageDirectory of await installedPackageDirectories(profileDirectory)) {
    for (const path of await javascriptFiles(join(packageDirectory, 'lib'))) {
      const source = await readFile(path, 'utf8')
      if (![...removedExports].some(name => source.includes(name)) || !source.includes(settingsPackage)) continue

      let changed = false
      const migrated = source.replace(
        /import\s*\{([^}]*)\}\s*from\s*["']@deepseek-ai\/dsh-settings["'];?/g,
        (statement, specifiers) => {
          const parsed = specifiers
            .split(',')
            .map(specifier => specifier.trim())
            .filter(Boolean)
          const removed = parsed.filter(specifier =>
            removedExports.has(specifier.split(/\s+as\s+/)[0].trim()),
          )
          const kept = parsed.filter(specifier => !removed.includes(specifier))
          if (removed.length === 0) {
            return statement
          }
          changed = true
          const shims = removed.map((specifier) => {
            const [imported, local = imported] = specifier.split(/\s+as\s+/).map(value => value.trim())
            if (imported === 'settingsNamespace') return `const ${local} = value => value;`
            return `const ${local} = (ctx, ns, schema, entry, hooks) => {\n  ctx.inject(['settings'], scopedCtx => scopedCtx.settings.installSection(ctx, ns, schema, entry, hooks));\n};`
          }).join('\n')
          return kept.length > 0
            ? `import { ${kept.join(', ')} } from "${settingsPackage}";\n${shims}`
            : shims
        },
      )

      if (!changed) continue
      await writeFile(path, migrated)
      repairedBundles++
    }
  }

  if (repairedBundles > 0) {
    console.log(`Migrated removed dsh-settings helper exports in ${repairedBundles} bundle(s)`)
  }
}
