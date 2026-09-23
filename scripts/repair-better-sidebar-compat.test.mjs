import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { repairBetterSidebarClient, repairBetterSidebarCompatibility } from './repair-better-sidebar-compat.mjs'

// Native-surface and turn-tail functions captured from Better Sidebar 0.19.1.
// Kept inline so these regressions run without installed plugins or .runtime.
const original = `const inject = [
			"slots",
			"sessions",
			"locale",
			"modules",
			"connection"
		];
const nativeEditor = {
  patterns: ["dsh-resource://file/**"],
  priority: "extension"
};
function currentSelection(ctx) {
  const sessionList = ctx.sessions.list.getSnapshot();
  const current = sessionList.current;
  return current;
}
function navigation(ctx, sessions, onOpenChild, rootId) {
  const openChild = (0, react.useCallback)((address) => {
    onOpenChild?.(address);
    sessions.openSubagent?.(address);
  }, [sessions, onOpenChild]);
  const openMain = (0, react.useCallback)(() => {
    if (rootId === void 0) return;
    sessions.open?.(rootId);
  }, [sessions, rootId]);
  return { openChild, openMain, save(newId) { ctx.sessions.open?.(newId); } };
}
		function registerTurnTailInterception(ctx, store) {
			return ctx.slots.inject("conversation.chat.turnTail", () => ctx.slots.register({
				name: "conversation.chat.turnTail",
				select: (owner) => {
					if (store.getSuspended()) return null;
					if (store.getPrefs().tabsEnabled["editor"] === false) return null;
					return selectProducedFiles(owner);
				},
				priority: -1,
				registrant: "dsh-better-sidebar",
				inject: (sessionId) => ({
					openInSidebar: (path) => {
						openSidebarFile(ctx, store, sessionId, path);
					},
					onShowInFolder: (files) => {
						revealInExplorer(ctx, store, sessionId, files);
					}
				})
			}, SidebarProducedFiles));
		}
		function activeSessionId(ctx) {
			try {
				return ctx.sessions.list.getSnapshot().current;
			} catch {
				return;
			}
		}
		function createNativeSurface(ctx, records) {
			const pending = [];
			const controller = () => ctx.get("sidebarRight");
			const place = (entry) => {
				const api = controller();
				if (api === void 0) return false;
				const active = activeSessionId(ctx);
				const onScreen = active !== void 0 && active === entry.sessionId;
				if (entry.kind === "tab") {
					const options = {
						params: entry.params,
						revealIfOpened: entry.revealIfOpened
					};
					if (onScreen) {
						api.openTab(entry.tabKind, options);
						return true;
					}
					if (api.openTabIn !== void 0) {
						api.openTabIn(entry.sessionId, entry.tabKind, options);
						return true;
					}
					return false;
				}
				const options = {
					...entry.line === void 0 ? {} : { params: { line: entry.line } },
					revealIfOpened: entry.revealIfOpened
				};
				if (onScreen) {
					api.openResource(entry.address, options);
					return true;
				}
				if (api.openResourceIn !== void 0) {
					api.openResourceIn(entry.sessionId, entry.address, options);
					return true;
				}
				return false;
			};
			const flushPending = () => {
				if (pending.length === 0) return;
				for (let index = pending.length - 1; index >= 0; index--) {
					const entry = pending[index];
					if (entry !== void 0 && place(entry)) pending.splice(index, 1);
				}
			};
			const enqueue = (entry) => {
				if (!place(entry)) pending.push(entry);
			};
			const unsubscribe = ctx.sessions.list.subscribe(flushPending);
			return {
				openTab({ sessionId, kind, params, revealIfOpened }) {
					enqueue({
						kind: "tab",
						sessionId,
						tabKind: kind,
						params,
						revealIfOpened
					});
				},
				openResource({ sessionId, address, line, revealIfOpened }) {
					enqueue({
						kind: "resource",
						sessionId,
						address,
						line,
						revealIfOpened
					});
				},
				fileAddress(sessionId, cwd, path) {
					return fileAddressFor(sessionId, cwd, path);
				},
				close(sessionId, tabId) {
					const record = records.get(tabId);
					if (record === void 0) return void 0;
					records.drop(tabId);
					const api = controller();
					if (api !== void 0) {
						if (sessionId === activeSessionId(ctx)) api.close(tabId);
						else if (api.closeIn !== void 0) api.closeIn(sessionId, tabId);
					}
					return {
						type: record.tab.type,
						title: record.tab.title
					};
				},
				update(tabId, patch) {
					if (!records.has(tabId)) return false;
					records.update(tabId, patch);
					return true;
				},
				activate(tabId) {
					return records.has(tabId);
				},
				has: (tabId) => records.has(tabId),
				flushPending,
				dispose: () => {
					unsubscribe();
				}
			};
		}`

function observable(value) {
  const listeners = new Set()
  return {
    getSnapshot: () => value,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    set(next) { value = next; for (const listener of [...listeners]) listener() },
    listeners,
  }
}

function evaluate(react = { useCallback: callback => callback }) {
  const source = repairBetterSidebarClient(original)
  return new Function('react', source + '\nreturn { inject, nativeEditor, currentSelection, navigation, registerTurnTailInterception, createNativeSurface };')(react)
}

function nativeFixture() {
  const main = observable({ key: 'selected-a' })
  const mounted = observable(undefined)
  const calls = []
  const sidebar = {
    mounted,
    openTab: (kind, options) => calls.push({ sessionId: mounted.getSnapshot(), kind, options }),
    openResource: (address, options) => calls.push({ sessionId: mounted.getSnapshot(), address, options }),
    openTabIn() { assert.fail('private background open may silently discard an unadopted session') },
    openResourceIn() { assert.fail('private background resource open may silently discard an unadopted session') },
    close: tabId => calls.push({ close: tabId, sessionId: mounted.getSnapshot() }),
    closeIn: (sessionId, tabId) => calls.push({ close: tabId, sessionId }),
  }
  const ctx = {
    sidebarRight: sidebar,
    uiSession: { adapter: { current: main } },
    sessions: { list: { getSnapshot: () => ({ byId: {} }), subscribe() { assert.fail('catalog updates are not mounted-seat readiness') } } },
    get(name) { assert.equal(name, 'sidebarRight'); return sidebar },
  }
  const recordValues = new Map()
  const records = {
    get: key => recordValues.get(key),
    has: key => recordValues.has(key),
    drop: key => recordValues.delete(key),
    update: (key, patch) => Object.assign(recordValues.get(key), patch),
  }
  const surface = evaluate().createNativeSurface(ctx, records)
  return { surface, main, mounted, calls, recordValues, records }
}

test('preserves native file routing and removes the obsolete turn-tail takeover', () => {
  const runtime = evaluate()
  assert.deepEqual(runtime.nativeEditor, { patterns: ['dsh-resource://file/**'], priority: 'extension' })
  for (const dependency of ['sessions', 'uiSession', 'uiWorkspace', 'sidebarRight']) {
    assert.ok(runtime.inject.includes(dependency), dependency)
  }
  const dispose = runtime.registerTurnTailInterception({
    slots: { inject() { assert.fail('must not add a duplicate or invalid turn-tail file row') } },
  })
  assert.equal(typeof dispose, 'function')
  dispose()
  assert.ok(!repairBetterSidebarClient(original).includes('ctx.slots.inject("conversation.chat.turnTail"'))
})

test('migration is idempotent and preserves LF/CRLF source formatting', () => {
  for (const newline of ['\n', '\r\n']) {
    const input = original.replaceAll('\n', newline)
    const repaired = repairBetterSidebarClient(input)
    assert.equal(repairBetterSidebarClient(repaired), repaired)
    if (newline === '\r\n') assert.ok(!/(?<!\r)\n/.test(repaired))
  }
  const modern = 'const inject = ["slots"];\n'
  assert.equal(repairBetterSidebarClient(modern), modern)
})

test('main selection follows its own observable even when catalog metadata is unchanged', () => {
  const main = observable({ key: 'first' })
  const catalog = { byId: { first: { id: 'first' }, second: { id: 'second' } } }
  const observed = []
  const cleanup = []
  const react = {
    useCallback: callback => callback,
    useSyncExternalStore(subscribe, snapshot) {
      cleanup.push(subscribe(() => observed.push(snapshot())))
      return snapshot()
    },
  }
  const ctx = {
    uiSession: { adapter: { current: main } },
    sessions: { list: { getSnapshot: () => catalog, subscribe() { assert.fail('selection must not depend on catalog notifications') } } },
  }
  assert.equal(evaluate(react).currentSelection(ctx), 'first')
  main.set({ key: 'second' })
  main.set({ key: undefined })
  assert.deepEqual(observed, ['second', undefined])
  assert.equal(ctx.sessions.list.getSnapshot(), catalog)
  cleanup.forEach(dispose => dispose())
  assert.equal(main.listeners.size, 0)
})

test('subagent, root, and saved side-chat navigation use the workspace navigation service', () => {
  const opened = []
  const notified = []
  const sessions = {
    open() { assert.fail('removed sessions.open must not be used') },
    openSubagent() { assert.fail('removed sessions.openSubagent must not be used') },
  }
  const ctx = { sessions, uiWorkspace: { openSession: target => opened.push(target) } }
  const actions = evaluate().navigation(ctx, sessions, target => notified.push(target), 'root')
  const address = { parentSessionId: 'root', childSessionId: 'child', mode: 'continuable' }
  actions.openChild(address)
  actions.openMain()
  actions.save('saved-child')
  assert.deepEqual(opened, [address, 'root', 'saved-child'])
  assert.equal(opened[0], address)
  assert.deepEqual(notified, [address])
})

test('native opens wait for the matching mounted session and flush in FIFO order', () => {
  const { surface, main, mounted, calls } = nativeFixture()
  surface.openTab({ sessionId: 'a', kind: 'first', params: { path: '/a' }, revealIfOpened: false })
  surface.openResource({ sessionId: 'b', address: 'dsh-resource://file/session/b/b.txt', line: 17 })
  surface.openTab({ sessionId: 'a', kind: 'second' })
  assert.deepEqual(calls, [])
  main.set({ key: 'a' })
  assert.deepEqual(calls, [], 'selection can precede mounting')
  mounted.set('b')
  assert.deepEqual(calls, [{ sessionId: 'b', address: 'dsh-resource://file/session/b/b.txt', options: { params: { line: 17 }, revealIfOpened: undefined } }])
  mounted.set('a')
  assert.deepEqual(calls.slice(1), [
    { sessionId: 'a', kind: 'first', options: { params: { path: '/a' }, revealIfOpened: false } },
    { sessionId: 'a', kind: 'second', options: { params: undefined, revealIfOpened: undefined } },
  ])
  surface.flushPending()
  assert.equal(calls.length, 3, 'a flushed request is never repeated')
  surface.dispose()
})

test('native cleanup removes subscriptions and closing a background tab never targets the mounted session', () => {
  const { surface, mounted, calls, recordValues } = nativeFixture()
  assert.equal(mounted.listeners.size, 1)
  mounted.set('visible')
  surface.openResource({ sessionId: 'visible', address: 'dsh-resource://file/session/visible/current.txt' })
  assert.equal(calls[0].sessionId, 'visible')
  recordValues.set('background-tab', { tab: { type: 'editor', title: 'Background file' } })
  assert.deepEqual(surface.close('background', 'background-tab'), { type: 'editor', title: 'Background file' })
  assert.deepEqual(calls[1], { close: 'background-tab', sessionId: 'background' })
  assert.equal(recordValues.has('background-tab'), false)
  surface.openTab({ sessionId: 'later', kind: 'queued' })
  surface.dispose()
  assert.equal(mounted.listeners.size, 0)
  mounted.set('later')
  assert.equal(calls.length, 2, 'unmounted plugin must not react to later seat changes')
})

test('changed or ambiguous legacy code is rejected before a partial migration is returned', () => {
  assert.throws(() => repairBetterSidebarClient(original + original), /Better Sidebar client changed/)
  assert.throws(() => repairBetterSidebarClient(original.replace('patterns: ["dsh-resource://file/**"]', 'patterns: []')), /native file routing was not found/)
  assert.throws(() => repairBetterSidebarClient(original.replace('const current = sessionList.current;', 'const current = sessionList.current ?? "changed";')), /cannot safely migrate/)
})

test('disk integration skips old Harness and missing plugins, then safely updates a supported install', async t => {
  const root = await mkdtemp(join(tmpdir(), 'better-sidebar-compat-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const profile = join(root, 'profile')
  const checkout = join(root, 'checkout')
  const client = join(profile, 'node_modules/dsh-better-sidebar/lib/client.js')
  const slots = join(checkout, 'packages/client/ui-chat/src/client/chat/register-node-renderers.ts')
  const session = join(checkout, 'packages/client/ui-session/src/client/index.ts')
  for (const file of [client, slots, session]) await mkdir(dirname(file), { recursive: true })
  await writeFile(client, original)
  await writeFile(slots, "'conversation.chat.turnTail': { kind: 'chain', scope: 'session' }")
  await writeFile(session, 'current: this.current')
  await repairBetterSidebarCompatibility(profile, checkout)
  assert.equal(await readFile(client, 'utf8'), original)
  await writeFile(slots, "'conversation.chat.turnTail': { kind: 'list', scope: 'session' }")
  await repairBetterSidebarCompatibility(join(root, 'missing-profile'), checkout)
  await repairBetterSidebarCompatibility(profile, checkout)
  const repaired = await readFile(client, 'utf8')
  assert.equal(repaired, repairBetterSidebarClient(original))
  await repairBetterSidebarCompatibility(profile, checkout)
  assert.equal(await readFile(client, 'utf8'), repaired)
})
