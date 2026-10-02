# Pacer

One of the app's features lets you select Pacer ETFs in the Watchlist and aggregate their holdings to see how often each ticker appears across the selected funds. Repeated holdings make overlapping exposure visible: the more selected funds include a ticker, the greater its potential influence on the portfolio; gains in that holding may help, while declines may hurt, and actual impact also depends on each fund's position size.  Another feature makes it faster and easier to find funds with stronger growth over different periods, higher dividend yields or distributions, greater Total Return (price performance plus dividends), and other key performance metrics. A single-file client-side tool that reads the generated `./api/pacer` static feed (Pacer ETFs product listing, per-fund product pages, per-fund daily holdings CSV exports, Yahoo Finance daily history, SEC EDGAR N-PORT-P as holdings fallback) into a searchable ETF/asset-class catalog with per-fund tabs, watchlist aggregation, ticker copy and CSV/TXT export - the same look, feel, columns and business logic as the sibling applications.

## Using Bun

```bash
bunx degit daggerok/Pacer#main ./12345 && cd $_
bunx serve . -p 1234
open http://0:1234
```

The application will be served at <https://daggerok.github.io/Pacer/> (deployment pending: GitHub Pages is not live yet).

## Updating the static Pacer data

Run the updater with Bun:

```bash
bun scripts/update-data.ts
```

Run `bun scripts/update-data.ts --help` to print every control with its default. Defaults live in `scripts/update-data.config.json`; the same resolver (`resolveControls`) serves the CLI and the **Update Pacer ETF data** workflow. Precedence, lowest to highest: file defaults < `advanced` JSON < nonblank workflow inputs < environment variables (an explicitly set variable wins, even when empty) < the protected Actions variable `SEC_UA` (workflow only). Invalid values fail the run with a clear message instead of silently falling back. The workflow exposes 24 controls as individual inputs plus `advanced`, a JSON object that can set any other control (for example `{"STORE_RAW_DOWNLOADS": "true", "VERBOSE": "true"}`). All supplied filters use **AND** logic.

### Data sources

| Block | Source |
| --- | --- |
| Catalog (all Pacer ETFs) | `https://www.paceretfs.com/products/` (Pacer ETFs product listing, grouped by investment theme) |
| Fund page per ETF | `https://www.paceretfs.com/products/{lower-ticker}` (e.g. [COWZ](https://www.paceretfs.com/products/cowz)) - quarter-end Performance (%), Top 10 Holdings (%), Distributions |
| Holdings per fund | `https://www.paceretfs.com/products/holdings_download/{TICKER}` (daily holdings CSV export) |
| Daily history, distributions | Yahoo Finance public chart API (`/v8/finance/chart/{TICKER}?period1=...&period2=...&interval=1d&events=div%7Csplit`; the window follows `HISTORY_RANGE`) |
| Fallback | SEC EDGAR N-PORT-P for holdings fallback (Pacer Funds Trust, CIK 0001616668) |

### Metrics and caveats

Each fund carries a derived `metrics` object that powers the catalog columns shared with the sibling sites:

- `ytd` / `tr1y` - official YTD and 1-year total returns published in the product listing -> *YTD Return*, *TR 1Y*
- `cagr3y` / `cagr5y` / `cagr10y` - published annualized 3Y/5Y/10Y figures -> *CAGR 3Y/5Y/10Y*
- `tr3y` / `tr5y` / `tr10y` - cumulative 3Y/5Y/10Y figures `(1 + CAGR)^n - 1` -> *TR 3Y/5Y/10Y*
- `siAnn` - since-inception annualized -> *SI Ann.*
- `ter` - total annual fund operating expenses published in the product listing -> *Expense Ratio*
- `dividendYield` - indicated yield (latest distribution x payments per year / NAV); dividends come from the Yahoo chart `events.dividends` map with the fund-page distribution history as fallback
- `nav` / `aum` - derived from the daily holdings CSV: NAV is `NetAssets / SharesOutstanding` because paceretfs.com publishes no NAV or closing price; values are stored without a linked value when the publisher does not disclose the metric, so the UI shows a dash placeholder

Caveats:

- Unavailable is not zero: a metric the sources do not publish stays empty and the UI shows a dash placeholder
- Official returns come from the product listing (month-end NAV row) and the fund page (quarter-end NAV and market price tables); when neither is published, returns are estimates derived from Yahoo Finance adjusted market-price closes
- NAV is derived from the holdings CSV (net assets / shares outstanding) and premium/discount is an estimate against the Yahoo market price
- Every sheet records its as-of date and source; holdings fall back from the CSV to SEC N-PORT-P to the previous run
- `SKIP_PACER` and `SKIP_YAHOO` keep previously published values instead of writing zeros

### Update controls

| Control | Default | Meaning |
| --- | --: | --- |
| `MAX_FETCHES` | `0` (all) | Batch size: with a positive value the updater continues after the committed cursor in `api/pacer/update-state.json`; `0` is a full pass over every fund. |
| `REQUEST_SLEEP` | `2.5` | Minimum delay in seconds between outgoing request starts, including retries and the read-only rendering fallback. |
| `CONCURRENCY` | `1` | Number of parallel fund update workers. Request starts are still globally spaced by `REQUEST_SLEEP`. |
| `TICKERS` | all | Space-, comma- or semicolon-separated ticker allowlist, e.g. `COWZ CALF PTLC GCOW`. |
| `AUM` | `:` | Net Assets range. Each bound may be a USD amount, a `K`/`M`/`B`/`T` amount, or one of `nano`, `micro`, `small`, `mid`, `large`. |
| `TER` | `:` | Total expense ratio range in % (strict `min:max`). |
| `DIVIDEND_YIELD` | `:` | Indicated dividend-yield percentage range. |
| `PERFORMANCE_YTD`, `PERFORMANCE_1Y`, `PERFORMANCE_3Y`, `PERFORMANCE_5Y`, `PERFORMANCE_10Y` | `:` | Annualized return range per tenor (colon required). |
| `TOTAL_RETURN_YTD`, `TOTAL_RETURN_1Y`, `TOTAL_RETURN_3Y`, `TOTAL_RETURN_5Y`, `TOTAL_RETURN_10Y` | `:` | Cumulative total-return range per tenor (colon required). |
| `HOLDINGS_PAGE_SIZE` | `250` | Rows in each generated current-holdings JSON page. |
| `HISTORY_PAGE_SIZE` | `1000` | Rows in each generated daily-history JSON page. |
| `MAX_RETRIES` | `2` | Retries after the initial request, integer >= 1. Only network errors and HTTP 408/425/429/5xx are retried with exponential backoff. |
| `HISTORY_RANGE` | `max` | Yahoo history request window: `max` or `Ny` (for example `5y`). A shorter window publishes fewer history rows. |
| `STORE_RAW_DOWNLOADS` | `false` | Store raw issuer pages and CSVs under `api/pacer/raw`. |
| `EDGAR_FALLBACK` | `true` | Use identity-verified SEC N-PORT-P holdings when the daily holdings CSV is unavailable. |
| `SKIP_PACER` | `false` | Skip paceretfs.com requests (no listing, fund pages or holdings CSV); the latest published values are retained. |
| `SKIP_YAHOO` | `false` | Skip Yahoo Finance history updates. |
| `SEC_UA` | `daggerok ETF feed daggerok@gmail.com` | User-Agent for SEC and issuer requests (redacted in logs). The repository Actions variable `SEC_UA` overrides it in the workflow. |
| `VERBOSE` | `false` | Per-fund retry and fallback notices. |

`TICKERS` combines with the AUM, TER and yield filters using AND logic; it does not override them. Funds not selected for a successful update keep their prior published metadata and data files. There is no SEC yield control because paceretfs.com does not publish an SEC yield

### Examples

```bash
MAX_FETCHES=10 bun scripts/update-data.ts
TICKERS="COWZ CALF PTLC GCOW" bun scripts/update-data.ts
AUM="1B:" TER=":0.5" bun scripts/update-data.ts
PERFORMANCE_1Y="15:" HISTORY_RANGE=5y bun scripts/update-data.ts
```

## TypeScript and verification

The browser app is intentionally build-free: `index.html` carries the markup, styles and bootstrap, and `app.tsx` is TypeScript compiled in the browser with Babel standalone - no build step, no bundler, no `tsconfig.json` needed. Bun runs TypeScript out of the box.

```bash
bun install --frozen-lockfile
bun test
bun build --target=bun scripts/update-data.ts --outfile=/dev/null
git diff --check
```

`bun test` runs the single offline suite `scripts/update-data.test.ts`: parsers, the control resolver, config/`--help`/README parity and the workflow shape.

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
| **Pacer ETFs** | [paceretfs.com](https://www.paceretfs.com/products/) \| [Pacer](https://daggerok.github.io/Pacer/) (deployment pending) |
| **ProShares** | [proshares.com](https://www.proshares.com/our-etfs/find-proshares-etfs) \| [ProShares](https://daggerok.github.io/ProShares/) |
| **Schwab** | [schwabassetmanagement.com](https://www.schwabassetmanagement.com/products) \| [Schwab](https://daggerok.github.io/Schwab/) |
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
| Amplify | Amplify ETFs (Firestore data feed) | [Amplify](https://github.com/daggerok/Amplify) |
| ARK Invest | ark-funds.com fund pages + overview/NAV-history/performance JSON + official daily holdings CSV + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance distributions/history fallback | [ARK](https://github.com/daggerok/ARK) |
| Capital Group | Official Capital Group fund data + SEC N-PORT holdings fallback + Yahoo history fallback | [Capital-Group](https://github.com/daggerok/Capital-Group) |
| Fidelity | SEC EDGAR N-PORT-P + Yahoo Finance | [Fidelity](https://github.com/daggerok/Fidelity) |
| First Trust | ftportfolios.com official ETF list + fund summary, holdings, distribution and price-history export pages + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history fallback | [First-Trust](https://github.com/daggerok/First-Trust) |
| Franklin Templeton | franklintempleton.com ETF listings + product pages + SEC EDGAR N-PORT-P | [Franklin](https://github.com/daggerok/Franklin) |
| Global X | globalxetfs.com Next.js catalog and fund pages + dated full-holdings CSV | [Global-X](https://github.com/daggerok/Global-X) |
| Goldman Sachs | am.gs.com fund finder + detail pages + SEC EDGAR N-PORT-P | [Goldman-Sachs](https://github.com/daggerok/Goldman-Sachs) |
| Invesco | invesco.com CSV downloads + Yahoo Finance | [Invesco](https://github.com/daggerok/Invesco) |
| iShares | iShares (BlackRock) product workbooks | [iShares](https://github.com/daggerok/iShares) |
| JPMorgan | am.jpmorgan.com fund explorer + product-data JSON | [JPMorgan](https://github.com/daggerok/JPMorgan) |
| NEOS | neosfunds.com lineup table + official fund pages + daily holdings CSV | [Neos](https://github.com/daggerok/Neos) |
| Northern Trust | etfs.ntam.northerntrust.com funds list + per-fund CSV/JSON downloads | [Northern-Trust](https://github.com/daggerok/Northern-Trust) |
| Pacer ETFs | paceretfs.com product catalog and fund pages (Cloudflare WAF; r.jina.ai proxy fallback) + SEC EDGAR N-PORT-P (Pacer Funds Trust) + Yahoo Finance history/dividends | [Pacer](https://github.com/daggerok/Pacer) |
| ProShares | proshares.com ETF finder + fund pages + official data host | [ProShares](https://github.com/daggerok/ProShares) |
| Schwab | schwabassetmanagement.com product pages + CSV exports | [Schwab](https://github.com/daggerok/Schwab) |
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

Pacer® and Pacer ETFs® and the fund names/tickers referenced here are trademarks of Pacer Financial, Inc. This is an independent, unofficial tool; it is not affiliated with, endorsed by, or sponsored by Pacer Financial, Inc. or Pacer Advisors, LLC. All data is reproduced from Pacer ETFs' own public product pages, public SEC EDGAR filings and Yahoo Finance for research purposes. All other trademarks, including index names, are the property of their respective owners.
