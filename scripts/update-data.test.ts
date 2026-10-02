// Bun's test runner provides these globals at runtime.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  CONTROL_NAMES,
  installSystemCa,
  isCertError,
  configurePacing,
  fetchText,
  runWorkers,
  annualizedToTotal,
  cleanHoldingTicker,
  firstDate,
  firstNumber,
  frequencyCodeLabel,
  historyPeriodStart,
  holdingsFallback,
  htmlToText,
  inferDistributionFrequency,
  isCatalogPage,
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
  parseQuarterPerformance,
  parseRange,
  parseRanges,
  parseRecentPerformance,
  parseTopHoldings,
  priceReturns,
  proxyUrl,
  readConfig,
  resolveControls,
  returnSlotForHeader,
  runtimeControls,
  samePublishedContent,
  stripProxyPreamble,
  toIsoDate,
  toTextLines,
  topHoldingRows,
} from './update-data';

// ---------------------------------------------------------------------------
// Fixtures: abbreviated verbatim shapes observed on paceretfs.com through the
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

describe('range parsers', () => {
  test('parseRange keeps inclusive numeric bounds', () => {
    expect(parseRange('', 'X')).toBeUndefined();
    expect(parseRange(':', 'X')).toBeUndefined();
    expect(parseRange('0.1%:0.5%', 'X')).toEqual({ min: 0.1, max: 0.5 });
    expect(parseRange('2:', 'X')).toEqual({ min: 2, max: undefined });
    expect(() => parseRange('5:1', 'X')).toThrow(/must not exceed/);
    expect(() => parseRange('5', 'X')).toThrow(/colon is required/);
  });

  test('parseAumRange supports dollar suffixes and sibling presets', () => {
    expect(parseAumRange('10M:2B')).toEqual({ min: 10_000_000, max: 2_000_000_000 });
    expect(parseAumRange('large')).toEqual({ min: 10_000_000_000, max: undefined });
    expect(parseAumRange('micro')).toEqual({ min: 10_000_000, max: 300_000_000 });
    expect(() => parseAumRange('42')).toThrow(/colon is required/);
  });
});

describe('scalar helpers', () => {
  test('numberOrNull handles signs, placeholders, currency and parentheses', () => {
    expect(numberOrNull('+0.25')).toBe(0.25);
    expect(numberOrNull('-0.01%')).toBe(-0.01);
    expect(numberOrNull('$112,770,927,091.11')).toBe(112_770_927_091.11);
    expect(numberOrNull('(1.5)')).toBe(-1.5);
    expect(numberOrNull('--')).toBeNull();
    expect(numberOrNull('—')).toBeNull();
    expect(numberOrNull('')).toBeNull();
  });

  test('toIsoDate accepts ISO, US and two-digit-year US dates', () => {
    expect(toIsoDate('2026-09-17')).toBe('2026-09-17');
    expect(toIsoDate('08/05/2010')).toBe('2010-08-05');
    expect(toIsoDate('10/10/19')).toBe('2019-10-10');
    expect(toIsoDate('11/03/09')).toBe('2009-11-03');
    expect(toIsoDate('')).toBe('');
  });

  test('firstNumber / firstDate pull the value out of free text', () => {
    expect(firstNumber('3.25% As of 09/17/2026')).toBe(3.25);
    expect(firstNumber('$15,193,857,213.48 ')).toBe(15_193_857_213.48);
    expect(firstNumber('--')).toBeNull();
    expect(firstNumber('09/18/2026 | $23.88')).toBe(23.88);
    expect(firstNumber('09/17/2026 | 97')).toBe(97);
    expect(firstNumber('08/31/2026 | 61.57%')).toBe(61.57);
    expect(firstDate('Total Net Assets (as of 09/17/2026)')).toBe('2026-09-17');
    expect(firstDate('no date here')).toBeNull();
  });

  test('isinFromCusip derives the ISIN with the Luhn check digit', () => {
    expect(isinFromCusip('69374H881')).toBe('US69374H8815'); // COWZ
    expect(isinFromCusip('69374H428')).toBe('US69374H4285'); // FLRT
    expect(isinFromCusip('bad')).toBe('');
  });

  test('annualizedToTotal compounds the CAGR', () => {
    expect(annualizedToTotal(10, 3)).toBe(33.1);
    expect(annualizedToTotal(null, 3)).toBeNull();
  });
});


describe('text normalization', () => {
  test('stripProxyPreamble removes the r.jina.ai header', () => {
    expect(stripProxyPreamble('Title: x\n\nURL Source: y\n\nMarkdown Content:\n## COWZ\n1,2')).toBe('## COWZ\n1,2');
    expect(stripProxyPreamble('plain')).toBe('plain');
  });

  test('htmlToText renders tables as pipe rows and anchors as markdown links', () => {
    const text = htmlToText('<table><tr><th>CUSIP#</th><td>69374H881</td></tr></table><p><a href="/products/COWZ">COWZ<br>Pacer US Cash Cows 100 ETF</a></p>');
    expect(text).toContain('| CUSIP# | 69374H881 |');
    expect(text).toContain('[COWZ Pacer US Cash Cows 100 ETF](https://www.paceretfs.com/products/COWZ)');
    expect(htmlToText('plain, no tags')).toBe('plain, no tags');
  });

  test('proxyUrl prefixes the read-only rendering proxy', () => {
    expect(proxyUrl('https://www.paceretfs.com/products/COWZ')).toBe('https://r.jina.ai/https://www.paceretfs.com/products/COWZ');
  });

  test('page validators reject the Cloudflare challenge and accept real content', () => {
    const challenge = '<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title></head><body>Enable JavaScript and cookies to continue</body></html>';
    expect(isCatalogPage(challenge)).toBe(false);
    expect(isFundPage(challenge)).toBe(false);
    expect(isCatalogPage(CATALOG_MARKDOWN)).toBe(true);
    expect(isFundPage(FUND_PAGE_COWZ)).toBe(true);
    expect(isFundPage(CATALOG_MARKDOWN)).toBe(false);
    expect(isCatalogPage(FUND_PAGE_COWZ)).toBe(false);
  });
});

describe('Pacer product listing parser', () => {
  const funds = parseCatalogText(CATALOG_MARKDOWN);
  const byTicker = (ticker: string) => funds.find((fund) => fund.ticker === ticker)!;

  test('reads one row per fund from the theme tables plus series-only funds', () => {
    expect(funds.map((fund) => fund.ticker)).toEqual(['ACBH', 'COWZ', 'PEVC', 'PSFF', 'PTLC', 'QFHD', 'TRND']);
    expect(byTicker('PTLC').category).toBe('Risk Mitigation');
    expect(byTicker('COWZ').category).toBe('High Quality Value');
    expect(byTicker('PSFF').category).toBe('Structured Outcome');
    expect(byTicker('ACBH').category).toBe('Income');
  });

  test('table values: name, total expenses (footnote digit ignored), inception, NAV returns as of the first header date', () => {
    const cowz = byTicker('COWZ');
    expect(cowz.name).toBe('Pacer US Cash Cows 100 ETF');
    expect(cowz.ter).toBe(0.49);
    expect(cowz.inception).toBe('2016-12-16');
    expect(cowz.asOfDate).toBe('2026-09-30');
    expect(cowz.monthEnd).toEqual({ asOfDate: '2026-09-30', mo1: -6.84, mo3: 7.98, ytd: 12.15, yr1: 26.63, cagr3y: 14.48, cagr5y: 12.02, cagr10y: null, siAnn: 13.79 });
    expect(cowz.returns).toEqual({ ytd: 12.15, yr1: 26.63, yr3: 14.48, yr5: 12.02, yr10: null, sinceInception: 13.79 });
    expect(byTicker('TRND').ter).toBe(0.77);
    expect(byTicker('TRND').monthEnd?.cagr10y).toBeNull();
    expect(byTicker('PTLC').monthEnd?.cagr10y).toBe(11.05);
    expect(byTicker('PTLC').monthEnd?.mo1).toBe(-0.41);
    expect(cowz.source).toBe('pacer');
  });

  test('young funds keep dashes and n/a as null; all-empty rows have no official returns', () => {
    const qfhd = byTicker('QFHD');
    expect(qfhd.monthEnd).toEqual({ asOfDate: '2026-09-30', mo1: -5.07, mo3: 0.19, ytd: null, yr1: null, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: 13.62 });
    expect(byTicker('ACBH').monthEnd).toBeNull();
    expect(byTicker('ACBH').inception).toBe('2026-09-09');
    expect(byTicker('ACBH').asOfDate).toBe('2026-09-30');
  });

  test('fund page links are used verbatim (Structured Outcome sub-path), series-only funds get the series label', () => {
    expect(byTicker('COWZ').fundPage).toBe('https://www.paceretfs.com/products/COWZ');
    expect(byTicker('PSFF').fundPage).toBe('https://www.paceretfs.com/products/structured-outcome-strategies/PSFF');
    const pevc = byTicker('PEVC');
    expect(pevc.name).toBe('Pacer PE/VC ETF');
    expect(pevc.category).toBe('Custom');
    expect(pevc.fundPage).toBe('https://www.paceretfs.com/products/pevc');
    expect(pevc.monthEnd).toBeNull();
    expect(pevc.ter).toBeNull();
  });

  test('throws when no fund rows are present', () => {
    expect(() => parseCatalogText('Title: x\n\nMarkdown Content:\nnothing here')).toThrow(/no ETF rows/);
  });

  test('returnSlotForHeader maps every tenor header and ignores the rest', () => {
    expect(['YTD', '1 Month', 'Previous Month', '3 Month', '3 Month Total', '1 Year', '3 Year', '5 Year', '10 Year', 'Since Inception', 'Since Fund Inception (12/16/16)'].map(returnSlotForHeader)).toEqual(['ytd', 'mo1', 'mo1', 'mo3', 'mo3', 'yr1', 'cagr3y', 'cagr5y', 'cagr10y', 'siAnn', 'siAnn']);
    expect(['Name', 'Ticker', 'Total Expenses', 'Fund Inception', '2 Year', ''].map(returnSlotForHeader)).toEqual([null, null, null, null, null, null]);
  });

  test('reordered table headers still fill the right slots', () => {
    const text = CATALOG_MARKDOWN.replace('| Name | Ticker | Total Expenses | Fund Inception | YTD | 1 Month | 3 Month | 1 Year | 3 Year | 5 Year | 10 Year | Since Inception |\n| [Pacer US Cash Cows 100 ETF](https://www.paceretfs.com/products/COWZ) | [COWZ](https://www.paceretfs.com/products/COWZ) | 0.49% | 12/16/16 | 12.15 | -6.84 | 7.98 | 26.63 | 14.48 | 12.02 | n/a | 13.79 |',
      '| Name | Ticker | Total Expenses | Fund Inception | Since Inception | 10 Year | 5 Year | 3 Year | 1 Year | 3 Month | 1 Month | YTD |\n| [Pacer US Cash Cows 100 ETF](https://www.paceretfs.com/products/COWZ) | [COWZ](https://www.paceretfs.com/products/COWZ) | 0.49% | 12/16/16 | 13.79 | n/a | 12.02 | 14.48 | 26.63 | 7.98 | -6.84 | 12.15 |');
    expect(parseCatalogText(text).find((fund) => fund.ticker === 'COWZ')!.monthEnd).toEqual(byTicker('COWZ').monthEnd);
  });
});

describe('Pacer fund page parser', () => {
  const lines = toTextLines(stripProxyPreamble(FUND_PAGE_COWZ));

  test('Fund Details: labels lose footnote digits and asterisks, values keep their units', () => {
    const details = parseFundDetails(lines);
    expect(details.asOfDate).toBe('2026-09-30');
    expect(details.values.get('nav')).toBe('$66.77');
    expect(details.values.get('premium/discount')).toBe('-0.01');
    expect(details.values.get('30-day median bid/ask spread')).toBe('0.000143');
    expect(details.values.get('cusip#')).toBe('69374H881');
    expect(details.values.has('view historical premium/discount')).toBe(false);
  });

  test('full page summary (equity fund with SEC yield)', () => {
    const summary = parseProductPage(FUND_PAGE_COWZ, 'COWZ');
    expect(summary).toMatchObject({
      name: 'Pacer US Cash Cows 100 ETF',
      asOfDate: '2026-09-30',
      cusip: '69374H881',
      isin: 'US69374H8815',
      inception: '2016-12-16',
      nav: 66.77,
      marketPrice: 66.76,
      totalNetAssets: 18_588_141_764.67,
      totalExpenseRatio: 0.49,
      sharesOutstanding: 278_400_000,
      totalHoldings: 102,
      premiumDiscount: -0.01,
      medianBidAskSpread: 0.000143,
      secYield: 1.63,
    });
    expect(isinFromCusip(summary.cusip)).toBe(summary.isin);
  });

  test('recent performance reads YTD from the first (latest month-end) column group only', () => {
    const recent = parseRecentPerformance(lines);
    expect(recent.nav).toEqual({ asOfDate: '2026-09-30', mo1: null, mo3: null, ytd: 12.15, yr1: null, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: null });
    expect(recent.marketPrice?.ytd).toBe(12.16);
    expect(parseRecentPerformance(toTextLines('nothing'))).toEqual({ nav: null, marketPrice: null });
  });

  test('quarter-end performance maps only the tenors the fund has and skips index rows', () => {
    const quarter = parseQuarterPerformance(lines);
    expect(quarter.nav).toEqual({ asOfDate: '2026-06-30', mo1: null, mo3: null, ytd: 3.87, yr1: 15.13, cagr3y: 11.24, cagr5y: 9.87, cagr10y: null, siAnn: 12.3 });
    expect(quarter.marketPrice).toMatchObject({ ytd: 3.88, yr1: 15.21, siAnn: 12.26 });
    const withTen = toTextLines(['## Performance (%)', '(as of 06/30/2026)', '|  | Since Fund Inception (2/18/15) | YTD | 1 Year | 5 Year | 10 Year |', '| --- |', '| Pacer FLRT ETF NAV | 4.47 | 1.82 | 5.19 | 5.96 | 4.87 |'].join('\n'));
    expect(parseQuarterPerformance(withTen).nav).toMatchObject({ asOfDate: '2026-06-30', siAnn: 4.47, ytd: 1.82, yr1: 5.19, cagr3y: null, cagr5y: 5.96, cagr10y: 4.87 });
  });

  test('top 10 holdings: as-of date, rows, blank ticker and Total row', () => {
    const top = parseTopHoldings(lines);
    expect(top).toEqual({ asOfDate: '2026-10-01', rows: [{ ticker: 'QCOM', name: 'QUALCOMM Inc', weight: 2.32 }, { ticker: 'VLO', name: 'Valero Energy Corp', weight: 2.22 }], total: 4.54 });
    const blank = parseTopHoldings(toTextLines(['as of 10/01/2026', '| Ticker | Holding | Weight |', '| --- | --- | --- |', '|  | Cash & Other | 1.5 |', '| ABC | ABC Corp | 2.5 |', '|  | Total | 4 |'].join('\n')));
    expect(blank.rows).toEqual([{ ticker: '', name: 'Cash & Other', weight: 1.5 }, { ticker: 'ABC', name: 'ABC Corp', weight: 2.5 }]);
    expect(parseTopHoldings(toTextLines('no table'))).toEqual({ asOfDate: null, rows: [], total: null });
  });

  test('topHoldingRows: weights only, derived market values, bond identifiers never become tickers', () => {
    const rows = topHoldingRows(parseTopHoldings(toTextLines(FUND_PAGE_BOND_TOP10)), 1_000_000);
    expect(rows[0]).toEqual({ Name: 'U.S. Bank Money Market Deposit Account 06/01/2031', Ticker: '-', Identifier: 'USBFS03', Weight: '18.59', 'Market Value': '185900', 'Shares Held': '-', 'Asset Category': '-' });
    expect(rows[1].Ticker).toBe('-');
    expect(rows[1].Identifier).toBe('LX267472');
    const equities = topHoldingRows(parseTopHoldings(lines), null);
    expect(equities[0]).toMatchObject({ Ticker: 'QCOM', Identifier: 'QCOM', 'Market Value': '-' });
    expect(topHoldingRows({ asOfDate: null, rows: [{ ticker: 'BRK.B', name: 'Berkshire', weight: 1 }], total: null }, 100)[0].Ticker).toBe('BRK.B');
  });

  test('distributions: Total Distributions per share, ascending by ex-date, zero rows dropped', () => {
    const rows = parseDistributionsTable(lines);
    expect(rows.length).toBe(3);
    expect(rows[0]).toEqual({ epoch: Date.UTC(2026, 2, 5) / 1000, amount: 0.20027 });
    expect(rows[2]).toEqual({ epoch: Date.UTC(2026, 8, 3) / 1000, amount: 0.431373 });
    expect(rows.every((row, index) => index === 0 || row.epoch > rows[index - 1].epoch)).toBe(true);
    expect(parseDistributionsTable(toTextLines('nothing'))).toEqual([]);
    const zero = toTextLines(['| Ex Date | Record Date | Pay Date | Total Distributions |', '| --- |', '| 9/3/2026 | 9/3/2026 | 9/8/2026 | $0 |', '| 6/4/2026 | 6/4/2026 | 6/8/2026 | $0.5 |'].join('\n'));
    expect(parseDistributionsTable(zero).map((row) => row.amount)).toEqual([0.5]);
  });

  test('Structured Outcome page without a Fund Details heading or distributions', () => {
    const summary = parseProductPage(FUND_PAGE_SOS, 'PSFF');
    expect(summary).toMatchObject({ asOfDate: '2026-09-30', cusip: '69374H568', isin: 'US69374H5688', nav: 35.12, marketPrice: 35.11, totalNetAssets: 611_921_840.4, totalExpenseRatio: 0.66, totalHoldings: 14, premiumDiscount: -0.02, secYield: null });
    expect(summary.distributions).toEqual([]);
    expect(summary.officialReturns.quarterEnd.nav).toMatchObject({ asOfDate: '2026-06-30', ytd: 6.17, siAnn: 10.02 });
    expect(summary.officialReturns.monthEnd.nav?.ytd).toBe(8.82);
  });

  test('parseFundName reads the second heading and ignores pages without it', () => {
    expect(parseFundName('## COWZ\n\n## Pacer US Cash Cows 100 ETF\n', 'COWZ')).toBe('Pacer US Cash Cows 100 ETF');
    expect(parseFundName('## TRND\n\n## Pacer Trendpilot® Fund of Funds ETF\n', 'TRND')).toBe('Pacer Trendpilot® Fund of Funds ETF');
    expect(parseFundName('#### PSFF\n\n### as of 09/30/2026', 'PSFF')).toBeNull();
  });

  test('an error or empty page yields an empty summary, not a throw', () => {
    const empty = parseProductPage('<html><body>Access denied</body></html>', 'COWZ');
    expect(empty).toMatchObject({ name: null, asOfDate: null, nav: null, totalNetAssets: null, totalExpenseRatio: null });
    expect(empty.distributions).toEqual([]);
    expect(empty.topHoldings.rows).toEqual([]);
    expect(empty.officialReturns.quarterEnd).toEqual({ nav: null, marketPrice: null });
  });

  test('holdingsFallback keeps a published full schedule over the partial top 10 and never drops data', () => {
    expect(holdingsFallback(102, 10)).toBe('previous');
    expect(holdingsFallback(10, 10)).toBe('top10'); // a previous top 10 is refreshed by the new one
    expect(holdingsFallback(5, 0)).toBe('previous');
    expect(holdingsFallback(0, 10)).toBe('top10');
    expect(holdingsFallback(3, 10)).toBe('top10');
    expect(holdingsFallback(0, 0)).toBe('none');
  });

  test('mergeOfficialReturns prefers official values but keeps the derived QTD', () => {
    const derived = { asOfDate: '2026-09-17', mo1: 1, qtd: 2, ytd: 3, yr1: 4, cagr3y: 5, cagr5y: 6, cagr10y: 7, siAnn: 8 };
    const official = { asOfDate: '2026-09-30', mo1: -6.84, mo3: 7.98, ytd: 12.15, yr1: 26.63, cagr3y: 14.48, cagr5y: 12.02, cagr10y: null, siAnn: 13.79 };
    expect(mergeOfficialReturns(derived, official)).toEqual({ asOfDate: '2026-09-30', mo1: -6.84, qtd: 2, ytd: 12.15, yr1: 26.63, cagr3y: 14.48, cagr5y: 12.02, cagr10y: 7, siAnn: 13.79 });
    expect(mergeOfficialReturns(derived, null)).toBe(derived);
  });
});

describe('distribution frequency', () => {
  const day = 86_400;
  const at = (iso: string) => ({ epoch: Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 1000, amount: 0.1 });

  test('monthly payers with a December special stay Monthly (median gap)', () => {
    const dividends = ['2025-08-01', '2025-09-02', '2025-10-01', '2025-11-03', '2025-12-01', '2025-12-19', '2026-02-02', '2026-03-02', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-03', '2026-09-01'].map(at);
    expect(inferDistributionFrequency(dividends)).toEqual({ frequency: 'Monthly', paymentsPerYear: 12 });
  });

  test('quarterly, semi-annual, annual, irregular, unknown and none', () => {
    expect(inferDistributionFrequency(['2025-03-26', '2025-06-25', '2025-09-24', '2025-12-10', '2026-03-25', '2026-06-24'].map(at))).toEqual({ frequency: 'Quarterly', paymentsPerYear: 4 });
    expect(inferDistributionFrequency(['2024-06-20', '2024-12-18', '2025-06-24', '2025-12-17', '2026-06-23'].map(at))).toEqual({ frequency: 'Semi-Annual', paymentsPerYear: 2 });
    expect(inferDistributionFrequency(['2023-12-20', '2024-12-18', '2025-12-17'].map(at))).toEqual({ frequency: 'Annual', paymentsPerYear: 1 });
    expect(inferDistributionFrequency([{ epoch: 0, amount: 1 }, { epoch: 900 * day, amount: 1 }])).toEqual({ frequency: 'Irregular', paymentsPerYear: null });
    expect(inferDistributionFrequency([{ epoch: 0, amount: 1 }])).toEqual({ frequency: 'Unknown', paymentsPerYear: null });
    expect(inferDistributionFrequency([])).toEqual({ frequency: 'None', paymentsPerYear: null });
  });

  test('frequencyCodeLabel mirrors the client formatter', () => {
    expect(frequencyCodeLabel('Monthly')).toBe('01 - Monthly');
    expect(frequencyCodeLabel('Quarterly')).toBe('04 - Quarterly');
    expect(frequencyCodeLabel('Semi-Annual')).toBe('06 - Semi-annually');
    expect(frequencyCodeLabel('Annual')).toBe('12 - Annually');
    expect(frequencyCodeLabel('Irregular')).toBe('99 - Irregular');
    expect(frequencyCodeLabel('None')).toBe('00 - None');
    expect(frequencyCodeLabel('Unknown')).toBe('00 - Unknown');
    expect(frequencyCodeLabel('—')).toBe('00 - None');
    expect(frequencyCodeLabel('')).toBe('00 - None');
  });
});

describe('Yahoo chart', () => {
  const payload = {
    chart: {
      result: [{
        meta: { exchangeName: 'PCX', regularMarketPrice: 33.7, regularMarketTime: 1_789_000_000, firstTradeDate: 1_319_000_000 },
        timestamp: [1_600_000_000, 1_600_086_400, 1_600_172_800],
        indicators: { quote: [{ close: [10, null, 12], volume: [100, 200, 300] }], adjclose: [{ adjclose: [9, null, 11.5] }] },
        events: { dividends: { '1600086400': { amount: 0.25, date: 1_600_086_400 } } },
      }],
    },
  };

  test('parseChart drops null closes and sorts dividends', () => {
    const chart = parseChart(payload);
    expect(chart.days.length).toBe(2);
    expect(chart.days[0]).toEqual({ date: '2020-09-13', close: 10, adjClose: 9, volume: 100 });
    expect(chart.dividends).toEqual([{ epoch: 1_600_086_400, amount: 0.25 }]);
    expect(chart.exchangeName).toBe('PCX');
    expect(() => parseChart({})).toThrow(/no result/);
  });

  test('priceReturns computes YTD and 1Y from adjusted closes', () => {
    const days = [
      { date: '2025-09-10', close: 100, adjClose: 100, volume: 0 },
      { date: '2025-12-31', close: 110, adjClose: 110, volume: 0 },
      { date: '2026-06-30', close: 115, adjClose: 115, volume: 0 },
      { date: '2026-09-17', close: 121, adjClose: 121, volume: 0 },
    ];
    const returns = priceReturns(days);
    expect(returns.asOfDate).toBe('2026-09-17');
    expect(returns.ytd).toBe(10);
    expect(returns.qtd).toBe(5.22);
    expect(returns.yr1).toBe(21);
    expect(returns.cagr3y).toBeNull();
  });
});

describe('SEC EDGAR fallback', () => {
  test('parseFundTickerMap maps tickers to series refs', () => {
    const map = parseFundTickerMap({ fields: ['cik', 'seriesId', 'classId', 'symbol'], data: [[1616668, 'S000034073', 'C000104937', 'COWZ'], [1616668, 'S000027575', 'C000083337', 'QQQG']] });
    expect(map.get('COWZ')).toEqual({ cik: '0001616668', seriesId: 'S000034073', classId: 'C000104937' });
    expect(map.size).toBe(2);
  });

  test('parseEdgarAtomFilings keeps only original NPORT-P filings', () => {
    const atom = `<feed><entry><content><accession-number>0001752724-26-000001</accession-number><filing-date>2026-08-27</filing-date><filing-type>NPORT-P</filing-type><filing-href>https://www.sec.gov/Archives/edgar/data/1616668/000175272426000001/0001752724-26-000001-index.htm</filing-href><period>2026-06-30</period></content></entry><entry><content><accession-number>0001752724-26-000002</accession-number><filing-type>NPORT-P/A</filing-type></content></entry></feed>`;
    const filings = parseEdgarAtomFilings(atom);
    expect(filings.length).toBe(1);
    expect(filings[0].url).toBe('https://www.sec.gov/Archives/edgar/data/1616668/000175272426000001/0001752724-26-000001.txt');
    expect(nportUrlFor('0001616668', '0001752724-26-000001')).toBe(filings[0].url);
  });

  test('parseNport reads holdings, debt attributes and net assets', () => {
    const xml = `<edgarSubmission><genInfo><regName>Pacer Funds Trust</regName><regCik>0001616668</regCik><seriesName>Pacer US Cash Cows 100 ETF</seriesName><seriesId>S000034073</seriesId><repPdDate>2026-06-30</repPdDate></genInfo><fundInfo><netAssets>112770927091.11</netAssets></fundInfo>
<invstOrSecs><invstOrSec><name>MERCK &amp; CO INC</name><cusip>58933Y105</cusip><balance>37710468</balance><valUSD>5541249108.24</valUSD><pctVal>4.91</pctVal><assetCat>EC</assetCat></invstOrSec>
<invstOrSec><name>UNITED STATES TREASURY NOTE</name><cusip>91282CJL6</cusip><balance>1000000</balance><valUSD>990000</valUSD><pctVal>0.5</pctVal><assetCat>DBT</assetCat><debtSec><maturityDt>2028-01-31</maturityDt><annualizedRt>3.5</annualizedRt></debtSec></invstOrSec></invstOrSecs></edgarSubmission>`;
    const parsed = parseNport(xml);
    expect(parsed.seriesId).toBe('S000034073');
    expect(parsed.repPdDate).toBe('2026-06-30');
    expect(parsed.netAssets).toBe(112_770_927_091.11);
    expect(parsed.holdings.length).toBe(2);
    expect(parsed.holdings[0]).toEqual({ Name: 'MERCK & CO INC', Ticker: '-', Identifier: '58933Y105', Weight: '4.91', 'Market Value': '5541249108.24', 'Shares Held': '37710468', 'Asset Category': 'EC' });
    expect(parsed.holdings[1].Coupon).toBe('3.5');
    expect(parsed.holdings[1].Maturity).toBe('2028-01-31');
  });

  test('name normalization helpers', () => {
    expect(normalizeHoldingName('Merck & Co., Inc.')).toBe('MERCK AND');
    expect(normalizeHoldingName('Alphabet Inc. Class A')).toBe('ALPHABET CL A');
    expect(cleanHoldingTicker(' n/a ')).toBe('');
    expect(cleanHoldingTicker('brk.b')).toBe('BRK.B');
  });
});


import { test as frequencyLabelTest, expect as frequencyLabelExpect } from 'bun:test';
frequencyLabelTest('Frequency placeholders display None and existing cadence labels stay unchanged', async () => {
  const text = await Bun.file(new URL('../app.tsx', import.meta.url)).text();
  const start = /^([ \t]*)function (formatDividendFrequency|formatDistributionFrequency)\(/m.exec(text);
  frequencyLabelExpect(start).not.toBeNull();
  const tail = text.slice(start!.index);
  const end = new RegExp('^' + start![1] + '\u007d', 'm').exec(tail);
  frequencyLabelExpect(end).not.toBeNull();
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(tail.slice(0, end!.index + end![0].length));
  const format = new Function(js + '; return ' + start![2] + ';')();
  for (const value of [null, undefined, '', '  ', '-', '‐', '‑', '‒', '–', '—', ' — ']) {
    frequencyLabelExpect(format(value)).toBe('00 - None');
  }
  for (const [input, expected] of [
    ['None', '00 - None'], ['Unknown', '00 - Unknown'], ['Monthly', '01 - Monthly'],
    ['Quarterly', '04 - Quarterly'], ['Semi-annually', '06 - Semi-annually'],
    ['Annually', '12 - Annually'], ['Irregular', '99 - Irregular'],
  ]) frequencyLabelExpect(format(input)).toBe(expected);
});


import { test as queueTest, describe as queueDescribe, expect as queueExpect } from 'bun:test';

async function tickerChainHarness() {
 const app=await Bun.file(new URL('../app.tsx',import.meta.url)).text();
 const source=app.match(/^function withTickerChain<T>\([\s\S]*?^\}/m)?.[0];
 queueExpect(source).toBeDefined();
 const javascript=new Bun.Transpiler({loader:'ts'}).transformSync(source!);
 const chains=new Map<string,Promise<void>>();
 const enqueue=new Function('holdingsChains',`${javascript}; return withTickerChain;`)(chains) as
  <T>(ticker:string,fn:()=>Promise<T>)=>Promise<T>;
 return {chains,enqueue};
}

queueDescribe('per-ticker queue preserves caller results and stores completion-only promises',()=>{
 queueTest('successful generic result reaches caller, not the internal queue',async()=>{
  const {chains,enqueue}=await tickerChainHarness();
  const value={rows:[['AGEM']]};
  queueExpect(await enqueue('AGEM',async()=>value)).toBe(value);
  queueExpect(await chains.get('AGEM')).toBeUndefined();
 });
 queueTest('rejection reaches caller without poisoning the next queued task',async()=>{
  const {chains,enqueue}=await tickerChainHarness();
  const error=new Error('page failed');
  const work=enqueue('AGEM',async()=>{throw error;});
  const observed=work.catch(reason=>reason);
  const settled=chains.get('AGEM');
  const next=enqueue('AGEM',async()=>42);
  queueExpect(await observed).toBe(error);
  queueExpect(await settled).toBeUndefined();
  queueExpect(await next).toBe(42);
  queueExpect(await chains.get('AGEM')).toBeUndefined();
 });
 queueTest('synchronous callback throws also leave the queue usable',async()=>{
  const {chains,enqueue}=await tickerChainHarness();
  const error=new Error('synchronous failure');
  queueExpect(await enqueue('AGEM',()=>{throw error;}).catch(reason=>reason)).toBe(error);
  queueExpect(await chains.get('AGEM')).toBeUndefined();
  queueExpect(await enqueue('AGEM',async()=>'recovered')).toBe('recovered');
 });
 queueTest('same-ticker work stays serial while other tickers run independently',async()=>{
  const {chains,enqueue}=await tickerChainHarness();
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const events:string[]=[];
  const first=enqueue('AGEM',async()=>{events.push('first');await gate;events.push('done');return 1;});
  const second=enqueue('AGEM',async()=>{events.push('second');return 2;});
  try {
   queueExpect(await enqueue('SGOL',async()=>3)).toBe(3);
   queueExpect(events).toEqual(['first']);
  } finally { release(); }
  queueExpect(await Promise.all([first,second])).toEqual([1,2]);
  queueExpect(events).toEqual(['first','done','second']);
  queueExpect(await chains.get('AGEM')).toBeUndefined();
  queueExpect(await chains.get('SGOL')).toBeUndefined();
 });
});


import { test as headerTest, expect as headerExpect } from 'bun:test';
async function headerSummaryHarness() {
  const source = await Bun.file(new URL('../app.tsx', import.meta.url)).text();
  const match = /^([ \t]*)function renderHeaderSummary\(/m.exec(source);
  headerExpect(match).not.toBeNull();
  const tail = source.slice(match!.index);
  const end = new RegExp('^' + match![1] + '}', 'm').exec(tail)!;
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(tail.slice(0, end.index + end[0].length));
  const makeNode = (text = ''): any => {
    const node: any = { textContent: text, childNodes: [], dataset: {}, listeners: {} };
    node.replaceChildren = (...children: any[]) => { node.childNodes = children; };
    node.append = (...children: any[]) => { node.childNodes.push(...children); };
    node.addEventListener = (name: string, listener: any) => { node.listeners[name] = listener; };
    return node;
  };
  const panel = makeNode(), subtitle = makeNode(), details = makeNode('Data: source link and updated timestamp');
  subtitle.append(details);
  const document = { getElementById: () => panel, createTextNode: makeNode, createElement: () => makeNode() };
  const render = new Function('document', js + '; return renderHeaderSummary;')(document);
  const text = () => subtitle.childNodes.map((n: any) => n.textContent).join('');
  return { render, panel, subtitle, details, makeNode, text };
}
headerTest('header has no visible subtitle without selection; original details nodes are retained', async () => {
  const h = await headerSummaryHarness();
  h.render(h.subtitle, new Set(), null, () => {});
  headerExpect(h.text()).toBe('');
  headerExpect(h.panel.childNodes).toEqual([h.details]);
  headerExpect(h.panel.childNodes[0]).toBe(h.details);
});
headerTest('header shows sorted selected tickers only, preserving click activation and highlight', async () => {
  const h = await headerSummaryHarness(); const activated: string[] = [];
  h.render(h.subtitle, new Set(['ZZZ', 'AAA']), 'AAA', (ticker: string) => activated.push(ticker));
  headerExpect(h.text()).toBe('2 selected: AAA, ZZZ');
  const links = h.subtitle.childNodes.filter((n: any) => n.dataset.headerFund);
  headerExpect(links[0].className).toContain('underline');
  links[1].listeners.click({ preventDefault() {} });
  headerExpect(activated).toEqual(['ZZZ']);
  headerExpect(h.panel.childNodes[0]).toBe(h.details);
});
headerTest('all selected still lists tickers; clear replaces both summary and selection', async () => {
  const h = await headerSummaryHarness();
  h.render(h.subtitle, new Set(['CCC','AAA','BBB']), 'BBB', () => {});
  headerExpect(h.text()).toBe('3 selected: AAA, BBB, CCC');
  const next = h.makeNode('Fresh detail context'); h.subtitle.replaceChildren(next);
  h.render(h.subtitle, new Set(), null, () => {});
  headerExpect(h.text()).toBe(''); headerExpect(h.panel.childNodes).toEqual([next]);
});
headerTest('header markup supplies a focusable counter and hidden rich panel with dismissal', async () => {
  const html = await Bun.file(new URL('../index.html', import.meta.url)).text();
  headerExpect(html).toMatch(/<button[^>]*aria-controls="app-summary"[^>]*id="ticker-count"/);
  headerExpect(html).toContain('id="app-summary" role="region" aria-label="ETF catalog information" hidden');
  headerExpect(html).toContain("event.key !== 'Escape'");
  headerExpect(html).toContain("trigger.addEventListener('focus', show)");
  headerExpect(html).toContain("trigger.addEventListener('pointerenter'");
});


describe('HISTORY_RANGE window', () => {
  test('max (and non-year tokens) start at epoch 0; Ny starts N years back', () => {
    const now = Date.UTC(2026, 9, 1, 12);
    expect(historyPeriodStart('max', now)).toBe(0);
    expect(historyPeriodStart('', now)).toBe(0);
    expect(historyPeriodStart('6mo', now)).toBe(0);
    expect(historyPeriodStart('5y', now)).toBe(Math.floor(now / 1000 - 5 * 365.25 * 86_400));
    expect(historyPeriodStart(' 10Y ', now)).toBe(Math.floor(now / 1000 - 10 * 365.25 * 86_400));
    expect(historyPeriodStart('1y', now)).toBeLessThan(now / 1000);
  });
});

describe('return range defaults', () => {
  test('colon-only values do not create active return filters', () => {
    expect(parseRanges({ PERFORMANCE_YTD: ':', PERFORMANCE_1Y: ':', TOTAL_RETURN_1Y: ':' }, 'PERFORMANCE')).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Write-if-changed contract: run timestamps never count as a content change.
// ---------------------------------------------------------------------------

describe('samePublishedContent', () => {
  test('ignores the run timestamps when comparing published content', () => {
    expect(samePublishedContent('{"a":1,"generatedAt":"x"}', { a: 1, generatedAt: 'y' })).toBe(true);
    expect(samePublishedContent('{"cursor":null,"savedAt":"x"}', { cursor: null, savedAt: 'y' })).toBe(true);
  });

  test('detects real differences and unreadable previous files', () => {
    expect(samePublishedContent('{"a":1}', { a: 2 })).toBe(false);
    expect(samePublishedContent('{"a":1,"generatedAt":"x"}', { a: 1, b: 2, generatedAt: 'x' })).toBe(false);
    expect(samePublishedContent('not json', {})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Offline parity tests for the shared updater controls: the config file,
// CONTROL_NAMES, the README controls table, --help and the workflow
// stay in sync with each other. No network access and no api/pacer writes.
// ---------------------------------------------------------------------------

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const file = (): Record<string, string> => JSON.parse(read('scripts/update-data.config.json'));

test('configuration precedence: file < advanced < nonblank input < environment', () => {
  const c = resolveControls({ CONCURRENCY: 2, TICKERS: 'COWZ' }, { CONCURRENCY: 3, TICKERS: 'PTLC' }, { CONCURRENCY: '4', TICKERS: '' }, { CONCURRENCY: '5' });
  expect(c.CONCURRENCY).toBe('5');
  expect(c.TICKERS).toBe('PTLC');
  expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }, { CONCURRENCY: '4' }).CONCURRENCY).toBe('4');
  expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }).CONCURRENCY).toBe('3');
  expect(resolveControls({ SKIP_YAHOO: true }, {}, {}, { SKIP_YAHOO: 'false' }).SKIP_YAHOO).toBe('false');
  expect(resolveControls({ AUM: '1B:' }, {}, {}, { UNRELATED: 'x', PATH: '/bin' }).AUM).toBe('1B:');
});

test('blank input inherits the file value; advanced may deliberately blank a key', () => {
  expect(resolveControls({ TICKERS: 'COWZ' }, {}, { TICKERS: '' }).TICKERS).toBe('COWZ');
  expect(resolveControls({ TICKERS: 'COWZ' }, { TICKERS: '' }, { TICKERS: '' }).TICKERS).toBe('');
  expect(resolveControls({ CONCURRENCY: 2 }, {}, { CONCURRENCY: '' }).CONCURRENCY).toBe('2');
  expect(readConfig(resolveControls({ MAX_RETRIES: 1 })).maxRetries).toBe(1);
  expect(() => resolveControls({}, {}, {}, { MAX_RETRIES: '0' })).toThrow();
  expect(resolveControls({ TICKERS: 'COWZ' }, {}, {}, { TICKERS: '' }).TICKERS).toBe('');
});

test('USE_SYSTEM_CA is validated and defaults to auto', () => {
  expect(file().USE_SYSTEM_CA).toBe('auto');
  for (const v of ['auto', 'true', 'false', 'AUTO', 'True', 'FALSE']) expect(resolveControls(file(), {}, {}, { USE_SYSTEM_CA: v }).USE_SYSTEM_CA).toBe(v);
  expect(() => resolveControls(file(), {}, {}, { USE_SYSTEM_CA: 'maybe' })).toThrow();
  expect(() => resolveControls({ USE_SYSTEM_CA: 'maybe' })).toThrow();
});

test('isCertError recognises untrusted-certificate errors only', () => {
  expect(isCertError({ code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' })).toBe(true);
  expect(isCertError(new Error('unable to get local issuer certificate'))).toBe(true);
  expect(isCertError(Object.assign(new Error('fetch failed'), { cause: new Error('unable to get local issuer certificate') }))).toBe(true);
  expect(isCertError({ code: 'ECONNRESET', message: 'socket hang up' })).toBe(false);
  expect(isCertError(new Error('HTTP 403 Forbidden'))).toBe(false);
  expect(isCertError(null)).toBe(false);
});

describe('installSystemCa', () => {
  const original = globalThis.fetch;
  const restore = () => { globalThis.fetch = original; };
  const reexecCounter = () => { const calls = { n: 0 }; const reexec = (() => { calls.n += 1; return undefined as never; }) as () => never; return { calls, reexec }; };

  test('false and active leave fetch unchanged', () => {
    try {
      const { calls, reexec } = reexecCounter();
      installSystemCa('false', reexec, false);
      expect(globalThis.fetch).toBe(original);
      installSystemCa('auto', reexec, true);
      installSystemCa('true', reexec, true);
      expect(globalThis.fetch).toBe(original);
      expect(calls.n).toBe(0);
    } finally { restore(); }
  });

  test('true restarts immediately', () => {
    try {
      const { calls, reexec } = reexecCounter();
      installSystemCa('true', reexec, false);
      expect(calls.n).toBe(1);
    } finally { restore(); }
  });

  test('auto wraps fetch: cert error restarts once, other errors rethrow, success passes through', async () => {
    try {
      const { calls, reexec } = reexecCounter();
      let behavior: 'cert' | 'reset' | 'ok' = 'cert';
      globalThis.fetch = (async () => {
        if (behavior === 'cert') throw Object.assign(new Error('fetch failed'), { cause: { code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' } });
        if (behavior === 'reset') throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
        return new Response('ok');
      }) as typeof fetch;
      installSystemCa('auto', reexec, false);
      expect(globalThis.fetch).not.toBe(original);
      const errors = console.error;
      console.error = () => {};
      try { await globalThis.fetch('https://example.invalid/'); } finally { console.error = errors; }
      expect(calls.n).toBe(1);
      behavior = 'reset';
      await expect(globalThis.fetch('https://example.invalid/')).rejects.toThrow('socket hang up');
      expect(calls.n).toBe(1);
      behavior = 'ok';
      expect(await (await globalThis.fetch('https://example.invalid/')).text()).toBe('ok');
      expect(calls.n).toBe(1);
    } finally { restore(); }
  });
});

test('scheduled path (empty inputs and advanced) equals the config defaults', () => {
  const defaults = file();
  const scheduled = resolveControls(defaults, JSON.parse('{}'), {}, {});
  expect(scheduled).toEqual(Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, String(v)])));
});

test('resolver rejects unknown keys, invalid values, non-scalars and newline injection', () => {
  const invalid: unknown[] = [
    { UNKNOWN: 1 }, { SEC_UA: 'x\nEVIL=yes' }, { CONCURRENCY: 0 }, { MAX_RETRIES: 0 }, { MAX_RETRIES: -1 }, { HISTORY_RANGE: 'forever' }, { SEC_YIELD: '5:1' }, { MAX_FETCHES: 1.5 },
    { REQUEST_SLEEP: '-1' }, { VERBOSE: 'maybe' }, { EDGAR_FALLBACK: 'maybe' }, { AUM: '1:2:3' }, { TER: '5:1' },
    { PERFORMANCE_1Y: 'a:b' }, { TICKERS: ['COWZ'] }, { TICKERS: { a: 1 } }, null, [],
  ];
  for (const value of invalid) expect(() => resolveControls(value)).toThrow();
  expect(() => resolveControls({}, { SEC_UA: 'x\rfoo' })).toThrow();
  expect(() => resolveControls({}, {}, { TICKERS: 'A\nB' })).toThrow();
  expect(() => resolveControls({}, {}, {}, { SEC_UA: 'x\0bad' })).toThrow();
  expect(() => resolveControls({}, 'not an object')).toThrow();
});

test('Pacer-specific default values (WAF-conservative pacing)', () => {
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
  expect(config.performance).toEqual({});
  expect(config.totalReturn).toEqual({});
  expect(file().SEC_UA).toBe('daggerok ETF feed daggerok@gmail.com');
  expect(config.secUa).toBe('daggerok ETF feed daggerok@gmail.com');
  expect(readConfig({}).secUa).toBe('daggerok ETF feed daggerok@gmail.com');
  expect(config.secYield).toBeUndefined();
  expect(readConfig(resolveControls(file(), {}, {}, { SEC_YIELD: '3:' })).secYield).toEqual({ min: 3, max: undefined });
  expect(readConfig(resolveControls(file(), { SEC_UA: 'My Feed me@example.org' })).secUa).toBe('My Feed me@example.org');
});

test('CONCURRENCY=15 really fetches in parallel (in-flight counter), CONCURRENCY=1 stays sequential', async () => {
  const realFetch = globalThis.fetch;
  const run = async (concurrency: number): Promise<number> => {
    let inFlight = 0;
    let peak = 0;
    globalThis.fetch = (async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return new Response('ok');
    }) as unknown as typeof fetch;
    try {
      const config = readConfig(resolveControls(file(), {}, {}, { REQUEST_SLEEP: '0', CONCURRENCY: String(concurrency) }));
      configurePacing(config.requestSleep, config.concurrency);
      const queue = Array.from({ length: 30 }, (_, i) => `https://example.test/${i}`);
      await runWorkers(config.concurrency, async () => {
        for (let url = queue.shift(); url; url = queue.shift()) await fetchText(url, 'test', config);
      });
      return peak;
    } finally {
      globalThis.fetch = realFetch;
    }
  };
  expect(await run(15)).toBe(15);
  expect(await run(1)).toBe(1);
});

test('SEC_UA is redacted in config logs', () => {
  const source = read('scripts/update-data.ts');
  expect(source).toMatch(/TOKEN\|PASSWORD\|SECRET\|COOKIE\|SEC_UA/);
  expect(source).not.toMatch(/example\.com/);
});

test('runtimeControls reads the config file and lets env override it', async () => {
  expect((await runtimeControls({})).REQUEST_SLEEP).toBe('2.5');
  expect((await runtimeControls({ REQUEST_SLEEP: '0', TICKERS: 'COWZ CALF' })).TICKERS).toBe('COWZ CALF');
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
  expect(names.length).toBeLessThanOrEqual(25); // GitHub Actions hard limit
  expect(names).toContain('advanced');
  expect(block).toMatch(/advanced:[\s\S]*default: '\{\}'/);
  for (const name of names.filter((n) => n !== 'advanced')) expect(CONTROL_NAMES).toContain(name.toUpperCase() as never);
  // SEC_UA stays out of the inputs: the protected Actions variable carries it.
  expect(names).not.toContain('sec_ua');
  expect(yml).toContain('timeout-minutes: 30');
  expect(yml).toContain('persist-credentials: false');
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

test('README keeps the standard structure and the 29-brand shared tables', () => {
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
  expect(doc).not.toMatch(/pending/i);
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
  expect(brands).toHaveLength(29);
  expect(siblings).toEqual(brands);
  expect(brands).toEqual(sorted(brands));
  expect(brands).toContain('Pacer ETFs');
  expect(doc).toContain('Pacer Funds Trust');
  expect(doc).toContain('CIK 0001616668');
  for (const example of doc.match(/^[A-Z_]+="?[^\s"]*"? \.\/scripts\/update-data\.ts$/gm) ?? []) {
    expect(CONTROL_NAMES).toContain(example.split('=')[0] as never);
  }
});

test('updater is fixed to api/pacer and keeps the reference types line first', () => {
  const source = read('scripts/update-data.ts');
  expect(source).toContain("new URL('../api/pacer/', import.meta.url)");
  expect(source.split('\n').slice(0, 4).join('\n')).toContain('/// <reference types="bun" />');
  expect(source).not.toMatch(/OUTPUT_DIR/);
});
