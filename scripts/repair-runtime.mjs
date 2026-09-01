#!/usr/bin/env node

/**
 * Repair recoverable inconsistencies left by older Harness web versions.
 *
 * Deleting a workspace intentionally leaves its sessions behind as
 * "Ungrouped". A blank session containing only injected startup events can
 * nevertheless exceed the UI's blank-session probe limit; it is then shown,
 * while the UI deliberately provides no row menu for blank sessions. Delete
 * only that narrow class of orphan, including its log and cache entries.
 */

import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import process from 'node:process'

const home = process.argv[2]
if (!home) {
  console.error('usage: repair-runtime.mjs <DSH_HOME>')
  process.exitCode = 2
} else {
  await deleteOrphanBlankSessions(home)
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw new Error(`cannot read ${path}: ${error.message}`, { cause: error })
  }
}

async function writeJsonAtomic(path, value) {
  const temporary = join(dirname(path), `.${basename(path)}-${process.pid}-${Date.now()}.tmp`)
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

async function deleteOrphanBlankSessions(dshHome) {
  const workspacePath = join(dshHome, 'storages', 'workspace.json')
  const projectionPath = join(dshHome, 'storages', 'session_projcache.json')
  const usagePath = join(dshHome, 'storages', 'usage-stats-cache.json')
  const [workspace, projections, usage] = await Promise.all([
    readJson(workspacePath),
    readJson(projectionPath),
    readJson(usagePath),
  ])

  if (!workspace?.global || !workspace?.tables?.workspaces || !projections?.tables?.sessions) return

  const assigned = new Set()
  for (const entry of Object.values(workspace.tables.workspaces)) {
    for (const sessionId of entry?.sessionIds ?? []) assigned.add(sessionId)
  }

  const deleted = []
  for (const [sessionId, entry] of Object.entries(projections.tables.sessions)) {
    const blank = entry?.rows?.sessionListMetadata?.val?.blank === true
    if (blank && !assigned.has(sessionId)) deleted.push(sessionId)
  }

  if (deleted.length === 0) return

  const deletedSet = new Set(deleted)
  workspace.global.archivedSessionIds = (workspace.global.archivedSessionIds ?? [])
    .filter(sessionId => !deletedSet.has(sessionId))
  for (const sessionId of deleted) delete projections.tables.sessions[sessionId]
  if (usage?.sessions) {
    for (const sessionId of deleted) delete usage.sessions[sessionId]
  }

  await Promise.all([
    writeJsonAtomic(workspacePath, workspace),
    writeJsonAtomic(projectionPath, projections),
    usage ? writeJsonAtomic(usagePath, usage) : Promise.resolve(),
  ])
  await deleteSessionDirectories(join(dshHome, 'sessions'), deletedSet)
  console.log(`Deleted ${deleted.length} orphan blank session(s): ${deleted.join(', ')}`)
}

async function deleteSessionDirectories(sessionsRoot, deletedIds) {
  let workspaceDirectories
  try {
    workspaceDirectories = await readdir(sessionsRoot, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }

  await Promise.all(workspaceDirectories
    .filter(entry => entry.isDirectory())
    .flatMap(entry => [...deletedIds].map(sessionId =>
      rm(join(sessionsRoot, entry.name, sessionId), { recursive: true, force: true }),
    )))
}
