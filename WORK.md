# TradingView links to congress trades

## Goal

Make congress-trade tickers tappable in the morning briefing so that, on iOS, tapping the ticker opens TradingView directly to that symbol's chart instead of just showing plain text like `Rep. NAME sold TICKER`.

## Status

Implementation complete, verification in progress

## Task Breakdown

- Add partial-substring link support to Telegram briefing items
- Generate TradingView symbol URLs for congress-trade tickers
- Link only the ticker text in congress-trade lines
- Verify with typecheck, tests, and trunk

## Decisions

- Keep the existing congress-trade sentence structure and link only the ticker.
- Use TradingView web symbol URLs, not the custom `tradingview://` scheme.
- Use `https://www.tradingview.com/symbols/<TICKER>/` because TradingView self-resolves the exchange.

## Open Questions

- None currently
