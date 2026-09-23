/** Adapt Turn Rewind 0.3.8 to schema-derived live settings in current Harness. */

const marker = '// Harness compatibility: Turn Rewind live Config fields.'
const legacyImport = "import { installTurnRewindSettings } from './settings.js';"
const legacyCall = 'installTurnRewindSettings(ctx, config, this.engine);'
const classDeclaration = 'export class ChangeLedgerService {'
const engineConstruction = 'this.engine = new ChangeLedgerEngine(config);'
const oldFields = '    ...Object.fromEntries(Object.entries(TurnRewindSettingsSchema.dict).map(([key, schema]) => [key, schema.volatile()])),'
const liveFields = '    ...Object.fromEntries(Object.entries(TurnRewindSettingsSchema.dict).map(([key, schema]) => [key, new z(schema.toJSON()).volatile()])),'

function requireOne(source, anchor, description) {
  if (source.split(anchor).length !== 2) {
    throw new Error(`Turn Rewind host changed; cannot repair ${description}`)
  }
}

/** Return a repaired bundle, preserving future hosts that no longer use the removed API. */
export function repairTurnRewindHost(source, schemaSpecifier = '@deepseek-ai/schemastery') {
  const schemaImport = `import z from ${JSON.stringify(schemaSpecifier)};`
  if (source.includes(marker)) {
    if (source.includes('installTurnRewindSettings(')) {
      throw new Error('Turn Rewind host contains an incomplete live Config compatibility repair')
    }
    const imports = source.match(/^import z from [^\r\n]+;$/gm) ?? []
    if (imports.length !== 1 || source.split(oldFields).length + source.split(liveFields).length !== 3) {
      throw new Error('Turn Rewind host live Config compatibility code changed')
    }
    return source.replace(imports[0], schemaImport).replace(oldFields, liveFields)
  }
  if (!/\binstallTurnRewindSettings\s*\(/.test(source)) return source

  requireOne(source, legacyImport, 'the legacy settings import')
  requireOne(source, legacyCall, 'the legacy settings installation')
  requireOne(source, classDeclaration, 'the ChangeLedgerService class')
  requireOne(source, engineConstruction, 'the engine configuration')
  if (/\bstatic\s+Config\b|\bturnRewindPlainConfig\b|\bTurnRewindLiveConfig\b/.test(source)) {
    throw new Error('Turn Rewind host already defines conflicting Config compatibility code')
  }

  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  const settings = [
    schemaImport,
    "import { TurnRewindSettingsSchema } from './settings.js';",
    marker,
    'const TurnRewindLiveConfig = z.object({',
    liveFields,
    '    storageDir: z.string(),',
    '});',
    '// The engine receives plain values; Cordis retains the live references.',
    'function turnRewindPlainConfig(config) {',
    '    return Object.fromEntries(Object.entries(config).map(([key, value]) => [',
    "        key, key !== 'storageDir' && value !== null && typeof value === 'object' && typeof value.get === 'function' ? value.get() : value,",
    '    ]));',
    '}',
  ].join(newline)
  return source
    .replace(legacyImport, settings)
    .replace(classDeclaration, `${classDeclaration}${newline}    static Config = TurnRewindLiveConfig;`)
    .replace(engineConstruction, 'this.engine = new ChangeLedgerEngine(turnRewindPlainConfig(config));')
    .replace(legacyCall, [
      "ctx.on('loader/volatile-update', () => {",
      '            this.engine.updateConfig(turnRewindPlainConfig(config));',
      '        });',
    ].join(newline))
}
