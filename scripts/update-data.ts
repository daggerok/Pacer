#!/usr/bin/env bun
/// <reference types="bun" />
import { readFile as outputReadFile, readdir as outputReadDir } from 'node:fs/promises';
import { createHash as outputCreateHash } from 'node:crypto';
import { join as outputJoin } from 'node:path';
import { fileURLToPath as outputFileURLToPath } from 'node:url';
import { appendFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';

declare const process: {
  env: Record<string, string | undefined>;
  argv: string[];
  exitCode?: number;
};

type JsonRecord = Record<string, any>;
type Range = { min?: number; max?: number };
type ReturnPeriod = 'YTD' | '1Y' | '3Y' | '5Y' | '10Y';
type RangeMap = Partial<Record<ReturnPeriod, Range>>;

// Console presentation; no changes to provider requests or persisted data.
/** Presentation only: no requests, writes, filtering, or changes to updater state. */

const outputClean = (value: unknown): string => String(value ?? 'null').replace(/[\r\n\t]+/g, ' ');
/** Presentation only: per-fund retry and fallback notices are printed when VERBOSE is enabled. */
const outputVerbose = (): boolean => /^(1|true|yes|on)$/i.test((globalThis as any).process?.env?.VERBOSE ?? '');
function outputNote(message: string): void { if (outputVerbose()) console.warn(message); }
/** Names are the canonical environment knobs, not internal parser properties. */
function outputConfigEntries(config: Record<string, any>): [string, string][] {
  const values = new Map<string, string>();
  const aliases: Record<string, string> = {
    requestSleepSeconds: 'REQUEST_SLEEP', categories: 'CATEGORY',
    aumRange: 'AUM', terRange: 'TER', dividendYieldRange: 'DIVIDEND_YIELD', secYieldRange: 'SEC_YIELD',
    performanceRanges: 'PERFORMANCE', totalReturnRanges: 'TOTAL_RETURN',
    skipPacer: 'SKIP_PACER', skipYahoo: 'SKIP_YAHOO',
  };
  const range = (v: any): string => v?.source ?? `${Number.isFinite(v?.min) ? v.min : ''}:${Number.isFinite(v?.max) ? v.max : ''}`;
  for (const [key, value] of Object.entries(config)) {
    const name = aliases[key] ?? key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
    if (name === 'PERFORMANCE' || name === 'TOTAL_RETURN') {
      for (const period of ['YTD', '1Y', '3Y', '5Y', '10Y']) values.set(`${name}_${period}`, range(value?.[period]));
    } else if (['AUM', 'TER', 'DIVIDEND_YIELD', 'SEC_YIELD'].includes(name)) {
      values.set(name, range(value));
    } else {
      values.set(name, value instanceof Set ? [...value].join(',') || 'all' : Array.isArray(value) ? value.join(',') || 'all' : outputClean(value));
    }
  }
  const first = ['MAX_FETCHES', 'REQUEST_SLEEP', 'CONCURRENCY'];
  return [...values].sort(([a], [b]) => {
    const ai = first.indexOf(a), bi = first.indexOf(b);
    return (ai < 0 ? first.length : ai) - (bi < 0 ? first.length : bi) || a.localeCompare(b);
  });
}
function outputPrintConfig(brand: string, config: Record<string, any>): void {
  const entries: [string, string][] = [...outputConfigEntries(config), ['VERBOSE', String(outputVerbose())]];
  console.log(`[ config   ] ${brand} updater:\n${entries.map(([key, value]) => `              ${key}=${/TOKEN|PASSWORD|SECRET|COOKIE|^SEC_UA$/i.test(key) ? '<redacted>' : outputClean(value)}`).join('\n')}`);
}
function outputHasOutputFilters(config: Record<string, any>): boolean {
  return outputConfigEntries(config).some(([name, value]) =>
    /^(TICKERS|CATEGORY|AUM|TER|DIVIDEND_YIELD|SEC_YIELD|PERFORMANCE_|TOTAL_RETURN_)/.test(name) &&
    !['', ':', 'null', 'all'].includes(value));
}
function outputPrintFilter(selected: number, total: number, deferred = false): void {
  console.log(`[ filter   ] ${selected} of ${total} funds ${deferred ? 'selected for evaluation (data-dependent filters applied per fund)' : 'pass filters'}`);
}
function outputStable(value: any): any {
  if (Array.isArray(value)) return value.map(outputStable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => !['generatedAt', 'catalogReadAt'].includes(key)).map(key => [key, outputStable(value[key])]));
  return value;
}
function outputContentKey(value: unknown): string { return JSON.stringify(outputStable(value)) ?? 'null'; }
async function outputInspectFund(root: URL | string, ticker: string): Promise<{ digest: string; meta: any }> {
  const dir = outputJoin(root instanceof URL ? outputFileURLToPath(root) : root, 'funds', ticker);
  const hash = outputCreateHash('sha256');
  async function visit(path: string): Promise<void> {
    const entries = await outputReadDir(path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) await visit(outputJoin(path, entry.name));
      else if (entry.name.endsWith('.json')) {
        const text = await outputReadFile(outputJoin(path, entry.name), 'utf8').catch(() => '');
        hash.update(outputJoin(path.slice(dir.length), entry.name));
        try { hash.update(outputContentKey(JSON.parse(text))); } catch { hash.update(text); }
      }
    }
  }
  await visit(dir);
  const meta = await outputReadFile(outputJoin(dir, 'meta.json'), 'utf8').then(JSON.parse).catch(() => ({}));
  return { digest: hash.digest('hex'), meta };
}
const outputCount = (value: any): unknown => typeof value === 'number' ? value : Array.isArray(value) ? value.length : value?.totalRows ?? value?.rows?.length ?? null;
const outputScalar = (value: any): any => value && typeof value === 'object' ? value.display ?? value.value ?? null : value;
function outputMoney(value: any): string {
  const raw = outputScalar(value);
  if (raw === null || raw === undefined || raw === '—' || raw === '--') return 'null';
  const text = String(raw).replace(/[$,\s]/g, '');
  const match = text.match(/^([+-]?[\d.]+)([KMBT])?$/i);
  if (!match) return outputClean(raw);
  const number = Number(match[1]) * ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[match[2]?.toUpperCase() as 'K' | 'M' | 'B' | 'T'] ?? 1);
  if (!Number.isFinite(number)) return 'null';
  for (const [unit, scale] of [['T', 1e12], ['B', 1e9], ['M', 1e6], ['K', 1e3]] as const) {
    if (Math.abs(number) >= scale) return `$${(number / scale).toFixed(1)}${unit}`;
  }
  return `$${number.toFixed(2)}`;
}
function outputFundLine(index: number, total: number, ticker: string, status: string, data: any = {}, reason?: unknown): string {
  const width = Math.max(2, String(total).length);
  const metrics = data.metrics ?? {};
  // Presentation only. Keep valid zero/false values; omit unavailable fields.
  // outputMoney returns the string 'null' for an unavailable monetary value.
  const field = (key: string, value: unknown): string =>
    value === null || value === undefined || value === 'null' ? '' : `${key}=${outputClean(value)}`;
  const sources = [
    field('official', data.officialHistoryCount),
    field('yahoo', data.yahooHistoryCount),
  ].filter(part => part !== '').join(' ');
  const detail = [
    field('history', outputCount(data.history ?? data.historyCount)),
    sources ? `(${sources})` : '',
    field('holdings', outputCount(data.holdings ?? data.holdingsCount)),
    field('divs', outputCount(data.worksheets?.Distributions ?? data.distributions)),
    field('netAssets', outputMoney(data.netAssets ?? data.aum)),
    field('total', outputMoney(data.totalFundNetAssets ?? data.totalNetAssets)),
    field('div', outputScalar(data.trailingYield ?? data.yields?.effectiveYield ?? data.yields?.dividendYield ?? data.dividendYield ?? metrics.dividendYield)),
    field('sec', outputScalar(data.secYield ?? data.yields?.secYield ?? metrics.secYield)),
  ].filter(part => part !== '').join(' ');
  return `[ ${String(index).padStart(width)}/${String(total).padEnd(width)}  ] ${outputClean(ticker).padEnd(5)} ${status.padEnd(9)}${detail ? ` ${detail}` : ''}${reason ? ` reason=${outputClean(reason)}` : ''}`;
}
function outputCreateReporter(root: URL | string, total: number) {
  let completed = 0;
  return {
    before: (ticker: string) => outputInspectFund(root, ticker),
    async result(ticker: string, before: { digest: string }, status?: string, reason?: unknown, extra: any = {}) {
      const after = await outputInspectFund(root, ticker);
      console.log(outputFundLine(++completed, total, ticker, status ?? (before.digest === after.digest ? 'unchanged' : 'updated'), { ...after.meta, ...extra }, reason));
    },
  };
}

// ---------------------------------------------------------------------------
// Pacer ETFs (Pacer Funds Trust, SEC EDGAR CIK 0001616668) static data updater.
//
// The browser application is deliberately static. This script builds the feed
// under api/pacer/** from public issuer/SEC/market-data sources:
//
//   catalog       Pacer ETFs product listing
//                 https://www.paceretfs.com/products/ (fund name, total
//                 expenses, inception and the month-end NAV total-return row
//                 grouped by investment theme)
//   product page  https://www.paceretfs.com/products/<TICKER>
//                 (fund name, quarter-end NAV/market-price performance table,
//                 the full distribution history, the published top 10 holdings)
//   holdings      the daily holdings CSV export
//                 https://www.paceretfs.com/products/holdings_download/<TICKER>
//                 (SEC EDGAR Form N-PORT-P for the exact series when the CSV
//                 is unavailable; the previous run as the last resort)
//   distributions the Distributions table published on the fund page (Yahoo
//                 dividend events as the fallback)
//   history       Yahoo Finance's public chart endpoint (daily close, adjusted
//                 close, volume, dividends, splits)
//
// Issuer requests are made directly with a browser-like User-Agent first; when
// the issuer answers a non-browser client with an error or a bot-wall page,
// the same public URL is read through the read-only r.jina.ai rendering proxy
// (identical to daggerok/Schwab). No user data or credentials are sent to the
// proxy. SEC and Yahoo requests stay direct.
//
// Usage: bun ./scripts/update-data.ts [--help]
// ---------------------------------------------------------------------------

const PACER_SITE = 'https://www.paceretfs.com';
const PACER_CATALOG_URL = `${PACER_SITE}/products/`;
const PROXY_PREFIX = 'https://r.jina.ai/';
const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const SEC_SITE = 'https://www.sec.gov';
const SEC_BROWSE_URL = `${SEC_SITE}/cgi-bin/browse-edgar`;
const SEC_ARCHIVES = `${SEC_SITE}/Archives/edgar/data`;
const SEC_FUND_TICKERS_URL = `${SEC_SITE}/files/company_tickers_mf.json`;
const SEC_COMPANY_TICKERS_URL = `${SEC_SITE}/files/company_tickers.json`;
const DEFAULT_SEC_UA = 'daggerok ETF feed daggerok@gmail.com';
let secUa = DEFAULT_SEC_UA; // overridden by the SEC_UA control when nonblank
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const PROXY_SLEEP_SECONDS = 3.2; // r.jina.ai anonymous tier is ~20 requests per minute

const API_ROOT = new URL('../api/pacer/', import.meta.url);
const INDEX_FILE = new URL('index.json', API_ROOT);
const STATE_FILE = new URL('update-state.json', API_ROOT);

const HOLDINGS_HEADERS = ['Name', 'Ticker', 'Identifier', 'Weight', 'Market Value', 'Shares Held', 'Asset Category'];
const DISTRIBUTION_HEADERS = ['Ex-Date', 'Total Distributions', 'Ordinary Income', 'Short Term Capital Gains', 'Long Term Capital Gains', 'Return of Capital'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TRUTHY = new Set(['1', 'true', 'yes', 'y', 'on']);
const AUM_BOUNDS = { nano: [0, 10_000_000], micro: [10_000_000, 300_000_000], small: [300_000_000, 2_000_000_000], mid: [2_000_000_000, 10_000_000_000], large: [10_000_000_000, undefined] } as const;
/** Investment themes the Pacer ETFs product listing groups its funds by. */
const KNOWN_THEMES = ['Risk Mitigation', 'High Quality Value', 'Growth', 'Thematic Growth', 'Factor', 'Structured Outcome', 'Income'];

export type CatalogReturns = {
  ytd: number | null;
  mo1: number | null;
  mo3: number | null;
  yr1: number | null;
  yr3: number | null;
  yr5: number | null;
  yr10: number | null;
  sinceInception: number | null;
};

export type CatalogFund = {
  ticker: string;
  name: string;
  category: string;
  categoryPath: string;
  inception: string | null;
  exchange: string;
  cusip: string;
  isin: string;
  benchmark: string;
  ter: number | null;
  nav: number | null;
  close: number | null;
  premiumDiscount: number | null;
  netAssets: number | null;
  sharesOutstanding: number | null;
  dividendYield: number | null;
  secYield: number | null;
  asOfDate: string | null;
  returns: CatalogReturns;
  fundPage: string;
  source: 'pacer' | 'previous index' | 'seed';
};

export type ChartDay = { date: string; close: number; adjClose: number; volume: number };
export type ParsedChart = {
  days: ChartDay[];
  dividends: Array<{ epoch: number; amount: number }>;
  exchangeName: string;
  regularMarketPrice: number | null;
  regularMarketTime: number | null;
  firstTradeDate: number | null;
};

export type PriceReturns = {
  asOfDate: string;
  mo1: number | null;
  qtd: number | null;
  ytd: number | null;
  yr1: number | null;
  cagr3y: number | null;
  cagr5y: number | null;
  cagr10y: number | null;
  siAnn: number | null;
};

export type ParsedNport = {
  regName: string;
  regCik: string;
  seriesName: string;
  seriesId: string;
  repPdDate: string;
  holdings: JsonRecord[];
  totalValue: number;
  netAssets: number | null;
};

/** One row of an official performance table (NAV or Market Price basis). */
export type OfficialReturnRow = {
  asOfDate: string;
  mo1: number | null;
  mo3: number | null;
  ytd: number | null;
  yr1: number | null;
  cagr3y: number | null;
  cagr5y: number | null;
  cagr10y: number | null;
  siAnn: number | null;
};

export type OfficialReturns = {
  monthEnd: { nav: OfficialReturnRow | null; marketPrice: OfficialReturnRow | null };
  quarterEnd: { nav: OfficialReturnRow | null; marketPrice: OfficialReturnRow | null };
};

export type ProductPageSummary = {
  name: string | null;
  inception: string | null;
  indexName: string | null;
  officialReturns: OfficialReturns;
  distributions: Distribution[];
  distributionColumns: string[];
  distributionRows: string[][];
  topHoldings: JsonRecord[];
  topHoldingsAsOf: string | null;
  holdingsDownloadUrl: string;
};

export type HoldingsCsv = {
  headers: string[];
  rows: JsonRecord[];
  asOfDate: string | null;
  netAssets: number | null;
  sharesOutstanding: number | null;
};
export type Distribution = { epoch: number; amount: number };

type SecSeriesRef = { cik: string; seriesId: string; classId: string };
type NportAccession = { accession: string; filed: string; reportDate: string; url: string };

type UpdaterConfig = {
  maxFetches: number;
  requestSleep: number;
  aum?: Range;
  ter?: Range;
  dividendYield?: Range;
  performance: RangeMap;
  totalReturn: RangeMap;
  concurrency: number;
  holdingsPageSize: number;
  historyPageSize: number;
  storeRawDownloads: boolean;
  maxRetries: number;
  tickers: Set<string> | null;
  historyRange: string;
  edgarFallback: boolean;
  skipPacer: boolean;
  skipYahoo: boolean;
  secUa: string;
};

const EMPTY_RETURNS: CatalogReturns = { ytd: null, mo1: null, mo3: null, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null };
const EMPTY_PRICE_RETURNS: PriceReturns = { asOfDate: '', mo1: null, qtd: null, ytd: null, yr1: null, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: null };

// paceretfs.com sits behind a Cloudflare managed challenge for non-browser
// clients. Requests are made through ONE shared, conservative gate rather than
// one lane per worker: speeding up direct requests against a site that is
// actively fingerprinting clients is the wrong tradeoff (same decision as
// daggerok/Franklin and daggerok/Schwab). The proxy has its own slower gate.
let nextRequestAt = 0;
let proxyGateAt = 0;
let requestSleepSeconds = 2.5;
let fundTickerMap: Map<string, SecSeriesRef> | null = null;
let fundTickerMapPromise: Promise<Map<string, SecSeriesRef>> | null = null;
let companyTickerMap: Map<string, string> | null = null;
let companyTickerMapPromise: Promise<Map<string, string>> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function decodeEntities(value: string): string {
  return String(value ?? '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;|&#x27;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&ndash;|&mdash;/gi, '-')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&reg;/gi, '®')
    .replace(/&trade;/gi, '™')
    .replace(/&copy;/gi, '©')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)));
}

function cleanText(value: unknown): string {
  return decodeEntities(String(value ?? ''))
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeTicker(value: unknown): string {
  return cleanText(value).replace(/[^A-Za-z0-9.-]/g, '').toUpperCase();
}

export function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = cleanText(value);
  if (!raw || ['-', '--', '—', 'n/a', 'na', 'null', 'none'].includes(raw.toLowerCase())) return null;
  const negative = /^\(.*\)$/.test(raw);
  const normalized = raw.replace(/[($,%\s]/g, '').replace(/[)]/g, '').replace(/,/g, '');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

/**
 * First number-looking token of a free-text cell, ignoring date tokens
 * ("09/18/2026 | $23.88" -> 23.88, "3.25% As of 09/17/2026" -> 3.25).
 */
export function firstNumber(value: unknown): number | null {
  const raw = cleanText(value).replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, ' ').replace(/\d{4}-\d{2}-\d{2}/g, ' ');
  const match = /(\(?[-+]?\$?\d[\d,]*(?:\.\d+)?%?\)?)/.exec(raw);
  return match ? numberOrNull(match[1]) : null;
}

/** First US or ISO date token of a free-text cell. */
export function firstDate(value: unknown): string | null {
  const raw = cleanText(value);
  const match = /(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/.exec(raw);
  return match ? toIsoDate(match[1]) : null;
}

export function toIsoDate(value: unknown): string {
  const raw = cleanText(value);
  if (!raw) return '';
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(raw)) {
    const [y, m, d] = raw.split('-').map(Number);
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  const short = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/.exec(raw);
  if (short) {
    const yy = Number(short[3]);
    return `${yy <= 69 ? 2000 + yy : 1900 + yy}-${short[1].padStart(2, '0')}-${short[2].padStart(2, '0')}`;
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? raw : new Date(parsed).toISOString().slice(0, 10);
}

function formatDate(value: string | null | undefined): string {
  const iso = toIsoDate(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso || '—';
  return `${MONTHS[Number(match[2]) - 1]} ${Number(match[3])} ${match[1]}`;
}

function formatUsDate(epoch: number): string {
  const date = new Date(epoch * 1000);
  return `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}/${date.getUTCFullYear()}`;
}

function isoToEpoch(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 1000);
}

function formatAumDisplay(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1e12) return `$${(value / 1e12).toFixed(2)} T`;
  if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(2)} B`;
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(2)} M`;
  if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(2)} K`;
  return `$${value.toFixed(2)}`;
}

function parseBoolean(value: string | undefined): boolean {
  return TRUTHY.has(String(value ?? '').trim().toLowerCase());
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseDecimal(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function parseRange(value: string, name = 'range'): Range | undefined {
  const raw = String(value ?? '').trim();
  if (!raw || raw === ':') return undefined;
  if ((raw.match(/:/g) || []).length !== 1) throw new Error(`${name}: colon is required exactly once (use min:max)`);
  const [left, right] = raw.split(':').map((part) => part.trim().replace(/[$%]/g, ''));
  const min = left === '' ? undefined : Number(left);
  const max = right === '' ? undefined : Number(right);
  if ((min !== undefined && !Number.isFinite(min)) || (max !== undefined && !Number.isFinite(max))) throw new Error(`${name}: bounds must be numbers`);
  if (min !== undefined && max !== undefined && min > max) throw new Error(`${name}: minimum must not exceed maximum`);
  return { min, max };
}

function parseAumBound(value: string): number | undefined {
  const raw = value.trim().toLowerCase();
  if (!raw) return undefined;
  if (raw in AUM_BOUNDS) return AUM_BOUNDS[raw as keyof typeof AUM_BOUNDS][0];
  const match = /^\$?([0-9]+(?:\.[0-9]+)?)([kmbt]?)$/i.exec(raw);
  if (!match) throw new Error(`AUM: invalid bound "${value}"`);
  const multiplier: Record<string, number> = { '': 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12 };
  return Number(match[1]) * multiplier[match[2].toLowerCase()];
}

export function parseAumRange(value: string): Range | undefined {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw || raw === ':') return undefined;
  if (!raw.includes(':') && raw in AUM_BOUNDS) {
    const [min, max] = AUM_BOUNDS[raw as keyof typeof AUM_BOUNDS];
    return { min, max };
  }
  if ((raw.match(/:/g) || []).length !== 1) throw new Error('AUM: colon is required exactly once (or use a size preset)');
  const [left, right] = raw.split(':');
  const min = left ? parseAumBound(left) : undefined;
  let max = right ? parseAumBound(right) : undefined;
  // Presets on the right are exclusive upper bounds; the UI contract uses the
  // same convention as iShares/SPDR/Fidelity.
  if (right && right in AUM_BOUNDS) max = AUM_BOUNDS[right as keyof typeof AUM_BOUNDS][1];
  if (min !== undefined && max !== undefined && min > max) throw new Error('AUM: minimum must not exceed maximum');
  return { min, max };
}

export function parseRanges(env: Record<string, string | undefined>, prefix: 'PERFORMANCE' | 'TOTAL_RETURN'): RangeMap {
  const result: RangeMap = {};
  for (const period of ['YTD', '1Y', '3Y', '5Y', '10Y'] as ReturnPeriod[]) {
    const value = env[`${prefix}_${period}`];
    if (value !== undefined && value.trim() !== '') {
      const parsed = parseRange(value, `${prefix}_${period}`);
      if (parsed && (parsed.min !== undefined || parsed.max !== undefined)) result[period] = parsed;
    }
  }
  return result;
}

function readTickerSet(value: string | undefined): Set<string> | null {
  const tickers = String(value ?? '').split(/[\s,;]+/).map(sanitizeTicker).filter(Boolean);
  return tickers.length ? new Set(tickers) : null;
}

function hasConfiguredFilters(config: UpdaterConfig): boolean {
  return Boolean(config.aum || config.ter || config.dividendYield || config.tickers || Object.keys(config.performance).length || Object.keys(config.totalReturn).length);
}

export function readConfig(env: Record<string, string | undefined> = process.env): UpdaterConfig {
  return {
    maxFetches: parsePositiveInt(env.MAX_FETCHES, 0),
    requestSleep: parseDecimal(env.REQUEST_SLEEP, 2.5),
    aum: parseAumRange(env.AUM ?? ':'),
    ter: parseRange(env.TER ?? ':', 'TER'),
    dividendYield: parseRange(env.DIVIDEND_YIELD ?? ':', 'DIVIDEND_YIELD'),
    performance: parseRanges(env, 'PERFORMANCE'),
    totalReturn: parseRanges(env, 'TOTAL_RETURN'),
    concurrency: Math.max(1, parsePositiveInt(env.CONCURRENCY, 1)),
    holdingsPageSize: Math.max(1, parsePositiveInt(env.HOLDINGS_PAGE_SIZE, 250)),
    historyPageSize: Math.max(1, parsePositiveInt(env.HISTORY_PAGE_SIZE, 1000)),
    storeRawDownloads: parseBoolean(env.STORE_RAW_DOWNLOADS),
    maxRetries: Math.max(0, parsePositiveInt(env.MAX_RETRIES, 2)),
    tickers: readTickerSet(env.TICKERS),
    historyRange: env.HISTORY_RANGE?.trim() || 'max',
    edgarFallback: !['0', 'false', 'off', 'no'].includes(String(env.EDGAR_FALLBACK ?? '1').toLowerCase()),
    skipPacer: parseBoolean(env.SKIP_PACER),
    skipYahoo: parseBoolean(env.SKIP_YAHOO),
    secUa: env.SEC_UA?.trim() || DEFAULT_SEC_UA,
  };
}

function rangeMatches(value: number | null | undefined, range?: Range): boolean {
  if (!range) return true;
  if (value === null || value === undefined || !Number.isFinite(value)) return false;
  return (range.min === undefined || value >= range.min) && (range.max === undefined || value <= range.max);
}

function annualizedToTotal(value: number | null | undefined, years: number): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || years <= 0) return null;
  return round(((1 + value / 100) ** years - 1) * 100, 2);
}

export { annualizedToTotal };

// ---------------------------------------------------------------------------
// Text normalization: HTML and r.jina.ai markdown -> the same line/cell model
// ---------------------------------------------------------------------------

function absoluteUrl(href: string, base = PACER_SITE): string {
  const raw = cleanText(href);
  if (!raw || raw.startsWith('#') || raw.startsWith('javascript:')) return '';
  try {
    return new URL(raw, base).toString();
  } catch {
    return '';
  }
}

/**
 * Turns an HTML document into the same shape r.jina.ai produces: one text line
 * per block, table cells separated by pipes, anchors as `[label](url)`. Every
 * parser below works on this normalized text, so the direct HTML page and the
 * proxied markdown rendering are handled by one code path.
 */
export function htmlToText(html: string): string {
  let text = String(html ?? '');
  if (!/<[a-z][\s\S]*>/i.test(text)) return text;
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  text = text.replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  text = text.replace(/<br\s*\/?>/gi, ' ');
  text = text.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_match, attrs: string, inner: string) => {
    const href = /href\s*=\s*"([^"]*)"|href\s*=\s*'([^']*)'/i.exec(attrs);
    const label = cleanText(inner.replace(/<[^>]+>/g, ' '));
    const url = href ? absoluteUrl(href[1] ?? href[2] ?? '') : '';
    return url && label ? ` [${label}](${url}) ` : ` ${label} `;
  });
  text = text.replace(/<title\b[^>]*>([\s\S]*?)<\/title>/i, (_match, inner: string) => `\nTitle: ${cleanText(inner)}\n`);
  text = text.replace(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag, inner: string) => `\n### ${cleanText(inner.replace(/<[^>]+>/g, ' '))}\n`);
  text = text.replace(/<tr\b[^>]*>/gi, '\n| ');
  text = text.replace(/<\/(td|th)>/gi, ' | ');
  text = text.replace(/<\/(tr|p|div|li|table|thead|tbody|section|article|ul|ol|dt|dd|header|footer|label|option|button|caption|figcaption)>/gi, '\n');
  text = text.replace(/<(p|div|li|table|section|article|ul|ol|dt|dd|header|footer|label|caption|figcaption)\b[^>]*>/gi, '\n');
  text = text.replace(/<[^>]+>/g, ' ');
  text = decodeEntities(text);
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/ /g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** Strips the r.jina.ai preamble ("Title:", "URL Source:", "Markdown Content:"). */
export function stripProxyPreamble(text: string): string {
  const source = String(text ?? '');
  const marker = /^Markdown Content:\s*\n/m.exec(source);
  return marker ? source.slice(marker.index + marker[0].length) : source;
}

export type TextLine = { text: string; cells: string[] };

function stripMarkdown(value: string): string {
  return cleanText(
    String(value ?? '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\*\*|__|`/g, '')
      .replace(/^\s*(?:#{1,6}\s+|[*+-]\s+|\d+\.\s+)+/, ''),
  );
}

/** Splits normalized text into lines with their pipe-separated, markdown-free cells. */
export function toTextLines(text: string): TextLine[] {
  const lines: TextLine[] = [];
  for (const raw of String(text ?? '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^\|?\s*(?:-{2,}\s*\|\s*)+-{0,}\s*\|?$/.test(line)) continue; // markdown table separator
    const cells = line.split('|').map((cell) => stripMarkdown(cell)).filter(Boolean);
    lines.push({ text: stripMarkdown(line.replace(/\|/g, ' ')), cells });
  }
  return lines;
}

/** Product-page links of a normalized line: `[{ label, url, slug }]`. */
function productLinks(line: string): Array<{ label: string; url: string; slug: string }> {
  const result: Array<{ label: string; url: string; slug: string }> = [];
  const pattern = /\[([^\]]*)\]\((https?:\/\/[^)\s]*\/products\/([A-Za-z0-9._-]+))\)/gi;
  for (const match of String(line ?? '').matchAll(pattern)) {
    result.push({ label: cleanText(match[1]), url: match[2], slug: match[3] });
  }
  return result;
}

/** True for the product-listing slugs that are fund tickers, not content pages. */
function isTickerSlug(slug: string): boolean {
  return /^[A-Za-z]{2,6}$/.test(cleanText(slug));
}

// ---------------------------------------------------------------------------
// Catalog: the Pacer ETFs product listing
// ---------------------------------------------------------------------------

function canonicalFundPage(raw: string, ticker: string): string {
  const fallback = `${PACER_SITE}/products/${ticker.toUpperCase()}`;
  if (!raw) return fallback;
  const absolute = absoluteUrl(raw);
  const match = /\/products\/([a-z0-9.-]+)/i.exec(absolute);
  return match ? `${PACER_SITE}/products/${match[1].toUpperCase()}` : fallback;
}

function normalizeCategory(value: string): string {
  const raw = cleanText(value);
  const known = KNOWN_THEMES.find((item) => item.toLowerCase() === raw.toLowerCase());
  return known || raw || 'ETF';
}

/** "Total Return as of 09/30/2026" -> 2026-09-30. */
export function catalogAsOfDate(text: string): string | null {
  const match = /as of\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i.exec(String(text ?? ''));
  return match ? toIsoDate(match[1]) : null;
}

/**
 * Parses the product listing (HTML or proxied markdown). Every fund row looks
 * like
 *   | [Name](https://www.paceretfs.com/products/PTLC) | [PTLC](…/PTLC) |
 *     0.60% | 6/11/15 | 7.08 | -0.41 | 2.16 | 14.17 | 13.63 | 9.63 | 11.05 | 9.09 |
 * with the columns YTD, 1 Month, 3 Month, 1 Year, 3 Year, 5 Year, 10 Year and
 * Since Inception; the theme heading above the table is the fund category.
 * The listing renders one row per fund for the active NAV/Market Price pane,
 * so a row is kept per ticker and a later "Total Return as of" date wins.
 */
/** One cell of a markdown/HTML table row: images, bold and heading marks off. */
function cleanRowCell(value: string): string {
  return cleanText(
    String(value ?? '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\*\*|__|`/g, '')
      .replace(/^\s*#{1,6}\s+/, ''),
  );
}

/**
 * Parses the product listing (HTML or proxied markdown). Every fund row looks
 * like
 *   | [Name](https://www.paceretfs.com/products/PTLC) | [PTLC](…/PTLC) |
 *     0.60% | 6/11/15 | 7.08 | -0.41 | 2.16 | 14.17 | 13.63 | 9.63 | 11.05 | 9.09 |
 * with the columns YTD, 1 Month, 3 Month, 1 Year, 3 Year, 5 Year, 10 Year and
 * Since Inception; the theme heading above the table is the fund category.
 *
 * Cells are taken from the raw line (not the shared `toTextLines` model) so a
 * published "-" / "n/a" placeholder keeps its column: dropping it would shift
 * every tenor by one. Rows are keyed per ticker and the row published with the
 * later "Total Return as of" date wins (the listing renders one row per fund
 * for the active NAV / Market Price pane).
 */
export function parseCatalogText(text: string): CatalogFund[] {
  const source = htmlToText(stripProxyPreamble(text));
  const rawLines = source.split('\n');
  const funds = new Map<string, CatalogFund>();
  const themePattern = /^(risk mitigation|high quality value|growth|thematic growth|factor|structured outcome|income)$/i;
  let theme = '';
  let currentAsOf: string | null = null;
  let bestAsOf: string | null = null;
  for (let index = 0; index < rawLines.length; index += 1) {
    const raw = rawLines[index].trim();
    if (!raw) continue;
    if (/^\|?\s*(?:-{2,}\s*\|\s*)+-{0,}\s*\|?$/.test(raw)) continue; // markdown separator
    const cells = raw.split('|').map((cell) => cleanRowCell(cell)).filter((cell) => cell !== '');
    if (!cells.length) continue;
    const joined = cells.join(' | ');
    const asOfMatch = /total return as of\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i.exec(joined);
    if (asOfMatch) {
      currentAsOf = toIsoDate(asOfMatch[1]);
      if (currentAsOf && (!bestAsOf || currentAsOf > bestAsOf)) bestAsOf = currentAsOf;
      continue;
    }
    if (cells.length <= 2 && themePattern.test(cells[0])) {
      theme = normalizeCategory(cells[0]);
      continue;
    }
    const links = productLinks(joined);
    if (!links.length) continue;
    const tickerLink = links.find((link) => isTickerSlug(link.slug) && link.label.toUpperCase() === link.slug.toUpperCase())
      ?? links.find((link) => isTickerSlug(link.slug));
    if (!tickerLink) continue;
    const ticker = sanitizeTicker(tickerLink.slug);
    if (!ticker) continue;
    // The listing also renders card-style entries (`#### [PTLC](…)` followed by
    // the fund-name link on the next line); use that line for the name only.
    let cardLine = '';
    for (let ahead = index + 1; ahead < rawLines.length && !cardLine; ahead += 1) cardLine = rawLines[ahead].trim();
    const cardLinks = productLinks(cardLine);
    const nameLink = links.find((link) => link !== tickerLink && link.label.length > ticker.length + 3)
      ?? cardLinks.find((link) => link.slug.toUpperCase() === ticker && link.label.length > ticker.length + 3);
    const anchor = cells.findIndex((cell) => new RegExp(`\\[${ticker}\\]`, 'i').test(cell) && /\/products\//i.test(cell));
    const nameIndex = nameLink ? cells.findIndex((cell) => cell.includes(nameLink.label)) : -1;
    const from = Math.max(anchor, nameIndex);
    const tail = from >= 0 ? cells.slice(from + 1) : [];
    const expenseCell = tail.find((cell) => /^\d+(?:\.\d+)?%/.test(cell));
    const inceptionCell = tail.find((cell) => /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(cell));
    const expenses = expenseCell ? numberOrNull(/^(\d+(?:\.\d+)?)%/.exec(expenseCell)?.[1] ?? null) : null;
    const inception = inceptionCell ? toIsoDate(inceptionCell) : '';
    const numbers = tail
      .filter((cell) => cell !== expenseCell && cell !== inceptionCell)
      .map((cell) => numberOrNull(cell));
    const [ytd, mo1, mo3, yr1, yr3, yr5, yr10, sinceInception] = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => numbers[i] ?? null);
    const name = cleanText(nameLink?.label || tickerLink.label);
    // A product link alone is not a fund: series/menu pages link to
    // /products/<slug> too. Keep rows that carry the data columns and
    // card-style rows that name the fund.
    const hasData = expenses !== null || Boolean(inception) || numbers.filter((value) => value !== null).length >= 4;
    if (!hasData && !(tickerLink && nameLink)) continue;
    const existing = funds.get(ticker);
    if (existing && existing.asOfDate && currentAsOf && currentAsOf < existing.asOfDate) continue;
    const fund: CatalogFund = existing || {
      ticker,
      name,
      category: theme || 'ETF',
      categoryPath: theme || 'ETF',
      inception: null,
      exchange: '',
      cusip: '',
      isin: '',
      benchmark: '',
      ter: null,
      nav: null,
      close: null,
      premiumDiscount: null,
      netAssets: null,
      sharesOutstanding: null,
      dividendYield: null,
      secYield: null,
      asOfDate: currentAsOf,
      returns: { ...EMPTY_RETURNS },
      fundPage: canonicalFundPage(tickerLink.url, ticker),
      source: 'pacer',
    };
    if (name.length > fund.name.length) fund.name = name;
    if (theme) { fund.category = normalizeCategory(theme); fund.categoryPath = fund.category; }
    if (expenses !== null) fund.ter = expenses;
    if (inception) fund.inception = toIsoDate(inception) || fund.inception;
    fund.returns = { ytd, mo1, mo3, yr1, yr3, yr5, yr10, sinceInception };
    fund.asOfDate = currentAsOf ?? fund.asOfDate;
    funds.set(ticker, fund);
  }
  if (!funds.size) throw new Error('Pacer ETFs product listing: no ETF rows found');
  return [...funds.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
}

// ---------------------------------------------------------------------------
// HTTP layer
// ---------------------------------------------------------------------------

async function paceRequests(proxy = false): Promise<void> {
  const now = Date.now();
  if (proxy) {
    const wait = Math.max(0, proxyGateAt - now);
    proxyGateAt = Math.max(now, proxyGateAt) + Math.max(requestSleepSeconds, PROXY_SLEEP_SECONDS) * 1000;
    if (wait) await sleep(wait);
    return;
  }
  const wait = Math.max(0, nextRequestAt - now);
  nextRequestAt = Math.max(now, nextRequestAt) + Math.max(0, requestSleepSeconds * 1000);
  if (wait) await sleep(wait);
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

function retryable(error: unknown): boolean {
  if (error instanceof HttpError) return error.status === 403 || error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
  return true;
}

function isProxyUrl(url: string): boolean {
  return url.startsWith(PROXY_PREFIX);
}

export function proxyUrl(url: string): string {
  return `${PROXY_PREFIX}${url}`;
}

async function fetchText(url: string, label: string, config: UpdaterConfig, headers: Record<string, string> = {}): Promise<string> {
  let lastError: unknown = new Error('no request attempted');
  const proxy = isProxyUrl(url);
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    try {
      await paceRequests(proxy);
      const response = await fetch(url, { headers: { 'User-Agent': secUa, Accept: '*/*', ...headers }, redirect: 'follow' });
      if (!response.ok) {
        const snippet = cleanText((await response.text().catch(() => '')).replace(/<[^>]+>/g, ' ')).slice(0, 160);
        throw new HttpError(response.status, `${response.status} ${response.statusText}${snippet ? ` — ${snippet}` : ''}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt >= config.maxRetries || !retryable(error)) break;
      const rateLimited = error instanceof HttpError && error.status === 429;
      await sleep(Math.min(60_000, (rateLimited ? 12_000 : 800) * 2 ** attempt));
    }
  }
  throw new Error(`${label}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function fetchJson(url: string, label: string, config: UpdaterConfig, headers: Record<string, string> = {}): Promise<JsonRecord> {
  const text = await fetchText(url, label, config, { Accept: 'application/json', ...headers });
  try {
    return JSON.parse(text) as JsonRecord;
  } catch {
    throw new Error(`${label}: response was not JSON`);
  }
}

let issuerDirectDenials = 0;
const ISSUER_DIRECT_DENIAL_LIMIT = 2;

/**
 * Issuer documents: one direct request with a browser-like User-Agent first,
 * then the same public URL through the read-only rendering proxy. paceretfs.com
 * answers datacenter clients with a Cloudflare managed challenge (HTTP 403);
 * after two such denials in a run the direct attempt is skipped to keep the run
 * short. The proxy itself sits behind Cloudflare and challenges browser
 * User-Agents, so proxy requests declare the plain feed User-Agent. `validate`
 * rejects bot-wall/HTML error pages so that the fallback is taken instead of
 * parsing garbage.
 */
async function fetchIssuerText(url: string, label: string, config: UpdaterConfig, validate: (text: string) => boolean, accept = 'text/html,application/xhtml+xml,text/csv,text/plain;q=0.9,*/*;q=0.8', options: { cache?: boolean } = {}): Promise<{ text: string; via: 'direct' | 'proxy' }> {
  let lastError: unknown = new Error('direct request skipped (issuer CDN denies this network)');
  if (issuerDirectDenials < ISSUER_DIRECT_DENIAL_LIMIT) {
    try {
      const text = await fetchText(url, label, { ...config, maxRetries: 0 }, { 'User-Agent': BROWSER_UA, Accept: accept, 'Accept-Language': 'en-US,en;q=0.9' });
      if (validate(text)) {
        issuerDirectDenials = 0;
        return { text, via: 'direct' };
      }
      lastError = new Error('direct response did not contain the expected content');
    } catch (error) {
      lastError = error;
      if (/\b403\b/.test(error instanceof Error ? error.message : String(error))) {
        issuerDirectDenials += 1;
        if (issuerDirectDenials === ISSUER_DIRECT_DENIAL_LIMIT) console.warn(`[ ${'issuer'.padEnd(9)}] direct requests are denied from this network; using the read-only rendering proxy for the rest of the run`);
      }
    }
  }
  try {
    const headers: Record<string, string> = { 'User-Agent': secUa, Accept: 'text/plain,text/markdown;q=0.9,*/*;q=0.8' };
    if (options.cache === false) headers['X-No-Cache'] = 'true';
    const text = stripProxyPreamble(await fetchText(proxyUrl(url), `${label} (proxy)`, config, headers));
    if (validate(text)) return { text, via: 'proxy' };
    throw new Error('proxy response did not contain the expected content');
  } catch (error) {
    const first = lastError instanceof Error ? lastError.message : String(lastError);
    const second = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: ${first}; ${second}`);
  }
}

// ---------------------------------------------------------------------------
// Product page: performance table, distributions, published top 10 holdings
// ---------------------------------------------------------------------------

function emptyReturnRow(asOfDate = ''): OfficialReturnRow {
  return { asOfDate, mo1: null, mo3: null, ytd: null, yr1: null, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: null };
}

/** Maps a performance-table header cell to the row slot it fills. */
export function returnSlotForHeader(header: string): Exclude<keyof OfficialReturnRow, 'asOfDate'> | null {
  const label = cleanText(header).toLowerCase();
  if (!label) return null;
  if (/since fund inception|since inception/.test(label)) return 'siAnn';
  if (/\bytd\b|year to date/.test(label)) return 'ytd';
  if (/\b1\s*month\b/.test(label)) return 'mo1';
  if (/\b3\s*month\b/.test(label)) return 'mo3';
  if (/\b1\s*year\b/.test(label)) return 'yr1';
  if (/\b3\s*year\b/.test(label)) return 'cagr3y';
  if (/\b5\s*year\b/.test(label)) return 'cagr5y';
  if (/\b10\s*year\b/.test(label)) return 'cagr10y';
  return null;
}

/**
 * Reads the fund page Performance (%) table. The header carries the tenors
 * ("Since Fund Inception (12/16/16) | YTD | 1 Year | 3 Year | 5 Year") and the
 * rows are `<Fund Name> NAV`, `<Fund Name> Market Price` and benchmark rows, so
 * every cell is mapped by its header label instead of by position.
 */
export function parseOfficialReturns(lines: TextLine[], ticker: string): OfficialReturns {
  const result: OfficialReturns = { monthEnd: { nav: null, marketPrice: null }, quarterEnd: { nav: null, marketPrice: null } };
  let slots: Array<Exclude<keyof OfficialReturnRow, 'asOfDate'> | null> | null = null;
  let asOfDate = '';
  let inception: string | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const headerCells = line.cells;
    const mapped = headerCells.map((cell) => returnSlotForHeader(cell));
    // A header row carries tenor labels; a data row is the label + numbers.
    const isHeader = mapped.filter((slot) => slot !== null).length >= 2
      && !headerCells.some((cell) => /^[-+]?\d+(?:\.\d+)?%?$/.test(cleanText(cell)));
    if (isHeader && !slots) {
      slots = mapped;
      const previous = lines[index - 1];
      asOfDate = previous ? firstDate(previous.text) ?? '' : '';
      const inceptionHeader = headerCells.find((cell) => /since fund inception/i.test(cell));
      if (inceptionHeader) inception = firstDate(inceptionHeader);
      continue;
    }
    if (!slots) continue;
    const first = cleanText(line.cells[0] || '');
    if (!first || /^(performance|as of|monthly performance)/i.test(first)) continue;
    if (/index|russell|s&p|bloomberg|msci|ftse/i.test(first) && !new RegExp(`^${ticker}\\b`, 'i').test(first)) continue;
    const basis = /\bmarket price\b/i.test(first) ? 'marketPrice' : /\bnav\b/i.test(first) ? 'nav' : null;
    if (!basis) continue;
    if (!new RegExp(`\\b${ticker}\\b`, 'i').test(first) && !/pacer/i.test(first)) continue;
    const row = emptyReturnRow(asOfDate);
    let filled = 0;
    // The header's leading cell is empty in the published table and is dropped
    // with the other empty cells, so a data row has one more cell than the
    // header: align the values to the labels by that difference.
    const shift = line.cells.length - slots.length;
    line.cells.forEach((cell, cellIndex) => {
      const slot = slots?.[cellIndex - shift] ?? null;
      if (!slot) return;
      const value = numberOrNull(cell);
      if (value === null) return;
      row[slot] = value;
      filled += 1;
    });
    if (!filled) continue;
    // The fund page table is a quarter-end series (Pacer publishes the month-end
    // row in the product listing), so it lands in quarterEnd.
    if (!result.quarterEnd[basis]) result.quarterEnd[basis] = row;
  }
  void inception;
  return result;
}

/** Inception date from the "Since Fund Inception (12/16/16)" performance header. */
export function parsePageInception(lines: TextLine[]): string | null {
  for (const line of lines) {
    for (const cell of line.cells) {
      if (/since fund inception/i.test(cell)) return firstDate(cell);
    }
  }
  return null;
}

/** Index/benchmark name: the first performance-table row that is not the fund. */
export function parseIndexName(lines: TextLine[], ticker: string): string | null {
  for (const line of lines) {
    const first = cleanText(line.cells[0] || '');
    if (!first || new RegExp(`^${ticker}\\b`, 'i').test(first)) continue;
    if (!/index/i.test(first)) continue;
    if (/russell|s&p|bloomberg|msci|ftse|dow jones|nasdaq/i.test(first)) continue;
    return first.replace(/\s*(NAV|Market Price)\s*$/i, '').trim() || null;
  }
  return null;
}

/**
 * Official fund name: the page heading (`## <TICKER>` / `## Pacer … ETF`) first,
 * then the document title (which carries a site suffix).
 */
export function parseFundName(source: string, ticker: string): string | null {
  const upper = ticker.toUpperCase();
  const patterns = [
    new RegExp(`^#{1,3}\\s+(?:\\*\\*)?(?:${upper}\\s+)?(Pacer[^\\n|]*?\\bETF\\b[^\\n|]*)$`, 'im'),
    new RegExp(`^Title:\\s*(?:${upper}\\s+)?(Pacer[^\\n|]*?\\bETF\\b[^\\n|]*)`, 'im'),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (!match) continue;
    const cleaned = cleanText(match[1].replace(/\*\*/g, '')).replace(/\s*\|\s*Pacer ETFs$/i, '');
    if (cleaned) return cleaned;
  }
  return null;
}

/**
 * Distribution history from the fund page Distributions table:
 * `| Ex Date | Record Date | Pay Date | Total Distributions | Ordinary Income* |
 *  Short Term Capital Gains | Long Term Capital Gains | Return of Capital |`.
 */
export function parseDistributionsTable(lines: TextLine[]): { distributions: Distribution[]; columns: string[]; rows: string[][] } {
  const distributions: Distribution[] = [];
  let columns: string[] = [];
  const rows: string[][] = [];
  let inTable = false;
  let totalIndex = -1;
  let dateIndex = -1;
  let parts: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const cells = lines[index].cells;
    if (/^ex[- ]?date$/i.test(cleanText(cells[0] || ''))) {
      columns = cells.map((cell) => cleanText(cell));
      inTable = true;
      dateIndex = 0;
      totalIndex = cells.findIndex((cell) => /^total distribution/i.test(cleanText(cell)));
      parts = ['ordinary income', 'short term', 'long term', 'return of capital']
        .map((label) => cells.findIndex((cell) => cleanText(cell).toLowerCase().includes(label)));
      continue;
    }
    if (!inTable || dateIndex < 0) continue;
    const iso = toIsoDate(cleanText(cells[dateIndex]));
    const epoch = isoToEpoch(iso);
    if (epoch === null) {
      if (cells.length) inTable = false; // table ended (or a footer row appeared)
      continue;
    }
    let amount = totalIndex >= 0 ? numberOrNull(cells[totalIndex]) : null;
    if (amount === null) {
      const sum = parts.map((partIndex) => (partIndex >= 0 ? numberOrNull(cells[partIndex]) : null)).filter((value): value is number => value !== null);
      amount = sum.length ? sum.reduce((acc, value) => acc + value, 0) : null;
    }
    if (amount === null || amount <= 0) continue;
    distributions.push({ epoch, amount: round(amount, 6) });
    rows.push(cells.map((cell) => cleanText(cell)));
  }
  const ascending = rows.map((row, rowIndex) => ({ row, epoch: distributions[rowIndex]?.epoch ?? 0 })).sort((a, b) => a.epoch - b.epoch).map((item) => item.row);
  distributions.sort((a, b) => a.epoch - b.epoch);
  return { distributions, columns: columns.length ? columns : DISTRIBUTION_HEADERS, rows: ascending };
}

/** Published "Top 10 Holdings (%)" table: `| Ticker | Holding | Weight |`. */
export function parseTopHoldings(lines: TextLine[]): { rows: JsonRecord[]; asOfDate: string | null } {
  const rows: JsonRecord[] = [];
  let asOfDate: string | null = null;
  let columns: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const cells = lines[index].cells;
    const lower = cells.map((cell) => cleanText(cell).toLowerCase());
    if (lower.includes('ticker') && lower.includes('holding') && lower.includes('weight')) {
      columns = cells.map((cell) => cleanText(cell));
      asOfDate = firstDate(lines[index - 1]?.text ?? '') ?? null;
      continue;
    }
    if (!columns.length) continue;
    if (lower.includes('total') || cells.length < 3) { columns = []; continue; }
    const tickerIndex = columns.findIndex((column) => /^ticker$/i.test(column));
    const nameIndex = columns.findIndex((column) => /^holding$/i.test(column));
    const weightIndex = columns.findIndex((column) => /^weight$/i.test(column));
    if (tickerIndex < 0 || nameIndex < 0 || weightIndex < 0) { columns = []; continue; }
    const weight = numberOrNull(cells[weightIndex]);
    if (weight === null) { columns = []; continue; }
    rows.push({
      Name: cleanText(cells[nameIndex]) || '-',
      Ticker: cleanHoldingTicker(cells[tickerIndex]) || '-',
      Identifier: '-',
      Weight: String(round(weight, 6)),
      'Market Value': '-',
      'Shares Held': '-',
      'Asset Category': '-',
    });
  }
  return { rows, asOfDate };
}

export function parseProductPage(text: string, ticker: string): ProductPageSummary {
  const source = htmlToText(stripProxyPreamble(text));
  const lines = toTextLines(source);
  const upper = ticker.toUpperCase();
  const name = parseFundName(source, upper);
  const officialReturns = parseOfficialReturns(lines, upper);
  const inception = parsePageInception(lines);
  const indexName = parseIndexName(lines, upper);
  const { distributions, columns, rows } = parseDistributionsTable(lines);
  const top = parseTopHoldings(lines);
  return {
    name,
    inception,
    indexName,
    officialReturns,
    distributions,
    distributionColumns: columns,
    distributionRows: rows,
    topHoldings: top.rows,
    topHoldingsAsOf: top.asOfDate,
    holdingsDownloadUrl: holdingsDownloadUrl(upper),
  };
}

// ---------------------------------------------------------------------------
// CSV export: daily holdings
// ---------------------------------------------------------------------------

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const source = String(text ?? '').replace(/^﻿/, '');
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ',') { row.push(field); field = ''; continue; }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      continue;
    }
    field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  return rows;
}

function csvColumn(headers: string[], ...patterns: RegExp[]): number {
  for (const pattern of patterns) {
    const index = headers.findIndex((header) => pattern.test(header));
    if (index >= 0) return index;
  }
  return -1;
}

function plainNumber(value: unknown, digits: number): string {
  const parsed = numberOrNull(value);
  return parsed === null ? '-' : String(round(parsed, digits));
}

export function isHoldingsCsv(text: string): boolean {
  return /^\s*"?Date"?\s*,\s*"?Account"?\s*,\s*"?StockTicker"?/i.test(String(text ?? '').replace(/^﻿/, ''));
}

export function holdingsDownloadUrl(ticker: string): string {
  return `${PACER_SITE}/products/holdings_download/${sanitizeTicker(ticker)}`;
}

/**
 * Converts the daily holdings CSV export into the sibling sheet contract.
 * Header: Date,Account,StockTicker,CUSIP,SecurityName,Shares,Price,MarketValue,
 * Weightings,NetAssets,SharesOutstanding,CreationUnits,MoneyMarketFlag.
 * NetAssets / SharesOutstanding are fund-level columns repeated on every row;
 * they are returned so the caller can publish AUM and the NAV implied by them.
 */
export function parseHoldingsCsv(text: string): HoldingsCsv {
  const table = parseCsv(stripProxyPreamble(text));
  const headerIndex = table.findIndex((row) => /^date$/i.test(cleanText(row[0])) && /stockticker/i.test(cleanText(row[2] ?? '')));
  if (headerIndex < 0) throw new Error('holdings CSV: header row not found');
  const headers = table[headerIndex].map((cell) => cleanText(cell));
  const col = {
    date: csvColumn(headers, /^date$/i),
    ticker: csvColumn(headers, /^stockticker$/i, /^symbol$/i, /^ticker$/i),
    cusip: csvColumn(headers, /^cusip$/i),
    name: csvColumn(headers, /^securityname$/i, /^name$/i),
    shares: csvColumn(headers, /^shares$/i, /^quantity$/i),
    price: csvColumn(headers, /^price$/i),
    marketValue: csvColumn(headers, /^marketvalue$/i),
    weight: csvColumn(headers, /^weightings$/i, /^weight$/i, /percent of assets/i),
    netAssets: csvColumn(headers, /^netassets$/i),
    sharesOutstanding: csvColumn(headers, /^sharesoutstanding$/i),
    moneyMarket: csvColumn(headers, /^moneymarketflag$/i),
  };
  const rows: JsonRecord[] = [];
  let asOfDate: string | null = null;
  let netAssets: number | null = null;
  let sharesOutstanding: number | null = null;
  const at = (row: string[], index: number): string => (index >= 0 ? cleanText(row[index]) : '');
  for (const row of table.slice(headerIndex + 1)) {
    const date = toIsoDate(at(row, col.date));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue; // disclaimer trailer lines
    if (!asOfDate) asOfDate = date;
    if (netAssets === null) netAssets = numberOrNull(at(row, col.netAssets));
    if (sharesOutstanding === null) sharesOutstanding = numberOrNull(at(row, col.sharesOutstanding));
    const name = at(row, col.name) || '-';
    const symbolRaw = cleanHoldingTicker(at(row, col.ticker));
    const moneyMarket = /^(1|true|yes|y|on)$/i.test(at(row, col.moneyMarket));
    const symbol = symbolRaw && !moneyMarket ? symbolRaw : '-';
    const cusip = at(row, col.cusip).toUpperCase();
    const weight = numberOrNull(at(row, col.weight));
    rows.push({
      Name: name,
      Ticker: symbol,
      Identifier: cusip || '-',
      Weight: weight === null ? '0' : String(round(weight, 6)),
      'Market Value': plainNumber(at(row, col.marketValue), 2),
      'Shares Held': plainNumber(at(row, col.shares), 4),
      'Asset Category': '-',
    });
  }
  return { headers: HOLDINGS_HEADERS, rows, asOfDate, netAssets, sharesOutstanding };
}

// ---------------------------------------------------------------------------
// SEC EDGAR Form N-PORT-P fallback (same resolver as daggerok/Schwab)
// ---------------------------------------------------------------------------

function secHeaders(): Record<string, string> {
  return { 'User-Agent': secUa, Accept: 'application/json, application/xml, text/xml, text/plain' };
}

export function parseFundTickerMap(payload: JsonRecord): Map<string, SecSeriesRef> {
  const result = new Map<string, SecSeriesRef>();
  const fields = Array.isArray(payload?.fields) ? payload.fields.map(String) : [];
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const at = (field: string) => String(row[fields.indexOf(field)] ?? '');
    const ticker = sanitizeTicker(at('symbol'));
    const cik = at('cik').replace(/\D/g, '');
    const seriesId = at('seriesId').toUpperCase();
    const classId = at('classId').toUpperCase();
    if (ticker && cik && seriesId && !result.has(ticker)) result.set(ticker, { cik: cik.padStart(10, '0'), seriesId, classId });
  }
  return result;
}

function unescapeXml(value: string): string {
  return value.replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'");
}

function tagValue(xml: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<(?:(?:[A-Za-z0-9_.-]+):)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[A-Za-z0-9_.-]+):)?${escaped}>`, 'i').exec(xml);
  return match ? cleanText(unescapeXml(match[1].replace(/<[^>]+>/g, ' '))) : '';
}

function tagAttribute(xml: string, tag: string, attribute: string): string {
  const match = new RegExp(`<(?:(?:[A-Za-z0-9_.-]+):)?${tag}\\b[^>]*\\b${attribute}="([^"]*)"`, 'i').exec(xml);
  return match ? cleanText(unescapeXml(match[1])) : '';
}

export function nportUrlFor(cik: string, accession: string): string {
  const digits = String(cik).replace(/\D/g, '').replace(/^0+/, '') || '0';
  const acc = String(accession).replace(/-/g, '');
  // The raw submission text is the stable machine-readable public document for
  // NPORT-P filings; primary_doc.xml is often only the EDGAR submission header
  // or an XSL-rendered HTML view.
  return `${SEC_ARCHIVES}/${digits}/${acc}/${accession}.txt`;
}

export function parseEdgarAtomFilings(xml: string): NportAccession[] {
  const result: NportAccession[] = [];
  for (const match of String(xml ?? '').matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
    const body = match[1];
    const type = (tagValue(body, 'filing-type') || '').toUpperCase();
    if (type && type !== 'NPORT-P') continue;
    if (/<amend>/i.test(body)) continue;
    const accession = tagValue(body, 'accession-number');
    if (!accession) continue;
    const href = /<filing-href>([\s\S]*?)<\/filing-href>/i.exec(body)?.[1] || '';
    const cik = /\/data\/(\d+)\//i.exec(unescapeXml(href))?.[1] || '';
    result.push({ accession, filed: tagValue(body, 'filing-date'), reportDate: tagValue(body, 'period'), url: nportUrlFor(cik, accession) });
  }
  return result;
}

export function parseNport(xml: string): ParsedNport {
  const text = String(xml ?? '');
  const genInfo = /<genInfo\b[^>]*>([\s\S]*?)<\/genInfo>/i.exec(text)?.[1] || text.slice(0, 5000);
  const fundInfo = /<fundInfo\b[^>]*>([\s\S]*?)<\/fundInfo>/i.exec(text)?.[1] || '';
  const holdings: JsonRecord[] = [];
  let totalValue = 0;
  for (const match of text.matchAll(/<invstOrSec\b[^>]*>([\s\S]*?)<\/invstOrSec>/gi)) {
    const body = match[1];
    const name = tagValue(body, 'name') || tagValue(body, 'title') || '-';
    const cusip = tagValue(body, 'cusip');
    const identifier = cusip && !/^n\/?a$/i.test(cusip) ? cusip : tagAttribute(body, 'isin', 'value') || tagAttribute(body, 'other', 'value') || '-';
    const value = numberOrNull(tagValue(body, 'valUSD'));
    const weight = numberOrNull(tagValue(body, 'pctVal'));
    if (value !== null) totalValue += value;
    const debt = /<debtSec\b[^>]*>([\s\S]*?)<\/debtSec>/i.exec(body)?.[1] || '';
    const row: JsonRecord = {
      Name: name,
      Ticker: '-',
      Identifier: identifier,
      Weight: weight === null ? '0' : String(weight),
      'Market Value': value === null ? '0' : String(value),
      'Shares Held': tagValue(body, 'balance') || '-',
      'Asset Category': tagValue(body, 'assetCat') || '-',
    };
    if (debt) { row.Coupon = tagValue(debt, 'annualizedRt') || '-'; row.Maturity = tagValue(debt, 'maturityDt') || '-'; }
    holdings.push(row);
  }
  return {
    regName: tagValue(genInfo, 'regName'),
    regCik: tagValue(genInfo, 'regCik'),
    seriesName: tagValue(genInfo, 'seriesName'),
    seriesId: tagValue(genInfo, 'seriesId'),
    repPdDate: toIsoDate(tagValue(genInfo, 'repPdDate')),
    holdings,
    totalValue: round(totalValue, 2),
    netAssets: numberOrNull(tagValue(fundInfo, 'netAssets')),
  };
}

export function normalizeHoldingName(value: unknown): string {
  let text = cleanText(value).toUpperCase().replace(/[’']/g, '').replace(/&/g, ' AND ').replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  text = text.replace(/\bCLASS\s+([A-Z])\b/g, 'CL $1').replace(/\bCL\.?\s*([A-Z])\b/g, 'CL $1');
  const keepClass = text.match(/\bCL\s+[A-Z]\b/gi)?.[0] || '';
  text = text.replace(/\b(THE|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|SA|NV|AG|SE|SPA|ORDINARY|COMMON|STOCK|SHS|SHARES|ADR|DEPOSITARY|RECEIPT|USD|US|REG|REGISTERED)\b/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  if (keepClass && !/\bCL\s+[A-Z]\b/.test(text)) text = `${text} ${keepClass}`.trim();
  return text;
}

export function normalizeHoldingNameCore(value: unknown): string {
  return normalizeHoldingName(value).replace(/\s+CL\s+[A-Z]\b/g, '').trim();
}

export function cleanHoldingTicker(value: unknown): string {
  const raw = cleanText(value).toUpperCase();
  if (!raw || ['-', '--', 'N/A', 'NA', 'NONE', 'NULL', 'SEE FILE'].includes(raw)) return '';
  return raw.replace(/\s+/g, '');
}

function parseCompanyTickerMap(payload: JsonRecord): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of Object.values(payload || {})) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as JsonRecord;
    const ticker = cleanHoldingTicker(row.ticker);
    const title = cleanText(row.title);
    if (!ticker || !title) continue;
    for (const key of [normalizeHoldingName(title), normalizeHoldingNameCore(title)]) if (key && !map.has(key)) map.set(key, ticker);
  }
  return map;
}

async function loadFundTickerTable(config: UpdaterConfig): Promise<Map<string, SecSeriesRef>> {
  if (fundTickerMap) return fundTickerMap;
  if (fundTickerMapPromise) return fundTickerMapPromise;
  fundTickerMapPromise = (async () => {
    const payload = await fetchJson(SEC_FUND_TICKERS_URL, '[edgar   ] fund ticker table', config, secHeaders());
    fundTickerMap = parseFundTickerMap(payload);
    outputNote(`[ ${'edgar'.padEnd(9)}] SEC fund ticker table: ${fundTickerMap.size} share classes`);
    return fundTickerMap;
  })();
  try {
    return await fundTickerMapPromise;
  } finally {
    fundTickerMapPromise = null;
  }
}

async function loadCompanyTickerTable(config: UpdaterConfig): Promise<Map<string, string>> {
  if (companyTickerMap) return companyTickerMap;
  if (companyTickerMapPromise) return companyTickerMapPromise;
  companyTickerMapPromise = (async () => {
    const payload = await fetchJson(SEC_COMPANY_TICKERS_URL, '[edgar   ] company ticker table', config, secHeaders());
    companyTickerMap = parseCompanyTickerMap(payload);
    outputNote(`[ ${'edgar'.padEnd(9)}] SEC company ticker table: ${companyTickerMap.size} issuer names`);
    return companyTickerMap;
  })();
  try {
    return await companyTickerMapPromise;
  } finally {
    companyTickerMapPromise = null;
  }
}

function fillNportTickers(rows: JsonRecord[], names: Map<string, string>): JsonRecord[] {
  return rows.map((row) => {
    if (cleanHoldingTicker(row.Ticker)) return row;
    if ('Maturity' in row && row.Maturity !== '-') return row; // bonds stay identifier-keyed
    const ticker = names.get(normalizeHoldingName(row.Name)) || names.get(normalizeHoldingNameCore(row.Name)) || '';
    return ticker ? { ...row, Ticker: ticker } : row;
  });
}

async function resolveNportFiling(fund: CatalogFund, config: UpdaterConfig): Promise<{ ref: SecSeriesRef; accession: NportAccession } | null> {
  const table = await loadFundTickerTable(config);
  const ref = table.get(fund.ticker);
  if (!ref) return null;
  const params = new URLSearchParams({ action: 'getcompany', CIK: ref.seriesId, type: 'NPORT-P', owner: 'include', count: '10', output: 'atom' });
  const atom = await fetchText(`${SEC_BROWSE_URL}?${params.toString()}`, `[edgar   ] ${fund.ticker} filings`, config, secHeaders());
  const [accession] = parseEdgarAtomFilings(atom);
  return accession ? { ref, accession } : null;
}

// ---------------------------------------------------------------------------
// Yahoo Finance chart: history, dividends, derived returns
// ---------------------------------------------------------------------------

export function parseChart(payload: JsonRecord): ParsedChart {
  const result = payload?.chart?.result?.[0];
  if (!result) throw new Error('Yahoo chart returned no result');
  const timestamps: number[] = Array.isArray(result.timestamp) ? result.timestamp : [];
  const quote = result.indicators?.quote?.[0] || {};
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose || [];
  const days: ChartDay[] = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const close = numberOrNull(quote.close?.[i]);
    if (close === null) continue;
    const adjClose = numberOrNull(adjusted[i]) ?? close;
    days.push({ date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10), close, adjClose, volume: numberOrNull(quote.volume?.[i]) ?? 0 });
  }
  const dividends: Array<{ epoch: number; amount: number }> = [];
  for (const [epoch, item] of Object.entries(result.events?.dividends || {})) {
    const amount = numberOrNull((item as JsonRecord)?.amount);
    if (amount !== null) dividends.push({ epoch: Number(epoch), amount });
  }
  dividends.sort((a, b) => a.epoch - b.epoch);
  return {
    days,
    dividends,
    exchangeName: cleanText(result.meta?.exchangeName || result.meta?.fullExchangeName),
    regularMarketPrice: numberOrNull(result.meta?.regularMarketPrice),
    regularMarketTime: numberOrNull(result.meta?.regularMarketTime),
    firstTradeDate: numberOrNull(result.meta?.firstTradeDate),
  };
}

function pctChange(start: number | null, end: number | null): number | null {
  if (start === null || end === null || start === 0) return null;
  return round((end / start - 1) * 100, 2);
}

function annualized(start: number | null, end: number | null, years: number): number | null {
  if (start === null || end === null || start <= 0 || end <= 0 || years <= 0) return null;
  return round(((end / start) ** (1 / years) - 1) * 100, 2);
}

function anchor(days: ChartDay[], target: Date): ChartDay | null {
  let found: ChartDay | null = null;
  for (const day of days) {
    if (new Date(`${day.date}T00:00:00Z`) <= target) found = day;
    else break;
  }
  return found;
}

export function priceReturns(days: ChartDay[], now = new Date()): PriceReturns {
  const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const last = ordered[ordered.length - 1];
  if (!last) return { ...EMPTY_PRICE_RETURNS };
  const date = new Date(`${last.date}T00:00:00Z`);
  const target = (years: number) => new Date(date.getTime() - years * 365.25 * 86_400_000);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const quarterStartMonth = Math.floor(date.getUTCMonth() / 3) * 3;
  const quarterStart = new Date(Date.UTC(date.getUTCFullYear(), quarterStartMonth, 1));
  const monthStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, date.getUTCDate()));
  const start = (d: ChartDay | null) => d?.adjClose ?? null;
  const end = last.adjClose;
  void now;
  return {
    asOfDate: last.date,
    mo1: pctChange(start(anchor(ordered, monthStart)), end),
    qtd: pctChange(start(anchor(ordered, quarterStart)), end),
    ytd: pctChange(start(anchor(ordered, yearStart)), end),
    yr1: pctChange(start(anchor(ordered, target(1))), end),
    cagr3y: annualized(start(anchor(ordered, target(3))), end, 3),
    cagr5y: annualized(start(anchor(ordered, target(5))), end, 5),
    cagr10y: annualized(start(anchor(ordered, target(10))), end, 10),
    siAnn: ordered.length > 1 ? annualized(ordered[0].adjClose, end, Math.max(1 / 365, (date.getTime() - new Date(`${ordered[0].date}T00:00:00Z`).getTime()) / (365.25 * 86_400_000))) : null,
  };
}

/**
 * Payment cadence from the ex-date gaps of the most recent distributions. The
 * median gap (not the mean) keeps a year-end special distribution from turning
 * a quarterly payer into "Irregular".
 */
export function inferDistributionFrequency(dividends: Array<{ epoch: number; amount: number }>): { frequency: string; paymentsPerYear: number | null } {
  if (!dividends.length) return { frequency: 'None', paymentsPerYear: null };
  if (dividends.length < 2) return { frequency: 'Unknown', paymentsPerYear: null };
  const recent = [...dividends].sort((a, b) => a.epoch - b.epoch).slice(-9);
  const gaps = recent.slice(1).map((item, index) => (item.epoch - recent[index].epoch) / 86_400).filter((gap) => gap > 0).sort((a, b) => a - b);
  if (!gaps.length) return { frequency: 'Unknown', paymentsPerYear: null };
  const median = gaps.length % 2 ? gaps[(gaps.length - 1) / 2] : (gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2;
  if (median <= 45) return { frequency: 'Monthly', paymentsPerYear: 12 };
  if (median <= 135) return { frequency: 'Quarterly', paymentsPerYear: 4 };
  if (median <= 270) return { frequency: 'Semi-Annual', paymentsPerYear: 2 };
  if (median <= 500) return { frequency: 'Annual', paymentsPerYear: 1 };
  return { frequency: 'Irregular', paymentsPerYear: null };
}

/** Sortable coded label written into index.json (mirrors the client-side formatter). */
export function frequencyCodeLabel(value: unknown): string {
  const raw = String(value ?? '').trim();
  const normalized = raw.toLowerCase().replace(/[‐‑‒–—]/g, '-').replace(/\s+/g, ' ');
  if (!normalized || normalized === '-' || normalized === '—') return '00 - None';
  if (normalized === 'monthly') return '01 - Monthly';
  if (normalized === 'quarterly') return '04 - Quarterly';
  if (normalized === 'semi-annual' || normalized === 'semi-annually' || normalized === 'semiannual') return '06 - Semi-annually';
  if (normalized === 'annual' || normalized === 'annually') return '12 - Annually';
  if (normalized === 'none') return '00 - None';
  if (normalized === 'unknown') return '00 - Unknown';
  if (normalized === 'irregular') return '99 - Irregular';
  return raw;
}

function lastCompletedQuarterEnd(now = new Date()): string {
  const month = now.getUTCMonth();
  const quarterEndMonth = Math.floor(month / 3) * 3 - 1;
  const year = quarterEndMonth < 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const normalizedMonth = (quarterEndMonth + 12) % 12;
  const day = new Date(Date.UTC(year, normalizedMonth + 1, 0));
  return day.toISOString().slice(0, 10);
}

const DERIVED_RETURNS_BASIS = 'adjusted market-price closes (Yahoo chart API), not official Pacer NAV returns';
const OFFICIAL_RETURNS_BASIS = 'official Pacer NAV total returns (product listing, month-end) where published; Yahoo adjusted market-price closes for missing values';

function deriveMetrics(effective: PriceReturns, fund: CatalogFund, dividends: Distribution[], frequency: { paymentsPerYear: number | null }, price: number | null, official: boolean): JsonRecord {
  const latest = dividends[dividends.length - 1];
  const indicated = fund.dividendYield ?? (latest && frequency.paymentsPerYear && price ? round((latest.amount * frequency.paymentsPerYear / price) * 100, 2) : null);
  return {
    ytd: effective.ytd,
    tr1y: effective.yr1,
    tr3y: annualizedToTotal(effective.cagr3y, 3),
    tr5y: annualizedToTotal(effective.cagr5y, 5),
    tr10y: annualizedToTotal(effective.cagr10y, 10),
    cagr3y: effective.cagr3y,
    cagr5y: effective.cagr5y,
    cagr10y: effective.cagr10y,
    siAnn: effective.siAnn,
    dividendYield: indicated,
    dividendYieldText: indicated === null ? '—' : `${indicated.toFixed(2)}%`,
    secYield: fund.secYield,
    secYieldText: fund.secYield === null ? '—' : `${fund.secYield.toFixed(2)}%`,
    returnsBasis: official ? OFFICIAL_RETURNS_BASIS : DERIVED_RETURNS_BASIS,
  };
}

function historyRows(days: ChartDay[]): JsonRecord[] {
  // Yahoo recomputes the split/dividend-adjusted close on every request; storing
  // the raw float lets the last digit or two jitter between otherwise identical
  // requests, making every history row (and the fund) look "updated" on every
  // single run. Rounding to 2 decimals is well past any meaningful price
  // precision and absorbs that jitter.
  return days.map((day) => ({ Date: formatDate(day.date), Close: String(day.close), 'Adj Close': String(round(day.adjClose, 2)), Volume: String(day.volume) }));
}

function distributionRows(dividends: Distribution[]): string[][] {
  return dividends.map((item) => [formatUsDate(item.epoch), String(round(item.amount, 6))]);
}

export function mergeOfficialReturns(derived: PriceReturns, official: OfficialReturnRow | null): PriceReturns {
  if (!official) return derived;
  return {
    ...derived,
    asOfDate: official.asOfDate || derived.asOfDate,
    mo1: official.mo1 ?? derived.mo1,
    mo3: official.mo3 ?? derived.mo3,
    qtd: derived.qtd,
    ytd: official.ytd ?? derived.ytd,
    yr1: official.yr1 ?? derived.yr1,
    cagr3y: official.cagr3y ?? derived.cagr3y,
    cagr5y: official.cagr5y ?? derived.cagr5y,
    cagr10y: official.cagr10y ?? derived.cagr10y,
    siAnn: official.siAnn ?? derived.siAnn,
  };
}

function returnRowJson(row: OfficialReturnRow | null): JsonRecord | null {
  if (!row) return null;
  const text = (value: number | null) => (value === null ? '—' : `${value.toFixed(2)}%`);
  return {
    asOfDate: row.asOfDate ? formatDate(row.asOfDate) : '—',
    mo1: row.mo1, mo1Text: text(row.mo1),
    mo3: row.mo3, mo3Text: text(row.mo3),
    ytd: row.ytd, ytdText: text(row.ytd),
    yr1: row.yr1, yr1Text: text(row.yr1),
    yr3: row.cagr3y, yr3Text: text(row.cagr3y),
    yr5: row.cagr5y, yr5Text: text(row.cagr5y),
    yr10: row.cagr10y, yr10Text: text(row.cagr10y),
    sinceInception: row.siAnn, sinceInceptionText: text(row.siAnn),
  };
}

// ---------------------------------------------------------------------------
// Previous feed access + writers
// ---------------------------------------------------------------------------

function parsePreviousFund(ticker: string, row: JsonRecord): CatalogFund {
  const metrics = row.metrics || {};
  const monthEnd = row.returns?.monthEnd || {};
  return {
    ticker,
    name: String(row.name || ticker),
    category: String(row.category || 'ETF'),
    categoryPath: String(row.categoryPath || row.category || 'ETF'),
    inception: toIsoDate(row.inceptionDate) || null,
    exchange: String(row.exchange || ''),
    cusip: String(row.cusip || ''),
    isin: String(row.isin || ''),
    benchmark: '',
    ter: numberOrNull(row.terValue),
    nav: numberOrNull(row.navValue),
    close: numberOrNull(row.closePriceValue),
    premiumDiscount: numberOrNull(row.premiumDiscountValue),
    netAssets: numberOrNull(row.aumValue),
    sharesOutstanding: numberOrNull(row.sharesOutstanding ?? row.sharesOutstandingValue),
    dividendYield: numberOrNull(metrics.dividendYield),
    secYield: numberOrNull(metrics.secYield),
    asOfDate: null,
    returns: {
      ytd: numberOrNull(monthEnd.ytd),
      mo1: numberOrNull(monthEnd.mo1),
      mo3: numberOrNull(monthEnd.mo3),
      yr1: numberOrNull(monthEnd.yr1),
      yr3: numberOrNull(monthEnd.yr3),
      yr5: numberOrNull(monthEnd.yr5),
      yr10: numberOrNull(monthEnd.yr10),
      sinceInception: numberOrNull(monthEnd.sinceInception),
    },
    fundPage: String(row.fundPage || `${PACER_SITE}/products/${ticker.toUpperCase()}`),
    source: 'previous index',
  };
}

async function readPreviousIndex(): Promise<Map<string, JsonRecord>> {
  try {
    const data = JSON.parse(await readFile(INDEX_FILE, 'utf8')) as JsonRecord;
    const map = new Map<string, JsonRecord>();
    for (const row of Array.isArray(data.funds) ? data.funds : []) if (row?.ticker) map.set(String(row.ticker), row);
    return map;
  } catch {
    return new Map();
  }
}

async function readPreviousMeta(ticker: string): Promise<JsonRecord | null> {
  try {
    return JSON.parse(await readFile(new URL(`funds/${ticker}/meta.json`, API_ROOT), 'utf8')) as JsonRecord;
  } catch {
    return null;
  }
}

async function readPreviousSheet(ticker: string, kind: 'holdings' | 'history'): Promise<JsonRecord[]> {
  const meta = await readPreviousMeta(ticker);
  const pages = meta?.[kind]?.pages;
  if (!Array.isArray(pages)) return [];
  const rows: JsonRecord[] = [];
  for (const page of pages) {
    try {
      const pagePath = String(page).includes('/') ? String(page) : `${kind}/${page}`;
      const data = JSON.parse(await readFile(new URL(`funds/${ticker}/${pagePath}`, API_ROOT), 'utf8')) as JsonRecord;
      if (Array.isArray(data.rows)) rows.push(...data.rows);
    } catch {
      // Keep the rows already recovered from earlier pages.
    }
  }
  return rows;
}

async function readPreviousHeaders(ticker: string, kind: 'holdings' | 'history'): Promise<string[] | null> {
  const meta = await readPreviousMeta(ticker);
  const first = Array.isArray(meta?.[kind]?.pages) ? meta[kind].pages[0] : null;
  if (!first) return null;
  try {
    const pagePath = String(first).includes('/') ? String(first) : `${kind}/${first}`;
    const data = JSON.parse(await readFile(new URL(`funds/${ticker}/${pagePath}`, API_ROOT), 'utf8')) as JsonRecord;
    return Array.isArray(data.headers) ? data.headers : null;
  } catch {
    return null;
  }
}

// Comparing raw text would treat a run that only refreshed generatedAt (with
// every fund's actual data unchanged) as a real change and rewrite the file
// every time. Compare with both timestamps stripped instead.
export function samePublishedContent(previous: string, value: unknown): boolean {
  // Timestamps can be nested (for example under a `source` object): a shallow
  // top-level-only strip rewrites those files on every single run.
  const withoutRunTimestamp = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(withoutRunTimestamp);
    if (!item || typeof item !== 'object') return item;
    const { generatedAt, savedAt, catalogReadAt, ...content } = item as Record<string, unknown>;
    return Object.fromEntries(Object.entries(content).map(([key, value]) => [key, withoutRunTimestamp(value)]));
  };
  try {
    return JSON.stringify(withoutRunTimestamp(JSON.parse(previous))) === JSON.stringify(withoutRunTimestamp(value));
  } catch { return false; }
}

async function writeIfChanged(file: URL, value: unknown): Promise<boolean> {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  try {
    const previous = await readFile(file, 'utf8');
    if (previous === text || samePublishedContent(previous, value)) return false;
  } catch {
    // New file.
  }
  await mkdir(new URL('.', file), { recursive: true });
  await writeFile(file, text, 'utf8');
  return true;
}

async function writePages(fundDir: URL, ticker: string, kind: 'holdings' | 'history', headers: string[], rows: JsonRecord[], pageSize: number, asOfDate: string | null, source: string): Promise<JsonRecord> {
  const dir = new URL(`${kind}/`, fundDir);
  await mkdir(dir, { recursive: true });
  const pageCount = rows.length ? Math.ceil(rows.length / pageSize) : 0;
  const kept = new Set<string>();
  for (let page = 0; page < pageCount; page += 1) {
    const name = `${String(page + 1).padStart(3, '0')}.json`;
    kept.add(name);
    await writeIfChanged(new URL(name, dir), { ticker, page: page + 1, pageSize, totalRows: rows.length, headers, rows: rows.slice(page * pageSize, (page + 1) * pageSize) });
  }
  try {
    for (const name of await readdir(dir)) if (name.endsWith('.json') && !kept.has(name)) await rm(new URL(name, dir), { force: true });
  } catch {
    // Directory may not exist on a zero-row first run.
  }
  return { pages: [...kept].sort().map((name) => `${kind}/${name}`), pageSize, totalRows: rows.length, ...(kind === 'holdings' ? { asOfDate, asOf: asOfDate ? formatDate(asOfDate) : '—', source } : { asOf: asOfDate ? formatDate(asOfDate) : '—', source }) };
}

function catalogFilterReasons(fund: CatalogFund, config: UpdaterConfig): string[] {
  const reasons: string[] = [];
  if (config.tickers && !config.tickers.has(fund.ticker)) reasons.push('TICKERS');
  if (!rangeMatches(fund.ter, config.ter)) reasons.push('TER');
  return reasons;
}

function postFetchFilterReasons(fund: CatalogFund, metrics: JsonRecord, config: UpdaterConfig): string[] {
  const reasons: string[] = [];
  if (!rangeMatches(fund.netAssets, config.aum)) reasons.push('AUM');
  if (!rangeMatches(numberOrNull(metrics.dividendYield), config.dividendYield)) reasons.push('DIVIDEND_YIELD');
  const annual: Record<ReturnPeriod, number | null> = { YTD: metrics.ytd, '1Y': metrics.tr1y, '3Y': metrics.cagr3y, '5Y': metrics.cagr5y, '10Y': metrics.cagr10y };
  const cumulative: Record<ReturnPeriod, number | null> = { YTD: metrics.ytd, '1Y': metrics.tr1y, '3Y': metrics.tr3y, '5Y': metrics.tr5y, '10Y': metrics.tr10y };
  for (const [period, range] of Object.entries(config.performance) as [ReturnPeriod, Range][]) if (annual[period] !== null && !rangeMatches(annual[period], range)) reasons.push(`PERFORMANCE_${period}`);
  for (const [period, range] of Object.entries(config.totalReturn) as [ReturnPeriod, Range][]) if (cumulative[period] !== null && !rangeMatches(cumulative[period], range)) reasons.push(`TOTAL_RETURN_${period}`);
  return reasons;
}

// ---------------------------------------------------------------------------
// Per-fund pipeline
// ---------------------------------------------------------------------------

const PROVIDER_LABEL = 'Pacer ETFs product listing + official product page + per-fund daily holdings CSV export + SEC EDGAR Form N-PORT-P fallback + Yahoo Finance public chart API';

async function processFund(fund: CatalogFund, config: UpdaterConfig, previous: JsonRecord = {}): Promise<JsonRecord> {
  const reasons = catalogFilterReasons(fund, config);
  if (reasons.length) {
    return { __skipped: true, ticker: fund.ticker, __skipReasons: reasons };
  }
  const fundDir = new URL(`funds/${fund.ticker}/`, API_ROOT);
  await mkdir(fundDir, { recursive: true });
  const previousMeta = await readPreviousMeta(fund.ticker);

  // 1. Official product page ---------------------------------------------------
  let summary: ProductPageSummary | null = null;
  let productVia: 'direct' | 'proxy' | null = null;
  if (!config.skipPacer && fund.fundPage) {
    try {
      const page = await fetchIssuerText(fund.fundPage, `[product ] ${fund.ticker}`, config, (text) => /Performance \(|Distributions|Fund Documents/i.test(text), undefined, { cache: false });
      productVia = page.via;
      summary = parseProductPage(page.text, fund.ticker);
      if (config.storeRawDownloads) {
        const raw = new URL('raw/', API_ROOT);
        await mkdir(raw, { recursive: true });
        await writeFile(new URL(`${fund.ticker}-product-page.${page.via === 'proxy' ? 'md' : 'html'}`, raw), page.text, 'utf8');
      }
      if (summary.name) fund.name = summary.name;
      if (summary.indexName) fund.benchmark = summary.indexName;
      if (summary.inception) fund.inception = summary.inception;
    } catch (error) {
      outputNote(`[ ${'product'.padEnd(9)}] ${fund.ticker}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 2. Holdings: issuer CSV -> N-PORT-P -> published top 10 -> previous run -----
  let holdingsRows: JsonRecord[] = [];
  let holdingsHeaders: string[] = HOLDINGS_HEADERS;
  let holdingsAsOf: string | null = null;
  let holdingsSource = 'not available from the issuer CSV export or a public SEC filing';
  let holdingsDownload: string | null = summary?.holdingsDownloadUrl || holdingsDownloadUrl(fund.ticker);
  let sharesOutstanding: number | null = null;
  let csvNetAssets: number | null = null;
  let nport: ParsedNport | null = null;
  if (!config.skipPacer) {
    try {
      const csv = await fetchIssuerText(holdingsDownload, `[holdings] ${fund.ticker}`, config, isHoldingsCsv, 'text/csv,text/plain;q=0.9,*/*;q=0.8');
      const parsed = parseHoldingsCsv(csv.text);
      if (parsed.rows.length) {
        holdingsRows = parsed.rows;
        holdingsHeaders = parsed.headers;
        holdingsAsOf = parsed.asOfDate;
        csvNetAssets = parsed.netAssets;
        sharesOutstanding = parsed.sharesOutstanding;
        holdingsSource = `paceretfs.com daily holdings CSV export (${holdingsDownload.split('/').pop()}${csv.via === 'proxy' ? ', via read-only rendering proxy' : ''})`;
        if (csvNetAssets !== null) fund.netAssets = csvNetAssets;
        if (sharesOutstanding !== null) fund.sharesOutstanding = sharesOutstanding;
      }
    } catch (error) {
      outputNote(`[ ${'holdings'.padEnd(9)}] ${fund.ticker}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!holdingsRows.length && config.edgarFallback) {
    try {
      const filing = await resolveNportFiling(fund, config);
      if (filing) {
        const parsed = parseNport(await fetchText(filing.accession.url, `[nport   ] ${fund.ticker}`, config, secHeaders()));
        const seriesMatches = !parsed.seriesId || parsed.seriesId.toUpperCase() === filing.ref.seriesId.toUpperCase();
        if (seriesMatches && parsed.holdings.length) {
          const names = await loadCompanyTickerTable(config);
          holdingsRows = fillNportTickers(parsed.holdings, names);
          holdingsHeaders = holdingsRows.some((row) => 'Coupon' in row || 'Maturity' in row) ? [...HOLDINGS_HEADERS, 'Coupon', 'Maturity'] : HOLDINGS_HEADERS;
          holdingsAsOf = parsed.repPdDate || null;
          nport = parsed;
          holdingsDownload = filing.accession.url;
          holdingsSource = `SEC EDGAR Form N-PORT-P (accession ${filing.accession.accession}, report period ${parsed.repPdDate || 'n/a'})`;
        }
      }
    } catch (error) {
      outputNote(`[ ${'nport'.padEnd(9)}] ${fund.ticker}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!holdingsRows.length && summary?.topHoldings.length) {
    holdingsRows = summary.topHoldings;
    holdingsHeaders = HOLDINGS_HEADERS;
    holdingsAsOf = summary.topHoldingsAsOf;
    holdingsDownload = null;
    holdingsSource = 'top 10 holdings published on the official Pacer ETFs product page (no CSV export or N-PORT-P holdings in this run)';
  }
  if (!holdingsRows.length) {
    holdingsRows = await readPreviousSheet(fund.ticker, 'holdings');
    holdingsHeaders = (await readPreviousHeaders(fund.ticker, 'holdings')) || holdingsHeaders;
    holdingsAsOf = previousMeta?.holdings?.asOfDate || null;
    holdingsSource = previousMeta?.holdings?.source || holdingsSource;
    holdingsDownload = previousMeta?.source?.holdingsDownload || holdingsDownload;
  }

  // 3. Distributions: fund page table -> Yahoo dividends -> previous run -------
  let dividends: Distribution[] = summary?.distributions ? [...summary.distributions] : [];
  let distributionTable: string[][] = summary?.distributionRows?.length ? summary.distributionRows : [];
  let distributionsSource = dividends.length ? 'paceretfs.com fund page distribution history (total distribution per share)' : 'not available';
  if (!dividends.length) {
    const previousRows = Array.isArray(previousMeta?.distributions?.rows) ? previousMeta.distributions.rows : [];
    if (previousRows.length) {
      distributionTable = previousRows;
      dividends = previousRows.map((row: string[]) => ({ epoch: isoToEpoch(toIsoDate(row[0])) ?? 0, amount: numberOrNull(row[1]) ?? 0 })).filter((item: Distribution) => item.epoch > 0 && item.amount > 0).sort((a, b) => a.epoch - b.epoch);
      distributionsSource = previousMeta?.distributions?.source || 'previous run';
    }
  }

  // 4. Yahoo chart: history + dividend fallback --------------------------------
  let chart: ParsedChart | null = null;
  let days: ChartDay[] = [];
  let historySource = 'Yahoo Finance public chart API (adjusted close)';
  if (!config.skipYahoo) {
    try {
      const query = new URLSearchParams({ period1: '0', period2: String(Math.floor(Date.now() / 1000) + 86_400), interval: '1d', events: 'div|split', includeAdjustedClose: 'true' });
      if (config.historyRange && config.historyRange !== 'max') query.set('range', config.historyRange);
      const payload = await fetchJson(`${YAHOO_CHART_URL}/${encodeURIComponent(fund.ticker)}?${query.toString()}`, `[chart   ] ${fund.ticker}`, config, { 'User-Agent': 'Mozilla/5.0' });
      chart = parseChart(payload);
      days = chart.days;
    } catch (error) {
      outputNote(`[ ${'chart'.padEnd(9)}] ${fund.ticker}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!days.length) {
    const previousRows = await readPreviousSheet(fund.ticker, 'history');
    days = previousRows.map((row) => ({ date: toIsoDate(row.Date), close: numberOrNull(row.Close) || 0, adjClose: numberOrNull(row['Adj Close']) || numberOrNull(row.Close) || 0, volume: numberOrNull(row.Volume) || 0 })).filter((row) => row.date && row.close > 0);
    if (previousRows.length) historySource = previousMeta?.history?.source || 'previous run';
  }
  if (!dividends.length && chart?.dividends.length) {
    dividends = chart.dividends.map((item) => ({ epoch: item.epoch, amount: round(item.amount, 6) }));
    distributionTable = distributionRows(dividends);
    distributionsSource = 'Yahoo Finance chart dividend events (the fund page published no distribution table)';
  }

  // 5. Returns + metrics --------------------------------------------------------
  const frequency = inferDistributionFrequency(dividends);
  const latest = dividends[dividends.length - 1] || null;
  const derived = priceReturns(days);
  // The product listing publishes the month-end NAV row (YTD, 1/3 Month,
  // 1/3/5/10 Year, Since Inception); the fund page table is the quarter-end row.
  const catalogReturnsPublished = [fund.returns.ytd, fund.returns.mo1, fund.returns.mo3, fund.returns.yr1, fund.returns.yr3, fund.returns.yr5, fund.returns.yr10, fund.returns.sinceInception].some((value) => value !== null);
  const officialMonthly: OfficialReturnRow | null = catalogReturnsPublished
    ? {
        asOfDate: fund.asOfDate || derived.asOfDate,
        mo1: fund.returns.mo1,
        mo3: fund.returns.mo3,
        ytd: fund.returns.ytd,
        yr1: fund.returns.yr1,
        cagr3y: fund.returns.yr3,
        cagr5y: fund.returns.yr5,
        cagr10y: fund.returns.yr10,
        siAnn: fund.returns.sinceInception,
      }
    : null;
  const officialQuarterly = summary?.officialReturns.quarterEnd.nav || null;
  const effective = mergeOfficialReturns(derived, officialMonthly);
  const marketPrice = chart?.regularMarketPrice ?? (days.length ? days[days.length - 1].close : numberOrNull(previous.closePriceValue));
  const nav = fund.nav ?? (fund.netAssets !== null && fund.sharesOutstanding ? round(fund.netAssets / fund.sharesOutstanding, 2) : null) ?? numberOrNull(previous.navValue);
  const metrics = deriveMetrics(effective, fund, dividends, frequency, nav ?? marketPrice, Boolean(officialMonthly));
  const skipReasons = postFetchFilterReasons(fund, metrics, config);
  if (skipReasons.length) {
    return { __skipped: true, ticker: fund.ticker, __skipReasons: skipReasons };
  }

  // 6. Write sheets, meta.json and the index row --------------------------------
  const history = historyRows(days);
  const historyAsOf = derived.asOfDate || previousMeta?.history?.asOf || null;
  const holdingManifest = await writePages(fundDir, fund.ticker, 'holdings', holdingsHeaders, holdingsRows, config.holdingsPageSize, holdingsAsOf, holdingsSource);
  if (summary?.topHoldings.length) holdingManifest.publishedTopHoldings = summary.topHoldings.length;
  const historyManifest = await writePages(fundDir, fund.ticker, 'history', historyHeaders(), history, config.historyPageSize, historyAsOf, historySource);
  const distributionFrequency = dividends.length ? frequency.frequency : (previousMeta?.distributions?.frequency || '—');
  const premiumDiscount = fund.premiumDiscount ?? (nav && marketPrice ? round((marketPrice / nav - 1) * 100, 2) : numberOrNull(previous.premiumDiscountValue));
  const netAssets = fund.netAssets ?? csvNetAssets ?? nport?.netAssets ?? numberOrNull(previous.aumValue);
  const asOfDate = fund.asOfDate || holdingsAsOf || toIsoDate(previous.asOfDate) || null;
  const asOfLabel = asOfDate ? formatDate(asOfDate) : chart?.regularMarketTime ? formatDate(new Date(chart.regularMarketTime * 1000).toISOString().slice(0, 10)) : '—';
  const marketPriceAsOfLabel = chart?.regularMarketTime ? formatDate(new Date(chart.regularMarketTime * 1000).toISOString().slice(0, 10)) : (days.length ? formatDate(days[days.length - 1].date) : asOfLabel);
  const text = (value: number | null) => (value === null ? '—' : `${value.toFixed(2)}%`);
  const returns: JsonRecord = {
    derivedFrom: officialMonthly ? OFFICIAL_RETURNS_BASIS : DERIVED_RETURNS_BASIS,
    monthEnd: {
      asOfDate: effective.asOfDate ? formatDate(effective.asOfDate) : '—',
      mo1: effective.mo1, mo1Text: text(effective.mo1),
      mo3: effective.mo3, mo3Text: text(effective.mo3),
      qtd: effective.qtd, qtdText: text(effective.qtd),
      ytd: effective.ytd, ytdText: text(effective.ytd),
      yr1: effective.yr1, yr1Text: text(effective.yr1),
      yr3: effective.cagr3y, yr3Text: text(effective.cagr3y),
      yr5: effective.cagr5y, yr5Text: text(effective.cagr5y),
      yr10: effective.cagr10y, yr10Text: text(effective.cagr10y),
      sinceInception: effective.siAnn, sinceInceptionText: text(effective.siAnn),
    },
    quarterEnd: officialQuarterly ? {
      asOfDate: officialQuarterly.asOfDate ? formatDate(officialQuarterly.asOfDate) : formatDate(lastCompletedQuarterEnd()),
      ytd: officialQuarterly.ytd ?? null,
      yr1: officialQuarterly.yr1,
      yr3: officialQuarterly.cagr3y,
      yr5: officialQuarterly.cagr5y,
      yr10: officialQuarterly.cagr10y,
      sinceInception: officialQuarterly.siAnn,
    } : { asOfDate: formatDate(lastCompletedQuarterEnd()), ytd: null, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null },
  };

  const meta: JsonRecord = {
    ticker: fund.ticker,
    name: fund.name,
    category: fund.category,
    categoryPath: fund.categoryPath || fund.category,
    source: {
      fundPage: fund.fundPage,
      officialProductPage: fund.fundPage,
      productPageRendering: productVia ? (productVia === 'proxy' ? 'read-only rendering proxy (r.jina.ai) of the official product page' : 'official product page (direct)') : 'not fetched in this run',
      productPageAsOf: summary?.officialReturns.quarterEnd.nav?.asOfDate ? formatDate(summary.officialReturns.quarterEnd.nav.asOfDate) : null,
      holdingsDownload,
      navHistoryDownload: null,
      yahooChart: `${YAHOO_CHART_URL}/${encodeURIComponent(fund.ticker)}`,
      holdingsSource,
      historySource,
      distributionsSource,
      provider: PROVIDER_LABEL,
    },
    identifiers: { cusip: fund.cusip || null, isin: fund.isin || null, isinBasis: null, indexTicker: fund.benchmark || null, exchange: fund.exchange || null, morningstarCategory: null },
    expenseRatio: { display: fund.ter === null ? '—' : `${fund.ter}%`, value: fund.ter, kind: 'Total Expenses published in the official Pacer ETFs product listing' },
    nav: { display: nav === null ? '—' : `$${nav.toFixed(2)}`, value: nav, asOfDate: holdingsAsOf ? formatDate(holdingsAsOf) : asOfLabel, source: fund.netAssets !== null && fund.sharesOutstanding ? 'derived: daily holdings CSV NetAssets / SharesOutstanding (paceretfs.com publishes no NAV in the static fund page)' : 'previous run' },
    marketPrice: { display: marketPrice === null ? '—' : `$${marketPrice.toFixed(2)}`, value: marketPrice, asOfDate: marketPriceAsOfLabel, source: chart ? 'Yahoo Finance last regular-session price (the anonymous product page publishes no closing price)' : 'previous run' },
    premiumDiscount: { display: premiumDiscount === null ? '—' : `${premiumDiscount.toFixed(2)}%`, value: premiumDiscount, asOfDate: marketPriceAsOfLabel, source: 'computed from Yahoo last price / the net-asset value implied by the daily holdings CSV' },
    aum: { display: formatAumDisplay(netAssets), value: netAssets, asOfDate: holdingsAsOf ? formatDate(holdingsAsOf) : (nport?.repPdDate ? formatDate(nport.repPdDate) : asOfLabel), source: fund.netAssets !== null ? 'NetAssets column of the paceretfs.com daily holdings CSV' : nport ? `SEC Form N-PORT-P net assets (${nport.repPdDate || 'n/a'})` : 'previous run' },
    fundFacts: { sharesOutstanding: fund.sharesOutstanding ?? null, portfolioTurnover: null, publishedTotalHoldings: null, bidAskMidpoint: null },
    yields: {
      dividendYield: metrics.dividendYield,
      dividendYieldText: metrics.dividendYieldText,
      dividendYieldKind: 'indicated (latest distribution per share x inferred payments per year / NAV) from the official Pacer distribution history',
      distributionRate: null,
      secYield: metrics.secYield,
      secYieldText: metrics.secYieldText,
      secYieldKind: 'not published on the official Pacer ETFs product page for this fund',
    },
    returns,
    officialMarketPriceReturns: summary ? { monthEnd: returnRowJson(summary.officialReturns.monthEnd.marketPrice), quarterEnd: returnRowJson(summary.officialReturns.quarterEnd.marketPrice) } : null,
    distributions: { frequency: distributionFrequency, frequencyCode: frequencyCodeLabel(distributionFrequency), paymentsPerYear: frequency.paymentsPerYear, source: distributionsSource, headers: distributionTable.length ? (summary?.distributionColumns || (Array.isArray(previousMeta?.distributions?.headers) ? previousMeta.distributions.headers : DISTRIBUTION_HEADERS)) : DISTRIBUTION_HEADERS, rows: distributionTable },
    holdings: holdingManifest,
    history: historyManifest,
  };
  await writeIfChanged(new URL('meta.json', fundDir), meta);

  return {
    ticker: fund.ticker,
    name: fund.name,
    category: fund.category,
    fundPage: fund.fundPage,
    dataFile: `./funds/${fund.ticker}/meta.json`,
    cusip: fund.cusip || null,
    isin: fund.isin || null,
    ter: fund.ter === null ? '—' : `${fund.ter}%`,
    terValue: fund.ter,
    nav: nav === null ? '—' : `$${nav.toFixed(2)}`,
    navValue: nav,
    aum: formatAumDisplay(netAssets),
    aumValue: netAssets,
    asOfDate: asOfLabel,
    inceptionDate: fund.inception ? formatDate(fund.inception) : chart?.firstTradeDate ? formatDate(new Date(chart.firstTradeDate * 1000).toISOString().slice(0, 10)) : (previous.inceptionDate || '—'),
    exchange: fund.exchange || chart?.exchangeName || previous.exchange || '',
    closePrice: marketPrice === null ? '—' : `$${marketPrice.toFixed(2)}`,
    closePriceValue: marketPrice,
    premiumDiscount: premiumDiscount === null ? '—' : `${premiumDiscount.toFixed(2)}%`,
    premiumDiscountValue: premiumDiscount,
    frequencyCode: frequencyCodeLabel(distributionFrequency),
    distributions: { frequency: distributionFrequency, exDate: latest ? formatUsDate(latest.epoch) : (previous.distributions?.exDate || '—'), dividend: latest ? String(round(latest.amount, 6)) : (previous.distributions?.dividend || '—') },
    returns,
    metrics,
    holdings: holdingsRows.length,
    history: history.length,
  };
}

function historyHeaders(): string[] {
  return ['Date', 'Close', 'Adj Close', 'Volume'];
}

function configLines(config: UpdaterConfig): string[] {
  return [
    `MAX_FETCHES=${config.maxFetches || 'all'}`,
    `REQUEST_SLEEP=${config.requestSleep}s`,
    `CONCURRENCY=${config.concurrency}`,
    `AUM=${config.aum ? JSON.stringify(config.aum) : '—'}`,
    `TER=${config.ter ? JSON.stringify(config.ter) : '—'}`,
    `TICKERS=${config.tickers ? [...config.tickers].join(',') : 'all'}`,
    `EDGAR_FALLBACK=${config.edgarFallback}`,
    `HISTORY_RANGE=${config.historyRange}`,
  ];
}
void configLines;

const USAGE = `
Pacer ETFs static data updater

Sources:
  catalog       Pacer ETFs product listing, https://www.paceretfs.com/products/
                (official page; read-only r.jina.ai rendering fallback when a
                non-browser request is refused)
  product page  official per-fund page: quarter-end NAV / Market Price
                performance, the full distribution history, the published
                top 10 holdings
  holdings      daily holdings CSV export per fund, /products/holdings_download/
                SEC EDGAR Form N-PORT-P for the exact series as the fallback
  distributions the Distributions table of the fund page (Yahoo dividend events
                as the fallback)
  history       Yahoo Finance public chart API (adjusted market-price closes)

Configuration: scripts/update-data.config.json defaults < advanced JSON (workflow
only) < nonblank workflow inputs < environment variables below (all filters use
AND logic):
  MAX_FETCHES=0       all eligible funds; positive value is a resumable batch
  REQUEST_SLEEP=2.5   seconds between outgoing request starts
  CONCURRENCY=1       parallel fund workers; the WAF gate stays conservative
  AUM=:               min:max, bounds may be amounts or nano/micro/small/mid/large
  TER=:               total expense ratio percentage range
  DIVIDEND_YIELD=:    indicated dividend-yield percentage range
  TICKERS="COWZ CALF PTLC"   optional ticker allowlist
  PERFORMANCE_YTD|1Y|3Y|5Y|10Y=min:max   annualized ranges
  TOTAL_RETURN_YTD|1Y|3Y|5Y|10Y=min:max  cumulative ranges
  HOLDINGS_PAGE_SIZE=250
  HISTORY_PAGE_SIZE=1000
  HISTORY_RANGE=max
  MAX_RETRIES=2
  STORE_RAW_DOWNLOADS=off
  EDGAR_FALLBACK=1
  SKIP_PACER=off      use the previously published catalog/product data
  SKIP_YAHOO=off      keep previously published history when possible
  SEC_UA=             SEC User-Agent override (declare a contact); blank uses the
                      built-in default (daggerok ETF feed daggerok@gmail.com)
  VERBOSE=off         per-fund retry / fallback notices

Defaults live in scripts/update-data.config.json. Precedence: file defaults <
advanced JSON < nonblank workflow_dispatch inputs < environment variables, all
resolved by resolveControls() (exported below and used by the workflow).

Examples:
  TICKERS="COWZ CALF PTLC" ./scripts/update-data.ts
  AUM="large:" TER=":0.50" ./scripts/update-data.ts
  PERFORMANCE_3Y="10:" TOTAL_RETURN_1Y="15:" ./scripts/update-data.ts
`;

// File defaults and explicit overrides: allowlisted scalar controls only, so
// GitHub Actions can resolve them without interpolating user input into bash.
// Precedence: config file < advanced JSON < nonblank inputs < environment.
export const CONTROL_NAMES = [
  'MAX_FETCHES', 'REQUEST_SLEEP', 'CONCURRENCY', 'AUM', 'TER', 'DIVIDEND_YIELD', 'TICKERS',
  'HOLDINGS_PAGE_SIZE', 'HISTORY_PAGE_SIZE', 'STORE_RAW_DOWNLOADS', 'MAX_RETRIES', 'HISTORY_RANGE',
  'EDGAR_FALLBACK', 'SKIP_YAHOO', 'SKIP_PACER', 'SEC_UA', 'VERBOSE',
  ...['PERFORMANCE', 'TOTAL_RETURN'].flatMap((prefix) => ['YTD', '1Y', '3Y', '5Y', '10Y'].map((period) => `${prefix}_${period}`)),
] as const;
export type ControlName = (typeof CONTROL_NAMES)[number];
export const CONFIG_FILE_URL = new URL('./update-data.config.json', import.meta.url);

export function resolveControls(
  file: unknown = {},
  advanced: unknown = {},
  inputs: unknown = {},
  env: Record<string, string | undefined> = {},
): Record<string, string> {
  const result: Record<string, string> = {};
  const known = new Set<string>(CONTROL_NAMES);
  const apply = (value: unknown, skipEmpty = false): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Configuration must be a JSON object');
    for (const [key, raw] of Object.entries(value)) {
      if (!known.has(key)) throw new Error(`Unknown updater control: ${key}`);
      if (skipEmpty && (raw === '' || raw === undefined || raw === null)) continue;
      if (!['string', 'number', 'boolean'].includes(typeof raw)) throw new Error(`${key}: expected string, number or boolean`);
      const text = String(raw);
      if (/[\r\n\0]/.test(text)) throw new Error(`${key}: multiline/control characters are not allowed`);
      result[key] = text;
    }
  };
  apply(file);
  apply(advanced);
  apply(inputs, true);
  for (const key of CONTROL_NAMES) {
    const value = env[key];
    if (value !== undefined) apply({ [key]: value });
  }
  for (const key of ['MAX_FETCHES', 'CONCURRENCY', 'HOLDINGS_PAGE_SIZE', 'HISTORY_PAGE_SIZE', 'MAX_RETRIES']) {
    const v = result[key];
    if (v === undefined || v.trim() === '') continue;
    const min = key === 'MAX_FETCHES' ? 0 : 1;
    if (!/^\d+$/.test(v.trim()) || !Number.isSafeInteger(Number(v)) || Number(v) < min) throw new Error(`${key}: expected integer >= ${min}`);
  }
  const sleep = result.REQUEST_SLEEP;
  if (sleep && sleep.trim() && (!Number.isFinite(Number(sleep)) || Number(sleep) < 0)) throw new Error('REQUEST_SLEEP: expected nonnegative seconds');
  for (const key of ['STORE_RAW_DOWNLOADS', 'EDGAR_FALLBACK', 'SKIP_YAHOO', 'SKIP_PACER', 'VERBOSE']) {
    if (result[key] && !/^(0|1|true|false|yes|no|y|n|on|off)$/i.test(result[key].trim())) throw new Error(`${key}: expected boolean`);
  }
  readConfig(result); // validate every min:max filter before any request or write
  return result;
}

export async function runtimeControls(env: Record<string, string | undefined> = process.env): Promise<Record<string, string>> {
  const file = JSON.parse(await readFile(CONFIG_FILE_URL, 'utf8'));
  return resolveControls(file, {}, {}, env);
}

async function main(): Promise<void> {
  const controls = await runtimeControls();
  const config = readConfig(controls);
  secUa = config.secUa;
  if (controls.VERBOSE !== undefined) process.env.VERBOSE = controls.VERBOSE;
  requestSleepSeconds = config.requestSleep;
  nextRequestAt = 0;
  proxyGateAt = 0;
  issuerDirectDenials = 0;
  outputPrintConfig('Pacer', config);

  const previous = await readPreviousIndex();
  const catalog = new Map<string, CatalogFund>();
  let catalogSource = 'previous api/pacer/index.json';
  if (!config.skipPacer) {
    try {
      // The full listing carries the data columns; the proxy rendering only
      // shows the fund cards (tickers + names). Accept the degraded rendering
      // rather than losing the catalog, but never a bot-wall page.
      const catalogValidate = (text: string): boolean => {
        if (!/\/products\/[a-z0-9]{2,6}/i.test(text)) return false;
        if (/Total Expenses|Fund Inception/i.test(text)) return true;
        return /Pacer\s+[A-Z][a-z]+/.test(text) && !/just a moment|enable javascript|cf-browser-verification|attention required/i.test(text);
      };
      const fetched = await fetchIssuerText(PACER_CATALOG_URL, '[catalog ] product listing', config, catalogValidate, undefined, { cache: false });
      const parsed = parseCatalogText(fetched.text);
      for (const fund of parsed) catalog.set(fund.ticker, fund);
      catalogSource = fetched.via === 'proxy' ? 'Pacer ETFs product listing via read-only rendering proxy' : 'Pacer ETFs product listing';
      if (config.storeRawDownloads) {
        const raw = new URL('raw/', API_ROOT);
        await mkdir(raw, { recursive: true });
        await writeFile(new URL(`product-listing-${new Date().toISOString().slice(0, 10)}.${fetched.via === 'proxy' ? 'md' : 'html'}`, raw), fetched.text, 'utf8');
      }
    } catch (error) {
      console.warn(`[ ${'catalog'.padEnd(9)}] ${error instanceof Error ? error.message : String(error)} — keeping the published feed`);
    }
  }
  if (!catalog.size) for (const [ticker, row] of previous) catalog.set(ticker, parsePreviousFund(ticker, row));
  if (catalog.size && catalogSource !== 'previous api/pacer/index.json') for (const [ticker, row] of previous) if (!catalog.has(ticker)) catalog.set(ticker, parsePreviousFund(ticker, row));

  const universe = [...catalog.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
  if (!universe.length) throw new Error('No catalog rows available. Run this where www.paceretfs.com is reachable or seed api/pacer/index.json first.');
  console.log(`[ ${'catalog'.padEnd(9)}] ${universe.length} Pacer ETFs (${catalogSource})`);

  let state: JsonRecord = {};
  try { state = JSON.parse(await readFile(STATE_FILE, 'utf8')) as JsonRecord; } catch { state = {}; }
  const cursor = config.maxFetches > 0 ? String(state.cursor || '') : '';
  const index = cursor ? universe.findIndex((fund) => fund.ticker === cursor) : -1;
  const ordered = index >= 0 ? universe.slice(index + 1).concat(universe.slice(0, index + 1)) : universe;
  const queue = ordered.slice();
  const totalAttempts = config.maxFetches > 0 ? Math.min(config.maxFetches, ordered.length) : ordered.length;
  const results: JsonRecord[] = [];
  let processed = 0;
  let failures = 0;
  let lastTicker: string | null = cursor || null;
  outputPrintFilter(universe.length, universe.length, outputHasOutputFilters(config));
  const output = outputCreateReporter(API_ROOT, totalAttempts);
  const worker = async (): Promise<void> => {
    for (;;) {
      if (config.maxFetches > 0 && processed >= config.maxFetches) return;
      const fund = queue.shift();
      if (!fund) return;
      processed += 1;
      const before = await output.before(fund.ticker);
      try {
        const row = await processFund(fund, config, previous.get(fund.ticker) || {});
        if (row.__skipped) {
          await output.result(fund.ticker, before, 'skipped', (row.__skipReasons || ['not eligible']).join(', '));
        } else {
          results.push(row);
          lastTicker = fund.ticker;
          await output.result(fund.ticker, before);
        }
      } catch (error) {
        failures += 1;
        const message = error instanceof Error ? error.message : String(error);
        const old = previous.get(fund.ticker);
        if (old && !hasConfiguredFilters(config)) results.push(old);
        await output.result(fund.ticker, before, 'failed', message);
      }
    }
  };
  await Promise.all(Array.from({ length: config.concurrency }, () => worker()));

  const filterRun = hasConfiguredFilters(config);
  const funds = [...results].sort((a, b) => String(a.ticker).localeCompare(String(b.ticker)));
  if (!filterRun) {
    for (const fund of universe) if (!funds.some((row) => row.ticker === fund.ticker)) {
      const old = previous.get(fund.ticker);
      if (old) funds.push(old);
    }
    funds.sort((a, b) => String(a.ticker).localeCompare(String(b.ticker)));
  }
  const counts = { funds: funds.length, holdings: funds.reduce((sum, row) => sum + (numberOrNull(row.holdings) || 0), 0), history: funds.reduce((sum, row) => sum + (numberOrNull(row.history) || 0), 0) };
  await writeIfChanged(INDEX_FILE, {
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    source: {
      provider: 'Pacer ETFs (Pacer Funds Trust, Pacer Advisors, Inc.), U.S.-listed ETFs',
      market: 'us',
      site: PACER_SITE,
      catalog: PACER_CATALOG_URL,
      catalogFallback: proxyUrl(PACER_CATALOG_URL),
      holdings: 'paceretfs.com daily holdings CSV export per fund (SEC EDGAR Form N-PORT-P fallback)',
      distributions: 'paceretfs.com fund page distribution history (Yahoo dividend events fallback)',
      history: 'Yahoo Finance public chart API (adjusted close)',
    },
    counts,
    funds,
  });
  await writeIfChanged(STATE_FILE, { cursor: config.maxFetches > 0 ? lastTicker : null, savedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') });
  console.log(`[ ${'done'.padEnd(9)}] ${results.length} funds updated, ${failures} failures`);
  console.log(`[ ${'done'.padEnd(9)}] counts: ${counts.funds} funds / ${counts.holdings.toLocaleString('en-US')} holdings rows / ${counts.history.toLocaleString('en-US')} history rows`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Pacer data update\n\n- updated: ${results.length}\n- failed: ${failures}\n- counts: ${counts.funds} funds / ${counts.holdings.toLocaleString('en-US')} holdings rows / ${counts.history.toLocaleString('en-US')} history rows\n`, 'utf8');
}

if ((import.meta as { main?: boolean }).main) {
  if (process.argv.some((arg) => ['-h', '--help', 'help'].includes(arg))) console.log(USAGE.trim());
  else await main().catch((error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });
}
