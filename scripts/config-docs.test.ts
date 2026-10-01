/// <reference types="bun" />
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { CONTROL_NAMES, readConfig, resolveControls, runtimeControls } from './update-data';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const file = () => JSON.parse(read('scripts/update-data.config.json'));

test('configuration precedence: file < advanced < nonblank input < environment', () => {
  const c = resolveControls({ CONCURRENCY: 2, TICKERS: 'COWZ' }, { CONCURRENCY: 3, TICKERS: 'FLRT' }, { CONCURRENCY: '4', TICKERS: '' }, { CONCURRENCY: '5' });
  expect(c.CONCURRENCY).toBe('5');
  expect(c.TICKERS).toBe('FLRT');
  expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }, { CONCURRENCY: '4' }).CONCURRENCY).toBe('4');
  expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }).CONCURRENCY).toBe('3');
  expect(resolveControls({ SKIP_YAHOO: true }, {}, {}, { SKIP_YAHOO: 'false' }).SKIP_YAHOO).toBe('false');
  expect(resolveControls({ AUM: '1B:' }, {}, {}, { UNRELATED: 'x', PATH: '/bin' }).AUM).toBe('1B:');
});

test('blank input inherits the file value; advanced may deliberately blank a key', () => {
  expect(resolveControls({ TICKERS: 'COWZ' }, {}, { TICKERS: '' }).TICKERS).toBe('COWZ');
  expect(resolveControls({ TICKERS: 'COWZ' }, { TICKERS: '' }, { TICKERS: '' }).TICKERS).toBe('');
  expect(resolveControls({ CONCURRENCY: 2 }, {}, { CONCURRENCY: '' }).CONCURRENCY).toBe('2');
  expect(readConfig(resolveControls({ MAX_RETRIES: 0 })).maxRetries).toBe(0);
});

test('scheduled path (empty inputs and advanced) equals the config defaults', () => {
  const defaults = file();
  const scheduled = resolveControls(defaults, JSON.parse('{}'), {}, {});
  expect(scheduled).toEqual(Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, String(v)])));
});

test('resolver rejects unknown keys, invalid values, non-scalars and newline injection', () => {
  for (const value of [{ UNKNOWN: 1 }, { SEC_UA: 'x\nEVIL=yes' }, { CONCURRENCY: 0 }, { MAX_RETRIES: -1 }, { MAX_FETCHES: 1.5 }, { REQUEST_SLEEP: '-1' }, { VERBOSE: 'maybe' }, { EDGAR_FALLBACK: 'maybe' }, { AUM: '1:2:3' }, { TER: '5:1' }, { PERFORMANCE_1Y: 'a:b' }, { TICKERS: ['COWZ'] }, { TICKERS: { a: 1 } }, null, []]) {
    expect(() => resolveControls(value)).toThrow();
  }
  expect(() => resolveControls({}, { SEC_UA: 'x\rfoo' })).toThrow();
  expect(() => resolveControls({}, {}, { TICKERS: 'A\nB' })).toThrow();
  expect(() => resolveControls({}, {}, {}, { SEC_UA: 'x\0bad' })).toThrow();
  expect(() => resolveControls({}, 'not an object')).toThrow();
  expect(() => JSON.parse('{bad')).toThrow();
});

test('Pacer-specific default values', () => {
  const config = readConfig(resolveControls(file()));
  expect(config.maxFetches).toBe(0);
  expect(config.requestSleep).toBe(2.5);
  expect(config.concurrency).toBe(1);
  expect(config.holdingsPageSize).toBe(250);
  expect(config.historyPageSize).toBe(1000);
  expect(config.maxRetries).toBe(2);
  expect(config.historyRange).toBe('max');
  expect(config.edgarFallback).toBe(true);
  expect(config.skipPacer).toBe(false);
  expect(config.skipYahoo).toBe(false);
  expect(config.storeRawDownloads).toBe(false);
  expect(config.tickers).toBeNull();
  expect(config.aum).toBeUndefined();
  expect(config.ter).toBeUndefined();
  expect(config.dividendYield).toBeUndefined();
  expect(config.performance).toEqual({});
  expect(config.totalReturn).toEqual({});
  expect(file().SEC_UA).toBe('');
  expect(config.secUa).toContain('Pacer');
  expect(readConfig(resolveControls(file(), { SEC_UA: 'My Feed me@example.org' })).secUa).toBe('My Feed me@example.org');
});

test('runtimeControls reads the config file and lets env override it', async () => {
  expect((await runtimeControls({})).REQUEST_SLEEP).toBe('2.5');
  expect((await runtimeControls({ REQUEST_SLEEP: '0', TICKERS: 'COWZ FLRT' })).TICKERS).toBe('COWZ FLRT');
});

test('config keys, CONTROL_NAMES, README and --help stay in sync', () => {
  expect(Object.keys(file()).sort()).toEqual([...CONTROL_NAMES].sort());
  for (const value of Object.values(file())) expect(typeof value).toBe('string');
  const doc = read('README.md');
  const section = doc.slice(doc.indexOf('### Update controls'), doc.indexOf('### Examples'));
  const documented = new Set<string>();
  for (const [, cell] of section.matchAll(/^\| ((?:`[A-Z0-9_]+`(?:, )?)+) \|/gm)) {
    const tokens = [...cell.matchAll(/`([A-Z0-9_]+)`/g)].map((m) => m[1]);
    const prefix = tokens[0].replace(/_YTD$/, '');
    for (const token of tokens) documented.add(token.startsWith('_') ? `${prefix}${token}` : token);
  }
  expect([...documented].sort()).toEqual([...CONTROL_NAMES].sort());
  expect(doc).toContain('scripts/update-data.config.json');
  const help = spawnSync('bun', [new URL('./update-data.ts', import.meta.url).pathname, '--help'], { encoding: 'utf8' }).stdout;
  for (const name of CONTROL_NAMES) {
    const tenor = name.match(/^(PERFORMANCE|TOTAL_RETURN)_/);
    expect(help).toContain(tenor ? `${tenor[1]}_YTD|1Y|3Y|5Y|10Y` : name);
  }
});

test('workflow: inputs, schedule, fixed output dir and no direct interpolation', () => {
  const yml = read('.github/workflows/update-data.yml');
  const block = yml.slice(yml.indexOf('    inputs:'), yml.indexOf('\npermissions:'));
  const names = [...block.matchAll(/^      (\w+):$/gm)].map((m) => m[1]);
  expect(names.length).toBeLessThanOrEqual(25);
  expect(names).toContain('advanced');
  expect(block).toMatch(/advanced:[\s\S]*default: '\{\}'/);
  for (const name of names.filter((n) => n !== 'advanced')) expect(CONTROL_NAMES).toContain(name.toUpperCase() as any);
  expect(names).not.toContain('sec_ua');
  expect(names).not.toContain('output_dir');
  expect(yml).toContain("cron: '0 0 * * 0'");
  expect(yml).not.toMatch(/^  push:/m);
  expect(yml).toContain('toJSON(inputs)');
  expect(yml).not.toMatch(/\$\{\{\s*inputs\./);
  expect(yml).toContain('resolveControls');
  expect(yml).toContain('vars.SEC_UA');
  expect(yml).toContain('git add api/pacer\n');
  expect(yml.match(/git add /g)?.length).toBe(1);
  expect(yml).not.toContain('OUTPUT_DIR');
});

test('README keeps the standard structure, deployment-pending note and the 27-brand shared tables', () => {
  const doc = read('README.md');
  const headings: string[] = [];
  let inFence = false;
  for (const line of doc.split('\n')) {
    if (line.startsWith('```')) { inFence = !inFence; continue; }
    if (!inFence && /^#{1,6} /.test(line)) headings.push(line.trimEnd());
  }
  expect(headings).toEqual([
    '# Pacer', '## Using Bun', '## Updating the static Pacer data', '### Data sources', '### Metrics and caveats',
    '### Update controls', '### Examples', '## TypeScript and verification', '## Brands table', '## Sibling applications', '## License',
  ]);
  expect(doc).toMatch(/deployment is pending/);
  expect(doc).toContain('https://daggerok.github.io/Pacer/');
  const rows = (heading: string): string[] => {
    const start = doc.indexOf(`\n${heading}\n`);
    expect(start).toBeGreaterThan(-1);
    const rest = doc.slice(start + heading.length + 2);
    const end = rest.search(/\n## /);
    return (end === -1 ? rest : rest.slice(0, end)).split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| ---')).slice(1);
  };
  const brands = rows('## Brands table').map((row) => row.split('|')[1].trim().replace(/\*\*/g, ''));
  const siblings = rows('## Sibling applications').map((row) => row.split('|')[1].trim());
  const sorted = (values: string[]) => [...values].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  expect(brands).toHaveLength(27);
  expect(siblings).toEqual(brands);
  expect(brands).toEqual(sorted(brands));
  expect(brands).toContain('Pacer ETFs');
  expect(doc).toContain('Pacer Funds Trust');
  expect(doc).toContain('CIK 0001616668');
  for (const example of doc.match(/^[A-Z_]+="?[^\s"]*"? \.\/scripts\/update-data\.ts$/gm) ?? []) {
    expect(CONTROL_NAMES).toContain(example.split('=')[0] as any);
  }
});

test('updater is fixed to api/pacer and keeps the reference types line first', () => {
  const source = read('scripts/update-data.ts');
  expect(source).toContain("new URL('../api/pacer/', import.meta.url)");
  expect(source.split('\n').slice(0, 4).join('\n')).toContain('/// <reference types="bun" />');
  expect(source).not.toMatch(/OUTPUT_DIR/);
});
