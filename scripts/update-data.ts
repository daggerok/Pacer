#!/usr/bin/env bun
// Bun provides Node-compatible fs/promises; node types are intentionally not required at runtime.
/// <reference types="bun" />
import { readFile as outputReadFile, readdir as outputReadDir } from 'node:fs/promises';
import { createHash as outputCreateHash } from 'node:crypto';
import { join as outputJoin } from 'node:path';
import { fileURLToPath as outputFileURLToPath } from 'node:url';

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
    skipVanEck: 'SKIP_VANECK', skipProShares: 'SKIP_PROSHARES',
    skipWisdomTree: 'SKIP_WISDOMTREE', skipGoldmanSachs: 'SKIP_GOLDMANSACHS',
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
  console.log(`[ config   ] ${brand} updater:\n${entries.map(([key, value]) => `              ${key}=${/TOKEN|PASSWORD|SECRET|COOKIE|SEC_UA/i.test(key) ? '<redacted>' : outputClean(value)}`).join('\n')}`);
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
    field('port', data.portId ?? data.portfolioId),
    field('history', outputCount(data.history ?? data.historyCount)),
    sources ? `(${sources})` : '',
    field('holdings', outputCount(data.holdings ?? data.holdingsCount)),
    field('divs', outputCount(data.worksheets?.Distributions ?? data.distributions)),
    field('netAssets', outputMoney(data.netAssets ?? data.aum)),
    field('total', outputMoney(data.totalFundNetAssets ?? data.totalNetAssets)),
    field('div', outputScalar(data.trailingYield ?? data.yields?.effectiveYield ?? data.yields?.dividendYield ?? data.dividendYield ?? metrics.dividendYield)),
    field('sec', outputScalar(data.secYield ?? data.yields?.secYield ?? metrics.secYield)),
    field('wp', data.workplaceRaw),
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


// Pacer ETFs static data updater.
//
// The browser application is deliberately static. This script builds the feed
// under api/pacer/** from public issuer/SEC/market-data sources:
//
//   catalog       https://www.paceretfs.com/products/ - one performance table per
//                 investment theme (name, ticker, total expenses, inception, NAV
//                 total returns) plus the series listing for funds without a row
//   fund page     https://www.paceretfs.com/products/<TICKER> (Structured Outcome
//                 funds: /products/structured-outcome-strategies/<TICKER>): Fund
//                 Details, quarter-end performance, top 10 holdings, distributions
//   holdings      SEC EDGAR Form N-PORT-P (Pacer Funds Trust, CIK 0001616668) full
//                 schedule; the official top 10 table is a labelled partial
//                 fallback (the full "Daily Holdings" file is a protected download
//                 that neither direct requests nor the rendering proxy can read);
//                 the previous run as the last resort
//   distributions the fund page Distributions table (Yahoo dividend events fallback)
//   history       Yahoo Finance's public chart endpoint (daily close, adjusted
//                 close, volume, dividends, splits)
//
// paceretfs.com sits behind a Cloudflare managed challenge (direct requests get
// HTTP 403). Issuer requests are made directly with a browser-like User-Agent
// first; after two denials the same public URL is read through the read-only
// r.jina.ai rendering proxy for the rest of the run (same approach as
// other WAF-protected sibling feeds). No user data or credentials are sent to the proxy. SEC and
// Yahoo requests stay direct.
//
// Usage: bun ./scripts/update-data.ts [--help]

import { appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';

declare const process: {
  env: Record<string, string | undefined>;
  argv: string[];
  execArgv: string[];
  execPath: string;
  exit(code?: number): never;
  exitCode?: number;
};

type JsonRecord = Record<string, any>;
type Range = { min?: number; max?: number };
type ReturnPeriod = 'YTD' | '1Y' | '3Y' | '5Y' | '10Y';
type RangeMap = Partial<Record<ReturnPeriod, Range>>;

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
export const FETCH_TIMEOUT_MS = 45_000; // covers headers and body
const PROXY_SLEEP_SECONDS = 3.2; // r.jina.ai anonymous tier is ~20 requests per minute

const API_ROOT = new URL('../api/pacer/', import.meta.url);
const INDEX_FILE = new URL('index.json', API_ROOT);
const STATE_FILE = new URL('update-state.json', API_ROOT);

const HOLDINGS_HEADERS = ['Name', 'Ticker', 'Identifier', 'Weight', 'Market Value', 'Shares Held', 'Asset Category'];
const BOND_HOLDINGS_HEADERS = [...HOLDINGS_HEADERS, 'Coupon', 'Maturity'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TRUTHY = new Set(['1', 'true', 'yes', 'y', 'on']);
const AUM_BOUNDS = { nano: [0, 10_000_000], micro: [10_000_000, 300_000_000], small: [300_000_000, 2_000_000_000], mid: [2_000_000_000, 10_000_000_000], large: [10_000_000_000, undefined] } as const;

export type CatalogReturns = {
  ytd: number | null;
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
  grossTer: number | null;
  nav: number | null;
  close: number | null;
  premiumDiscount: number | null;
  netAssets: number | null;
  dividendYield: number | null;
  secYield: number | null;
  asOfDate: string | null;
  returns: CatalogReturns;
  /** NAV total returns from the catalog table (as of its first header date), null when the table has none. */
  monthEnd: OfficialReturnRow | null;
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

/** One row of the official performance table (NAV or Market Price basis). */
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

export type TopHolding = { ticker: string; name: string; weight: number };
export type TopHoldings = { asOfDate: string | null; rows: TopHolding[]; total: number | null };

export type ProductPageSummary = {
  name: string | null;
  asOfDate: string | null;
  cusip: string;
  isin: string;
  inception: string | null;
  nav: number | null;
  marketPrice: number | null;
  totalNetAssets: number | null;
  totalExpenseRatio: number | null;
  sharesOutstanding: number | null;
  totalHoldings: number | null;
  premiumDiscount: number | null;
  medianBidAskSpread: number | null;
  secYield: number | null;
  officialReturns: OfficialReturns;
  topHoldings: TopHoldings;
  distributions: Distribution[];
  /** Which sections of the page are present at all (a heading or labelled row), whether or not their values parsed. */
  sections: PageSections;
  /** True only when the Fund Details pricing block AND both performance tables are present: such a page has loaded fully. */
  loadedFully: boolean;
};

export type PageSections = { pricing: boolean; recent: boolean; quarter: boolean; secYield: boolean; distributions: boolean; topHoldings: boolean };

export type Distribution = { epoch: number; amount: number };

type SecSeriesRef = { cik: string; seriesId: string; classId: string };
type NportAccession = { accession: string; filed: string; reportDate: string; url: string };

type UpdaterConfig = {
  maxFetches: number;
  requestSleep: number;
  aum?: Range;
  ter?: Range;
  dividendYield?: Range;
  secYield?: Range;
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

const EMPTY_RETURNS: CatalogReturns = { ytd: null, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null };
const EMPTY_PRICE_RETURNS: PriceReturns = { asOfDate: '', mo1: null, qtd: null, ytd: null, yr1: null, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: null };

// One pacing lane per concurrent worker (sized from config.concurrency in
// main()). A single shared gate capped total throughput at one request per
// requestSleepSeconds no matter how high CONCURRENCY was set; CONCURRENCY
// workers now each get their own paced lane, so concurrency actually
// multiplies throughput as documented instead of only overlapping wait time.
let requestGates: number[] = [0];
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
    .replace(/\u00a0/g, ' ')
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
  // Month-name dates are parsed as UTC so a run east of UTC publishes the same day as CI.
  const parsed = Date.parse(/(?:UTC|GMT|Z|[+-]\d{2}:?\d{2})$/i.test(raw) || !/[A-Za-z]{3}/.test(raw) ? raw : `${raw} UTC`);
  return Number.isNaN(parsed) ? raw : new Date(parsed).toISOString().slice(0, 10);
}

function formatDate(value: string | null | undefined): string {
  const iso = toIsoDate(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso || '—';
  return `${MONTHS[Number(match[2]) - 1]} ${match[3]} ${match[1]}`;
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
  const raw = String(value ?? '').split(/[\s,;]+/).filter((part) => part.trim() !== '');
  const tickers = raw.map(sanitizeTicker).filter(Boolean);
  if (raw.length && tickers.length !== raw.length) throw new Error(`TICKERS: invalid ticker in "${String(value).trim()}"`);
  return tickers.length ? new Set(tickers) : null;
}

export function readConfig(env: Record<string, string | undefined> = process.env): UpdaterConfig {
  return {
    maxFetches: parsePositiveInt(env.MAX_FETCHES, 0),
    requestSleep: parseDecimal(env.REQUEST_SLEEP, 2.5),
    aum: parseAumRange(env.AUM ?? ':'),
    ter: parseRange(env.TER ?? ':', 'TER'),
    dividendYield: parseRange(env.DIVIDEND_YIELD ?? ':', 'DIVIDEND_YIELD'),
    secYield: parseRange(env.SEC_YIELD ?? ':', 'SEC_YIELD'),
    performance: parseRanges(env, 'PERFORMANCE'),
    totalReturn: parseRanges(env, 'TOTAL_RETURN'),
    concurrency: Math.max(1, parsePositiveInt(env.CONCURRENCY, 1)),
    holdingsPageSize: Math.max(1, parsePositiveInt(env.HOLDINGS_PAGE_SIZE, 250)),
    historyPageSize: Math.max(1, parsePositiveInt(env.HISTORY_PAGE_SIZE, 1000)),
    storeRawDownloads: parseBoolean(env.STORE_RAW_DOWNLOADS),
    maxRetries: Math.max(1, parsePositiveInt(env.MAX_RETRIES, 2)),
    tickers: readTickerSet(env.TICKERS),
    historyRange: env.HISTORY_RANGE?.trim() || 'max',
    edgarFallback: !['0', 'false', 'off', 'no', 'n'].includes(String(env.EDGAR_FALLBACK ?? '1').trim().toLowerCase()),
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
    .map((line) => line.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim())
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

function normalizeLabel(value: string): string {
  return cleanText(value).replace(/[:：]+$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Catalog: product listing (one performance table per investment theme)
// ---------------------------------------------------------------------------

type ReturnSlot = Exclude<keyof OfficialReturnRow, 'asOfDate'>;

/** Maps a performance-table column header to the numeric OfficialReturnRow slot it fills. */
export function returnSlotForHeader(header: string): ReturnSlot | null {
  const text = cleanText(header).toLowerCase().replace(/\([^)]*\)/g, '').trim();
  if (text === 'ytd') return 'ytd';
  if (text === '1 month' || text === 'previous month') return 'mo1';
  if (text === '3 month' || text === '3 month total') return 'mo3';
  if (text === '1 year') return 'yr1';
  if (text === '3 year') return 'cagr3y';
  if (text === '5 year') return 'cagr5y';
  if (text === '10 year') return 'cagr10y';
  if (/^since (?:fund )?inception$/.test(text)) return 'siAnn';
  return null;
}

function returnRowHasValues(row: OfficialReturnRow): boolean {
  return [row.mo1, row.mo3, row.ytd, row.yr1, row.cagr3y, row.cagr5y, row.cagr10y, row.siAnn].some((value) => value !== null);
}

/** Cells of a markdown table row (`| a | b |`); empty for any other line. */
function tableCells(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return [];
  return trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function linkParts(cell: string): { label: string; url: string } {
  const match = /^\[([^\]]*)\]\(([^)\s]*)\)/.exec(cell.trim());
  return match ? { label: stripMarkdown(match[1]), url: absoluteUrl(match[2]) } : { label: stripMarkdown(cell), url: '' };
}

/** Fund page URL as published in the catalog (Structured Outcome funds live under a sub-path). */
function canonicalFundPage(raw: string, ticker: string): string {
  const fallback = `${PACER_SITE}/products/${ticker}`;
  try {
    const url = new URL(raw);
    if (url.hostname.replace(/^www\./, '') !== 'paceretfs.com' || !/^\/products\//i.test(url.pathname)) return fallback;
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return fallback;
  }
}

function catalogFund(ticker: string, name: string, category: string, fundPage: string): CatalogFund {
  return {
    ticker,
    name,
    category,
    categoryPath: category,
    inception: null,
    exchange: '',
    cusip: '',
    isin: '',
    benchmark: '',
    ter: null,
    grossTer: null,
    nav: null,
    close: null,
    premiumDiscount: null,
    netAssets: null,
    dividendYield: null,
    secYield: null,
    asOfDate: null,
    returns: { ...EMPTY_RETURNS },
    monthEnd: null,
    fundPage,
    source: 'pacer',
  };
}

// Section headings render as `## **![Image n](...)` + newline + ` Risk Mitigation**`.
const THEME_HEADING = /^##\s+\*\*!\[[^\]]*\]\([^)]*\)[ \t]*\r?\n[ \t]*([^*\r\n]+?)\*\*[ \t]*$/gm;

/**
 * Parses the product listing (rendered markdown through the proxy). Every
 * investment-theme section carries one table (Name | Ticker | Total Expenses |
 * Fund Inception | YTD | 1 Month | 3 Month | 1 Year | 3 Year | 5 Year | 10 Year |
 * Since Inception) headed by "Total Return as of <date>". The returns are NAV
 * total returns as of that first header date (the table's second header date
 * is a different, older series and is not used). Funds that only appear in the
 * series listing (no table row) are added with their name and page link.
 */
export function parseCatalogText(text: string): CatalogFund[] {
  const source = htmlToText(stripProxyPreamble(text));
  const funds = new Map<string, CatalogFund>();
  const themes = [...source.matchAll(THEME_HEADING)];
  themes.forEach((theme, index) => {
    const section = source.slice((theme.index ?? 0) + theme[0].length, themes[index + 1]?.index ?? source.length);
    const category = cleanText(theme[1]);
    const asOf = firstDate(/Total Return as of\s+(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(section)?.[1] ?? '');
    let header: string[] | null = null;
    for (const line of section.split('\n')) {
      const cells = tableCells(line);
      if (cells.length < 5) continue;
      const lower = cells.map((cell) => cleanText(cell).toLowerCase());
      if (lower.includes('ticker') && lower.includes('total expenses')) {
        header = lower;
        continue;
      }
      if (!header) continue;
      const tickerCell = linkParts(cells[header.indexOf('ticker')] ?? '');
      const nameCell = linkParts(cells[Math.max(0, header.indexOf('name'))] ?? '');
      const ticker = sanitizeTicker(tickerCell.label);
      if (!ticker || funds.has(ticker)) continue;
      const fund = catalogFund(ticker, cleanText(nameCell.label.replace(/\*\*/g, '')) || ticker, category, canonicalFundPage(tickerCell.url || nameCell.url, ticker));
      fund.ter = numberOrNull(/(\d+(?:\.\d+)?)%/.exec(cells[header.indexOf('total expenses')] ?? '')?.[1] ?? null);
      const inception = toIsoDate(cells[header.indexOf('fund inception')] ?? '');
      fund.inception = /^\d{4}-\d{2}-\d{2}$/.test(inception) ? inception : null;
      fund.asOfDate = asOf;
      const row = emptyReturnRow(asOf ?? '');
      header.forEach((title, column) => {
        const slot = returnSlotForHeader(title);
        if (slot) row[slot] = numberOrNull(cells[column] ?? '');
      });
      if (returnRowHasValues(row)) {
        fund.monthEnd = row;
        fund.returns = { ytd: row.ytd, yr1: row.yr1, yr3: row.cagr3y, yr5: row.cagr5y, yr10: row.cagr10y, sinceInception: row.siAnn };
      }
      funds.set(ticker, fund);
    }
  });
  // Series listing: `#### [TICKER](url)` followed by the `[Fund name](url)` link.
  const series = [...source.matchAll(/^##\s+(Pacer[^\n]*?\bSeries)\s*$/gm)];
  for (const match of source.matchAll(/####\s+\[([A-Z][A-Z0-9.]{0,5})\]\((https?:\/\/[^)\s]+)\)\s*\n+\s*\[([^\]]+)\]\(/g)) {
    const ticker = sanitizeTicker(match[1]);
    if (!ticker || funds.has(ticker)) continue;
    const heading = [...series].reverse().find((item) => (item.index ?? 0) < (match.index ?? 0));
    const label = cleanText(heading?.[1] ?? '').replace(/[®™]/g, '').replace(/^Pacer\s+/i, '').replace(/\s+ETF Series$/i, '').trim();
    funds.set(ticker, catalogFund(ticker, cleanText(match[3]), label || 'ETF', canonicalFundPage(match[2], ticker)));
  }
  if (!funds.size) throw new Error('Pacer product listing: no ETF rows found');
  return [...funds.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
}

// ---------------------------------------------------------------------------
// HTTP layer
// ---------------------------------------------------------------------------

export async function paceRequests(proxy = false): Promise<void> {
  const now = Date.now();
  if (proxy) {
    const wait = Math.max(0, proxyGateAt - now);
    proxyGateAt = Math.max(now, proxyGateAt) + Math.max(requestSleepSeconds, PROXY_SLEEP_SECONDS) * 1000;
    if (wait) await sleep(wait);
    return;
  }
  let lane = 0;
  for (let i = 1; i < requestGates.length; i++) if (requestGates[i] < requestGates[lane]) lane = i;
  const wait = Math.max(0, requestGates[lane] - now);
  requestGates[lane] = Math.max(now, requestGates[lane]) + Math.max(0, requestSleepSeconds * 1000);
  if (wait) await sleep(wait);
}

/** Pacing setup shared by main() and the offline concurrency test. */
export function configurePacing(sleepSeconds: number, concurrency: number): void {
  requestSleepSeconds = sleepSeconds;
  requestGates = new Array(Math.max(1, concurrency)).fill(0);
  proxyGateAt = 0;
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

export async function fetchText(url: string, label: string, config: UpdaterConfig, headers: Record<string, string> = {}): Promise<string> {
  let lastError: unknown = new Error('no request attempted');
  const proxy = isProxyUrl(url);
  // the rate-limited rendering proxy is retried at most once
  const maxRetries = proxy ? Math.min(config.maxRetries, 1) : config.maxRetries;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      await paceRequests(proxy);
      const response = await fetch(url, { headers: { 'User-Agent': secUa, Accept: '*/*', ...headers }, redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!response.ok) {
        const snippet = cleanText((await response.text().catch(() => '')).replace(/<[^>]+>/g, ' ')).slice(0, 160);
        throw new HttpError(response.status, `${response.status} ${response.statusText}${snippet ? ` — ${snippet}` : ''}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries || !retryable(error)) break;
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
 * then the same public URL through the read-only rendering proxy. The issuer
 * CDN answers datacenter clients with "Access Denied" (HTTP 403); after two
 * such denials in a run the direct attempt is skipped to keep the run short.
 * The proxy itself sits behind Cloudflare and challenges browser User-Agents,
 * so proxy requests declare the plain feed User-Agent. `validate` rejects
 * bot-wall/HTML error pages so that the fallback is taken instead of parsing
 * garbage.
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
// Fund page
// ---------------------------------------------------------------------------

function emptyReturnRow(asOfDate = ''): OfficialReturnRow {
  return { asOfDate, mo1: null, mo3: null, ytd: null, yr1: null, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: null };
}

/** Fund Details block: the `as of` date and the label -> value rows (footnote digits stripped from labels). */
export function parseFundDetails(lines: TextLine[]): { asOfDate: string | null; values: Map<string, string> } {
  const values = new Map<string, string>();
  const heading = lines.findIndex((line) => line.cells.length === 1 && /^fund details$/i.test(line.cells[0]));
  // Structured Outcome pages have no "Fund Details" heading: the block opens with `### as of <date>` right before the NAV row.
  const bare = lines.findIndex((line, index) => line.cells.length === 1 && /^as of\s+\d/i.test(line.cells[0]) && /^nav$/i.test(lines[index + 1]?.cells[0] ?? ''));
  const from = heading >= 0 ? heading + 1 : bare;
  if (from < 0) return { asOfDate: null, values };
  let asOfDate: string | null = null;
  for (const line of lines.slice(from, from + 40)) {
    if (line.cells.length === 1) {
      if (!asOfDate && /^as of\b/i.test(line.cells[0])) {
        asOfDate = firstDate(line.cells[0]);
        continue;
      }
      break;
    }
    const label = normalizeLabel(line.cells[0]).replace(/\*+$/, '').replace(/\s+\d+$/, '');
    if (!values.has(label)) values.set(label, line.cells.slice(1).join(' | '));
  }
  return { asOfDate, values };
}

/**
 * Recent Investment Performance: the first column group (the latest month-end
 * date) carries YTD only; the later group is the previous month-end and is not
 * used. Rows are `<fund name> NAV` and `<fund name> Market Price`.
 */
export function parseRecentPerformance(lines: TextLine[]): OfficialReturns['monthEnd'] {
  const result: OfficialReturns['monthEnd'] = { nav: null, marketPrice: null };
  const start = lines.findIndex((line) => line.cells.length === 1 && /^recent investment performance/i.test(line.cells[0]));
  if (start < 0) return result;
  let asOfDate = '';
  let ytdFirst = false;
  for (const line of lines.slice(start + 1, start + 14)) {
    if (line.cells.length === 1 && !/^as of\b/i.test(line.cells[0])) break;
    if (line.cells.length >= 1 && line.cells.every((cell) => /^as of\b/i.test(cell))) {
      asOfDate = toIsoDate(firstDate(line.cells[0]) ?? '');
      continue;
    }
    if (/^ytd$/i.test(line.cells[0] ?? '')) {
      ytdFirst = true;
      continue;
    }
    const label = line.cells[0] ?? '';
    const kind = /\sNAV$/i.test(label) ? 'nav' : /\sMarket Price$/i.test(label) ? 'marketPrice' : null;
    if (!kind || !ytdFirst || line.cells.length < 2 || result[kind]) continue;
    const row = emptyReturnRow(asOfDate);
    row.ytd = numberOrNull(line.cells[1]);
    if (returnRowHasValues(row)) result[kind] = row;
  }
  return result;
}

/**
 * Quarter-end Performance table: `as of <date>` line, a header row (Since Fund
 * Inception (date) | YTD | 1 Year | 3 Year | 5 Year | 10 Year, only the tenors
 * the fund has) and `<fund name> NAV` / `<fund name> Market Price` rows. Index
 * rows are ignored.
 */
export function parseQuarterPerformance(lines: TextLine[]): OfficialReturns['quarterEnd'] {
  const result: OfficialReturns['quarterEnd'] = { nav: null, marketPrice: null };
  const start = lines.findIndex((line) => line.cells.length === 1 && /^performance \(%\)$/i.test(line.cells[0]));
  if (start < 0) return result;
  let asOfDate = '';
  let slots: Array<ReturnSlot | null> | null = null;
  for (const line of lines.slice(start + 1, start + 16)) {
    if (line.cells.length === 1) {
      if (!asOfDate && /as of\s+\d/i.test(line.cells[0])) {
        asOfDate = toIsoDate(firstDate(line.cells[0]) ?? '');
        continue;
      }
      if (slots) break;
      continue;
    }
    if (!slots) {
      if (/^since\b/i.test(line.cells[0])) slots = line.cells.map(returnSlotForHeader);
      continue;
    }
    const label = line.cells[0];
    const kind = /\sNAV$/i.test(label) ? 'nav' : /\sMarket Price$/i.test(label) ? 'marketPrice' : null;
    if (!kind || result[kind]) continue;
    const row = emptyReturnRow(asOfDate);
    line.cells.slice(1).forEach((cell, column) => {
      const slot = slots?.[column];
      if (slot) row[slot] = numberOrNull(cell);
    });
    if (returnRowHasValues(row)) result[kind] = row;
  }
  return result;
}

/** Top 10 Holdings table (daily as-of date): Ticker | Holding | Weight, closed by a Total row. */
export function parseTopHoldings(lines: TextLine[]): TopHoldings {
  const empty: TopHoldings = { asOfDate: null, rows: [], total: null };
  const header = lines.findIndex((line) => line.cells.length >= 2 && /^ticker$/i.test(line.cells[0]) && /^holding$/i.test(line.cells[1]));
  if (header < 0) return empty;
  let asOfDate: string | null = null;
  for (let index = header - 1; index >= Math.max(0, header - 10); index -= 1) {
    const cells = lines[index].cells;
    if (cells.length === 1 && /^as of\s+\d/i.test(cells[0])) {
      asOfDate = firstDate(cells[0]);
      break;
    }
  }
  const rows: TopHolding[] = [];
  let total: number | null = null;
  for (const line of lines.slice(header + 1)) {
    const cells = line.cells;
    if (/^total$/i.test(cells[0] ?? '')) {
      total = numberOrNull(cells[1] ?? '');
      break;
    }
    // A blank ticker cell is dropped by the line model, leaving [name, weight].
    const named = cells.length >= 3 ? { ticker: cells[0], name: cells[1], weight: numberOrNull(cells[2]) } : cells.length === 2 ? { ticker: '', name: cells[0], weight: numberOrNull(cells[1]) } : null;
    if (!named || named.weight === null) break;
    rows.push({ ticker: cleanText(named.ticker).toUpperCase(), name: cleanText(named.name), weight: named.weight });
  }
  return { asOfDate, rows, total };
}

/** Distributions table: Ex Date | Record Date | Pay Date | Total Distributions | ... -> ascending {epoch, amount}. */
export function parseDistributionsTable(lines: TextLine[]): Distribution[] {
  const header = lines.findIndex((line) => line.cells.length >= 4 && /^ex[- ]?date$/i.test(line.cells[0]));
  if (header < 0) return [];
  const totalIndex = lines[header].cells.findIndex((cell) => /^total distributions?$/i.test(cell));
  if (totalIndex < 0) return [];
  const result: Distribution[] = [];
  for (const line of lines.slice(header + 1)) {
    if (!/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(line.cells[0] ?? '')) break;
    const epoch = isoToEpoch(toIsoDate(line.cells[0]));
    const amount = numberOrNull(line.cells[totalIndex] ?? '');
    if (epoch === null || amount === null || amount <= 0) continue;
    result.push({ epoch, amount: round(amount, 6) });
  }
  result.sort((a, b) => a.epoch - b.epoch);
  return result;
}

/** Official fund name: the second heading (`## TICKER` then `## Pacer ... ETF`). */
export function parseFundName(source: string, ticker: string): string | null {
  const match = new RegExp(`^##\\s+${ticker.toUpperCase()}\\s*\\n+\\s*##\\s+([^\\n]+?)\\s*$`, 'im').exec(source);
  const cleaned = match ? cleanText(match[1].replace(/\*\*/g, '')) : '';
  return cleaned || null;
}

export function parseProductPage(text: string, ticker: string): ProductPageSummary {
  const source = htmlToText(stripProxyPreamble(text));
  const lines = toTextLines(source);
  const upper = ticker.toUpperCase();
  const details = parseFundDetails(lines);
  const detail = (label: string): string => details.values.get(label) ?? '';
  const cusip = detail('cusip#').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const isin = detail('isin').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const inception = toIsoDate(detail('inception date'));
  const spread = numberOrNull(detail('30-day median bid/ask spread'));
  const monthEnd = parseRecentPerformance(lines);
  const quarterEnd = parseQuarterPerformance(lines);
  const topHoldings = parseTopHoldings(lines);
  const distributions = parseDistributionsTable(lines);
  // Page-loaded check: the Fund Details pricing block (NAV, Market Price, Net Assets and its last row, Premium/Discount) and BOTH
  // performance tables (Recent Investment Performance, Performance (%)) must be present. A page missing any of them came
  // back partial (rendering proxy), so what it lacks is unknown, not an honest absence.
  const heading = (pattern: RegExp) => lines.some((line) => line.cells.length === 1 && pattern.test(line.cells[0]));
  const sections: PageSections = {
    pricing: ['nav', 'market price', 'net assets', 'premium/discount'].every((label) => details.values.has(label)),
    recent: heading(/^recent investment performance/i) || monthEnd.nav !== null,
    quarter: heading(/^performance \(%\)$/i) || quarterEnd.nav !== null,
    secYield: details.values.has('30 day sec yield'),
    distributions: distributions.length > 0 || lines.some((line) => line.cells.length >= 4 && /^ex[- ]?date$/i.test(line.cells[0])),
    topHoldings: topHoldings.rows.length > 0 || lines.some((line) => /^top 10 holdings/i.test(line.cells[0] ?? '')),
  };
  return {
    sections,
    loadedFully: sections.pricing && sections.recent && sections.quarter,
    name: parseFundName(source, upper),
    asOfDate: details.asOfDate,
    cusip: /^[A-Z0-9]{9}$/.test(cusip) ? cusip : '',
    isin: /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin) ? isin : '',
    inception: /^\d{4}-\d{2}-\d{2}$/.test(inception) ? inception : null,
    nav: firstNumber(detail('nav')),
    marketPrice: firstNumber(detail('market price')),
    totalNetAssets: firstNumber(detail('net assets')),
    totalExpenseRatio: numberOrNull(/(\d+(?:\.\d+)?)%/.exec(detail('total expenses'))?.[1] ?? null),
    sharesOutstanding: firstNumber(detail('shares outstanding')),
    totalHoldings: firstNumber(detail('number of securities')),
    premiumDiscount: firstNumber(detail('premium/discount')),
    medianBidAskSpread: spread,
    secYield: firstNumber(detail('30 day sec yield')),
    officialReturns: { monthEnd, quarterEnd },
    topHoldings,
    distributions,
  };
}

/** Sheet rows for the official top 10 table (weights only: values are derived from net assets). */
export function topHoldingRows(top: TopHoldings, netAssets: number | null): JsonRecord[] {
  return top.rows.map((row) => ({
    Name: row.name || '-',
    Ticker: /^[A-Z]{1,5}(?:[.-][A-Z]{1,2})?$/.test(row.ticker) ? row.ticker : '-',
    Identifier: row.ticker || '-',
    Weight: String(round(row.weight, 6)),
    'Market Value': netAssets !== null ? String(round(row.weight / 100 * netAssets, 2)) : '-',
    'Shares Held': '-',
    'Asset Category': '-',
  }));
}

/** ISIN for a U.S. CUSIP: `US` + CUSIP + Luhn check digit (labelled derived in meta.json). */
export function isinFromCusip(cusip: string): string {
  const base = cleanText(cusip).toUpperCase();
  if (!/^[A-Z0-9]{9}$/.test(base)) return '';
  const digits = `US${base}`.split('').map((char) => (/[0-9]/.test(char) ? char : String(char.charCodeAt(0) - 55))).join('');
  let sum = 0;
  let double = true;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = Number(digits[i]);
    if (double) { value *= 2; if (value > 9) value -= 9; }
    sum += value;
    double = !double;
  }
  return `US${base}${(10 - (sum % 10)) % 10}`;
}

// ---------------------------------------------------------------------------
// SEC EDGAR Form N-PORT-P fallback (same resolver as daggerok/WisdomTree)
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
    holdings.push({
      Name: name,
      Ticker: '-',
      Identifier: identifier,
      Weight: weight === null ? '0' : String(weight),
      'Market Value': value === null ? '0' : String(value),
      'Shares Held': tagValue(body, 'balance') || '-',
      'Asset Category': tagValue(body, 'assetCat') || '-',
      ...(debt ? { Coupon: tagValue(debt, 'annualizedRt') || '-', Maturity: tagValue(debt, 'maturityDt') || '-' } : {}),
    });
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

/** Unix start of the Yahoo request window: 0 for max, otherwise N years back (Yahoo ignores `range` next to period1/period2). */
export function historyPeriodStart(historyRange: string, now = Date.now()): number {
  const years = /^([1-9]\d*)y$/i.exec(String(historyRange ?? '').trim());
  return years ? Math.max(0, Math.floor(now / 1000 - Number(years[1]) * 365.25 * 86_400)) : 0;
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
    qtd: pctChange(start(anchor(ordered, new Date(quarterStart.getTime() - 86_400_000))), end),
    ytd: pctChange(start(anchor(ordered, yearStart)), end),
    yr1: pctChange(start(anchor(ordered, target(1))), end),
    cagr3y: annualized(start(anchor(ordered, target(3))), end, 3),
    cagr5y: annualized(start(anchor(ordered, target(5))), end, 5),
    cagr10y: annualized(start(anchor(ordered, target(10))), end, 10),
    siAnn: ordered.length > 1 && date.getTime() - new Date(`${ordered[0].date}T00:00:00Z`).getTime() >= 365 * 86_400_000 ? annualized(ordered[0].adjClose, end, Math.max(1 / 365, (date.getTime() - new Date(`${ordered[0].date}T00:00:00Z`).getTime()) / (365.25 * 86_400_000))) : null,
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
const OFFICIAL_RETURNS_BASIS = 'official Pacer ETFs NAV total returns (product listing, month-end) where published; Yahoo adjusted market-price closes for missing values';

/** ISO date the returns are as of (official table date, else last Yahoo close), never the NAV date; null when unknown. */
export function performanceAsOfDate(effective: { asOfDate: string | null | undefined }): string | null {
  const iso = toIsoDate(effective.asOfDate ?? '');
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

export function deriveMetrics(effective: PriceReturns, fund: CatalogFund, dividends: Distribution[], frequency: { paymentsPerYear: number | null }, price: number | null, official: boolean): JsonRecord {
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
    performanceAsOf: performanceAsOfDate(effective),
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
    qtd: derived.qtd, // the product page publishes 3-month, not quarter-to-date
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
    categoryPath: String(row.category || 'ETF'),
    inception: toIsoDate(row.inceptionDate) || null,
    exchange: '', // the index row keeps its published exchange (`previous.exchange`); meta.json only carries one the listing supplied
    cusip: String(row.cusip || ''),
    isin: String(row.isin || ''),
    benchmark: '',
    ter: numberOrNull(row.terValue),
    grossTer: null,
    nav: numberOrNull(row.navValue),
    close: numberOrNull(row.closePriceValue),
    premiumDiscount: numberOrNull(row.premiumDiscountValue),
    netAssets: numberOrNull(row.aumValue),
    dividendYield: null, // always recomputed (indicated); Pacer publishes no distribution yield
    secYield: numberOrNull(metrics.secYield),
    asOfDate: null,
    returns: { ytd: numberOrNull(monthEnd.ytd), yr1: numberOrNull(monthEnd.yr1), yr3: numberOrNull(monthEnd.yr3), yr5: numberOrNull(monthEnd.yr5), yr10: numberOrNull(monthEnd.yr10), sinceInception: numberOrNull(monthEnd.sinceInception) },
    monthEnd: null,
    fundPage: String(row.fundPage || `${PACER_SITE}/products/${ticker}`),
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

/** Index row rebuilt from a published meta.json (for funds with files but no index row). */
export function rowFromMeta(meta: JsonRecord): JsonRecord {
  const ticker = String(meta.ticker);
  const returns = meta.returns || {};
  const monthEnd = returns.monthEnd || {};
  const num = (value: unknown) => numberOrNull(value);
  const text = (value: number | null) => (value === null ? '—' : `${value.toFixed(2)}%`);
  const nav = num(meta.nav?.value);
  const aum = num(meta.aum?.value);
  const price = num(meta.marketPrice?.value);
  const ter = num(meta.expenseRatio?.value);
  const premium = num(meta.premiumDiscount?.value);
  const asOf = String(returns.performanceAsOf ?? '');
  const total = (value: unknown, years: number) => annualizedToTotal(num(value), years);
  const dividendYield = num(meta.yields?.dividendYield);
  const secYield = num(meta.yields?.secYield);
  const official = String(returns.derivedFrom || '').startsWith('official');
  const distributionRows: string[][] = Array.isArray(meta.distributions?.rows) ? meta.distributions.rows : [];
  const latestDistribution = distributionRows[distributionRows.length - 1];
  return {
    ticker,
    name: String(meta.name || ticker),
    category: String(meta.category || 'ETF'),
    fundPage: String(meta.source?.fundPage || `${PACER_SITE}/products/${ticker}`),
    dataFile: `./funds/${ticker}/meta.json`,
    cusip: meta.identifiers?.cusip ?? null,
    isin: meta.identifiers?.isin ?? null,
    ter: ter === null ? '—' : `${ter}%`,
    terValue: ter,
    nav: nav === null ? '—' : `$${nav.toFixed(2)}`,
    navValue: nav,
    aum: formatAumDisplay(aum),
    aumValue: aum,
    asOfDate: String(meta.nav?.asOfDate || '—'),
    inceptionDate: '—',
    exchange: String(meta.identifiers?.exchange || ''),
    closePrice: price === null ? '—' : `$${price.toFixed(2)}`,
    closePriceValue: price,
    premiumDiscount: premium === null ? '—' : `${premium.toFixed(2)}%`,
    premiumDiscountValue: premium,
    frequencyCode: String(meta.distributions?.frequencyCode || frequencyCodeLabel(meta.distributions?.frequency)),
    distributions: { frequency: meta.distributions?.frequency || '—', exDate: latestDistribution?.[0] || '—', dividend: latestDistribution?.[1] !== undefined ? String(latestDistribution[1]) : '—' },
    returns,
    metrics: {
      ytd: num(monthEnd.ytd), tr1y: num(monthEnd.yr1), tr3y: total(monthEnd.yr3, 3), tr5y: total(monthEnd.yr5, 5), tr10y: total(monthEnd.yr10, 10),
      cagr3y: num(monthEnd.yr3), cagr5y: num(monthEnd.yr5), cagr10y: num(monthEnd.yr10), siAnn: num(monthEnd.sinceInception),
      dividendYield, dividendYieldText: text(dividendYield), secYield, secYieldText: text(secYield),
      returnsBasis: official ? OFFICIAL_RETURNS_BASIS : DERIVED_RETURNS_BASIS,
      performanceAsOf: /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : null,
    },
    holdings: num(meta.holdings?.totalRows) ?? 0,
    history: num(meta.history?.totalRows) ?? 0,
  };
}

/** Published index rows plus rows rebuilt from each fund's meta.json for funds the index forgot. */
async function readKnownFunds(previous: Map<string, JsonRecord>): Promise<Map<string, JsonRecord>> {
  const known = new Map(previous);
  let dirs: string[] = [];
  try { dirs = await outputReadDir(new URL('funds/', API_ROOT)); } catch { return known; }
  for (const dir of dirs) {
    const ticker = sanitizeTicker(dir);
    if (!ticker || known.has(ticker)) continue;
    const meta = await readPreviousMeta(dir);
    if (meta?.ticker) known.set(ticker, rowFromMeta(meta));
  }
  return known;
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
  const withoutRunTimestamp = (item: unknown): unknown => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const { generatedAt, savedAt, ...content } = item as Record<string, unknown>;
    return content;
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
  const tmp = new URL(`${file.pathname.split('/').pop()}.${process.pid}.tmp`, file);
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, file);
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
  return { pages: [...kept].sort().map((name) => `${kind}/${name}`), pageSize, totalRows: rows.length, ...(kind === 'holdings' ? { asOfDate, asOf: asOfDate ? formatDate(asOfDate) : '—', source } : { asOf: asOfDate ? formatDate(asOfDate) : '—', source }) };
}

/** Stale pages go only after the new meta.json is written, so a crash never leaves a manifest pointing at removed pages. */
async function removeStalePages(fundDir: URL, kind: 'holdings' | 'history', manifest: JsonRecord): Promise<void> {
  const dir = new URL(`${kind}/`, fundDir);
  const kept = new Set((manifest.pages as string[]).map((page) => page.split('/').pop()));
  try {
    for (const name of await readdir(dir)) if (name.endsWith('.json') && !kept.has(name)) await rm(new URL(name, dir), { force: true });
  } catch {
    // Directory may not exist on a zero-row first run.
  }
}

function catalogFilterReasons(fund: CatalogFund, config: UpdaterConfig): string[] {
  const reasons: string[] = [];
  if (config.tickers && !config.tickers.has(fund.ticker)) reasons.push('TICKERS');
  if (!rangeMatches(fund.ter, config.ter)) reasons.push('TER');
  return reasons;
}

export function postFetchFilterReasons(fund: CatalogFund, metrics: JsonRecord, config: UpdaterConfig): string[] {
  const reasons: string[] = [];
  if (!rangeMatches(fund.netAssets, config.aum)) reasons.push('AUM');
  if (!rangeMatches(numberOrNull(metrics.dividendYield), config.dividendYield)) reasons.push('DIVIDEND_YIELD');
  if (!rangeMatches(numberOrNull(metrics.secYield), config.secYield)) reasons.push('SEC_YIELD');
  const annual: Record<ReturnPeriod, number | null> = { YTD: metrics.ytd, '1Y': metrics.tr1y, '3Y': metrics.cagr3y, '5Y': metrics.cagr5y, '10Y': metrics.cagr10y };
  const cumulative: Record<ReturnPeriod, number | null> = { YTD: metrics.ytd, '1Y': metrics.tr1y, '3Y': metrics.tr3y, '5Y': metrics.tr5y, '10Y': metrics.tr10y };
  for (const [period, range] of Object.entries(config.performance) as [ReturnPeriod, Range][]) if (!rangeMatches(annual[period], range)) reasons.push(`PERFORMANCE_${period}`);
  for (const [period, range] of Object.entries(config.totalReturn) as [ReturnPeriod, Range][]) if (!rangeMatches(cumulative[period], range)) reasons.push(`TOTAL_RETURN_${period}`);
  return reasons;
}

// ---------------------------------------------------------------------------
// Per-fund pipeline
// ---------------------------------------------------------------------------

/**
 * Holdings when no N-PORT-P schedule was read: a previously published full
 * schedule beats a fresh but partial top 10; the top 10 beats nothing.
 */
export function holdingsFallback(previousCount: number, topCount: number): 'previous' | 'top10' | 'none' {
  if (previousCount > 0 && (previousCount > topCount || topCount === 0)) return 'previous';
  return topCount > 0 ? 'top10' : 'none';
}

/** The proxied/direct catalog must carry the performance tables and fund links, not a bot wall. */
export function isCatalogPage(text: string): boolean {
  const source = htmlToText(stripProxyPreamble(text));
  return /Total Return as of\s+\d/i.test(source) && /\]\(https?:\/\/[^)\s]*\/products\//i.test(source);
}

/**
 * A fund page must carry the Fund Details table (a numeric NAV or Net Assets row), not a bot wall. This only separates
 * a fund page from garbage; whether the page loaded fully (pricing block and both performance tables) is
 * `parseProductPage(...).loadedFully`, and a partial page is handled per section by `retainPublishedSections`.
 */
export function isFundPage(text: string): boolean {
  return /\|\s*(?:Net Assets|NAV)\s*\|\s*\$?\d[\d,]*/i.test(htmlToText(stripProxyPreamble(text)));
}

const OFFICIAL_PRICE_SOURCE = 'official fund page Market Price';
const OFFICIAL_PREMIUM_SOURCE = 'official fund page Fund Details Premium/Discount';
const OFFICIAL_AUM_SOURCE = 'official fund page Net Assets';
const OFFICIAL_DISTRIBUTIONS_SOURCE = 'paceretfs.com fund page Distributions table';
const NO_DATA_BASIS = 'no data published for this fund yet; the next successful update fills it';

/** A published returns block (returnRowJson / quarterEnd shape) back as an official row; null when it carries no figure. */
function officialRowFromPublished(block: any): OfficialReturnRow | null {
  if (!block || typeof block !== 'object') return null;
  const asOf = toIsoDate(block.asOfDate);
  const row: OfficialReturnRow = {
    asOfDate: /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : '',
    mo1: numberOrNull(block.mo1), mo3: numberOrNull(block.mo3), ytd: numberOrNull(block.ytd), yr1: numberOrNull(block.yr1),
    cagr3y: numberOrNull(block.yr3), cagr5y: numberOrNull(block.yr5), cagr10y: numberOrNull(block.yr10), siAnn: numberOrNull(block.sinceInception),
  };
  return returnRowHasValues(row) ? row : null;
}

/**
 * A fund page that came back partial (the rendering proxy dropped sections: see `loadedFully`) says nothing about the
 * sections it lacks, and a listing that did not carry a fund's table row says nothing about its month-end returns.
 * Every section that was published as official before and is missing now counts as a FAILED read: its previous official
 * block is restored into `summary`/`fund` as one unit (values with their as-of dates, basis and sources), so the normal
 * build republishes it unchanged instead of flipping to Yahoo-derived values or null. A page that loaded fully and lacks
 * a field is an honest null and never gets here. Returns the names of the kept sections.
 */
function retainPublishedSections(summary: ProductPageSummary | null, fund: CatalogFund, previousMeta: JsonRecord | null, listingRead: boolean): string[] {
  if (!previousMeta) return [];
  const kept: string[] = [];
  const asIso = (value: unknown) => { const iso = toIsoDate(value); return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null; };
  if (summary && !summary.sections.pricing) {
    const price = previousMeta.marketPrice;
    const premium = previousMeta.premiumDiscount;
    const aum = previousMeta.aum;
    const officialPrice = String(price?.source || '').startsWith(OFFICIAL_PRICE_SOURCE) && numberOrNull(price.value) !== null;
    const officialAum = String(aum?.source || '').startsWith(OFFICIAL_AUM_SOURCE) && numberOrNull(aum.value) !== null;
    if (officialPrice || officialAum) {
      const asOf = asIso(previousMeta.nav?.asOfDate);
      summary.asOfDate = asOf;
      if (asOf) fund.asOfDate = asOf;
      summary.nav = numberOrNull(previousMeta.nav?.value);
      fund.nav = summary.nav;
      summary.marketPrice = officialPrice ? numberOrNull(price.value) : null;
      fund.close = summary.marketPrice;
      summary.totalNetAssets = officialAum ? numberOrNull(aum.value) : null;
      fund.netAssets = summary.totalNetAssets;
      summary.premiumDiscount = String(premium?.source || '').startsWith(OFFICIAL_PREMIUM_SOURCE) ? numberOrNull(premium.value) : null;
      fund.premiumDiscount = summary.premiumDiscount;
      const yields = previousMeta.yields || {};
      summary.secYield = String(yields.secYieldKind || '').startsWith('30 Day SEC Yield') ? numberOrNull(yields.secYield) : null;
      fund.secYield = summary.secYield;
      const facts = previousMeta.fundFacts || {};
      summary.sharesOutstanding = numberOrNull(facts.sharesOutstanding);
      summary.totalHoldings = numberOrNull(facts.publishedTotalHoldings);
      summary.medianBidAskSpread = numberOrNull(facts.medianBidAskSpread);
      const ids = previousMeta.identifiers || {};
      if (ids.cusip) { summary.cusip = String(ids.cusip); fund.cusip = summary.cusip; }
      if (ids.isin && String(ids.isinBasis || '').startsWith('published')) { summary.isin = String(ids.isin); fund.isin = summary.isin; }
      else if (ids.isin) fund.isin = String(ids.isin);
      kept.push('fund details (price, NAV, premium/discount, net assets, SEC yield)');
    }
  }
  const previousReturns = previousMeta.returns || {};
  const officialBasis = String(previousReturns.derivedFrom || '').startsWith('official');
  // Month-end returns come from the listing table (all tenors); the page's Recent Investment Performance carries the YTD
  // column only, so it never stands in for a listing that was not read.
  if (!listingRead && !fund.monthEnd && officialBasis) {
    const monthEnd = officialRowFromPublished(previousReturns.monthEnd);
    if (monthEnd) { fund.monthEnd = monthEnd; kept.push('month-end returns'); }
  }
  if (summary && !summary.sections.recent) {
    const marketPrice = officialRowFromPublished(previousMeta.officialMarketPriceReturns?.monthEnd);
    if (marketPrice) { summary.officialReturns.monthEnd.marketPrice = marketPrice; kept.push('recent performance (market price)'); }
  }
  if (summary && !summary.sections.quarter) {
    const quarter = officialRowFromPublished(previousReturns.quarterEnd);
    const marketPrice = officialRowFromPublished(previousMeta.officialMarketPriceReturns?.quarterEnd);
    if (quarter || marketPrice) {
      summary.officialReturns.quarterEnd = { nav: quarter, marketPrice };
      kept.push('quarter-end performance');
    }
  }
  if (summary && !summary.sections.distributions && !summary.distributions.length && String(previousMeta.distributions?.source || '').startsWith(OFFICIAL_DISTRIBUTIONS_SOURCE) && Array.isArray(previousMeta.distributions?.rows) && previousMeta.distributions.rows.length) {
    kept.push('distributions');
  }
  return kept;
}

/** The metrics key set every index row carries (numbers in percent, null for unavailable, never 0). */
export function emptyMetrics(): JsonRecord {
  return {
    ytd: null, tr1y: null, tr3y: null, tr5y: null, tr10y: null, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: null,
    dividendYield: null, dividendYieldText: '—', secYield: null, secYieldText: '—',
    returnsBasis: NO_DATA_BASIS, performanceAsOf: null,
  };
}

/** Index row for a catalog fund that has no published data yet: no meta.json, so dataFile is null and every metric is null. */
export function placeholderRow(fund: Pick<CatalogFund, 'ticker' | 'name' | 'category' | 'fundPage' | 'cusip' | 'isin' | 'exchange' | 'ter'>): JsonRecord {
  return {
    ticker: fund.ticker,
    name: fund.name,
    category: fund.category,
    fundPage: fund.fundPage,
    dataFile: null,
    cusip: fund.cusip || null,
    isin: fund.isin || null,
    ter: fund.ter === null ? '—' : `${fund.ter}%`,
    terValue: fund.ter,
    nav: '—', navValue: null, aum: '—', aumValue: null,
    asOfDate: '—', inceptionDate: '—', exchange: fund.exchange || '',
    closePrice: '—', closePriceValue: null, premiumDiscount: '—', premiumDiscountValue: null,
    frequencyCode: frequencyCodeLabel('None'),
    distributions: { frequency: '—', exDate: '—', dividend: '—' },
    returns: {},
    metrics: emptyMetrics(),
    holdings: 0,
    history: 0,
  };
}

const PROVIDER_LABEL = 'Pacer ETFs product listing + official fund pages (read-only rendering proxy) + SEC EDGAR Form N-PORT-P full holdings + Yahoo Finance public chart API';

async function processFund(fund: CatalogFund, config: UpdaterConfig, previous: JsonRecord = {}): Promise<JsonRecord> {
  const reasons = catalogFilterReasons(fund, config);
  if (reasons.length) {
    return { __skipped: true, ticker: fund.ticker, __skipReasons: reasons };
  }
  const fundDir = new URL(`funds/${fund.ticker}/`, API_ROOT);
  const previousMeta = await readPreviousMeta(fund.ticker);
  // The listing carried this fund's table row (its as-of date is set only from that row); a fund restored from the
  // published index, or one the listing only names in its series section, has no fresh month-end returns.
  const listingRead = fund.source === 'pacer' && Boolean(fund.asOfDate);

  // 1. Official fund page (WAF host: read-only rendering proxy) -------------------
  let summary: ProductPageSummary | null = null;
  let productVia: 'direct' | 'proxy' | null = null;
  if (!config.skipPacer && fund.fundPage) {
    try {
      const page = await fetchIssuerText(fund.fundPage, `[product ] ${fund.ticker}`, config, isFundPage, undefined, { cache: false });
      productVia = page.via;
      summary = parseProductPage(page.text, fund.ticker);
      if (config.storeRawDownloads) {
        const raw = new URL('raw/', API_ROOT);
        await mkdir(raw, { recursive: true });
        await writeFile(new URL(`${fund.ticker}-fund-page.${page.via === 'proxy' ? 'md' : 'html'}`, raw), page.text, 'utf8');
      }
      if (summary.name) fund.name = summary.name;
      if (summary.cusip) fund.cusip = summary.cusip;
      if (summary.isin) fund.isin = summary.isin;
      if (summary.inception) fund.inception = summary.inception;
      if (summary.totalExpenseRatio !== null) fund.ter = summary.totalExpenseRatio;
      if (summary.asOfDate) fund.asOfDate = summary.asOfDate;
      if (summary.sections.pricing) {
        // The pricing block loaded: a value it lacks is an honest null, never refilled from the published index.
        fund.nav = summary.nav;
        fund.close = summary.marketPrice;
        fund.netAssets = summary.totalNetAssets;
        fund.premiumDiscount = summary.premiumDiscount;
        fund.secYield = summary.secYield;
      } else {
        if (summary.nav !== null) fund.nav = summary.nav;
        if (summary.marketPrice !== null) fund.close = summary.marketPrice;
        if (summary.totalNetAssets !== null) fund.netAssets = summary.totalNetAssets;
        if (summary.premiumDiscount !== null) fund.premiumDiscount = summary.premiumDiscount;
        if (summary.secYield !== null) fund.secYield = summary.secYield;
      }
    } catch (error) {
      outputNote(`[ ${'product'.padEnd(9)}] ${fund.ticker}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  // A partial page (or a listing without this fund's row) keeps what was published as official: one notice per fund.
  const keptSections = retainPublishedSections(summary, fund, previousMeta, listingRead);
  if (keptSections.length) console.log(`[ ${'kept'.padEnd(9)}] ${fund.ticker}: ${summary && !summary.loadedFully ? 'fund page came back partial' : 'source unavailable'}${listingRead ? '' : ' / listing without this fund\'s returns'}, kept the published ${keptSections.join(', ')}`);
  if (!fund.isin && fund.cusip) fund.isin = isinFromCusip(fund.cusip);

  // 2. Holdings: N-PORT-P (full) -> official top 10 (partial) -> previous run ------
  let holdingsRows: JsonRecord[] = [];
  let holdingsHeaders: string[] = HOLDINGS_HEADERS;
  let holdingsAsOf: string | null = null;
  let holdingsSource = 'not available from a public SEC filing or the official fund page top 10 table';
  let holdingsDownload: string | null = null;
  let marketValueBasis: string | null = null;
  let nport: ParsedNport | null = null;
  const topRows = summary ? topHoldingRows(summary.topHoldings, fund.netAssets) : [];
  if (config.edgarFallback) {
    try {
      const filing = await resolveNportFiling(fund, config);
      if (filing) {
        const parsed = parseNport(await fetchText(filing.accession.url, `[nport   ] ${fund.ticker}`, config, secHeaders()));
        const seriesMatches = !parsed.seriesId || parsed.seriesId.toUpperCase() === filing.ref.seriesId.toUpperCase();
        if (seriesMatches && parsed.holdings.length) {
          const names = await loadCompanyTickerTable(config);
          holdingsRows = fillNportTickers(parsed.holdings, names);
          holdingsHeaders = holdingsRows.some((row) => 'Coupon' in row || 'Maturity' in row) ? BOND_HOLDINGS_HEADERS : HOLDINGS_HEADERS;
          holdingsAsOf = parsed.repPdDate || null;
          nport = parsed;
          holdingsDownload = filing.accession.url;
          holdingsSource = `SEC EDGAR Form N-PORT-P (accession ${filing.accession.accession}, report period ${parsed.repPdDate || 'n/a'})`;
          marketValueBasis = 'SEC Form N-PORT-P reported value (valUSD)';
        }
      }
    } catch (error) {
      outputNote(`[ ${'nport'.padEnd(9)}] ${fund.ticker}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!holdingsRows.length) {
    // A previously published full schedule beats a fresh but partial top 10.
    const previousRows = await readPreviousSheet(fund.ticker, 'holdings');
    const fallback = holdingsFallback(previousRows.length, topRows.length);
    if (fallback === 'previous') {
      holdingsRows = previousRows;
      holdingsHeaders = (await readPreviousHeaders(fund.ticker, 'holdings')) || holdingsHeaders;
      holdingsAsOf = previousMeta?.holdings?.asOfDate || null;
      holdingsSource = previousMeta?.holdings?.source || holdingsSource;
      holdingsDownload = previousMeta?.source?.holdingsDownload || holdingsDownload;
      marketValueBasis = previousMeta?.holdings?.marketValueBasis || marketValueBasis;
    } else if (fallback === 'top10') {
      holdingsRows = topRows;
      holdingsAsOf = summary?.topHoldings.asOfDate || null;
      holdingsDownload = fund.fundPage;
      holdingsSource = `paceretfs.com fund page Top 10 Holdings (partial: ${topRows.length} positions only; the full Daily Holdings file is a protected download and no SEC N-PORT-P filing was available${productVia === 'proxy' ? '; read via the rendering proxy' : ''})`;
      marketValueBasis = fund.netAssets !== null ? 'derived: weight x Total Net Assets (the fund page publishes weights, not values)' : 'not derivable: Total Net Assets unavailable in this run';
    }
  }

  // 3. Distributions: fund page table -> Yahoo dividends -> previous run ---------
  let dividends: Distribution[] = summary?.distributions.length ? summary.distributions : [];
  let distributionsSource = 'not available';
  const distributionsDownload: string | null = fund.fundPage || null;
  if (!dividends.length && keptSections.includes('distributions')) {
    // the page's Distributions table is missing: the published official table stands (not Yahoo events)
    const rows: string[][] = previousMeta!.distributions.rows;
    dividends = rows.map((row) => ({ epoch: isoToEpoch(toIsoDate(row[0])) ?? 0, amount: numberOrNull(row[1]) ?? 0 })).filter((item) => item.epoch > 0 && item.amount > 0);
    distributionsSource = previousMeta!.distributions.source;
  }
  if (summary?.distributions.length) distributionsSource = `paceretfs.com fund page Distributions table (Total Distributions per share${productVia === 'proxy' ? ', via read-only rendering proxy' : ''})`;

  // 4. Yahoo chart: history + dividend fallback --------------------------------
  let chart: ParsedChart | null = null;
  let days: ChartDay[] = [];
  let historySource = 'Yahoo Finance public chart API (adjusted close)';
  if (!config.skipYahoo) {
    try {
      // Yahoo ignores `range` once period1/period2 are present, so an `Ny` window is
      // applied through period1 (merged from PR #3); other range tokens are passed as-is.
      const query = new URLSearchParams({ period1: String(historyPeriodStart(config.historyRange)), period2: String(Math.floor(Date.now() / 1000) + 86_400), interval: '1d', events: 'div|split', includeAdjustedClose: 'true' });
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
    distributionsSource = 'Yahoo Finance chart dividend events (fund page Distributions table unavailable)';
  }
  let distributionTable: string[][] = dividends.length ? distributionRows(dividends) : [];
  if (!distributionTable.length && Array.isArray(previousMeta?.distributions?.rows) && previousMeta.distributions.rows.length) {
    distributionTable = previousMeta.distributions.rows;
    distributionsSource = previousMeta.distributions.source || 'previous run';
    dividends = distributionTable.map((row) => ({ epoch: isoToEpoch(toIsoDate(row[0])) ?? 0, amount: numberOrNull(row[1]) ?? 0 })).filter((item) => item.epoch > 0 && item.amount > 0);
  }

  // 5. Returns + metrics --------------------------------------------------------
  const frequency = inferDistributionFrequency(dividends);
  const latest = dividends[dividends.length - 1] || null;
  const derived = priceReturns(days);
  const officialMonthly = fund.monthEnd || summary?.officialReturns.monthEnd.nav || null;
  const officialQuarterly = summary?.officialReturns.quarterEnd.nav || null;
  const effective = mergeOfficialReturns(derived, officialMonthly);
  const officialPrice = summary?.marketPrice ?? null;
  // The published index fills a value only when the pricing block was not read at all (SKIP_PACER, or a failed read keeps the
  // fund whole below); a page whose pricing block loaded and lacks a value publishes null (an unlabelled Yahoo price is
  // never shown as the official one: the source label says which it is).
  const pricingRead = Boolean(summary?.sections.pricing);
  const marketPrice = officialPrice ?? chart?.regularMarketPrice ?? (days.length ? days[days.length - 1].close : pricingRead ? null : numberOrNull(previous.closePriceValue));
  const nav = pricingRead ? summary!.nav : (fund.nav ?? numberOrNull(previous.navValue));
  const metrics = deriveMetrics(effective, fund, dividends, frequency, nav ?? marketPrice, Boolean(officialMonthly));
  const skipReasons = postFetchFilterReasons(fund, metrics, config);
  if (skipReasons.length) {
    return { __skipped: true, ticker: fund.ticker, __skipReasons: skipReasons };
  }

  // A fund is either fully updated or fully kept: when a required source failed for a fund that is already
  // published, keep its previous complete state instead of mixing fresh columns with stale ones.
  // A fund with no published data has nothing to keep: it is not written at all and gets a catalog-only index row (dataFile null).
  if ((!config.skipPacer && fund.fundPage && !summary) || (!config.skipYahoo && !chart)) {
    throw new Error(`required source failed (${!summary && !config.skipPacer ? 'product page' : 'Yahoo chart'}); ${previousMeta ? 'kept the previous complete data' : 'no data published for this fund yet'}`);
  }

  // 6. Write sheets, meta.json and the index row --------------------------------
  await mkdir(fundDir, { recursive: true });
  const history = historyRows(days);
  const historyAsOf = derived.asOfDate || previousMeta?.history?.asOf || null;
  const holdingManifest = await writePages(fundDir, fund.ticker, 'holdings', holdingsHeaders, holdingsRows, config.holdingsPageSize, holdingsAsOf, holdingsSource);
  if (marketValueBasis) holdingManifest.marketValueBasis = marketValueBasis;
  if (summary?.totalHoldings !== null && summary?.totalHoldings !== undefined) holdingManifest.publishedTotalHoldings = summary.totalHoldings;
  const historyManifest = await writePages(fundDir, fund.ticker, 'history', historyHeaders(), history, config.historyPageSize, historyAsOf, historySource);
  const distributionFrequency = dividends.length ? frequency.frequency : (previousMeta?.distributions?.frequency || '—');
  const premiumDiscount = fund.premiumDiscount ?? (nav && marketPrice ? round((marketPrice / nav - 1) * 100, 2) : pricingRead ? null : numberOrNull(previous.premiumDiscountValue));
  const netAssets = fund.netAssets ?? nport?.netAssets ?? (pricingRead ? null : numberOrNull(previous.aumValue));
  const asOfDate = fund.asOfDate || toIsoDate(previous.asOfDate) || null;
  const asOfLabel = asOfDate ? formatDate(asOfDate) : chart?.regularMarketTime ? formatDate(new Date(chart.regularMarketTime * 1000).toISOString().slice(0, 10)) : '—';
  const marketPriceAsOfLabel = officialPrice !== null ? asOfLabel : chart?.regularMarketTime ? formatDate(new Date(chart.regularMarketTime * 1000).toISOString().slice(0, 10)) : (days.length ? formatDate(days[days.length - 1].date) : asOfLabel);
  const text = (value: number | null) => (value === null ? '—' : `${value.toFixed(2)}%`);
  const returns: JsonRecord = {
    derivedFrom: officialMonthly ? OFFICIAL_RETURNS_BASIS : DERIVED_RETURNS_BASIS,
    performanceAsOf: metrics.performanceAsOf,
    monthEnd: {
      asOfDate: effective.asOfDate ? formatDate(effective.asOfDate) : '—',
      mo1: effective.mo1, mo1Text: text(effective.mo1),
      mo3: officialMonthly?.mo3 ?? null, mo3Text: text(officialMonthly?.mo3 ?? null),
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
      ytd: officialQuarterly.ytd,
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
      productPageRendering: productVia ? (productVia === 'proxy' ? 'read-only rendering proxy (r.jina.ai) of the official fund page' : 'official fund page (direct)') : 'not fetched in this run',
      productPageAsOf: summary?.asOfDate ? formatDate(summary.asOfDate) : null,
      catalogListing: PACER_CATALOG_URL,
      holdingsDownload,
      officialHoldingsDownload: `${PACER_SITE}/products/holdings_download/${fund.ticker}`,
      officialHoldingsDownloadNote: 'protected Daily Holdings download (Cloudflare challenge; not readable by the updater)',
      distributionsDownload,
      yahooChart: `${YAHOO_CHART_URL}/${encodeURIComponent(fund.ticker)}`,
      holdingsSource,
      historySource,
      distributionsSource,
      provider: PROVIDER_LABEL,
    },
    identifiers: { cusip: fund.cusip || null, isin: fund.isin || null, isinBasis: fund.isin ? (summary?.isin && summary.isin === fund.isin ? 'published on the official fund page' : fund.cusip && fund.isin === isinFromCusip(fund.cusip) ? 'derived from the published CUSIP (US prefix + check digit)' : 'previous run') : null, indexTicker: fund.benchmark || null, exchange: fund.exchange || null },
    expenseRatio: { display: fund.ter === null ? '—' : `${fund.ter}%`, value: fund.ter, gross: fund.grossTer, kind: 'Total Expenses published on the official fund page (product listing for funds without a page value)' },
    nav: { display: nav === null ? '—' : `$${nav.toFixed(2)}`, value: nav, asOfDate: summary?.asOfDate ? formatDate(summary.asOfDate) : asOfLabel },
    marketPrice: { display: marketPrice === null ? '—' : `$${marketPrice.toFixed(2)}`, value: marketPrice, asOfDate: marketPriceAsOfLabel, source: officialPrice !== null ? 'official fund page Market Price (closing price as of the Fund Details date)' : chart ? 'Yahoo Finance last regular-session price (the fund page published no market price)' : 'previous run' },
    premiumDiscount: { display: premiumDiscount === null ? '—' : `${premiumDiscount.toFixed(2)}%`, value: premiumDiscount, asOfDate: asOfLabel, source: summary?.premiumDiscount !== null && summary?.premiumDiscount !== undefined ? 'official fund page Fund Details Premium/Discount' : 'computed from market price / NAV' },
    aum: { display: formatAumDisplay(netAssets), value: netAssets, asOfDate: summary?.totalNetAssets !== null && summary?.totalNetAssets !== undefined ? asOfLabel : (nport?.repPdDate ? formatDate(nport.repPdDate) : asOfLabel), source: summary?.totalNetAssets !== null && summary?.totalNetAssets !== undefined ? 'official fund page Net Assets' : nport ? `SEC Form N-PORT-P net assets (${nport.repPdDate || 'n/a'})` : 'previous run' },
    fundFacts: { sharesOutstanding: summary?.sharesOutstanding ?? null, publishedTotalHoldings: summary?.totalHoldings ?? null, medianBidAskSpread: summary?.medianBidAskSpread ?? null },
    yields: {
      dividendYield: metrics.dividendYield,
      dividendYieldText: metrics.dividendYieldText,
      dividendYieldKind: 'indicated (latest distribution x inferred payments per year / NAV; Pacer publishes no distribution yield)',
      secYield: metrics.secYield,
      secYieldText: metrics.secYieldText,
      secYieldKind: fund.secYield !== null ? `30 Day SEC Yield published on the official fund page${summary?.secYield !== null && summary?.secYield !== undefined && summary.asOfDate ? ` as of ${formatDate(summary.asOfDate)}` : ''}` : 'not published on the official fund page for this fund',
    },
    returns,
    officialMarketPriceReturns: summary ? { monthEnd: returnRowJson(summary.officialReturns.monthEnd.marketPrice), quarterEnd: returnRowJson(summary.officialReturns.quarterEnd.marketPrice) } : null,
    distributions: { frequency: distributionFrequency, frequencyCode: frequencyCodeLabel(distributionFrequency), paymentsPerYear: frequency.paymentsPerYear, source: distributionsSource, headers: ['Ex-Date', 'Amount'], rows: distributionTable },
    holdings: holdingManifest,
    history: historyManifest,
  };
  await writeIfChanged(new URL('meta.json', fundDir), meta);
  await removeStalePages(fundDir, 'holdings', holdingManifest);
  await removeStalePages(fundDir, 'history', historyManifest);

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

const USAGE = `
Pacer ETFs static data updater

Sources:
  catalog       paceretfs.com product listing (performance table per investment
                theme: name, ticker, total expenses, inception, NAV total
                returns); read through the read-only r.jina.ai rendering proxy
                when direct requests are refused (Cloudflare challenge)
  fund page     official per-fund page: Fund Details, quarter-end performance,
                top 10 holdings, distribution history
  holdings      SEC EDGAR Form N-PORT-P full schedule (Pacer Funds Trust); the
                official top 10 table is a labelled partial fallback
  distributions fund page Distributions table (Yahoo dividend events fallback)
  history       Yahoo Finance public chart API (adjusted market-price closes)

Configuration: scripts/update-data.config.json defaults < advanced JSON (workflow
only) < nonblank workflow inputs < environment variables below (all filters use
AND logic):
  MAX_FETCHES=0       all eligible funds; positive value is a resumable batch
  REQUEST_SLEEP=2.5   seconds between request starts (proxy requests >= 3.2s)
  CONCURRENCY=1       parallel fund workers, each with its own paced request lane (rendering-proxy requests share one global gate)
  AUM=:\n  TER=:\n  DIVIDEND_YIELD=:\n  SEC_YIELD=:\n  TICKERS="COWZ FLRT"  optional ticker allowlist
  PERFORMANCE_YTD|1Y|3Y|5Y|10Y=min:max   annualized ranges
  TOTAL_RETURN_YTD|1Y|3Y|5Y|10Y=min:max cumulative ranges
  HOLDINGS_PAGE_SIZE=250
  HISTORY_PAGE_SIZE=1000
  HISTORY_RANGE=max   Yahoo history window: max or Ny (for example 5y), applied through explicit period1/period2
  MAX_RETRIES=2       retries after the initial request (integer >= 1)
  STORE_RAW_DOWNLOADS=false
  EDGAR_FALLBACK=true full holdings from SEC EDGAR Form N-PORT-P (off keeps the official top 10 or the previous holdings)
  SEC_UA=             SEC User-Agent (default: daggerok ETF feed daggerok@gmail.com; redacted in logs)
  VERBOSE=false
  USE_SYSTEM_CA=auto  TLS trust store: auto restarts once with Bun's --use-system-ca after an untrusted-certificate error; true always uses the system CA store; false never restarts
  SKIP_PACER=off      use the previously published catalog/fund page data
  SKIP_YAHOO=off      keep previously published history when possible

Examples:
  TICKERS="COWZ FLRT PSFF" ./scripts/update-data.ts
  AUM="large:" TER=":0.50" ./scripts/update-data.ts
  PERFORMANCE_3Y="10:" TOTAL_RETURN_1Y="15:" ./scripts/update-data.ts
`;

// File defaults and explicit overrides: allowlisted scalar controls only, so
// GitHub Actions can resolve them without interpolating user input into bash.
// Precedence: config file < advanced JSON < nonblank inputs < environment.
export const CONTROL_NAMES = [
  'MAX_FETCHES', 'REQUEST_SLEEP', 'CONCURRENCY', 'AUM', 'TER', 'DIVIDEND_YIELD', 'SEC_YIELD', 'TICKERS',
  'HOLDINGS_PAGE_SIZE', 'HISTORY_PAGE_SIZE', 'STORE_RAW_DOWNLOADS', 'MAX_RETRIES', 'HISTORY_RANGE',
  'EDGAR_FALLBACK', 'SKIP_YAHOO', 'SKIP_PACER', 'SEC_UA', 'VERBOSE', 'USE_SYSTEM_CA',
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
  if (result.USE_SYSTEM_CA !== undefined && !/^(auto|true|false)$/i.test(result.USE_SYSTEM_CA.trim())) throw new Error('USE_SYSTEM_CA: expected auto, true or false');
  const range = result.HISTORY_RANGE?.trim();
  if (range && !/^(max|[1-9]\d*y)$/i.test(range)) throw new Error('HISTORY_RANGE: expected max or Ny (for example 5y)');
  readConfig(result); // validate every min:max filter before any request or write
  return result;
}

export async function runtimeControls(env: Record<string, string | undefined> = process.env): Promise<Record<string, string>> {
  const file = JSON.parse(await readFile(CONFIG_FILE_URL, 'utf8'));
  return resolveControls(file, {}, {}, env);
}

/** The workflow times out at 30 min: stop taking new funds after 25 and still write the index. */
export const SOFT_DEADLINE_MS = 25 * 60 * 1000;
export function softDeadlineReached(startedAt: number, now: number, limit = SOFT_DEADLINE_MS): boolean {
  return now - startedAt >= limit;
}

/** Any accepted date form ("2026-09-30", "Sep 30 2026", "9/30/2026") as an ISO day, or null. */
function isoDay(value: unknown): string | null {
  const iso = toIsoDate(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const parsed = typeof value === 'string' ? Date.parse(`${value} UTC`) : NaN;
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
}

/**
 * ISO date a published index row is refreshed up to (the latest of its dated fields),
 * or null when the fund has no published data yet.
 */
export function publishedAsOf(row: JsonRecord | null | undefined): string | null {
  if (!row || row.dataFile === null) return null;
  const dates = [row.asOfDate, row.metrics?.performanceAsOf].map(isoDay).filter((value): value is string => value !== null);
  return dates.length ? dates.sort()[dates.length - 1] : null;
}

/**
 * Run order of an unbounded run: funds without published data first, then the stalest
 * published as-of, ties alphabetical. A run cut short by the soft deadline therefore
 * leaves the freshest funds for last, and the next run starts where this one stopped.
 */
export function stalestFirst<T extends { ticker: string }>(funds: T[], published: Map<string, JsonRecord>): T[] {
  const key = (fund: T): string => publishedAsOf(published.get(fund.ticker)) ?? '';
  return [...funds].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a.ticker.localeCompare(b.ticker)));
}

/** One line for the log and the step summary: what a deadline-truncated run left behind. */
export function deadlineSummary(attempted: number, total: number, remaining: Array<{ ticker: string }>, published: Map<string, JsonRecord>): string {
  const ordered = stalestFirst(remaining, published);
  const oldest = ordered.length ? `${publishedAsOf(published.get(ordered[0].ticker)) ?? 'never published'} (${ordered[0].ticker})` : 'none';
  return `${attempted} of ${total} funds refreshed, ${remaining.length} keep their published data, oldest remaining published as-of: ${oldest}`;
}

async function readCursorState(): Promise<{ cursor: string; scope: string } | null> {
  try {
    const state = JSON.parse(await readFile(STATE_FILE, 'utf8')) as JsonRecord;
    return { cursor: String(state.cursor || ''), scope: String(state.scope ?? '') };
  } catch {
    return null;
  }
}

/** Starts `count` workers at once and resolves when all of them are done. */
export async function runWorkers(count: number, worker: () => Promise<void>): Promise<void> {
  await Promise.all(Array.from({ length: Math.max(1, count) }, () => worker()));
}

/** Pacing setup shared by main() and the offline concurrency test. */
export function configurePacing(sleepSeconds: number, concurrency: number): void {
  requestSleepSeconds = sleepSeconds;
  requestGates = new Array(Math.max(1, concurrency)).fill(0);
  proxyGateAt = 0;
}

// --- TLS trust store (identical in every ETF repo) ---
const SYSTEM_CA_MARKER = 'ETF_UPDATER_SYSTEM_CA';
const CERT_ERROR = /UNABLE_TO_GET_ISSUER_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT|CERT_HAS_EXPIRED|unable to get (?:local )?issuer certificate|self[- ]signed certificate|certificate has expired/i;

export function isCertError(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown; cause?: unknown } | null;
  return CERT_ERROR.test(`${String(e?.code ?? '')} ${String(e?.message ?? '')}`) || (e?.cause ? isCertError(e.cause) : false);
}

export function systemCaActive(env: Record<string, string | undefined> = process.env, execArgv: string[] = process.execArgv): boolean {
  return execArgv.includes('--use-system-ca') || env.NODE_USE_SYSTEM_CA === '1' || env[SYSTEM_CA_MARKER] === '1';
}

export function reexecWithSystemCa(): never {
  const child = Bun.spawnSync([process.execPath, '--use-system-ca', ...process.argv.slice(1)], {
    env: { ...process.env, [SYSTEM_CA_MARKER]: '1' },
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  process.exit(child.exitCode ?? 1);
}

/** mode: auto (restart once on an untrusted-certificate error), true (restart now), false (never). */
export function installSystemCa(mode: string, reexec: () => never = reexecWithSystemCa, active: boolean = systemCaActive()): void {
  if (mode === 'false' || active) return;
  if (mode === 'true') reexec();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    try { return await realFetch(...args); }
    catch (error) {
      if (!isCertError(error)) throw error;
      console.error('[ notice   ] TLS certificate not trusted; restarting once with --use-system-ca');
      return reexec();
    }
  }) as typeof fetch;
}

async function main(): Promise<void> {
  const controls = await runtimeControls();
  installSystemCa(String(controls.USE_SYSTEM_CA ?? 'auto').trim().toLowerCase());
  if (controls.VERBOSE !== undefined) process.env.VERBOSE = controls.VERBOSE;
  const config = readConfig(controls);
  secUa = config.secUa;
  configurePacing(config.requestSleep, config.concurrency);
  issuerDirectDenials = 0;
  outputPrintConfig('Pacer', config);

  const previous = await readKnownFunds(await readPreviousIndex());
  const catalog = new Map<string, CatalogFund>();
  let catalogSource = 'previous api/pacer/index.json';
  if (!config.skipPacer) {
    try {
      const fetched = await fetchIssuerText(PACER_CATALOG_URL, '[catalog ] product listing', config, isCatalogPage, undefined, { cache: false });
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
  if (!universe.length) throw new Error('No catalog rows available. Run this where www.paceretfs.com is reachable (or through the rendering proxy) or seed api/pacer/index.json first.');
  console.log(`[ ${'catalog'.padEnd(9)}] ${universe.length} Pacer ETFs (${catalogSource})`);

  const unknownTickers = config.tickers ? [...config.tickers].filter((ticker) => !catalog.has(ticker)) : [];
  if (unknownTickers.length) throw new Error(`TICKERS: not in the Pacer catalog or published feed: ${unknownTickers.join(', ')}`);
  const newFunds = catalogSource === 'previous api/pacer/index.json' ? [] : universe.filter((fund) => !previous.has(fund.ticker)).map((fund) => fund.ticker);
  if (newFunds.length) {
    console.log(`NEW FUNDS: ${newFunds.join(', ')}`);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### NEW FUNDS\n\n${newFunds.join(', ')}\n`, 'utf8');
  }

  // Bounded batches resume from a cursor scoped to the filter set. A TICKERS run never reads or writes the cursor.
  const scope = JSON.stringify({ aum: config.aum ?? null, ter: config.ter ?? null, dy: config.dividendYield ?? null, sy: config.secYield ?? null, p: config.performance, t: config.totalReturn });
  const cursorState = config.tickers ? null : await readCursorState();
  const cursor = config.maxFetches > 0 && cursorState && cursorState.scope === scope ? cursorState.cursor : '';
  const index = cursor ? universe.findIndex((fund) => fund.ticker === cursor) : -1;
  // A bounded run walks the alphabetical cursor; an unbounded run goes stalest first.
  const ordered = config.maxFetches > 0
    ? (index >= 0 ? universe.slice(index + 1).concat(universe.slice(0, index + 1)) : universe)
    : stalestFirst(universe, previous);
  // Catalog-level filters (TICKERS, TER) are applied up front so skipped funds never consume the MAX_FETCHES budget.
  const queue = ordered.filter((fund) => catalogFilterReasons(fund, config).length === 0);
  const orderOf = new Map(ordered.map((fund, position) => [fund.ticker, position]));
  const queued = queue.length;
  const totalAttempts = config.maxFetches > 0 ? Math.min(config.maxFetches, queue.length) : queue.length;
  const results: JsonRecord[] = [];
  let counted = 0;
  let failures = 0;
  let updated = 0;
  let lastPosition = -1;
  const runStartedAt = Date.now();
  let deadlineHit = false;
  outputPrintFilter(queue.length, universe.length, outputHasOutputFilters(config));
  const output = outputCreateReporter(API_ROOT, totalAttempts);
  const worker = async (): Promise<void> => {
    for (;;) {
      if (config.maxFetches > 0 && counted >= config.maxFetches) return;
      if (!queue.length) return;
      if (softDeadlineReached(runStartedAt, Date.now())) { deadlineHit = true; return; }
      const fund = queue.shift()!;
      const before = await output.before(fund.ticker);
      try {
        const row = await processFund(fund, config, previous.get(fund.ticker) || {});
        if (row.__skipped) {
          await output.result(fund.ticker, before, 'skipped', (row.__skipReasons || ['not eligible']).join(', '));
        } else {
          counted += 1;
          lastPosition = Math.max(lastPosition, orderOf.get(fund.ticker) ?? -1);
          updated += 1;
          results.push(row);
          await output.result(fund.ticker, before);
        }
      } catch (error) {
        counted += 1;
        lastPosition = Math.max(lastPosition, orderOf.get(fund.ticker) ?? -1);
        failures += 1;
        const message = error instanceof Error ? error.message : String(error);
        await output.result(fund.ticker, before, 'failed', message);
      }
    }
  };
  await runWorkers(config.concurrency, worker);
  if (deadlineHit) {
    const line = `soft deadline reached after ${Math.round((Date.now() - runStartedAt) / 60000)} min: ${deadlineSummary(queued - queue.length, queued, queue, previous)}; the next run starts with them`;
    console.warn(`[ ${'deadline'.padEnd(9)}] ${line}`);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Soft deadline\n\n${line}\n`, 'utf8');
  }
  const lastTicker: string | null = lastPosition >= 0 ? ordered[lastPosition].ticker : (cursor || null);

  // A filtered, bounded or partially failed run never shrinks the feed: every known fund keeps a row
  // (refreshed when selected, otherwise the published one).
  const rows = new Map<string, JsonRecord>(previous);
  for (const row of results) rows.set(String(row.ticker), row);
  // A catalog fund without published data (new, or its first read failed) is still listed: no meta.json, so dataFile is null.
  for (const fund of universe) if (!rows.has(fund.ticker)) rows.set(fund.ticker, placeholderRow(fund));
  const funds = [...rows.values()].sort((a, b) => String(a.ticker).localeCompare(String(b.ticker)));
  const counts = { funds: funds.length, holdings: funds.reduce((sum, row) => sum + (numberOrNull(row.holdings) || 0), 0), history: funds.reduce((sum, row) => sum + (numberOrNull(row.history) || 0), 0) };
  await writeIfChanged(INDEX_FILE, {
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    source: {
      provider: 'Pacer ETFs (Pacer Advisors, Inc.; Pacer Funds Trust, SEC CIK 0001616668), U.S.-listed ETFs',
      market: 'us',
      site: PACER_SITE,
      catalog: PACER_CATALOG_URL,
      catalogFallback: proxyUrl(PACER_CATALOG_URL),
      holdings: 'SEC EDGAR Form N-PORT-P full schedule per fund (official fund page top 10 table as a labelled partial fallback)',
      distributions: 'paceretfs.com fund page Distributions table per fund (Yahoo dividend events fallback)',
      history: 'Yahoo Finance public chart API (adjusted close)',
    },
    counts,
    funds,
  });
  if (!config.tickers) await writeIfChanged(STATE_FILE, { cursor: config.maxFetches > 0 ? lastTicker : null, scope: config.maxFetches > 0 ? scope : null, savedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') });
  if (failures > 0 && updated === 0 && counted > 0) process.exitCode = 1;
  console.log(`[ ${'done'.padEnd(9)}] ${updated} funds updated, ${failures} failures`);
  console.log(`[ ${'done'.padEnd(9)}] counts: ${counts.funds} funds / ${counts.holdings.toLocaleString('en-US')} holdings rows / ${counts.history.toLocaleString('en-US')} history rows`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Pacer data update\n\n- updated: ${updated}\n- failed: ${failures}\n- counts: ${counts.funds} funds / ${counts.holdings.toLocaleString('en-US')} holdings rows / ${counts.history.toLocaleString('en-US')} history rows\n`, 'utf8');
}

if ((import.meta as { main?: boolean }).main) {
  if (process.argv.some((arg) => ['-h', '--help', 'help'].includes(arg))) console.log(USAGE.trim());
  else await main().catch((error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });
}
