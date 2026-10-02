/// <reference types="bun" />
// Offline tests for the Pacer ETFs updater. No network calls: parsers run
// against small inline samples shaped like the public sources.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import {
  CONTROL_NAMES,
  annualizedToTotal,
  catalogAsOfDate,
  frequencyCodeLabel,
  historyPeriodStart,
  holdingsDownloadUrl,
  inferDistributionFrequency,
  isHoldingsCsv,
  mergeOfficialReturns,
  numberOrNull,
  parseAumRange,
  parseCatalogText,
  parseChart,
  parseCsv,
  parseFundTickerMap,
  parseHoldingsCsv,
  parseNport,
  parseProductPage,
  parseRange,
  parseRanges,
  priceReturns,
  readConfig,
  resolveControls,
  returnSlotForHeader,
  runtimeControls,
  samePublishedContent,
  toIsoDate,
} from './update-data';

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// Inline samples
// ---------------------------------------------------------------------------

const link = (name: string, ticker: string): string =>
  `| [${name}](https://www.paceretfs.com/products/${ticker}) | [${ticker}](https://www.paceretfs.com/products/${ticker}) |`;

const CATALOG = [
  '### Risk Mitigation',
  '',
  '| click on column headers to sort |  | Total Return as of 09/30/2026 | Total Return as of 08/31/2026 |',
  '| Name | Ticker | Total Expenses | Fund Inception | YTD | 1 Month | 3 Month | 1 Year | 3 Year | 5 Year | 10 Year | Since Inception |',
  `${link('Pacer Trendpilot US Large Cap ETF', 'PTLC')} 0.60% | 6/11/15 | 7.08 | -0.41 | 2.16 | 14.17 | 13.63 | 9.63 | 11.05 | 9.09 |`,
  `${link('Pacer Trendpilot 100 ETF', 'PTNQ')} 0.65% | 6/11/15 | 13.37 | 3.23 | 0.42 | 18.43 | 12.66 | 9.51 | 15.15 | 12.36 |`,
  `${link('Pacer Trendpilot US Bond ETF', 'PTBD')} 0.60% | 10/22/19 | -0.96 | -2.58 | -2.05 | 1.56 | 4.68 | -1.53 | n/a | 0.97 |`,
  `${link('Pacer Trendpilot Fund of Funds ETF', 'TRND')} 0.77%1 | 5/3/19 | 9.04 | -1.48 | -1.37 | 16.02 | 10.92 | 5.70 | n/a | 6.97 |`,
  '',
  '### High Quality Value',
  '',
  '| click on column headers to sort |  | Total Return as of 09/30/2026 | Total Return as of 08/31/2026 |',
  '| Name | Ticker | Total Expenses | Fund Inception | YTD | 1 Month | 3 Month | 1 Year | 3 Year | 5 Year | 10 Year | Since Inception |',
  `${link('Pacer US Cash Cows 100 ETF', 'COWZ')} 0.49% | 12/16/16 | 12.15 | -6.84 | 7.98 | 26.63 | 14.48 | 12.02 | n/a | 13.79 |`,
  `${link('Pacer Cash Cows Fund of Funds ETF', 'HERD')} 0.74%1 | 5/3/19 | 13.65 | -5.79 | 4.84 | 27.71 | 16.94 | 11.21 | n/a | 13.15 |`,
  `${link('Pacer S&P 500 Quality FCF High Dividend ETF', 'QFHD')} 0.49% | 1/12/26 | - | -5.07 | 0.19 | n/a | n/a | n/a | n/a | 13.62 |`,
].join('\n');

const PRODUCT_PAGE = [
  '### COWZ',
  '### Pacer US Cash Cows 100 ETF',
  '## Performance (%)',
  'as of 06/30/2026',
  '|  | Since Fund Inception (12/16/16) | YTD | 1 Year | 3 Year | 5 Year |',
  '| Pacer US Cash Cows 100 ETF NAV | 12.30 | 3.87 | 15.13 | 11.24 | 9.87 |',
  '| Pacer US Cash Cows 100 ETF Market Price | 12.26 | 3.88 | 15.21 | 11.24 | 9.87 |',
  '| Pacer US Cash Cows 100 Index | 12.81 | 4.14 | 15.74 | 11.89 | 10.48 |',
  '| Russell 1000 Value Index | 10.88 | 16.26 | 27.12 | 17.79 | 11.17 |',
  '',
  '### Top 10 Holdings (%)',
  'as of 10/01/2026',
  '| Ticker | Holding | Weight |',
  '| QCOM | QUALCOMM Inc | 2.32 |',
  '| VLO | Valero Energy Corp | 2.22 |',
  '| MPC | Marathon Petroleum Corp | 2.16 |',
  '|  | Total | 6.70 |',
  '',
  '### Distributions',
  '| Ex Date | Record Date | Pay Date | Total Distributions | Ordinary Income\\* | Short Term Capital Gains | Long Term Capital Gains | Return of Capital |',
  '| 9/3/2026 | 9/3/2026 | 9/8/2026 | $0.431373 | $0.431373 | $0 | $0 | $0 |',
  '| 6/4/2026 | 6/4/2026 | 6/8/2026 | $0.111843 | $0.111843 | $0 | $0 | $0 |',
  '| 3/5/2026 | 3/5/2026 | 3/9/2026 | $0.20026985 | $0.20026985 | $0 | $0 | $0 |',
  '',
  'Pacer ETFs - Documents',
].join('\n');

const HOLDINGS_CSV = [
  'Date,Account,StockTicker,CUSIP,SecurityName,Shares,Price,MarketValue,Weightings,NetAssets,SharesOutstanding,CreationUnits,MoneyMarketFlag',
  '10/01/2026,COWZ,ABNB,009066101,Airbnb Inc,1225079.00000000,160.650000,196808941.35,1.06%,18581478740.00,278300000,5566.000000000000,',
  '10/01/2026,COWZ,ACN,G1151C101,Accenture PLC,2116398.00000000,183.370000,388083901.26,2.09%,18581478740.00,278300000,5566.000000000000,',
  '10/01/2026,COWZ,,-,CASH & OTHER,12345.00000000,1.000000,12345.00,0.00%,18581478740.00,278300000,5566.000000000000,Y',
  '10/01/2026,COWZ,PFFD,70459X107,Cash Offset,-1.00000000,1.000000,-1.00,0.00%,18581478740.00,278300000,5566.000000000000,',
  'Past performance is no guarantee of future results.',
].join('\n');

const CHART = {
  chart: { result: [{
    meta: { currency: 'USD', symbol: 'COWZ', exchangeName: 'BTS', firstTradeDate: 1482417000, regularMarketTime: 1790884800, regularMarketPrice: 67.63 },
    timestamp: [1790343000, 1790602200, 1790688600, 1790775000, 1790861400],
    indicators: {
      quote: [{ close: [67.7300033569336, 67.11000061035156, 66.91000366210938, 66.76000213623047, 67.62999725341797], volume: [1316100, 893300, 879600, 724500, 1400943] }],
      adjclose: [{ adjclose: [67.7300033569336, 67.11000061035156, 66.91000366210938, 66.76000213623047, 67.62999725341797] }],
    },
    events: { dividends: { '1790343000': { amount: 0.431373, date: 1790343000 } } },
  }], error: null },
} as Record<string, any>;

// ---------------------------------------------------------------------------
// Controls: config file, resolver, workflow, README and --help parity
// ---------------------------------------------------------------------------

describe('control resolver', () => {
  const file = JSON.parse(read('scripts/update-data.config.json')) as Record<string, unknown>;

  test('layers apply as file < advanced < nonblank inputs < env', () => {
    const resolved = resolveControls({ MAX_FETCHES: '1', REQUEST_SLEEP: '1' }, { MAX_FETCHES: '2', REQUEST_SLEEP: '2' }, { MAX_FETCHES: '3', REQUEST_SLEEP: '' }, { MAX_FETCHES: '4' });
    expect(resolved.MAX_FETCHES).toBe('4');
    expect(resolved.REQUEST_SLEEP).toBe('2');
    expect(resolveControls({ MAX_FETCHES: '1' }, { MAX_FETCHES: '2' }, { MAX_FETCHES: '3' }, {}).MAX_FETCHES).toBe('3');
    expect(resolveControls({ MAX_FETCHES: '1' }, { MAX_FETCHES: '2' }, {}, {}).MAX_FETCHES).toBe('2');
  });

  test('blank input inherits the file value; advanced may clear a key deliberately; explicit empty env clears too', () => {
    expect(resolveControls({ TICKERS: 'COWZ' }, {}, { TICKERS: '' }, {}).TICKERS).toBe('COWZ');
    expect(resolveControls({ TICKERS: 'COWZ' }, { TICKERS: '' }, {}, {}).TICKERS).toBe('');
    expect(resolveControls({ TICKERS: 'COWZ' }, {}, {}, { TICKERS: '' }).TICKERS).toBe('');
  });

  test('scheduled path (empty advanced and inputs) equals the config defaults', () => {
    expect(resolveControls(file, {}, {}, {})).toEqual(file as Record<string, string>);
  });

  test('values are stringified; non-scalars, unknown keys and multiline values are rejected', () => {
    expect(resolveControls({ MAX_FETCHES: 5, VERBOSE: true }, {}, {}, {})).toMatchObject({ MAX_FETCHES: '5', VERBOSE: 'true' });
    expect(() => resolveControls({ NOPE: '1' })).toThrow(/Unknown updater control: NOPE/);
    expect(() => resolveControls({}, { TICKERS: ['COWZ'] })).toThrow(/expected string, number or boolean/);
    expect(() => resolveControls({}, { TICKERS: null })).toThrow(/expected string, number or boolean/);
    expect(() => resolveControls({}, { TICKERS: 'COWZ\nCALF' })).toThrow(/multiline/);
    expect(() => resolveControls({}, {}, { TICKERS: 'A\rB' })).toThrow(/multiline/);
    expect(() => resolveControls({}, {}, {}, { TICKERS: 'A\0B' })).toThrow(/multiline/);
    expect(() => resolveControls([] as unknown)).toThrow(/JSON object/);
    expect(() => resolveControls({}, 'x')).toThrow(/JSON object/);
  });

  test('every control is validated strictly, never silently falling back', () => {
    for (const [name, value, message] of [
      ['MAX_FETCHES', '-1', /integer >= 0/],
      ['MAX_FETCHES', '1.5', /integer >= 0/],
      ['CONCURRENCY', '0', /integer >= 1/],
      ['HOLDINGS_PAGE_SIZE', '0', /integer >= 1/],
      ['HISTORY_PAGE_SIZE', 'abc', /integer >= 1/],
      ['MAX_RETRIES', '0', /integer >= 1/],
      ['REQUEST_SLEEP', '-1', /nonnegative/],
      ['REQUEST_SLEEP', 'fast', /nonnegative/],
      ['HISTORY_RANGE', '5', /max or Ny/],
      ['HISTORY_RANGE', '0y', /max or Ny/],
      ['EDGAR_FALLBACK', 'maybe', /boolean/],
      ['SKIP_YAHOO', '2', /boolean/],
      ['SKIP_PACER', 'x', /boolean/],
      ['STORE_RAW_DOWNLOADS', 'x', /boolean/],
      ['VERBOSE', 'loud', /boolean/],
      ['AUM', '10', /colon/],
      ['AUM', 'huge:', /invalid bound/],
      ['TER', '1:0', /minimum must not exceed maximum/],
      ['DIVIDEND_YIELD', 'a:b', /numbers/],
      ['PERFORMANCE_3Y', '5', /colon/],
      ['TOTAL_RETURN_1Y', '9:1', /minimum/],
    ] as const) {
      expect(() => resolveControls({}, {}, {}, { [name]: value }), `${name}=${value}`).toThrow(message);
    }
  });

  test('config defaults resolve to the documented Pacer values', () => {
    const config = readConfig(resolveControls(file, {}, {}, {}));
    expect(config).toMatchObject({
      maxFetches: 0, requestSleep: 2.5, concurrency: 1, holdingsPageSize: 250, historyPageSize: 1000, maxRetries: 2,
      historyRange: 'max', edgarFallback: true, skipPacer: false, skipYahoo: false, storeRawDownloads: false, tickers: null,
      secUa: 'daggerok ETF feed daggerok@gmail.com',
    });
    expect(config.aum).toBeUndefined();
    expect(config.performance).toEqual({});
  });

  test('filters and scalar controls are parsed from the resolved values', () => {
    const config = readConfig(resolveControls(file, {}, {}, { TICKERS: 'cowz, calf;ptlc', AUM: 'large:', TER: ':0.5', MAX_RETRIES: '1', HISTORY_RANGE: '5Y', SEC_UA: ' me me@example.org ' }));
    expect([...(config.tickers ?? [])]).toEqual(['COWZ', 'CALF', 'PTLC']);
    expect(config.aum).toEqual({ min: 10_000_000_000, max: undefined });
    expect(config.ter).toEqual({ min: undefined, max: 0.5 });
    expect(config.maxRetries).toBe(1);
    expect(config.historyRange).toBe('5y');
    expect(config.secUa).toBe('me me@example.org');
  });

  test('HISTORY_RANGE limits the Yahoo request window', () => {
    const now = Date.UTC(2026, 9, 1);
    expect(historyPeriodStart('max', now)).toBe(0);
    const fiveYears = historyPeriodStart('5y', now);
    expect(fiveYears).toBeGreaterThan(0);
    expect(Math.round((now / 1000 - fiveYears) / (365.25 * 86_400))).toBe(5);
    expect(historyPeriodStart('1y', now)).toBeGreaterThan(fiveYears);
  });

  test('runtimeControls reads the checked-in file and lets env win', async () => {
    expect(await runtimeControls({})).toEqual(file as Record<string, string>);
    expect((await runtimeControls({ TICKERS: 'COWZ', UNRELATED: 'x' })).TICKERS).toBe('COWZ');
  });
});

describe('config, CONTROL_NAMES, --help and README stay in sync', () => {
  const file = JSON.parse(read('scripts/update-data.config.json')) as Record<string, unknown>;
  const names = [...CONTROL_NAMES];

  test('config keys equal CONTROL_NAMES and every value is a string', () => {
    expect(Object.keys(file).sort()).toEqual([...names].sort());
    for (const [key, value] of Object.entries(file)) expect(typeof value, key).toBe('string');
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[A-Z0-9_]+$/);
  });

  test('the only contact in the config is the owner SEC User-Agent', () => {
    expect(file.SEC_UA).toBe('daggerok ETF feed daggerok@gmail.com');
    expect(JSON.stringify(file).match(/@/g)?.length).toBe(1);
  });

  test('--help documents every control and rejects stray arguments', () => {
    const run = (args: string[]) => Bun.spawnSync(['bun', new URL('./update-data.ts', import.meta.url).pathname, ...args], { env: { PATH: process.env.PATH ?? '' } });
    const help = run(['--help']);
    expect(help.exitCode).toBe(0);
    const text = new TextDecoder().decode(help.stdout);
    for (const name of names) {
      const tenor = /^(PERFORMANCE|TOTAL_RETURN)_(YTD|1Y|3Y|5Y|10Y)$/.exec(name);
      expect(text, name).toContain(tenor ? `${tenor[1]}_YTD|1Y|3Y|5Y|10Y` : `${name}=`);
    }
    expect(run(['--bogus']).exitCode).toBe(1);
  });

  test('README controls table lists exactly the CONTROL_NAMES', () => {
    const readme = read('README.md');
    const section = readme.slice(readme.indexOf('### Update controls'), readme.indexOf('### Examples'));
    const documented = [...section.matchAll(/`([A-Z][A-Z0-9_]+)`/g)].map((match) => match[1]);
    expect([...new Set(documented)].sort()).toEqual([...names].sort());
  });

  test('README has the standard sections and no leftover process artifacts', () => {
    const readme = read('README.md');
    const headings = [...readme.matchAll(/^(#{1,3}) (.+)$/gm)].map((match) => match[2]);
    const order = ['Using Bun', 'Updating the static Pacer data', 'Data sources', 'Metrics and caveats', 'Update controls', 'Examples', 'TypeScript and verification', 'Brands table', 'Sibling applications', 'License'];
    expect(headings.filter((heading) => order.includes(heading))).toEqual(order);
    expect(headings[0]).toBe('Pacer');
    expect(readme).not.toMatch(/worklog|fixture|evidence|config-docs/i);
    expect(readme.slice(0, readme.indexOf('## Brands table'))).not.toMatch(/[\u2014\u2013\u2192]/);
  });
});

describe('update-data workflow', () => {
  const text = read('.github/workflows/update-data.yml');
  const workflow = (Bun as unknown as { YAML: { parse(source: string): any } }).YAML.parse(text);
  const inputs = workflow.on.workflow_dispatch.inputs as Record<string, { default: string; type: string }>;
  const individual = Object.keys(inputs).filter((key) => key !== 'advanced');

  test('at most 25 inputs, with a string advanced input defaulting to {}', () => {
    expect(Object.keys(inputs).length).toBeLessThanOrEqual(25);
    expect(inputs.advanced).toMatchObject({ default: '{}', type: 'string' });
    for (const key of individual) expect(inputs[key].default, key).toBe('');
  });

  test('every individual input maps to a control name', () => {
    for (const key of individual) expect(CONTROL_NAMES as readonly string[], key).toContain(key.toUpperCase());
  });

  test('weekly schedule plus manual dispatch only, never push', () => {
    expect(workflow.on.schedule).toEqual([{ cron: '0 0 * * 0' }]);
    expect(workflow.on.push).toBeUndefined();
  });

  test('uses the shared resolver with the protected SEC_UA variable and no direct input interpolation', () => {
    expect(text).toContain('import { resolveControls } from "./scripts/update-data.ts"');
    expect(text).toContain('toJSON(inputs)');
    expect(text).toContain('PROTECTED_SEC_UA: ${{ vars.SEC_UA }}');
    expect(text).not.toMatch(/\$\{\{\s*(inputs|github\.event\.inputs)\./);
    expect(text).not.toMatch(/OUTPUT_DIR|OUT_DIR/);
  });

  test('hardened job: timeout, no persisted credentials, tests before the update, runtime-only token push', () => {
    expect(workflow.jobs['update-data']['timeout-minutes']).toBe(30);
    expect(text).toContain('persist-credentials: false');
    expect(text.indexOf('bun test')).toBeLessThan(text.indexOf('bun ./scripts/update-data.ts'));
    expect(text).toContain("credential.helper='!f()");
    expect(text).not.toContain('tsc');
  });

  test('writes only under api/pacer', () => {
    expect(text.match(/git add (.+)/)?.[1]).toBe('api/pacer');
    expect(text).toContain('git diff --cached --quiet -- api/pacer');
  });
});

// ---------------------------------------------------------------------------
// Catalog: the product listing
// ---------------------------------------------------------------------------

describe('parseCatalogText (product listing)', () => {
  const funds = parseCatalogText(CATALOG);
  const byTicker = new Map(funds.map((fund) => [fund.ticker, fund]));

  test('parses every fund row and keeps the ticker order', () => {
    expect(funds.map((fund) => fund.ticker)).toEqual(['COWZ', 'HERD', 'PTBD', 'PTLC', 'PTNQ', 'QFHD', 'TRND']);
  });

  test('reads the fund name and the canonical (uppercase) product page', () => {
    expect(byTicker.get('COWZ')?.name).toBe('Pacer US Cash Cows 100 ETF');
    expect(byTicker.get('COWZ')?.fundPage).toBe('https://www.paceretfs.com/products/COWZ');
    expect(byTicker.get('PTLC')?.fundPage).toBe('https://www.paceretfs.com/products/PTLC');
  });

  test('groups funds by the investment theme heading above the table', () => {
    expect(byTicker.get('PTLC')?.category).toBe('Risk Mitigation');
    expect(byTicker.get('COWZ')?.category).toBe('High Quality Value');
    expect(byTicker.get('COWZ')?.categoryPath).toBe('High Quality Value');
  });

  test('reads total expenses, ignoring the footnote markers', () => {
    expect(byTicker.get('COWZ')?.ter).toBe(0.49);
    expect(byTicker.get('TRND')?.ter).toBe(0.77); // published as "0.77%1"
    expect(byTicker.get('HERD')?.ter).toBe(0.74);
  });

  test('reads the inception date (US m/d/yy -> ISO)', () => {
    expect(byTicker.get('COWZ')?.inception).toBe('2016-12-16');
    expect(byTicker.get('PTBD')?.inception).toBe('2019-10-22');
  });

  test('maps every published tenor of the month-end NAV row', () => {
    expect(byTicker.get('COWZ')?.returns).toEqual({
      ytd: 12.15, mo1: -6.84, mo3: 7.98, yr1: 26.63, yr3: 14.48, yr5: 12.02, yr10: null, sinceInception: 13.79,
    });
    expect(byTicker.get('PTNQ')?.returns.yr10).toBe(15.15);
  });

  test('"n/a" and "-" cells become null, not 0', () => {
    expect(byTicker.get('PTBD')?.returns.yr10).toBeNull();
    expect(byTicker.get('QFHD')?.returns.ytd).toBeNull();
    expect(byTicker.get('QFHD')?.returns.yr1).toBeNull();
  });

  test('uses the NAV pane as-of date (the later of the two published panes)', () => {
    expect(catalogAsOfDate(CATALOG)).toBe('2026-09-30');
    expect(byTicker.get('COWZ')?.asOfDate).toBe('2026-09-30');
  });

  test('a later "Total Return as of" pane replaces an earlier row for the same ticker', () => {
    const row = (asOf: string) => `| [Pacer US Cash Cows 100 ETF](https://www.paceretfs.com/products/COWZ) | [COWZ](https://www.paceretfs.com/products/COWZ) | 0.49% | 12/16/16 | ${asOf === 'old' ? '1.00' : '2.00'} | 0.10 | 0.20 | 0.30 | 0.40 | 0.50 | 0.60 | 0.70 |`;
    const source = [
      '|  | Total Return as of 09/30/2026 |',
      row('new'),
      '|  | Total Return as of 08/31/2026 |',
      row('old'),
    ].join('\n');
    const parsed = parseCatalogText(source);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].returns.ytd).toBe(2);
    expect(parsed[0].asOfDate).toBe('2026-09-30');
  });

  test('ignores series/menu links that point at non-ticker product pages', () => {
    const source = [
      '[Learn More](https://www.paceretfs.com/products/trendpilot/trendpilot-series)',
      '[Pacer Custom ETF Series](https://www.paceretfs.com/products/pacer-custom-etf-series)',
    ].join('\n');
    expect(() => parseCatalogText(source)).toThrow(/no ETF rows/);
  });

  test('card-style rows (ticker link + name link, no data columns) are kept', () => {
    const source = ['#### [PATN](https://www.paceretfs.com/products/patn)', '', '[Pacer Nasdaq International Patent Leaders ETF](https://www.paceretfs.com/products/patn)'].join('\n');
    const parsed = parseCatalogText(source);
    expect(parsed.map((fund) => fund.ticker)).toEqual(['PATN']);
    expect(parsed[0].name).toBe('Pacer Nasdaq International Patent Leaders ETF');
    expect(parsed[0].returns.ytd).toBeNull();
  });

  test('throws instead of publishing an empty catalog', () => {
    expect(() => parseCatalogText('no funds here')).toThrow(/no ETF rows found/);
  });
});

// ---------------------------------------------------------------------------
// Product page
// ---------------------------------------------------------------------------

describe('parseProductPage (fund page)', () => {
  const summary = parseProductPage(PRODUCT_PAGE, 'COWZ');

  test('reads the official fund name and the inception from the performance header', () => {
    expect(summary.name).toBe('Pacer US Cash Cows 100 ETF');
    expect(summary.inception).toBe('2016-12-16');
  });

  test('reads the index name from the index row of the performance table', () => {
    expect(summary.indexName).toBe('Pacer US Cash Cows 100 Index');
  });

  test('maps the quarter-end NAV row by header label, not by position', () => {
    const nav = summary.officialReturns.quarterEnd.nav;
    expect(nav?.asOfDate).toBe('2026-06-30');
    expect(nav?.siAnn).toBe(12.3);
    expect(nav?.ytd).toBe(3.87);
    expect(nav?.yr1).toBe(15.13);
    expect(nav?.cagr3y).toBe(11.24);
    expect(nav?.cagr5y).toBe(9.87);
    expect(nav?.cagr10y).toBeNull(); // the published table has no 10 Year column
  });

  test('keeps the market-price row separately', () => {
    expect(summary.officialReturns.quarterEnd.marketPrice?.yr1).toBe(15.21);
    expect(summary.officialReturns.quarterEnd.marketPrice?.siAnn).toBe(12.26);
  });

  test('reorders tenor columns without changing the mapping', () => {
    const source = [
      '## Performance (%)',
      'as of 03/31/2026',
      '|  | 1 Year | YTD | Since Fund Inception (12/16/16) |',
      '| Pacer Test ETF NAV | 5.00 | 6.00 | 7.00 |',
    ].join('\n');
    const parsed = parseProductPage(source, 'TEST');
    expect(parsed.officialReturns.quarterEnd.nav).toMatchObject({ asOfDate: '2026-03-31', yr1: 5, ytd: 6, siAnn: 7 });
  });

  test('parses the published distribution history newest-first into ascending events', () => {
    expect(summary.distributions).toHaveLength(3);
    expect(summary.distributions[0]).toEqual({ epoch: 1772668800, amount: 0.20027 }); // 2026-03-05, rounded to 6 decimals
    expect(summary.distributions.at(-1)).toEqual({ epoch: 1788393600, amount: 0.431373 }); // 2026-09-03
  });

  test('keeps the published distribution columns and rows', () => {
    expect(summary.distributionColumns[0]).toBe('Ex Date');
    expect(summary.distributionColumns[3]).toBe('Total Distributions');
    expect(summary.distributionRows).toHaveLength(3);
    expect(summary.distributionRows.at(-1)?.slice(0, 4)).toEqual(['9/3/2026', '9/3/2026', '9/8/2026', '$0.431373']);
  });

  test('parses the published top 10 holdings and stops at the total row', () => {
    expect(summary.topHoldings).toHaveLength(3);
    expect(summary.topHoldingsAsOf).toBe('2026-10-01');
    expect(summary.topHoldings[0]).toEqual({
      Name: 'QUALCOMM Inc',
      Ticker: 'QCOM',
      Identifier: '-',
      Weight: '2.32',
      'Market Value': '-',
      'Shares Held': '-',
      'Asset Category': '-',
    });
    expect(summary.topHoldings.some((row) => row.Name === 'Total')).toBe(false);
  });

  test('exposes the per-fund daily holdings CSV export URL', () => {
    expect(summary.holdingsDownloadUrl).toBe('https://www.paceretfs.com/products/holdings_download/COWZ');
    expect(holdingsDownloadUrl('calf')).toBe('https://www.paceretfs.com/products/holdings_download/CALF');
  });
});

describe('returnSlotForHeader', () => {
  test('maps every published tenor to its row slot', () => {
    expect(returnSlotForHeader('Since Fund Inception (12/16/16)')).toBe('siAnn');
    expect(returnSlotForHeader('YTD')).toBe('ytd');
    expect(returnSlotForHeader('1 Month')).toBe('mo1');
    expect(returnSlotForHeader('3 Month')).toBe('mo3');
    expect(returnSlotForHeader('1 Year')).toBe('yr1');
    expect(returnSlotForHeader('3 Year')).toBe('cagr3y');
    expect(returnSlotForHeader('5 Year')).toBe('cagr5y');
    expect(returnSlotForHeader('10 Year')).toBe('cagr10y');
  });

  test('unknown headers map to null (no positional guessing)', () => {
    expect(returnSlotForHeader('Fund Inception')).toBeNull();
    expect(returnSlotForHeader('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Holdings CSV
// ---------------------------------------------------------------------------

describe('parseHoldingsCsv (daily holdings export)', () => {
  const parsed = parseHoldingsCsv(HOLDINGS_CSV);

  test('detects the export by its header row', () => {
    expect(isHoldingsCsv(HOLDINGS_CSV)).toBe(true);
    expect(isHoldingsCsv('as-of-date,symbol,name')).toBe(false);
  });

  test('parses rows, drops the disclaimer trailer', () => {
    expect(parsed.rows).toHaveLength(4);
    expect(parsed.asOfDate).toBe('2026-10-01');
  });

  test('maps the published columns into the sheet contract', () => {
    expect(parsed.rows[1]).toEqual({
      Name: 'Accenture PLC',
      Ticker: 'ACN',
      Identifier: 'G1151C101',
      Weight: '2.09',
      'Market Value': '388083901.26',
      'Shares Held': '2116398',
      'Asset Category': '-',
    });
    expect(parsed.headers).toEqual(['Name', 'Ticker', 'Identifier', 'Weight', 'Market Value', 'Shares Held', 'Asset Category']);
  });

  test('money-market rows keep the "-" placeholder ticker', () => {
    const cash = parsed.rows.find((row) => row.Name === 'CASH & OTHER');
    expect(cash?.Ticker).toBe('-');
    expect(cash?.Weight).toBe('0');
  });

  test('returns the fund-level net assets and shares outstanding for AUM/NAV', () => {
    expect(parsed.netAssets).toBe(18581478740);
    expect(parsed.sharesOutstanding).toBe(278300000);
  });

  test('weights are percentages, market values are published as-is (no derivation)', () => {
    expect(parsed.rows[0].Weight).toBe('1.06');
    expect(parsed.rows[0]['Market Value']).toBe('196808941.35');
  });

  test('negative shares (cash offsets) survive as numbers', () => {
    expect(parsed.rows.at(-1)?.['Shares Held']).toBe('-1');
  });

  test('rejects a CSV without the expected header', () => {
    expect(() => parseHoldingsCsv('a,b,c\n1,2,3')).toThrow(/header row not found/);
  });
});

describe('parseCsv', () => {
  test('handles quoted fields with commas, quotes and CRLF endings', () => {
    const rows = parseCsv('a,b\r\n"x,1","say ""hi"""\r\n');
    expect(rows).toEqual([['a', 'b'], ['x,1', 'say "hi"']]);
  });
});

// ---------------------------------------------------------------------------
// Yahoo chart
// ---------------------------------------------------------------------------

describe('parseChart / priceReturns', () => {
  const chart = parseChart(CHART);

  test('reads days, dividends and the market price', () => {
    expect(chart.days).toHaveLength(5);
    expect(chart.days[0].date).toBe('2026-09-25');
    expect(chart.days[0].close).toBeCloseTo(67.73, 2);
    expect(chart.regularMarketPrice).toBe(67.63);
    expect(chart.exchangeName).toBe('BTS');
    expect(chart.firstTradeDate).toBe(1482417000);
    expect(chart.dividends).toEqual([{ epoch: 1790343000, amount: 0.431373 }]);
  });

  test('rejects an error payload', () => {
    expect(() => parseChart({ chart: { result: [] } })).toThrow(/no result/);
  });

  test('derived returns use the last session as the anchor date', () => {
    const returns = priceReturns(chart.days);
    expect(returns.asOfDate).toBe('2026-10-01');
    // Five sessions of history: no 1-month/1-year anchor exists yet, so those
    // tenors stay null instead of being reported as 0.
    expect(returns.mo1).toBeNull();
    expect(returns.yr1).toBeNull();
    // The quarter started on 2026-10-01, so quarter-to-date is a real 0.00%.
    expect(returns.qtd).toBe(0);
  });

  test('net assets / shares outstanding give the NAV the fund page does not publish', () => {
    const nav = 18581478740 / 278300000;
    expect(Number(nav.toFixed(2))).toBe(66.77);
  });
});

// ---------------------------------------------------------------------------
// Distributions: cadence and coded labels
// ---------------------------------------------------------------------------

describe('inferDistributionFrequency / frequencyCodeLabel', () => {
  const day = 86_400;

  test('quarterly cadence from the median ex-date gap', () => {
    const dividends = [1, 2, 3, 4, 5].map((index) => ({ epoch: index * 91 * day, amount: 0.1 }));
    expect(inferDistributionFrequency(dividends)).toEqual({ frequency: 'Quarterly', paymentsPerYear: 4 });
  });

  test('a single year-end special does not turn a quarterly payer into irregular', () => {
    const base = [1, 2, 3, 4, 5, 6].map((index) => ({ epoch: index * 91 * day, amount: 0.1 }));
    const withSpecial = [...base, { epoch: 6 * 91 * day + 30 * day, amount: 2 }];
    expect(inferDistributionFrequency(withSpecial).frequency).toBe('Quarterly');
  });

  test('no distributions -> None, one -> Unknown, sparse -> Irregular', () => {
    expect(inferDistributionFrequency([])).toEqual({ frequency: 'None', paymentsPerYear: null });
    expect(inferDistributionFrequency([{ epoch: day, amount: 1 }])).toEqual({ frequency: 'Unknown', paymentsPerYear: null });
    expect(inferDistributionFrequency([{ epoch: 10 * day, amount: 1 }, { epoch: 900 * day, amount: 1 }]).frequency).toBe('Irregular');
  });

  test('coded labels follow the shared contract, including "00 - None"', () => {
    expect(frequencyCodeLabel('Quarterly')).toBe('04 - Quarterly');
    expect(frequencyCodeLabel('Monthly')).toBe('01 - Monthly');
    expect(frequencyCodeLabel('Semi-Annual')).toBe('06 - Semi-annually');
    expect(frequencyCodeLabel('Annual')).toBe('12 - Annually');
    expect(frequencyCodeLabel('Unknown')).toBe('00 - Unknown');
    expect(frequencyCodeLabel('Irregular')).toBe('99 - Irregular');
    // Mandatory shared display rule: empty / dash placeholders show "None".
    expect(frequencyCodeLabel('')).toBe('00 - None');
    expect(frequencyCodeLabel('-')).toBe('00 - None');
    expect(frequencyCodeLabel('—')).toBe('00 - None');
    expect(frequencyCodeLabel(null)).toBe('00 - None');
    expect(frequencyCodeLabel(undefined)).toBe('00 - None');
  });
});

// ---------------------------------------------------------------------------
// Filters, ranges, formatting
// ---------------------------------------------------------------------------

describe('filters and value parsing', () => {
  test('range parsing accepts min:max, open bounds and the ":" wildcard', () => {
    expect(parseRange('10:20')).toEqual({ min: 10, max: 20 });
    expect(parseRange('10:')).toEqual({ min: 10, max: undefined });
    expect(parseRange(':')).toBeUndefined();
    expect(() => parseRange('10')).toThrow(/colon is required/);
    expect(() => parseRange('20:10')).toThrow(/minimum must not exceed maximum/);
  });

  test('AUM bounds accept the size presets and K/M/B/T amounts', () => {
    expect(parseAumRange('large:')).toEqual({ min: 10_000_000_000, max: undefined });
    expect(parseAumRange('1B:10B')).toEqual({ min: 1e9, max: 1e10 });
    expect(parseAumRange(':')).toBeUndefined();
  });

  test('performance/total-return ranges are read per tenor', () => {
    const ranges = parseRanges({ PERFORMANCE_3Y: '10:', TOTAL_RETURN_1Y: ':15' }, 'PERFORMANCE');
    expect(ranges['3Y']).toEqual({ min: 10, max: undefined });
    expect(ranges['1Y']).toBeUndefined();
    expect(parseRanges({ TOTAL_RETURN_5Y: '5:25' }, 'TOTAL_RETURN')['5Y']).toEqual({ min: 5, max: 25 });
  });

  test('numberOrNull keeps negatives and rejects placeholders', () => {
    expect(numberOrNull('-0.41')).toBe(-0.41);
    expect(numberOrNull('$0.431373')).toBe(0.431373);
    expect(numberOrNull('1.06%')).toBe(1.06);
    expect(numberOrNull('n/a')).toBeNull();
    expect(numberOrNull('-')).toBeNull();
    expect(numberOrNull('')).toBeNull();
  });

  test('dates normalize to ISO in both US formats', () => {
    expect(toIsoDate('12/16/16')).toBe('2016-12-16');
    expect(toIsoDate('6/11/2015')).toBe('2015-06-11');
    expect(toIsoDate('2026-10-01')).toBe('2026-10-01');
  });

  test('annualized -> cumulative conversion', () => {
    expect(annualizedToTotal(10, 3)).toBe(33.1);
    expect(annualizedToTotal(null, 3)).toBeNull();
  });
});

describe('mergeOfficialReturns', () => {
  const derived = { asOfDate: '2026-10-01', mo1: 1, qtd: 2, ytd: 3, yr1: 4, cagr3y: 5, cagr5y: 6, cagr10y: 7, siAnn: 8 };

  test('official values win per field, missing ones keep the derived value', () => {
    const merged = mergeOfficialReturns(derived, { asOfDate: '2026-09-30', mo1: null, mo3: null, ytd: 30, yr1: 40, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: null });
    expect(merged).toMatchObject({ asOfDate: '2026-09-30', ytd: 30, yr1: 40, cagr3y: 5, qtd: 2 });
  });

  test('without an official row the derived values are kept as-is', () => {
    expect(mergeOfficialReturns(derived, null)).toEqual(derived);
  });
});

describe('samePublishedContent', () => {
  test('ignores run timestamps when comparing published content', () => {
    expect(samePublishedContent('{"a":1,"generatedAt":"x"}', { a: 1, generatedAt: 'y' })).toBe(true);
  });

  test('detects real differences and nested timestamps', () => {
    expect(samePublishedContent('{"a":1}', { a: 2 })).toBe(false);
    expect(samePublishedContent('{"s":{"generatedAt":"x","b":1}}', { s: { generatedAt: 'y', b: 1 } })).toBe(true);
    expect(samePublishedContent('not json', {})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SEC EDGAR N-PORT-P fallback parsing
// ---------------------------------------------------------------------------

describe('SEC EDGAR helpers', () => {
  test('fund ticker table -> series/class references', () => {
    const map = parseFundTickerMap({ fields: ['symbol', 'cik', 'seriesId', 'classId'], data: [['COWZ', '1616668', 'S000056060', 'C000177942']] });
    expect(map.get('COWZ')).toEqual({ cik: '0001616668', seriesId: 'S000056060', classId: 'C000177942' });
  });

  test('N-PORT-P holdings map into the sheet contract', () => {
    const xml = [
      '<genInfo><regName>Pacer Funds Trust</regName><regCik>0001616668</regCik><seriesName>Pacer US Cash Cows 100 ETF</seriesName><seriesId>S000056060</seriesId><repPdDate>2026-07-31</repPdDate></genInfo>',
      '<fundInfo><netAssets>18581478740.00</netAssets></fundInfo>',
      '<invstOrSec><name>CHEVRON CORP</name><cusip>166764100</cusip><valUSD>386858078.73</valUSD><pctVal>2.08</pctVal><balance>1894413</balance><assetCat>EC</assetCat></invstOrSec>',
      '<invstOrSec><name>US TREASURY BILL 0.000% 01/02/2027</name><cusip>912797AAA</cusip><valUSD>1000</valUSD><pctVal>0.01</pctVal><balance>1000</balance><debtSec><maturityDt>2027-01-02</maturityDt><annualizedRt>4.25</annualizedRt></debtSec></invstOrSec>',
    ].join('');
    const parsed = parseNport(xml);
    expect(parsed.seriesId).toBe('S000056060');
    expect(parsed.repPdDate).toBe('2026-07-31');
    expect(parsed.netAssets).toBe(18581478740);
    expect(parsed.holdings).toHaveLength(2);
    expect(parsed.holdings[0]).toMatchObject({ Name: 'CHEVRON CORP', Ticker: '-', Identifier: '166764100', Weight: '2.08', 'Market Value': '386858078.73' });
    // Bond rows keep the coupon/maturity columns the app renders for them.
    expect(parsed.holdings[1]).toMatchObject({ Coupon: '4.25', Maturity: '2027-01-02' });
  });
});

// ---------------------------------------------------------------------------
// Repository guards (CI, Pages, UI, package.json)
// ---------------------------------------------------------------------------

describe('repository guards', () => {
  test('CI runs the offline tests and both Bun builds', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('bun test');
    expect(ci).toContain('bun build --target=bun scripts/update-data.ts --outfile=/dev/null');
    expect(ci).toContain('bun build app.tsx --outfile=/dev/null');
    expect(ci).toContain('git diff --check');
    expect(ci).not.toContain('tsc');
  });

  test('Pages deploys only the public application files, and only from main', () => {
    const pages = read('.github/workflows/pages.yml');
    expect(pages).toContain('_site');
    expect(pages).toContain('api/pacer');
    expect(pages).toContain('.nojekyll');
    expect(pages).toContain("github.ref == 'refs/heads/main'");
    expect(pages).toContain('workflows: [Update Pacer ETF data]');
  });

  test('the UI is brand-substituted, with no leftover sibling identifiers', () => {
    const app = read('app.tsx');
    const html = read('index.html');
    const leaks = ['schwab', 'Schwab', 'SCHWAB', 'franklin', 'Franklin', 'jpmorgan', 'JPMorgan']
      .filter((needle) => app.includes(needle) || html.includes(needle));
    expect(leaks).toEqual([]);
    expect(html).toContain('<title>Pacer ETFs</title>');
    expect(html).toContain("localStorage.getItem('pacer-theme')");
    expect(app).toContain("const INDEX_URL = './api/pacer/index.json';");
    for (const key of ['THEME_KEY', 'SELECTED_KEY', 'BLACKLIST_KEY', 'ACTIVE_FUND_KEY', 'FILTERS_KEY', 'LEGACY_FILTERS_KEY', 'SORTS_KEY', 'SITE_STATE_KEY']) {
      expect(app).toContain(`const ${key} = 'pacer-`);
    }
    expect(app).toContain('return `pacer-${scope');
    // Mandatory shared Frequency display rule.
    expect(app).toContain("'00 - None'");
    // SEC EDGAR trust attribution for this brand.
    expect(app).toContain('Pacer Funds Trust, CIK 0001616668');
  });

  test('package.json keeps the Bun-only toolchain (no runtime deps, no typescript)', () => {
    const pkg = JSON.parse(read('package.json')) as Record<string, any>;
    expect(pkg.dependencies).toEqual({});
    expect(Object.keys(pkg.devDependencies).sort()).toEqual(['@types/bun', '@types/node']);
    expect(JSON.stringify(pkg)).not.toContain('typescript');
    expect(read('.gitignore')).toContain('node_modules/');
  });
});
