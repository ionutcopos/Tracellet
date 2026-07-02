# Handoff — where we left off

_Last updated: 2026-07-03. Repo: https://github.com/ionutcopos/Tracellet_

Tracellet is a **multi-chain wallet fund-flow tracer**: paste a wallet, see where its
money went and came from — transfers aggregated by counterparty, with entity labels,
holdings, a network map, and an LLM summary.

## Current state — v2 shipped & pushed

- **Bidirectional** — every trace covers money **out and in**; UI toggles
  Out / In / In & Out, re-ranks (amount / tx count / recency), drills into each
  counterparty's transactions, and expands to every transaction. All explorer-linked.
- **Live data:** **Solana** (Helius — transfers + holdings + token names) and **EVM**
  (Etherscan V2 — Ethereum/Base/Arbitrum/Polygon/BSC, native transfers + balance).
  Bitcoin and Tron still run on the mock layer.
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
2. **Native asset only** — SPL/ERC-20 *transfers* aren't counted (needs prices).
3. **EVM holdings = native balance only** (ERC-20 list needs Etherscan Pro).
4. Live coverage is Solana + EVM; **Bitcoin + Tron** are still mock.

## Next steps

1. Bitcoin (UTXO indexer, filter change outputs) + Tron (TronGrid) live adapters.
2. Token *transfers* (SPL/ERC-20) with price data.
3. ERC-20 holdings for EVM.
4. Unit tests for `flow.ts` (aggregation, thresholds) and `chains.ts`.
5. Optional: multi-hop tracing; a labels-API integration if a key appears.
6. Co-write `AI-COLLABORATION.md` (deferred, to do together).
7. Run the README through `/humanizer` (not installed in the build env — do locally).

## Run

```bash
./scripts/dev.sh                 # both servers (handles Bun PATH)
./scripts/trace.sh <wallet>      # quick report
cd web && bun screenshot.mjs     # refresh docs/screenshots
```

Keys in `server/.env` (gitignored): `GROQ_API_KEY`, `HELIUS_API_KEY`,
`ETHERSCAN_API_KEY`. **Rotate all three before the repo gets attention** — they were
pasted in chat. Verify no secrets are staged before every commit.
