Offline test fixtures for scripts/update-data.test.ts
=====================================================

Every file is a trimmed, dated capture of a public source. Nothing here is
invented: values are copied from the live responses listed below, with rows
removed for size only (never edited).

catalog-listing.txt     2026-10-01 — https://www.paceretfs.com/products/
                        (product listing: theme sections + the month-end NAV
                        total-return table, "Total Return as of 09/30/2026").
                        Kept: the full Risk Mitigation section and the first
                        rows of High Quality Value, including the footnote
                        suffixed expense values ("0.77%1") and the "-" / "n/a"
                        placeholders published for newer funds.

cowz-product-page.txt   2026-10-01 — https://www.paceretfs.com/products/cowz
                        Performance (%) table as of 06/30/2026, Top 10 Holdings
                        (%) as of 10/01/2026 and the full Distributions table
                        (newest first).

cowz-holdings.csv       2026-10-01 — https://www.paceretfs.com/products/holdings_download/COWZ
                        Daily holdings export: Date,Account,StockTicker,CUSIP,
                        SecurityName,Shares,Price,MarketValue,Weightings,
                        NetAssets,SharesOutstanding,CreationUnits,MoneyMarketFlag
                        Rows kept: five equity positions, one money-market row
                        (MoneyMarketFlag=Y) and one negative-share cash offset,
                        plus the disclaimer trailer line.

cowz-chart.json         2026-10-01 — https://query1.finance.yahoo.com/v8/finance/chart/COWZ?range=5d&interval=1d&events=div|split&includeAdjustedClose=true

No network requests are made by the test suite.
