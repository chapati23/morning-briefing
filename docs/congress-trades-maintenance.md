# Congress Trades — Maintenance Guide

> **Audience:** AI agents (Giskard, Cursor, Claude Code) and human developers.
> This document explains how to update the Congress Trades data source when
> political circumstances change — new legislation, committee rotations,
> retirements, elections, etc.

## Overview

The Congress Trades module scrapes [Capitol Trades](https://www.capitoltrades.com/trades)
and applies heuristic scoring to surface trades that would make an informed
investor say "huh, interesting." The scoring system has several tunable
components that need periodic updates.

---

## When to Update

| Trigger                                    | What to update                                | Frequency                           |
| ------------------------------------------ | --------------------------------------------- | ----------------------------------- |
| **New Congress seated** (Jan of odd years) | Full politician map review                    | Every 2 years                       |
| **Committee assignments published**        | Committee memberships in politician JSON      | Every 2 years (+ mid-term changes)  |
| **Mid-term election results**              | Remove defeated/retired members, add new ones | Every 2 years                       |
| **Leadership changes**                     | Multiplier tiers (Speaker, Leaders, Whips)    | As they happen                      |
| **Member retirement/resignation**          | Remove from politician map                    | As they happen                      |
| **New notable trader emerges**             | Add to politician map as tier 3               | Quarterly review                    |
| **Capitol Trades changes HTML**            | Update parser selectors                       | When parser breaks (canary warning) |
| **New sector-relevant tickers emerge**     | Add to ticker-sectors.json                    | Quarterly review                    |

---

## File Reference

| File                                 | Purpose                                   | Update frequency            |
| ------------------------------------ | ----------------------------------------- | --------------------------- |
| `src/data/congress-politicians.json` | Who to watch + scoring multipliers        | Every Congress / as needed  |
| `src/data/committee-sectors.json`    | Which committees oversee which sectors    | Every Congress              |
| `src/data/ticker-sectors.json`       | Maps stock tickers to industry sectors    | Quarterly                   |
| `src/data/excluded-tickers.json`     | Broad ETFs to filter out (SPY, QQQ, etc.) | Rarely                      |
| `src/sources/congress-trades.ts`     | Parser + scoring logic                    | When Capitol Trades changes |

---

## 1. Updating the Politician Map

**File:** `src/data/congress-politicians.json`

### Structure

```json
{
  "_lastReviewed": "2026-02-25",
  "Nancy Pelosi": {
    "multiplier": 2,
    "role": "Former Speaker",
    "committees": [],
    "chamber": "House",
    "state": "CA",
    "party": "D"
  }
}
```

### Multiplier Tiers

| Tier                                 | Multiplier   | Who qualifies                                                                                                                                       | Rationale                                                    |
| ------------------------------------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **1 — Leadership**                   | 3x           | Speaker, Majority/Minority Leaders, Whips                                                                                                           | Maximum institutional power + information access             |
| **2 — Key Committee Chairs/Ranking** | 2x           | Chairs and ranking members of: Armed Services, Financial Services/Banking, Intelligence, Energy & Commerce, Judiciary, Ways & Means, Appropriations | Direct oversight of industries = potential insider knowledge |
| **3 — Known Active Traders**         | 2x           | Members known for frequent, large, or suspiciously timed trades (e.g., Pelosi, Tuberville)                                                          | Track record of notable trading activity                     |
| **4 — Everyone Else**                | 1x (default) | All other members                                                                                                                                   | Not in the JSON — they get the default multiplier            |

### How to Decide Who's in the Map

**Include if ANY of these are true:**

1. Holds a leadership position (Speaker, Leader, Whip)
2. Chairs or is ranking member of a key committee (see tier 2 list)
3. Has been flagged by media/watchdogs for notable trading patterns
4. Consistently trades above $500K
5. Has been the subject of STOCK Act violation investigations

**Remove if ANY of these are true:**

1. No longer in Congress (retired, lost election, resigned)
2. Moved to a non-relevant committee with no trading history
3. Hasn't made a notable trade in 2+ years

### Update Process

1. **Check `_lastReviewed` date** — if >6 months old, do a full review
2. **Verify membership:** Search "[politician name] congress" to confirm still serving
3. **Verify committees:** Check [congress.gov/committees](https://www.congress.gov/committees) or search "[name] committee assignments [year]"
4. **Verify leadership:** Check [house.gov](https://www.house.gov/leadership) and [senate.gov](https://www.senate.gov/senators/leadership.htm)
5. **Update `_lastReviewed`** when done
6. **Run tests:** `bun test tests/congress-trades.test.ts` — sanity check fixtures should still pass (fixture data doesn't change, but politician lookups might affect scoring)

### Example: New Congress Seated

```bash
# 1. Research current leadership + committee chairs
# 2. Update the JSON
# 3. Run tests
bun test tests/congress-trades.test.ts
# 4. Commit
git commit -m "chore: update congress-politicians for 120th Congress"
```

---

## 2. Updating Committee↔Sector Mappings

**File:** `src/data/committee-sectors.json`

### Committee-Sector Format

```json
{
  "Armed Services": {
    "direct": ["defense", "aerospace", "military"],
    "tangential": ["cybersecurity"]
  }
}
```

- **`direct`** sectors: The committee has primary regulatory oversight. Trades get **2x** relevance multiplier.
- **`tangential`** sectors: Related but not primary oversight. Trades get **1.5x** relevance multiplier.

### Decision Framework

**Direct:** The committee writes laws, holds hearings, and approves budgets for this sector.

- Armed Services → defense contractors, military suppliers
- Banking/Financial Services → banks, insurance, fintech
- Energy & Commerce → utilities, oil/gas, telecom

**Tangential:** The committee's work affects this sector indirectly.

- Armed Services → cybersecurity (defense-adjacent)
- Intelligence → defense (intel informs defense spending)

**Empty arrays are intentional** for committees like Ethics and Small Business — they don't have sector-specific oversight that would create insider trading signals.

### When Committees Change Scope

Congress occasionally reorganizes committee jurisdictions. If a committee gains/loses oversight of an industry:

1. Check the committee's [jurisdiction page on congress.gov](https://www.congress.gov/committees)
2. Update `direct` / `tangential` arrays accordingly
3. No code changes needed — the scoring engine reads the JSON dynamically

---

## 3. Updating Ticker↔Sector Mappings

**File:** `src/data/ticker-sectors.json`

### Ticker-Sector Format

```json
{
  "RTX": "defense",
  "LMT": "defense",
  "JPM": "banking",
  "NVDA": "tech"
}
```

### How to Expand

The parser logs unknown tickers at debug level:

```text
[congress-trades] No sector mapping for ticker: XYZ
```

Periodically check logs for frequently-traded unmapped tickers and add them.

**To classify a ticker:**

1. Look up the company on Yahoo Finance or similar
2. Map to the closest sector that matches a committee-sectors.json entry
3. If no committee-sector match exists, the ticker doesn't need mapping (committee relevance won't fire anyway)

> **TODO:** Currently each ticker maps to a single sector. Some tickers (e.g., NVDA)
> span multiple sectors (tech + defense). A future improvement could support arrays.

### Common Sectors

| Sector          | Example Tickers          | Relevant Committees           |
| --------------- | ------------------------ | ----------------------------- |
| `defense`       | RTX, LMT, NOC, GD, BA    | Armed Services                |
| `aerospace`     | BA, LMT, AXON            | Armed Services                |
| `banking`       | JPM, GS, MS, BAC, C, WFC | Banking, Financial Services   |
| `fintech`       | SQ, PYPL, COIN, HOOD     | Financial Services            |
| `insurance`     | BRK.B, AIG, MET, PRU     | Financial Services            |
| `energy`        | XOM, CVX, COP, SLB       | Energy & Commerce             |
| `oil`           | XOM, CVX, OXY, COP       | Energy & Commerce             |
| `gas`           | LNG, EQT, AR             | Energy & Commerce             |
| `utilities`     | NEE, DUK, SO, AEP        | Energy & Commerce             |
| `telecom`       | T, VZ, TMUS, CMCSA       | Energy & Commerce             |
| `tech`          | AAPL, MSFT, GOOGL, META  | Commerce/Science (tangential) |
| `pharma`        | JNJ, PFE, MRK, LLY, ABBV | Health (HELP committee)       |
| `cybersecurity` | CRWD, PANW, ZS, FTNT     | Intelligence (tangential)     |

---

## 4. Updating the ETF Exclusion List

**File:** `src/data/excluded-tickers.json`

Broad market ETFs are excluded because they're portfolio management, not alpha signals.

**Include:** Index funds (SPY, QQQ, VOO), bond ETFs (AGG, BND), money markets
**Don't include:** Sector ETFs (XLF, XLE) — these could be informative if a committee member is buying their own sector's ETF

Update rarely — only when new major index ETFs launch.

---

## 5. Scoring Tuning

The composite score formula:

```text
score = base_amount × politician_multiplier × direction_weight × freshness_modifier × committee_relevance
```

### Component Reference

| Component                 | Values                                                 | Where to change                                |
| ------------------------- | ------------------------------------------------------ | ---------------------------------------------- |
| **Base amount**           | 0 (<$100K), 1 ($100K), 2 ($250K), 3 ($500K), 5 ($1M+)  | `getBaseAmountScore()` in congress-trades.ts   |
| **Politician multiplier** | 1x (default), 2x (tier 2-3), 3x (tier 1)               | congress-politicians.json                      |
| **Direction weight**      | buy: 1x, sell: 1.5x, sale_full: 1.75x, exchange: 0.75x | `getDirectionWeight()` in congress-trades.ts   |
| **Freshness modifier**    | ≤7 days: 1.5x, 8-30 days: 1x, >30 days: 0.5x           | `getFreshnessModifier()` in congress-trades.ts |
| **Committee relevance**   | 1x (no match), 1.5x (tangential), 2x (direct)          | committee-sectors.json + ticker-sectors.json   |

### Thresholds

| Threshold             | Current Value | Effect                                |
| --------------------- | ------------- | ------------------------------------- |
| **Surface threshold** | score ≥ 3     | Trade appears in briefing             |
| **🔥 Hot threshold**  | score ≥ 6     | Trade gets fire emoji prefix          |
| **Amount floor**      | $100,000      | Trades below this are always filtered |

### Calibration Tips

- If too many trades surface → raise surface threshold to 4 or amount floor to $250K
- If too few trades surface → lower surface threshold to 2
- If 🔥 flags are too common → raise hot threshold to 8
- If 🔥 flags are too rare → lower hot threshold to 5
- Run `bun dev --source "Congress Trades" --dry-run` to test changes against live data

---

## 6. Parser Maintenance

### When Capitol Trades Changes Their HTML

The parser uses CSS selectors to extract data from the server-rendered HTML table.
If Capitol Trades redesigns their site, the parser will break.

**Detection:** The zero-trade canary will log:

```text
[congress-trades] ⚠️ Parsed 0 trades from 245000 bytes HTML — possible parser breakage
```

**How to fix:**

1. Fetch a fresh page: `curl -s https://www.capitoltrades.com/trades -o fresh.html`
2. Open in browser or inspect the HTML structure
3. Update the CSS selectors in `parseCapitolTradesHTML()`:
   - Politician name: currently `.politician-name` or `a[href*=politicians]`
   - Party: `.q-field.party`
   - Chamber: `.q-field.chamber`
   - State: `[class*=us-state]`
   - Issuer: `.issuer-name a` and `.issuer-ticker`
   - Trade URL: `a[href*='/trades/']`
4. Save the fresh HTML as a new test fixture
5. Update tests to match new structure
6. Run `bun dev --source "Congress Trades" --dry-run` to verify

### If Capitol Trades Moves to Client-Side Rendering

Currently the table is server-side rendered (Next.js SSR), so `fetch` + cheerio works.
If they move to client-only rendering, we'd need Puppeteer (same pattern as `etf-flows.ts`).

---

## 7. Quick Reference Commands

```bash
# Dry run — see what today's briefing would include
bun dev --source "Congress Trades" --dry-run

# Test just congress trades tests
bun test tests/congress-trades.test.ts

# Full test suite
bun test

# Check for lint/type issues
bun run typecheck && trunk check --fix
```

---

## 8. Decision Log

| Date       | Decision                                                   | Rationale                                                          |
| ---------- | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| 2026-02-23 | Chose Capitol Trades over Quiver Quant                     | Free, no API key, sufficient data quality                          |
| 2026-02-23 | Set amount floor at $100K                                  | Below this is background noise for wealthy Congress members        |
| 2026-02-23 | Pelosi gets 2x (not 3x)                                    | Notable for trading history, not current leadership position       |
| 2026-02-25 | Tiered committee relevance (direct 2x / tangential 1.5x)   | Prevents overly broad committees from inflating scores             |
| 2026-02-25 | Energy & Commerce: dropped "tech" and "pharma" from direct | Too broad — would flag too many trades as sector-relevant          |
| 2026-02-25 | Removed McHenry, Sherrod Brown, McMorris Rodgers           | No longer in Congress as of 2025                                   |
| 2026-02-25 | McConnell downgraded 3x → 1x                               | Stepped down from leadership, still senator but no elevated access |
