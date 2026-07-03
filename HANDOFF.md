# Handoff — where we left off

_Last updated: 2026-07-03. Repo: https://github.com/ionutcopos/Tracellet_

Tracellet is a **multi-chain wallet fund-flow tracer**: paste a wallet, see where its
money went and came from — transfers aggregated by counterparty, with entity labels,
holdings, a network map, and an LLM summary.

## Current state — v2 shipped & pushed

- **Bidirectional** — every trace covers money **out and in**; UI toggles
  Out / In / In & Out, re-ranks (amount / tx count / recency), drills into each
  counterparty's transactions, and expands to every transaction. All explorer-linked.
- **Live data:** **Solana** (Helius) and **EVM** (Etherscan V2 — Ethereum/Base/
  Arbitrum/Polygon/BSC). Both count **native coins AND tokens**, valued in **USD** via
  DeFiLlama (`prices.ts`) so everything ranks together. Bitcoin/Tron still mock.
- **Entity labels:** curated address map (`labels/solana.ts`) + Helius `source`
  protocol labels (pump.fun/Jupiter/…), each with a category chip. CEX labels are
  intentionally left to the explorers (no paid labels API — user's call).
- **Money-flow map:** wallet-centered inline-SVG network graph (`FlowGraph` in
  `web/src/App.tsx`), edges weighted by amount, colored by direction.
- **Dev tooling:** `scripts/dev.sh`, `scripts/trace.sh`, `CLAUDE.md`,
  `web/screenshot.mjs` (regenerates `docs/screenshots/*.png` via headless Chrome).

## Architecture (unchanged thesis: code decides, AI narrates)

`detectChain()` (regex) → `getWalletTransfers()` swap point (live per family, else
mock) → pure engine `flow.ts buildFlowReport()` → `narrateFlow()` (Groq). Holdings via
`getWalletHoldings()`. Routes: `POST /detect`, `POST /trace`.

## Known limitations (by design)

1. **CEX entity labels** need a labels API (Solscan/Arkham); left to explorer links.
2. **Unpriced/spam tokens dropped** — token transfers under $1 (or with no DeFiLlama
   price) are excluded; USD uses current prices (not historical-at-tx).
3. **EVM holdings = native balance only** (ERC-20 balance list needs Etherscan Pro);
   the native balance is valued in USD.
4. Live coverage is Solana + EVM; **Bitcoin + Tron** are still mock.

## Next steps

1. Bitcoin (UTXO indexer, filter change outputs) + Tron (TronGrid) live adapters.
2. ERC-20 holdings list for EVM; historical (at-tx) pricing.
3. Unit tests for `flow.ts` (aggregation, thresholds) and `chains.ts`.
4. Optional: multi-hop tracing; a labels-API integration if a key appears.
5. Co-write `AI-COLLABORATION.md` (deferred, to do together).
6. Run the README through `/humanizer` (not installed in the build env — do locally).

## Run

```bash
./scripts/dev.sh                 # both servers (handles Bun PATH)
./scripts/trace.sh <wallet>      # quick report
cd web && bun screenshot.mjs     # refresh docs/screenshots
```

Keys in `server/.env` (gitignored): `GROQ_API_KEY`, `HELIUS_API_KEY`,
`ETHERSCAN_API_KEY`. **Rotate all three before the repo gets attention** — they were
pasted in chat. Verify no secrets are staged before every commit.
