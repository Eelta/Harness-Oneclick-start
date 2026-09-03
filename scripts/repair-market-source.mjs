/** Resolve the reviewed source and test conflicts shipped in upstream f1779d5. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const checkout = process.argv[2]
if (!checkout) throw new Error('usage: repair-market-source.mjs <market-checkout>')

// Match complete, known hunks. Never choose a side for an unknown conflict.
// Fixed upstream files contain no markers and pass through unchanged.
const repairs = new Map([
  ['src/hot.ts', [
    [
      '  /**\n   * Catalog entry URLs the user bookmarked for later install (#414).\n   * Keys are registry `url` strings, not package names — favorites are a\n   * pre-install list, unlike groups/notes which target installed packages.\n   */\n  favorites?: string[]\n',
      '  /** User-supplied HTTPS prefix used when the built-in GitHub routes fail. */\n  githubProxy?: string\n',
    ],
    [
      '      favorites: favoriteUrls(state.favorites),\n',
      '      ...(githubProxy === null ? {} : { githubProxy }),\n',
    ],
    [
      '  const favorites = state.favorites ?? onDisk.favorites ?? []\n',
      '  // This field does have a clear action ("restore automatic"). As with\n  // regionAuto, omission preserves while an explicit undefined removes it.\n  const githubProxy = Object.prototype.hasOwnProperty.call(state, \'githubProxy\')\n    ? state.githubProxy\n    : onDisk.githubProxy\n',
    ],
  ]],
  ['src/routes.ts', [[
    '    marketState.favorites = fresh.favorites\n',
    '    marketState.githubProxy = fresh.githubProxy\n    setCustomGithubProxy(fresh.githubProxy ?? null)\n',
  ]]],
])

repairs.set("src/client/MarketSection.tsx", [
  [
    "  api, avatarColor, entryForDep, githubProxyInUse, githubUrl, groupSwitchState, humanOutput, installedForCatalog, isInstalled, looksTerminal, matchInstalledName, orderedCategories, pluginCategories,\n  formatCount, pageItems, pluginName, pluginScreenshotCandidates, pluginScreenshots, pluginsForFavorites, rankThemeScreenshots, readSession, safeScreenshots, setGithubProxy, staleFavoriteUrls, themePlugins as themePluginsOf, themeSwatch, TIME_RANGE_DAYS, visiblePlugins,\n",
    "  api, applyGithubRouting, avatarColor, entryForDep, githubRouteCandidates, groupSwitchState, humanOutput, installedForCatalog, isInstalled, looksTerminal, matchInstalledName, orderedCategories, pluginCategories,\n  formatCount, pageItems, pluginName, pluginScreenshotCandidates, pluginScreenshots, rankThemeScreenshots, readSession, rememberGithubRoute, safeScreenshots, themePlugins as themePluginsOf, themeSwatch, TIME_RANGE_DAYS, visiblePlugins,\n",
    "  api, applyGithubRouting, avatarColor, entryForDep, githubRouteCandidates, groupSwitchState, humanOutput, installedForCatalog, isInstalled, looksTerminal, matchInstalledName, orderedCategories, pluginCategories,\n  formatCount, pageItems, pluginName, pluginScreenshotCandidates, pluginScreenshots, pluginsForFavorites, rankThemeScreenshots, readSession, rememberGithubRoute, safeScreenshots, staleFavoriteUrls, themePlugins as themePluginsOf, themeSwatch, TIME_RANGE_DAYS, visiblePlugins,\n"
  ],
  [
    "  }, [tab, q, cat, sortField, sortDir, timeRange, qThemes, themeSortField, themeSortDir, themeTimeRange, qFavorites, favSortField, favSortDir, favTimeRange, qInstalled, installedView])\n",
    "  }, [tab, q, cat, sortField, sortDir, timeRange, compatibleWithHost, qThemes, themeSortField, themeSortDir, themeTimeRange, qInstalled, installedView])\n",
    "  }, [tab, q, cat, sortField, sortDir, timeRange, compatibleWithHost, qThemes, themeSortField, themeSortDir, themeTimeRange, qFavorites, favSortField, favSortDir, favTimeRange, qInstalled, installedView])\n"
  ]
])
repairs.set("tests/flows.spec.ts", [
  [
    "    notes: hot.notes, favorites: hot.favorites,\n",
    "    githubProxy: hot.githubProxy,\n    notes: hot.notes,\n",
    "    notes: hot.notes, favorites: hot.favorites,\n    githubProxy: hot.githubProxy,\n"
  ],
  [
    "    notes?: Record<string, string>; favorites?: string[]\n",
    "    githubProxy?: string\n    notes?: Record<string, string>\n",
    "    notes?: Record<string, string>; favorites?: string[]\n    githubProxy?: string\n"
  ]
])
repairs.set("tests/client/market-section.client.spec.tsx", [
  [
    "      route === '/dsh-market/registry' ? { source: 'live', registry: REGISTRY }\n      : route === '/dsh-market/installed' ? { profile: 'web', installed: {}, live: [], disabled: [], groups: {}, groupOrder: [], favorites: [] }\n",
    "      route === '/dsh-market/registry' ? { source: 'live', registry: REGISTRY, hostVersion: '0.1.2-alpha.2' }\n      : route === '/dsh-market/discovery-compatibility' ? {\n          hostVersion: '0.1.2-alpha.2',\n          plugins: Object.fromEntries(((body as { packages?: string[] } | undefined)?.packages ?? []).map(name => [name, {\n            status: 'unknown', basis: 'undeclared', requirement: null, declarations: [],\n          }])),\n        }\n      : route === '/dsh-market/installed' ? { profile: 'web', installed: {}, live: [], disabled: [], groups: {}, groupOrder: [] }\n",
    "      route === '/dsh-market/registry' ? { source: 'live', registry: REGISTRY, hostVersion: '0.1.2-alpha.2' }\n      : route === '/dsh-market/discovery-compatibility' ? {\n          hostVersion: '0.1.2-alpha.2',\n          plugins: Object.fromEntries(((body as { packages?: string[] } | undefined)?.packages ?? []).map(name => [name, {\n            status: 'unknown', basis: 'undeclared', requirement: null, declarations: [],\n          }])),\n        }\n      : route === '/dsh-market/installed' ? { profile: 'web', installed: {}, live: [], disabled: [], groups: {}, groupOrder: [], favorites: [] }\n"
  ]
])

const changes = []
for (const [relative, hunks] of repairs) {
  const path = join(checkout, relative)
  const original = await readFile(path, 'utf8')
  let source = original
  for (const [left, right, merged = left + right] of hunks) {
    const conflict = `<<<<<<< HEAD\n${left}=======\n${right}>>>>>>> origin/main\n`
    source = source.replaceAll(conflict, merged)
  }
  if (/^(?:<{7}|={7}|>{7})(?:\s|$)/m.test(source)) {
    throw new Error(`Unrecognized upstream merge conflict in ${relative}; source was not changed`)
  }
  if (source !== original) changes.push([path, source])
}
for (const [path, source] of changes) await writeFile(path, source)
if (changes.length) console.log('Repaired dsh-market source conflicts; preserved favorites and GitHub proxy settings')
