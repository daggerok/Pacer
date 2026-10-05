# Pacer

One of the app's features lets you select Pacer ETFs in the Watchlist and aggregate their holdings to see how often each ticker appears across the selected funds. Repeated holdings make overlapping exposure visible: the more selected funds include a ticker, the greater its potential influence on the portfolio; gains in that holding may help, while declines may hurt, and actual impact also depends on each fund's position size.  Another feature makes it faster and easier to find funds with stronger growth over different periods, higher dividend yields or distributions, greater Total Return (price performance plus dividends), and other key performance metrics. A single-file client-side tool that reads the generated `./api/pacer` static feed (Pacer ETFs product listing and per-fund pages, SEC EDGAR N-PORT-P full holdings, Yahoo Finance daily history) into a searchable ETF/investment-theme catalog with per-fund tabs, watchlist aggregation, ticker copy and CSV/TXT export - the same look, feel, columns and business logic as the sibling applications.

## Using Bun

```bash
bunx degit daggerok/Pacer#main ./12345 && cd $_
bunx serve . -p 1234
open http://0:1234
```

The application is live at <https://daggerok.github.io/Pacer/>.

### Column types and filters

Every column of the ETF catalog and of the Watchlist, Holdings, History and Distributions tabs has a type: text (`ABC`), number (`123`), percentage (`%`), money (`$`), date (`D`), date and time (`DT`) or time of day (`T`). The type is detected from the texts the column shows (80% of the filled cells must agree, otherwise text) and is written in the badge next to the column title: click it to cycle the type, Shift+click to return to auto-detection. Dates are read as `2024-06-15`, `6/15/2024`, `15.06.2024`, `Jun 15, 2024` or `15-Jun-2024`, date and time as `2024-06-15T09:30:00Z` or `2024-06-15 09:30`, time as `09:30`, `16:00:00` or `9:30 PM`

A row of filter inputs sits under the column headers (the `Filters` button hides it, `Clear filters` empties it). Filters of different columns are combined with AND, the search box applies on top, and Copy Tickers and the exports use the filtered rows. Filters and type overrides are remembered in the browser. `Sticky #` (next to `Filters`, off by default, remembered in the browser) numbers the rows by their rank in the table sorted by the current column before the column filters, so a filtered fund keeps its rank and the numbers keep gaps; the sort, the search and the category and blacklist choices rank again. The catalog starts sorted by Net Assets, largest first, unavailable values sort last in both directions, and every export starts with the `#` column. The red `Clear` button forgets everything saved in the browser without asking, except the blacklist and the theme, so the page looks like a first visit (also after a reload)

Inside one filter: a space means AND, a comma means OR, a leading `!` means NOT, `?` matches an empty or unavailable value and `!?` a value that is there; a value that is unavailable matches only `?` and negated conditions. An unquoted space ends the value, so quote values that contain one (`>="2024-06-15 09:30"`)

| Type | Examples |
| --- | --- |
| Text | `bank` contains, `"two words"`, `!bank`, `=exact`, `^starts`, `ends$`, `/regex/`, `tech, health` |
| Number, percentage, money | `>10`, `>=10 <50`, `=22` (matches what rounds to 22), `!=22`, `10..50`, `..50`, `10..`, `>1B` and `K` `M` `B` `T` suffixes, an optional `$` or `%` |
| Date, date and time | `>2024-06-01`, `2024` (the whole year), `2024-06` (the whole month), `2024-01..2024-06`, `today`, `yesterday`, `-7d..` (the last 7 days), `+2w`, `-3m`, `-1y` |
| Time | `>09:30`, `09:30..16:00`, `=12:00` (the whole minute) |

The `Columns` menu next to `Filters` lists every column of the ETF table from the first to the last, all of them shown by default, with a search box and the `All`, `Clear`, `Toggle` and `Reset` buttons. `Use` and `Ticker` are listed but locked. Hiding a column only removes it from the table: the filters, the sorting, the exports and Copy Tickers still use it. The choice is remembered in the browser (localStorage, never the data) and the menu is shown on the ETF catalog only

The asset classes are one `Asset classes` multi-select next to the `All ETFs` pill instead of one tab per class: every class is selected by default (= all ETFs), `Only` or unchecking narrows the table, and the `All ETFs` pill is lit only while nothing narrows it (all or none of the classes checked); clicking the pill clears the selection. The choice is remembered in the browser (localStorage, never the data)

## Updating the static Pacer data

Run the updater with Bun:

```bash
bun test
./scripts/update-data.ts
```

`./scripts/update-data.ts` is directly executable (`#!/usr/bin/env bun`); `bun scripts/update-data.ts` works the same. Run `./scripts/update-data.ts -h` (or `--help`) to print every configuration variable with its default and usage examples.

Defaults live in `scripts/update-data.config.json` (every control as a string). Explicit environment variables (even empty ones) override the file. The **Update Pacer ETF data** GitHub Actions workflow uses the same resolver (`resolveControls` in `scripts/update-data.ts`): individual `workflow_dispatch` inputs are blank by default and inherit the file, and the `advanced` input accepts a JSON object with any control (for example `{"VERBOSE":"true"}`). Precedence: file defaults < advanced JSON < nonblank inputs < protected Actions variable or environment. GitHub allows at most 25 inputs, so `HOLDINGS_PAGE_SIZE`, `STORE_RAW_DOWNLOADS`, `VERBOSE` and `SEC_UA` are set through `advanced`, and `SEC_UA` is also taken from the protected `SEC_UA` repository Actions variable when it is nonblank. The workflow always writes to `api/pacer` only. All supplied filters use **AND** logic.

### Data sources

| Block | Source |
| --- | --- |
| Catalog (all Pacer ETFs) | `https://www.paceretfs.com/products/` - one performance table per investment theme (name, ticker, total expenses, inception, NAV total returns) plus the series listing for funds without a table row |
| Fund page per fund | `https://www.paceretfs.com/products/{TICKER}` (Structured Outcome funds: `/products/structured-outcome-strategies/{TICKER}`) - Fund Details, quarter-end performance, top 10 holdings, distribution history (e.g. [COWZ](https://www.paceretfs.com/products/COWZ)) |
| Holdings per fund | SEC EDGAR Form N-PORT-P full schedule (Pacer Funds Trust, CIK 0001616668); the official top 10 table is a labelled partial fallback |
| Daily history | Yahoo Finance public chart API (`/v8/finance/chart/{TICKER}?range=max&interval=1d&events=div`); distributions fall back to its dividend events |
| Access | paceretfs.com sits behind a Cloudflare managed challenge: direct requests get HTTP 403, so pages are read through the read-only r.jina.ai rendering proxy |

### Metrics and caveats

Each fund carries a derived `metrics` object that powers the catalog columns shared with the sibling sites:

- `ytd` / `tr1y` - official YTD and 1-year returns -> *YTD Return*, *TR 1Y*
- `cagr3y` / `cagr5y` / `cagr10y` - published annualized 3Y/5Y/10Y figures -> *CAGR 3Y/5Y/10Y*
- `tr3y` / `tr5y` / `tr10y` - cumulative 3Y/5Y/10Y figures `(1 + CAGR)^n - 1` -> *TR 3Y/5Y/10Y*
- `siAnn` - since-inception annualized -> *SI Ann.*
- `dividendYield` - indicated yield (latest distribution x payments per year / NAV), an estimate: Pacer publishes no distribution yield
- `dividendYieldBasis` - code of the definition behind `dividendYield`, `null` exactly when `dividendYield` is `null`; the code is stored with the yield in each fund's `meta.json` (`yields.dividendYieldBasis`) so a kept fund never pairs a new yield with an old code:

  | Code | Meaning for Pacer |
  | --- | --- |
  | `indicated` | the only code Pacer funds carry: latest distribution x inferred payments per year / NAV (or market price when NAV is missing); Pacer publishes no yield |
  | `official-trailing-12m`, `official-distribution-rate`, `official-other`, `computed-trailing-12m` | part of the shared vocabulary, not produced for Pacer today (`official-other` would label a yield the fund page published) |
- `secYield` - 30-day SEC yield when the fund page publishes one; `-` otherwise
- `returnsBasis` - always a non-empty label of how the returns were computed: official Pacer NAV total returns from the product listing (month-end) where published, with Yahoo adjusted market-price closes filling missing values, or Yahoo adjusted closes only (market-price estimates, not NAV returns)
- `performanceAsOf` - ISO date `YYYY-MM-DD` the returns are as of: the product listing performance table date when official returns exist, otherwise the last Yahoo close date; it is not the NAV date and is `null` only when no date is known

Caveats:

- Returns in the product listing are official NAV total returns as of the table's first header date (month-end); the fund pages add quarter-end NAV and market-price rows; values derived from Yahoo Finance daily history are market-price estimates used only where the official figure is missing
- A fund is either fully updated or fully kept: when the fund page or the Yahoo chart fails for an already published fund, its previous complete files stay untouched (the workflow commits whatever finished, so no fund mixes new and stale columns); the run stops taking new funds after 25 minutes and still writes `index.json`, and exits non-zero when every attempted fund failed
- A fund page counts as fully loaded only when it has the Fund Details pricing block (NAV, Market Price, Net Assets and Premium/Discount rows) and both performance tables (Recent Investment Performance and Performance (%)). The rendering proxy sometimes returns a partial page, and the listing can fail or omit a fund's row: every section that was published as official before and is missing then counts as a failed read of that section. The previous official block is kept as one unit (Fund Details values with their as-of date, month-end returns with their dates, `returnsBasis` and `performanceAsOf`, quarter-end and market-price performance rows, the Distributions table), never replaced by Yahoo-derived values or `null`, and one `[ kept ]` line per fund names what was kept. A fully loaded page that lacks a field is an honest absence and publishes `null` (a missing market price on a loaded page falls back to the labelled Yahoo last price)
- A catalog fund with no published data whose page or chart read failed is not written at all; `index.json` still lists it with `dataFile: null` and a full all-`null` `metrics` object (`returnsBasis` says no data was published yet)
- Unbounded runs (`MAX_FETCHES=0`, and `TICKERS` runs) process the stalest fund first: funds without published data, then the oldest published as-of date (`asOfDate`, `metrics.performanceAsOf`), ties alphabetical. A run cut short by the 25 minute deadline therefore leaves the freshest funds for last and the next run starts with the skipped ones, so the tail of the list never starves. The log and the step summary report how many funds were refreshed and the oldest remaining as-of date. A bounded run (`MAX_FETCHES` > 0) keeps walking the alphabetical cursor
- QTD and the other derived returns are anchored on the last close before the period started; `siAnn` is derived only from at least one year of history; month-name dates are parsed as UTC and printed zero-padded (`Oct 01 2026`)
- A bounded `PERFORMANCE_*` or `TOTAL_RETURN_*` range excludes funds with no value for that tenor
- New catalog funds are announced as `NEW FUNDS: ...` in the run output and the step summary
- Unavailable values stay empty and are never written as `0`; young funds and autocallable funds publish `-` or `n/a` for tenors they do not have yet
- Each fund keeps as-of date and source metadata for holdings, history and distributions
- The full "Daily Holdings" file is a protected download that neither direct requests nor the rendering proxy can read, so full holdings come from the latest SEC EDGAR N-PORT-P filing (a quarterly-lagged report period, shown in the holdings as-of date); new funds without a filing fall back to the official top 10 table (partial, weights only, market values derived from net assets and labelled as such); a previously published full schedule is kept over the partial table, and the previous run is the last resort
- Net assets, NAV and market price are the official fund-page figures as of the Fund Details date; premium/discount is the published value
- Only funds listed in the Pacer product listing are published; SEC series without a listing entry (for example SZNE and SZNG) are ignored
- Pages are fetched direct first and through the rendering proxy (paced at 3.2s or slower, one request per fund) after two denials; `REQUEST_SLEEP` and `CONCURRENCY` defaults are conservative for this reason

### Update controls

Keep this table, `scripts/update-data.config.json`, `CONTROL_NAMES` and `--help` in sync (covered by `scripts/update-data.test.ts`)

| Control | Default | Meaning |
| --- | --: | --- |
| `MAX_FETCHES` | `0` (all) | Batch size: with a positive value the updater continues after the committed cursor in `api/pacer/update-state.json`; empty or `0` is a full pass - every fund is refreshed in one run. Only funds that pass the `TICKERS`/`TER` filters count against the batch, the cursor wraps around, is scoped to the filter set (a different filter set starts again from the top) and is never read or written by a `TICKERS` run |
| `REQUEST_SLEEP` | `2.5` | Minimum delay in seconds between outgoing request starts, including retries; rendering-proxy requests are paced at 3.2s or slower |
| `CONCURRENCY` | `1` | Number of parallel fund update workers (for example `CONCURRENCY=15 ./scripts/update-data.ts`); each worker has its own request lane spaced by `REQUEST_SLEEP`, while rendering-proxy requests share one global gate (3.2s or slower), so keep it low when the WAF denies direct requests |
| `AUM` | `:` | Net Assets range; each bound may be a USD amount or `K`/`M`/`B`/`T`, or one of `nano`, `micro`, `small`, `mid`, `large` |
| `TER` | `:` | Total Expenses range in % (strict `min:max`) |
| `DIVIDEND_YIELD` | `:` | Indicated dividend-yield percentage range |
| `SEC_YIELD` | `:` | 30-day SEC yield percentage range; funds without a published SEC yield do not match |
| `TICKERS` | empty (all) | Space-, comma- or semicolon-separated ticker allowlist, e.g. `COWZ CALF GCOW ICOW ECOW`; an invalid entry or a ticker unknown to the catalog is an error |
| `HOLDINGS_PAGE_SIZE` | `250` | Rows in each generated current-holdings JSON page |
| `HISTORY_PAGE_SIZE` | `1000` | Rows in each generated daily-history JSON page |
| `STORE_RAW_DOWNLOADS` | `false` | Store the official product listing and fund pages (markdown) under `api/pacer/raw` |
| `MAX_RETRIES` | `2` | Retries after the initial request (integer >= 1); only network errors and HTTP 403/408/425/429/5xx are retried with exponential backoff |
| `HISTORY_RANGE` | `max` | Yahoo history window: `max` or `Ny` (for example `5y`); any other value is an error. The window is sent as an explicit `period1`/`period2` request (Yahoo ignores `range` next to them), so a shorter window also shortens the published history |
| `EDGAR_FALLBACK` | `true` | Read full holdings from SEC EDGAR Form N-PORT-P; when off, the official top 10 table or the previous holdings are used |
| `SKIP_YAHOO` | `false` | Keep previous history and distributions while refreshing catalog and holdings |
| `SKIP_PACER` | `false` | Keep the previously published catalog, fund-page data, holdings and distributions |
| `SEC_UA` | `daggerok ETF feed daggerok@gmail.com` | SEC User-Agent (SEC policy requires a declared contact); redacted in logs; the protected `SEC_UA` Actions variable wins when nonblank |
| `VERBOSE` | `false` | Print per-fund retry and fallback notices |
| `USE_SYSTEM_CA` | `auto` | TLS trust store: `auto` restarts the updater once with Bun's `--use-system-ca` when a request fails with an untrusted-certificate error; `true` always uses the system CA store; `false` never restarts. Not an individual workflow input: use `advanced`, the config file or the CLI environment. |
| `PERFORMANCE_YTD`, `_1Y`, `_3Y`, `_5Y`, `_10Y` | `:` | Annualized return ranges (`min:max`); YTD and 1Y are the official returns where published |
| `TOTAL_RETURN_YTD`, `_1Y`, `_3Y`, `_5Y`, `_10Y` | `:` | Cumulative return ranges (`min:max`) |

`TICKERS` combines with the AUM, TER, yield and return filters using AND logic; it does not override them. Filtered or bounded runs (`TICKERS`, `MAX_FETCHES`, filters, `SKIP_PACER`) and runs where the live catalog could not be read never shrink the feed: funds not selected keep their published rows and data files, and `index.json` always lists every known fund (the published index plus every `funds/*/meta.json`), with selected funds refreshed

### Examples

```bash
MAX_FETCHES=10 ./scripts/update-data.ts
TICKERS="COWZ CALF GCOW ICOW ECOW" ./scripts/update-data.ts
AUM="1B:" TER=":0.5" ./scripts/update-data.ts
CONCURRENCY=15 SEC_YIELD="3:" ./scripts/update-data.ts
PERFORMANCE_1Y="15:" ./scripts/update-data.ts
```

## TypeScript and verification

The browser app is intentionally build-free: `index.html` carries the markup, styles and bootstrap, and `app.tsx` is TypeScript compiled in the browser with Babel standalone - no build step, no bundler, no `tsconfig.json` needed. Bun runs TypeScript out of the box.

Verification before every publish:

```bash
bun install --frozen-lockfile
bun test
bun build --target=bun scripts/update-data.ts --outfile=/dev/null
git diff --check
```

`bun test` also covers the README controls table, the config file, `--help` and the workflow.

## Brands table

| Brand | Where to get the data |
| --- | --- |
| **AAM** | [aamlive.com](https://www.aamlive.com/ETF) \| [AAM](https://daggerok.github.io/AAM/) |
| **abrdn (Aberdeen)** | [aberdeeninvestments.com](https://www.aberdeeninvestments.com/en-us/investor/funds/etfs) \| [aberdeen](https://daggerok.github.io/aberdeen/) |
| **Amplify** | [amplifyetfs.com](https://amplifyetfs.com/) \| [Amplify](https://daggerok.github.io/Amplify/) |
| **ARK Invest** | [ark-funds.com](https://www.ark-funds.com/our-etfs/) \| [ARK](https://daggerok.github.io/ARK/) |
| **Capital Group** | [capitalgroup.com](https://www.capitalgroup.com/advisor/investments/exchange-traded-funds.html) \| [Capital-Group](https://daggerok.github.io/Capital-Group/) |
| **Fidelity** | [fidelity.com](https://www.fidelity.com/etfs) \| [Fidelity](https://daggerok.github.io/Fidelity/) |
| **First Trust** | [ftportfolios.com](https://www.ftportfolios.com/Retail/etf/etflist.aspx) \| [First-Trust](https://daggerok.github.io/First-Trust/) |
| **Franklin Templeton** | [franklintempleton.com](https://www.franklintempleton.com/investments/options/exchange-traded-funds) \| [Franklin](https://daggerok.github.io/Franklin/) |
| **Global X** | [globalxetfs.com/explore](https://www.globalxetfs.com/explore) \| [Global-X](https://daggerok.github.io/Global-X/) |
| **Goldman Sachs** | [am.gs.com](https://am.gs.com/en-us/individual/funds?locale=en-us&audience=individual&sf=funds&filters=funds%7CETF&limit=100) \| [Goldman-Sachs](https://daggerok.github.io/Goldman-Sachs/) |
| **Invesco** | [invesco.com](https://www.invesco.com/us/en/financial-products/etfs.html) \| [Invesco](https://daggerok.github.io/Invesco/) |
| **iShares** | [ishares.com](https://www.ishares.com/) \| [iShares](https://daggerok.github.io/iShares/) |
| **JPMorgan** | [am.jpmorgan.com](https://am.jpmorgan.com/us/en/asset-management/adv/products/fund-explorer/etf) \| [JPMorgan](https://daggerok.github.io/JPMorgan/) |
| **NEOS** | [neosfunds.com](https://neosfunds.com/#explore-etfs) \| [Neos](https://daggerok.github.io/Neos/) |
| **Northern Trust** | [etfs.ntam.northerntrust.com](https://etfs.ntam.northerntrust.com/us/en/individual/funds) \| [Northern-Trust](https://daggerok.github.io/Northern-Trust/) |
| **Pacer ETFs** | [paceretfs.com](https://www.paceretfs.com/products/) \| [Pacer](https://daggerok.github.io/Pacer/) |
| **Parametric** | [eatonvance.com](https://www.eatonvance.com/products/etfs.html) \| [Parametric](https://daggerok.github.io/Parametric/) |
| **ProShares** | [proshares.com](https://www.proshares.com/our-etfs/find-proshares-etfs) \| [ProShares](https://daggerok.github.io/ProShares/) |
| **Schwab** | [schwabassetmanagement.com](https://www.schwabassetmanagement.com/products) \| [Schwab](https://daggerok.github.io/Schwab/) |
| **SP Funds** | [sp-funds.com](https://www.sp-funds.com/) \| [SP-Funds](https://daggerok.github.io/SP-Funds/) |
| **SPDR** | [ssga.com](https://www.ssga.com/us/en/intermediary/etfs/fund-finder) \| [SPDR](https://daggerok.github.io/SPDR/) |
| **Sprott ETFs** | [sprottetfs.com](https://sprottetfs.com/) \| [Sprott](https://daggerok.github.io/Sprott/) |
| **Tema ETFs** | [temaetfs.com](https://temaetfs.com/funds) \| [Tema](https://daggerok.github.io/Tema/) |
| **Themes ETFs** | [themesetfs.com/etfs](https://themesetfs.com/etfs) \| [Themes](https://daggerok.github.io/Themes/) |
| **VanEck** | [vaneck.com](https://www.vaneck.com/us/en/etf-mutual-fund-finder/) \| [VanEck](https://daggerok.github.io/VanEck/) |
| **Vanguard** | [investor.vanguard.com](https://investor.vanguard.com/etf/list) \| [Vanguard](https://daggerok.github.io/Vanguard/) |
| **VictoryShares** | [vcm.com VictoryShares ETFs](https://www.vcm.com/products/victoryshares-etfs/victoryshares-etfs-list) \| [VictoryShares](https://daggerok.github.io/VictoryShares/) |
| **WisdomTree** | [wisdomtree.com](https://www.wisdomtree.com/investments) \| [WisdomTree](https://daggerok.github.io/WisdomTree/) |
| **Xtrackers** | [etf.dws.com](https://etf.dws.com/en-us/etf-products/) \| [Xtrackers](https://daggerok.github.io/Xtrackers/) |

## Sibling applications

| Application | Data provider | Repository |
| --- | --- | --- |
| AAM | Official AAM catalog/detail HTML + full holdings XLS + SEC N-PORT holdings fallback + Yahoo market history/dividends | [AAM](https://github.com/daggerok/AAM) |
| abrdn (Aberdeen) | Official Aberdeen gateway + SEC N-PORT holdings fallback + Yahoo history/dividends | [aberdeen](https://github.com/daggerok/aberdeen) |
| Amplify | Amplify ETFs Firestore data feed + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history/dividends | [Amplify](https://github.com/daggerok/Amplify) |
| ARK Invest | ark-funds.com fund pages + overview/NAV-history/performance JSON + official daily holdings CSV + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance distributions/history fallback | [ARK](https://github.com/daggerok/ARK) |
| Capital Group | Official Capital Group fund data + SEC N-PORT holdings fallback + Yahoo history fallback | [Capital-Group](https://github.com/daggerok/Capital-Group) |
| Fidelity | SEC EDGAR N-PORT-P + Yahoo Finance | [Fidelity](https://github.com/daggerok/Fidelity) |
| First Trust | ftportfolios.com official ETF list + fund summary, holdings, distribution and price-history export pages + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history fallback | [First-Trust](https://github.com/daggerok/First-Trust) |
| Franklin Templeton | franklintempleton.com ETF listings + product pages + SEC EDGAR N-PORT-P | [Franklin](https://github.com/daggerok/Franklin) |
| Global X | globalxetfs.com Next.js catalog and fund pages + dated full-holdings CSV | [Global-X](https://github.com/daggerok/Global-X) |
| Goldman Sachs | am.gs.com fund finder + detail pages + SEC EDGAR N-PORT-P | [Goldman-Sachs](https://github.com/daggerok/Goldman-Sachs) |
| Invesco | invesco.com fund pages and sitemap + official Invesco fund API (monthly returns, NAV, AUM, yields, daily holdings, expense ratio) + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history/dividends | [Invesco](https://github.com/daggerok/Invesco) |
| iShares | iShares (BlackRock) product workbooks | [iShares](https://github.com/daggerok/iShares) |
| JPMorgan | am.jpmorgan.com fund explorer + product-data JSON | [JPMorgan](https://github.com/daggerok/JPMorgan) |
| NEOS | neosfunds.com lineup table + official fund pages + daily holdings CSV | [Neos](https://github.com/daggerok/Neos) |
| Northern Trust | etfs.ntam.northerntrust.com funds list + per-fund CSV/JSON downloads | [Northern-Trust](https://github.com/daggerok/Northern-Trust) |
| Pacer ETFs | paceretfs.com product catalog and fund pages (Cloudflare WAF; r.jina.ai proxy fallback) + SEC EDGAR N-PORT-P (Pacer Funds Trust) + Yahoo Finance history/dividends | [Pacer](https://github.com/daggerok/Pacer) |
| Parametric | eatonvance.com ETF catalog and Parametric product pages + SEC EDGAR N-PORT-P holdings + Yahoo Finance history/dividends | [Parametric](https://github.com/daggerok/Parametric) |
| ProShares | proshares.com ETF finder + fund pages + official data host | [ProShares](https://github.com/daggerok/ProShares) |
| Schwab | schwabassetmanagement.com product pages + CSV exports | [Schwab](https://github.com/daggerok/Schwab) |
| SP Funds | sp-funds.com homepage catalog, fund pages and daily holdings CSV + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history/dividends | [SP-Funds](https://github.com/daggerok/SP-Funds) |
| SPDR | SSGA / State Street public feeds | [SPDR](https://github.com/daggerok/SPDR) |
| Sprott ETFs | sprottetfs.com fund pages + SEC EDGAR N-PORT-P (Sprott Funds Trust) + Yahoo Finance history/dividends | [Sprott](https://github.com/daggerok/Sprott) |
| Tema ETFs | Tema official fund pages + dated daily holdings CSV; SEC EDGAR N-PORT-P holdings fallback only + Yahoo Finance price/history/dividend fallback | [Tema](https://github.com/daggerok/Tema) |
| Themes ETFs | themesetfs.com catalog + daily holdings CSV + Yahoo Finance history/dividends + SEC N-PORT-P holdings fallback | [Themes](https://github.com/daggerok/Themes) |
| VanEck | vaneck.com ETF finder + product pages | [VanEck](https://github.com/daggerok/VanEck) |
| Vanguard | Vanguard product pages + SEC EDGAR N-PORT-P | [Vanguard](https://github.com/daggerok/Vanguard) |
| VictoryShares | VCM VictoryShares catalog and product JSON + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance adjusted-market-price history | [VictoryShares](https://github.com/daggerok/VictoryShares) |
| WisdomTree | WisdomTree product table + SEC EDGAR N-PORT-P + Yahoo Finance | [WisdomTree](https://github.com/daggerok/WisdomTree) |
| Xtrackers | Official DWS catalog/US sitemap + PDP/XLSX + SEC N-PORT-P holdings fallback + Yahoo Finance daily prices/history/dividends | [Xtrackers](https://github.com/daggerok/Xtrackers) |

## License

[MIT - same as all sibling ETF repositories.](./LICENSE)

Pacer®, Pacer ETFs®, Pacer Cash Cows Index®, Pacer Trendpilot® and the fund names/tickers referenced here are trademarks or service marks of Pacer Financial, Inc. and/or its affiliates. This is an independent, unofficial tool; it is not affiliated with, endorsed by, or sponsored by Pacer ETFs, Pacer Advisors, Inc. or Pacer Financial, Inc. All data is reproduced from Pacer ETFs' own public fund pages (read through a public rendering proxy), public SEC EDGAR filings and Yahoo Finance for research purposes. All other trademarks, including index names, are the property of their respective owners.
