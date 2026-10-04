// Bun's test runner provides these globals at runtime.
/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CONTROL_NAMES,
  FETCH_TIMEOUT_MS,
  annualizedToTotal,
  cleanHoldingTicker,
  configurePacing,
  deriveMetrics,
  fetchText,
  firstDate,
  firstNumber,
  frequencyCodeLabel,
  historyPeriodStart,
  holdingsFallback,
  publishedAsOf,
  stalestFirst,
  htmlToText,
  inferDistributionFrequency,
  installSystemCa,
  isCatalogPage,
  isCertError,
  isFundPage,
  isinFromCusip,
  mergeOfficialReturns,
  normalizeHoldingName,
  nportUrlFor,
  numberOrNull,
  parseAumRange,
  parseCatalogText,
  parseChart,
  parseDistributionsTable,
  parseEdgarAtomFilings,
  parseFundDetails,
  parseFundName,
  parseFundTickerMap,
  parseNport,
  parseProductPage,
  placeholderRow,
  parseQuarterPerformance,
  parseRange,
  parseRanges,
  parseRecentPerformance,
  parseTopHoldings,
  performanceAsOfDate,
  postFetchFilterReasons,
  priceReturns,
  proxyUrl,
  readConfig,
  resolveControls,
  returnSlotForHeader,
  rowFromMeta,
  runWorkers,
  runtimeControls,
  samePublishedContent,
  softDeadlineReached,
  stripProxyPreamble,
  toIsoDate,
  toTextLines,
  topHoldingRows,
} from './update-data';

// ---------------------------------------------------------------------------
// Inline samples: abbreviated verbatim shapes observed on paceretfs.com through the
// r.jina.ai rendering proxy (checked by hand on 2026-10-01)
// ---------------------------------------------------------------------------

const PROXY_HEAD = ['Title: View all Pacer ETFs | Pacer ETFs', '', 'URL Source: https://www.paceretfs.com/products/', '', 'Markdown Content:'].join('\n');

const CATALOG_MARKDOWN = [
  PROXY_HEAD,
  '[![Image 1: Pacer ETFs](https://www.paceretfs.com/assets/img/logo.svg)](https://www.paceretfs.com/)',
  '',
  '## Pacer Trendpilot® ETF Series',
  '',
  '    *   #### [PTLC](https://www.paceretfs.com/products/ptlc)',
  '',
  '[Pacer Trendpilot US Large Cap ETF](https://www.paceretfs.com/products/ptlc)  ',
  '_Equities_ #### [TRND](https://www.paceretfs.com/products/trnd)',
  '',
  '[Pacer Trendpilot Fund of Funds ETF](https://www.paceretfs.com/products/trnd) ',
  '',
  '## Pacer Custom ETF Series',
  '',
  '    *   #### [PEVC](https://www.paceretfs.com/products/pevc)',
  '',
  '[Pacer PE/VC ETF](https://www.paceretfs.com/products/pevc) ',
  '',
  '## **![Image 12](https://www.paceretfs.com/images/uploads/general/green_break.jpg)  ',
  ' Risk Mitigation**',
  '',
  'Navigating turbulent markets can be tough.',
  '',
  'NAV Market Price',
  '',
  '| click on column headers to sort |  | Total Return as of 09/30/2026 | Total Return as of 08/31/2026 |',
  '| --- | --- | --- | --- |',
  '| Name | Ticker | Total Expenses | Fund Inception | YTD | 1 Month | 3 Month | 1 Year | 3 Year | 5 Year | 10 Year | Since Inception |',
  '| [Pacer Trendpilot US Large Cap ETF](https://www.paceretfs.com/products/PTLC) | [PTLC](https://www.paceretfs.com/products/PTLC) | 0.60% | 6/11/15 | 7.08 | -0.41 | 2.16 | 14.17 | 13.63 | 9.63 | 11.05 | 9.09 |',
  '| [Pacer Trendpilot Fund of Funds ETF](https://www.paceretfs.com/products/TRND) | [TRND](https://www.paceretfs.com/products/TRND) | 0.77%1 | 5/3/19 | 9.04 | -1.48 | -1.37 | 16.02 | 10.92 | 5.70 | n/a | 6.97 |',
  '',
  '[Monthly Performance](https://www.paceretfs.com/media/performance.pdf)',
  '',
  '* * *',
  '',
  '## **![Image 13](https://www.paceretfs.com/images/uploads/general/cows_product_span2.png)  ',
  ' High Quality Value**',
  '',
  '| click on column headers to sort |  | Total Return as of 09/30/2026 | Total Return as of 08/31/2026 |',
  '| --- | --- | --- | --- |',
  '| Name | Ticker | Total Expenses | Fund Inception | YTD | 1 Month | 3 Month | 1 Year | 3 Year | 5 Year | 10 Year | Since Inception |',
  '| [Pacer US Cash Cows 100 ETF](https://www.paceretfs.com/products/COWZ) | [COWZ](https://www.paceretfs.com/products/COWZ) | 0.49% | 12/16/16 | 12.15 | -6.84 | 7.98 | 26.63 | 14.48 | 12.02 | n/a | 13.79 |',
  '| [Pacer S&P 500 Quality FCF High Dividend ETF](https://www.paceretfs.com/products/QFHD) | [QFHD](https://www.paceretfs.com/products/QFHD) | 0.49% | 1/12/26 | - | -5.07 | 0.19 | n/a | n/a | n/a | n/a | 13.62 |',
  '',
  '* * *',
  '',
  '## **![Image 17](https://www.paceretfs.com/images/uploads/general/swan_product_span2.png)  ',
  ' Structured Outcome**',
  '',
  '| click on column headers to sort |  | Total Return as of 09/30/2026 | Total Return as of 08/31/2026 |',
  '| --- | --- | --- | --- |',
  '| Name | Ticker | Total Expenses | Fund Inception | YTD | 1 Month | 3 Month | 1 Year | 3 Year | 5 Year | 10 Year | Since Inception |',
  '| [Pacer Swan SOS Fund of Funds ETF](https://www.paceretfs.com/products/structured-outcome-strategies/PSFF) | [PSFF](https://www.paceretfs.com/products/structured-outcome-strategies/PSFF) | 0.66% | 12/29/20 | 8.82 | 0.44 | 2.49 | 12.15 | 12.37 | 9.40 | n/a | 10.10 |',
  '',
  '## **![Image 18](https://www.paceretfs.com/images/uploads/general/gray_break.jpg)  ',
  ' Income**',
  '',
  '| click on column headers to sort |  | Total Return as of 09/30/2026 | Total Return as of 03/31/2026 |',
  '| --- | --- | --- | --- |',
  '| Name | Ticker | Total Expenses | Fund Inception | YTD | 1 Month | 3 Month | 1 Year | 3 Year | 5 Year | 10 Year | Since Inception |',
  '| [Pacer Metaurus High Income Autocallable ETF](https://www.paceretfs.com/products/ACBH) | [ACBH](https://www.paceretfs.com/products/ACBH) | 0.60% | 9/9/26 | - | - | - | na | na | na | na | na |',
].join('\n');

const FUND_PAGE_COWZ = [
  'Title: COWZ | Pacer ETFs',
  '',
  'URL Source: https://www.paceretfs.com/products/COWZ',
  '',
  'Markdown Content:',
  '## COWZ',
  '',
  '## Pacer US Cash Cows 100 ETF',
  '',
  'An exchange traded fund (ETF) that seeks to track the total return performance, before fees and expenses, of the Pacer US Cash Cows 100 Index.',
  '',
  '## Fund Details',
  '',
  '### as of 09/30/2026',
  '',
  '| NAV | $66.77 |',
  '| --- |',
  '| NAV Change in Dollars | $-0.13 |',
  '| NAV Change (%) | -0.19% |',
  '| Market Price | $66.76 |',
  '| 30-Day Median Bid/Ask Spread 1 | 0.000143 |',
  '| Net Assets | $18,588,141,764.67 |',
  '| Shares Outstanding | 278,400,000 |',
  '| Fund Ticker | COWZ |',
  '| CUSIP# | 69374H881 |',
  '| ISIN | US69374H8815 |',
  '| Inception Date | 12/16/16 |',
  '| Total Expenses | 0.49% |',
  '| Number of Securities | 102 |',
  '| 30 Day SEC Yield | 1.63% |',
  '| Premium/Discount 3 | -0.01 |',
  '| [View Historical Premium/Discount](https://www.paceretfs.com/library/premium-discount/) Performance quoted represents past performance and does not guarantee future results. |',
  '',
  '*   Overview',
  '',
  '## Recent Investment Performance (%)',
  '',
  '|  | as of 09/30/2026 | as of 08/31/2026 |',
  '| --- | --- | --- |',
  '|  | YTD | YTD | Previous Month | 3 Month Total |',
  '| Pacer US Cash Cows 100 ETF Market Price | 12.16 | 20.41 | 7.76 | 11.17 |',
  '| Pacer US Cash Cows 100 ETF NAV | 12.15 | 20.39 | 7.79 | 11.14 |',
  '',
  '## Performance (%)',
  '',
  'as of 06/30/2026',
  '',
  '|  | Since Fund Inception (12/16/16) | YTD | 1 Year | 3 Year | 5 Year |',
  '| --- | --- | --- | --- | --- | --- |',
  '| Pacer US Cash Cows 100 ETF NAV | 12.30 | 3.87 | 15.13 | 11.24 | 9.87 |',
  '| Pacer US Cash Cows 100 ETF Market Price | 12.26 | 3.88 | 15.21 | 11.24 | 9.87 |',
  '| Pacer US Cash Cows 100 Index | 12.81 | 4.14 | 15.74 | 11.89 | 10.48 |',
  '| [Monthly Performance](https://www.paceretfs.com/media/performance.pdf) Source: US Bank and FTSE. |',
  '',
  '## **Top 10 Holdings (%)**',
  '',
  'as of 10/01/2026',
  '',
  '## **View All Holdings**',
  '',
  '[Daily Holdings](https://www.paceretfs.com/products/holdings_download/COWZ)',
  '',
  '| Ticker | Holding | Weight |',
  '| --- | --- | --- |',
  '| QCOM | QUALCOMM Inc | 2.32 |',
  '| VLO | Valero Energy Corp | 2.22 |',
  '|  | Total | 4.54 |',
  '',
  '## **Distributions**',
  '',
  '| Ex Date | Record Date | Pay Date | Total Distributions | Ordinary Income* | Short Term Capital Gains | Long Term Capital Gains | Return of Capital |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  '| 9/3/2026 | 9/3/2026 | 9/8/2026 | $0.431373 | $0.431373 | $0 | $0 | $0 |',
  '| 6/4/2026 | 6/4/2026 | 6/8/2026 | $0.111843 | $0.111843 | $0 | $0 | $0 |',
  '| 3/5/2026 | 3/5/2026 | 3/9/2026 | $0.20026985 | $0.20026985 | $0 | $0 | $0 |',
  '',
  '## Premium/Discount',
  '',
  '| From Jan 2, 2026 to Sep 30, 2026 |',
].join('\n');

// Structured Outcome pages have no "Fund Details" heading and no distributions table.
const FUND_PAGE_SOS = [
  '#### PSFF',
  '',
  '### as of 09/30/2026',
  '',
  '| NAV | $35.12 |',
  '| --- |',
  '| Market Price | $35.11 |',
  '| Net Assets | $611,921,840.40 |',
  '| CUSIP# | 69374H568 |',
  '| ISIN | US69374H5688 |',
  '| Inception Date | 12/29/20 |',
  '| Management Fee | 0.10% |',
  '| Total Expenses* | 0.66% |',
  '| Number of Securities | 14 |',
  '| Premium/Discount 3 | -0.02 |',
  '| [View Historical Premium/Discount](https://www.paceretfs.com/library/premium-discount/) *Effective May 1, 2026 |',
  '',
  '## Recent Investment Performance (%)',
  '|  | as of 09/30/2026 | as of 08/31/2026 |',
  '| --- | --- | --- |',
  '|  | YTD | YTD | Previous Month | 3 Month Total |',
  '| Pacer Swan SOS Fund of Funds ETF NAV | 8.82 | 8.34 | 1.42 | 2.29 |',
  '',
  '## Performance (%)',
  '(as of 06/30/2026)',
  '|  | Since Fund Inception (12/29/20) | YTD | 1 Year | 3 Year | 5 Year |',
  '| --- | --- | --- | --- | --- | --- |',
  '| Pacer Swan SOS Fund of Funds ETF NAV | 10.02 | 6.17 | 12.60 | 12.10 | 9.32 |',
].join('\n');

const FUND_PAGE_BOND_TOP10 = [
  '## **Top 10 Holdings (%)**',
  'as of 10/01/2026',
  '| Ticker | Holding | Weight |',
  '| --- | --- | --- |',
  '| USBFS03 | U.S. Bank Money Market Deposit Account 06/01/2031 | 18.59 |',
  '| LX267472 | Allied Universal (Universal Services) T/L B 8/25 (USD) 6.9809% 08/06/2032 | 0.94 |',
  '|  | Total | 19.53 |',
].join('\n');

// ---------------------------------------------------------------------------
// Shared helpers: a clean process state around every test
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch;
const realTimeout = AbortSignal.timeout;
const realTz = process.env.TZ;
const realExitCode = process.exitCode;

beforeEach(() => { process.env.TZ = 'UTC'; });
afterEach(() => {
  globalThis.fetch = realFetch;
  AbortSignal.timeout = realTimeout;
  process.exitCode = realExitCode;
  if (realTz === undefined) delete process.env.TZ; else process.env.TZ = realTz;
});

const file = (): Record<string, string> => JSON.parse(readFileSync(new URL('./update-data.config.json', import.meta.url), 'utf8'));
const source = new URL('./update-data.ts', import.meta.url).pathname;
const day = 86_400;

// ---------------------------------------------------------------------------

describe('controls', () => {
  test('precedence: file < advanced < nonblank input < env; the scheduled path equals the file defaults', () => {
    const all = resolveControls({ CONCURRENCY: 2, TICKERS: 'COWZ' }, { CONCURRENCY: 3, TICKERS: 'PTLC' }, { CONCURRENCY: '4', TICKERS: '' }, { CONCURRENCY: '5' });
    expect(all.CONCURRENCY).toBe('5');
    expect(all.TICKERS).toBe('PTLC');
    expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }, { CONCURRENCY: '4' }).CONCURRENCY).toBe('4');
    expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }).CONCURRENCY).toBe('3');
    expect(resolveControls({ AUM: '1B:' }, {}, {}, { UNRELATED: 'x', PATH: '/bin' }).AUM).toBe('1B:');
    const defaults = file();
    expect(resolveControls(defaults, {}, {}, {})).toEqual(Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, String(value)])));
  });

  test('blank handling: a blank input inherits, advanced and an explicitly set env var may blank a key', () => {
    expect(resolveControls({ TICKERS: 'COWZ' }, {}, { TICKERS: '' }).TICKERS).toBe('COWZ');
    expect(resolveControls({ CONCURRENCY: 2 }, {}, { CONCURRENCY: '' }).CONCURRENCY).toBe('2');
    expect(resolveControls({ TICKERS: 'COWZ' }, { TICKERS: '' }, { TICKERS: '' }).TICKERS).toBe('');
    expect(resolveControls({ TICKERS: 'COWZ' }, {}, {}, { TICKERS: '' }).TICKERS).toBe('');
    expect(resolveControls({ SKIP_YAHOO: true }, {}, {}, { SKIP_YAHOO: 'false' }).SKIP_YAHOO).toBe('false');
  });

  test('strict validation: bad values, unknown keys, CR/LF/NUL, bad ranges, bad HISTORY_RANGE and bad TICKERS are errors', () => {
    const invalid: unknown[] = [
      { UNKNOWN: 1 }, { CONCURRENCY: 0 }, { MAX_RETRIES: 0 }, { MAX_RETRIES: -1 }, { MAX_FETCHES: 1.5 }, { REQUEST_SLEEP: '-1' },
      { VERBOSE: 'maybe' }, { EDGAR_FALLBACK: 'maybe' }, { AUM: '1:2:3' }, { TER: '5:1' }, { SEC_YIELD: '5:1' }, { PERFORMANCE_1Y: 'a:b' },
      { HISTORY_RANGE: 'forever' }, { HISTORY_RANGE: '6mo' }, { HISTORY_RANGE: 'ytd' }, { HISTORY_RANGE: '0y' }, { HISTORY_RANGE: '5' },
      { TICKERS: ['COWZ'] }, { TICKERS: { a: 1 } }, { TICKERS: 'AAA $$$' }, { SEC_UA: 'x\nEVIL=yes' }, { SEC_UA: 'x\rfoo' }, { SEC_UA: 'x\0bad' }, null, [],
    ];
    for (const value of invalid) expect(() => resolveControls(value)).toThrow();
    expect(() => resolveControls({}, {}, { TICKERS: 'A\nB' })).toThrow();
    expect(() => resolveControls({}, {}, {}, { MAX_RETRIES: '0' })).toThrow();
    expect(() => resolveControls({}, 'not an object')).toThrow();
    expect(resolveControls(file(), {}, {}, { HISTORY_RANGE: '5Y' }).HISTORY_RANGE).toBe('5Y');
    expect([...readConfig({ TICKERS: 'aaa, bbb' }).tickers!]).toEqual(['AAA', 'BBB']);

    expect(parseRange('', 'X')).toBeUndefined();
    expect(parseRange('0.1%:0.5%', 'X')).toEqual({ min: 0.1, max: 0.5 });
    expect(parseRange('2:', 'X')).toEqual({ min: 2, max: undefined });
    expect(() => parseRange('5:1', 'X')).toThrow(/must not exceed/);
    expect(() => parseRange('5', 'X')).toThrow(/colon is required/);
    expect(parseAumRange('10M:2B')).toEqual({ min: 10_000_000, max: 2_000_000_000 });
    expect(parseAumRange('micro')).toEqual({ min: 10_000_000, max: 300_000_000 });
    expect(() => parseAumRange('42')).toThrow(/colon is required/);
    expect(parseRanges({ PERFORMANCE_YTD: ':', PERFORMANCE_1Y: ':', TOTAL_RETURN_1Y: ':' }, 'PERFORMANCE')).toEqual({});
  });

  test('config file: keys equal CONTROL_NAMES, defaults, SEC contact fallback, env overrides the file', async () => {
    expect(Object.keys(file()).sort()).toEqual([...CONTROL_NAMES].sort());
    for (const value of Object.values(file())) expect(typeof value).toBe('string');
    const config = readConfig(resolveControls(file()));
    expect(config).toMatchObject({ maxFetches: 0, concurrency: 1, holdingsPageSize: 250, historyPageSize: 1000, maxRetries: 2, historyRange: 'max', edgarFallback: true, skipPacer: false, skipYahoo: false, storeRawDownloads: false, tickers: null, performance: {}, totalReturn: {} });
    expect(config.secYield).toBeUndefined();
    expect(readConfig(resolveControls(file(), {}, {}, { SEC_YIELD: '3:' })).secYield).toEqual({ min: 3, max: undefined });
    expect(file().SEC_UA).toBe('daggerok ETF feed daggerok@gmail.com');
    expect(readConfig({}).secUa).toBe('daggerok ETF feed daggerok@gmail.com');
    expect(readConfig(resolveControls(file(), { SEC_UA: 'My Feed me@example.org' })).secUa).toBe('My Feed me@example.org');
    expect(readConfig(resolveControls({ MAX_RETRIES: 1 })).maxRetries).toBe(1);
    expect((await runtimeControls({})).REQUEST_SLEEP).toBe(file().REQUEST_SLEEP);
    expect((await runtimeControls({ REQUEST_SLEEP: '0', TICKERS: 'COWZ CALF' })).TICKERS).toBe('COWZ CALF');
  });

  test('USE_SYSTEM_CA: validated, certificate errors detected, restart only once on auto', async () => {
    expect(file().USE_SYSTEM_CA).toBe('auto');
    for (const value of ['auto', 'true', 'false', 'AUTO', 'True']) expect(resolveControls(file(), {}, {}, { USE_SYSTEM_CA: value }).USE_SYSTEM_CA).toBe(value);
    expect(() => resolveControls({ USE_SYSTEM_CA: 'maybe' })).toThrow();
    expect(isCertError({ code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' })).toBe(true);
    expect(isCertError(Object.assign(new Error('fetch failed'), { cause: new Error('unable to get local issuer certificate') }))).toBe(true);
    expect(isCertError({ code: 'ECONNRESET', message: 'socket hang up' })).toBe(false);
    expect(isCertError(null)).toBe(false);

    let restarts = 0;
    const reexec = (() => { restarts += 1; return undefined as never; }) as () => never;
    installSystemCa('false', reexec, false);
    installSystemCa('auto', reexec, true);
    expect(globalThis.fetch).toBe(realFetch);
    expect(restarts).toBe(0);
    installSystemCa('true', reexec, false);
    expect(restarts).toBe(1);

    let behavior: 'cert' | 'reset' | 'ok' = 'cert';
    globalThis.fetch = (async () => {
      if (behavior === 'cert') throw Object.assign(new Error('fetch failed'), { cause: { code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' } });
      if (behavior === 'reset') throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
      return new Response('ok');
    }) as typeof fetch;
    const wrapped = globalThis.fetch;
    installSystemCa('auto', reexec, false);
    expect(globalThis.fetch).not.toBe(wrapped);
    const errors = console.error;
    console.error = () => {};
    try { await globalThis.fetch('https://example.invalid/'); } finally { console.error = errors; }
    expect(restarts).toBe(2);
    behavior = 'reset';
    await expect(globalThis.fetch('https://example.invalid/')).rejects.toThrow('socket hang up');
    behavior = 'ok';
    expect(await (await globalThis.fetch('https://example.invalid/')).text()).toBe('ok');
    expect(restarts).toBe(2);
  });
});

describe('parsing', () => {
  test('scalars, dates and page text: unavailable values become null, never 0; month-name dates ignore the time zone', () => {
    expect(numberOrNull('+0.25')).toBe(0.25);
    expect(numberOrNull('-0.01%')).toBe(-0.01);
    expect(numberOrNull('$112,770,927,091.11')).toBe(112_770_927_091.11);
    expect(numberOrNull('(1.5)')).toBe(-1.5);
    for (const placeholder of ['--', '—', '', 'n/a']) expect(numberOrNull(placeholder)).toBeNull();
    expect(firstNumber('3.25% As of 09/17/2026')).toBe(3.25);
    expect(firstNumber('--')).toBeNull();
    expect(firstDate('Total Net Assets (as of 09/17/2026)')).toBe('2026-09-17');
    expect(firstDate('no date here')).toBeNull();
    expect(toIsoDate('2026-09-17')).toBe('2026-09-17');
    expect(toIsoDate('08/05/2010')).toBe('2010-08-05');
    expect(toIsoDate('10/10/19')).toBe('2019-10-10');
    expect(toIsoDate('')).toBe('');
    expect(isinFromCusip('69374H881')).toBe('US69374H8815');
    expect(isinFromCusip('bad')).toBe('');
    expect(annualizedToTotal(10, 3)).toBe(33.1);
    expect(annualizedToTotal(null, 3)).toBeNull();

    expect(stripProxyPreamble('Title: x\n\nURL Source: y\n\nMarkdown Content:\n## COWZ\n1,2')).toBe('## COWZ\n1,2');
    expect(proxyUrl('https://www.paceretfs.com/products/COWZ')).toBe('https://r.jina.ai/https://www.paceretfs.com/products/COWZ');
    const text = htmlToText('<table><tr><th>CUSIP#</th><td>69374H881</td></tr></table><p><a href="/products/COWZ">COWZ<br>Pacer US Cash Cows 100 ETF</a></p>');
    expect(text).toContain('| CUSIP# | 69374H881 |');
    expect(text).toContain('[COWZ Pacer US Cash Cows 100 ETF](https://www.paceretfs.com/products/COWZ)');
    const challenge = '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>Enable JavaScript and cookies to continue</body></html>';
    expect([isCatalogPage(challenge), isFundPage(challenge), isCatalogPage(CATALOG_MARKDOWN), isFundPage(FUND_PAGE_COWZ), isFundPage(CATALOG_MARKDOWN), isCatalogPage(FUND_PAGE_COWZ)]).toEqual([false, false, true, true, false, false]);

    for (const tz of ['Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
      const run = spawnSync(process.execPath, ['-e', "const m = await import(process.argv[1]); console.log(m.toIsoDate('Sep 30 2026') + '|' + m.toIsoDate('September 30, 2026'))", source], { env: { PATH: process.env.PATH ?? '', TZ: tz }, encoding: 'utf8' });
      expect(run.stdout.trim()).toBe('2026-09-30|2026-09-30');
    }
  });

  test('product listing: one row per fund, categories, footnoted TER, young funds keep null, links verbatim', () => {
    const funds = parseCatalogText(CATALOG_MARKDOWN);
    const byTicker = (ticker: string) => funds.find((fund) => fund.ticker === ticker)!;
    expect(funds.map((fund) => fund.ticker)).toEqual(['ACBH', 'COWZ', 'PEVC', 'PSFF', 'PTLC', 'QFHD', 'TRND']);
    expect([byTicker('PTLC').category, byTicker('COWZ').category, byTicker('PSFF').category, byTicker('ACBH').category]).toEqual(['Risk Mitigation', 'High Quality Value', 'Structured Outcome', 'Income']);

    const cowz = byTicker('COWZ');
    expect(cowz).toMatchObject({ name: 'Pacer US Cash Cows 100 ETF', ter: 0.49, inception: '2016-12-16', asOfDate: '2026-09-30', source: 'pacer' });
    expect(cowz.monthEnd).toEqual({ asOfDate: '2026-09-30', mo1: -6.84, mo3: 7.98, ytd: 12.15, yr1: 26.63, cagr3y: 14.48, cagr5y: 12.02, cagr10y: null, siAnn: 13.79 });
    expect(cowz.returns).toEqual({ ytd: 12.15, yr1: 26.63, yr3: 14.48, yr5: 12.02, yr10: null, sinceInception: 13.79 });
    expect(byTicker('TRND').ter).toBe(0.77);
    expect(byTicker('PTLC').monthEnd?.cagr10y).toBe(11.05);

    expect(byTicker('QFHD').monthEnd).toEqual({ asOfDate: '2026-09-30', mo1: -5.07, mo3: 0.19, ytd: null, yr1: null, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: 13.62 });
    expect(byTicker('ACBH').monthEnd).toBeNull();
    expect(byTicker('ACBH').inception).toBe('2026-09-09');

    expect(cowz.fundPage).toBe('https://www.paceretfs.com/products/COWZ');
    expect(byTicker('PSFF').fundPage).toBe('https://www.paceretfs.com/products/structured-outcome-strategies/PSFF');
    expect(byTicker('PEVC')).toMatchObject({ name: 'Pacer PE/VC ETF', category: 'Custom', fundPage: 'https://www.paceretfs.com/products/pevc', monthEnd: null, ter: null });

    expect(() => parseCatalogText('Title: x\n\nMarkdown Content:\nnothing here')).toThrow(/no ETF rows/);
    expect(['YTD', '1 Month', 'Previous Month', '3 Month Total', '1 Year', '3 Year', '5 Year', '10 Year', 'Since Fund Inception (12/16/16)'].map(returnSlotForHeader)).toEqual(['ytd', 'mo1', 'mo1', 'mo3', 'yr1', 'cagr3y', 'cagr5y', 'cagr10y', 'siAnn']);
    expect(['Name', 'Ticker', 'Total Expenses', 'Fund Inception', '2 Year', ''].map(returnSlotForHeader)).toEqual([null, null, null, null, null, null]);
    const reordered = CATALOG_MARKDOWN.replace('| Name | Ticker | Total Expenses | Fund Inception | YTD | 1 Month | 3 Month | 1 Year | 3 Year | 5 Year | 10 Year | Since Inception |\n| [Pacer US Cash Cows 100 ETF](https://www.paceretfs.com/products/COWZ) | [COWZ](https://www.paceretfs.com/products/COWZ) | 0.49% | 12/16/16 | 12.15 | -6.84 | 7.98 | 26.63 | 14.48 | 12.02 | n/a | 13.79 |',
      '| Name | Ticker | Total Expenses | Fund Inception | Since Inception | 10 Year | 5 Year | 3 Year | 1 Year | 3 Month | 1 Month | YTD |\n| [Pacer US Cash Cows 100 ETF](https://www.paceretfs.com/products/COWZ) | [COWZ](https://www.paceretfs.com/products/COWZ) | 0.49% | 12/16/16 | 13.79 | n/a | 12.02 | 14.48 | 26.63 | 7.98 | -6.84 | 12.15 |');
    expect(parseCatalogText(reordered).find((fund) => fund.ticker === 'COWZ')!.monthEnd).toEqual(cowz.monthEnd);
  });

  test('fund page: details, full summary, Structured Outcome page without Fund Details, empty page', () => {
    const lines = toTextLines(stripProxyPreamble(FUND_PAGE_COWZ));
    const details = parseFundDetails(lines);
    expect(details.asOfDate).toBe('2026-09-30');
    expect(details.values.get('nav')).toBe('$66.77');
    expect(details.values.get('premium/discount')).toBe('-0.01');
    expect(details.values.get('cusip#')).toBe('69374H881');
    expect(details.values.has('view historical premium/discount')).toBe(false);

    const summary = parseProductPage(FUND_PAGE_COWZ, 'COWZ');
    expect(summary).toMatchObject({
      name: 'Pacer US Cash Cows 100 ETF', asOfDate: '2026-09-30', cusip: '69374H881', isin: 'US69374H8815', inception: '2016-12-16', nav: 66.77, marketPrice: 66.76,
      totalNetAssets: 18_588_141_764.67, totalExpenseRatio: 0.49, sharesOutstanding: 278_400_000, totalHoldings: 102, premiumDiscount: -0.01, medianBidAskSpread: 0.000143, secYield: 1.63,
    });
    expect(isinFromCusip(summary.cusip)).toBe(summary.isin);

    const sos = parseProductPage(FUND_PAGE_SOS, 'PSFF');
    expect(sos).toMatchObject({ asOfDate: '2026-09-30', cusip: '69374H568', isin: 'US69374H5688', nav: 35.12, marketPrice: 35.11, totalNetAssets: 611_921_840.4, totalExpenseRatio: 0.66, totalHoldings: 14, premiumDiscount: -0.02, secYield: null });
    expect(sos.distributions).toEqual([]);
    expect(sos.officialReturns.quarterEnd.nav).toMatchObject({ asOfDate: '2026-06-30', ytd: 6.17, siAnn: 10.02 });
    expect(sos.officialReturns.monthEnd.nav?.ytd).toBe(8.82);

    expect(parseFundName('## COWZ\n\n## Pacer US Cash Cows 100 ETF\n', 'COWZ')).toBe('Pacer US Cash Cows 100 ETF');
    expect(parseFundName('#### PSFF\n\n### as of 09/30/2026', 'PSFF')).toBeNull();
    const empty = parseProductPage('<html><body>Access denied</body></html>', 'COWZ');
    expect(empty).toMatchObject({ name: null, asOfDate: null, nav: null, totalNetAssets: null, totalExpenseRatio: null });
    expect(empty.distributions).toEqual([]);
    expect(empty.topHoldings.rows).toEqual([]);
    expect(empty.officialReturns.quarterEnd).toEqual({ nav: null, marketPrice: null });
  });

  test('page-loaded check: the pricing block and both performance tables must be present, a missing SEC yield alone is not partial', () => {
    const cut = (page: string, from: string, to: string) => page.slice(0, page.indexOf(from)) + page.slice(page.indexOf(to));
    expect(parseProductPage(FUND_PAGE_COWZ, 'COWZ')).toMatchObject({ loadedFully: true, sections: { pricing: true, recent: true, quarter: true, secYield: true, distributions: true, topHoldings: true } });
    expect(parseProductPage(FUND_PAGE_SOS, 'PSFF')).toMatchObject({ loadedFully: true, sections: { secYield: false, distributions: false } });
    const noPerformance = FUND_PAGE_COWZ.slice(0, FUND_PAGE_COWZ.indexOf('## Recent Investment Performance'));
    expect(parseProductPage(noPerformance, 'COWZ')).toMatchObject({ nav: 66.77, loadedFully: false, sections: { pricing: true, recent: false, quarter: false, distributions: false, topHoldings: false } });
    // the Fund Details block cut before its Premium/Discount row, or either performance table missing, is partial
    expect(parseProductPage(FUND_PAGE_COWZ.replace('| Premium/Discount 3 | -0.01 |\n', ''), 'COWZ')).toMatchObject({ loadedFully: false, sections: { pricing: false, recent: true, quarter: true } });
    expect(parseProductPage(cut(FUND_PAGE_COWZ, '## Recent Investment Performance', '## Performance (%)'), 'COWZ')).toMatchObject({ loadedFully: false, sections: { recent: false, quarter: true } });
    expect(parseProductPage(cut(FUND_PAGE_COWZ, '## Performance (%)', '## **Top 10'), 'COWZ')).toMatchObject({ loadedFully: false, sections: { recent: true, quarter: false } });
    expect(parseProductPage(FUND_PAGE_COWZ.replace('| 30 Day SEC Yield | 1.63% |\n', ''), 'COWZ')).toMatchObject({ loadedFully: true, secYield: null, sections: { secYield: false } });
    expect(parseProductPage('<html><body>Access denied</body></html>', 'COWZ')).toMatchObject({ loadedFully: false, sections: { pricing: false, recent: false, quarter: false } });
    expect(isFundPage(FUND_PAGE_COWZ)).toBe(true);
    expect(isFundPage(noPerformance)).toBe(true);
    expect(isFundPage('## Fund Details\n| Fund Ticker | COWZ |')).toBe(false);
  });

  test('fund page tables: recent and quarter-end performance, top 10 holdings, distributions', () => {
    const lines = toTextLines(stripProxyPreamble(FUND_PAGE_COWZ));
    const recent = parseRecentPerformance(lines);
    expect(recent.nav).toEqual({ asOfDate: '2026-09-30', mo1: null, mo3: null, ytd: 12.15, yr1: null, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: null });
    expect(recent.marketPrice?.ytd).toBe(12.16);
    expect(parseRecentPerformance(toTextLines('nothing'))).toEqual({ nav: null, marketPrice: null });
    const quarter = parseQuarterPerformance(lines);
    expect(quarter.nav).toEqual({ asOfDate: '2026-06-30', mo1: null, mo3: null, ytd: 3.87, yr1: 15.13, cagr3y: 11.24, cagr5y: 9.87, cagr10y: null, siAnn: 12.3 });
    expect(quarter.marketPrice).toMatchObject({ ytd: 3.88, yr1: 15.21, siAnn: 12.26 });

    const top = parseTopHoldings(lines);
    expect(top).toEqual({ asOfDate: '2026-10-01', rows: [{ ticker: 'QCOM', name: 'QUALCOMM Inc', weight: 2.32 }, { ticker: 'VLO', name: 'Valero Energy Corp', weight: 2.22 }], total: 4.54 });
    expect(parseTopHoldings(toTextLines('no table'))).toEqual({ asOfDate: null, rows: [], total: null });
    const bonds = topHoldingRows(parseTopHoldings(toTextLines(FUND_PAGE_BOND_TOP10)), 1_000_000);
    expect(bonds[0]).toEqual({ Name: 'U.S. Bank Money Market Deposit Account 06/01/2031', Ticker: '-', Identifier: 'USBFS03', Weight: '18.59', 'Market Value': '185900', 'Shares Held': '-', 'Asset Category': '-' });
    expect(bonds[1]).toMatchObject({ Ticker: '-', Identifier: 'LX267472' });
    expect(topHoldingRows(top, null)[0]).toMatchObject({ Ticker: 'QCOM', 'Market Value': '-' });

    const rows = parseDistributionsTable(lines);
    expect(rows).toEqual([{ epoch: Date.UTC(2026, 2, 5) / 1000, amount: 0.20027 }, { epoch: Date.UTC(2026, 5, 4) / 1000, amount: 0.111843 }, { epoch: Date.UTC(2026, 8, 3) / 1000, amount: 0.431373 }]);
    const zero = toTextLines(['| Ex Date | Record Date | Pay Date | Total Distributions |', '| --- |', '| 9/3/2026 | 9/3/2026 | 9/8/2026 | $0 |', '| 6/4/2026 | 6/4/2026 | 6/8/2026 | $0.5 |'].join('\n'));
    expect(parseDistributionsTable(zero).map((row) => row.amount)).toEqual([0.5]);
    expect(parseDistributionsTable(toTextLines('nothing'))).toEqual([]);
  });

  test('Yahoo chart and SEC EDGAR payloads', () => {
    const chart = parseChart({
      chart: { result: [{
        meta: { exchangeName: 'PCX', regularMarketPrice: 33.7, regularMarketTime: 1_789_000_000, firstTradeDate: 1_319_000_000 },
        timestamp: [1_600_000_000, 1_600_086_400, 1_600_172_800],
        indicators: { quote: [{ close: [10, null, 12], volume: [100, 200, 300] }], adjclose: [{ adjclose: [9, null, 11.5] }] },
        events: { dividends: { '1600086400': { amount: 0.25, date: 1_600_086_400 } } },
      }] },
    });
    expect(chart.days).toHaveLength(2);
    expect(chart.days[0]).toEqual({ date: '2020-09-13', close: 10, adjClose: 9, volume: 100 });
    expect(chart.dividends).toEqual([{ epoch: 1_600_086_400, amount: 0.25 }]);
    expect(() => parseChart({})).toThrow(/no result/);

    const map = parseFundTickerMap({ fields: ['cik', 'seriesId', 'classId', 'symbol'], data: [[1616668, 'S000034073', 'C000104937', 'COWZ'], [1616668, 'S000027575', 'C000083337', 'QQQG']] });
    expect(map.get('COWZ')).toEqual({ cik: '0001616668', seriesId: 'S000034073', classId: 'C000104937' });
    const atom = '<feed><entry><content><accession-number>0001752724-26-000001</accession-number><filing-date>2026-08-27</filing-date><filing-type>NPORT-P</filing-type><filing-href>https://www.sec.gov/Archives/edgar/data/1616668/000175272426000001/0001752724-26-000001-index.htm</filing-href><period>2026-06-30</period></content></entry><entry><content><accession-number>0001752724-26-000002</accession-number><filing-type>NPORT-P/A</filing-type></content></entry></feed>';
    const filings = parseEdgarAtomFilings(atom);
    expect(filings).toHaveLength(1);
    expect(nportUrlFor('0001616668', '0001752724-26-000001')).toBe(filings[0].url);
    const xml = '<edgarSubmission><genInfo><seriesName>Pacer US Cash Cows 100 ETF</seriesName><seriesId>S000034073</seriesId><repPdDate>2026-06-30</repPdDate></genInfo><fundInfo><netAssets>112770927091.11</netAssets></fundInfo>'
      + '<invstOrSecs><invstOrSec><name>MERCK &amp; CO INC</name><cusip>58933Y105</cusip><balance>37710468</balance><valUSD>5541249108.24</valUSD><pctVal>4.91</pctVal><assetCat>EC</assetCat></invstOrSec>'
      + '<invstOrSec><name>UNITED STATES TREASURY NOTE</name><cusip>91282CJL6</cusip><balance>1000000</balance><valUSD>990000</valUSD><pctVal>0.5</pctVal><assetCat>DBT</assetCat><debtSec><maturityDt>2028-01-31</maturityDt><annualizedRt>3.5</annualizedRt></debtSec></invstOrSec></invstOrSecs></edgarSubmission>';
    const parsed = parseNport(xml);
    expect(parsed).toMatchObject({ seriesId: 'S000034073', repPdDate: '2026-06-30', netAssets: 112_770_927_091.11 });
    expect(parsed.holdings).toHaveLength(2);
    expect(parsed.holdings[0]).toEqual({ Name: 'MERCK & CO INC', Ticker: '-', Identifier: '58933Y105', Weight: '4.91', 'Market Value': '5541249108.24', 'Shares Held': '37710468', 'Asset Category': 'EC' });
    expect(parsed.holdings[1]).toMatchObject({ Coupon: '3.5', Maturity: '2028-01-31' });
    expect(normalizeHoldingName('Merck & Co., Inc.')).toBe('MERCK AND');
    expect(cleanHoldingTicker(' n/a ')).toBe('');
    expect(cleanHoldingTicker('brk.b')).toBe('BRK.B');
  });
});

describe('metrics', () => {
  const nullReturns = { asOfDate: null, mo1: null, qtd: null, ytd: null, yr1: null, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: null };
  const bar = (date: string, close: number) => ({ date, close, adjClose: close, volume: 1 });
  const now = new Date(Date.UTC(2026, 9, 1, 12));

  test('price returns: null for horizons the fund is too young for, QTD anchored on the prior quarter-end', () => {
    const old = priceReturns([bar('2025-09-10', 100), bar('2025-12-31', 110), bar('2026-06-30', 115), bar('2026-09-17', 121)], new Date(Date.UTC(2026, 8, 17, 12)));
    expect(old).toMatchObject({ asOfDate: '2026-09-17', ytd: 10, qtd: 5.22, yr1: 21, cagr3y: null });
    const young = priceReturns([bar('2026-09-01', 10), bar('2026-10-01', 10.2)], now);
    expect([young.yr1, young.cagr3y, young.cagr5y, young.cagr10y, young.siAnn]).toEqual([null, null, null, null, null]);
    expect(priceReturns([bar('2024-09-30', 10), bar('2026-10-01', 12)], now).siAnn).not.toBeNull();
    expect(priceReturns([bar('2026-09-30', 10), bar('2026-10-01', 10.5)], now).qtd).toBe(5);
    expect(priceReturns([bar('2026-10-01', 10.5)], now).qtd).toBeNull();
  });

  test('derived metrics: one key set for official and Yahoo basis, unavailable is null never 0, basis and as-of travel together', () => {
    const fund = { dividendYield: null, secYield: null } as never;
    const derived = { ...nullReturns, asOfDate: '2026-09-17', mo1: 1, qtd: 2, ytd: 3, yr1: 4, cagr3y: 5, cagr5y: 6, cagr10y: 7, siAnn: 8 };
    const official = mergeOfficialReturns(derived, { asOfDate: '2026-09-30', mo1: 1, mo3: 2, ytd: 3, yr1: 4, cagr3y: 5, cagr5y: 6, cagr10y: 7, siAnn: 8 });
    const viaOfficial = deriveMetrics(official, fund, [], { paymentsPerYear: null }, 10, true);
    const viaYahoo = deriveMetrics(derived, fund, [], { paymentsPerYear: null }, 10, false);
    const empty = deriveMetrics(nullReturns, fund, [], { paymentsPerYear: null }, null, false);
    expect(Object.keys(viaYahoo)).toEqual(Object.keys(viaOfficial));
    expect(Object.keys(empty)).toEqual(Object.keys(viaOfficial));
    expect(Object.keys(viaOfficial).slice(-2)).toEqual(['returnsBasis', 'performanceAsOf']);
    expect(String(viaOfficial.returnsBasis)).toMatch(/official Pacer/);
    expect(String(viaYahoo.returnsBasis)).toMatch(/Yahoo/);
    expect(viaOfficial.performanceAsOf).toBe('2026-09-30');
    expect(viaYahoo.performanceAsOf).toBe('2026-09-17');
    expect(empty.performanceAsOf).toBeNull();
    expect(performanceAsOfDate({ asOfDate: '' })).toBeNull();
    for (const [key, value] of Object.entries(empty)) {
      if (!['returnsBasis', 'performanceAsOf'].includes(key) && !key.endsWith('Text')) expect([key, value]).toEqual([key, null]);
    }
    expect(String(empty.returnsBasis).length).toBeGreaterThan(0);
  });

  test('official returns win but keep derived QTD and fill official gaps', () => {
    const derived = { ...nullReturns, asOfDate: '2026-09-17', mo1: 1, qtd: 2, ytd: 3, yr1: 4, cagr3y: 5, cagr5y: 6, cagr10y: 7, siAnn: 8 };
    const official = { asOfDate: '2026-09-30', mo1: -6.84, mo3: 7.98, ytd: 12.15, yr1: 26.63, cagr3y: 14.48, cagr5y: 12.02, cagr10y: null, siAnn: 13.79 };
    expect(mergeOfficialReturns(derived, official)).toEqual({ asOfDate: '2026-09-30', mo1: -6.84, qtd: 2, ytd: 12.15, yr1: 26.63, cagr3y: 14.48, cagr5y: 12.02, cagr10y: 7, siAnn: 13.79 });
    expect(mergeOfficialReturns(derived, null)).toBe(derived);
  });

  test('bounded return filters exclude a fund with no value for the tenor; rebuilt rows share the metrics key set', () => {
    const config = readConfig({ PERFORMANCE_3Y: '5:', TOTAL_RETURN_5Y: ':50' });
    const fund = { ticker: 'X', netAssets: 1 } as never;
    expect(postFetchFilterReasons(fund, { cagr3y: null, tr5y: null }, config)).toEqual(['PERFORMANCE_3Y', 'TOTAL_RETURN_5Y']);
    expect(postFetchFilterReasons(fund, { cagr3y: 6, tr5y: 40 }, config)).toEqual([]);

    const row = rowFromMeta({ ticker: 'DDD', name: 'DDD ETF', nav: { value: 12.5 }, aum: { value: 5e8 }, returns: { derivedFrom: 'official x', monthEnd: { ytd: 4.27, yr3: 10 } }, yields: { secYield: 1.2 } });
    expect(row).toMatchObject({ ticker: 'DDD', navValue: 12.5, dataFile: './funds/DDD/meta.json' });
    expect(row.metrics.ytd).toBe(4.27);
    expect(row.metrics.cagr5y).toBeNull();
    expect(row.metrics.returnsBasis).toBeTruthy();
    expect(row.metrics.performanceAsOf).toBeNull();
    const fresh = deriveMetrics(nullReturns, { dividendYield: null, secYield: null } as never, [], { paymentsPerYear: null }, null, false);
    expect(Object.keys(row.metrics)).toEqual(Object.keys(fresh));
    expect(rowFromMeta({ ticker: 'DDD', distributions: { frequency: 'Monthly', rows: [['08/29/2026', '0.1'], ['09/30/2026', '0.124175']] } }).distributions).toEqual({ frequency: 'Monthly', exDate: '09/30/2026', dividend: '0.124175' });
  });

  test('distribution frequency from the median gap, and its client label', () => {
    const at = (iso: string) => ({ epoch: Date.parse(`${iso}T00:00:00Z`) / 1000, amount: 0.1 });
    const monthly = ['2025-08-01', '2025-09-02', '2025-10-01', '2025-11-03', '2025-12-01', '2025-12-19', '2026-02-02', '2026-03-02', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-03', '2026-09-01'];
    expect(inferDistributionFrequency(monthly.map(at))).toEqual({ frequency: 'Monthly', paymentsPerYear: 12 });
    expect(inferDistributionFrequency(['2025-03-26', '2025-06-25', '2025-09-24', '2025-12-10', '2026-03-25', '2026-06-24'].map(at))).toEqual({ frequency: 'Quarterly', paymentsPerYear: 4 });
    expect(inferDistributionFrequency(['2024-06-20', '2024-12-18', '2025-06-24', '2025-12-17', '2026-06-23'].map(at))).toEqual({ frequency: 'Semi-Annual', paymentsPerYear: 2 });
    expect(inferDistributionFrequency(['2023-12-20', '2024-12-18', '2025-12-17'].map(at))).toEqual({ frequency: 'Annual', paymentsPerYear: 1 });
    expect(inferDistributionFrequency([{ epoch: 0, amount: 1 }, { epoch: 900 * day, amount: 1 }])).toEqual({ frequency: 'Irregular', paymentsPerYear: null });
    expect(inferDistributionFrequency([{ epoch: 0, amount: 1 }])).toEqual({ frequency: 'Unknown', paymentsPerYear: null });
    expect(inferDistributionFrequency([])).toEqual({ frequency: 'None', paymentsPerYear: null });
    expect(['Monthly', 'Quarterly', 'Semi-Annual', 'Annual', 'Irregular', 'None', 'Unknown', '—', ''].map(frequencyCodeLabel)).toEqual(['01 - Monthly', '04 - Quarterly', '06 - Semi-annually', '12 - Annually', '99 - Irregular', '00 - None', '00 - Unknown', '00 - None', '00 - None']);
  });
});

// ---------------------------------------------------------------------------
// Pipeline harness: a private copy of the updater runs in a temp dir against a mocked
// network (preload) that serves a 3-fund catalog, fund pages and Yahoo charts.
// MOCK_FAIL (comma list of `catalog`, `<TICKER>:page`, `<TICKER>:chart`) makes sources fail.
// ---------------------------------------------------------------------------

const catalogRow = (name: string, ticker: string, path: string, ter: string, inception: string, values: string) =>
  `| [${name}](https://www.paceretfs.com/products/${path}${ticker}) | [${ticker}](https://www.paceretfs.com/products/${path}${ticker}) | ${ter} | ${inception} | ${values} |`;
const CATALOG_3 = [
  PROXY_HEAD,
  '## **![Image 13](https://www.paceretfs.com/images/uploads/general/cows_product_span2.png)  ',
  ' High Quality Value**',
  '',
  '| click on column headers to sort |  | Total Return as of 09/30/2026 | Total Return as of 08/31/2026 |',
  '| --- | --- | --- | --- |',
  '| Name | Ticker | Total Expenses | Fund Inception | YTD | 1 Month | 3 Month | 1 Year | 3 Year | 5 Year | 10 Year | Since Inception |',
  catalogRow('Pacer US Cash Cows 100 ETF', 'COWZ', '', '0.49%', '12/16/16', '12.15 | -6.84 | 7.98 | 26.63 | 14.48 | 12.02 | n/a | 13.79'),
  catalogRow('Pacer S&P 500 Quality FCF High Dividend ETF', 'QFHD', '', '0.49%', '1/12/26', '- | -5.07 | 0.19 | n/a | n/a | n/a | n/a | 13.62'),
  catalogRow('Pacer Swan SOS Fund of Funds ETF', 'PSFF', 'structured-outcome-strategies/', '0.66%', '12/29/20', '8.82 | 0.44 | 2.49 | 12.15 | 12.37 | 9.40 | n/a | 10.10'),
].join('\n');

const MOCK_PRELOAD = `
import { appendFileSync } from 'node:fs';
const F = ${JSON.stringify({ catalog: CATALOG_3, pages: { COWZ: FUND_PAGE_COWZ, QFHD: FUND_PAGE_COWZ, PSFF: FUND_PAGE_SOS } })};
const DAY = 86400;
const chart = (n) => {
  const end = Math.floor(Date.now() / 1000 / DAY) * DAY - DAY;
  const timestamp = Array.from({ length: n }, (_, i) => end - (n - 1 - i) * DAY);
  const close = timestamp.map((_, i) => 10 + i * 0.01);
  return { chart: { result: [{ meta: { exchangeName: 'PCX', regularMarketPrice: close[n - 1], regularMarketTime: end, firstTradeDate: timestamp[0] }, timestamp, indicators: { quote: [{ close, volume: close.map(() => 1) }], adjclose: [{ adjclose: close }] }, events: {} }] } };
};
// MOCK_PAGE: 'perf' = proxy rendering dropped everything after Fund Details, 'rows' = Fund Details cut before Premium/Discount,
// 'nosec' = a fully loaded page that really has no SEC yield and a new market price
const shape = (page) => {
  if (!page) return page;
  if (process.env.MOCK_PAGE === 'perf') return page.slice(0, page.indexOf('## Recent Investment Performance'));
  if (process.env.MOCK_PAGE === 'rows') return page.split('\\n').filter((line) => !/^\\| (30 Day SEC Yield|Premium\\/Discount)/.test(line)).join('\\n');
  if (process.env.MOCK_PAGE === 'nosec') return page.split('\\n').filter((line) => !/^\\| 30 Day SEC Yield/.test(line)).join('\\n').replace('| Market Price | $66.76 |', '| Market Price | $66.80 |');
  return page;
};
const clockStep = Number(process.env.MOCK_CLOCK_STEP_MS || 0);
if (clockStep) { const realNow = Date.now; let skew = 0; Date.now = () => realNow() + skew; globalThis.__tick = () => { skew += clockStep; }; }
globalThis.fetch = (async (input) => {
  appendFileSync(process.env.MOCK_CALLS, String(input) + '\\n');
  if (/\\/v8\\/finance\\/chart\\//.test(String(input))) globalThis.__tick?.();
  const fail = (process.env.MOCK_FAIL || '').split(',');
  const url = String(input).replace('https://r.jina.ai/', '');
  const reply = (body, ok = true) => (ok ? new Response(body) : new Response('boom', { status: 500 }));
  if (url === 'https://www.paceretfs.com/products/') return reply(process.env.MOCK_NEWF ? F.catalog + '\\n#### [NEWF](https://www.paceretfs.com/products/newf)\\n\\n[Pacer New Test ETF](https://www.paceretfs.com/products/newf)\\n' : F.catalog, !fail.includes('catalog'));
  const chartMatch = url.match(/\\/v8\\/finance\\/chart\\/([A-Z]+)\\?/);
  if (chartMatch) return reply(JSON.stringify(chart(chartMatch[1] === 'QFHD' ? 20 : 400)), !fail.includes(chartMatch[1] + ':chart'));
  const page = url.match(/^https:\\/\\/www\\.paceretfs\\.com\\/products\\/(?:[a-z-]+\\/)?([A-Za-z]+)$/);
  if (page) return reply(shape(F.pages[page[1].toUpperCase()]), !fail.includes(page[1].toUpperCase() + ':page'));
  return new Response('not mocked', { status: 404 });
});
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = ((fn, _ms, ...args) => realSetTimeout(fn, 0, ...args));
`;

type Snapshot = Map<string, { text: string; mtimeMs: number }>;
type Feed = {
  run: (env?: Record<string, string>) => { status: number | null; out: string };
  read: (relative: string) => string;
  write: (relative: string, text: string) => void;
  path: (relative: string) => string;
  remove: (relative: string) => void;
  index: () => { funds: Array<Record<string, any>> };
  snapshot: () => Snapshot;
  calls: () => string[];
};

function withFeed(body: (feed: Feed) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'pacer-feed-'));
  try {
    mkdirSync(join(root, 'scripts'));
    copyFileSync(new URL('./update-data.ts', import.meta.url), join(root, 'scripts/update-data.ts'));
    copyFileSync(new URL('./update-data.config.json', import.meta.url), join(root, 'scripts/update-data.config.json'));
    writeFileSync(join(root, 'preload.ts'), MOCK_PRELOAD);
    const api = join(root, 'api/pacer');
    const walk = (dir: string, into: Snapshot): Snapshot => {
      for (const name of readdirSync(dir).sort()) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path, into);
        else into.set(path.slice(api.length), { text: readFileSync(path, 'utf8'), mtimeMs: statSync(path).mtimeMs });
      }
      return into;
    };
    body({
      run: (env = {}) => {
        const result = spawnSync(process.execPath, ['--preload', join(root, 'preload.ts'), join(root, 'scripts/update-data.ts')], {
          env: { PATH: process.env.PATH ?? '', TZ: 'UTC', MOCK_CALLS: join(root, 'calls.txt'), REQUEST_SLEEP: '0', MAX_RETRIES: '1', CONCURRENCY: '1', EDGAR_FALLBACK: 'false', ...env },
          encoding: 'utf8',
        });
        return { status: result.status, out: result.stdout + result.stderr };
      },
      read: (relative) => readFileSync(join(api, relative), 'utf8'),
      write: (relative, text) => writeFileSync(join(api, relative), text),
      path: (relative) => join(root, relative),
      remove: (relative) => rmSync(join(api, relative)),
      index: () => JSON.parse(readFileSync(join(api, 'index.json'), 'utf8')),
      snapshot: () => walk(api, new Map()),
      calls: () => (existsSync(join(root, 'calls.txt')) ? readFileSync(join(root, 'calls.txt'), 'utf8').split('\n').filter(Boolean) : []),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const tickers = (feed: Feed) => feed.index().funds.map((fund) => fund.ticker);

describe('pipeline', () => {
  test('a full run publishes every fund with one metrics key set, dataFile links, and never prints SEC_UA', () => {
    withFeed((feed) => {
      const result = feed.run({ SEC_UA: 'leakcheck-agent ops@leak.test', VERBOSE: 'true' });
      expect(result.status).toBe(0);
      expect(result.out).not.toContain('leakcheck-agent');
      const { funds } = feed.index();
      expect(funds.map((fund) => fund.ticker)).toEqual(['COWZ', 'PSFF', 'QFHD']);
      expect(new Set(funds.map((fund) => Object.keys(fund.metrics).sort().join())).size).toBe(1);
      for (const fund of funds) {
        expect(fund.dataFile).toBe(`./funds/${fund.ticker}/meta.json`);
        expect(JSON.parse(feed.read(`funds/${fund.ticker}/meta.json`)).ticker).toBe(fund.ticker);
        expect(String(fund.metrics.returnsBasis).length).toBeGreaterThan(0);
      }
      const young = funds.find((fund) => fund.ticker === 'QFHD')!.metrics;
      expect([young.cagr3y, young.cagr5y, young.cagr10y, young.tr3y, young.tr1y]).toEqual([null, null, null, null, null]);
      expect(funds.find((fund) => fund.ticker === 'COWZ')!.metrics.tr1y).toBe(26.63);
    });
  }, 60_000);

  test('filtered, bounded and catalog-less runs never shrink the feed; a fund with files but no row is listed again', () => {
    withFeed((feed) => {
      feed.run();
      const cowz = feed.index().funds.find((fund) => fund.ticker === 'COWZ');
      feed.run({ TICKERS: 'PSFF' });
      expect(feed.index().funds.find((fund) => fund.ticker === 'COWZ')).toEqual(cowz);
      for (const env of [{ MAX_FETCHES: '1' }, { MOCK_FAIL: 'catalog' }]) {
        feed.run(env);
        expect(tickers(feed)).toEqual(['COWZ', 'PSFF', 'QFHD']);
      }

      feed.remove('index.json');
      feed.run({ TICKERS: 'QFHD', MOCK_FAIL: 'catalog' });
      expect(feed.index().funds.map((fund) => [fund.ticker, fund.dataFile])).toEqual([
        ['COWZ', './funds/COWZ/meta.json'], ['PSFF', './funds/PSFF/meta.json'], ['QFHD', './funds/QFHD/meta.json'],
      ]);
    });
  }, 90_000);

  test('a second identical run writes nothing (zero diff)', () => {
    withFeed((feed) => {
      expect(feed.run().status).toBe(0);
      const first = feed.snapshot();
      expect(first.size).toBeGreaterThan(6);
      expect(feed.run().status).toBe(0);
      const second = feed.snapshot();
      expect([...second.keys()]).toEqual([...first.keys()]);
      for (const [path, content] of first) expect([path, second.get(path)]).toEqual([path, content]);
    });
    expect(samePublishedContent('{"a":1,"generatedAt":"x"}', { a: 1, generatedAt: 'y' })).toBe(true);
    expect(samePublishedContent('{"cursor":null,"savedAt":"x"}', { cursor: null, savedAt: 'y' })).toBe(true);
    expect(samePublishedContent('{"a":1}', { a: 2 })).toBe(false);
    expect(samePublishedContent('{"a":1,"generatedAt":"x"}', { a: 1, b: 2, generatedAt: 'x' })).toBe(false);
    expect(samePublishedContent('not json', {})).toBe(false);
  }, 60_000);

  test('a failed required source keeps the fund exactly as published', () => {
    withFeed((feed) => {
      feed.run();
      const meta = feed.read('funds/COWZ/meta.json');
      const row = feed.index().funds.find((fund) => fund.ticker === 'COWZ');
      for (const fail of ['COWZ:chart', 'COWZ:page']) {
        const result = feed.run({ TICKERS: 'COWZ', MOCK_FAIL: fail });
        expect(result.status).toBe(1);
        expect(result.out).toContain('required source failed');
        expect(feed.read('funds/COWZ/meta.json')).toBe(meta);
        expect(feed.index().funds.find((fund) => fund.ticker === 'COWZ')).toEqual(row);
        expect(tickers(feed)).toEqual(['COWZ', 'PSFF', 'QFHD']);
      }
    });
    expect([holdingsFallback(102, 10), holdingsFallback(10, 10), holdingsFallback(5, 0), holdingsFallback(0, 10), holdingsFallback(0, 0)]).toEqual(['previous', 'top10', 'previous', 'top10', 'none']);
  }, 60_000);

  test('a partial fund page or a failed listing keeps the published official sections (zero diff); a fully loaded page lacking a field is an honest null', () => {
    withFeed((feed) => {
      expect(feed.run().status).toBe(0);
      const published = feed.snapshot();
      const texts = (snap: Snapshot) => [...snap].map(([path, content]) => [path, content.text]);
      const meta = JSON.parse(feed.read('funds/COWZ/meta.json'));
      expect(meta).toMatchObject({ marketPrice: { value: 66.76, source: expect.stringContaining('official fund page Market Price') }, yields: { secYield: 1.63 }, returns: { derivedFrom: expect.stringContaining('official') } });

      // proxy rendering dropped the performance tables and distributions / cut Fund Details / the listing failed / both
      for (const env of [{ MOCK_PAGE: 'perf' }, { MOCK_PAGE: 'rows' }, { MOCK_FAIL: 'catalog' }, { MOCK_PAGE: 'perf', MOCK_FAIL: 'catalog' }]) {
        const result = feed.run(env);
        expect(result.status).toBe(0);
        expect(texts(feed.snapshot())).toEqual(texts(published));
        expect(result.out.match(/\[ kept/g)?.length).toBe(3); // one notice per fund
      }
      const partial = feed.run({ MOCK_PAGE: 'perf', MOCK_FAIL: 'catalog' }).out;
      expect(partial).toMatch(/COWZ: .*kept the published month-end returns, recent performance \(market price\), quarter-end performance, distributions/);
      expect(feed.index().funds.find((fund) => fund.ticker === 'COWZ')!.metrics).toMatchObject({ tr1y: 26.63, secYield: 1.63, performanceAsOf: '2026-09-30' });
      expect(String(feed.index().funds.find((fund) => fund.ticker === 'COWZ')!.metrics.returnsBasis)).toContain('official');

      // a page that loaded fully but has no SEC yield (and a new price) is fresh data with an honest null, nothing is kept
      const fresh = feed.run({ MOCK_PAGE: 'nosec' });
      expect(fresh.out).not.toContain('[ kept');
      const next = JSON.parse(feed.read('funds/COWZ/meta.json'));
      expect(next.marketPrice.value).toBe(66.8);
      expect(next.yields).toMatchObject({ secYield: null, secYieldText: '—' });
      expect(next.yields.secYieldKind).toContain('not published');
    });
  }, 120_000);

  test('a new fund whose required source failed gets a catalog-only row (dataFile null, full metrics key set) and no files', () => {
    withFeed((feed) => {
      expect(feed.run().status).toBe(0);
      const result = feed.run({ MOCK_NEWF: '1', TICKERS: 'NEWF' });
      expect(result.out).toContain('NEW FUNDS: NEWF');
      const { funds } = feed.index();
      expect(funds.map((fund) => fund.ticker)).toEqual(['COWZ', 'NEWF', 'PSFF', 'QFHD']);
      const row = funds.find((fund) => fund.ticker === 'NEWF')!;
      expect(row).toMatchObject({ dataFile: null, name: 'Pacer New Test ETF', holdings: 0, history: 0 });
      expect(Object.keys(row.metrics).sort()).toEqual(Object.keys(funds[0].metrics).sort());
      expect(row.metrics).toMatchObject({ ytd: null, tr1y: null, secYield: null, performanceAsOf: null });
      expect(String(row.metrics.returnsBasis).length).toBeGreaterThan(0);
      expect(existsSync(feed.path('api/pacer/funds/NEWF'))).toBe(false);
      expect(Object.keys(placeholderRow({ ticker: 'X', name: 'X', category: 'ETF', fundPage: '', cusip: '', isin: '', exchange: '', ter: null }).metrics).sort()).toEqual(Object.keys(row.metrics).sort());
    });
  }, 90_000);

  test('stalest fund first: a deadline-truncated run refreshes the stalest, the next runs pick up the skipped funds', () => {
    withFeed((feed) => {
      expect(feed.run().status).toBe(0);
      // published as-of dates: QFHD stalest, then COWZ, then PSFF (alphabetical order would be COWZ, PSFF, QFHD)
      const asOf: Record<string, [string, string]> = { QFHD: ['Jan 10 2026', '2026-01-10'], COWZ: ['Feb 10 2026', '2026-02-10'], PSFF: ['Mar 01 2026', '2026-03-01'] };
      const index = feed.index();
      for (const row of index.funds) {
        row.asOfDate = asOf[row.ticker][0];
        row.metrics.performanceAsOf = asOf[row.ticker][1];
      }
      feed.write('index.json', JSON.stringify(index));
      const published = new Map<string, Record<string, any>>(index.funds.map((row) => [row.ticker, row]));
      expect(stalestFirst(['COWZ', 'PSFF', 'QFHD', 'ZNEW'].map((ticker) => ({ ticker })), published).map((f) => f.ticker)).toEqual(['ZNEW', 'QFHD', 'COWZ', 'PSFF']);
      expect(publishedAsOf({ ...index.funds[0], dataFile: null })).toBeNull();

      // fake clock: every chart request "takes" 26 minutes (soft deadline 25), so each run handles exactly one fund
      const summary = feed.path('summary.md');
      const order: string[] = [];
      for (let run = 0; run < 3; run += 1) {
        const seen = feed.calls().length;
        expect(feed.run({ MOCK_CLOCK_STEP_MS: String(26 * 60_000), GITHUB_STEP_SUMMARY: summary }).status).toBe(0);
        order.push(feed.calls().slice(seen).map((url) => /\/v8\/finance\/chart\/([A-Z]+)\?/.exec(url)?.[1]).filter(Boolean).join(','));
      }
      expect(order).toEqual(['QFHD', 'COWZ', 'PSFF']);
      expect(readFileSync(summary, 'utf8')).toContain('1 of 3 funds refreshed, 2 keep their published data, oldest remaining published as-of: 2026-02-10 (COWZ)');
      expect(tickers(feed)).toEqual(['COWZ', 'PSFF', 'QFHD']);
    });
  }, 90_000);

  test('bounded runs: the cursor skips filtered funds, wraps and is scoped; TICKERS runs leave it alone; an unknown ticker fails', () => {
    withFeed((feed) => {
      const cursors: Array<string | null> = [];
      for (let i = 0; i < 3; i += 1) {
        feed.run({ TER: ':0.5', MAX_FETCHES: '1' });
        cursors.push(JSON.parse(feed.read('update-state.json')).cursor);
      }
      expect(cursors).toEqual(['COWZ', 'QFHD', 'COWZ']);
      const scope = JSON.parse(feed.read('update-state.json')).scope;
      feed.run({ TER: ':1', MAX_FETCHES: '1' });
      expect(JSON.parse(feed.read('update-state.json')).scope).not.toBe(scope);
      const state = feed.read('update-state.json');
      feed.run({ TICKERS: 'PSFF', MAX_FETCHES: '1' });
      expect(feed.read('update-state.json')).toBe(state);
      const unknown = feed.run({ TICKERS: 'NOPE' });
      expect(unknown.status).toBe(1);
      expect(unknown.out).toContain('NOPE');
    });
    expect(softDeadlineReached(0, 24 * 60_000)).toBe(false);
    expect(softDeadlineReached(0, 25 * 60_000)).toBe(true);
  }, 90_000);
});

describe('network', () => {
  const sourceConfig = (env: Record<string, string> = {}) => readConfig(resolveControls(file(), {}, {}, { REQUEST_SLEEP: '0', ...env }));

  test('the timeout signal covers reading the body, not only the headers', async () => {
    const requested: number[] = [];
    AbortSignal.timeout = ((ms: number) => {
      requested.push(ms);
      const controller = new AbortController();
      setTimeout(() => controller.abort(new Error('timed out')), 20);
      return controller.signal;
    }) as typeof AbortSignal.timeout;
    globalThis.fetch = (async (_url: unknown, init?: { signal?: AbortSignal }) => ({
      ok: true,
      status: 200,
      text: () => new Promise<string>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason))),
    })) as unknown as typeof fetch;
    configurePacing(0, 1);
    await expect(fetchText('https://example.test/slow', 'slow', sourceConfig({ MAX_RETRIES: '1' }))).rejects.toThrow('timed out');
    expect(requested.length).toBeGreaterThan(0);
    expect(requested.every((ms) => ms === FETCH_TIMEOUT_MS)).toBe(true);
  }, 20_000);

  test('retries are bounded: the rendering proxy is retried at most once, other hosts MAX_RETRIES times', async () => {
    for (const [url, retries, calls] of [[proxyUrl('https://example.test/a'), '5', 2], ['https://example.test/b', '1', 2]] as const) {
      let seen = 0;
      globalThis.fetch = (async () => { seen += 1; return new Response('boom', { status: 500 }); }) as unknown as typeof fetch;
      configurePacing(0, 1);
      await expect(fetchText(url, 'x', sourceConfig({ MAX_RETRIES: retries }))).rejects.toThrow('500');
      expect(seen).toBe(calls);
    }
  }, 20_000);

  test('request lanes: peak in-flight requests is 1 at CONCURRENCY=1 and N at CONCURRENCY=N', async () => {
    for (const concurrency of [1, 4, 15]) {
      let inFlight = 0;
      let peak = 0;
      globalThis.fetch = (async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inFlight -= 1;
        return new Response('ok');
      }) as unknown as typeof fetch;
      const config = sourceConfig({ CONCURRENCY: String(concurrency) });
      configurePacing(config.requestSleep, config.concurrency);
      const queue = Array.from({ length: 30 }, (_, i) => `https://example.test/${i}`);
      await runWorkers(config.concurrency, async () => {
        for (let url = queue.shift(); url; url = queue.shift()) await fetchText(url, 'test', config);
      });
      expect(peak).toBe(concurrency);
    }
  });

  test('HISTORY_RANGE shrinks the Yahoo request through an explicit period1 and period2', () => {
    const now = Date.UTC(2026, 9, 1, 12);
    expect(historyPeriodStart('max', now)).toBe(0);
    expect(historyPeriodStart('', now)).toBe(0);
    expect(historyPeriodStart(' 10Y ', now)).toBe(Math.floor(now / 1000 - 10 * 365.25 * day));
    withFeed((feed) => {
      const lastChartUrl = (env: Record<string, string>) => {
        feed.run({ TICKERS: 'COWZ', ...env });
        return new URL(feed.calls().filter((call) => call.includes('/v8/finance/chart/COWZ')).slice(-1)[0]);
      };
      const five = lastChartUrl({ HISTORY_RANGE: '5y' });
      const nowSeconds = Date.now() / 1000;
      const period1 = Number(five.searchParams.get('period1'));
      expect(period1).toBeGreaterThan(nowSeconds - 5.1 * 365.25 * day);
      expect(period1).toBeLessThan(nowSeconds - 4.9 * 365.25 * day);
      expect(Number(five.searchParams.get('period2'))).toBeGreaterThan(nowSeconds);
      expect(five.searchParams.has('range')).toBe(false);
      expect(lastChartUrl({ HISTORY_RANGE: 'max' }).searchParams.get('period1')).toBe('0');
    });
  }, 60_000);
});
