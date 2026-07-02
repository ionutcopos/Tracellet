# DEVLOG

Running log of how this was built and where AI was used. The point of keeping this
is to show *judgment* — what got delegated, what got reviewed by hand, and why.

## Day 1 — scaffold

- **Delegated:** initial project structure (Hono routes, Vite setup, Tailwind
  config, mock data generator). Reviewed and kept mostly as-is.
- **Written/reviewed by hand:** the signal engine (`signals.ts`). This is the part
  that has to be correct, so I read every line. Snipe window, hold-time, PnL, and
  funded-together grouping are all deterministic and unit-checkable.
- **Design decision I made, not the AI:** the LLM never sees raw RPC data. It only
  receives the already-computed `TokenReport` JSON and is told to quote fields
  verbatim. First draft let the model reason over raw trades and it started
  inventing numbers — locking it to structured input fixed that. That constraint is
  the whole "code decides, AI narrates" thesis of the project.
- **Verified:** signal engine is deterministic (same mint → same output) and the
  analyze pipeline runs end-to-end with the template fallback (no API key needed).

## Day 2 — pivot to Tracellet (wallet fund-flow tracer)

Reframed the product around a sharper question: **"where did this wallet's money
go?"** Same architecture, new pipeline.

- **New product, same thesis.** The token-analyzer became a multi-chain wallet
  fund-flow tracer: input a wallet → its outbound transfers aggregated by recipient,
  ranked, with concentration + exchange cash-out signals. The old token view is
  dropped from the UI (backend `signals.ts` left intact).
- **Multi-chain via deterministic detection.** `chains.ts` `detectChain()` classifies
  the chain from the address format with a regex — Ethereum/EVM, Solana, Bitcoin,
  Tron. The LLM does *not* do this: an address's chain is a fingerprint, so code is
  faster, free, and reliable. Honest constraint handled in the UI: all EVM chains
  share one address format, so `0x…` defaults to Ethereum with a chain selector.
- **Written/reviewed by hand:** the pure engine `flow.ts` (`buildFlowReport`) and the
  classifier `chains.ts`. Delegated the mock generator and the React view, then
  restyled the view by hand (dark, minimal, blue→violet accent, dataviz-validated).
- **Verified end-to-end:** `/detect` + `/trace` tested across EVM, Solana, Bitcoin,
  Tron with live Groq narration; the summary quotes only computed numbers. Frontend
  screenshotted on Ethereum and Solana traces.

## TODO (next sessions)

- [ ] Implement live data adapters in `server/src/data/live.ts`, one chain at a time
      (Solana via Helius first — key is already in `.env`).
- [ ] Add unit tests for `flow.ts` (aggregation, concentration thresholds, exchange
      totals) and `chains.ts` (the ambiguous BTC-legacy vs Solana cases).
- [ ] Per-recipient hover tooltip (currently a `title` attr) and a copy-address action.
- [ ] Optional: multi-hop tracing ("follow it through layers") as a v2.
- [ ] Short Loom for the portfolio case study.

## Notes to self

- Keep detection deterministic — it's the load-bearing correctness claim and the
  thesis in miniature. If it ever needs the LLM, something is wrong.
- The ranked flow list is the signature view: proportional bars + exchange labels
  make "where the money went" legible at a glance. Keep it clean.
