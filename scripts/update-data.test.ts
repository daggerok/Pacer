/// <reference types="bun" />
// Offline regression tests for the Pacer ETFs updater. No network calls: every
// parser is exercised against dated fixtures captured from the public sources
// (see scripts/fixtures/README-capture-notes.txt for where each file came from).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import {
  annualizedToTotal,
  catalogAsOfDate,
  frequencyCodeLabel,
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
  returnSlotForHeader,
  samePublishedContent,
  toIsoDate,
} from './update-data';

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

const CATALOG = fixture('catalog-listing.txt');
const PRODUCT_PAGE = fixture('cowz-product-page.txt');
const HOLDINGS_CSV = fixture('cowz-holdings.csv');
const CHART = JSON.parse(fixture('cowz-chart.json')) as Record<string, any>;

// ---------------------------------------------------------------------------
// Config file / GitHub Actions input contract
// ---------------------------------------------------------------------------

describe('scripts/update-data.config.json', () => {
  const raw = JSON.parse(readFileSync(new URL('./update-data.config.json', import.meta.url), 'utf8')) as Record<string, unknown>;
  const workflow = readFileSync(new URL('../.github/workflows/update-data.yml', import.meta.url), 'utf8');
  const inputs = [...workflow.matchAll(/^      ([a-z][a-z0-9_]*):$/gm)].map((match) => match[1]);

  test('every default is a plain string (env values are strings everywhere)', () => {
    for (const [key, value] of Object.entries(raw)) {
      expect(typeof value, key).toBe('string');
    }
  });

  test('GitHub allows at most 25 workflow_dispatch inputs — the workflow stays under it', () => {
    expect(inputs.length).toBeLessThanOrEqual(25);
  });

  test('checked-in defaults match the documented Pacer pacing (WAF-conservative)', () => {
    expect(raw.REQUEST_SLEEP).toBe('2.5');
    expect(raw.CONCURRENCY).toBe('1');
    expect(raw.MAX_FETCHES).toBe('0');
    expect(raw.TICKERS).toBe('');
    expect(raw.EDGAR_FALLBACK).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// Catalog: the product listing
// ---------------------------------------------------------------------------

describe('parseCatalogText (product listing)', () => {
  const funds = parseCatalogText(CATALOG);
  const byTicker = new Map(funds.map((fund) => [fund.ticker, fund]));

  test('parses every fund row and keeps the ticker order', () => {
    expect(funds.map((fund) => fund.ticker)).toEqual(['CALF', 'COWZ', 'GCOW', 'HERD', 'PTBD', 'PTLC', 'PTMC', 'PTNQ', 'PWS', 'QFHD', 'TRND']);
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
    expect(summary.distributions).toHaveLength(7);
    expect(summary.distributions[0]).toEqual({ epoch: 1741219200, amount: 0.228684 }); // 2025-03-06
    expect(summary.distributions.at(-1)).toEqual({ epoch: 1788393600, amount: 0.431373 }); // 2026-09-03
  });

  test('keeps the published distribution columns and rows', () => {
    expect(summary.distributionColumns[0]).toBe('Ex Date');
    expect(summary.distributionColumns[3]).toBe('Total Distributions');
    expect(summary.distributionRows).toHaveLength(7);
    expect(summary.distributionRows.at(-1)?.slice(0, 4)).toEqual(['9/3/2026', '9/3/2026', '9/8/2026', '$0.431373']);
  });

  test('parses the published top 10 holdings and stops at the total row', () => {
    expect(summary.topHoldings).toHaveLength(10);
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
    expect(parsed.rows).toHaveLength(7);
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
// Repository parity guards (workflows, UI, README)
// ---------------------------------------------------------------------------

describe('repository parity', () => {
  const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const workflows = ['update-data.yml', 'ci.yml', 'pages.yml'];

  test('every expected workflow exists', () => {
    for (const name of workflows) expect(() => read(`.github/workflows/${name}`)).not.toThrow();
    expect(() => read('.github/dependabot.yml')).not.toThrow();
  });

  test('the data workflow runs on a schedule + manual dispatch only (never on push)', () => {
    const workflow = read('.github/workflows/update-data.yml');
    expect(workflow).toContain("cron: '0 0 * * 0'");
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/^\s+push:/m);
  });

  test('the data workflow commits only api/pacer and never runs tsc', () => {
    const workflow = read('.github/workflows/update-data.yml');
    expect(workflow).toContain('api/pacer');
    expect(workflow).not.toContain('tsc');
    expect(workflow).toContain('bun install --frozen-lockfile');
    expect(workflow).toContain('bun test');
  });

  test('CI runs the offline tests and both Bun builds', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('bun test');
    expect(ci).toContain('bun build --target=bun scripts/update-data.ts --outfile=/dev/null');
    expect(ci).toContain('bun build app.tsx --outfile=/dev/null');
    expect(ci).not.toContain('tsc');
  });

  test('Pages deploys only the public application files, and only from main', () => {
    const pages = read('.github/workflows/pages.yml');
    expect(pages).toContain('_site');
    expect(pages).toContain('api/pacer');
    expect(pages).toContain(".nojekyll");
    expect(pages).toContain("github.ref == 'refs/heads/main'");
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
