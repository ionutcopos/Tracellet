# CLAUDE.md — operating guide for Tracellet

Multi-chain wallet fund-flow tracer. Paste a wallet → see where its money went
(and came from), by counterparty, with entity labels, holdings, and an LLM summary.

## Architecture (the one idea)

**Code decides, AI narrates.** Deterministic code owns everything that must be correct;
the LLM only narrates already-computed numbers.

```
detectChain(addr)  →  getWalletTransfers()  →  buildFlowReport()  →  narrateFlow()  →  JSON
 (regex, chains.ts)    (swap point, data/)     (pure engine, flow.ts)  (Groq, narrate.ts)
```

- **`server/src/chains.ts`** — deterministic chain detection from address format + the
  chain registry (name, family, nativeAsset, explorer URLs). Never use the LLM for this.
- **`server/src/data/index.ts`** — THE swap point. `getWalletTransfers` / `getWalletHoldings`
  dispatch per chain: Solana → live (Helius), EVM → live (Etherscan), else → mock.
- **`server/src/data/live.ts`** — real provider JSON → normalized types. Nothing else sees
  a raw provider response.
- **`server/src/data/mock.ts`** — deterministic mock (seeded by address) for chains not
  yet live.
- **`server/src/flow.ts`** — the pure engine. The ONLY thing that produces numbers.
  Aggregates transfers by counterparty (both directions), concentration, flags.
- **`server/src/labels.ts` (+ `labels/`)** — entity labels: curated address map + Helius
  `source` protocol fallback.
- **`server/src/narrate.ts`** — LLM narration. Receives only the structured report.
- **`web/src/App.tsx`** — the whole frontend (dark, minimal, blue→violet accent).

## Run

Bun is required and is **not on the default PATH** (installed at `~/.bun/bin`).

```bash
./scripts/dev.sh                 # starts both servers, prints URLs
# or manually:
export PATH="$HOME/.bun/bin:$PATH"
cd server && bun run src/index.ts   # http://localhost:3000
cd web    && bun run dev             # http://localhost:5173
```

## Verify

```bash
./scripts/trace.sh HFFyTn7YjPWg2ctT1pgmnB585vWXPUmt4bnTrmCr2uKz   # live Solana wallet
curl -s -X POST localhost:3000/detect -H 'content-type: application/json' \
  -d '{"wallet":"<addr>"}'
```

**Test wallets:** live Solana `HFFyTn7YjPWg2ctT1pgmnB585vWXPUmt4bnTrmCr2uKz`; any
`0x…` address works for EVM. Then verify visually in the browser via the MCP tools.

## Conventions (do not break)

- **Detection is deterministic** — regex, never the LLM.
- **Only `flow.ts` produces numbers.** Keep it pure (no I/O, no LLM).
- **Never send per-recipient `txs` arrays to the LLM** — hundreds of entries break the
  response (`JSON.parse("")`). Strip to aggregates before narration.
- **Dust filter** (`<0.005` native) drops rent/fee noise so the ranking means something.
- **High-confidence labels only** — a wrong "Binance" label is worse than none.
- **EVM address ambiguity** — a `0x…` address is valid on every EVM chain; detection
  resolves the *family*, the specific chain is a UI selector (defaults Ethereum).

## State

- **Live:** Solana (Helius — transfers + holdings). EVM (Etherscan) as it lands.
- **Mock:** any chain without a live adapter yet.
- **Keys:** `server/.env` (gitignored, never commit) — `GROQ_API_KEY`, `HELIUS_API_KEY`,
  `ETHERSCAN_API_KEY`. These were pasted in chat during dev → **rotate before the repo
  gets attention.** Verify no secrets are staged before every commit.

See `HANDOFF.md` for current state and `plans/` for the active plan.
