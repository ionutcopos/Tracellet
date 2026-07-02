# Tracellet — Trace the Wallet

Paste any wallet address and see **where its money went**: every outbound transfer,
aggregated by recipient, ranked by amount, with how concentrated the outflow is and
how much of it cashed out to exchanges. Multi-chain — the chain is detected from the
address format, so the same tool works for Ethereum, Solana, Bitcoin, Tron and more.

> **Design principle:** *Code decides, AI narrates.* The chain is classified by a
> deterministic regex (not the LLM), and every number — totals, per-recipient sums,
> concentration — is computed in a pure engine. The LLM only receives that clean
> structured JSON and turns it into a plain-language summary. It never sees raw
> chain data and is told to quote fields verbatim, which keeps the analysis testable
> and the AI honest.

## What it does

1. Enter a wallet address
2. **`detectChain()`** classifies the chain from the address format — deterministic,
   instant, no LLM. (`0x…` → EVM, base58 → Solana, `bc1…`/`1…`/`3…` → Bitcoin, `T…`
   → Tron.) All EVM chains share one address format, so a `0x…` address defaults to
   Ethereum with a chain selector in the UI.
3. Backend fetches the wallet's outbound transfers (mock data now, live adapters later)
4. **`buildFlowReport()`** — the pure engine — aggregates by recipient and computes
   totals, per-recipient share, concentration, exchange cash-out, and flags
   (`cash-out`, `single-large`, `repeated`, `mixer`)
5. Groq (Llama) narrates the structured report into a summary + concentration verdict
6. Dashboard shows the stat tiles, AI summary, and a ranked "where the money went"
   flow with proportional bars

## Stack

- **Frontend:** React + Vite + Tailwind (dark, minimal, blue→violet accent)
- **Backend:** Bun + Hono
- **Data:** mock layer behind a `getWalletOutflows(wallet, chainId?)` interface
- **LLM:** Groq (free tier, Llama)

## Run

```bash
# backend
cd server && bun install && bun run dev      # http://localhost:3000

# frontend (separate terminal)
cd web && bun install && bun run dev          # http://localhost:5173
```

Set `GROQ_API_KEY` in `server/.env` to enable AI narration. Without it, the app
falls back to a template summary so the UI still works.

## Endpoints

- `POST /detect { wallet }` → detected chain + selectable options (EVM is ambiguous)
- `POST /trace { wallet, chainId? }` → the full `FlowReport` (with AI summary)

## Going live (mock → real data)

All chain data lives behind one interface in `server/src/data/index.ts`. Implement
the per-chain adapters in `server/src/data/live.ts` (stub included, with the provider
plan per chain: Etherscan/Alchemy for EVM, Helius for Solana, a UTXO indexer for
Bitcoin, TronGrid for Tron) — the engine and frontend don't change.

## How AI was used building this

- **Scaffolding & boilerplate:** delegated the initial Hono routes and Vite setup,
  then reviewed and restructured.
- **Flow logic:** the aggregation engine (`flow.ts`) and chain classifier
  (`chains.ts`) were written and reviewed by hand — these are the parts that must be
  correct, so AI was used for rubber-ducking edge cases (EVM address ambiguity,
  Bitcoin UTXO change outputs), not authoring.
- **Deliberate call — chain detection is code, not the LLM:** an address's chain is
  a format fingerprint, so classifying it with the model would be slower, cost a
  call, and occasionally be wrong. Keeping it deterministic is the whole thesis.
- **Prompt design:** the narration prompt is given only the structured report and
  told to quote fields verbatim and never invent numbers — the fix that stopped the
  model hallucinating figures.

See `DEVLOG.md` for the running log.
